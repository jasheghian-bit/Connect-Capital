/**
 * Connect Capital — Disclosure tests
 *
 * The APR here goes in front of merchants and, eventually, regulators. The
 * known-answer test below is the anchor: a plain 12-month amortizing loan has
 * an APR every finance textbook agrees on, and if the solver gets that wrong
 * nothing else it produces can be trusted.
 *
 *   npx tsx tests/disclosure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeApr,
  computeDisclosure,
  estimateTerm,
  validateDisclosure,
  paymentToRevenue,
  aprRequiredBesidePrice,
  rulesetFor,
  type OfferTerms,
} from '../lib/disclosure';

const near = (actual: number | null, expected: number, tol: number) => {
  if (actual === null) throw new Error('expected a number, got null');
  return Math.abs(actual - expected) <= tol;
};

describe('APR — known answers', () => {
  it('a $1,000 loan at 12 monthly payments of $88.85 is 12% APR', () => {
    // Textbook amortization: payment = 1000 / annuityFactor(0.01, 12).
    // If this drifts, the solver is broken and nothing else here is trustworthy.
    expect(near(computeApr(1000, 88.85, 12, 'monthly'), 12, 0.2)).toBe(true);
  });

  it('a $10,000 loan at 24 monthly payments of $480.11 is 14% APR', () => {
    expect(near(computeApr(10000, 480.11, 24, 'monthly'), 14, 0.2)).toBe(true);
  });

  it('a $25,000 loan at 60 monthly payments of $483.32 is 6% APR', () => {
    expect(near(computeApr(25000, 483.32, 60, 'monthly'), 6, 0.2)).toBe(true);
  });

  it('repaying exactly what was borrowed is 0%', () => {
    expect(computeApr(12000, 1000, 12, 'monthly')).toBe(0);
  });
});

describe('APR — MCA shapes', () => {
  it('a 1.35 factor over ~6 months of daily payments lands in triple digits', () => {
    const apr = computeApr(100000, 135000 / 126, 126, 'daily');
    expect(apr > 80).toBe(true);
    expect(apr < 200).toBe(true);
  });

  it('a higher factor produces a higher APR at the same term', () => {
    const low = computeApr(100000, 125000 / 126, 126, 'daily');
    const high = computeApr(100000, 145000 / 126, 126, 'daily');
    expect(high > low).toBe(true);
  });

  it('the SAME factor over a longer term produces a LOWER APR', () => {
    // The whole reason factor rate is not comparable to anything.
    const short = computeApr(100000, 135000 / 84, 84, 'daily');
    const long = computeApr(100000, 135000 / 252, 252, 'daily');
    expect(long < short).toBe(true);
  });

  it('daily and weekly on the same money land in the same neighbourhood', () => {
    const daily = computeApr(100000, 135000 / 126, 126, 'daily');
    const weekly = computeApr(100000, 135000 / 26, 26, 'weekly');
    expect(Math.abs(daily - weekly) < 25).toBe(true);
  });

  it('returns null rather than guessing on nonsense inputs', () => {
    expect(computeApr(0, 100, 12, 'monthly')).toBe(null);
    expect(computeApr(1000, 0, 12, 'monthly')).toBe(null);
    expect(computeApr(1000, 100, 0, 'monthly')).toBe(null);
  });
});

const BASE: OfferTerms = {
  grossAmount: 100000,
  totalRepayment: 135000,
  paymentAmount: 1071.43,
  frequency: 'daily',
  fees: [],
};

describe('amount financed', () => {
  it('upfront fees reduce it — the merchant did not receive them', () => {
    const d = computeDisclosure({
      ...BASE,
      fees: [{ label: 'Origination', amount: 2500, deductedUpfront: true }],
    });
    expect(d.amountFinanced).toBe(97500);
  });

  it('the finance charge grows when fees are deducted, not shrinks', () => {
    const plain = computeDisclosure(BASE);
    const withFee = computeDisclosure({
      ...BASE,
      fees: [{ label: 'Origination', amount: 2500, deductedUpfront: true }],
    });
    expect(withFee.financeCharge > plain.financeCharge).toBe(true);
  });

  it('deducted fees push the APR up', () => {
    const plain = computeDisclosure(BASE);
    const withFee = computeDisclosure({
      ...BASE,
      fees: [{ label: 'Origination', amount: 2500, deductedUpfront: true }],
    });
    expect(withFee.estimatedApr > plain.estimatedApr).toBe(true);
  });

  it('reports cost per $100 alongside APR', () => {
    expect(computeDisclosure(BASE).costPerHundred).toBe(35);
  });
});

describe('term estimation', () => {
  it('fixed-payment deals divide repayment by payment', () => {
    const t = estimateTerm(BASE);
    expect(t.basis).toBe('fixed_payment');
    expect(t.numberOfPayments).toBe(126);
  });

  it('holdback deals project from revenue instead', () => {
    const t = estimateTerm({
      ...BASE,
      holdbackPercent: 12,
      avgMonthlyRevenue: 95000,
    });
    expect(t.basis).toBe('holdback_projection');
    expect(t.assumption.includes('12%')).toBe(true);
  });

  it('every estimate states its assumption in plain language', () => {
    expect(estimateTerm(BASE).assumption.length > 20).toBe(true);
  });

  it('the disclosure carries every assumption forward', () => {
    const d = computeDisclosure({
      ...BASE,
      fees: [{ label: 'Origination', amount: 2500, deductedUpfront: true }],
    });
    expect(d.assumptions.length >= 3).toBe(true);
    expect(d.assumptions.some((a) => a.includes('2,500'))).toBe(true);
  });

  it('stamps the method version so a recalculation is traceable', () => {
    expect(computeDisclosure(BASE).methodVersion).toBe('apr-irr-v1');
  });
});

describe('jurisdictional validation', () => {
  it('a complete disclosure passes anywhere', () => {
    const d = computeDisclosure(BASE);
    for (const j of ['CA', 'NY', 'TX', 'NJ']) {
      expect(validateDisclosure(d, j).valid).toBe(true);
    }
  });

  it('a missing APR fails in an APR state', () => {
    const d = { ...computeDisclosure(BASE), estimatedApr: null };
    const r = validateDisclosure(d, 'CA');
    expect(r.valid).toBe(false);
    expect(r.missing.includes('estimatedApr')).toBe(true);
  });

  it('an unlisted state falls back to the STRICT default, not to nothing', () => {
    const d = { ...computeDisclosure(BASE), estimatedApr: null };
    expect(validateDisclosure(d, 'ZZ').valid).toBe(false);
    expect(rulesetFor('ZZ').requiredFields.includes('estimatedApr')).toBe(true);
  });

  it('California requires APR beside any stated price, not just in the document', () => {
    expect(aprRequiredBesidePrice('CA')).toBe(true);
    expect(aprRequiredBesidePrice('TX')).toBe(false);
  });

  it('every ruleset records that it needs counsel review', () => {
    for (const j of ['CA', 'NY', 'UT', 'VA', 'CT', 'TX']) {
      const r = rulesetFor(j);
      expect(r.notes.toLowerCase().includes('counsel')).toBe(true);
    }
  });
});

describe('payment burden', () => {
  it('converts the payment stream to a share of monthly revenue', () => {
    const d = computeDisclosure(BASE);
    const ptr = paymentToRevenue(d, 95000);
    expect(ptr > 0.15).toBe(true);
    expect(ptr < 0.35).toBe(true);
  });

  it('existing obligations push it up', () => {
    const d = computeDisclosure(BASE);
    expect(paymentToRevenue(d, 95000, 4200) > paymentToRevenue(d, 95000)).toBe(true);
  });

  it('returns null rather than dividing by an unknown revenue', () => {
    expect(paymentToRevenue(computeDisclosure(BASE), 0)).toBe(null);
  });
});
