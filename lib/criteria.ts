/**
 * CapNet — Criteria evaluation
 *
 * Dependency-free by design. This decides which funders a merchant sees and
 * why, which makes it the highest-consequence logic in the product and the
 * logic that most needs to be testable without a database.
 *
 * Two outputs, deliberately separated:
 *
 *   evaluate()          — structured, for the matching engine and for replay
 *   explainForMerchant()— plain English, for the match preview screen
 *
 * The separation matters because the merchant-facing string is a claim. It
 * must be derived mechanically from what was actually evaluated, never written
 * by hand next to the logic and allowed to drift from it.
 *
 * On honest friction: a merchant who only ever sees green checks stops
 * believing them. Failed criteria are returned and rendered alongside the
 * passes — that costs some conversion and buys the only thing the platform
 * actually sells.
 */

export type CriterionKey =
  | 'amount'
  | 'monthly_revenue'
  | 'time_in_business_months'
  | 'avg_daily_balance'
  | 'negative_days'
  | 'nsf_count'
  | 'position_count'
  | 'months_covered'
  | 'credit_band'
  | 'state'
  | 'naics';

export type Operator = 'gte' | 'lte' | 'eq' | 'in' | 'not_in' | 'between';

export type Confidence = 'verified' | 'parsed' | 'stated';

export interface Criterion {
  key: CriterionKey;
  operator: Operator;
  value: number | string | Array<number | string>;
  isHard: boolean;
  weight: number;
  requiresVerified: boolean;
}

export interface ApplicantValue {
  value: number | string | null;
  confidence: Confidence;
}

export type ApplicantProfile = Partial<Record<CriterionKey, ApplicantValue>>;

export interface CriterionResult {
  key: CriterionKey;
  passed: boolean;
  isHard: boolean;
  weight: number;
  /** Why it failed, when it did. Drives both the UI and the replay record. */
  failureMode: 'none' | 'threshold' | 'missing_data' | 'unverified_data';
  requirement: string;
  actual: string;
}

const HIGHER_IS_BETTER: Record<string, boolean> = {
  monthly_revenue: true,
  time_in_business_months: true,
  avg_daily_balance: true,
  months_covered: true,
  negative_days: false,
  nsf_count: false,
  position_count: false,
};

const LABELS: Record<CriterionKey, string> = {
  amount: 'Requested amount',
  monthly_revenue: 'Monthly revenue',
  time_in_business_months: 'Time in business',
  avg_daily_balance: 'Average daily balance',
  negative_days: 'Negative days',
  nsf_count: 'NSF count',
  position_count: 'Open positions',
  months_covered: 'Months of activity',
  credit_band: 'Credit band',
  state: 'State',
  naics: 'Industry',
};

const CREDIT_BAND_ORDER = ['poor', 'fair', 'good', 'very_good', 'excellent'];

