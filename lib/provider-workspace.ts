/**
 * Connect Capital — Provider workspace
 *
 * The funder's side of the transaction. Every read here goes through
 * `resolveProviderView`, which returns identity only against a live grant.
 * There is deliberately no "load the full file" function in this module for a
 * caller to reach for.
 *
 * The queue's job is to be honest about what stage each file is at, because a
 * funder who cannot tell "waiting on me" from "waiting on the merchant" stops
 * working the queue within a week.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { matches, authorizations } from '../db/matching';
import { applications, merchantBusinesses, financialProfiles, existingObligations } from '../db/merchant';
import { documents, documentVersions, documentRequests } from '../db/documents';
import { providers } from '../db/provider';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import { authorize, type Actor } from './policy';
import {
  resolveProviderView,
  type ActiveGrant,
  type DocumentSummary,
  type OpenRequest,
  type ProviderView,
} from './provider-view';
import type { FullApplicantRecord } from './blinded';

export type QueueTab =
  | 'new_matches'
  | 'authorized'
  | 'awaiting_merchant'
  | 'in_underwriting';

export interface QueueItem {
  applicationId: string;
  matchScore: number;
  grade: string | null;
  authorized: boolean;
  interestedAt: Date | null;
  openRequests: number;
  lastActivityAt: Date;
  /**
   * Whose move it is. The single most useful column in the workspace and the
   * reason a funder keeps opening it.
   */
  waitingOn: 'you' | 'merchant' | 'nobody';
}

export async function providerQueue(
  actor: Actor,
  providerId: string,
  tab: QueueTab,
): Promise<QueueItem[]> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        applicationId: matches.applicationId,
        score: matches.score,
        interestedAt: matches.providerInterestedAt,
        matchedAt: matches.createdAt,
        grade: applications.grade,
        authId: authorizations.id,
        authStatus: authorizations.status,
      })
      .from(matches)
      .innerJoin(applications, eq(applications.id, matches.applicationId))
      .leftJoin(
        authorizations,
        and(
          eq(authorizations.applicationId, matches.applicationId),
          eq(authorizations.providerId, matches.providerId),
          eq(authorizations.status, 'active'),
        ),
      )
      .where(
        and(
          eq(matches.providerId, providerId),
          isNull(matches.suppressedReason),
          sql`${matches.result} <> 'no_match'`,
        ),
      )
      .orderBy(desc(matches.createdAt));

    const items: QueueItem[] = [];

    for (const r of rows) {
      const authorized = Boolean(r.authId);

      const [openReqs] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(documentRequests)
        .where(
          and(
            eq(documentRequests.applicationId, r.applicationId),
            eq(documentRequests.providerOrgId, actor.orgId),
            eq(documentRequests.status, 'open'),
          ),
        );

      const openRequests = openReqs?.n ?? 0;

      items.push({
        applicationId: r.applicationId,
        matchScore: r.score,
        grade: r.grade,
        authorized,
        interestedAt: r.interestedAt,
        openRequests,
        lastActivityAt: r.matchedAt,
        waitingOn: !authorized ? 'nobody' : openRequests > 0 ? 'merchant' : 'you',
      });
    }

    return items.filter((i) => {
      switch (tab) {
        case 'new_matches':
          return !i.authorized;
        case 'authorized':
          return i.authorized;
        case 'awaiting_merchant':
          return i.authorized && i.waitingOn === 'merchant';
        case 'in_underwriting':
          return i.authorized && i.waitingOn === 'you';
      }
    });
  });
}

/**
 * A funder signalling interest on a blinded card. Deliberately low-cost —
 * it is not a commitment, it just tells the merchant which funders want the
 * file, which is a useful trust signal at the authorization moment.
 *
 * Migration 0004 grants UPDATE on this single column and freezes the rest, so
 * a match result cannot be quietly rewritten under cover of this action.
 */
export async function expressInterest(
  actor: Actor,
  providerId: string,
  applicationId: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  await mutate(
    actor,
    'view',
    {
      kind: 'application_blinded',
      id: applicationId,
      merchantOrgId: '',
      matchedProviderOrgIds: [actor.orgId],
    },
    {
      action: 'provider.expressed_interest',
      objectType: 'application',
      objectId: applicationId,
      applicationId,
    },
    ctx,
    async (tx) => {
      await tx
        .update(matches)
        .set({ providerInterestedAt: new Date() })
        .where(
          and(eq(matches.providerId, providerId), eq(matches.applicationId, applicationId)),
        );
    },
  );
}

/**
 * The one way a funder reads an application. Loads whatever grant exists —
 * including a revoked one — and hands it to the resolver. The resolver, not
 * this function, decides whether identity comes back.
 *
 * Passing the revoked grant through rather than filtering it out is
 * deliberate: the resolver can then distinguish "never authorized" from
 * "access ended", which the funder's screen needs to say something honest.
 */
export async function loadApplicationView(
  actor: Actor,
  applicationId: string,
): Promise<ProviderView> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return withActor(actor, async (tx) => {
    const record = await loadApplicantRecord(tx, applicationId);

    const [auth] = await tx
      .select()
      .from(authorizations)
      .where(
        and(
          eq(authorizations.applicationId, applicationId),
          eq(authorizations.providerOrgId, actor.orgId),
        ),
      )
      .orderBy(desc(authorizations.grantedAt))
      .limit(1);

    const grant: ActiveGrant | null = auth
      ? {
          authorizationId: auth.id,
          status: auth.status,
          scope: auth.scopeJson,
          expiresAt: auth.expiresAt,
        }
      : null;

    const docs = await loadDocumentSummaries(tx, applicationId);
    const reqs = await loadOpenRequests(tx, applicationId, actor.orgId);

    return resolveProviderView(record, grant, docs, reqs);
  });
}

