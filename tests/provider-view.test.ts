/**
 * CapNet — Provider view resolution tests
 *
 * Companion to blinded.test.ts. That file proves the card contains nothing it
 * shouldn't. This one proves you only get past the card by holding a live
 * grant — and that the moment a merchant revokes, identity disappears.
 *
 * The sweep pattern is repeated deliberately: every path that should be
 * blinded is serialized and searched for sentinel values, so a future code
 * path that returns the wrong shape fails here rather than in production.
 *
 *   npx tsx tests/provider-view.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  resolveProviderView,
  documentInScope,
  isGrantLive,
  explainBlinded,
  type ActiveGrant,
  type DocumentSummary,
  type GrantScope,
} from '../lib/provider-view';
import type { FullApplicantRecord } from '../lib/blinded';

const SENTINEL_NAME = 'ZZSENTINEL Northshore Auto Repair LLC';
const SENTINEL_PHONE = 'ZZSENTINEL+15555550100';
const SENTINEL_STREET = 'ZZSENTINEL 418 Sycamore Ave';

const RECORD: FullApplicantRecord = {
  applicationId: 'app_1',
  legalName: SENTINEL_NAME,
  dba: 'ZZSENTINEL Northshore Auto',
  ownerNames: ['ZZSENTINEL Dana Whitfield'],
  ownerSsnToken: 'ZZSENTINEL-ssn-991',
  streetAddress: SENTINEL_STREET,
  phone: SENTINEL_PHONE,
  email: 'ZZSENTINEL@northshore.example',
  website: 'https://ZZSENTINEL.example',
  naicsCode: '811111',
  industryLabel: 'Auto repair',
  state: 'NJ',
  locality: 'Monmouth County',
  timeInBusinessMonths: 48,
  productType: 'mca',
  requestedAmount: 120000,
  preferredFrequency: 'daily',
  avgMonthlyRevenue: 95000,
  avgDailyBalance: 8400,
  negativeDays: 2,
  nsfCount: 0,
  depositCount: 62,
  monthsCovered: 4,
  financialConfidence: 'verified',
  positions: [{ balance: 18000, paymentAmount: 4200 }],
  selfReportedCreditBand: 'fair',
  grade: 'B',
  matchScore: 88,
  matchReasons: ['Revenue clears their minimum'],
  priorApplications: 1,
  priorFundings: 0,
  priorDeclines: 2,
  identityHash: 'a91f3c0e7b2d',
};

const SCOPE: GrantScope = {
  profile: true,
  financialSummary: true,
  documents: ['government_id', 'voided_check', 'bank_statement'],
  rawDocuments: false,
};

const grant = (over: Partial<ActiveGrant> = {}): ActiveGrant => ({
  authorizationId: 'auth_1',
  status: 'active',
  scope: SCOPE,
  expiresAt: null,
  ...over,
});

const DOCS: DocumentSummary[] = [
  { documentId: 'd1', currentVersionId: 'v1', docType: 'government_id', isRawStatement: false, versionNo: 1, uploadedAt: new Date(), periodStart: null, periodEnd: null },
  { documentId: 'd2', currentVersionId: 'v2', docType: 'voided_check', isRawStatement: false, versionNo: 1, uploadedAt: new Date(), periodStart: null, periodEnd: null },
  { documentId: 'd3', currentVersionId: 'v3', docType: 'bank_statement', isRawStatement: true, versionNo: 2, uploadedAt: new Date(), periodStart: '2026-07-01', periodEnd: '2026-07-31' },
  { documentId: 'd4', currentVersionId: 'v4', docType: 'tax_return', isRawStatement: true, versionNo: 1, uploadedAt: new Date(), periodStart: null, periodEnd: null },
];

const sweep = (v: unknown) => JSON.stringify(v).includes('ZZSENTINEL');

describe('identity requires a live grant', () => {
  it('no grant returns the blinded card', () => {
    const view = resolveProviderView(RECORD, null, DOCS);
    expect(view.kind).toBe('blinded');
    expect(sweep(view)).toBe(false);
  });

  it('a REVOKED grant returns the blinded card — identity disappears', () => {
    const view = resolveProviderView(RECORD, grant({ status: 'revoked' }), DOCS);
    expect(view.kind).toBe('blinded');
    expect(sweep(view)).toBe(false);
  });

  it('an EXPIRED grant returns the blinded card', () => {
    const view = resolveProviderView(
      RECORD,
      grant({ expiresAt: new Date(Date.now() - 1000) }),
      DOCS,
    );
    expect(view.kind).toBe('blinded');
    expect(sweep(view)).toBe(false);
  });

  it('a grant whose scope excludes the profile returns the blinded card', () => {
    const view = resolveProviderView(
      RECORD,
      grant({ scope: { ...SCOPE, profile: false } }),
      DOCS,
    );
    expect(view.kind).toBe('blinded');
    expect(sweep(view)).toBe(false);
  });

  it('an ACTIVE grant returns the full file with identity', () => {
    const view = resolveProviderView(RECORD, grant(), DOCS);
    expect(view.kind).toBe('full');
    if (view.kind === 'full') {
      expect(view.file.identity.legalName).toBe(SENTINEL_NAME);
      expect(view.file.identity.phone).toBe(SENTINEL_PHONE);
      expect(view.file.identity.streetAddress).toBe(SENTINEL_STREET);
    }
  });

  it('the SSN token never crosses, even on a full grant', () => {
    const view = resolveProviderView(RECORD, grant(), DOCS);
    expect(JSON.stringify(view).includes('ssn')).toBe(false);
  });
});

describe('document scope', () => {
  it('raw statements are hidden when rawDocuments is off', () => {
    const view = resolveProviderView(RECORD, grant(), DOCS);
    if (view.kind !== 'full') throw new Error('expected full view');
    const types = view.file.documents.map((d) => d.docType);
    expect(types.includes('bank_statement')).toBe(false);
    expect(types.includes('government_id')).toBe(true);
    expect(types.includes('voided_check')).toBe(true);
  });

  it('raw statements appear once the merchant turns rawDocuments on', () => {
    const view = resolveProviderView(
      RECORD,
      grant({ scope: { ...SCOPE, rawDocuments: true } }),
      DOCS,
    );
    if (view.kind !== 'full') throw new Error('expected full view');
    expect(view.file.documents.map((d) => d.docType).includes('bank_statement')).toBe(true);
  });

  it('a doc type outside scope stays hidden even when rawDocuments is on', () => {
    const view = resolveProviderView(
      RECORD,
      grant({ scope: { ...SCOPE, rawDocuments: true } }),
      DOCS,
    );
    if (view.kind !== 'full') throw new Error('expected full view');
    expect(view.file.documents.map((d) => d.docType).includes('tax_return')).toBe(false);
  });

  it('out-of-scope documents are counted, not listed', () => {
    const view = resolveProviderView(RECORD, grant(), DOCS);
    if (view.kind !== 'full') throw new Error('expected full view');
    expect(view.file.documents.length).toBe(2);
    expect(view.file.documentsOutsideScope).toBe(2);
  });

  it('scope rule matches policy.ts exactly', () => {
    expect(documentInScope(DOCS[2], SCOPE)).toBe(false);
    expect(documentInScope(DOCS[2], { ...SCOPE, rawDocuments: true })).toBe(true);
    expect(documentInScope(DOCS[0], SCOPE)).toBe(true);
  });
});

describe('grant liveness', () => {
  it('null, revoked, and expired are all not live', () => {
    expect(isGrantLive(null)).toBe(false);
    expect(isGrantLive(grant({ status: 'revoked' }))).toBe(false);
    expect(isGrantLive(grant({ expiresAt: new Date(Date.now() - 1) }))).toBe(false);
  });

  it('active with no expiry, or a future expiry, is live', () => {
    expect(isGrantLive(grant())).toBe(true);
    expect(isGrantLive(grant({ expiresAt: new Date(Date.now() + 86400000) }))).toBe(true);
  });
});

describe('funder-facing messaging', () => {
  it('never invites a funder to call and ask why access ended', () => {
    const text = explainBlinded('grant_revoked').toLowerCase();
    expect(text.includes('merchant')).toBe(false);
    expect(text.includes('contact')).toBe(false);
    expect(text.includes('call')).toBe(false);
  });

  it('every reason has a message', () => {
    for (const r of ['no_grant', 'grant_revoked', 'grant_expired', 'profile_not_in_scope'] as const) {
      expect(explainBlinded(r).length).toBeGreaterThan(5);
    }
  });
});
