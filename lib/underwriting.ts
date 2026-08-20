/**
 * Connect Capital — Underwriting
 *
 * Thin service over the pure state machine in lib/underwriting-state.ts.
 * Transitions are validated there; this persists them and decides what the
 * merchant is told.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { underwritingStates, notifications } from '../db/messaging';
import { authorizations } from '../db/matching';
import { declineReasonCodes } from '../db/provider';
import { applications } from '../db/merchant';
import { mutate } from './audit';
import { withActor } from './db';
import { authorize, type Actor } from './policy';
import {
  checkTransition,
  aggregateDeclines,
  perProviderLabel,
  waitingOn,
  type UnderwritingStatus,
  type RawDecline,
} from './underwriting-state';

export async function currentStatus(
  actor: Actor,
  applicationId: string,
  providerOrgId: string,
): Promise<UnderwritingStatus> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ status: underwritingStates.status })
      .from(underwritingStates)
      .where(
        and(
          eq(underwritingStates.applicationId, applicationId),
          eq(underwritingStates.providerOrgId, providerOrgId),
        ),
      )
      .orderBy(desc(underwritingStates.changedAt))
      .limit(1),
  );
  return (row?.status as UnderwritingStatus) ?? 'not_started';
}

export async function setStatus(
  actor: Actor,
  input: {
    applicationId: string;
    status: UnderwritingStatus;
    declineReasonCode?: string;
    internalNote?: string;
    conditions?: string[];
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  const [live] = await withActor(actor, (tx) =>
    tx
      .select({ id: authorizations.id })
      .from(authorizations)
      .where(
        and(
          eq(authorizations.applicationId, input.applicationId),
          eq(authorizations.providerOrgId, actor.orgId),
          eq(authorizations.status, 'active'),
        ),
      )
      .limit(1),
  );
  if (!live) throw new Error('no active authorization on this application');

  const from = await currentStatus(actor, input.applicationId, actor.orgId);
  const check = checkTransition(from, input.status, input.declineReasonCode);
  if (!check.allowed) throw new Error(`invalid transition: ${check.reason}`);

  await mutate(
    actor,
    'update',
    {
      kind: 'offer',
      id: input.applicationId,
      applicationId: input.applicationId,
      merchantOrgId: '',
      providerOrgId: actor.orgId,
    },
    {
      action: `underwriting.${input.status}`,
      objectType: 'underwriting_state',
      applicationId: input.applicationId,
      metadata: { from, to: input.status, reasonCode: input.declineReasonCode ?? null },
    },
    ctx,
    async (tx) => {
      await tx.insert(underwritingStates).values({
        applicationId: input.applicationId,
        providerOrgId: actor.orgId,
        status: input.status,
        declineReasonCode: input.declineReasonCode ?? null,
        internalNote: input.internalNote ?? null,
        conditionsJson: input.conditions ?? null,
      });

      const [app] = await tx
        .select({ createdBy: applications.createdByUserId })
        .from(applications)
        .where(eq(applications.id, input.applicationId))
        .limit(1);

      if (app && waitingOn(input.status) === 'merchant') {
        await tx.insert(notifications).values({
          userId: app.createdBy,
          applicationId: input.applicationId,
          type: `underwriting.${input.status}`,
          title:
            input.status === 'pending_docs'
              ? 'A funder needs a document'
              : 'A funder needs something from you',
          // Critical: the merchant is not answering their phone, and a file
          // that stalls here dies quietly.
          critical: true,
        });
      }
    },
  );
}

/**
 * What the merchant sees. Aggregated, never a stream of red rows.
 *
 * A merchant who leaves after five rejections was fundable in ninety days and
 * nobody told them.
 */
export async function merchantStatusView(actor: Actor, applicationId: string) {
  const states = await withActor(actor, (tx) =>
    tx
      .select()
      .from(underwritingStates)
      .where(eq(underwritingStates.applicationId, applicationId))
      .orderBy(desc(underwritingStates.changedAt)),
  );

  const latest = new Map<string, (typeof states)[number]>();
  for (const s of states) if (!latest.has(s.providerOrgId)) latest.set(s.providerOrgId, s);

  const declined = [...latest.values()].filter((s) => s.status === 'declined');
  const codes = declined.map((d) => d.declineReasonCode).filter(Boolean) as string[];

  const reasonRows = codes.length
    ? await withActor(actor, (tx) =>
        tx.select().from(declineReasonCodes).where(inArray(declineReasonCodes.code, codes)),
      )
    : [];

  const byCode = new Map(reasonRows.map((r) => [r.code, r]));

  const raw: RawDecline[] = declined.map((d) => {
    const meta = byCode.get(d.declineReasonCode!);
    return {
      providerId: d.providerOrgId,
      reasonCode: d.declineReasonCode!,
      category: (meta?.category ?? 'fit') as RawDecline['category'],
      merchantFacingLabel: meta?.merchantFacingLabel ?? 'Passed on this file',
      remediationHint: meta?.remediationHint ?? null,
    };
  });

  const active = [...latest.values()].filter(
    (s) => s.status !== 'declined' && s.status !== 'withdrawn',
  );

  return {
    summary: aggregateDeclines(raw, active.length),
    providers: [...latest.values()].map((s) => {
      const meta = s.declineReasonCode ? byCode.get(s.declineReasonCode) : undefined;
      return {
        providerOrgId: s.providerOrgId,
        status: s.status,
        label: perProviderLabel(
          s.status as UnderwritingStatus,
          meta?.category as RawDecline['category'] | undefined,
          meta?.merchantFacingLabel,
        ),
        waitingOn: waitingOn(s.status as UnderwritingStatus),
        changedAt: s.changedAt,
      };
    }),
  };
}
