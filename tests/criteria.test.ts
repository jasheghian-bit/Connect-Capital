/**
 * Connect Capital — Criteria evaluation tests
 *
 * This logic decides which funders a merchant sees and what reason they're
 * given. A wrong answer here is not a crash — it's a merchant quietly not
 * shown a funder who would have funded them, or shown one who never would.
 * Neither surfaces as a bug report.
 *
 *   npx tsx tests/criteria.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  evaluate,
  scoreProvider,
  explainForMerchant,
  type Criterion,
  type ApplicantProfile,
} from '../lib/criteria';

const hard = (c: Partial<Criterion> & Pick<Criterion, 'key' | 'operator' | 'value'>): Criterion => ({
  isHard: true,
  weight: 1,
  requiresVerified: false,
  ...c,
});

const PROFILE: ApplicantProfile = {
  amount: { value: 120000, confidence: 'stated' },
  monthly_revenue: { value: 95000, confidence: 'verified' },
  time_in_business_months: { value: 48, confidence: 'verified' },
  negative_days: { value: 2, confidence: 'verified' },
  position_count: { value: 1, confidence: 'verified' },
  state: { value: 'NJ', confidence: 'stated' },
  credit_band: { value: 'fair', confidence: 'stated' },
  months_covered: { value: 4, confidence: 'verified' },
};

describe('threshold evaluation', () => {
  it('passes when revenue clears the minimum', () => {
    const r = evaluate(hard({ key: 'monthly_revenue', operator: 'gte', value: 40000 }), PROFILE);
    expect(r.passed).toBe(true);
  });

  it('fails when revenue is below the minimum', () => {
    const r = evaluate(hard({ key: 'monthly_revenue', operator: 'gte', value: 150000 }), PROFILE);
    expect(r.passed).toBe(false);
    expect(r.failureMode).toBe('threshold');
  });

  it('lte inverts correctly — fewer negative days is better', () => {
    expect(evaluate(hard({ key: 'negative_days', operator: 'lte', value: 3 }), PROFILE).passed).toBe(true);
    expect(evaluate(hard({ key: 'negative_days', operator: 'lte', value: 1 }), PROFILE).passed).toBe(false);
  });

  it('between is inclusive at both ends', () => {
    expect(evaluate(hard({ key: 'amount', operator: 'between', value: [120000, 500000] }), PROFILE).passed).toBe(true);
    expect(evaluate(hard({ key: 'amount', operator: 'between', value: [25000, 120000] }), PROFILE).passed).toBe(true);
    expect(evaluate(hard({ key: 'amount', operator: 'between', value: [130000, 500000] }), PROFILE).passed).toBe(false);
  });

  it('in and not_in handle state lists', () => {
    expect(evaluate(hard({ key: 'state', operator: 'in', value: ['NJ', 'NY', 'PA'] }), PROFILE).passed).toBe(true);
    expect(evaluate(hard({ key: 'state', operator: 'not_in', value: ['CA', 'NJ'] }), PROFILE).passed).toBe(false);
  });

  it('credit bands compare by rank, not alphabetically', () => {
    expect(evaluate(hard({ key: 'credit_band', operator: 'gte', value: 'poor' }), PROFILE).passed).toBe(true);
    expect(evaluate(hard({ key: 'credit_band', operator: 'gte', value: 'good' }), PROFILE).passed).toBe(false);
  });
});

describe('data quality gates', () => {
  it('missing data fails as missing, not as a threshold miss', () => {
    const r = evaluate(hard({ key: 'nsf_count', operator: 'lte', value: 2 }), PROFILE);
    expect(r.passed).toBe(false);
    expect(r.failureMode).toBe('missing_data');
  });

  it('requiresVerified rejects a self-reported number that would otherwise pass', () => {
    const r = evaluate(
      hard({ key: 'amount', operator: 'lte', value: 500000, requiresVerified: true }),
      PROFILE,
    );
    expect(r.passed).toBe(false);
    expect(r.failureMode).toBe('unverified_data');
  });

  it('requiresVerified accepts bank-derived data', () => {
    const r = evaluate(
      hard({ key: 'monthly_revenue', operator: 'gte', value: 40000, requiresVerified: true }),
      PROFILE,
    );
    expect(r.passed).toBe(true);
  });
});

describe('provider scoring', () => {
  it('any hard failure excludes the provider entirely', () => {
    const out = scoreProvider(
      [
        hard({ key: 'monthly_revenue', operator: 'gte', value: 40000 }),
        hard({ key: 'state', operator: 'in', value: ['CA'] }),
      ],
      PROFILE,
    );
    expect(out.result).toBe('no_match');
    expect(out.score).toBe(0);
  });

  it('all criteria clean is a full match', () => {
    const out = scoreProvider(
      [
        hard({ key: 'monthly_revenue', operator: 'gte', value: 40000 }),
        hard({ key: 'state', operator: 'in', value: ['NJ', 'NY'] }),
        hard({ key: 'time_in_business_months', operator: 'gte', value: 12 }),
      ],
      PROFILE,
    );
    expect(out.result).toBe('match');
    expect(out.score).toBe(100);
  });

  it('a soft failure keeps the provider visible with the gap shown', () => {
    const out = scoreProvider(
      [
        hard({ key: 'monthly_revenue', operator: 'gte', value: 40000 }),
        hard({ key: 'position_count', operator: 'lte', value: 0, isHard: false }),
      ],
      PROFILE,
    );
    expect(out.result).toBe('possible');
    expect(out.score).toBe(50);
    expect(out.results.some((r) => !r.passed)).toBe(true);
  });
});

describe('merchant-facing explanations', () => {
  it('an unverified failure tells them to connect their bank, not to change the business', () => {
    const r = evaluate(
      hard({ key: 'amount', operator: 'lte', value: 500000, requiresVerified: true }),
      PROFILE,
    );
    expect(explainForMerchant(r)).toContain('connect your bank');
  });

  it('a threshold failure names the gap in plain terms', () => {
    const r = evaluate(hard({ key: 'monthly_revenue', operator: 'gte', value: 150000 }), PROFILE);
    const text = explainForMerchant(r);
    expect(text).toContain('$150,000');
    expect(text).toContain('$95,000');
  });

  it('every explanation is non-empty', () => {
    const criteria = [
      hard({ key: 'amount', operator: 'between', value: [25000, 500000] }),
      hard({ key: 'state', operator: 'in', value: ['NJ'] }),
      hard({ key: 'nsf_count', operator: 'lte', value: 2 }),
      hard({ key: 'monthly_revenue', operator: 'gte', value: 999999 }),
    ];
    for (const c of criteria) {
      expect(explainForMerchant(evaluate(c, PROFILE)).length).toBeGreaterThan(5);
    }
  });
});
