/**
 * CapNet — Offers and negotiation
 *
 * Every revision is computed, disclosed, validated against the merchant's
 * jurisdiction, and frozen. An offer that would be non-compliant in the
 * merchant's state is REFUSED at submission — not warned about, because a
 * warning is a thing a funder in a hurry clicks past.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  offers,
  offerRevisions,
  offerEvents,
  counteroffers,
  disclosureViews,
  bestAndFinalRequests,
} from '../db/offers';
import { authorizations } from '../db/matching';
import { applications, merchantBusinesses } from '../db/merchant';
import { notifications } from '../db/messaging';
import {
  computeDisclosure,
  validateDisclosure,
  rulesetFor,
  type OfferTerms,
  type Disclosure,
} from './disclosure';
import { assertNoUndisclosedFees } from './fee-transparency';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import { authorize, type Actor } from './policy';

export class DisclosureIncomplete extends Error {
  constructor(public readonly missing: string[], public readonly jurisdiction: string) {
    super(`disclosure incomplete for ${jurisdiction}: ${missing.join(', ')}`);
  }
}

const hashDisclosure = (d: Disclosure, rulesetVersion: string): string =>
  createHash('sha256').update(JSON.stringify(d) + rulesetVersion).digest('hex');

export interface SubmitOfferInput {
  applicationId: string;
  terms: OfferTerms;
  factorRate?: number;
  conditionsText?: string;
  expiresInHours?: number;
}

/**
 * Creates or revises an offer. Both paths run identical validation — a
 * revision is not a lighter-weight object than an original, and treating it as
 * one is how a compliant first offer becomes a non-compliant second one.
 */
export async function submitOffer(
  actor: Actor,
  input: SubmitOfferInput,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ offerId: string; revisionId: string; revisionNo: number }> {
  const jurisdiction = await merchantJurisdiction(actor, input.applicationId);

  const disclosure = computeDisclosure(input.terms);
  // Every merchant cost must appear in the itemization; funder-internal
  // pricing (buy rate, loading) must not. Refused, like an incomplete
  // disclosure — see lib/fee-transparency.ts.
  assertNoUndisclosedFees(input.terms, disclosure);
  const validation = validateDisclosure(disclosure, jurisdiction);

  if (!validation.valid) {
    throw new DisclosureIncomplete(validation.missing, jurisdiction);
  }

  const ruleset = rulesetFor(jurisdiction);

  return mutate(
    actor,
    'offer',
    {
      kind: 'offer',
      id: 'new',
      applicationId: input.applicationId,
      merchantOrgId: '',
      providerOrgId: actor.orgId,
    },
    {
      action: 'offer.submitted',
      objectType: 'offer',
      applicationId: input.applicationId,
      metadata: {
        jurisdiction,
        rulesetVersion: ruleset.version,
        estimatedApr: disclosure.estimatedApr,
        amountFinanced: disclosure.amountFinanced,
      },
    },
    ctx,
    async (tx) => {
      const [live] = await tx
        .select({ id: authorizations.id })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.applicationId, input.applicationId),
            eq(authorizations.providerOrgId, actor.orgId),
            eq(authorizations.status, 'active'),
          ),
        )
        .limit(1);
      if (!live) throw new Error('no active authorization on this application');

      const [existing] = await tx
        .select()
        .from(offers)
        .where(
          and(
            eq(offers.applicationId, input.applicationId),
            eq(offers.providerOrgId, actor.orgId),
          ),
        )
        .limit(1);

      let offerId: string;
      let previousRevisionId: string | null = null;

      if (existing) {
        if (existing.status === 'accepted') {
          throw new Error('cannot revise an accepted offer');
        }
        offerId = existing.id;
        previousRevisionId = existing.currentRevisionId;
      } else {
        const [created] = await tx
          .insert(offers)
          .values({
            applicationId: input.applicationId,
            providerOrgId: actor.orgId,
            status: 'draft',
            createdByUserId: actor.userId,
          })
          .returning({ id: offers.id });
        offerId = created.id;
      }

      const [{ n }] = await tx
        .select({ n: sql<number>`coalesce(max(revision_no), 0)::int` })
        .from(offerRevisions)
        .where(eq(offerRevisions.offerId, offerId));

      const revisionNo = n + 1;

      const [revision] = await tx
        .insert(offerRevisions)
        .values({
          offerId,
          revisionNo,
          supersedesRevisionId: previousRevisionId,
          grossAmount: String(input.terms.grossAmount),
          totalRepayment: String(input.terms.totalRepayment),
          paymentAmount: String(input.terms.paymentAmount),
          paymentFrequency: input.terms.frequency,
          holdbackPercent:
            input.terms.holdbackPercent === undefined
              ? null
              : String(input.terms.holdbackPercent),
          pricingJson: {
            factorRate: input.factorRate ?? null,
            holdbackPercent: input.terms.holdbackPercent ?? null,
          },
          feesJson: input.terms.fees as unknown as Array<Record<string, unknown>>,
          conditionsText: input.conditionsText ?? null,
          disclosureJson: disclosure as unknown as Record<string, unknown>,
          disclosureRulesetVersion: ruleset.version,
          disclosureMethodVersion: disclosure.methodVersion,
          disclosureHash: hashDisclosure(disclosure, ruleset.version),
          jurisdiction,
          expiresAt: input.expiresInHours
            ? new Date(Date.now() + input.expiresInHours * 3600000)
            : null,
          createdByUserId: actor.userId,
        })
        .returning({ id: offerRevisions.id });

      await tx
        .update(offers)
        .set({
          currentRevisionId: revision.id,
          status: revisionNo === 1 ? 'submitted' : 'revised',
        })
        .where(eq(offers.id, offerId));

      await tx.insert(offerEvents).values({
        offerId,
        revisionId: revision.id,
        event: revisionNo === 1 ? 'submitted' : 'revised',
        actorUserId: actor.userId,
        metadataJson: { revisionNo, estimatedApr: disclosure.estimatedApr },
      });

      const [app] = await tx
        .select({ createdBy: applications.createdByUserId })
        .from(applications)
        .where(eq(applications.id, input.applicationId))
        .limit(1);

      if (app) {
        await tx.insert(notifications).values({
          userId: app.createdBy,
          applicationId: input.applicationId,
          type: 'offer.received',
          title: revisionNo === 1 ? 'You have a new offer' : 'A funder revised their offer',
          // Critical. An offer expiring unseen is the failure the merchant was
          // told they could safely ignore their phone to avoid.
          critical: true,
        });
      }

      return { offerId, revisionId: revision.id, revisionNo };
    },
  );
}

