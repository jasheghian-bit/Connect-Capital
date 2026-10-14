/**
 * CapNet — Analytics tests
 *
 * The humility gate is the feature under test. Twenty pilot deals producing a
 * 65% funding rate is noise, and the temptation to put it in a deck is the
 * single most likely way this company tells itself something false.
 *
 *   npx tsx tests/analytics.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  scorecard,
  marketplaceMetrics,
  summarize,
  readyToReport,
  type FunnelCounts,
} from '../lib/analytics';

const EMPTY: FunnelCounts = {
  prequalStarted: 0, applicationsStarted: 0, applicationsSubmitted: 0, applicationsRepeat: 0,
  providersOffered: 0, providersAuthorized: 0, authorizationsRevoked: 0,
  applicationsWithMerchantMessage: 0, applicationsAuthorized: 0,
  authorizedReviewed: 0, authorizedOffered: 0, offersAccepted: 0, deals: 0,
  feesAccrued: 0, feesPaid: 0, feesDisputed: 0,
  documentRequestsTotal: 0,
  fundedWithSpecialist: 0, fundedWithoutSpecialist: 0, specialistRequested: 0,
  medianPaymentToRevenue: null, medianHoursToFirstOffer: null, medianHoursToFirstTouch: null,
};

const PILOT: FunnelCounts = {
  ...EMPTY,
  applicationsStarted: 8, applicationsSubmitted: 5,
  providersOffered: 40, providersAuthorized: 12,
  applicationsAuthorized: 5, authorizedReviewed: 9, authorizedOffered: 6,
  deals: 3, feesAccrued: 3, feesPaid: 2,
  fundedWithoutSpecialist: 3, medianPaymentToRevenue: 0.28,
};

const SCALED: FunnelCounts = {
  ...EMPTY,
  applicationsStarted: 400, applicationsSubmitted: 260,
  providersOffered: 1900, providersAuthorized: 640, authorizationsRevoked: 58,
  applicationsWithMerchantMessage: 150, applicationsAuthorized: 240,
  authorizedReviewed: 590, authorizedOffered: 310, offersAccepted: 120, deals: 104,
  feesAccrued: 104, feesPaid: 96, feesDisputed: 2,
  documentRequestsTotal: 300,
  fundedWithSpecialist: 14, fundedWithoutSpecialist: 90, specialistRequested: 41,
  medianPaymentToRevenue: 0.24, medianHoursToFirstOffer: 19, medianHoursToFirstTouch: 6,
};

describe('the humility gate', () => {
  it('reports nothing at all on an empty platform', () => {
    for (const h of scorecard(EMPTY)) {
      expect(h.verdict.status).toBe('insufficient_data');
    }
  });

  it('a three-deal pilot cannot measure the funding hypotheses', () => {
    const byId = new Map(scorecard(PILOT).map((h) => [h.id, h]));
    expect(byId.get('H5').verdict.status).toBe('insufficient_data');
    expect(byId.get('H6').verdict.status).toBe('insufficient_data');
    expect(byId.get('H9').verdict.status).toBe('insufficient_data');
  });

  it('says how many more observations are needed, not just "not enough"', () => {
    const h5 = scorecard(PILOT).find((h) => h.id === 'H5');
    if (h5.verdict.status !== 'insufficient_data') throw new Error('expected gate');
    expect(h5.verdict.have).toBe(3);
    expect(h5.verdict.need > 3).toBe(true);
  });

  it('at scale the hypotheses become measurable', () => {
    const measured = scorecard(SCALED).filter((h) => h.verdict.status === 'measured');
    expect(measured.length >= 8).toBe(true);
  });

  it('a metric with a zero denominator never divides', () => {
    const h = scorecard({ ...SCALED, providersOffered: 0 }).find((x) => x.id === 'H2');
    expect(h.verdict.status).toBe('insufficient_data');
  });
});

describe('the numbers themselves', () => {
  const byId = new Map(scorecard(SCALED).map((h) => [h.id, h]));

  it('H2 measures the share of offered providers actually authorized', () => {
    const v = byId.get('H2').verdict;
    if (v.status !== 'measured') throw new Error('expected measured');
    expect(Math.abs(v.value - 640 / 1900) < 0.01).toBe(true);
  });

  it('H9 counts fundings with no specialist against all fundings', () => {
    const v = byId.get('H9').verdict;
    if (v.status !== 'measured') throw new Error('expected measured');
    expect(Math.abs(v.value - 90 / 104) < 0.01).toBe(true);
  });

  it('H6 reports payment-to-revenue, the leading indicator', () => {
    const v = byId.get('H6').verdict;
    if (v.status !== 'measured') throw new Error('expected measured');
    expect(v.value).toBe(0.24);
  });
});

describe('caveats travel with the numbers', () => {
  it('every hypothesis carries one', () => {
    for (const h of scorecard(SCALED)) {
      expect(h.caveat.length > 30).toBe(true);
    }
  });

  it('H6 warns explicitly against presenting it as proven', () => {
    const h6 = scorecard(SCALED).find((h) => h.id === 'H6');
    expect(h6.caveat.toLowerCase().includes('do not present this as proven')).toBe(true);
  });

  it('H7 names the missing baseline rather than implying it exists', () => {
    const h7 = scorecard(SCALED).find((h) => h.id === 'H7');
    expect(h7.caveat.toLowerCase().includes('baseline')).toBe(true);
  });
});

describe('summaries are deck-ready and honest', () => {
  it('an ungated metric reads as a rate with its sample size', () => {
    const h = scorecard(SCALED).find((x) => x.id === 'H2');
    const s = summarize(h);
    expect(s.includes('%')).toBe(true);
    expect(s.includes('observations')).toBe(true);
  });

  it('a gated metric says so and names what would settle it', () => {
    const h = scorecard(PILOT).find((x) => x.id === 'H5');
    expect(summarize(h).includes('not yet measurable')).toBe(true);
  });

  it('separates what can be reported from what cannot', () => {
    const r = readyToReport(scorecard(PILOT));
    expect(r.pending.length > r.measured.length).toBe(true);
  });
});

describe('marketplace metrics', () => {
  it('gate on thin samples like everything else', () => {
    expect(marketplaceMetrics(PILOT).fundingConversion.status).toBe('insufficient_data');
  });

  it('report at scale', () => {
    const m = marketplaceMetrics(SCALED);
    expect(m.fundingConversion.status).toBe('measured');
    expect(m.hoursToFirstOffer.status).toBe('measured');
  });
});
