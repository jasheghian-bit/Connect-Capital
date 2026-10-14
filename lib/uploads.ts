/**
 * CapNet — Upload lifecycle
 *
 * ASYMMETRY, ON PURPOSE: uploads go direct to storage, downloads are proxied.
 *
 * They look inconsistent and they are not. Downloads are proxied because every
 * read must produce an access event — that log is the product. Uploads have no
 * such requirement, and proxying a 40MB scanned PDF through the app server
 * buys nothing while costing memory, request timeouts, and a bad experience on
 * the phone connection a merchant is actually using.
 *
 * So: the client asks for a slot, PUTs the bytes straight to the bucket, then
 * calls finalize. The server never sees the bytes and still owns every fact
 * that matters about them.
 *
 * "Upload once" is the merchant's headline promise. Two mechanics deliver it,
 * both in this file: content hashing so a re-uploaded statement is recognised
 * rather than duplicated, and request fan-out so one upload closes every open
 * request for that document type across all authorized providers.
 */

import { and, eq, isNull } from 'drizzle-orm';
import {
  documents,
  documentVersions,
  documentRequests,
} from '../db/documents';
import { mutate } from './audit';
import { withActor, type Tx } from './db';
import type { Actor } from './policy';
import { can, Forbidden } from './policy';

import {
  isRawStatementType,
  ALLOWED_MIME_TYPES as ALLOWED_MIME,
  MAX_UPLOAD_BYTES as MAX_BYTES,
  type DocType,
} from './doc-classification';

export type { DocType };
export { isRawStatementType };

export interface UploadSlot {
  documentId: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: Date;
}

export interface StorageWriter {
  createUploadUrl(key: string, mimeType: string, maxBytes: number): Promise<string>;
  head(key: string): Promise<{ byteSize: number; sha256: string } | null>;
}

export interface VirusScanner {
  enqueue(storageKey: string, versionId: string): Promise<void>;
}

/**
 * Step 1. Reserve a document row and hand back a short-lived, single-key,
 * size-capped upload URL. Scoped to one key so it cannot be reused to write
 * anywhere else in the bucket.
 */
export async function beginUpload(
  actor: Actor,
  input: {
    businessId: string;
    applicationId?: string;
    docType: DocType;
    mimeType: string;
    declaredBytes: number;
  },
  storage: StorageWriter,
  ctx: { ip?: string; userAgent?: string },
): Promise<UploadSlot> {
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new Error('unsupported file type');
  }
  if (input.declaredBytes > MAX_BYTES) {
    throw new Error('file too large');
  }

  // Only the merchant who owns the business may upload to it. Providers and
  // specialists never write documents — a specialist who could upload on the
  // merchant's behalf is a broker holding the merchant's paperwork again.
  const decision = can(actor, 'create', {
    kind: 'application',
    id: input.applicationId ?? input.businessId,
    merchantOrgId: actor.orgId,
    status: 'draft',
  });
  if (!decision.allowed || actor.orgType !== 'merchant') {
    throw new Forbidden(decision);
  }

  const storageKey = `docs/${input.businessId}/${crypto.randomUUID()}`;
  const uploadUrl = await storage.createUploadUrl(
    storageKey,
    input.mimeType,
    MAX_BYTES,
  );

  const documentId = await mutate(
    actor,
    'create',
    {
      kind: 'application',
      id: input.applicationId ?? input.businessId,
      merchantOrgId: actor.orgId,
      status: 'draft',
    },
    {
      action: 'document.upload_started',
      objectType: 'document',
      applicationId: input.applicationId,
      metadata: { docType: input.docType },
    },
    ctx,
    async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          businessId: input.businessId,
          applicationId: input.applicationId ?? null,
          docType: input.docType,
          isRawStatement: isRawStatementType(input.docType),
          createdByUserId: actor.userId,
        })
        .returning({ id: documents.id });
      return doc.id;
    },
  );

  return {
    documentId,
    storageKey,
    uploadUrl,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
}

export interface FinalizeResult {
  versionId: string;
  versionNo: number;
  /** True when the bytes matched an existing version — no new version created. */
  deduplicated: boolean;
  /** Open document requests this upload closed, across all authorized providers. */
  fulfilledRequestIds: string[];
}

/**
 * Step 2. The client says the bytes are up. The server verifies against
 * storage rather than believing the claim, then records the version.
 *
 * The version is created with parse_status 'pending' and is NOT readable by
 * any provider until the scan clears. Providers download merchant-supplied
 * files; shipping an unscanned attachment into a funder's underwriting team
 * would be handing them the malware delivery problem as a feature.
 */
