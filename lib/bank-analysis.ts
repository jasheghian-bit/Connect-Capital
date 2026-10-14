/**
 * CapNet — Bank transaction analysis
 *
 * Dependency-free. Takes normalized transactions from an aggregator and
 * derives everything the platform needs from a merchant's banking.
 *
 * This module quietly does six jobs at once, which is why bank connectivity
 * was worth putting in the MVP:
 *
 *   1. Underwriting metrics    — no doc-chasing loop
 *   2. Fraud resistance        — doctored statements don't survive contact
 *                                with the account they claim to describe
 *   3. Stacking detection      — existing positions are visible in the debits
 *   4. Circumvention detection — a new advance appearing after the platform
 *                                went quiet is evidence of an off-platform
 *                                funding
 *   5. Renewal timing          — the paydown curve says when a merchant
 *                                becomes fundable again
 *   6. Re-eligibility          — the decline-remediation track fires itself
 *
 * ── THE ERROR THIS FILE EXISTS TO PREVENT ──────────────────────────────────
 *
 * Counting an MCA advance as revenue. A $120,000 deposit lands, and a naive
 * sum treats it as a spectacular month. The merchant's numbers inflate exactly
 * when they are most leveraged, and the funder who trusts them gets burned.
 *
 * `isRevenueDeposit` exists for that one case, and the tests pin it.
 */

export interface BankTransaction {
  id: string;
  postedDate: string;
  /** Positive for deposits, negative for debits. */
  amount: number;
  description: string;
  /** Running balance after this transaction, when the aggregator supplies it. */
  balanceAfter: number | null;
  category?: string;
}

export interface UnderwritingMetrics {
  periodStart: string;
  periodEnd: string;
  monthsCovered: number;
  avgMonthlyRevenue: number;
  avgDailyBalance: number | null;
  negativeDays: number;
  nsfCount: number;
  depositCount: number;
  /** Deposits excluded as advances, transfers, or reversals. */
  excludedDepositCount: number;
}

const NSF_PATTERNS = [
  'nsf',
  'insufficient fund',
  'returned item',
  'return item fee',
  'overdraft fee',
  'od fee',
  'uncollected funds',
];

const TRANSFER_PATTERNS = [
  'transfer from',
  'internal transfer',
  'online transfer',
  'zelle from savings',
  'book transfer',
];

const ADVANCE_PATTERNS = [
  'merchant advance',
  'mca funding',
  'advance funding',
  'capital funding',
  'business advance',
  'working capital adv',
];

const REVERSAL_PATTERNS = ['reversal', 'chargeback', 'returned deposit', 'refund from'];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const hits = (s: string, patterns: string[]) => patterns.some((p) => norm(s).includes(p));

/**
 * Whether a deposit counts as operating revenue.
 *
 * Excludes advances, internal transfers, and reversals. The first is the one
 * that matters: an MCA disbursement is a liability arriving, not a sale.
 */
export function isRevenueDeposit(tx: BankTransaction): boolean {
  if (tx.amount <= 0) return false;
  if (hits(tx.description, ADVANCE_PATTERNS)) return false;
  if (hits(tx.description, TRANSFER_PATTERNS)) return false;
  if (hits(tx.description, REVERSAL_PATTERNS)) return false;
  return true;
}

export function isNsf(tx: BankTransaction): boolean {
  return hits(tx.description, NSF_PATTERNS);
}

