/**
 * CapNet — Underwriting state and decline aggregation
 *
 * Two pure concerns, both consequential.
 *
 * ── THE STATE MACHINE ──────────────────────────────────────────────────────
 *
 * A funder's status on a file is append-only, so an illegal transition is not
 * a row someone can go back and fix. "Approved" following "declined" with no
 * intervening reopen is a story the transaction record would carry forever.
 *
 * ── DECLINE AGGREGATION ────────────────────────────────────────────────────
 *
 * This is the harder problem and it is a product decision, not a technical one.
 *
 * Transparency is the platform's promise. But a merchant who opens their phone
 * to five red rows saying "declined" has been handed something worse than the
 * opacity they came from — brokers, whatever else they do, protect merchants
 * from watching the process fail in real time.
 *
 * So declines are aggregated, not streamed. Five funders citing negative
 * balance days is ONE fact about the merchant's account with a specific remedy,
 * not five rejections. The merchant sees the pattern and what would change it.
 *
 * A merchant who leaves after seeing five red rows was fundable in ninety days
 * and nobody told them.
 */

export type UnderwritingStatus =
  | 'not_started'
  | 'reviewing'
  | 'pending_docs'
  | 'pending_conditions'
  | 'approved'
  | 'declined'
  | 'withdrawn';

const TRANSITIONS: Record<UnderwritingStatus, UnderwritingStatus[]> = {
  not_started: ['reviewing', 'declined', 'withdrawn'],
  reviewing: ['pending_docs', 'pending_conditions', 'approved', 'declined', 'withdrawn'],
  pending_docs: ['reviewing', 'pending_conditions', 'approved', 'declined', 'withdrawn'],
  pending_conditions: ['reviewing', 'approved', 'declined', 'withdrawn'],
  // Approved is not terminal. A funder can still withdraw before funding, and
  // pretending otherwise would force that reality to be recorded as something
  // it isn't.
  approved: ['withdrawn', 'declined'],
  declined: [],
  withdrawn: [],
};

export const TERMINAL: UnderwritingStatus[] = ['declined', 'withdrawn'];