/**
 * Records that a merchant actually saw a disclosure, with a hash of what was
 * rendered. Called by the offer screen on display, not on data fetch — a
 * prefetch is not a viewing.
 */
export async function recordDisclosureView(
  actor: Actor,
  revisionId: string,
  renderedHash: string,
  surface: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  await mutate(
    actor,
    'view',
    { kind: 'offer', id: revisionId, applicationId: '', merchantOrgId: actor.orgId, providerOrgId: '' },
    { action: 'disclosure.viewed', objectType: 'offer_revision', objectId: revisionId },
    ctx,
    async (tx) => {
      await tx.insert(disclosureViews).values({
        offerRevisionId: revisionId,
        viewedByUserId: actor.userId,
        renderedHash,
        surface,
      });
    },
  );
}

export async function counterOffer(
  actor: Actor,
  input: {
    offerId: string;
    fromRevisionId: string;
    requestedAmount?: number;
    requestedFactor?: number;
    requestedFrequency?: string;
    requestedTermDays?: number;
    message?: string;
  },
  ctx: { ip?: string; userAgent?: string },
): Promise<string> {
  const [offer] = await withActor(actor, (tx) =>
    tx.select().from(offers).where(eq(offers.id, input.offerId)).limit(1),
  );
  if (!offer) throw new Error('offer not found');

  authorize(actor, 'update', {
    kind: 'offer',
    id: input.offerId,
    applicationId: offer.applicationId,
    merchantOrgId: actor.orgId,
    providerOrgId: offer.providerOrgId,
  });

  return mutate(
    actor,
    'update',
    {
      kind: 'offer',
      id: input.offerId,
      applicationId: offer.applicationId,
      merchantOrgId: actor.orgId,
      providerOrgId: offer.providerOrgId,
    },
    {
      action: 'offer.countered',
      objectType: 'offer',
      objectId: input.offerId,
      applicationId: offer.applicationId,
    },
    ctx,
    async (tx) => {
      const [row] = await tx
        .insert(counteroffers)
        .values({
          offerId: input.offerId,
          fromRevisionId: input.fromRevisionId,
          merchantUserId: actor.userId,
          requestedAmount:
            input.requestedAmount === undefined ? null : String(input.requestedAmount),
          requestedPricingJson: input.requestedFactor
            ? { factorRate: input.requestedFactor }
            : null,
          requestedFrequency: input.requestedFrequency ?? null,
          requestedTermDays: input.requestedTermDays ?? null,
          message: input.message ?? null,
        })
        .returning({ id: counteroffers.id });

      await tx.update(offers).set({ status: 'countered' }).where(eq(offers.id, input.offerId));

      await tx.insert(offerEvents).values({
        offerId: input.offerId,
        revisionId: input.fromRevisionId,
        event: 'countered',
        actorUserId: actor.userId,
      });

      return row.id;
    },
  );
}

