/**
 * CapNet — M0 Kernel Schema
 *
 * Identity, organizations, membership, consent, and audit.
 * Nothing domain-specific lives here. Everything above the kernel
 * (applications, providers, offers, documents) depends on these
 * tables and on the guarantees enforced in 0001_kernel_guards.sql.
 *
 * Design rules embodied here:
 *   R2  every authorization decision is server-enforced
 *   R5  the audit log is append-only and tamper-evident
 *   UUIDv7 primary keys — non-enumerable but index-friendly
 */

import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const orgTypeEnum = pgEnum('org_type', [
  'merchant',
  'provider',
  'specialist',
  'platform',
]);

export const orgRoleEnum = pgEnum('org_role', [
  'owner',
  'admin',
  'rep',
  'underwriter',
  'specialist',
  'viewer',
]);

export const userStatusEnum = pgEnum('user_status', [
  'pending',
  'active',
  'suspended',
  'closed',
]);

export const orgStatusEnum = pgEnum('org_status', [
  'pending',
  'active',
  'suspended',
  'offboarded',
]);

/**
 * Consent types. Every one of these produces an immutable row with the
 * exact text version and hash the user accepted. "What did they agree to,
 * and when" will one day be a discovery request.
 */
export const consentTypeEnum = pgEnum('consent_type', [
  'platform_terms',
  'privacy_policy',
  'provider_authorization', // merchant grants a provider access
  'raw_document_access', // separate, narrower grant for statement PDFs
  'bank_connection',
  'fcra_credit_pull',
  'specialist_assignment',
  'provider_participation_agreement',
  'marketing_email', // opt-in only; never bundled with terms (0010)
  'cookie_preferences', // non-essential cookie choices (0010)
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    authProviderId: text('auth_provider_id').notNull().unique(),
    email: text('email').notNull(),
    phone: text('phone'),
    fullName: text('full_name').notNull(),
    status: userStatusEnum('status').notNull().default('pending'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
  }),
);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * Every actor belongs to an organization, including merchants. A sole
 * proprietor is an org of one. This keeps the permission model uniform:
 * there is never a "user without an org" special case to forget about.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    type: orgTypeEnum('type').notNull(),
    legalName: text('legal_name').notNull(),
    dba: text('dba'),
    status: orgStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    typeStatusIdx: index('organizations_type_status_idx').on(t.type, t.status),
  }),
);

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: orgRoleEnum('role').notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => ({
    // A user holds at most one active membership per org.
    activeMembershipIdx: uniqueIndex('org_members_active_idx')
      .on(t.orgId, t.userId)
      .where(sql`removed_at IS NULL`),
    userLookupIdx: index('org_members_user_idx').on(t.userId, t.removedAt),
  }),
);

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * APPEND ONLY. Enforced by grant, not by convention — see 0001.
 *
 * subjectType/subjectId are intentionally loose: a consent can attach to an
 * application, an authorization, a bank connection, or nothing at all
 * (platform terms). Referential integrity is enforced at the call site
 * because the referent lives in a table the kernel does not know about.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    consentType: consentTypeEnum('consent_type').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    /** Version identifier of the exact text shown, e.g. "provider-auth-v3". */
    textVersion: text('text_version').notNull(),
    /** sha256 of the rendered text, so we can prove what they saw. */
    textHash: text('text_hash').notNull(),
    acceptedByUserId: uuid('accepted_by_user_id')
      .notNull()
      .references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    subjectIdx: index('consents_subject_idx').on(t.subjectType, t.subjectId),
    userIdx: index('consents_user_idx').on(t.acceptedByUserId, t.acceptedAt),
  }),
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * APPEND ONLY and hash-chained.
 *
 *   hash = sha256(prev_hash || canonical_json(row_without_hash))
 *
 * bigserial rather than uuid because the chain needs a total order and
 * gapless sequence detection. The chain head is published daily to an
 * external store; that is what turns "we have logs" into "we can
 * demonstrate the logs were not altered."
 *
 * Written inside the same transaction as the domain change it records.
 * An audit row that can be committed separately from its cause is not
 * evidence.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    seq: bigserial('seq', { mode: 'bigint' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorOrgId: uuid('actor_org_id').references(() => organizations.id),
    /** Set when a platform admin is acting as another user. Never null-able away. */
    impersonatedByUserId: uuid('impersonated_by_user_id').references(
      () => users.id,
    ),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id'),
    /** Denormalized so the merchant-facing timeline is one indexed read. */
    applicationId: uuid('application_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => ({
    applicationIdx: index('audit_events_application_idx').on(
      t.applicationId,
      t.at,
    ),
    actorOrgIdx: index('audit_events_actor_org_idx').on(t.actorOrgId, t.at),
    objectIdx: index('audit_events_object_idx').on(t.objectType, t.objectId),
    actionIdx: index('audit_events_action_idx').on(t.action, t.at),
  }),
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
