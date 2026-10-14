/**
 * CapNet — M3 Matching and authorization schema
 *
 * `authorizations` is the most important table in the database. Everything the
 * platform claims to a merchant reduces to a row here: who may see the file,
 * what they may see, and whether that is still true right now.
 *
 * `match_runs` stores the inputs alongside the ruleset version. When a funder
 * asks why they didn't see a deal, the answer is reconstructed rather than
 * guessed — and that question gets asked in every funder relationship
 * eventually, usually in a tense meeting.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations, consents } from './kernel';
import { applications } from './merchant';
import { providers } from './provider';

export const matchResultEnum = pgEnum('match_result', [
  'match',
  'possible',
  'no_match',
]);

export const authorizationStatusEnum = pgEnum('authorization_status', [
  'active',
  'revoked',
  'expired',
]);

export const matchRuns = pgTable(
  'match_runs',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    rulesetVersion: text('ruleset_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    grade: text('grade'),
    gradeScore: integer('grade_score'),
    /** Full applicant profile as evaluated. Makes the run replayable. */
    inputsSnapshotJson: jsonb('inputs_snapshot_json').notNull(),
    gradeFactorsJson: jsonb('grade_factors_json'),
    providersEvaluated: integer('providers_evaluated').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ appIdx: index('match_runs_app_idx').on(t.applicationId, t.createdAt) }),
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    matchRunId: uuid('match_run_id').notNull().references(() => matchRuns.id),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    result: matchResultEnum('result').notNull(),
    score: integer('score').notNull().default(0),
    /** Per-criterion outcomes, already phrased for the merchant. */
    reasonsJson: jsonb('reasons_json').notNull(),
    /**
     * Set when a provider was excluded for a reason unrelated to fit —
     * appetite paused, registration missing in the merchant's state,
     * verification lapsed. Distinct from a criteria failure because the
     * remedy is completely different and the funder needs to know which.
     */
    suppressedReason: text('suppressed_reason'),
    /** Provider clicked "interested" on the blinded card. */
    providerInterestedAt: timestamp('provider_interested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appResultIdx: index('matches_app_result_idx').on(t.applicationId, t.result),
    providerQueueIdx: index('matches_provider_queue_idx').on(t.providerId, t.createdAt),
  }),
);

/**
 * The grant. Scoped, revocable, expiring, and unique while active.
 *
 * `scopeJson.rawDocuments` defaults false — derived metrics only. Raw statement
 * PDFs require a second, explicit consent, because a raw statement carries the
 * account number, routing number, and the merchant's entire customer and
 * vendor list, none of which is needed to price an advance.
 */
export const authorizations = pgTable(
  'authorizations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    providerId: uuid('provider_id').notNull().references(() => providers.id),
    providerOrgId: uuid('provider_org_id').notNull().references(() => organizations.id),
    grantedByUserId: uuid('granted_by_user_id').notNull().references(() => users.id),
    /**
     * R11. When a Funding Specialist staged the grant, this records who. The
     * merchant still confirmed it from their own session — the grant itself is
     * always theirs. Null on a self-serve authorization.
     */
    stagedBySpecialistUserId: uuid('staged_by_specialist_user_id').references(() => users.id),
    status: authorizationStatusEnum('status').notNull().default('active'),
    scopeJson: jsonb('scope_json')
      .$type<{
        profile: boolean;
        financialSummary: boolean;
        documents: string[];
        rawDocuments: boolean;
      }>()
      .notNull(),
    consentId: uuid('consent_id').notNull().references(() => consents.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => ({
    activeGrantIdx: uniqueIndex('authorizations_active_idx')
      .on(t.applicationId, t.providerId)
      .where(sql`status = 'active'`),
    appIdx: index('authorizations_app_idx').on(t.applicationId, t.status),
    providerIdx: index('authorizations_provider_idx').on(t.providerOrgId, t.status),
  }),
);

/** APPEND ONLY. Powers the merchant's Access Center timeline. */
export const authorizationEvents = pgTable(
  'authorization_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    authorizationId: uuid('authorization_id').notNull().references(() => authorizations.id),
    event: text('event').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ authIdx: index('authorization_events_auth_idx').on(t.authorizationId, t.at) }),
);

/**
 * A merchant's report that an authorized funder contacted them outside the
 * platform. Turns every merchant into a sensor — far more effective than
 * inferring leakage from access logs, because a phone call leaves no trace
 * in any system CapNet controls.
 */
export const offPlatformContactReports = pgTable(
  'off_platform_contact_reports',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    reportedByUserId: uuid('reported_by_user_id').notNull().references(() => users.id),
    applicationId: uuid('application_id').references(() => applications.id),
    /** Null when the merchant doesn't know who called. Still worth recording. */
    allegedProviderId: uuid('alleged_provider_id').references(() => providers.id),
    channel: text('channel').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    notes: text('notes'),
    status: text('status').notNull().default('open'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index('off_platform_reports_provider_idx').on(t.allegedProviderId, t.status),
  }),
);

export type Authorization = typeof authorizations.$inferSelect;
export type Match = typeof matches.$inferSelect;