/**
 * Best-and-final. The merchant asks every authorized funder to sharpen at
 * once.
 *
 * This is how price competition reaches a blind marketplace. No funder sees
 * another's terms — they see that they are one of N and that the merchant just
 * asked all N. That is most of the competitive pressure of an open auction
 * without asking funders to bid in public, which a meaningful number of them
 * would refuse to do.
 */
export async function requestBestAndFinal(
  actor: Actor,
  applicationId: string,
  deadlineHours: number,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ requestId: string; providersNotified: number }> {
  return mutate(
    actor,
    'update',
    { kind: 'application', id: applicationId, merchantOrgId: actor.orgId, status: 'negotiating' },
    { action: 'offer.best_and_final_requested', objectType: 'application', objectId: applicationId, applicationId },
    ctx,
    async (tx) => {
      const live = await tx
        .select({ providerOrgId: authorizations.providerOrgId })
        .from(authorizations)
        .where(
          and(
            eq(authorizations.applicationId, applicationId),
            eq(authorizations.status, 'active'),
          ),
        );

      const [row] = await tx
        .insert(bestAndFinalRequests)
        .values({
          applicationId,
          requestedByUserId: actor.userId,
          providerCount: live.length,
          deadlineAt: new Date(Date.now() + deadlineHours * 3600000),
        })
        .returning({ id: bestAndFinalRequests.id });

      return { requestId: row.id, providersNotified: live.length };
    },
  );
}

export async function acceptOffer(
  actor: Actor,
  offerId: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<void> {
  const [offer] = await withActor(actor, (tx) =>
    tx.select().from(offers).where(eq(offers.id, offerId)).limit(1),
  );
  if (!offer) throw new Error('offer not found');

  authorize(actor, 'accept', {
    kind: 'offer',
    id: offerId,
    applicationId: offer.applicationId,
    merchantOrgId: actor.orgId,
    providerOrgId: offer.providerOrgId,
  });

  await mutate(
    actor,
    'accept',
    {
      kind: 'offer',
      id: offerId,
      applicationId: offer.applicationId,
      merchantOrgId: actor.orgId,
      providerOrgId: offer.providerOrgId,
    },
    { action: 'offer.accepted', objectType: 'offer', objectId: offerId, applicationId: offer.applicationId },
    ctx,
    async (tx) => {
      // Acceptance requires the merchant to have actually seen the disclosure
      // for the revision they are accepting. Not a formality — it is the whole
      // evidentiary point of disclosure_views.
      const [seen] = await tx
        .select({ id: disclosureViews.id })
        .from(disclosureViews)
        .where(
          and(
            eq(disclosureViews.offerRevisionId, offer.currentRevisionId!),
            eq(disclosureViews.viewedByUserId, actor.userId),
          ),
        )
        .limit(1);

      if (!seen) throw new Error('disclosure must be viewed before acceptance');

      await tx.update(offers).set({ status: 'accepted' }).where(eq(offers.id, offerId));

      await tx.insert(offerEvents).values({
        offerId,
        revisionId: offer.currentRevisionId,
        event: 'accepted',
        actorUserId: actor.userId,
      });

      await tx
        .update(applications)
        .set({ status: 'accepted' })
        .where(eq(applications.id, offer.applicationId));
    },
  );
}

/** Every offer on an application, with full revision history. */
export async function offersForMerchant(actor: Actor, applicationId: string) {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(offers)
      .where(eq(offers.applicationId, applicationId));

    return Promise.all(
      rows.map(async (o) => ({
        offer: o,
        revisions: await tx
          .select()
          .from(offerRevisions)
          .where(eq(offerRevisions.offerId, o.id))
          .orderBy(desc(offerRevisions.revisionNo)),
      })),
    );
  });
}

async function merchantJurisdiction(actor: Actor, applicationId: string): Promise<string> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ state: merchantBusinesses.state })
      .from(applications)
      .innerJoin(merchantBusinesses, eq(merchantBusinesses.id, applications.businessId))
      .where(eq(applications.id, applicationId))
      .limit(1),
  );
  if (!row?.state) throw new Error('cannot determine merchant jurisdiction');
  return row.state;
}
