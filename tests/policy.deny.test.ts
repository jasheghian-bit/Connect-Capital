/**
 * CapNet — The Deny Suite
 *
 * This file is the specification. policy.ts is the implementation.
 *
 * Most test suites prove that the thing works. This one proves that the thing
 * REFUSES — which for a platform whose entire product is "the merchant decides
 * who sees their bank statements" is the only property that matters. A feature
 * that silently works for the wrong actor is worse than a feature that is
 * broken, because nobody files a bug for it.
 *
 * Every case here maps to a claim the company makes to a merchant or a funder.
 * If a case is deleted, a promise was quietly withdrawn.
 *
 *   vitest run tests/policy.deny.test.ts
 */

import { describe, it, expect } from 'vitest';
import { can, type Actor, type Action, type Resource } from '../lib/policy';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MERCHANT_A = 'org_merchant_a';
const MERCHANT_B = 'org_merchant_b';
const PROVIDER_1 = 'org_provider_1';
const PROVIDER_2 = 'org_provider_2';
const SPECIALIST = 'org_specialist';
const PLATFORM = 'org_platform';

const APP_A = 'app_a';

const actor = (
  orgId: string,
  orgType: Actor['orgType'],
  role: Actor['role'] = 'owner',
  extra: Partial<Actor> = {},
): Actor => ({
  userId: `user_of_${orgId}`,
  orgId,
  orgType,
  role,
  ...extra,
});

