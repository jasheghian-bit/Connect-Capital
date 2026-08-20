/**
 * Connect Capital — Hypothesis scorecard
 *
 * The founder brief names ten hypotheses and asks that the software make them
 * measurable. This module is that instrument.
 *
 * ── THE HUMILITY GATE IS THE POINT ─────────────────────────────────────────
 *
 * Every metric here refuses to report below a minimum sample. Not a warning
 * label — a refusal, returning `insufficient_data` with the count still needed.
 *
 * This exists because of a specific and very likely failure: twenty pilot
 * transactions produce a 65% funding rate, that number goes into a deck, and
 * it becomes the company's story. Then a hundred transactions arrive and the
 * real rate is 31%. Nobody lied; the first number was noise, and it was
 * treated as a finding because it was the only number available.
 *
 * A founder who can say "we don't know yet, here's what would tell us" is more
 * credible to a serious investor than one quoting a rate off three deals. The
 * gate is there to make the honest answer the easy one.
 *
 * Thresholds below are judgment, not statistics. They are deliberately modest
 * — enough to catch the worst over-reading, not enough to pretend this is a
 * powered study.
 */

export type Verdict =
  | { status: 'insufficient_data'; have: number; need: number }
  | { status: 'measured'; value: number; unit: string; n: number };

export interface Hypothesis {
  id: string;
  claim: string;
  /** What this metric can and cannot establish. Shown next to the number. */
  caveat: string;
  verdict: Verdict;
}

function measure(
  value: number | null,
  n: number,
  need: number,
  unit: string,
): Verdict {
  if (n < need || value === null) {
    return { status: 'insufficient_data', have: n, need };
  }
  return { status: 'measured', value: Math.round(value * 1000) / 1000, unit, n };
}

const ratio = (num: number, den: number): number | null =>
  den > 0 ? num / den : null;

export interface FunnelCounts {
  prequalStarted: number;
  applicationsStarted: number;
  applicationsSubmitted: number;
  applicationsRepeat: number;

  providersOffered: number;
  providersAuthorized: number;
  authorizationsRevoked: number;

  applicationsWithMerchantMessage: number;
  applicationsAuthorized: number;

  authorizedReviewed: number;
  authorizedOffered: number;
  offersAccepted: number;
  deals: number;

  feesAccrued: number;
  feesPaid: number;
  feesDisputed: number;

  documentRequestsTotal: number;

  fundedWithSpecialist: number;
  fundedWithoutSpecialist: number;
  specialistRequested: number;

  /** Median payment-to-revenue at origination, across funded deals. */
  medianPaymentToRevenue: number | null;
  /** Median hours from authorization to first offer. */
  medianHoursToFirstOffer: number | null;
  /** Median hours from submission to first offer. */
  medianHoursToFirstTouch: number | null;
}