export function computeMetrics(txs: BankTransaction[]): UnderwritingMetrics | null {
  if (txs.length === 0) return null;

  const sorted = [...txs].sort((a, b) => a.postedDate.localeCompare(b.postedDate));
  const periodStart = sorted[0].postedDate;
  const periodEnd = sorted[sorted.length - 1].postedDate;

  const days =
    (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000 + 1;
  const monthsCovered = Math.max(1, Math.round((days / 30.44) * 10) / 10);

  const deposits = sorted.filter((t) => t.amount > 0);
  const revenue = deposits.filter(isRevenueDeposit);

  const totalRevenue = revenue.reduce((s, t) => s + t.amount, 0);

  // Daily closing balance: the last known balance on each day, carried
  // forward across days with no activity. Without the carry-forward a quiet
  // weekend reads as a gap and the average drifts high.
  const balanceByDay = new Map<string, number>();
  for (const t of sorted) {
    if (t.balanceAfter !== null) balanceByDay.set(t.postedDate, t.balanceAfter);
  }

  let avgDailyBalance: number | null = null;
  let negativeDays = 0;

  if (balanceByDay.size > 0) {
    const dayBalances: number[] = [];
    let carried: number | null = null;
    const cursor = new Date(periodStart);
    const end = new Date(periodEnd);

    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      if (balanceByDay.has(key)) carried = balanceByDay.get(key)!;
      if (carried !== null) {
        dayBalances.push(carried);
        if (carried < 0) negativeDays++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    avgDailyBalance = dayBalances.length
      ? Math.round(dayBalances.reduce((s, b) => s + b, 0) / dayBalances.length)
      : null;
  }

  return {
    periodStart,
    periodEnd,
    monthsCovered,
    avgMonthlyRevenue: Math.round(totalRevenue / monthsCovered),
    avgDailyBalance,
    negativeDays,
    nsfCount: sorted.filter(isNsf).length,
    depositCount: revenue.length,
    excludedDepositCount: deposits.length - revenue.length,
  };
}

// ---------------------------------------------------------------------------
// Position detection
// ---------------------------------------------------------------------------

export interface DetectedPosition {
  counterparty: string;
  paymentAmount: number;
  frequency: 'daily' | 'weekly' | 'irregular';
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** 0–1. Below 0.6 this is a hint for a human, not a finding. */
  confidence: number;
  totalPaid: number;
}

const MIN_OCCURRENCES = 8;
const MAX_AMOUNT_VARIANCE = 0.15;

/**
 * Counterparty key. MCA debit descriptions carry a stable merchant name plus a
 * per-transaction trace number, so the digits are stripped before grouping —
 * otherwise every payment looks like a different counterparty and nothing
 * clusters.
 */
export function counterpartyKey(description: string): string {
  return norm(description)
    .replace(/\b\d[\d-]*\b/g, '')
    .replace(/\b(ach|debit|pmt|payment|withdrawal|dbt|des|indn|co id|ppd|ccd)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Recurring fixed-amount debits at daily or weekly cadence. That signature is
 * an MCA remittance and very little else — a rent payment is monthly, a
 * utility varies, payroll moves with headcount.
 *
 * Reported as candidates, never as fact. The merchant confirms or corrects
 * them, because a false positive here tells a funder the merchant is stacked
 * when they are not, and that costs the merchant an approval.
 */
export function detectPositions(txs: BankTransaction[]): DetectedPosition[] {
  const debits = txs.filter((t) => t.amount < 0 && !isNsf(t));
  const groups = new Map<string, BankTransaction[]>();

  for (const t of debits) {
    const key = `${counterpartyKey(t.description)}|${Math.round(Math.abs(t.amount) / 25)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(t);
    groups.set(key, bucket);
  }

  const found: DetectedPosition[] = [];

  for (const bucket of groups.values()) {
    if (bucket.length < MIN_OCCURRENCES) continue;

    const sorted = [...bucket].sort((a, b) => a.postedDate.localeCompare(b.postedDate));
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance =
      Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length) / mean;

    if (variance > MAX_AMOUNT_VARIANCE) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(
        (new Date(sorted[i].postedDate).getTime() -
          new Date(sorted[i - 1].postedDate).getTime()) /
          86400000,
      );
    }
    const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];

    // Weekday-daily lands near 1 with weekend gaps of 3, so the median sits
    // at 1 while the mean drifts. Median is the right statistic here.
    const frequency: DetectedPosition['frequency'] =
      medianGap <= 2 ? 'daily' : medianGap <= 9 ? 'weekly' : 'irregular';

    if (frequency === 'irregular') continue;

    const cadenceScore = frequency === 'daily' ? 0.4 : 0.35;
    const volumeScore = Math.min(0.3, (sorted.length / 40) * 0.3);
    const consistencyScore = (1 - variance / MAX_AMOUNT_VARIANCE) * 0.3;

    found.push({
      counterparty: counterpartyKey(sorted[0].description),
      paymentAmount: Math.round(mean * 100) / 100,
      frequency,
      occurrences: sorted.length,
      firstSeen: sorted[0].postedDate,
      lastSeen: sorted[sorted.length - 1].postedDate,
      confidence: Math.round((cadenceScore + volumeScore + consistencyScore) * 100) / 100,
      totalPaid: Math.round(amounts.reduce((s, a) => s + a, 0)),
    });
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Advance inference — renewal timing and circumvention detection
// ---------------------------------------------------------------------------

export interface InferredAdvance {
  position: DetectedPosition;
  /** Deposit that plausibly funded this position. */
  advanceAmount: number | null;
  advanceDate: string | null;
  impliedFactor: number | null;
  /** 0–1 of total payback, when a factor could be inferred. */
  paydownProgress: number | null;
  /** True once the position is far enough paid down to renew. */
  renewalEligible: boolean;
}

const RENEWAL_THRESHOLD = 0.5;

/**
 * Pairs a detected debit stream with the deposit that started it.
 *
 * A large deposit landing shortly before a fixed daily debit stream begins is
 * an advance. That pairing yields the implied factor and therefore the paydown
 * curve — which is the renewal clock, and the reason a funder's decline flow
 * is worth having: the merchant they turned down in March is fundable in
 * September and nobody else knows.
 *
 * It is also the circumvention detector. A new advance appearing on a merchant
 * who went quiet on the platform is evidence of an off-platform funding.
 */
export function inferAdvance(
  position: DetectedPosition,
  txs: BankTransaction[],
  lookbackDays = 10,
): InferredAdvance {
  const start = new Date(position.firstSeen).getTime();

  const candidates = txs
    .filter((t) => t.amount > 0)
    .filter((t) => {
      const d = new Date(t.postedDate).getTime();
      return d <= start && d >= start - lookbackDays * 86400000;
    })
    .sort((a, b) => b.amount - a.amount);

  const advance = candidates[0] ?? null;

  if (!advance) {
    return {
      position,
      advanceAmount: null,
      advanceDate: null,
      impliedFactor: null,
      paydownProgress: null,
      renewalEligible: false,
    };
  }

  const paymentsPerMonth = position.frequency === 'daily' ? 21.7 : 4.33;
  const months =
    (new Date(position.lastSeen).getTime() - new Date(position.firstSeen).getTime()) /
      86400000 /
      30.44 || 0.1;

  // Total payback is not observable until the position closes, so it is
  // projected from cadence at a market-typical 6-month term. Deliberately
  // rough: this drives when to re-engage a merchant, not what to price.
  const projectedTotal = position.paymentAmount * paymentsPerMonth * 6;
  const impliedFactor =
    advance.amount > 0 ? Math.round((projectedTotal / advance.amount) * 100) / 100 : null;

  const paydownProgress =
    projectedTotal > 0
      ? Math.min(1, Math.round((position.totalPaid / projectedTotal) * 100) / 100)
      : null;

  return {
    position,
    advanceAmount: advance.amount,
    advanceDate: advance.postedDate,
    impliedFactor,
    paydownProgress,
    renewalEligible: (paydownProgress ?? 0) >= RENEWAL_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Re-eligibility
// ---------------------------------------------------------------------------

export interface EligibilityCheck {
  eligible: boolean;
  resolved: string[];
  outstanding: string[];
}

/**
 * Fires the decline-remediation track. A merchant declined in March for six
 * negative days becomes fundable when three clean months land — and the
 * platform can see that happen without the merchant doing anything.
 *
 * That merchant costs nothing to reacquire and arrives at the exact moment
 * they are fundable. It is the cheapest demand in the entire model, and it
 * only exists because they connected a bank.
 */
export function checkReEligibility(
  metrics: UnderwritingMetrics,
  declineCodes: string[],
  thresholds = {
    minMonthlyRevenue: 15000,
    maxNegativeDays: 3,
    maxNsf: 2,
    minMonths: 3,
  },
): EligibilityCheck {
  const resolved: string[] = [];
  const outstanding: string[] = [];

  const rules: Record<string, () => boolean> = {
    revenue_insufficient: () => metrics.avgMonthlyRevenue >= thresholds.minMonthlyRevenue,
    negative_days: () => metrics.negativeDays <= thresholds.maxNegativeDays,
    nsf_activity: () => metrics.nsfCount <= thresholds.maxNsf,
    insufficient_history: () => metrics.monthsCovered >= thresholds.minMonths,
  };

  for (const code of declineCodes) {
    const rule = rules[code];
    // A decline reason with no rule (a prior default, say) is not something
    // banking data can clear. Treated as outstanding rather than assumed
    // resolved — silence is not improvement.
    if (!rule) {
      outstanding.push(code);
      continue;
    }
    (rule() ? resolved : outstanding).push(code);
  }

  return { eligible: outstanding.length === 0, resolved, outstanding };
}
