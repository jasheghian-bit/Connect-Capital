/**
 * Connect Capital — Application service
 *
 * Covers the funnel from an anonymous visitor answering six questions to a
 * submitted application ready for matching.
 *
 * The sequencing is the product decision: pre-qualification happens BEFORE
 * account creation and before any document. A cold merchant will not hand bank
 * statements to a platform they have never heard of. They answer six questions,
 * see which funders fit and why, and only then decide whether to continue.
 */

import { and, eq } from 'drizzle-orm';
import {
  prequalSnapshots,
  applications,
  merchantBusinesses,
  financialProfiles,
} from '../db/merchant';
import { consents } from '../db/kernel';
import { mutate } from './audit';
import { db, withActor, withSystem } from './db';
import type { Actor } from './policy';

export type OriginationChannel =
  | 'self_serve'
  | 'specialist_assisted'
  | 'funder_referral'
  | 'partner';

// ---------------------------------------------------------------------------
// Pre-qualification
// ---------------------------------------------------------------------------

export interface PrequalInput {
  sessionToken: string;
  requestedAmount: number;
  statedMonthlyRevenue: number;
  statedTimeInBusinessMonths: number;
  state: string;
  naicsCode?: string;
  statedCreditBand?: string;
  statedPositionCount?: number;
  /** From a funder's decline-routing link. Attribution begins here. */
  referralToken?: string;
}

/**
 * No actor — this runs for an anonymous visitor. Written as system, keyed to a
 * session token rather than a user, and upserted so a visitor revising an
 * answer does not create a second snapshot and inflate the funnel denominator.
 */
export async function capturePrequal(input: PrequalInput): Promise<string> {
  return withSystem(async (tx) => {
    const [existing] = await tx
      .select({ id: prequalSnapshots.id })
      .from(prequalSnapshots)
      .where(eq(prequalSnapshots.sessionToken, input.sessionToken))
      .limit(1);

    const values = {
      sessionToken: input.sessionToken,
      requestedAmount: String(input.requestedAmount),
      statedMonthlyRevenue: String(input.statedMonthlyRevenue),
      statedTimeInBusinessMonths: input.statedTimeInBusinessMonths,
      state: input.state,
      naicsCode: input.naicsCode ?? null,
      statedCreditBand: input.statedCreditBand ?? null,
      statedPositionCount: input.statedPositionCount ?? null,
    };

    if (existing) {
      await tx
        .update(prequalSnapshots)
        .set(values)
        .where(eq(prequalSnapshots.id, existing.id));
      return existing.id;
    }

    const [row] = await tx
      .insert(prequalSnapshots)
      .values(values)
      .returning({ id: prequalSnapshots.id });
    return row.id;
  });
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface CreateApplicationInput {
  businessId: string;
  requestedAmount: number;
  useOfFunds?: string;
  preferredFrequency?: string;
  prequalSessionToken?: string;
  referralToken?: string;
}

/**
 * Attribution is resolved here and frozen by trigger at the database. Every
 * question about acquisition cost, funder reciprocity, and the eventual
 * dual-channel economics reads from these three columns, and the pressure to
 * correct one after the fact will be real once money depends on it.
 */
export async function createApplication(
  actor: Actor,
  input: CreateApplicationInput,
  ctx: { ip?: string; userAgent?: string },
): Promise<string> {
  const attribution = await resolveAttribution(input.referralToken);

  let prequalId: string | null = null;
  if (input.prequalSessionToken) {
    const [snap] = await db
      .select({ id: prequalSnapshots.id })
      .from(prequalSnapshots)
      .where(eq(prequalSnapshots.sessionToken, input.prequalSessionToken))
      .limit(1);
    prequalId = snap?.id ?? null;
  }

  const applicationId = await mutate(
    actor,
    'create',
    {
      kind: 'application',
      id: input.businessId,
      merchantOrgId: actor.orgId,
      status: 'draft',
    },
    {
      action: 'application.created',
      objectType: 'application',
      metadata: {
        originationChannel: attribution.channel,
        referred: Boolean(attribution.providerOrgId),
      },
    },
    ctx,
    async (tx) => {
      const [app] = await tx
        .insert(applications)
        .values({
          businessId: input.businessId,
          productType: 'mca',
          requestedAmount: String(input.requestedAmount),
          useOfFunds: input.useOfFunds ?? null,
          preferredFrequency: input.preferredFrequency ?? null,
          status: 'draft',
          prequalSnapshotId: prequalId,
          originationChannel: attribution.channel,
          referringProviderOrgId: attribution.providerOrgId,
          referralToken: input.referralToken ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: applications.id });

      if (prequalId) {
        await tx
          .update(prequalSnapshots)
          .set({ convertedApplicationId: app.id })
          .where(eq(prequalSnapshots.id, prequalId));
      }

      return app.id;
    },
  );

  return applicationId;
}

async function resolveAttribution(
  referralToken?: string,
): Promise<{ channel: OriginationChannel; providerOrgId: string | null }> {
  if (!referralToken) return { channel: 'self_serve', providerOrgId: null };
  const { organizations } = await import('../db/kernel');
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.legalName, referralToken))
    .limit(1);
  return org
    ? { channel: 'funder_referral', providerOrgId: org.id }
    : { channel: 'self_serve', providerOrgId: null };
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmissionGap {
  field: string;
  message: string;
}