export function scorecard(c: FunnelCounts): Hypothesis[] {
  return [
    {
      id: 'H1',
      claim: 'Merchants prefer one controlled application to repeated broker submissions',
      caveat:
        'Completion rate alone cannot separate "preferred it" from "had no alternative in front of them".',
      verdict: measure(
        ratio(c.applicationsSubmitted, c.applicationsStarted),
        c.applicationsStarted,
        30,
        'completion rate',
      ),
    },
    {
      id: 'H2',
      claim: 'Merchants value controlling which funders get access',
      caveat:
        'Authorizing fewer than offered is the signal. Authorizing all of them means the control is unused, not unwanted.',
      verdict: measure(
        ratio(c.providersAuthorized, c.providersOffered),
        c.providersOffered,
        50,
        'share of offered providers authorized',
      ),
    },
    {
      id: 'H3',
      claim: 'Merchants will communicate directly with verified funder representatives',
      caveat:
        'Counts merchant-initiated messages only. A merchant who only ever replies is being managed, not communicating.',
      verdict: measure(
        ratio(c.applicationsWithMerchantMessage, c.applicationsAuthorized),
        c.applicationsAuthorized,
        25,
        'share of files with merchant-initiated contact',
      ),
    },
    {
      id: 'H4',
      claim: 'Funders will accept permissioned direct submissions',
      caveat:
        'Reviewing is not the same as liking. Pair with time-to-first-touch and with funder retention over months.',
      verdict: measure(
        ratio(c.authorizedReviewed, c.providersAuthorized),
        c.providersAuthorized,
        40,
        'share of authorized files actually reviewed',
      ),
    },
    {
      id: 'H5',
      claim: 'Funders will pay a success fee on funded transactions',
      caveat:
        'Collection rate lags accrual by weeks. Dispute rate is the leading indicator worth watching.',
      verdict: measure(
        ratio(c.feesPaid, c.feesAccrued),
        c.feesAccrued,
        15,
        'fee collection rate',
      ),
    },
    {
      id: 'H6',
      claim:
        'Removing broker spread lets funders price lower, producing manageable payments and lower default risk',
      caveat:
        'Payment-to-revenue at origination is a LEADING indicator, available on day one. The default outcome it predicts takes 6-18 months to observe. Do not present this as proven.',
      verdict: measure(
        c.medianPaymentToRevenue,
        c.deals,
        20,
        'median payment-to-revenue at origination',
      ),
    },
    {
      id: 'H7',
      claim: 'Better-fit applications improve funder conversion',
      caveat:
        'Meaningless without a funder-side baseline. Ask each funder for their ISO-channel conversion and compare.',
      verdict: measure(
        ratio(c.authorizedOffered, c.providersAuthorized),
        c.providersAuthorized,
        40,
        'authorized-to-offer rate',
      ),
    },
    {
      id: 'H8',
      claim: 'A centralized document profile reduces underwriting friction',
      caveat:
        'Document requests per file. Falls for good reasons (bank connection) and bad ones (funders disengaging).',
      verdict: measure(
        ratio(c.documentRequestsTotal, c.applicationsAuthorized),
        c.applicationsAuthorized,
        30,
        'document requests per authorized file',
      ),
    },
    {
      id: 'H9',
      claim: 'Merchants will transact without a broker',
      caveat:
        'The cleanest of the ten. A funded deal with zero specialist involvement is unambiguous.',
      verdict: measure(
        ratio(
          c.fundedWithoutSpecialist,
          c.fundedWithoutSpecialist + c.fundedWithSpecialist,
        ),
        c.fundedWithoutSpecialist + c.fundedWithSpecialist,
        20,
        'share of fundings with no specialist',
      ),
    },
    {
      id: 'H10',
      claim: 'Some merchants will want optional human assistance',
      caveat:
        'Request rate measures demand for help, not that help worked. Compare funded rates with and without.',
      verdict: measure(
        ratio(c.specialistRequested, c.applicationsSubmitted),
        c.applicationsSubmitted,
        30,
        'specialist request rate',
      ),
    },
  ];
}

export interface MarketplaceMetrics {
  fundingConversion: Verdict;
  offersPerMerchant: Verdict;
  hoursToFirstOffer: Verdict;
  hoursToFirstTouch: Verdict;
  revocationRate: Verdict;
}

export function marketplaceMetrics(c: FunnelCounts): MarketplaceMetrics {
  return {
    fundingConversion: measure(
      ratio(c.deals, c.applicationsSubmitted),
      c.applicationsSubmitted,
      30,
      'submitted-to-funded',
    ),
    offersPerMerchant: measure(
      ratio(c.authorizedOffered, c.applicationsAuthorized),
      c.applicationsAuthorized,
      25,
      'offers per authorized file',
    ),
    hoursToFirstOffer: measure(c.medianHoursToFirstOffer, c.deals, 20, 'hours'),
    hoursToFirstTouch: measure(
      c.medianHoursToFirstTouch,
      c.applicationsAuthorized,
      25,
      'hours',
    ),
    revocationRate: measure(
      ratio(c.authorizationsRevoked, c.providersAuthorized),
      c.providersAuthorized,
      50,
      'share of grants revoked',
    ),
  };
}

/**
 * One line for a board deck or a funder conversation, generated from the data
 * rather than written by hand.
 *
 * When a hypothesis has not cleared its threshold this says so plainly and
 * names what would settle it. That sentence is more useful in a diligence
 * meeting than a number off five deals, and it is the sentence a founder will
 * be tempted not to write.
 */
export function summarize(h: Hypothesis): string {
  if (h.verdict.status === 'insufficient_data') {
    return `${h.id}: not yet measurable — ${h.verdict.have} of ${h.verdict.need} observations needed.`;
  }
  const pct = Math.round(h.verdict.value * 100);
  const isRate = h.verdict.unit.includes('rate') || h.verdict.unit.includes('share');
  const value = isRate ? `${pct}%` : `${h.verdict.value} ${h.verdict.unit}`;
  return `${h.id}: ${value} across ${h.verdict.n} observations.`;
}

export function readyToReport(hs: Hypothesis[]): {
  measured: string[];
  pending: string[];
} {
  return {
    measured: hs.filter((h) => h.verdict.status === 'measured').map((h) => h.id),
    pending: hs.filter((h) => h.verdict.status === 'insufficient_data').map((h) => h.id),
  };
}