const merchantA = actor(MERCHANT_A, 'merchant');
const merchantB = actor(MERCHANT_B, 'merchant');
const provider1 = actor(PROVIDER_1, 'provider', 'rep');
const provider2 = actor(PROVIDER_2, 'provider', 'rep');
const specialist = actor(SPECIALIST, 'specialist', 'specialist');
const platformPlain = actor(PLATFORM, 'platform', 'admin');
const platformElevated = actor(PLATFORM, 'platform', 'admin', {
  elevation: {
    reason: 'dispute #114 — merchant alleges off-platform contact',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
});
const platformExpired = actor(PLATFORM, 'platform', 'admin', {
  elevation: { reason: 'stale', expiresAt: new Date(Date.now() - 1000) },
});

// Resource builders -----------------------------------------------------------

const application = (): Resource => ({
  kind: 'application',
  id: APP_A,
  merchantOrgId: MERCHANT_A,
  status: 'in_underwriting',
});

const blindedCard = (matched: string[]): Resource => ({
  kind: 'application_blinded',
  id: APP_A,
  merchantOrgId: MERCHANT_A,
  matchedProviderOrgIds: matched,
});

const authorization = (providerOrgId: string): Resource => ({
  kind: 'authorization',
  id: 'auth_1',
  applicationId: APP_A,
  merchantOrgId: MERCHANT_A,
  providerOrgId,
  status: 'active',
  scopeIncludesRawDocuments: false,
});

/**
 * `grants` contains ACTIVE authorizations only. A revoked grant is absent from
 * the array — revocation is modelled as disappearance, not as a status the
 * policy has to remember to check. One fewer way to get it wrong.
 */
const documentVersion = (
  isRawStatement: boolean,
  grants: Array<{ providerOrgId: string; includesRawDocuments: boolean }>,
): Resource => ({
  kind: 'document_version',
  id: 'docv_1',
  merchantOrgId: MERCHANT_A,
  applicationId: APP_A,
  isRawStatement,
  grants,
});

const conversation = (participants: string[]): Resource => ({
  kind: 'conversation',
  id: 'conv_1',
  applicationId: APP_A,
  merchantOrgId: MERCHANT_A,
  participantOrgIds: participants,
});

const offer = (providerOrgId: string): Resource => ({
  kind: 'offer',
  id: 'offer_1',
  applicationId: APP_A,
  merchantOrgId: MERCHANT_A,
  providerOrgId,
});

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface Case {
  claim: string;
  actor: Actor;
  action: Action;
  resource: Resource;
  allowed: boolean;
}

const CASES: Case[] = [
  // --- R11: merchant control is not delegable -------------------------------
  {
    claim: 'a provider can never grant itself access',
    actor: provider1,
    action: 'grant',
    resource: authorization(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'a Funding Specialist can stage but never grant an authorization',
    actor: specialist,
    action: 'grant',
    resource: authorization(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'platform admins cannot grant access on a merchant behalf',
    actor: platformElevated,
    action: 'grant',
    resource: authorization(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'the merchant grants access from their own session',
    actor: merchantA,
    action: 'grant',
    resource: authorization(PROVIDER_1),
    allowed: true,
  },
  {
    claim: 'the merchant revokes access from their own session',
    actor: merchantA,
    action: 'revoke',
    resource: authorization(PROVIDER_1),
    allowed: true,
  },
  {
    claim: 'a provider cannot revoke its own revocation',
    actor: provider1,
    action: 'revoke',
    resource: authorization(PROVIDER_1),
    allowed: false,
  },

  // --- Documents: the promise the whole company rests on ---------------------
  {
    claim: 'an unauthorized provider cannot view a document',
    actor: provider1,
    action: 'view',
    resource: documentVersion(false, []),
    allowed: false,
  },
  {
    claim: 'an unauthorized provider cannot download a document',
    actor: provider1,
    action: 'download',
    resource: documentVersion(false, []),
    allowed: false,
  },
  {
    claim: 'a REVOKED provider loses access immediately',
    actor: provider1,
    action: 'view',
    // Revoked -> absent from grants.
    resource: documentVersion(false, [
      { providerOrgId: PROVIDER_2, includesRawDocuments: true },
    ]),
    allowed: false,
  },
  {
    claim: 'an authorized provider can view a derived document',
    actor: provider1,
    action: 'view',
    resource: documentVersion(false, [
      { providerOrgId: PROVIDER_1, includesRawDocuments: false },
    ]),
    allowed: true,
  },
  {
    claim:
      'a metrics-only grant does NOT reach raw bank statements — raw access is a separate consent',
    actor: provider1,
    action: 'view',
    resource: documentVersion(true, [
      { providerOrgId: PROVIDER_1, includesRawDocuments: false },
    ]),
    allowed: false,
  },
  {
    claim: 'an explicit raw-document grant does reach raw statements',
    actor: provider1,
    action: 'download',
    resource: documentVersion(true, [
      { providerOrgId: PROVIDER_1, includesRawDocuments: true },
    ]),
    allowed: true,
  },
  {
    claim: 'a provider cannot modify a merchant document',
    actor: provider1,
    action: 'update',
    resource: documentVersion(false, [
      { providerOrgId: PROVIDER_1, includesRawDocuments: true },
    ]),
    allowed: false,
  },
  {
    claim: 'another merchant cannot reach this merchant documents',
    actor: merchantB,
    action: 'view',
    resource: documentVersion(false, []),
    allowed: false,
  },

  // --- Blind marketplace -----------------------------------------------------
  {
    claim: 'a provider cannot see a competitor offer',
    actor: provider2,
    action: 'view',
    resource: offer(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'a provider authors its own offer',
    actor: provider1,
    action: 'offer',
    resource: offer(PROVIDER_1),
    allowed: true,
  },
  {
    claim: 'a provider cannot accept an offer on the merchant behalf',
    actor: provider1,
    action: 'accept',
    resource: offer(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'a merchant cannot author an offer',
    actor: merchantA,
    action: 'offer',
    resource: offer(PROVIDER_1),
    allowed: false,
  },
  {
    claim: 'the merchant compares and accepts',
    actor: merchantA,
    action: 'accept',
    resource: offer(PROVIDER_1),
    allowed: true,
  },

  // --- Pre-authorization blinding -------------------------------------------
  {
    claim: 'an unmatched provider cannot see the blinded card',
    actor: provider2,
    action: 'view',
    resource: blindedCard([PROVIDER_1]),
    allowed: false,
  },
  {
    claim: 'a matched provider can see the blinded card',
    actor: provider1,
    action: 'view',
    resource: blindedCard([PROVIDER_1]),
    allowed: true,
  },
  {
    claim: 'blinded cards are read-only even for matched providers',
    actor: provider1,
    action: 'update',
    resource: blindedCard([PROVIDER_1]),
    allowed: false,
  },

  // --- Applications ----------------------------------------------------------
  {
    claim: 'a merchant cannot read another merchant application',
    actor: merchantB,
    action: 'view',
    resource: application(),
    allowed: false,
  },
  {
    claim: 'providers never read the application row directly',
    actor: provider1,
    action: 'view',
    resource: application(),
    allowed: false,
  },
  {
    claim: 'an unassigned specialist cannot read an application',
    actor: specialist,
    action: 'view',
    resource: application(),
    allowed: false,
  },

  // --- Platform elevation ----------------------------------------------------
  {
    claim: 'platform staff cannot read merchant applications without elevation',
    actor: platformPlain,
    action: 'view',
    resource: application(),
    allowed: false,
  },
  {
    claim: 'expired elevation is no elevation',
    actor: platformExpired,
    action: 'view',
    resource: application(),
    allowed: false,
  },
  {
    claim: 'valid elevation permits investigation, and is logged',
    actor: platformElevated,
    action: 'view',
    resource: application(),
    allowed: true,
  },
  {
    claim: 'platform staff cannot read merchant documents without elevation',
    actor: platformPlain,
    action: 'download',
    resource: documentVersion(true, []),
    allowed: false,
  },
  {
    claim: 'governance work needs no elevation',
    actor: platformPlain,
    action: 'administer',
    resource: { kind: 'platform_governance' },
    allowed: true,
  },
  {
    claim: 'a provider cannot reach platform governance',
    actor: provider1,
    action: 'administer',
    resource: { kind: 'platform_governance' },
    allowed: false,
  },
  {
    claim: 'a merchant cannot reach platform governance',
    actor: merchantA,
    action: 'administer',
    resource: { kind: 'platform_governance' },
    allowed: false,
  },

  // --- Messaging -------------------------------------------------------------
  {
    claim: 'a non-participant cannot read a conversation',
    actor: provider2,
    action: 'view',
    resource: conversation([MERCHANT_A, PROVIDER_1]),
    allowed: false,
  },
  {
    claim: 'a non-participant cannot post to a conversation',
    actor: provider2,
    action: 'message',
    resource: conversation([MERCHANT_A, PROVIDER_1]),
    allowed: false,
  },
  {
    claim: 'participants converse',
    actor: provider1,
    action: 'message',
    resource: conversation([MERCHANT_A, PROVIDER_1]),
    allowed: true,
  },

  // --- Organizations ---------------------------------------------------------
  {
    claim: 'a rep cannot administer their own org',
    actor: provider1,
    action: 'administer',
    resource: { kind: 'organization', id: PROVIDER_1 },
    allowed: false,
  },
  {
    claim: 'an owner administers their own org',
    actor: actor(PROVIDER_1, 'provider', 'owner'),
    action: 'administer',
    resource: { kind: 'organization', id: PROVIDER_1 },
    allowed: true,
  },
  {
    claim: 'no org reaches another org record',
    actor: provider1,
    action: 'view',
    resource: { kind: 'organization', id: PROVIDER_2 },
    allowed: false,
  },
];

// ---------------------------------------------------------------------------

describe('permission model', () => {
  for (const c of CASES) {
    const label = `${c.allowed ? 'ALLOW' : 'DENY '} — ${c.claim}`;
    it(label, () => {
      const decision = can(c.actor, c.action, c.resource);
      expect(decision.allowed, `${label}\n  reason: ${decision.reason}`).toBe(
        c.allowed,
      );
    });
  }

  it('every decision carries a reason for the audit log', () => {
    for (const c of CASES) {
      const decision = can(c.actor, c.action, c.resource);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it('the suite is majority denials — that is the point', () => {
    const denials = CASES.filter((c) => !c.allowed).length;
    expect(denials).toBeGreaterThan(CASES.length / 2);
  });
});

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------
//
// isRawStatementType decides whether a document falls under the separate
// raw-statement consent. A wrong answer here silently widens what a
// metrics-only authorization reaches — the quietest possible way to break the
// platform's central promise, because nothing errors and nothing looks wrong.

import { isRawStatementType } from '../lib/doc-classification';

describe('raw statement classification', () => {
  const RAW = ['bank_statement', 'tax_return', 'financial_statement'] as const;
  const NOT_RAW = ['government_id', 'voided_check', 'business_license', 'lease_agreement', 'other'] as const;

  for (const t of RAW) {
    it(`RAW   — ${t} requires the separate consent`, () => {
      expect(isRawStatementType(t)).toBe(true);
    });
  }
  for (const t of NOT_RAW) {
    it(`PLAIN — ${t} is covered by a standard grant`, () => {
      expect(isRawStatementType(t)).toBe(false);
    });
  }
});