export function canTransition(
  from: UnderwritingStatus,
  to: UnderwritingStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionCheck {
  allowed: boolean;
  reason: string;
}

export function checkTransition(
  from: UnderwritingStatus,
  to: UnderwritingStatus,
  declineReasonCode?: string,
): TransitionCheck {
  if (from === to) {
    return { allowed: false, reason: 'already in this status' };
  }
  if (TERMINAL.includes(from)) {
    return { allowed: false, reason: `${from} is terminal` };
  }
  if (!canTransition(from, to)) {
    return { allowed: false, reason: `cannot go from ${from} to ${to}` };
  }
  // A decline without a coded reason is exactly the black box the platform
  // exists to replace. The merchant is owed the reason, and the reason is the
  // routing key for the decline-flow acquisition channel.
  if (to === 'declined' && !declineReasonCode) {
    return { allowed: false, reason: 'a decline requires a reason code' };
  }
  return { allowed: true, reason: 'ok' };
}

/** Whose move it is. The most useful thing a status can tell either party. */
export function waitingOn(status: UnderwritingStatus): 'merchant' | 'funder' | 'nobody' {
  switch (status) {
    case 'pending_docs':
    case 'pending_conditions':
      return 'merchant';
    case 'not_started':
    case 'reviewing':
      return 'funder';
    default:
      return 'nobody';
  }
}

// ---------------------------------------------------------------------------
// Decline aggregation
// ---------------------------------------------------------------------------

export interface RawDecline {
  providerId: string;
  reasonCode: string;
  category: 'fit' | 'credit' | 'fraud' | 'compliance';
  merchantFacingLabel: string;
  remediationHint: string | null;
}

export interface AggregatedReason {
  reasonCode: string;
  category: 'fit' | 'credit' | 'fraud' | 'compliance';
  /** How many funders cited it. Plural is a pattern, not a pile-on. */
  count: number;
  label: string;
  remediation: string | null;
}

export interface MerchantDeclineSummary {
  totalDeclines: number;
  /** Ordered by how many funders cited each. Capped — see below. */
  reasons: AggregatedReason[];
  /** One sentence framing the whole picture. */
  headline: string;
  /** True when the platform can plausibly help by re-matching. */
  stillMatchable: boolean;
  /** True when the remediation track is the right destination. */
  remediationTrack: boolean;
}

const MAX_REASONS_SHOWN = 3;

/**
 * Fraud and compliance declines never reach a merchant with their real reason.
 * Telling someone which signal tripped teaches them how to avoid tripping it,
 * and these codes carry legal exposure the merchant-facing copy must not
 * repeat.
 */
const OPAQUE_CATEGORIES = ['fraud', 'compliance'];

export function aggregateDeclines(
  declines: RawDecline[],
  providersRemaining: number,
): MerchantDeclineSummary {
  if (declines.length === 0) {
    return {
      totalDeclines: 0,
      reasons: [],
      headline: 'No decisions yet.',
      stillMatchable: providersRemaining > 0,
      remediationTrack: false,
    };
  }

  const opaque = declines.filter((d) => OPAQUE_CATEGORIES.includes(d.category));
  if (opaque.length > 0) {
    return {
      totalDeclines: declines.length,
      reasons: [],
      headline: "We can't move forward with this application right now.",
      stillMatchable: false,
      remediationTrack: false,
    };
  }

  const byCode = new Map<string, AggregatedReason>();
  for (const d of declines) {
    const existing = byCode.get(d.reasonCode);
    if (existing) {
      existing.count++;
    } else {
      byCode.set(d.reasonCode, {
        reasonCode: d.reasonCode,
        category: d.category,
        count: 1,
        label: d.merchantFacingLabel,
        remediation: d.remediationHint,
      });
    }
  }

  const reasons = [...byCode.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_REASONS_SHOWN);

  const creditCount = declines.filter((d) => d.category === 'credit').length;
  const fitCount = declines.filter((d) => d.category === 'fit').length;

  // Fit-dominant means the merchant knocked on the wrong doors and other doors
  // exist. Credit-dominant means the account itself needs to change, and no
  // amount of re-matching fixes it — different message, different destination.
  const creditDominant = creditCount > fitCount;

  return {
    totalDeclines: declines.length,
    reasons,
    headline: buildHeadline(declines.length, reasons, creditDominant, providersRemaining),
    stillMatchable: !creditDominant && providersRemaining > 0,
    remediationTrack: creditDominant,
  };
}

function buildHeadline(
  total: number,
  reasons: AggregatedReason[],
  creditDominant: boolean,
  providersRemaining: number,
): string {
  const top = reasons[0];

  if (creditDominant) {
    return top?.remediation
      ? `Funders are looking for something specific here. ${top.remediation}`
      : 'Your account needs a little time before funders can move forward.';
  }

  if (providersRemaining > 0) {
    return total === 1
      ? 'One funder passed. Others are still reviewing.'
      : `${total} funders weren't the right fit. Others are still reviewing.`;
  }

  return top?.remediation
    ? `No matches right now. ${top.remediation}`
    : 'No funders are a match right now.';
}

/**
 * What a merchant sees per-funder in the Access Center.
 *
 * Deliberately terse and never quotes the funder's internal note. An
 * underwriter writing "bank statements look doctored" to their own team is
 * writing for their team; forwarding it verbatim would be a defamation problem
 * wearing a transparency costume.
 */
export function perProviderLabel(
  status: UnderwritingStatus,
  category?: 'fit' | 'credit' | 'fraud' | 'compliance',
  merchantFacingLabel?: string,
): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'reviewing':
      return 'Reviewing your file';
    case 'pending_docs':
      return 'Waiting on a document';
    case 'pending_conditions':
      return 'Waiting on you';
    case 'approved':
      return 'Approved';
    case 'withdrawn':
      return 'No longer reviewing';
    case 'declined':
      if (category && OPAQUE_CATEGORIES.includes(category)) return 'Not moving forward';
      return merchantFacingLabel ?? 'Passed on this file';
  }
}
