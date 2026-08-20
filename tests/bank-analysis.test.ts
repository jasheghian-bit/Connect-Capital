/**
 * Connect Capital — Bank analysis tests
 *
 * The advance-as-revenue case is the one that matters most. A $120k MCA
 * disbursement counted as a sale inflates a merchant's numbers precisely when
 * they are most leveraged, and the funder who trusts the number gets burned.
 * That is how a marketplace loses supply.
 *
 *   npx tsx tests/bank-analysis.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  detectPositions,
  inferAdvance,
  checkReEligibility,
  isRevenueDeposit,
  counterpartyKey,
  type BankTransaction,
} from '../lib/bank-analysis';

let seq = 0;
const tx = (
  postedDate: string,
  amount: number,
  description: string,
  balanceAfter: number | null = null,
): BankTransaction => ({ id: `t${seq++}`, postedDate, amount, description, balanceAfter });

const addDays = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Weekday-only daily debits, the way an MCA actually remits. */
function dailyDebits(start: string, amount: number, count: number, who: string) {
  const out: BankTransaction[] = [];
  let cursor = start;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 400) {
    const dow = new Date(cursor).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(tx(cursor, -amount, `ACH DEBIT ${who} PMT ${900000 + placed}`));
      placed++;
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

describe('revenue classification', () => {
  it('an MCA advance is NOT revenue', () => {
    expect(isRevenueDeposit(tx('2026-06-01', 120000, 'MERCHANT ADVANCE FUNDING HARBOR PT'))).toBe(false);
    expect(isRevenueDeposit(tx('2026-06-01', 80000, 'WORKING CAPITAL ADV DEPOSIT'))).toBe(false);
  });

  it('an internal transfer is NOT revenue', () => {
    expect(isRevenueDeposit(tx('2026-06-01', 5000, 'ONLINE TRANSFER FROM SAVINGS'))).toBe(false);
  });

  it('a reversal is NOT revenue', () => {
    expect(isRevenueDeposit(tx('2026-06-01', 900, 'CHARGEBACK REVERSAL'))).toBe(false);
  });

  it('card settlements and customer payments ARE revenue', () => {
    expect(isRevenueDeposit(tx('2026-06-01', 3400, 'CARD SETTLEMENT BATCH 4471'))).toBe(true);
    expect(isRevenueDeposit(tx('2026-06-01', 1250, 'ACH CREDIT ACME BODY SHOP'))).toBe(true);
  });

  it('an advance does not inflate monthly revenue', () => {
    const base = [
      tx('2026-06-01', 20000, 'CARD SETTLEMENT', 20000),
      tx('2026-07-01', 20000, 'CARD SETTLEMENT', 40000),
    ];
    const withAdvance = [...base, tx('2026-06-15', 120000, 'MCA FUNDING DEPOSIT', 140000)];
    expect(computeMetrics(base).avgMonthlyRevenue).toBe(
      computeMetrics(withAdvance).avgMonthlyRevenue,
    );
  });
});

describe('underwriting metrics', () => {
  const txs = [
    tx('2026-05-01', 12000, 'CARD SETTLEMENT', 9000),
    tx('2026-05-09', 8000, 'ACH CREDIT CUSTOMER', 17000),
    tx('2026-05-20', -600, 'NSF FEE', -400),
    tx('2026-06-02', 15000, 'CARD SETTLEMENT', 14600),
    tx('2026-06-18', 9000, 'CARD SETTLEMENT', 23600),
    tx('2026-07-01', 11000, 'CARD SETTLEMENT', 34600),
  ];

  it('counts NSF activity', () => {
    expect(computeMetrics(txs).nsfCount).toBe(1);
  });

  it('counts only revenue deposits', () => {
    expect(computeMetrics(txs).depositCount).toBe(5);
  });

  it('carries balance forward across quiet days when averaging', () => {
    const m = computeMetrics(txs);
    expect(m.avgDailyBalance !== null).toBe(true);
    expect(m.avgDailyBalance > 0).toBe(true);
  });

  it('counts negative days from carried balance, not just posting days', () => {
    // Balance goes negative on May 20 and recovers June 2 — more than one day.
    expect(computeMetrics(txs).negativeDays > 1).toBe(true);
  });

  it('returns null on an empty account rather than fabricating zeros', () => {
    expect(computeMetrics([])).toBe(null);
  });
});

describe('position detection', () => {
  const revenue = [
    tx('2026-05-01', 40000, 'CARD SETTLEMENT', 40000),
    tx('2026-06-01', 40000, 'CARD SETTLEMENT', 60000),
  ];

  it('finds a daily fixed-amount debit stream', () => {
    const found = detectPositions([...revenue, ...dailyDebits('2026-05-05', 420, 30, 'RIDGELINE FUNDING')]);
    expect(found.length).toBe(1);
    expect(found[0].frequency).toBe('daily');
    expect(found[0].paymentAmount).toBe(420);
  });

  it('ignores a monthly bill — wrong cadence', () => {
    const rent = Array.from({ length: 10 }, (_, i) =>
      tx(addDays('2026-01-01', i * 30), -3500, 'ACH DEBIT LANDLORD PROPERTIES'),
    );
    expect(detectPositions([...revenue, ...rent]).length).toBe(0);
  });

  it('ignores variable-amount debits — a utility is not a position', () => {
    const power = Array.from({ length: 20 }, (_, i) =>
      tx(addDays('2026-05-01', i), -(300 + i * 40), 'ACH DEBIT STATE POWER CO'),
    );
    expect(detectPositions([...revenue, ...power]).length).toBe(0);
  });

  it('ignores a short run — too few occurrences to be a position', () => {
    expect(detectPositions([...revenue, ...dailyDebits('2026-05-05', 420, 4, 'MAYBE FUNDING')]).length).toBe(0);
  });

  it('finds two simultaneous positions — the stacking signal', () => {
    const found = detectPositions([
      ...revenue,
      ...dailyDebits('2026-05-05', 420, 30, 'RIDGELINE FUNDING'),
      ...dailyDebits('2026-05-20', 260, 25, 'CARDINAL ADVANCE'),
    ]);
    expect(found.length).toBe(2);
  });

  it('groups past per-transaction trace numbers in the description', () => {
    const a = counterpartyKey('ACH DEBIT RIDGELINE FUNDING PMT 900123');
    const b = counterpartyKey('ACH DEBIT RIDGELINE FUNDING PMT 900987');
    expect(a).toBe(b);
  });

  it('reports confidence rather than asserting certainty', () => {
    const found = detectPositions([...revenue, ...dailyDebits('2026-05-05', 420, 30, 'RIDGELINE FUNDING')]);
    expect(found[0].confidence > 0).toBe(true);
    expect(found[0].confidence <= 1).toBe(true);
  });
});

describe('advance inference and renewal timing', () => {
  const debits = dailyDebits('2026-05-05', 700, 40, 'HARBOR POINT CAPITAL');
  const withAdvance = [
    tx('2026-05-02', 60000, 'MERCHANT ADVANCE FUNDING HARBOR PT', 62000),
    ...debits,
  ];

  it('pairs the debit stream with the deposit that started it', () => {
    const [pos] = detectPositions(withAdvance);
    const inf = inferAdvance(pos, withAdvance);
    expect(inf.advanceAmount).toBe(60000);
    expect(inf.advanceDate).toBe('2026-05-02');
  });

  it('infers a factor in a plausible MCA range', () => {
    const [pos] = detectPositions(withAdvance);
    const inf = inferAdvance(pos, withAdvance);
    expect(inf.impliedFactor > 1.0).toBe(true);
    expect(inf.impliedFactor < 2.0).toBe(true);
  });

  it('tracks paydown progress toward the renewal window', () => {
    const [pos] = detectPositions(withAdvance);
    const inf = inferAdvance(pos, withAdvance);
    expect(inf.paydownProgress > 0).toBe(true);
    expect(inf.paydownProgress <= 1).toBe(true);
  });

  it('flags renewal eligibility past the halfway mark', () => {
    const long = [
      tx('2026-01-02', 60000, 'MERCHANT ADVANCE FUNDING HARBOR PT', 62000),
      ...dailyDebits('2026-01-05', 700, 90, 'HARBOR POINT CAPITAL'),
    ];
    const [pos] = detectPositions(long);
    expect(inferAdvance(pos, long).renewalEligible).toBe(true);
  });

  it('returns nulls rather than guesses when no advance deposit is found', () => {
    const [pos] = detectPositions(debits);
    const inf = inferAdvance(pos, debits);
    expect(inf.advanceAmount).toBe(null);
    expect(inf.renewalEligible).toBe(false);
  });
});

describe('re-eligibility after a credit decline', () => {
  const clean = {
    periodStart: '2026-04-01',
    periodEnd: '2026-07-01',
    monthsCovered: 3,
    avgMonthlyRevenue: 42000,
    avgDailyBalance: 9000,
    negativeDays: 0,
    nsfCount: 0,
    depositCount: 60,
    excludedDepositCount: 0,
  };

  it('clears a negative-days decline once the account is clean', () => {
    const r = checkReEligibility(clean, ['negative_days']);
    expect(r.eligible).toBe(true);
    expect(r.resolved.includes('negative_days')).toBe(true);
  });

  it('does not clear a decline the account still fails', () => {
    const r = checkReEligibility({ ...clean, negativeDays: 7 }, ['negative_days']);
    expect(r.eligible).toBe(false);
    expect(r.outstanding.includes('negative_days')).toBe(true);
  });

  it('never assumes a reason it cannot evaluate has been resolved', () => {
    const r = checkReEligibility(clean, ['recent_default']);
    expect(r.eligible).toBe(false);
    expect(r.outstanding.includes('recent_default')).toBe(true);
  });

  it('requires every outstanding reason to clear, not just one', () => {
    const r = checkReEligibility({ ...clean, nsfCount: 6 }, ['negative_days', 'nsf_activity']);
    expect(r.resolved.includes('negative_days')).toBe(true);
    expect(r.eligible).toBe(false);
  });
});
