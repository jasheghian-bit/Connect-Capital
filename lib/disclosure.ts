/**
 * CapNet — Disclosure engine
 *
 * Computes what a merchant must be shown alongside any offer, and refuses to
 * let an offer through that is missing a field its jurisdiction requires.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THIS IS NOT VALIDATED COMPLIANCE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The arithmetic below is correct arithmetic. Whether it is the arithmetic a
 * given state's regulator requires is a separate question that only counsel
 * can answer, and the answer differs by state.
 *
 * In particular, estimated APR for sales-based financing depends on an
 * estimated term, and the method for estimating that term is prescribed
 * differently in different regimes — historical average revenue, a projected
 * sales volume, or a specified assumption. This module implements one explicit
 * method, stamps every result with `methodVersion`, and stores the assumptions
 * alongside the number so a recalculation under a different prescribed method
 * is a data migration rather than an archaeology project.
 *
 * Do not ship this to merchants in a disclosure-regime state until counsel has
 * signed off on the method. The code is structured so that sign-off changes a
 * constant and a version string, not the architecture.
 *
 * ── WHY APR AT ALL ─────────────────────────────────────────────────────────
 *
 * A factor rate is not comparable to anything. 1.32 over four months and 1.32
 * over ten months are wildly different costs of capital, and a merchant
 * comparing two offers on factor alone is comparing nothing. APR is the only
 * number that makes two offers commensurable, which is why disclosure regimes
 * converged on it and why the platform's comparison screen is worthless
 * without it.
 */

export const METHOD_VERSION = 'apr-irr-v1';

export type PaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * Payments per year by frequency. Daily MCA remits on business days only —
 * using 365 here would understate the periodic rate and therefore the APR,
 * which is an error in the merchant's disfavour.
 */
const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  daily: 252,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
};

const DAYS_PER_PERIOD: Record<PaymentFrequency, number> = {
  daily: 365 / 252,
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
};

export interface Fee {
  label: string;
  amount: number;
  /** Deducted from disbursement (reduces amount financed) vs. added to payback. */
  deductedUpfront: boolean;
}

export interface OfferTerms {
  /** Gross purchase price / advance amount before fees. */
  grossAmount: number;
  /** Total the merchant repays. */
  totalRepayment: number;
  paymentAmount: number;
  frequency: PaymentFrequency;
  fees: Fee[];
  /**
   * Percentage of receipts, for true holdback deals. When present, the term is
   * estimated from revenue rather than from a fixed payment count.
   */
  holdbackPercent?: number;
  /** Merchant's average monthly revenue, for holdback term estimation. */
  avgMonthlyRevenue?: number;
}

export interface Disclosure {
  /** What actually reaches the merchant's account. */
  amountFinanced: number;
  /** Everything the merchant pays above what they received. */
  financeCharge: number;
  totalRepayment: number;
  paymentAmount: number;
  frequency: PaymentFrequency;
  estimatedNumberOfPayments: number;
  estimatedTermDays: number;
  estimatedTermMonths: number;
  /** Percent, e.g. 87.4 — null when it cannot be computed honestly. */
  estimatedApr: number | null;
  /** Cost per $100 financed. Some merchants read this more readily than APR. */
  costPerHundred: number;
  itemizedFees: Fee[];
  prepaymentPolicy: PrepaymentPolicy;
  methodVersion: string;
  assumptions: string[];
}

export type PrepaymentPolicy =
  | 'no_discount'
  | 'partial_discount'
  | 'pro_rata_discount';

export const PREPAYMENT_LABELS: Record<PrepaymentPolicy, string> = {
  no_discount:
    'Paying early does not reduce what you owe. The full amount is due regardless.',
  partial_discount: 'Paying early reduces what you owe by a set amount.',
  pro_rata_discount: 'Paying early reduces what you owe in proportion to the time saved.',
};

// ---------------------------------------------------------------------------
// Term estimation
// ---------------------------------------------------------------------------

export interface TermEstimate {
  numberOfPayments: number;
  termDays: number;
  basis: 'fixed_payment' | 'holdback_projection';
  assumption: string;
}

/**
 * Sales-based financing has no stated term — the term is whatever the
 * merchant's revenue makes it. Two honest ways to estimate:
 *
 *   Fixed payment  — divide total repayment by the payment. Exact if the
 *                    merchant never misses and never reconciles.
 *   Holdback       — project from historical revenue. The regime-preferred
 *                    method where a true percentage holdback applies.
 */
