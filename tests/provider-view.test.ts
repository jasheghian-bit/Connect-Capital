/**
 * CapNet — Provider view resolution tests
 *
 * Founder decision, Sep 2026: a funder without a live grant sees NOTHING —
 * not identity, not a summary, not industry, state, revenue, or grade. The
 * moment a merchant revokes, or a grant expires, the funder is back to nothing.
 *
 * Every no-access path is serialized and compared against a bare
 * { kind: 'no_access' }, and swept for every value in the record, so a future
 * code path that returns any applicant data fails here rather than in
 * production. Absorbs the old blinded-card tests (allowlist, payment ratio).
 *
 *   npx tsx tests/provider-view.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  resolveProviderView,
  documentInScope,
  isGrantLive,
  explainNoAccess,
  toFileSummary,
  estimatePaymentToRevenue,
  NEVER_FUNDER_FACING,
  type FullApplicantRecord,
  type ActiveGrant,
  type DocumentSummary,
  type GrantScope,
} from '../lib/provider-view';

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

/** Every distinctive value in RECORD that must not reach an unauthorized funder. */
const NON_IDENTITY_VALUES = ['811111', 'Auto repair', 'Monmouth County', '120000', '95000', '8400', 'a91f3c0e7b2d', 'Revenue clears'];

const assertNothing = (view: unknown) => {
  expect(JSON.stringify(view)).toBe(JSON.stringify({ kind: 'no_access' }));
  const text = JSON.stringify(view);
  expect(text.includes('ZZSENTINEL')).toBe(false);
  for (const v of NON_IDENTITY_VALUES) expect(text.includes(v)).toBe(false);
};

describe('nothing without a live grant', () => {
  it('no grant (matched or not) returns no_access with no applicant data', () => {
    assertNothing(resolveProviderView(RECORD, null, DOCS));
  });

  it('a REVOKED grant returns no_access — nothing remains', () => {
    assertNothing(resolveProviderView(RECORD, grant({ status: 'revoked' }), DOCS));
  });

  it('an EXPIRED grant returns no_access', () => {
    assertNothing(
      resolveProviderView(RECORD, grant({ expiresAt: new Date(Date.now() - 1000) }), DOCS),
    );
  });

  it('a grant whose scope excludes the profile returns no_access', () => {
    assertNothing(
      resolveProviderView(RECORD, grant({ scope: { ...SCOPE, profile: false } }), DOCS),
    );
  });

  it('no_access is identical for every cause — the cause itself is not leaked', () => {
    const views = [
      resolveProviderView(RECORD, null, DOCS),
      resolveProviderView(RECORD, grant({ status: 'revoked' }), DOCS),
      resolveProviderView(RECORD, grant({ status: 'expired' }), DOCS),
    ].map((v) => JSON.stringify(v));
    expect(new Set(views).size).toBe(1);
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

describe('authorized view never carries internal fields', () => {
  it('no grade, match score, match reasons, or grantee count in the full file', () => {
    const view = resolveProviderView(RECORD, grant(), DOCS);
    expect(view.kind).toBe('full');
    const text = JSON.stringify(view);
    for (const key of NEVER_FUNDER_FACING) {
      expect(text.includes(`"${key}"`)).toBe(false);
    }
    expect(text.includes('Revenue clears')).toBe(false);
  });

  it('the summary is allowlisted: a new internal field does not ship', () => {
    const extended = { ...RECORD, internalRiskNote: 'ZZINTERNAL do not show' } as FullApplicantRecord;
    expect(JSON.stringify(toFileSummary(extended)).includes('ZZINTERNAL')).toBe(false);
  });

  it('carries underwriting substance once authorized', () => {
    const s = toFileSummary(RECORD);
    expect(s.financials.avgMonthlyRevenue).toBe(95000);
    expect(s.obligations.positionCount).toBe(1);
    expect(s.obligations.totalPaymentAmount).toBe(4200);
    expect(s.timeInBusinessMonths).toBe(48);
  });
});

describe('payment-to-revenue estimate', () => {
  it('accounts for both the new payment and existing obligations', () => {
    const ratio = estimatePaymentToRevenue(RECORD)!;
    expect(ratio > 0.3).toBe(true);
    expect(ratio < 0.4).toBe(true);
  });

  it('returns null rather than a fabricated ratio when revenue is unknown', () => {
    expect(estimatePaymentToRevenue({ ...RECORD, avgMonthlyRevenue: null })).toBe(null);
    expect(estimatePaymentToRevenue({ ...RECORD, avgMonthlyRevenue: 0 })).toBe(null);
  });

  it('rises when the merchant already carries positions', () => {
    const clean = estimatePaymentToRevenue({ ...RECORD, positions: [] })!;
    expect(estimatePaymentToRevenue(RECORD)! > clean).toBe(true);
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
  it('never invites a funder to call, and never names a cause', () => {
    const text = explainNoAccess().toLowerCase();
    for (const w of ['contact', 'call', 'revoked', 'expired', 'matched', 'ended', 'awaiting']) {
      expect(text.includes(w)).toBe(false);
    }
  });
});
