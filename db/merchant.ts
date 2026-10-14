/**
 * CapNet — M1 Merchant schema
 *
 * Two structural commitments live in this file.
 *
 * PRE-QUALIFICATION BEFORE DOCUMENTS. A cold merchant will not hand over bank
 * statements to a platform they have never heard of. They give a few facts,
 * see which funders would likely fund them and why, and only then upload
 * anything. `prequal_snapshots` is the top of that funnel and it exists as its
 * own table because the conversion rate from prequal to application is the
 * single most important number in merchant acquisition.
 *
 * FINANCIAL PROFILE IS SOURCE-AGNOSTIC. Bank connection is the preferred path
 * and document upload is the fallback, but both must produce the SAME
 * normalized record. If they do not, matching runs against two classes of
 * merchant and the fallback becomes a second-class experience.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations, consents } from './kernel';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const applicationStatusEnum = pgEnum('application_status', [
  'draft',
  'submitted',
  'matching',
  'authorizing',
  'in_underwriting',
  'offers_received',
  'negotiating',
  'accepted',
  'funded',
  'withdrawn',
  'expired',
  'declined',
  /** Credit-decline remediation track. Not "no" — "not yet". */
  'not_fundable_yet',
]);

export const productTypeEnum = pgEnum('product_type', [
  'mca',
  'business_loc',
  'equipment_finance',
  'revenue_based',
  'term_loan',
  'sba',
]);

export const financialSourceEnum = pgEnum('financial_source', [
  'bank_link',
  'statement_parse',
  'manual',
]);

export const obligationSourceEnum = pgEnum('obligation_source', [
  'merchant_stated',
  'bank_detected',
  'provider_reported',
]);

export const originationChannelEnum = pgEnum('origination_channel', [
  'self_serve',
  'specialist_assisted',
  'funder_referral',
  'partner',
]);

// ---------------------------------------------------------------------------
// Business & owners
// ---------------------------------------------------------------------------

export const merchantBusinesses = pgTable(
  'merchant_businesses',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    legalName: text('legal_name').notNull(),
    dba: text('dba'),
    entityType: text('entity_type'),
    /** Vault reference. Never the raw EIN. */
    einToken: text('ein_token'),
    naicsCode: text('naics_code'),
    industryLabel: text('industry_label'),
    state: text('state').notNull(),
    /** County or metro. Enough for geographic risk without a street address. */
    locality: text('locality'),
    addressJson: jsonb('address_json').$type<Record<string, string>>(),
    website: text('website'),
    inceptionDate: date('inception_date'),
    kybStatus: text('kyb_status').notNull().default('unverified'),
    kybVendorRef: text('kyb_vendor_ref'),
    kybCheckedAt: timestamp('kyb_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('merchant_businesses_org_idx').on(t.orgId),
    /**
     * Salted hash of the normalized legal name + state. Lets a funder ask
     * "is this merchant already in my pipeline or on my exclusion list?"
     * by exchanging hashes — the legitimate identity need at triage,
     * answered without disclosing identity.
     */
    identityHashIdx: index('merchant_businesses_identity_hash_idx').on(
      sql`encode(digest(lower(${t.legalName}) || ${t.state}, 'sha256'), 'hex')`,
    ),
  }),
);

export const merchantOwners = pgTable(
  'merchant_owners',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    fullName: text('full_name').notNull(),
    ownershipPct: numeric('ownership_pct', { precision: 5, scale: 2 }),
    /** Vault references only. Raw SSN and DOB never touch this database. */
    ssnToken: text('ssn_token'),
    dobToken: text('dob_token'),
    addressJson: jsonb('address_json').$type<Record<string, string>>(),
    /**
     * Self-reported band, used for matching only. CapNet does not
     * pull credit and redistribute it — each authorized funder pulls its own
     * under its own permissible purpose. See B.3.3 (FCRA).
     */
    selfReportedCreditBand: text('self_reported_credit_band'),
    fcraConsentId: uuid('fcra_consent_id').references(() => consents.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ businessIdx: index('merchant_owners_business_idx').on(t.businessId) }),
);

// ---------------------------------------------------------------------------
// Pre-qualification — the top of the funnel
// ---------------------------------------------------------------------------