export function estimateTerm(terms: OfferTerms): TermEstimate {
  if (terms.holdbackPercent && terms.avgMonthlyRevenue && terms.avgMonthlyRevenue > 0) {
    const monthlyCollection = terms.avgMonthlyRevenue * (terms.holdbackPercent / 100);
    const months = terms.totalRepayment / monthlyCollection;
    const periodsPerMonth = PERIODS_PER_YEAR[terms.frequency] / 12;
    return {
      numberOfPayments: Math.ceil(months * periodsPerMonth),
      termDays: Math.round(months * 30.44),
      basis: 'holdback_projection',
      assumption: `Term projected from ${terms.holdbackPercent}% of $${Math.round(
        terms.avgMonthlyRevenue,
      ).toLocaleString('en-US')} average monthly revenue.`,
    };
  }

  const n = Math.ceil(terms.totalRepayment / terms.paymentAmount);
  return {
    numberOfPayments: n,
    termDays: Math.round(n * DAYS_PER_PERIOD[terms.frequency]),
    basis: 'fixed_payment',
    assumption: `Term assumes ${n} scheduled payments with no missed or reconciled payments.`,
  };
}

// ---------------------------------------------------------------------------
// APR
// ---------------------------------------------------------------------------

/**
 * Internal rate of return on the payment stream, annualized.
 *
 * Solves for the periodic rate r where the present value of the payment stream
 * equals the amount actually financed. Bisection rather than Newton-Raphson:
 * slower, and it cannot diverge or land on a nonsense root, which matters for
 * a number that goes in front of a regulator.
 *
 * Returns null rather than a guess when the inputs cannot produce an honest
 * answer. A fabricated APR is worse than a missing one.
 */
