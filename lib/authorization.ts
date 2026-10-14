/**
 * CapNet — Authorization
 *
 * The narrow gate everything else passes through. A funder reaching a
 * merchant's file without a row here is the failure mode the whole company is
 * built to prevent.
 *
 * ── R11: STAGING IS NOT GRANTING ───────────────────────────────────────────
 *
 * A Funding Specialist may PREPARE an authorization. Only the merchant may
 * issue it, from their own authenticated session.
 *
 * This is the single control that keeps merchant control from being theater.
 * Without it a specialist clicks "authorize all twelve" on the merchant's
 * behalf during a phone call, and the platform is a broker CRM with better
 * branding and an audit log nobody reads.
 *
 * It is enforced in `policy.ts` — grant and revoke resolve to the merchant org
 * only — and again structurally here: `stageAuthorization` cannot produce an
 * active row no matter what the caller does.
 */

import { and, eq } from 'drizzle-orm';
import { authorizations, authorizationEvents, matches } from '../db/matching';
import { consents } from '../db/kernel';
import { providers } from '../db/provider';
import { mutate } from './audit';
import { withActor } from './db';
import { authorize, type Actor } from './policy';

export interface AuthorizationScope {
  profile: boolean;
  financialSummary: boolean;
  documents: string[];
  /**
   * Raw statement PDFs. Defaults false everywhere and requires the merchant to
   * turn it on deliberately, because a raw statement exposes the account
   * number, routing number, and the merchant's full customer and vendor list —
   * none of which a funder needs to price an advance.
   */
  rawDocuments: boolean;
}

export const DEFAULT_SCOPE: AuthorizationScope = {
  profile: true,
  financialSummary: true,
  documents: ['government_id', 'voided_check'],
  rawDocuments: false,
};

export interface GrantInput {
  applicationId: string;
  providerId: string;
  providerOrgId: string;
  scope?: Partial<AuthorizationScope>;
  consentTextVersion: string;
  consentTextHash: string;
  expiresInDays?: number;
  /** Present when a specialist prepared this and the merchant confirmed it. */
  stagedBySpecialistUserId?: string;
}

/**
 * Issued by the merchant, from the merchant's session. `policy.ts` refuses
 * every other actor including platform admins.
 */
export async function grantAuthorization(
  actor: Actor,
  input: GrantInput,
  ctx: { ip?: string; userAgent?: string },
): Promise<string> {
  const resource = {
    kind: 'authorization' as const,
    id: 'new',
    applicationId: input.applicationId,
    merchantOrgId: actor.orgId,
    providerOrgId: input.providerOrgId,
    status: 'active' as const,
    scopeIncludesRawDocuments: input.scope?.rawDocuments ?? false,
  };

  authorize(actor, 'grant', resource);

  const scope: AuthorizationScope = { ...DEFAULT_SCOPE, ...input.scope };

  return mutate(
    actor,
    'grant',
    resource,
    {
      action: 'authorization.granted',
      objectType: 'authorization',
      applicationId: input.applicationId,
      metadata: {
        providerId: input.providerId,
        rawDocuments: scope.rawDocuments,
        viaSpecialist: Boolean(input.stagedBySpecialistUserId),
      },
    },
    ctx,
    async (tx) => {
      // Verified providers only. A merchant should never be able to authorize
      // a funder the platform has not vouched for — the badge is the reason
      // they trust the choice.
      const [provider] = await tx
        .select({ status: providers.verificationStatus })
        .from(providers)
        .where(eq(providers.id, input.providerId))
        .limit(1);

      if (!provider || provider.status !== 'verified') {
        throw new Error('provider is not verified');
      }

      // The consent artifact is written in the same transaction as the grant.
      // "What did the merchant agree to, and when" has to be answerable from
      // adjacent rows that could not have been committed separately.
      const [consent] = await tx
        .insert(consents)
        .values({
          consentType: 'provider_authorization',
          subjectType: 'application',
          subjectId: input.applicationId,
          textVersion: input.consentTextVersion,
          textHash: input.consentTextHash,
          acceptedByUserId: actor.userId,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        })
        .returning({ id: consents.id });

      const [auth] = await tx
        .insert(authorizations)
        .values({
          applicationId: input.applicationId,
          providerId: input.providerId,
          providerOrgId: input.providerOrgId,
          grantedByUserId: actor.userId,
          stagedBySpecialistUserId: input.stagedBySpecialistUserId ?? null,
          status: 'active',
          scopeJson: scope,
          consentId: consent.id,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86400000)
            : null,
        })
        .returning({ id: authorizations.id });

      await tx.insert(authorizationEvents).values({
        authorizationId: auth.id,
        event: 'granted',
        actorUserId: actor.userId,
        metadataJson: { scope },
      });

      return auth.id;
    },
  );
}

