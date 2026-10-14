/**
 * CapNet — M5 Banking schema
 *
 * ── WHAT IS DELIBERATELY NOT STORED ────────────────────────────────────────
 *
 * Bank credentials. Ever. The aggregator holds them; the platform holds an
 * item token that can be revoked and is worthless on its own. `lib/session.ts`
 * has the same rule for a different reason, and both exist because the safest
 * secret is one you never possessed.
 *
 * Raw transactions are stored, and that deserves justification rather than
 * assumption: position detection, paydown tracking, and re-eligibility all
 * require re-running analysis over history as the heuristics improve. Storing
 * only derived metrics means every rule change is blind going forward and
 * useless going backward. The trade is a larger sensitive-data footprint,
 * which is why transactions carry their own retention policy and never leave
 * the platform — a funder sees `financial_profiles`, never this table.
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
import { users, consents } from './kernel';
import { merchantBusinesses, applications } from './merchant';
import { providers } from './provider';

export const connectionStatusEnum = pgEnum('bank_connection_status', [
  'pending',
  'active',
  'reauth_required',
  'revoked',
  'error',
]);

export const signalTypeEnum = pgEnum('financing_signal_type', [
  'active_application',
  'detected_position',
  'recent_funding',
  'renewal_eligible',
  'off_platform_funding_suspected',
  're_eligible',
]);

export const bankConnections = pgTable(
  'bank_connections',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    aggregator: text('aggregator').notNull(),
    /** Revocable handle held by the aggregator. Never a credential. */
    itemToken: text('item_token').notNull(),
    institutionName: text('institution_name'),
    status: connectionStatusEnum('status').notNull().default('pending'),
    /**
     * Required. A bank connection without a consent artifact is a connection
     * nobody can prove the merchant agreed to.
     */
    consentId: uuid('consent_id').notNull().references(() => consents.id),
    connectedByUserId: uuid('connected_by_user_id').notNull().references(() => users.id),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => ({ businessIdx: index('bank_connections_business_idx').on(t.businessId, t.status) }),
);

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    connectionId: uuid('connection_id').notNull().references(() => bankConnections.id),
    aggregatorAccountId: text('aggregator_account_id').notNull(),
    /** Last four only. The full number is never needed and never stored. */
    mask: text('mask'),
    name: text('name'),
    subtype: text('subtype'),
    currentBalance: numeric('current_balance', { precision: 14, scale: 2 }),
    /** Merchant picks which accounts count as the operating account. */
    includedInAnalysis: boolean('included_in_analysis').notNull().default(true),
  },
  (t) => ({
    connIdx: index('bank_accounts_connection_idx').on(t.connectionId),
    uniqueAcct: uniqueIndex('bank_accounts_unique').on(t.connectionId, t.aggregatorAccountId),
  }),
);

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    accountId: uuid('account_id').notNull().references(() => bankAccounts.id),
    aggregatorTxId: text('aggregator_tx_id').notNull(),
    postedDate: date('posted_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    balanceAfter: numeric('balance_after', { precision: 14, scale: 2 }),
    category: text('category'),
    /** Cached classification so a re-run can compare against the old answer. */
    isRevenueDeposit: boolean('is_revenue_deposit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountDateIdx: index('bank_transactions_account_date_idx').on(t.accountId, t.postedDate),
    dedupeIdx: uniqueIndex('bank_transactions_dedupe_idx').on(t.accountId, t.aggregatorTxId),
  }),
);

/**
 * Positions detected from the transaction stream, kept separate from
 * `existing_obligations` until the merchant confirms them.
 *
 * A detection is a hypothesis. Telling a funder a merchant is stacked when
 * they are not costs that merchant an approval, so detections are surfaced to
 * the merchant for confirmation and only then promoted.
 */
export const detectedPositions = pgTable(
  'detected_positions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    counterparty: text('counterparty').notNull(),
    paymentAmount: numeric('payment_amount', { precision: 14, scale: 2 }).notNull(),
    frequency: text('frequency').notNull(),
    occurrences: integer('occurrences').notNull(),
    firstSeen: date('first_seen').notNull(),
    lastSeen: date('last_seen').notNull(),
    totalPaid: numeric('total_paid', { precision: 14, scale: 2 }),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    inferredAdvanceAmount: numeric('inferred_advance_amount', { precision: 14, scale: 2 }),
    inferredAdvanceDate: date('inferred_advance_date'),
    impliedFactor: numeric('implied_factor', { precision: 4, scale: 2 }),
    paydownProgress: numeric('paydown_progress', { precision: 3, scale: 2 }),
    /** null = unreviewed, true = merchant confirmed, false = merchant denied. */
    merchantConfirmed: boolean('merchant_confirmed'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ businessIdx: index('detected_positions_business_idx').on(t.businessId, t.detectedAt) }),
);

/**
 * Cross-cutting intelligence. Stacking risk, renewal windows, suspected
 * off-platform fundings, and re-eligibility all land here so trust & safety
 * and the re-engagement job read one table instead of six.
 */
export const financingSignals = pgTable(
  'financing_signals',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    applicationId: uuid('application_id').references(() => applications.id),
    signalType: signalTypeEnum('signal_type').notNull(),
    providerId: uuid('provider_id').references(() => providers.id),
    source: text('source').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    businessIdx: index('financing_signals_business_idx').on(t.businessId, t.signalType),
    openIdx: index('financing_signals_open_idx').on(t.signalType, t.resolvedAt),
  }),
);

export type BankConnection = typeof bankConnections.$inferSelect;
export type FinancingSignal = typeof financingSignals.$inferSelect;
