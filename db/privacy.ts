/**
 * CapNet — Privacy and compliance schema (0010)
 *
 * State vs evidence, per the house rule:
 *  - email_preferences, data_deletion_requests — STATE (current answer)
 *  - email_suppression_events, data_deletion_events — EVIDENCE (append-only;
 *    REVOKE UPDATE, DELETE in migrations/0010_privacy_compliance.sql)
 *
 * The state row says what is true now; the event table says who changed it,
 * when, and how. "Did they unsubscribe before we sent that?" is answered from
 * events, never from the current flag.
 */

import { pgTable, pgEnum, text, boolean, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './kernel';

export const deletionStatusEnum = pgEnum('deletion_status', [
  'requested', 'verified', 'blocked', 'completed', 'rejected',
]);

export const emailPreferences = pgTable('email_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  marketing: boolean('marketing').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailSuppressionEvents = pgTable(
  'email_suppression_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id').notNull().references(() => users.id),
    category: text('category').notNull(),
    action: text('action').notNull(), // 'unsubscribe' | 'resubscribe'
    source: text('source').notNull(), // 'one_click' | 'link' | 'settings' | 'support'
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({ userIdx: index('email_suppression_events_user_idx').on(t.userId, t.occurredAt) }),
);

export const dataDeletionRequests = pgTable('data_deletion_requests', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  status: deletionStatusEnum('status').notNull().default('requested'),
  blockedReason: text('blocked_reason'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const dataDeletionEvents = pgTable(
  'data_deletion_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    requestId: uuid('request_id').notNull().references(() => dataDeletionRequests.id),
    fromStatus: deletionStatusEnum('from_status'),
    toStatus: deletionStatusEnum('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** The DeletionPlan at execution time — what was erased, kept, and why. */
    planJson: text('plan_json'),
    note: text('note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ reqIdx: index('data_deletion_events_request_idx').on(t.requestId, t.occurredAt) }),
);
