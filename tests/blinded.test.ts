/**
 * CapNet — Blinded card tests
 *
 * The most important test file in the repo.
 *
 * Everything else protects a promise the merchant can verify for themselves.
 * This protects one they cannot: that a funder who has NOT been authorized
 * cannot identify or contact them. If this leaks, nobody finds out from the
 * product — they find out from a phone call.
 *
 * The sweep test below is the point. Field-by-field assertions only catch
 * what someone remembered to assert; a sweep for sentinel values catches the
 * field nobody thought about, which is always the one that leaks.
 *
 *   npx tsx tests/blinded.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  toBlindedCard,
  estimatePaymentToRevenue,
  FORBIDDEN_PRE_AUTHORIZATION,
  type FullApplicantRecord,
} from '../lib/blinded';

const SENTINELS = {
  legalName: 'ZZSENTINEL Northshore Auto Repair LLC',
  dba: 'ZZSENTINEL Northshore Auto',
  owner: 'ZZSENTINEL Dana Whitfield',
  ssn: 'ZZSENTINEL-ssn-token-991',
  street: 'ZZSENTINEL 418 Sycamore Ave',
  phone: 'ZZSENTINEL+15555550100',
  email: 'ZZSENTINEL@northshore.example',
  website: 'https://ZZSENTINEL.example',
};

const RECORD: FullApplicantRecord = {
  applicationId: 'app_1',
  legalName: SENTINELS.legalName,
  dba: SENTINELS.dba,
  ownerNames: [SENTINELS.owner],
  ownerSsnToken: SENTINELS.ssn,
  streetAddress: SENTINELS.street,
  phone: SENTINELS.phone,
  email: SENTINELS.email,
  website: SENTINELS.website,

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
  matchReasons: ['Revenue clears their minimum', 'New Jersey is accepted'],

  priorApplications: 1,
  priorFundings: 0,
  priorDeclines: 2,

  identityHash: 'a91f3c0e7b2d',
};

describe('blinded card — identity containment', () => {
  const card = toBlindedCard(RECORD);
  const serialized = JSON.stringify(card);

  for (const [label, value] of Object.entries(SENTINELS)) {
    it(`LEAK SWEEP — no trace of ${label} anywhere in the card`, () => {
      expect(serialized.includes(value)).toBe(false);
    });
  }

  it('LEAK SWEEP — no ZZSENTINEL marker survives serialization at all', () => {
    expect(serialized.includes('ZZSENTINEL')).toBe(false);
  });

  for (const field of FORBIDDEN_PRE_AUTHORIZATION) {
    it(`LEAK SWEEP — key "${field}" is absent from the card`, () => {
      expect(serialized.includes(`"${field}"`)).toBe(false);
    });
  }

  it('contact information is unreachable — the circumvention vector', () => {
    expect(serialized.toLowerCase().includes('phone')).toBe(false);
    expect(serialized.toLowerCase().includes('email')).toBe(false);
  });
});

describe('blinded card — underwriting substance', () => {
  const card = toBlindedCard(RECORD);

  it('carries enough to triage: revenue, balance, negatives, deposits', () => {
    expect(card.financials.avgMonthlyRevenue).toBe(95000);
    expect(card.financials.avgDailyBalance).toBe(8400);
    expect(card.financials.negativeDays).toBe(2);
    expect(card.financials.depositCount).toBe(62);
  });

  it('carries existing positions — the first thing an MCA underwriter checks', () => {
    expect(card.obligations.positionCount).toBe(1);
    expect(card.obligations.totalBalance).toBe(18000);
    expect(card.obligations.totalPaymentAmount).toBe(4200);
  });

  it('carries exact time in business, not a band', () => {
    expect(card.timeInBusinessMonths).toBe(48);
  });

  it('carries state and locality but never the street', () => {
    expect(card.location.state).toBe('NJ');
    expect(card.location.locality).toBe('Monmouth County');
  });

  it('carries the identity hash so pipeline and exclusion checks work', () => {
    expect(card.identityHash).toBe('a91f3c0e7b2d');
  });

  it('carries data confidence so a funder knows what is verified', () => {
    expect(card.financials.confidence).toBe('verified');
  });

  it('carries prior platform history including declines', () => {
    expect(card.platformHistory.priorDeclines).toBe(2);
  });
});

describe('payment-to-revenue estimate', () => {
  it('accounts for both the new payment and existing obligations', () => {
    const ratio = estimatePaymentToRevenue(RECORD);
    expect(ratio !== null).toBe(true);
    expect(ratio > 0.3).toBe(true);
    expect(ratio < 0.4).toBe(true);
  });

  it('returns null rather than a fabricated ratio when revenue is unknown', () => {
    expect(estimatePaymentToRevenue({ ...RECORD, avgMonthlyRevenue: null })).toBe(null);
    expect(estimatePaymentToRevenue({ ...RECORD, avgMonthlyRevenue: 0 })).toBe(null);
  });

  it('rises when the merchant already carries positions', () => {
    const clean = estimatePaymentToRevenue({ ...RECORD, positions: [] });
    const stacked = estimatePaymentToRevenue(RECORD);
    expect(stacked > clean).toBe(true);
  });
});
