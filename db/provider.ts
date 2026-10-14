/**
 * CapNet — M2 Provider schema
 *
 * Three things in this file are load-bearing beyond the obvious.
 *
 * REGISTRATIONS gate matching by jurisdiction. Several states now require
 * providers — and brokers — of sales-based financing to register, on staggered
 * effective dates. A provider without a live registration in the merchant's
 * state must be suppressed from matching there, and that has to be data the
 * platform can act on rather than a spreadsheet someone maintains.
 *
 * APPETITE is separate from criteria on purpose. Criteria are what a funder
 * buys; appetite is what they're buying THIS WEEK. Good brokers win on exactly
 * this knowledge — who just raised syndication capital, who is off restaurants
 * until Q4. A static criteria table goes stale within a month and the failure
 * looks like the matching engine being bad rather than the data being old.
 *
 * DECLINE REASON CODES are not only a merchant-transparency feature. They are
 * the routing key for the platform's primary acquisition channel: funders
 * route their fit-declines here, and fit vs. credit is the difference between
 * high-intent free demand and unfundable noise.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations } from './kernel';
import { productTypeEnum } from './merchant';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const verificationStatusEnum = pgEnum('verification_status', [
  'unverified',
  'pending',
  'verified',
  'suspended',
  'offboarded',
]);

export const criterionOperatorEnum = pgEnum('criterion_operator', [
  'gte',
  'lte',
  'eq',
  'in',
  'not_in',
  'between',
]);

/**
 * Fit declines are fundable by someone else — wrong industry, wrong state,
 * amount outside the band, too many positions. Credit declines mostly are not.
 * Routing all declines indiscriminately fills the marketplace with files
 * professionals already refused; routing fit declines fills it with merchants
 * who simply knocked on the wrong door.
 */
export const declineCategoryEnum = pgEnum('decline_category', [
  'fit',
  'credit',
  'fraud',
  'compliance',
]);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    orgId: uuid('org_id').notNull().unique().references(() => organizations.id),
    legalName: text('legal_name').notNull(),
    website: text('website'),
    verificationStatus: verificationStatusEnum('verification_status')
      .notNull()
      .default('unverified'),
    /**
     * Vendor reference for the KYB check. A CHECK constraint in 0003 makes
     * 'verified' impossible without one — the badge is the product, and a
     * badge that can be set by hand is decoration.
     */
    kybRef: text('kyb_ref'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    participationAgreementId: uuid('participation_agreement_id'),
    /** Set on offboarding. Never blank when status is suspended or offboarded. */
    statusReason: text('status_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('providers_status_idx').on(t.verificationStatus) }),
);

export const providerRegistrations = pgTable(
  'provider_registrations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    jurisdiction: text('jurisdiction').notNull(),
    registrationType: text('registration_type').notNull(),
    registrationNumber: text('registration_number'),
    status: text('status').notNull().default('active'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('provider_registrations_lookup_idx').on(
      t.providerId,
      t.jurisdiction,
      t.status,
    ),
  }),
);

export const providerProducts = pgTable(
  'provider_products',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    productType: productTypeEnum('product_type').notNull(),
    minAmount: numeric('min_amount', { precision: 14, scale: 2 }).notNull(),
    maxAmount: numeric('max_amount', { precision: 14, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({ providerIdx: index('provider_products_provider_idx').on(t.providerId, t.active) }),
);

/**
 * Criteria are rows, not columns. A funder who wants "no more than 2 open
 * positions unless revenue is above $80k" should not require a migration, and
 * `effectiveFrom` means a historical match stays replayable — when a funder
 * asks why they didn't see a deal last month, the answer is reconstructable.
 */
export const providerCriteria = pgTable(
  'provider_criteria',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    productId: uuid('product_id').references(() => providerProducts.id),
    criterionKey: text('criterion_key').notNull(),
    operator: criterionOperatorEnum('operator').notNull(),
    valueJson: jsonb('value_json').notNull(),
    /** Hard criteria exclude. Soft criteria only lower the match score. */
    isHard: boolean('is_hard').notNull().default(true),
    weight: integer('weight').notNull().default(1),
    /**
     * When true, self-reported numbers cannot satisfy this criterion — only
     * bank-derived metrics. Lets a funder say "I'll take stated revenue up to
     * $150k, above that I need it verified."
     */
    requiresVerified: boolean('requires_verified').notNull().default(false),
    active: boolean('active').notNull().default(true),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
  },
  (t) => ({
    providerIdx: index('provider_criteria_provider_idx').on(t.providerId, t.active),
  }),
);

/**
 * One toggle a funder can flip in five seconds. Cheap to build, and it
 * addresses the single largest source of stale-match complaints.
 */
export const providerAppetite = pgTable(
  'provider_appetite',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    accepting: boolean('accepting').notNull().default(true),
    pausedIndustriesJson: jsonb('paused_industries_json').$type<string[]>(),
    pausedStatesJson: jsonb('paused_states_json').$type<string[]>(),
    capacityNote: text('capacity_note'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ providerIdx: uniqueIndex('provider_appetite_provider_idx').on(t.providerId) }),
);

export const providerDocRequirements = pgTable(
  'provider_doc_requirements',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    docType: text('doc_type').notNull(),
    requiredAtStage: text('required_at_stage').notNull().default('underwriting'),
  },
  (t) => ({ providerIdx: index('provider_doc_req_provider_idx').on(t.providerId) }),
);

// ---------------------------------------------------------------------------
// Decline taxonomy — merchant transparency AND acquisition routing
// ---------------------------------------------------------------------------

export const declineReasonCodes = pgTable('decline_reason_codes', {
  code: text('code').primaryKey(),
  category: declineCategoryEnum('category').notNull(),
  /** Internal label, shown to funders. */
  label: text('label').notNull(),
  /** Shown to the merchant. Never a raw underwriting note. */
  merchantFacingLabel: text('merchant_facing_label').notNull(),
  /** What would change the answer. Powers the remediation track. */
  remediationHint: text('remediation_hint'),
  /**
   * Whether a merchant declined for this reason should be routed into the
   * marketplace. Fit reasons: yes. Credit: remediation track. Fraud and
   * compliance: never — blocked before matching.
   */
  routable: boolean('routable').notNull(),
});

/**
 * Per-provider referral link for decline routing. The funder messages the
 * MERCHANT with this link; no merchant data crosses until the merchant
 * registers here themselves. Ingesting files the merchant never sent would
 * make the platform's founding promise false at the front door.
 */
export const providerReferralLinks = pgTable(
  'provider_referral_links',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    token: text('token').notNull().unique(),
    label: text('label'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ providerIdx: index('provider_referral_links_provider_idx').on(t.providerId) }),
);

/** APPEND ONLY. Every verification decision, with its reason. */
export const verificationEvents = pgTable(
  'verification_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    fromStatus: verificationStatusEnum('from_status'),
    toStatus: verificationStatusEnum('to_status').notNull(),
    /** Required. There is no silent approval and no silent offboarding. */
    reason: text('reason').notNull(),
    kybRef: text('kyb_ref'),
    kybSummaryJson: jsonb('kyb_summary_json').$type<Record<string, unknown>>(),
    decidedByUserId: uuid('decided_by_user_id').notNull().references(() => users.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ providerIdx: index('verification_events_provider_idx').on(t.providerId, t.at) }),
);

export type Provider = typeof providers.$inferSelect;
export type ProviderCriterion = typeof providerCriteria.$inferSelect;
export type DeclineReasonCode = typeof declineReasonCodes.$inferSelect;