export function computeApr(
  amountFinanced: number,
  paymentAmount: number,
  numberOfPayments: number,
  frequency: PaymentFrequency,
): number | null {
  if (amountFinanced <= 0 || paymentAmount <= 0 || numberOfPayments < 1) return null;

  const totalPaid = paymentAmount * numberOfPayments;
  // Nothing to annualize if the merchant repays no more than they received.
  if (totalPaid <= amountFinanced) return 0;

  const pv = (r: number): number => {
    if (r === 0) return paymentAmount * numberOfPayments;
    let sum = 0;
    for (let i = 1; i <= numberOfPayments; i++) {
      sum += paymentAmount / Math.pow(1 + r, i);
    }
    return sum;
  };

  let lo = 0;
  let hi = 1; // 100% per period — far above any real MCA
  let periodic = 0;

  if (pv(hi) > amountFinanced) return null;

  for (let iter = 0; iter < 200; iter++) {
    periodic = (lo + hi) / 2;
    const value = pv(periodic);
    if (Math.abs(value - amountFinanced) < 0.005) break;
    if (value > amountFinanced) lo = periodic;
    else hi = periodic;
  }

  const apr = periodic * PERIODS_PER_YEAR[frequency] * 100;
  return Math.round(apr * 10) / 10;
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

export function computeDisclosure(terms: OfferTerms): Disclosure {
  const upfrontFees = terms.fees
    .filter((f) => f.deductedUpfront)
    .reduce((s, f) => s + f.amount, 0);

  // Amount financed is what reaches the account, not the headline number.
  // A $100,000 advance with $2,500 deducted is $97,500 financed, and every
  // downstream figure has to be computed from the smaller number or the cost
  // is understated.
  const amountFinanced = terms.grossAmount - upfrontFees;

  const term = estimateTerm(terms);
  const apr = computeApr(
    amountFinanced,
    terms.paymentAmount,
    term.numberOfPayments,
    terms.frequency,
  );

  const financeCharge = terms.totalRepayment - amountFinanced;

  const assumptions = [term.assumption];
  if (upfrontFees > 0) {
    assumptions.push(
      `$${upfrontFees.toLocaleString('en-US')} in fees deducted before disbursement.`,
    );
  }
  assumptions.push(
    'Estimated APR annualizes the payment stream. Actual cost depends on how quickly the advance is repaid.',
  );

  return {
    amountFinanced: Math.round(amountFinanced),
    financeCharge: Math.round(financeCharge),
    totalRepayment: Math.round(terms.totalRepayment),
    paymentAmount: Math.round(terms.paymentAmount * 100) / 100,
    frequency: terms.frequency,
    estimatedNumberOfPayments: term.numberOfPayments,
    estimatedTermDays: term.termDays,
    estimatedTermMonths: Math.round((term.termDays / 30.44) * 10) / 10,
    estimatedApr: apr,
    costPerHundred:
      amountFinanced > 0
        ? Math.round((financeCharge / amountFinanced) * 100 * 100) / 100
        : 0,
    itemizedFees: terms.fees,
    prepaymentPolicy: 'no_discount',
    methodVersion: METHOD_VERSION,
    assumptions,
  };
}

/**
 * Payment burden. Not required by any disclosure regime, and the most useful
 * number on the screen — it is the one that predicts whether the merchant
 * survives the deal.
 */
export function paymentToRevenue(
  disclosure: Disclosure,
  avgMonthlyRevenue: number,
  existingMonthlyPayments = 0,
): number | null {
  if (avgMonthlyRevenue <= 0) return null;
  const perMonth =
    disclosure.paymentAmount * (PERIODS_PER_YEAR[disclosure.frequency] / 12);
  return (
    Math.round(((perMonth + existingMonthlyPayments) / avgMonthlyRevenue) * 1000) / 1000
  );
}

// ---------------------------------------------------------------------------
// Jurisdictional rulesets
// ---------------------------------------------------------------------------

export type DisclosureField =
  | 'amountFinanced'
  | 'financeCharge'
  | 'totalRepayment'
  | 'estimatedApr'
  | 'paymentAmount'
  | 'estimatedTermDays'
  | 'itemizedFees'
  | 'prepaymentPolicy';

export interface DisclosureRuleset {
  jurisdiction: string;
  version: string;
  requiredFields: DisclosureField[];
  /**
   * Where any statement of price, fee, or amount must carry the APR beside it
   * — not merely in a disclosure document. This is a UI constraint, not just a
   * document constraint, and it reaches marketing surfaces too.
   */
  aprMustAccompanyAnyPriceStatement: boolean;
  notes: string;
}

const BASE_FIELDS: DisclosureField[] = [
  'amountFinanced',
  'financeCharge',
  'totalRepayment',
  'paymentAmount',
  'estimatedTermDays',
  'itemizedFees',
  'prepaymentPolicy',
];

/**
 * Seeded conservatively and NOT authoritative. Each entry needs counsel review
 * against the current statute and regulations before it governs anything shown
 * to a merchant. The structure is the deliverable; the contents are a starting
 * point that will be wrong somewhere.
 *
 * `DEFAULT` applies where no specific ruleset exists — deliberately strict, so
 * an unlisted state over-discloses rather than under-discloses.
 */
export const RULESETS: Record<string, DisclosureRuleset> = {
  DEFAULT: {
    jurisdiction: 'DEFAULT',
    version: 'default-v1',
    requiredFields: [...BASE_FIELDS, 'estimatedApr'],
    aprMustAccompanyAnyPriceStatement: false,
    notes:
      'Strict default. Unlisted jurisdictions over-disclose rather than under-disclose.',
  },
  CA: {
    jurisdiction: 'CA',
    version: 'ca-v1',
    requiredFields: [...BASE_FIELDS, 'estimatedApr'],
    aprMustAccompanyAnyPriceStatement: true,
    notes:
      'APR must appear wherever a price, fee, or amount is stated after a specific offer. Verify against current regulations with counsel.',
  },
  NY: {
    jurisdiction: 'NY',
    version: 'ny-v1',
    requiredFields: [...BASE_FIELDS, 'estimatedApr'],
    aprMustAccompanyAnyPriceStatement: false,
    notes: 'Estimated APR required in the disclosure. Verify with counsel.',
  },
  UT: { jurisdiction: 'UT', version: 'ut-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  VA: { jurisdiction: 'VA', version: 'va-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  CT: { jurisdiction: 'CT', version: 'ct-v1', requiredFields: [...BASE_FIELDS, 'estimatedApr'], aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  TX: { jurisdiction: 'TX', version: 'tx-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  FL: { jurisdiction: 'FL', version: 'fl-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  GA: { jurisdiction: 'GA', version: 'ga-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  KS: { jurisdiction: 'KS', version: 'ks-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
  MO: { jurisdiction: 'MO', version: 'mo-v1', requiredFields: BASE_FIELDS, aprMustAccompanyAnyPriceStatement: false, notes: 'Verify with counsel.' },
};

export function rulesetFor(jurisdiction: string): DisclosureRuleset {
  return RULESETS[jurisdiction.toUpperCase()] ?? RULESETS.DEFAULT;
}

export interface ValidationResult {
  valid: boolean;
  missing: DisclosureField[];
  ruleset: string;
}

/**
 * Server-side gate. An offer missing a required field for the merchant's
 * jurisdiction cannot be submitted — this is a refusal, not a warning, because
 * a warning is a thing a funder in a hurry clicks past.
 */
export function validateDisclosure(
  disclosure: Disclosure,
  jurisdiction: string,
): ValidationResult {
  const ruleset = rulesetFor(jurisdiction);
  const missing: DisclosureField[] = [];

  for (const field of ruleset.requiredFields) {
    const value = disclosure[field as keyof Disclosure];
    if (value === null || value === undefined) missing.push(field);
    if (field === 'itemizedFees' && !Array.isArray(value)) missing.push(field);
  }

  return { valid: missing.length === 0, missing, ruleset: ruleset.version };
}

/**
 * True when this jurisdiction requires APR beside any stated price — which
 * makes the offer card, the comparison table, and any notification mentioning
 * an amount all regulated surfaces rather than just the disclosure document.
 */
export function aprRequiredBesidePrice(jurisdiction: string): boolean {
  return rulesetFor(jurisdiction).aprMustAccompanyAnyPriceStatement;
}
