/**
 * Connect Capital — Funding and fee accrual
 *
 * The end of the transaction and the start of the platform's revenue.
 *
 * A funding is recorded, not executed. The funder wires the merchant directly;
 * this writes down that it happened, accrues the fee against the schedule in
 * effect ON THE FUNDING DATE, and closes the application.
 */

import { and, eq, sql } from 'drizzle-orm';
import { fundings, feeSchedules, platformFees } from '../db/funding';
import { offers, offerRevisions } from '../db/offers';
import { applications } from '../db/merchant';
import { notifications } from '../db/messaging';
import { financingSignals } from '../db/banking';
import { feeForFunding, type FeeSchedule, type OriginationChannel } from './fees';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import { authorize, type Actor } from './policy';

export class FeeConfigurationGap extends Error {}

export interface ConfirmFundingInput {
  applicationId: string;
  offerRevisionId: string;
  fundedAmount: number;
  netDisbursed?: number;
  fundedAt: Date;
  contractRef?: string;
}

/**
 * The funder attesting that money moved. Fee accrual happens in the same
 * transaction — a funding recorded without its fee is revenue that exists only
 * in someone's memory.
 */
export async function confirmFunding(
  actor: Actor,
  input: ConfirmFundingInput,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ fundingId: string; feeAmount: number }> {
  authorize(actor, 'view', { kind: 'organization', id: actor.orgId });

  return mutate(
    actor,
    'update',
    {
      kind: 'offer',
      id: input.offerRevisionId,
      applicationId: input.applicationId,
      merchantOrgId: '',
      providerOrgId: actor.orgId,
    },
    {
      action: 'funding.confirmed',
      objectType: 'funding',
      applicationId: input.applicationId,
      metadata: { fundedAmount: input.fundedAmount },
    },
    ctx,
    async (tx) => {
      const [offer] = await tx
        .select({ id: offers.id, status: offers.status })
        .from(offers)
        .innerJoin(offerRevisions, eq(offerRevisions.offerId, offers.id))
        .where(
          and(
            eq(offerRevisions.id, input.offerRevisionId),
            eq(offers.providerOrgId, actor.orgId),
          ),
        )
        .limit(1);

      if (!offer) throw new Error('offer revision not found for this provider');
      if (offer.status !== 'accepted') {
        throw new Error('cannot fund an offer the merchant has not accepted');
      }

      const [app] = await tx
        .select({
          channel: applications.originationChannel,
          productType: applications.productType,
          createdBy: applications.createdByUserId,
          businessId: applications.businessId,
        })
        .from(applications)
        .where(eq(applications.id, input.applicationId))
        .limit(1);
      if (!app) throw new Error('application not found');

      const [funding] = await tx
        .insert(fundings)
        .values({
          applicationId: input.applicationId,
          offerRevisionId: input.offerRevisionId,
          providerOrgId: actor.orgId,
          fundedAmount: String(input.fundedAmount),
          netDisbursed: input.netDisbursed === undefined ? null : String(input.netDisbursed),
          fundedAt: input.fundedAt,
          confirmationSource: 'provider_attested',
          confirmedByUserId: actor.userId,
          contractRef: input.contractRef ?? null,
        })
        .returning({ id: fundings.id });

      const schedules = await loadSchedules(tx);
      const result = feeForFunding(
        schedules,
        {
          providerOrgId: actor.orgId,
          productType: app.productType,
          channel: app.channel as OriginationChannel,
          feeType: 'success',
          // The funding date, not today. Re-running this later must not
          // reprice a deal that already went out on an invoice.
          fundedAt: input.fundedAt,
        },
        input.fundedAmount,
      );

      if (!result.computed) {
        // Deliberately fatal. Recording a funding with no fee would mean
        // revenue quietly not accruing, which nobody notices until a
        // reconciliation months later.
        throw new FeeConfigurationGap(result.gap ?? 'no applicable fee schedule');
      }

      await tx.insert(platformFees).values({
        fundingId: funding.id,
        feeScheduleId: result.computed.scheduleId,
        basisAmount: String(result.computed.basisAmount),
        rateBps: result.computed.effectiveRateBps,
        feeAmount: String(result.computed.feeAmount),
        breakdownJson: result.computed.breakdown,
        status: 'accrued',
      });

      await tx
        .update(applications)
        .set({ status: 'funded', closedAt: new Date() })
        .where(eq(applications.id, input.applicationId));

      await tx.insert(notifications).values({
        userId: app.createdBy,
        applicationId: input.applicationId,
        type: 'funding.confirmed',
        title: 'Your funding is on the way',
        body: 'Let us know when it lands.',
        critical: true,
      });

      // Any open renewal or off-platform signal for this business is now
      // resolved — the platform originated this one and knows it.
      await tx
        .update(financingSignals)
        .set({ resolvedAt: new Date() })
        .where(
          and(
            eq(financingSignals.businessId, app.businessId),
            sql`${financingSignals.resolved_at} IS NULL`,
            sql`${financingSignals.signal_type} = 'renewal_eligible'`,
          ),
        );

      return { fundingId: funding.id, feeAmount: result.computed.feeAmount };
    },
  );
}