/**
 * Validated server-side. The wizard validates too, for the merchant's benefit,
 * but the client's opinion about completeness is not the one that counts.
 *
 * Returns gaps rather than throwing on the first problem — a merchant on a
 * phone should see everything still missing in one pass, not discover it one
 * field at a time.
 */
export async function validateForSubmission(
  actor: Actor,
  applicationId: string,
): Promise<SubmissionGap[]> {
  return withActor(actor, async (tx) => {
    const gaps: SubmissionGap[] = [];

    const [app] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);

    if (!app) return [{ field: 'application', message: 'Application not found' }];

    const [business] = await tx
      .select()
      .from(merchantBusinesses)
      .where(eq(merchantBusinesses.id, app.businessId))
      .limit(1);

    if (!business?.legalName)
      gaps.push({ field: 'legalName', message: 'Add your legal business name' });
    if (!business?.state)
      gaps.push({ field: 'state', message: 'Add the state you operate in' });
    if (!business?.inceptionDate)
      gaps.push({ field: 'inceptionDate', message: 'Add when the business started' });
    if (!business?.naicsCode)
      gaps.push({ field: 'industry', message: 'Choose your industry' });
    if (Number(app.requestedAmount) <= 0)
      gaps.push({ field: 'requestedAmount', message: 'Enter how much you need' });

    const [profile] = await tx
      .select({ months: financialProfiles.monthsCovered })
      .from(financialProfiles)
      .where(eq(financialProfiles.applicationId, applicationId))
      .limit(1);

    // Three months is the floor most MCA funders underwrite from. Below that
    // the merchant is matched against almost nothing and the experience reads
    // as the platform failing rather than the file being thin.
    if (!profile) {
      gaps.push({
        field: 'financials',
        message: 'Connect your bank or upload 3 months of statements',
      });
    } else if ((profile.months ?? 0) < 3) {
      gaps.push({
        field: 'financials',
        message: 'Funders need at least 3 months of activity',
      });
    }

    return gaps;
  });
}

/**
 * Idempotent. A merchant double-tapping submit on a slow connection is the
 * normal case, not an edge case — the guard is a status check, not a token.
 */
export async function submitApplication(
  actor: Actor,
  applicationId: string,
  consentTextVersion: string,
  consentTextHash: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ submitted: boolean; gaps: SubmissionGap[] }> {
  const gaps = await validateForSubmission(actor, applicationId);
  if (gaps.length > 0) return { submitted: false, gaps };

  const [current] = await db
    .select({ businessId: applications.businessId, status: applications.status })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!current) return { submitted: false, gaps: [{ field: 'application', message: 'Not found' }] };
  if (current.status !== 'draft') return { submitted: true, gaps: [] };

  await mutate(
    actor,
    'submit',
    {
      kind: 'application',
      id: applicationId,
      merchantOrgId: actor.orgId,
      status: current.status,
    },
    {
      action: 'application.submitted',
      objectType: 'application',
      objectId: applicationId,
      applicationId,
    },
    ctx,
    async (tx) => {
      // The consent artifact is written in the same transaction as the status
      // change. "What did the merchant agree to when they submitted, and
      // when" has to be answerable from one row, not reconstructed.
      await tx.insert(consents).values({
        consentType: 'platform_terms',
        subjectType: 'application',
        subjectId: applicationId,
        textVersion: consentTextVersion,
        textHash: consentTextHash,
        acceptedByUserId: actor.userId,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });

      await tx
        .update(applications)
        .set({ status: 'matching', submittedAt: new Date() })
        .where(
          and(eq(applications.id, applicationId), eq(applications.status, 'draft')),
        );
    },
  );

  return { submitted: true, gaps: [] };
}
