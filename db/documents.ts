/**
 * CapNet — M1 Document vault
 *
 * "Upload once" is a merchant promise. `document_access_events` is what turns
 * it into an auditable one: the merchant can see not just who has access, but
 * who actually opened what, and when.
 *
 * The distinction that matters most in this file is `isRawStatement`.
 * A default authorization grants derived metrics only. Raw statement PDFs are
 * a separate, narrower consent — because a raw statement carries the account
 * number, routing number, business address, and the merchant's entire customer
 * and vendor list. Fewer raw artifacts in circulation is worth more than any
 * watermark. The enforcement lives in lib/policy.ts.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  bigint,
  date,
  timestamp,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, organizations } from './kernel';
import { merchantBusinesses, applications } from './merchant';

export const docTypeEnum = pgEnum('doc_type', [
  'bank_statement',
  'government_id',
  'voided_check',
  'tax_return',
  'financial_statement',
  'business_license',
  'lease_agreement',
  'other',
]);

export const docAccessActionEnum = pgEnum('doc_access_action', [
  'view',
  'download',
  'print',
]);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    businessId: uuid('business_id').notNull().references(() => merchantBusinesses.id),
    /** Null for profile-level documents that outlive a single application. */
    applicationId: uuid('application_id').references(() => applications.id),
    docType: docTypeEnum('doc_type').notNull(),
    /**
     * Gates the separate raw-document consent scope. Set at upload from
     * docType, not trusted from the client.
     */
    isRawStatement: boolean('is_raw_statement').notNull().default(false),
    currentVersionId: uuid('current_version_id'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Soft delete only. A document referenced by an underwriting decision is
     * part of the transaction record and cannot be destroyed on request.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    businessIdx: index('documents_business_idx').on(t.businessId, t.docType),
    appIdx: index('documents_application_idx').on(t.applicationId),
  }),
);

/** APPEND ONLY. Replacing a document creates a new version; nothing is overwritten. */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    documentId: uuid('document_id').notNull().references(() => documents.id),
    versionNo: integer('version_no').notNull(),
    /** Private bucket key. Never rendered to a client, never made public. */
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    mimeType: text('mime_type').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    parseStatus: text('parse_status').notNull().default('pending'),
    uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: uniqueIndex('document_versions_version_idx').on(t.documentId, t.versionNo),
    /** Duplicate detection: the same statement re-uploaded is not a new version. */
    hashIdx: index('document_versions_hash_idx').on(t.sha256),
  }),
);

/**
 * APPEND ONLY. One row per access, written BEFORE the bytes are served.
 *
 * `watermarkToken` is stamped into the rendered document, so a leaked artifact
 * traces back to a specific provider session. This is attribution, not
 * prevention — a screenshot defeats it. It exists to make misuse detectable
 * and contractually actionable, which is the only honest claim available.
 */
export const documentAccessEvents = pgTable(
  'document_access_events',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
    actorOrgId: uuid('actor_org_id').notNull().references(() => organizations.id),
    /** Which grant permitted this. Null for the merchant's own access. */
    authorizationId: uuid('authorization_id'),
    action: docAccessActionEnum('action').notNull(),
    watermarkToken: text('watermark_token'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: index('doc_access_version_idx').on(t.documentVersionId, t.at),
    orgIdx: index('doc_access_org_idx').on(t.actorOrgId, t.at),
    /** Bulk-download detection for trust & safety. */
    sweepIdx: index('doc_access_sweep_idx').on(t.actorOrgId, t.action, t.at),
  }),
);

export const documentRequests = pgTable(
  'document_requests',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    applicationId: uuid('application_id').notNull().references(() => applications.id),
    providerOrgId: uuid('provider_org_id').notNull().references(() => organizations.id),
    requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
    docType: docTypeEnum('doc_type').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    /**
     * The "upload once" payoff: one fulfilment satisfies every open request
     * for the same document type across all authorized providers.
     */
    fulfilledVersionId: uuid('fulfilled_version_id').references(() => documentVersions.id),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appStatusIdx: index('document_requests_app_status_idx').on(t.applicationId, t.status),
    providerIdx: index('document_requests_provider_idx').on(t.providerOrgId, t.status),
  }),
);

export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentAccessEvent = typeof documentAccessEvents.$inferSelect;
