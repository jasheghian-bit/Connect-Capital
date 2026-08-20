/**
 * Connect Capital — Document delivery
 *
 * The rejected alternative was a pre-signed S3 URL. It is faster and it is
 * wrong here: a signed URL is a bearer token that cannot be revoked before it
 * expires and produces no record when it is re-fetched, forwarded, or shared.
 * The merchant's Access Center would show one view when there had been thirty.
 *
 * So every byte is proxied. It costs latency and bandwidth. It buys a document
 * access log that is actually complete, which is the product.
 *
 * ORDER OF OPERATIONS — authorize, LOG, then serve.
 *
 * Logging after delivery is the intuitive order and it is unsound: a crash
 * mid-stream leaves bytes delivered with no record, which is precisely the
 * case a dispute turns on. Logging first can over-report an access that failed
 * to complete. Over-reporting is recoverable; under-reporting is not.
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { documentVersions, documentAccessEvents, documents } from '../db/documents';
import { withActor, withSystem } from './db';
import { can, Forbidden, type Actor } from './policy';
import type { Resource } from './policy';

export interface DeliveryContext {
  ip?: string;
  userAgent?: string;
  action: 'view' | 'download' | 'print';
}

export interface DeliveryResult {
  stream: ReadableStream;
  mimeType: string;
  byteSize: number;
  watermarkToken: string;
  filename: string;
}

/** Injected so tests do not need object storage. */
export interface StorageAdapter {
  getObject(key: string): Promise<ReadableStream>;
}

/** Injected so watermarking can start visible-only and grow without a rewrite. */
export interface Watermarker {
  supports(mimeType: string): boolean;
  apply(
    input: ReadableStream,
    stamp: { token: string; orgName: string; at: Date },
  ): Promise<ReadableStream>;
}

export async function deliverDocument(
  actor: Actor,
  documentVersionId: string,
  resource: Extract<Resource, { kind: 'document_version' }>,
  ctx: DeliveryContext,
  storage: StorageAdapter,
  watermarker: Watermarker,
  actorOrgName: string,
): Promise<DeliveryResult> {
  // 1. Authorize. Before any read, before any storage call.
  const decision = can(actor, ctx.action === 'view' ? 'view' : 'download', resource);
  if (!decision.allowed) {
    await recordDenial(actor, documentVersionId, ctx, decision.reason);
    throw new Forbidden(decision);
  }

  // 2. Load metadata under the actor's session so RLS is in play.
  const version = await withActor(actor, async (tx) => {
    const [v] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, documentVersionId))
      .limit(1);
    if (!v) throw new Error('not found');
    return v;
  });

  // 3. LOG. Own transaction, committed before a single byte moves.
  const watermarkToken = randomBytes(9).toString('base64url');
  await withSystem(async (tx) => {
    await tx.insert(documentAccessEvents).values({
      documentVersionId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      authorizationId: resource.grants.length ? findGrantId(resource, actor) : null,
      action: ctx.action,
      watermarkToken,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  });

  // 4. Serve.
  let stream = await storage.getObject(version.storageKey);

  // The merchant reading their own file gets it clean. A watermark is for
  // attributing a leak to a third party, and the merchant is not one.
  const isThirdParty = actor.orgId !== resource.merchantOrgId;
  if (isThirdParty && watermarker.supports(version.mimeType)) {
    stream = await watermarker.apply(stream, {
      token: watermarkToken,
      orgName: actorOrgName,
      at: new Date(),
    });
  }

  return {
    stream,
    mimeType: version.mimeType,
    byteSize: version.byteSize,
    watermarkToken,
    filename: `cc-${version.documentId}-v${version.versionNo}`,
  };
}

function findGrantId(
  resource: Extract<Resource, { kind: 'document_version' }>,
  actor: Actor,
): string | null {
  const grant = resource.grants.find((g) => g.providerOrgId === actor.orgId);
  return grant ? ((grant as { authorizationId?: string }).authorizationId ?? null) : null;
}

/**
 * A refused document access is the highest-signal event in the whole system.
 * One is noise. A pattern from one provider org is a probe, and it is
 * invisible if only successes are recorded.
 */
async function recordDenial(
  actor: Actor,
  documentVersionId: string,
  ctx: DeliveryContext,
  reason: string,
): Promise<void> {
  await withSystem(async (tx) => {
    await tx.insert(documentAccessEvents).values({
      documentVersionId,
      actorUserId: actor.userId,
      actorOrgId: actor.orgId,
      authorizationId: null,
      action: ctx.action,
      watermarkToken: `DENIED:${reason.slice(0, 60)}`,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  });
}

/**
 * Powers the merchant's Access Center. The most important screen in the
 * product for the trust thesis: not "who has access" but "who actually
 * opened your bank statements, and when."
 */
export async function accessHistoryForMerchant(
  actor: Actor,
  businessId: string,
): Promise<
  Array<{
    documentId: string;
    docType: string;
    actorOrgId: string;
    action: string;
    at: Date;
  }>
> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        documentId: documents.id,
        docType: documents.docType,
        actorOrgId: documentAccessEvents.actorOrgId,
        action: documentAccessEvents.action,
        at: documentAccessEvents.at,
      })
      .from(documentAccessEvents)
      .innerJoin(
        documentVersions,
        eq(documentAccessEvents.documentVersionId, documentVersions.id),
      )
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(eq(documents.businessId, businessId))
      .orderBy(documentAccessEvents.at);
    return rows as Array<{
      documentId: string;
      docType: string;
      actorOrgId: string;
      action: string;
      at: Date;
    }>;
  });
}
