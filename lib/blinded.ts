/**
 * CapNet — Blinded match card
 *
 * What a funder sees BEFORE the merchant authorizes them.
 *
 * `policy.ts` decides whether a provider may see the card. This file decides
 * what is on it. Both have to be right; only this one fails silently.
 *
 * ── THE CENTRAL DESIGN DECISION ────────────────────────────────────────────
 *
 * The card is CONSTRUCTED FROM AN ALLOWLIST, never produced by deleting fields
 * from the full record.
 *
 * A denylist ("strip name, phone, address") is the obvious approach and it is
 * wrong in one specific way: it fails OPEN. The day someone adds
 * `ownerMobile` to the merchant record — a reasonable, well-intentioned change
 * with no connection to this file — the denylist doesn't know about it and the
 * field ships to every matched funder. Nothing errors. No test fails. The
 * merchant's phone number is simply in the world.
 *
 * Building from an allowlist inverts that. A new field is invisible here until
 * someone deliberately adds it, and adding it means reading this comment.
 *
 * Contact information is the field that matters most. A funder holding a
 * merchant's phone number before authorization can call directly, fund
 * off-platform, and never pay a fee — and that is also precisely the
 * solicitation problem the platform exists to eliminate.
 */

export type Confidence = 'verified' | 'parsed' | 'stated';

/** The full internal record. Never returned to a provider pre-authorization. */
export interface FullApplicantRecord {
  applicationId: string;
  legalName: string;
  dba: string | null;
  ownerNames: string[];
  ownerSsnToken: string | null;
  streetAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;

  naicsCode: string | null;
  industryLabel: string | null;
  state: string;
  locality: string | null;
  timeInBusinessMonths: number | null;

  productType: string;
  requestedAmount: number;
  preferredFrequency: string | null;

  avgMonthlyRevenue: number | null;
  avgDailyBalance: number | null;
  negativeDays: number | null;
  nsfCount: number | null;
  depositCount: number | null;
  monthsCovered: number | null;
  financialConfidence: Confidence;

  positions: Array<{ balance: number | null; paymentAmount: number | null }>;
  selfReportedCreditBand: string | null;

  grade: string | null;
  matchScore: number;
  matchReasons: string[];

  priorApplications: number;
  priorFundings: number;
  priorDeclines: number;

  /** Salted hash of normalized legal name + state. See note at bottom. */
  identityHash: string;
}

export interface BlindedCard {
  applicationId: string;

  industry: { naicsCode: string | null; label: string | null };
  location: { state: string; locality: string | null };
  timeInBusinessMonths: number | null;

  request: {
    productType: string;
    amount: number;
    preferredFrequency: string | null;
  };

  financials: {
    avgMonthlyRevenue: number | null;
    avgDailyBalance: number | null;
    negativeDays: number | null;
    nsfCount: number | null;
    depositCount: number | null;
    monthsCovered: number | null;
    confidence: Confidence;
  };

  obligations: {
    positionCount: number;
    totalBalance: number | null;
    totalPaymentAmount: number | null;
  };

  /**
   * The number the platform's whole economic thesis turns on. Shown to the
   * funder at triage because payment burden relative to revenue predicts
   * default better than any single credit input.
   */
  paymentToRevenueIfFunded: number | null;

  creditBand: string | null;

  match: { grade: string | null; score: number; reasons: string[] };

  platformHistory: {
    priorApplications: number;
    priorFundings: number;
    priorDeclines: number;
  };

  /**
   * Answers "is this already in my pipeline from an ISO?" and "is this on my
   * exclusion list?" by hash comparison — the legitimate identity need at
   * triage, met without disclosing identity.
   */
  identityHash: string;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function toBlindedCard(rec: FullApplicantRecord): BlindedCard {
  const totalBalance = rec.positions.length
    ? rec.positions.reduce((s, p) => s + (p.balance ?? 0), 0)
    : null;

  const totalPayment = rec.positions.length
    ? rec.positions.reduce((s, p) => s + (p.paymentAmount ?? 0), 0)
    : null;

  return {
    applicationId: rec.applicationId,

    industry: { naicsCode: rec.naicsCode, label: rec.industryLabel },
    location: { state: rec.state, locality: rec.locality },
    timeInBusinessMonths: rec.timeInBusinessMonths,

    request: {
      productType: rec.productType,
      amount: rec.requestedAmount,
      preferredFrequency: rec.preferredFrequency,
    },

    financials: {
      avgMonthlyRevenue: rec.avgMonthlyRevenue,
      avgDailyBalance: rec.avgDailyBalance,
      negativeDays: rec.negativeDays,
      nsfCount: rec.nsfCount,
      depositCount: rec.depositCount,
      monthsCovered: rec.monthsCovered,
      confidence: rec.financialConfidence,
    },

    obligations: {
      positionCount: rec.positions.length,
      totalBalance,
      totalPaymentAmount: totalPayment,
    },

    paymentToRevenueIfFunded: estimatePaymentToRevenue(rec),

    creditBand: rec.selfReportedCreditBand,

    match: {
      grade: rec.grade,
      score: rec.matchScore,
      reasons: rec.matchReasons,
    },

    platformHistory: {
      priorApplications: rec.priorApplications,
      priorFundings: rec.priorFundings,
      priorDeclines: rec.priorDeclines,
    },

    identityHash: rec.identityHash,
  };
}

/**
 * Indicative payment burden if the request were funded at typical MCA terms.
 *
 * Deliberately crude and deliberately labelled. The funder will price the deal
 * themselves; this exists so that a file whose payment burden would be
 * dangerous is visible as such at triage rather than after underwriting.
 * Assumes a 1.35 factor over roughly 6 months of daily payments — the middle
 * of the market, not a quote.
 */
export function estimatePaymentToRevenue(rec: FullApplicantRecord): number | null {
  if (!rec.avgMonthlyRevenue || rec.avgMonthlyRevenue <= 0) return null;

  const ASSUMED_FACTOR = 1.35;
  const ASSUMED_TERM_MONTHS = 6;

  const newMonthlyPayment =
    (rec.requestedAmount * ASSUMED_FACTOR) / ASSUMED_TERM_MONTHS;

  const existingMonthlyPayment = rec.positions.reduce(
    (s, p) => s + (p.paymentAmount ?? 0),
    0,
  );

  return round(
    (newMonthlyPayment + existingMonthlyPayment) / rec.avgMonthlyRevenue,
    3,
  );
}

/**
 * Fields that must never appear in a blinded card, in any form.
 *
 * Exported so the test suite can walk a serialized card hunting for sentinel
 * values rather than asserting field-by-field. Field-by-field assertions only
 * catch what someone remembered to assert; a sweep catches the field nobody
 * thought about, which is the one that leaks.
 */
export const FORBIDDEN_PRE_AUTHORIZATION = [
  'legalName',
  'dba',
  'ownerNames',
  'ownerSsnToken',
  'streetAddress',
  'phone',
  'email',
  'website',
] as const;