export async function finalizeUpload(
  actor: Actor,
  input: {
    documentId: string;
    businessId: string;
    applicationId?: string;
    storageKey: string;
    mimeType: string;
    docType: DocType;
    periodStart?: string;
    periodEnd?: string;
  },
  storage: StorageWriter,
  scanner: VirusScanner,
  ctx: { ip?: string; userAgent?: string },
): Promise<FinalizeResult> {
  const object = await storage.head(input.storageKey);
  if (!object) throw new Error('upload not found in storage');
  if (object.byteSize === 0) throw new Error('empty file');
  if (object.byteSize > MAX_BYTES) throw new Error('file too large');

  return mutate(
    actor,
    'update',
    {
      kind: 'application',
      id: input.applicationId ?? input.businessId,
      merchantOrgId: actor.orgId,
      status: 'draft',
    },
    {
      action: 'document.uploaded',
      objectType: 'document',
      objectId: input.documentId,
      applicationId: input.applicationId,
      metadata: { docType: input.docType, sha256: object.sha256 },
    },
    ctx,
    async (tx) => {
      // Dedupe. A merchant who re-sends the same August statement should not
      // create a v2 that a funder then re-reviews. Scoped to this document so
      // an identical file under a different type still versions normally.
      const existing = await tx
        .select({ id: documentVersions.id, versionNo: documentVersions.versionNo })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, input.documentId),
            eq(documentVersions.sha256, object.sha256),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const fulfilled = await fulfilOpenRequests(
          tx,
          input.applicationId,
          input.docType,
          existing[0].id,
        );
        return {
          versionId: existing[0].id,
          versionNo: existing[0].versionNo,
          deduplicated: true,
          fulfilledRequestIds: fulfilled,
        };
      }

      // version_no is assigned by trigger; the unique index rejects a
      // concurrent second writer and the caller retries.
      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: input.documentId,
          versionNo: 0,
          storageKey: input.storageKey,
          sha256: object.sha256,
          byteSize: object.byteSize,
          mimeType: input.mimeType,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          parseStatus: 'pending',
          uploadedByUserId: actor.userId,
        })
        .returning({ id: documentVersions.id, versionNo: documentVersions.versionNo });

      await tx
        .update(documents)
        .set({ currentVersionId: version.id })
        .where(eq(documents.id, input.documentId));

      const fulfilled = await fulfilOpenRequests(
        tx,
        input.applicationId,
        input.docType,
        version.id,
      );

      await scanner.enqueue(input.storageKey, version.id);

      return {
        versionId: version.id,
        versionNo: version.versionNo,
        deduplicated: false,
        fulfilledRequestIds: fulfilled,
      };
    },
  );
}

/**
 * The "upload once" payoff, mechanically.
 *
 * Four funders each asking for the August statement is four rows here. One
 * upload closes all four. Without this the merchant uploads the same PDF four
 * times and the promise is marketing.
 */
async function fulfilOpenRequests(
  tx: Tx,
  applicationId: string | undefined,
  docType: DocType,
  versionId: string,
): Promise<string[]> {
  if (!applicationId) return [];

  const rows = await tx
    .update(documentRequests)
    .set({
      status: 'fulfilled',
      fulfilledVersionId: versionId,
      fulfilledAt: new Date(),
    })
    .where(
      and(
        eq(documentRequests.applicationId, applicationId),
        eq(documentRequests.docType, docType),
        eq(documentRequests.status, 'open'),
      ),
    )
    .returning({ id: documentRequests.id });

  return rows.map((r) => r.id);
}

/**
 * Called by the scan worker. A failed scan quarantines rather than deletes —
 * the merchant needs to be told which file was rejected and why, and a silently
 * vanished upload is the worst version of that conversation.
 */
export async function recordScanResult(
  versionId: string,
  result: 'clean' | 'infected' | 'error',
): Promise<void> {
  const { withSystem } = await import('./db');
  await withSystem(async (tx) => {
    await tx
      .update(documentVersions)
      .set({ parseStatus: result === 'clean' ? 'scanned' : `quarantined:${result}` })
      .where(eq(documentVersions.id, versionId));
  });
}

/** Documents a merchant has on file, with which open requests remain. */
export async function documentChecklist(
  actor: Actor,
  applicationId: string,
): Promise<Array<{ docType: string; hasFile: boolean; openRequests: number }>> {
  return withActor(actor, async (tx) => {
    const reqs = await tx
      .select({ docType: documentRequests.docType })
      .from(documentRequests)
      .where(
        and(
          eq(documentRequests.applicationId, applicationId),
          eq(documentRequests.status, 'open'),
        ),
      );

    const docs = await tx
      .select({ docType: documents.docType })
      .from(documents)
      .where(and(eq(documents.applicationId, applicationId), isNull(documents.deletedAt)));

    const have = new Set(docs.map((d) => d.docType));
    const counts = new Map<string, number>();
    for (const r of reqs) counts.set(r.docType, (counts.get(r.docType) ?? 0) + 1);

    return [...new Set([...have, ...counts.keys()])].map((docType) => ({
      docType,
      hasFile: have.has(docType),
      openRequests: counts.get(docType) ?? 0,
    }));
  });
}