function asNumber(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ordinalFor(key: CriterionKey, v: number | string | null): number | null {
  if (key === 'credit_band' && typeof v === 'string') {
    const i = CREDIT_BAND_ORDER.indexOf(v);
    return i === -1 ? null : i;
  }
  return asNumber(v);
}

export function evaluate(
  criterion: Criterion,
  profile: ApplicantProfile,
): CriterionResult {
  const applicant = profile[criterion.key];
  const base = {
    key: criterion.key,
    isHard: criterion.isHard,
    weight: criterion.weight,
    requirement: describeRequirement(criterion),
  };

  if (!applicant || applicant.value === null || applicant.value === undefined) {
    return {
      ...base,
      passed: false,
      failureMode: 'missing_data',
      actual: 'not provided',
    };
  }

  // A criterion marked requiresVerified cannot be satisfied by a number the
  // merchant typed in. This is not a threshold failure — it is a different
  // outcome with a different fix, and conflating them tells the merchant to
  // change their business when they only need to connect their bank.
  if (criterion.requiresVerified && applicant.confidence !== 'verified') {
    return {
      ...base,
      passed: false,
      failureMode: 'unverified_data',
      actual: `${formatValue(criterion.key, applicant.value)} (self-reported)`,
    };
  }

  const passed = compare(criterion, applicant.value);

  return {
    ...base,
    passed,
    failureMode: passed ? 'none' : 'threshold',
    actual: formatValue(criterion.key, applicant.value),
  };
}

function compare(criterion: Criterion, actual: number | string): boolean {
  const { operator, value, key } = criterion;

  if (operator === 'in' || operator === 'not_in') {
    const list = (Array.isArray(value) ? value : [value]).map(String);
    const hit = list.includes(String(actual));
    return operator === 'in' ? hit : !hit;
  }

  if (operator === 'eq') return String(actual) === String(value);

  const a = ordinalFor(key, actual);
  if (a === null) return false;

  if (operator === 'between') {
    const [lo, hi] = (Array.isArray(value) ? value : [value, value]).map((v) =>
      ordinalFor(key, v as number | string),
    );
    if (lo === null || hi === null) return false;
    return a >= lo && a <= hi;
  }

  const b = ordinalFor(key, value as number | string);
  if (b === null) return false;
  return operator === 'gte' ? a >= b : a <= b;
}

function describeRequirement(c: Criterion): string {
  const label = LABELS[c.key];
  const v = Array.isArray(c.value)
    ? c.value.map((x) => formatValue(c.key, x)).join(' – ')
    : formatValue(c.key, c.value);

  switch (c.operator) {
    case 'gte':
      return `${label} at least ${v}`;
    case 'lte':
      return `${label} no more than ${v}`;
    case 'between':
      return `${label} between ${v}`;
    case 'in':
      return `${label} one of ${v}`;
    case 'not_in':
      return `${label} not ${v}`;
    default:
      return `${label} equals ${v}`;
  }
}

function formatValue(key: CriterionKey, v: number | string): string {
  const isMoney =
    key === 'amount' || key === 'monthly_revenue' || key === 'avg_daily_balance';
  if (isMoney) {
    const n = asNumber(v);
    return n === null ? String(v) : '$' + Math.round(n).toLocaleString('en-US');
  }
  if (key === 'time_in_business_months') {
    const n = asNumber(v);
    if (n === null) return String(v);
    return n >= 24 ? `${Math.floor(n / 12)} yrs` : `${n} months`;
  }
  if (key === 'credit_band' || key === 'state' || key === 'naics') {
    return String(v).replace(/_/g, ' ');
  }
  return String(v);
}

/**
 * The string a merchant reads on the match preview. Derived from the
 * evaluation, never authored separately — a hand-written reason next to
 * generated logic drifts, and a match explanation that has drifted is worse
 * than no explanation.
 */
export function explainForMerchant(r: CriterionResult): string {
  if (r.passed) {
    switch (r.key) {
      case 'amount':
        return `${r.actual} is inside their range`;
      case 'state':
        return `${r.actual} is accepted`;
      case 'naics':
        return `Your industry is accepted`;
      case 'time_in_business_months':
        return `${r.actual} beats their minimum`;
      default:
        return `${r.requirement} — you're at ${r.actual}`;
    }
  }

  switch (r.failureMode) {
    case 'missing_data':
      return `They need your ${LABELS[r.key].toLowerCase()}`;
    case 'unverified_data':
      return `They need this verified — connect your bank`;
    default:
      return `Wants ${r.requirement.toLowerCase()} — you're at ${r.actual}`;
  }
}

export interface MatchOutcome {
  result: 'match' | 'possible' | 'no_match';
  score: number;
  results: CriterionResult[];
}

/**
 * Any hard criterion failing excludes the provider. Soft failures reduce the
 * score but keep the provider visible with the mismatch shown.
 *
 * `possible` is the honest middle: a merchant who is close but not clean
 * should see the funder and the gap, because the gap is often something they
 * can fix in an afternoon.
 */
export function scoreProvider(
  criteria: Criterion[],
  profile: ApplicantProfile,
): MatchOutcome {
  const results = criteria.map((c) => evaluate(c, profile));

  if (results.some((r) => r.isHard && !r.passed)) {
    return { result: 'no_match', score: 0, results };
  }

  const totalWeight = results.reduce((s, r) => s + r.weight, 0) || 1;
  const earned = results.reduce((s, r) => s + (r.passed ? r.weight : 0), 0);
  const score = Math.round((earned / totalWeight) * 100);

  return { result: score === 100 ? 'match' : 'possible', score, results };
}
