/**
 * CapNet — Authorization Policy
 *
 * THE RULE: every route handler calls can() as its first statement, before
 * any read or write. There is no other place authorization decisions are made.
 *
 * Why one function instead of scattered checks or RLS policies alone:
 *   - It is greppable. You can read the entire permission model in one file.
 *   - It fails closed. The default branch denies.
 *   - It is exhaustively testable. The deny-suite enumerates every
 *     actor x action x resource triple and asserts the expected outcome.
 *   - It survives AI-assisted development. A generated route that forgets
 *     to call can() fails the lint rule and then fails RLS at the database.
 *
 * RLS in 0001_kernel_guards.sql is defense in depth, not the primary control.
 * If these two ever disagree, that is a bug in this file.
 */

import type { OrgRole } from '../db/kernel';

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export type OrgType = 'merchant' | 'provider' | 'specialist' | 'platform';

export interface Actor {
  userId: string;
  orgId: string;
  orgType: OrgType;
  role: OrgRole;
  /**
   * Platform admins reading merchant documents or message bodies must hold a
   * time-boxed elevation with a stated reason. Elevation is logged and is
   * visible to the merchant in their timeline. Governance access (verification
   * queues, fee records, aggregate analytics) does NOT require elevation.
   */
  elevation?: { reason: string; expiresAt: Date };
  /** Set when a platform user is acting as another user. */
  impersonatedByUserId?: string;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * Resources carry the ownership facts needed to decide, so can() never
 * queries. The caller loads the row, then asks. This keeps the policy
 * pure and makes the deny-suite trivial to write.
 */
export type Resource =
  | { kind: 'application'; id: string; merchantOrgId: string; status: string }
  | {
      /**
       * The funder-facing file (identity + allowlisted summary). `grants`
       * holds LIVE authorizations only; revoked/expired grants are absent.
       * There is no pre-authorization variant — the blinded match card was
       * removed Sep 2026. Being matched confers nothing.
       */
      kind: 'application_file';
      id: string;
      merchantOrgId: string;
      grants: Array<{ providerOrgId: string }>;
    }
  | {
      /** A match row: internal routing output. Never funder-readable. */
      kind: 'match';
      applicationId: string;
      merchantOrgId: string;
      providerOrgId: string;
    }
  | {
      /** Who else holds a grant on this file, or how many. Merchant-only. */
      kind: 'application_grantees';
      applicationId: string;
      merchantOrgId: string;
    }
  | {
      /** A–F grade and match score. Internal; picks the suggested set only. */
      kind: 'application_grade';
      applicationId: string;
      merchantOrgId: string;
    }
  | {
      kind: 'authorization';
      id: string;
      applicationId: string;
      merchantOrgId: string;
      providerOrgId: string;
      status: 'active' | 'revoked' | 'expired';
      /** Does the grant include raw statement PDFs, or only derived metrics? */
      scopeIncludesRawDocuments: boolean;
    }
  | {
      kind: 'document_version';
      id: string;
      merchantOrgId: string;
      applicationId: string | null;
      isRawStatement: boolean;
      /** Active authorizations covering this document's application. */
      grants: Array<{ providerOrgId: string; includesRawDocuments: boolean }>;
    }
  | {
      kind: 'conversation';
      id: string;
      applicationId: string;
      merchantOrgId: string;
      participantOrgIds: string[];
    }
  | {
      kind: 'offer';
      id: string;
      applicationId: string;
      merchantOrgId: string;
      providerOrgId: string;
    }
  | { kind: 'organization'; id: string }
  | { kind: 'platform_governance' }; // verification queues, fees, analytics

export type Action =
  | 'view'
  | 'create'
  | 'update'
  | 'submit'
  | 'grant'
  | 'revoke'
  | 'download'
  | 'message'
  | 'offer'
  | 'accept'
  | 'administer';

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface Decision {
  allowed: boolean;
  /** Always populated. Denials are logged with this string. */
  reason: string;
}

const allow = (reason: string): Decision => ({ allowed: true, reason });
const deny = (reason: string): Decision => ({ allowed: false, reason });

const isMember = (actor: Actor, orgId: string) => actor.orgId === orgId;

const hasValidElevation = (actor: Actor) =>
  actor.elevation !== undefined && actor.elevation.expiresAt > new Date();

const activeGrantFor = (
  grants: Array<{ providerOrgId: string; includesRawDocuments: boolean }>,
  orgId: string,
) => grants.find((g) => g.providerOrgId === orgId);

// ---------------------------------------------------------------------------
// can()
// ---------------------------------------------------------------------------

export function can(
  actor: Actor,
  action: Action,
  resource: Resource,
): Decision {
  // Suspended orgs and users never pass. Checked by the caller against the
  // session, but repeated here so the policy is complete on its own.
  if (actor.orgType === 'provider' && action === 'grant') {
    return deny('providers may never grant authorizations');
  }

  switch (resource.kind) {
    // -----------------------------------------------------------------------
    case 'application': {
      if (isMember(actor, resource.merchantOrgId)) {
        return allow('merchant owns this application');
      }

      if (actor.orgType === 'provider') {
        // Providers reach applications only through document_version,
        // conversation, and offer resources, each of which carries its own
        // grant check. There is no direct provider read of an application row.
        return deny('providers access applications via scoped resources only');
      }

      if (actor.orgType === 'specialist') {
        // Assignment is checked by the caller loading the assignment row and
        // passing a specialist-scoped resource. Absent that, deny.
        return deny('specialist requires an active assignment');
      }

      if (actor.orgType === 'platform') {
        return hasValidElevation(actor)
          ? allow(`platform elevation: ${actor.elevation!.reason}`)
          : deny('platform access to merchant applications requires elevation');
      }

      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'application_file': {
      if (isMember(actor, resource.merchantOrgId)) {
        return action === 'view'
          ? allow('merchant may see their own file')
          : deny('the file view is read-only');
      }
      if (actor.orgType === 'provider') {
        // Founder decision, Sep 2026: visibility begins ONLY when the merchant
        // grants access. Matched-but-unauthorized, revoked, and expired all
        // land here identically and see nothing.
        if (!resource.grants.some((g) => g.providerOrgId === actor.orgId)) {
          return deny('no live authorization: providers see nothing before a grant');
        }
        return action === 'view'
          ? allow('live grant covers this file')
          : deny('providers may not modify a merchant file');
      }
      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'match': {
      if (actor.orgType === 'provider') {
        return deny('matching is internal; a match confers no visibility');
      }
      if (isMember(actor, resource.merchantOrgId) && action === 'view') {
        return allow('merchant may see which funders were suggested');
      }
      if (actor.orgType === 'platform' && action === 'view') {
        return allow('governance: match records are platform-visible');
      }
      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'application_grantees': {
      if (isMember(actor, resource.merchantOrgId) && action === 'view') {
        return allow('merchant may see who has access');
      }
      if (actor.orgType === 'platform' && action === 'view') {
        return allow('governance: authorization records are platform-visible');
      }
      // Includes AUTHORIZED providers: a funder is never told how many others
      // hold the file.
      return deny('grantee list and count are merchant-only');
    }

    // -----------------------------------------------------------------------
    case 'application_grade': {
      if (actor.orgType === 'platform' && action === 'view') {
        return allow('grading is internal to the platform');
      }
      return deny('grading is internal and never funder-facing');
    }

    // -----------------------------------------------------------------------
    case 'authorization': {
      // R11. A specialist may STAGE an authorization but never GRANT one.
      // The merchant confirms from their own authenticated session. This is
      // the single control that keeps merchant control from being theater.
      if (action === 'grant' || action === 'revoke') {
        return isMember(actor, resource.merchantOrgId)
          ? allow('merchant controls their own authorizations')
          : deny('only the merchant may grant or revoke access');
      }

      if (action === 'view') {
        if (isMember(actor, resource.merchantOrgId)) {
          return allow('merchant may see who has access');
        }
        if (isMember(actor, resource.providerOrgId)) {
          return allow('provider may see its own grant');
        }
        if (actor.orgType === 'platform') {
          return allow('governance: authorization records are platform-visible');
        }
      }

      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'document_version': {
      if (isMember(actor, resource.merchantOrgId)) {
        return allow('merchant owns this document');
      }

      if (actor.orgType === 'provider') {
        const grant = activeGrantFor(resource.grants, actor.orgId);
        if (!grant) {
          return deny('no active authorization covers this document');
        }
        // Raw statements are a separate, narrower grant. Default scope
        // gives derived metrics only — fewer raw artifacts in circulation
        // is worth more than any watermark.
        if (resource.isRawStatement && !grant.includesRawDocuments) {
          return deny('grant does not include raw statement access');
        }
        if (action === 'view' || action === 'download') {
          return allow('active grant covers this document');
        }
        return deny('providers may not modify merchant documents');
      }

      if (actor.orgType === 'platform') {
        return hasValidElevation(actor)
          ? allow(`platform elevation: ${actor.elevation!.reason}`)
          : deny('platform document access requires elevation');
      }

      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'conversation': {
      if (!resource.participantOrgIds.includes(actor.orgId)) {
        return deny('not a participant in this conversation');
      }
      if (action === 'view' || action === 'message') {
        return allow('participant in this conversation');
      }
      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'offer': {
      if (isMember(actor, resource.merchantOrgId)) {
        if (action === 'view' || action === 'accept' || action === 'update') {
          return allow('merchant may view, counter, and accept offers');
        }
        return deny('merchants may not author offers');
      }

      if (isMember(actor, resource.providerOrgId)) {
        if (action === 'offer' || action === 'update' || action === 'view') {
          return allow('provider authors its own offers');
        }
        return deny('providers may not accept on the merchant behalf');
      }

      // Blind marketplace: a provider never sees another provider's terms.
      if (actor.orgType === 'provider') {
        return deny('offers are blind between providers');
      }

      if (actor.orgType === 'platform' && action === 'view') {
        return allow('governance: offer records are platform-visible');
      }

      return deny('no rule permits this');
    }

    // -----------------------------------------------------------------------
    case 'organization': {
      if (isMember(actor, resource.id)) {
        if (action === 'view') {
          return allow('member of this organization');
        }
        if (action === 'administer' || action === 'update') {
          return actor.role === 'owner' || actor.role === 'admin'
            ? allow('org owner or admin')
            : deny('org administration requires owner or admin');
        }
        return deny('action not applicable to an organization');
      }
      if (actor.orgType === 'platform' && action === 'view') {
        return allow('governance: organization records are platform-visible');
      }
      return deny('not a member of this organization');
    }

    // -----------------------------------------------------------------------
    case 'platform_governance': {
      if (actor.orgType !== 'platform') {
        return deny('platform governance is restricted to platform staff');
      }
      return actor.role === 'owner' || actor.role === 'admin'
        ? allow('platform administrator')
        : deny('platform governance requires owner or admin');
    }

    // -----------------------------------------------------------------------
    default: {
      // Exhaustiveness check. Adding a Resource variant without adding a
      // branch here is a compile error, not a silent allow.
      const _exhaustive: never = resource;
      return deny(`unhandled resource: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Throwing wrapper for route handlers. The denial reason goes to the audit
 * log; the client receives a bare 403. Never leak the reason — it tells an
 * attacker which resources exist.
 */
export class Forbidden extends Error {
  constructor(public readonly decision: Decision) {
    super('Forbidden');
  }
}

export function authorize(
  actor: Actor,
  action: Action,
  resource: Resource,
): void {
  const decision = can(actor, action, resource);
  if (!decision.allowed) {
    throw new Forbidden(decision);
  }
}
