/**
 * Connect Capital — M6/M7 Messaging and underwriting schema
 *
 * ── NOTIFICATIONS ARE SAFETY-CRITICAL HERE ─────────────────────────────────
 *
 * In most products a missed notification is an annoyance. On this platform the
 * merchant has been told their authorized funders will reach them here, so any
 * other call can be ignored. If a notification fails and they miss an offer
 * expiring, the promise breaks in the worst possible way — they ignored their
 * phone because we told them to.
 *
 * So `notifications` carries delivery confirmation per channel and an
 * escalation timestamp, and critical notifications that go unread escalate.
 * That is why this table is more than a bell icon.
 */

import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations } from './kernel';
import { applications } from './merchant';
import { documentVersions } from './documents';

export const conversationTypeEnum = pgEnum('conversation_type', [
  'merchant_provider',
  'merchant_specialist',
  'specialist_provider',
]);

export const underwritingStatusEnum = pgEnum('underwriting_status', [
  'not_started',
  'reviewing',
  'pending_docs',
  'pending_conditions',
  'approved',
  'declined',
  'withdrawn',
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'email',
  'sms',
  'push',
]);

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    type: conversationTypeEnum('type').notNull(),
    providerOrgId: uuid('provider_org_id').references(() => organizations.id),
    specialistUserId: uuid('specialist_user_id').references(() => users.id),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One thread per application per counterparty. Multiple threads with the
    // same funder would fragment the record the merchant is promised.
    uniqueThread: uniqueIndex('conversations_unique_thread').on(
      t.applicationId,
      t.type,
      t.providerOrgId,
    ),
    appIdx: index('conversations_app_idx').on(t.applicationId),
  }),
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (t) => ({
    convIdx: index('conversation_participants_conv_idx').on(t.conversationId),
    userIdx: index('conversation_participants_user_idx').on(t.userId, t.removedAt),
  }),
);

/**
 * APPEND ONLY. Redaction sets a timestamp; it never removes the row.
 *
 * The merchant is promised a complete record of the conversation. A message
 * that can be deleted after the fact makes that record an assertion, and the
 * message somebody wanted gone is exactly the one a dispute turns on.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
    senderUserId: uuid('sender_user_id').notNull().references(() => users.id),
    senderOrgId: uuid('sender_org_id').notNull().references(() => organizations.id),
    body: text('body').notNull(),
    /** From lib/message-safety.ts. Null when the scan found nothing. */
    safetySeverity: text('safety_severity'),
    safetyFindingsJson: jsonb('safety_findings_json').$type<Array<Record<string, unknown>>>(),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
    redactedByUserId: uuid('redacted_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    /** Trust & safety queue: flagged messages awaiting a look. */
    flaggedIdx: index('messages_flagged_idx').on(t.safetySeverity, t.reviewedAt),
    /** Circumvention pattern detection across all threads for one org. */
    senderFlagIdx: index('messages_sender_flag_idx').on(t.senderOrgId, t.safetySeverity),
  }),
);

export const messageAttachments = pgTable('message_attachments', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  messageId: uuid('message_id').notNull().references(() => messages.id),
  documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id),
});

// ---------------------------------------------------------------------------
// Underwriting
// ---------------------------------------------------------------------------

/**
 * APPEND ONLY. The current state is the latest row.
 *
 * Storing a mutable status column would lose the sequence, and the sequence is
 * the interesting part: how long a file sat in review, how many times it
 * bounced between pending-docs and reviewing, whether a decline followed a
 * document request that went unanswered.
 */
export const underwritingStates = pgTable(
  'underwriting_states',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    providerOrgId: uuid('provider_org_id').notNull().references(() => organizations.id),
    status: underwritingStatusEnum('status').notNull(),
    declineReasonCode: text('decline_reason_code'),
    /** Internal note. Never forwarded verbatim to the merchant. */
    internalNote: text('internal_note'),
    conditionsJson: jsonb('conditions_json').$type<string[]>(),
    changedByUserId: uuid('changed_by_user_id').notNull().references(() => users.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    currentIdx: index('underwriting_states_current_idx').on(
      t.applicationId,
      t.providerOrgId,
      t.changedAt,
    ),
    declineIdx: index('underwriting_states_decline_idx').on(t.declineReasonCode, t.changedAt),
  }),
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id').notNull().references(() => users.id),
    applicationId: uuid('application_id').references(() => applications.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /**
     * Critical notifications escalate if unread. An offer expiring is critical;
     * a new match is not. The distinction exists because merchants were told
     * to stop answering their phones.
     */
    critical: boolean('critical').notNull().default(false),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inboxIdx: index('notifications_inbox_idx').on(t.userId, t.readAt, t.createdAt),
    /** Escalation sweep: critical, unread, past due, not yet escalated. */
    escalationIdx: index('notifications_escalation_idx').on(
      t.critical,
      t.readAt,
      t.escalatedAt,
    ),
  }),
);

/** Per-channel delivery confirmation. A send that failed is not a send. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    notificationId: uuid('notification_id').notNull().references(() => notifications.id),
    channel: notificationChannelEnum('channel').notNull(),
    status: text('status').notNull().default('queued'),
    providerRef: text('provider_ref'),
    error: text('error'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => ({
    notifIdx: index('notification_deliveries_notif_idx').on(t.notificationId),
    failureIdx: index('notification_deliveries_failure_idx').on(t.status, t.attemptedAt),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type UnderwritingState = typeof underwritingStates.$inferSelect;
