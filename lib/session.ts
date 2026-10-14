/**
 * CapNet — Session and actor resolution
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the Actor is derived from the
 * authenticated session. It is never read from a request body, query string,
 * header, or path parameter.
 *
 * Accepting an orgId from the client is the canonical multi-tenant breach.
 * It does not look like a vulnerability in review — it looks like a route that
 * takes a parameter. Every permission check downstream is honest and correct,
 * and every one of them is asked the wrong question.
 *
 * So `resolveActor` takes no arguments a caller can influence, and the route
 * wrapper below is the only sanctioned entry point.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { users, orgMembers, organizations } from '../db/kernel';
import { db, withSystem } from './db';
import { Forbidden, type Actor, type OrgType } from './policy';

export class Unauthenticated extends Error {}

/** Whatever the auth provider hands back. Only the subject claim is trusted. */
export interface AuthSession {
  authProviderId: string;
  /**
   * Which org the user is acting as, for users who belong to more than one.
   * Comes from the auth provider's own org-switcher claim, NOT from our
   * request — otherwise it is a client-supplied orgId wearing a costume.
   */
  activeOrgId?: string;
}

export interface ElevationGrant {
  reason: string;
  expiresAt: Date;
  grantedToUserId: string;
}

export async function resolveActor(
  session: AuthSession,
  elevation?: ElevationGrant,
): Promise<Actor> {
  const rows = await withSystem(async (tx) =>
    tx
      .select({
        userId: users.id,
        userStatus: users.status,
        mfaEnabled: users.mfaEnabled,
        orgId: organizations.id,
        orgType: organizations.type,
        orgStatus: organizations.status,
        role: orgMembers.role,
      })
      .from(users)
      .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(
        and(
          eq(users.authProviderId, session.authProviderId),
          isNull(orgMembers.removedAt),
        ),
      ),
  );

  if (rows.length === 0) throw new Unauthenticated('no active membership');

  const row = session.activeOrgId
    ? rows.find((r) => r.orgId === session.activeOrgId)
    : rows[0];

  if (!row) throw new Unauthenticated('not a member of the requested org');

  // A suspended user or org fails here rather than at each policy branch.
  // One place to revoke everything is worth more than defence in depth that
  // has to be remembered in forty route handlers.
  if (row.userStatus !== 'active') throw new Unauthenticated('user not active');
  if (row.orgStatus === 'suspended' || row.orgStatus === 'offboarded') {
    throw new Unauthenticated('organization not active');
  }

  // Platform staff without MFA cannot act at all. They hold the elevation
  // path to merchant documents; the bar is higher by design.
  if (row.orgType === 'platform' && !row.mfaEnabled) {
    throw new Unauthenticated('platform access requires MFA');
  }

  const actor: Actor = {
    userId: row.userId,
    orgId: row.orgId,
    orgType: row.orgType as OrgType,
    role: row.role,
  };

  // Elevation is only honoured for the user it was granted to, and only while
  // it is live. A grant handed to a colleague is not a grant.
  if (
    elevation &&
    elevation.grantedToUserId === row.userId &&
    elevation.expiresAt > new Date()
  ) {
    actor.elevation = { reason: elevation.reason, expiresAt: elevation.expiresAt };
  }

  return actor;
}

/**
 * Route wrapper. Every API handler is written as `handler(actor, req)` and
 * wrapped here, so there is no code path that reaches domain logic without an
 * Actor that came from the session.
 *
 * Failures return bare statuses. A 403 that explains itself — "no active
 * authorization covers this document" — confirms the document exists, which
 * is exactly what an attacker enumerating IDs is trying to learn.
 */
export function withRouteActor<T>(
  handler: (actor: Actor, req: Request) => Promise<T>,
) {
  return async (req: Request, session: AuthSession): Promise<Response> => {
    let actor: Actor;
    try {
      actor = await resolveActor(session);
    } catch {
      return new Response(null, { status: 401 });
    }

    try {
      const result = await handler(actor, req);
      return Response.json(result);
    } catch (err) {
      if (err instanceof Forbidden) return new Response(null, { status: 403 });
      if (err instanceof Unauthenticated) return new Response(null, { status: 401 });
      console.error('[route]', err);
      return new Response(null, { status: 500 });
    }
  };
}

/**
 * Convenience for the merchant surface. Callers that need the merchant's own
 * business must not accept a businessId from the client either — they look it
 * up from the actor's org.
 */
export async function merchantBusinessIdFor(actor: Actor): Promise<string | null> {
  if (actor.orgType !== 'merchant') return null;
  const { merchantBusinesses } = await import('../db/merchant');
  const [row] = await db
    .select({ id: merchantBusinesses.id })
    .from(merchantBusinesses)
    .where(eq(merchantBusinesses.orgId, actor.orgId))
    .limit(1);
  return row?.id ?? null;
}
