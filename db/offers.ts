/**
 * Connect Capital — M8 Offers schema
 *
 * ── NOTHING IS EVER OVERWRITTEN ────────────────────────────────────────────
 *
 * A revised offer is a new revision row. A counteroffer is its own row. The
 * merchant is promised a complete record of the negotiation, and a negotiation
 * where the earlier number can be edited is not a record — it is whatever the
 * last writer says happened.
 *
 * `disclosure_json` is frozen with its revision along with the ruleset version
 * and a hash. Two years from now the question will not be "what does this
 * offer disclose" but "what was this merchant shown, on what date, under which
 * rules." Only a frozen copy answers that.
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

export const offerStatusEnum = pgEnum('offer_status', [
  'draft',
  'submitted',
  'viewed',
  'countered',
  'revised',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
]);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    providerOrgId: uuid('provider_org_id').notNull().references(() => organizations.id),
    currentRevisionId: uuid('current_revision_id'),
    status: offerStatusEnum('status').notNull().default('draft'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index('offers_application_idx').on(t.applicationId, t.status),
    // One offer thread per funder per application. A second offer would
    // fragment the revision history the merchant is promised.
    uniqueThread: uniqueIndex('offers_unique_thread').on(t.applicationId, t.providerOrgId),
  }),
);

/** APPEND ONLY. */
export const offerRevisions = pgTable(
  'offer_revisions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    offerId: uuid('offer_id').notNull().references(() => offers.id),
    revisionNo: integer('revision_no').notNull(),
    supersedesRevisionId: uuid('supersedes_revision_id'),

    grossAmount: numeric('gross_amount', { precision: 14, scale: 2 }).notNull(),
    totalRepayment: numeric('total_repayment', { precision: 14, scale: 2 }).notNull(),
    paymentAmount: numeric('payment_amount', { precision: 14, scale: 2 }).notNull(),
    paymentFrequency: text('payment_frequency').notNull(),
    holdbackPercent: numeric('holdback_percent', { precision: 5, scale: 2 }),

    /**
     * Product-typed pricing. MCA carries a factor; a term loan carries a rate.
     * Keeping this in JSON rather than a `factor_rate` column is what makes the
     * schema financing-product agnostic without a migration per product.
     */
    pricingJson: jsonb('pricing_json').$type<Record<string, unknown>>().notNull(),
    feesJson: jsonb('fees_json').$type<Array<Record<string, unknown>>>(),
    conditionsText: text('conditions_text'),

    /** Frozen at creation. Never recomputed on read. */
    disclosureJson: jsonb('disclosure_json').$type<Record<string, unknown>>().notNull(),
    disclosureRulesetVersion: text('disclosure_ruleset_version').notNull(),
    disclosureMethodVersion: text('disclosure_method_version').notNull(),
    disclosureHash: text('disclosure_hash').notNull(),
    jurisdiction: text('jurisdiction').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    revisionIdx: uniqueIndex('offer_revisions_revision_idx').on(t.offerId, t.revisionNo),
  }),
);

/**
 * APPEND ONLY. What the merchant actually saw, and when.
 *
 * Separate from the revision because a revision that was never opened is not a
 * disclosure. "We disclosed it" and "they saw it" are different claims, and
 * only one of them is defensible.
 */
export const disclosureViews = pgTable(
  'disclosure_views',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    offerRevisionId: uuid('offer_revision_id').notNull().references(() => offerRevisions.id),
    viewedByUserId: uuid('viewed_by_user_id').notNull().references(() => users.id),
    /** Hash of what was rendered, not of what was stored. */
    renderedHash: text('rendered_hash').notNull(),
    surface: text('surface').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ revisionIdx: index('disclosure_views_revision_idx').on(t.offerRevisionId, t.at) }),
);

/** APPEND ONLY. The merchant negotiating in their own voice. */
export const counteroffers = pgTable(
  'counteroffers',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    offerId: uuid('offer_id').notNull().references(() => offers.id),
    fromRevisionId: uuid('from_revision_id').notNull().references(() => offerRevisions.id),
    merchantUserId: uuid('merchant_user_id').notNull().references(() => users.id),
    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }),
    requestedPricingJson: jsonb('requested_pricing_json').$type<Record<string, unknown>>(),
    requestedFrequency: text('requested_frequency'),
    requestedTermDays: integer('requested_term_days'),
    message: text('message'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ offerIdx: index('counteroffers_offer_idx').on(t.offerId, t.createdAt) }),
);

/**
 * A merchant asking every authorized funder to sharpen their pencil at once.
 *
 * This is how competitive pressure reaches a blind marketplace: funders never
 * see each other's terms, but they know they are one of N and that the
 * merchant just asked all N.
 */
export const bestAndFinalRequests = pgTable('best_and_final_requests', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  providerCount: integer('provider_count').notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** APPEND ONLY. */
export const offerEvents = pgTable(
  'offer_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    offerId: uuid('offer_id').notNull().references(() => offers.id),
    revisionId: uuid('revision_id').references(() => offerRevisions.id),
    event: text('event').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ offerIdx: index('offer_events_offer_idx').on(t.offerId, t.at) }),
);

export type Offer = typeof offers.$inferSelect;
export type OfferRevision = typeof offerRevisions.$inferSelect;
