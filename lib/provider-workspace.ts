/**
 * CapNet — Provider workspace
 *
 * The funder's side of the transaction. Every read here goes through
 * `resolveProviderView`, which returns identity only against a live grant.
 * There is deliberately no "load the full file" function in this module for a
 * caller to reach for.
 *
 * The queue lists ONLY applications this funder holds a live grant on
 * (founder decision, Sep 2026). Matching is internal: a funder that was matched
 * but not authorized has nothing in its queue and no way to learn the match
 * happened. No grade, no match score, and no count of other grantees appear.
 *
 * The queue's job is to be honest about what stage each file is at, because a
 * funder who cannot tell "waiting on me" from "waiting on the merchant" stops
 * working the queue within a week.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { authorizations } from '../db/matching';
import { applications, merchantBusinesses, financialProfiles, existingObligations } from '../db/merchant';
import { documents, documentVersions, documentRequests } from '../db/documents';
import { providers } from '../db/provider';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import { authorize, type Actor } from './policy';
import {
  resolveProviderView,
  isGrantLive,
  NO_ACCESS,
  type ActiveGrant,
  type DocumentSummary,
  type OpenRequest,
  type ProviderView,
} from './provider-view';
import type { FullApplicantRecord } from './provider-view';

export type QueueTab =
  | 'authorized'
  | 'awaiting_merchant'
  | 'in_underwriting';

export interface QueueItem {
  applicationId: string;
  openRequests: number;
  lastActivityAt: Date;
  /**
   * Whose move it is. The single most useful column in the workspace and the
   * reason a funder keeps opening it.
   */
  waitingOn: 'you' | 'merchant';
}

export async function providerQueue(
  actor: Actor,
  providerId: string,
  tab: QueueTab,
): Promise<QueueItem[]> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return withActor(actor, async (tx) => {
    // Driven from authorizations, not matches: a match without a grant must
    // never produce a row. Filtered to this provider org's own live grants.
    const rows = await tx
      .select({
        applicationId: authorizations.applicationId,
        grantedAt: authorizations.grantedAt,
        expiresAt: authorizations.expiresAt,
      })
      .from(authorizations)
      .where(
        and(
          eq(authorizations.providerId, providerId),
          eq(authorizations.providerOrgId, actor.orgId),
          eq(authorizations.status, 'active'),
          sql`(${authorizations.expiresAt} IS NULL OR ${authorizations.expiresAt} > now())`,
        ),
      )
      .orderBy(desc(authorizations.grantedAt));

    const items: QueueItem[] = [];

    for (const r of rows) {
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
        openRequests,
        lastActivityAt: r.grantedAt,
        waitingOn: openRequests > 0 ? 'merchant' : 'you',
      });
    }

    return items.filter((i) => {
      switch (tab) {
        case 'authorized':
          return true;
        case 'awaiting_merchant':
          return i.waitingOn === 'merchant';
        case 'in_underwriting':
          return i.waitingOn === 'you';
      }
    });
  });
}

/**
 * The one way a funder reads an application. Looks up this org's latest
 * grant FIRST and returns `no_access` before touching any applicant row when
 * there is none — so an unauthorized request does not even load the record,
 * and "no such application" is indistinguishable from "not authorized".
 * The resolver still makes the final call (revoked / expired / scope).
 */
export async function loadApplicationView(
  actor: Actor,
  applicationId: string,
): Promise<ProviderView> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return withActor(actor, async (tx) => {
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

    if (!isGrantLive(grant)) return NO_ACCESS;

    const record = await loadApplicantRecord(tx, applicationId);
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