/**
 * Immediate. No grace period, no read-only window, no drain.
 *
 * A merchant who revokes expects it to have already happened. Anything softer
 * would need explaining on the screen, and "access ends within 24 hours" is
 * not a promise worth making when the alternative costs nothing.
 */
export async function revokeAuthorization(
  actor: Actor,
  authorizationId: string,
  reason: string | undefined,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  const [existing] = await withActor(actor, (tx) =>
    tx.select().from(authorizations).where(eq(authorizations.id, authorizationId)).limit(1),
  );
  if (!existing) throw new Error('authorization not found');

  const resource = {
    kind: 'authorization' as const,
    id: authorizationId,
    applicationId: existing.applicationId,
    merchantOrgId: actor.orgId,
    providerOrgId: existing.providerOrgId,
    status: existing.status,
    scopeIncludesRawDocuments: existing.scopeJson.rawDocuments,
  };

  authorize(actor, 'revoke', resource);

  await mutate(
    actor,
    'revoke',
    resource,
    {
      action: 'authorization.revoked',
      objectType: 'authorization',
      objectId: authorizationId,
      applicationId: existing.applicationId,
      metadata: { providerId: existing.providerId },
    },
    ctx,
    async (tx) => {
      await tx
        .update(authorizations)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedReason: reason ?? null,
        })
        .where(
          and(eq(authorizations.id, authorizationId), eq(authorizations.status, 'active')),
        );

      await tx.insert(authorizationEvents).values({
        authorizationId,
        event: 'revoked',
        actorUserId: actor.userId,
        metadataJson: { reason: reason ?? null },
      });
    },
  );
}

/**
 * A specialist proposes; the merchant disposes.
 *
 * Returns a proposal the merchant sees and confirms. It writes nothing to
 * `authorizations` — there is no code path from here to an active grant, which
 * is deliberate. If a future change needs one, it will have to delete this
 * comment first.
 */
export async function stageAuthorization(
  actor: Actor,
  input: { applicationId: string; providerIds: string[]; note?: string },
  ctx: { ip?: string; userAgent?: string },
): Promise<{ applicationId: string; proposed: string[]; requiresMerchantConfirmation: true }> {
  if (actor.orgType !== 'specialist') {
    throw new Error('staging is a specialist action');
  }

  await mutate(
    actor,
    'view',
    {
      kind: 'application',
      id: input.applicationId,
      merchantOrgId: actor.orgId,
      status: 'authorizing',
    },
    {
      action: 'authorization.staged',
      objectType: 'application',
      objectId: input.applicationId,
      applicationId: input.applicationId,
      metadata: { proposed: input.providerIds, note: input.note ?? null },
    },
    ctx,
    async () => undefined,
  );

  return {
    applicationId: input.applicationId,
    proposed: input.providerIds,
    requiresMerchantConfirmation: true,
  };
}

/** Powers the Access Center: who has access, and what they have opened. */
export async function accessCenter(actor: Actor, applicationId: string) {
  return withActor(actor, (tx) =>
    tx
      .select({
        authorizationId: authorizations.id,
        providerId: authorizations.providerId,
        status: authorizations.status,
        scope: authorizations.scopeJson,
        grantedAt: authorizations.grantedAt,
        revokedAt: authorizations.revokedAt,
      })
      .from(authorizations)
      .where(eq(authorizations.applicationId, applicationId))
      .orderBy(authorizations.grantedAt),
  );
}

/** A provider's queue of blinded cards it has been matched to. */
export async function providerMatchQueue(actor: Actor, providerId: string) {
  return withActor(actor, (tx) =>
    tx
      .select({
        applicationId: matches.applicationId,
        result: matches.result,
        score: matches.score,
        interestedAt: matches.providerInterestedAt,
        createdAt: matches.createdAt,
      })
      .from(matches)
      .where(
        and(
          eq(matches.providerId, providerId),
          eq(matches.result, 'match'),
        ),
      )
      .orderBy(matches.createdAt),
  );
}