/**
 * The merchant confirming what actually arrived.
 *
 * Recorded alongside the funder's number, never replacing it. A gap between
 * them is usually a fee deducted at disbursement — real, explainable, and
 * exactly what a fee dispute turns on. Overwriting would discard the evidence.
 */
export async function merchantConfirmReceipt(
  actor: Actor,
  fundingId: string,
  amountReceived: number,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ discrepancy: number }> {
  const [funding] = await withActor(actor, (tx) =>
    tx.select().from(fundings).where(eq(fundings.id, fundingId)).limit(1),
  );
  if (!funding) throw new Error('funding not found');

  const discrepancy = Number(funding.fundedAmount) - amountReceived;

  await mutate(
    actor,
    'update',
    {
      kind: 'application',
      id: funding.applicationId,
      merchantOrgId: actor.orgId,
      status: 'funded',
    },
    {
      action: 'funding.merchant_confirmed',
      objectType: 'funding',
      objectId: fundingId,
      applicationId: funding.applicationId,
      metadata: { amountReceived, discrepancy },
    },
    ctx,
    async (tx) => {
      await tx
        .update(fundings)
        .set({
          merchantConfirmedAmount: String(amountReceived),
          merchantConfirmedAt: new Date(),
        })
        .where(eq(fundings.id, fundingId));
    },
  );

  return { discrepancy };
}

async function loadSchedules(tx: Tx): Promise<FeeSchedule[]> {
  const rows = await tx.select().from(feeSchedules);
  return rows.map((r) => ({
    id: r.id,
    providerOrgId: r.providerOrgId,
    productType: r.productType,
    channel: r.channel as OriginationChannel | null,
    feeType: r.feeType,
    rateBps: r.rateBps,
    minFee: r.minFee === null ? null : Number(r.minFee),
    maxFee: r.maxFee === null ? null : Number(r.maxFee),
    tiers: r.tiersJson ?? [],
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    agreementId: r.agreementId,
  }));
}

/** Accrued fees awaiting invoice, for the admin console. */
export async function accruedFees(actor: Actor) {
  authorize(actor, 'administer', { kind: 'platform_governance' });

  return withActor(actor, (tx) =>
    tx
      .select({
        feeId: platformFees.id,
        fundingId: platformFees.fundingId,
        providerOrgId: fundings.providerOrgId,
        basisAmount: platformFees.basisAmount,
        feeAmount: platformFees.feeAmount,
        fundedAt: fundings.fundedAt,
        status: platformFees.status,
      })
      .from(platformFees)
      .innerJoin(fundings, eq(fundings.id, platformFees.fundingId))
      .where(eq(platformFees.status, 'accrued'))
      .orderBy(fundings.fundedAt),
  );
}
