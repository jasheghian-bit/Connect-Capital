/**
 * CapNet — M9 Funding and fees schema
 *
 * ── THE PLATFORM DOES NOT TOUCH THE MONEY ──────────────────────────────────
 *
 * The funder wires the merchant directly. CapNet records that it
 * happened and invoices its fee. That single decision removes money
 * transmitter licensing in roughly fifty jurisdictions, and it is a product
 * choice rather than a gap — nothing in this file moves funds.
 *
 * ── CONFIRMATION IS MULTI-SOURCE ON PURPOSE ────────────────────────────────
 *
 * The funder says they funded $120,000. The merchant says $117,500 arrived.
 * Both are usually telling the truth — the difference is a fee deducted at
 * disbursement. Storing one number and calling it "the" funded amount
 * discards the discrepancy, and the discrepancy is exactly what a fee dispute
 * turns on. So both are recorded, and a gap raises a flag rather than
 * overwriting anything.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations } from './kernel';
import { applications } from './merchant';
import { offerRevisions } from './offers';

export const feeTypeEnum = pgEnum('fee_type', ['success', 'subscription', 'specialist', 'data']);

export const feeStatusEnum = pgEnum('fee_status', [
  'accrued',
  'invoiced',
  'paid',
  'waived',
  'disputed',
]);

export const confirmationSourceEnum = pgEnum('funding_confirmation_source', [
  'provider_attested',
  'merchant_confirmed',
  'bank_verified',
]);

export const fundings = pgTable(
  'fundings',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    offerRevisionId: uuid('offer_revision_id').notNull().references(() => offerRevisions.id),
    providerOrgId: uuid('provider_org_id').notNull().references(() => organizations.id),

    /** What the funder says they advanced. The fee basis. */
    fundedAmount: numeric('funded_amount', { precision: 14, scale: 2 }).notNull(),
    /** What actually landed, net of anything deducted at disbursement. */
    netDisbursed: numeric('net_disbursed', { precision: 14, scale: 2 }),
    /** What the merchant says arrived. Recorded, never used to overwrite. */
    merchantConfirmedAmount: numeric('merchant_confirmed_amount', { precision: 14, scale: 2 }),

    fundedAt: timestamp('funded_at', { withTimezone: true }).notNull(),
    confirmationSource: confirmationSourceEnum('confirmation_source').notNull(),
    confirmedByUserId: uuid('confirmed_by_user_id').notNull().references(() => users.id),
    merchantConfirmedAt: timestamp('merchant_confirmed_at', { withTimezone: true }),
    /** Funder's own contract reference. The platform never holds the paper. */
    contractRef: text('contract_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One funding per application. A renewal is a new application, not a
    // second funding on the old one — otherwise the fee basis is ambiguous.
    uniqueFunding: uniqueIndex('fundings_unique_application').on(t.applicationId),
    providerIdx: index('fundings_provider_idx').on(t.providerOrgId, t.fundedAt),
  }),
);

/**
 * R6. The rate lives here, effective-dated, with an agreement behind it.
 * Never a constant in code — see lib/fees.ts.
 */
export const feeSchedules = pgTable(
  'fee_schedules',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    /** null = platform default. */
    providerOrgId: uuid('provider_org_id').references(() => organizations.id),
    productType: text('product_type'),
    channel: text('channel'),
    feeType: feeTypeEnum('fee_type').notNull().default('success'),
    rateBps: integer('rate_bps').notNull(),
    minFee: numeric('min_fee', { precision: 14, scale: 2 }),
    maxFee: numeric('max_fee', { precision: 14, scale: 2 }),
    /** Marginal bands, like tax brackets. Empty = flat rateBps. */
    tiersJson: jsonb('tiers_json').$type<Array<{ upToAmount: number | null; rateBps: number }>>(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    agreementId: uuid('agreement_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('fee_schedules_lookup_idx').on(t.feeType, t.providerOrgId, t.effectiveFrom),
  }),
);

export const platformFees = pgTable(
  'platform_fees',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    fundingId: uuid('funding_id').notNull().references(() => fundings.id),
    feeScheduleId: uuid('fee_schedule_id').notNull().references(() => feeSchedules.id),
    basisAmount: numeric('basis_amount', { precision: 14, scale: 2 }).notNull(),
    rateBps: integer('rate_bps').notNull(),
    feeAmount: numeric('fee_amount', { precision: 14, scale: 2 }).notNull(),
    /** Band-by-band, frozen. The invoice line items. */
    breakdownJson: jsonb('breakdown_json').$type<Array<Record<string, unknown>>>(),
    status: feeStatusEnum('status').notNull().default('accrued'),
    invoiceRef: text('invoice_ref'),
    accruedAt: timestamp('accrued_at', { withTimezone: true }).notNull().defaultNow(),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    disputeNote: text('dispute_note'),
  },
  (t) => ({
    fundingIdx: uniqueIndex('platform_fees_funding_idx').on(t.fundingId),
    statusIdx: index('platform_fees_status_idx').on(t.status, t.accruedAt),
  }),
);

export type Funding = typeof fundings.$inferSelect;
export type PlatformFee = typeof platformFees.$inferSelect;