/**
 * Requesting a document from the merchant.
 *
 * One request here can be satisfied by a single upload that also closes every
 * other funder's identical request — see `fulfilOpenRequests` in uploads.ts.
 * That fan-out is the mechanical form of the merchant's "upload once" promise.
 */
export async function requestDocument(
  actor: Actor,
  input: {
    applicationId: string;
    docType: string;
    description?: string;
    dueInDays?: number;
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<string> {
  const view = await loadApplicationView(actor, input.applicationId);
  if (view.kind !== 'full') {
    throw new Error('cannot request documents without an active authorization');
  }

  return mutate(
    actor,
    'message',
    {
      kind: 'conversation',
      id: input.applicationId,
      applicationId: input.applicationId,
      merchantOrgId: '',
      participantOrgIds: [actor.orgId],
    },
    {
      action: 'document.requested',
      objectType: 'document_request',
      applicationId: input.applicationId,
      metadata: { docType: input.docType },
    },
    ctx,
    async (tx) => {
      const [row] = await tx
        .insert(documentRequests)
        .values({
          applicationId: input.applicationId,
          providerOrgId: actor.orgId,
          requestedByUserId: actor.userId,
          docType: input.docType as never,
          description: input.description ?? null,
          status: 'open',
          dueAt: input.dueInDays
            ? new Date(Date.now() + input.dueInDays * 86400000)
            : null,
        })
        .returning({ id: documentRequests.id });
      return row.id;
    },
  );
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadApplicantRecord(
  tx: Tx,
  applicationId: string,
): Promise<FullApplicantRecord> {
  const [app] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  if (!app) throw new Error('application not found');

  const [biz] = await tx
    .select()
    .from(merchantBusinesses)
    .where(eq(merchantBusinesses.id, app.businessId))
    .limit(1);

  const [fin] = await tx
    .select()
    .from(financialProfiles)
    .where(eq(financialProfiles.applicationId, applicationId))
    .orderBy(desc(financialProfiles.computedAt))
    .limit(1);

  const positions = await tx
    .select()
    .from(existingObligations)
    .where(eq(existingObligations.applicationId, applicationId));

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const tib = biz?.inceptionDate
    ? Math.floor(
        (Date.now() - new Date(biz.inceptionDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
      )
    : null;

  return {
    applicationId,
    legalName: biz?.legalName ?? '',
    dba: biz?.dba ?? null,
    ownerNames: [],
    ownerSsnToken: null,
    streetAddress: (biz?.addressJson as Record<string, string> | null)?.street ?? null,
    phone: null,
    email: null,
    website: biz?.website ?? null,
    naicsCode: biz?.naicsCode ?? null,
    industryLabel: biz?.industryLabel ?? null,
    state: biz?.state ?? '',
    locality: biz?.locality ?? null,
    timeInBusinessMonths: tib,
    productType: app.productType,
    requestedAmount: Number(app.requestedAmount),
    preferredFrequency: app.preferredFrequency,
    avgMonthlyRevenue: num(fin?.avgMonthlyRevenue),
    avgDailyBalance: num(fin?.avgDailyBalance),
    negativeDays: fin?.negativeDays ?? null,
    nsfCount: fin?.nsfCount ?? null,
    depositCount: fin?.depositCount ?? null,
    monthsCovered: fin?.monthsCovered ?? null,
    financialConfidence: (fin?.confidence ?? 'stated') as 'verified' | 'parsed' | 'stated',
    positions: positions.map((p) => ({
      balance: num(p.currentBalance),
      paymentAmount: num(p.paymentAmount),
    })),
    selfReportedCreditBand: null,
    grade: app.grade,
    matchScore: 0,
    matchReasons: [],
    priorApplications: 0,
    priorFundings: 0,
    priorDeclines: 0,
    identityHash: '',
  };
}

async function loadDocumentSummaries(
  tx: Tx,
  applicationId: string,
): Promise<DocumentSummary[]> {
  const rows = await tx
    .select({
      documentId: documents.id,
      currentVersionId: documents.currentVersionId,
      docType: documents.docType,
      isRawStatement: documents.isRawStatement,
      versionNo: documentVersions.versionNo,
      uploadedAt: documentVersions.uploadedAt,
      periodStart: documentVersions.periodStart,
      periodEnd: documentVersions.periodEnd,
      parseStatus: documentVersions.parseStatus,
    })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .where(and(eq(documents.applicationId, applicationId), isNull(documents.deletedAt)));

  // A document still awaiting its virus scan is invisible to funders. They
  // download files supplied by strangers; shipping an unscanned attachment
  // into an underwriting team would hand them a malware problem as a feature.
  return rows
    .filter((r) => r.parseStatus !== 'pending' && !r.parseStatus.startsWith('quarantined'))
    .map((r) => ({
      documentId: r.documentId,
      currentVersionId: r.currentVersionId ?? '',
      docType: r.docType,
      isRawStatement: r.isRawStatement,
      versionNo: r.versionNo,
      uploadedAt: r.uploadedAt,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    }));
}

async function loadOpenRequests(
  tx: Tx,
  applicationId: string,
  providerOrgId: string,
): Promise<OpenRequest[]> {
  const rows = await tx
    .select({
      requestId: documentRequests.id,
      docType: documentRequests.docType,
      description: documentRequests.description,
      createdAt: documentRequests.createdAt,
    })
    .from(documentRequests)
    .where(
      and(
        eq(documentRequests.applicationId, applicationId),
        eq(documentRequests.providerOrgId, providerOrgId),
        eq(documentRequests.status, 'open'),
      ),
    );

  return rows;
}
