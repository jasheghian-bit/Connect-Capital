/**
 * CapNet — Database access
 *
 * Two rules this file exists to enforce:
 *
 *   1. RLS session context is set from the authenticated session, inside the
 *      transaction, and never from a request parameter. `set_config(..., true)`
 *      makes it transaction-local, so it cannot leak across pooled connections.
 *
 *   2. Nothing writes outside `withActor`. The audit spine in audit.ts builds
 *      on this, and the lint rule bans bare `db.insert` / `db.update` /
 *      `db.delete` outside lib/.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as kernel from '../db/kernel';
import type { Actor } from './policy';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  // Fail fast rather than queueing behind a stuck transaction.
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
});

export const db = drizzle(pool, { schema: kernel });

export type Tx = NodePgDatabase<typeof kernel>;

/**
 * Opens a transaction with the actor's identity bound to the Postgres session,
 * so RLS policies can see who is asking.
 *
 * Every read and write that touches merchant data goes through here. The
 * policy module is the primary control; this is what makes RLS the backstop
 * rather than decoration.
 */
export async function withActor<T>(
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.current_user_id', ${actor.userId}, true),
        set_config('app.current_org_id',  ${actor.orgId},  true),
        set_config('app.current_org_type',${actor.orgType},true)
    `);
    return fn(tx);
  });
}

/**
 * Unscoped transaction. For migrations, background jobs with no actor, and
 * the nightly chain verification. Never reachable from a request handler —
 * there is no actor to attribute the work to, so nothing here can be audited.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_org_type', 'system', true)`,
    );
    return fn(tx);
  });
}

export async function closePool(): Promise<void> {
  await pool.end();
}