/**
 * Captured before any document or bank connection. Self-reported, unverified,
 * and explicitly labelled as such wherever a match preview derived from it is
 * shown. A preview is not an offer and must never be presented as one.
 */
export const prequalSnapshots = pgTable(
  'prequal_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    /** Null until the visitor registers — prequal precedes account creation. */
    orgId: uuid('org_id').references(() => organizations.id),
    sessionToken: text('session_token').notNull(),
    productType: productTypeEnum('product_type').notNull().default('mca'),
    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }),
    statedMonthlyRevenue: numeric('stated_monthly_revenue', { precision: 14, scale: 2 }),
    statedTimeInBusinessMonths: integer('stated_time_in_business_months'),
    state: text('state'),
    naicsCode: text('naics_code'),
    statedCreditBand: text('stated_credit_band'),
    statedPositionCount: integer('stated_position_count'),
    /** Set when the visitor goes on to create a real application. */
    convertedApplicationId: uuid('converted_application_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: uniqueIndex('prequal_session_idx').on(t.sessionToken),
    conversionIdx: index('prequal_conversion_idx').on(t.convertedApplicationId),
  }),
);

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    productType: productTypeEnum('product_type').notNull().default('mca'),
    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }).notNull(),
    useOfFunds: text('use_of_funds'),
    preferredFrequency: text('preferred_frequency'),
    status: applicationStatusEnum('status').notNull().default('draft'),
    grade: text('grade'),
    rulesetVersion: text('ruleset_version'),
    prequalSnapshotId: uuid('prequal_snapshot_id').references(() => prequalSnapshots.id),

    /**
     * R14 — set once at creation, never updated. The dual-channel economics
     * and every acquisition-cost question depend on this being trustworthy.
     * Enforced by trigger in 0002.
     */
    originationChannel: originationChannelEnum('origination_channel')
      .notNull()
      .default('self_serve'),
    /** Which funder's decline routing produced this merchant, if any. */
    referringProviderOrgId: uuid('referring_provider_org_id').references(
      () => organizations.id,
    ),
    referralToken: text('referral_token'),

    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    businessStatusIdx: index('applications_business_status_idx').on(t.businessId, t.status),
    pipelineIdx: index('applications_pipeline_idx').on(t.status, t.submittedAt),
    referralIdx: index('applications_referral_idx').on(t.referringProviderOrgId),
  }),
);

// ---------------------------------------------------------------------------
// Financial profile
// ---------------------------------------------------------------------------

/**
 * The normalized underwriting record. Bank link and parsed statements both
 * land here in the same shape. `confidence` is what lets a provider criterion
 * say "I require verified metrics above $150k" without the matching engine
 * needing to know where the numbers came from.
 */
export const financialProfiles = pgTable(
  'financial_profiles',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    source: financialSourceEnum('source').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    monthsCovered: integer('months_covered'),
    avgMonthlyRevenue: numeric('avg_monthly_revenue', { precision: 14, scale: 2 }),
    avgDailyBalance: numeric('avg_daily_balance', { precision: 14, scale: 2 }),
    negativeDays: integer('negative_days'),
    nsfCount: integer('nsf_count'),
    depositCount: integer('deposit_count'),
    /** 'verified' for bank_link, 'parsed' for statements, 'stated' for manual. */
    confidence: text('confidence').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index('financial_profiles_app_idx').on(t.applicationId, t.computedAt),
  }),
);

export const existingObligations = pgTable(
  'existing_obligations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    funderName: text('funder_name'),
    obligationType: text('obligation_type'),
    originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
    currentBalance: numeric('current_balance', { precision: 14, scale: 2 }),
    paymentAmount: numeric('payment_amount', { precision: 14, scale: 2 }),
    frequency: text('frequency'),
    position: integer('position'),
    source: obligationSourceEnum('source').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ appIdx: index('existing_obligations_app_idx').on(t.applicationId) }),
);

export type MerchantBusiness = typeof merchantBusinesses.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type FinancialProfile = typeof financialProfiles.$inferSelect;
export type PrequalSnapshot = typeof prequalSnapshots.$inferSelect;
