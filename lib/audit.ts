/**
 * Connect Capital — Audit spine
 *
 * The rule from the architecture doc: an audit row is written inside the same
 * transaction as the change it records. An audit write that can commit
 * separately from its cause leaves gaps exactly where they matter — a
 * document access that succeeded but whose log entry failed is indefensible.
 *
 * `mutate()` makes that structural rather than aspirational. It is the only
 * sanctioned path for a domain write:
 *
 *   1. authorize   — throws before anything is read or written
 *   2. run         — the domain work, inside the transaction
 *   3. audit       — same transaction, so they commit or roll back together
 *
 * Denials are logged too. A pattern of 403s against one provider is the
 * earliest signal of a probe, and it is invisible if you only log successes.
 */

import { sql } from 'drizzle-orm';
import { auditEvents } from '../db/kernel';
import { withActor, withSystem, type Tx } from './db';
import { can, Forbidden, type Actor, type Action, type Resource } from './policy';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface AuditDescriptor {
  /** Dotted verb, e.g. 'authorization.granted', 'document.downloaded'. */
  action: string;
  objectType: string;
  objectId?: string;
  /** Denormalized so the merchant timeline is one indexed read. */
  applicationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes one audit row. The hash chain is computed by a BEFORE INSERT trigger,
 * so prev_hash and hash are placeholders here — the database owns the chain,
 * not the application. Passing them from app code would let a caller forge one.
 */
async function writeAudit(
  tx: Tx,
  actor: Actor | null,
  descriptor: AuditDescriptor,
  ctx: RequestContext,
): Promise<void> {
  await tx.insert(auditEvents).values({
    actorUserId: actor?.userId ?? null,
    actorOrgId: actor?.orgId ?? null,
    impersonatedByUserId: actor?.impersonatedByUserId ?? null,
    action: descriptor.action,
    objectType: descriptor.objectType,
    objectId: descriptor.objectId ?? null,
    applicationId: descriptor.applicationId ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    metadata: descriptor.metadata ?? null,
    // Overwritten by the audit_chain trigger.
    prevHash: '',
    hash: '',
  });
}

/**
 * The sanctioned path for any state change.
 *
 * Authorization happens before the transaction opens, so a denial never leaves
 * a half-open transaction and never touches a row it was not entitled to read.
 */
export async function mutate<T>(
  actor: Actor,
  action: Action,
  resource: Resource,
  descriptor: AuditDescriptor,
  ctx: RequestContext,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const decision = can(actor, action, resource);

  if (!decision.allowed) {
    await logDenial(actor, action, resource, decision.reason, ctx);
    throw new Forbidden(decision);
  }

  return withActor(actor, async (tx) => {
    const result = await work(tx);
    await writeAudit(tx, actor, descriptor, ctx);
    return result;
  });
}

/**
 * Read path. Authorizes, then runs. Reads are audited only when the read is
 * itself a governed event — document views, disclosure views, admin access to
 * merchant data. Auditing every list query would bury the signal.
 */
export async function query<T>(
  actor: Actor,
  action: Action,
  resource: Resource,
  ctx: RequestContext,
  work: (tx: Tx) => Promise<T>,
  descriptor?: AuditDescriptor,
): Promise<T> {
  const decision = can(actor, action, resource);

  if (!decision.allowed) {
    await logDenial(actor, action, resource, decision.reason, ctx);
    throw new Forbidden(decision);
  }

  return withActor(actor, async (tx) => {
    const result = await work(tx);
    if (descriptor) {
      await writeAudit(tx, actor, descriptor, ctx);
    }
    return result;
  });
}

/**
 * Denials get their own transaction so they survive the rollback of whatever
 * the caller was attempting. Runs as system because the actor was, by
 * definition, not entitled to the session context of the thing they wanted.
 */
async function logDenial(
  actor: Actor,
  action: Action,
  resource: Resource,
  reason: string,
  ctx: RequestContext,
): Promise<void> {
  await withSystem(async (tx) => {
    await writeAudit(
      tx,
      actor,
      {
        action: 'access.denied',
        objectType: resource.kind,
        objectId: 'id' in resource ? resource.id : undefined,
        applicationId:
          'applicationId' in resource
            ? (resource.applicationId ?? undefined)
            : 'kind' in resource && resource.kind === 'application'
              ? resource.id
              : undefined,
        metadata: { attemptedAction: action, reason },
      },
      ctx,
    );
  });
}

/**
 * Nightly job. Publish the returned head hash to an external store — an
 * unverified chain proves nothing, and a chain nobody publishes proves only
 * that we did not alter it ourselves.
 */
export async function verifyChain(
  fromSeq = 0n,
): Promise<{ ok: boolean; brokenAt?: bigint; head?: string }> {
  return withSystem(async (tx) => {
    const breaks = await tx.execute(
      sql`SELECT * FROM verify_audit_chain(${fromSeq})`,
    );
    if (breaks.rows.length > 0) {
      return { ok: false, brokenAt: BigInt(breaks.rows[0].broken_at as string) };
    }
    const head = await tx.execute(
      sql`SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1`,
    );
    return { ok: true, head: head.rows[0]?.hash as string | undefined };
  });
}
