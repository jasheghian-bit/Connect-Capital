/**
 * CapNet — Trust and safety detection
 *
 * Pure rules over activity the platform already records. Nothing here is proof
 * of anything; each rule produces a finding for a human to look at, with the
 * evidence attached.
 *
 * ── WHY THESE RULES AND NOT OTHERS ─────────────────────────────────────────
 *
 * Every rule below maps to a specific way a funder could take value from the
 * platform without paying for it, or take value from a merchant who did not
 * consent. They are ordered by how badly they would damage the company if they
 * ran undetected for a year.
 *
 * The most consequential is `harvesting_without_offers`. A funder who opens
 * merchant files consistently and never makes an offer is not underwriting —
 * they are collecting a lead list, and every file they open is a merchant who
 * gave permission on the understanding that this was a funding conversation.
 * It looks like nothing in isolation. It is only visible in aggregate, and
 * only the platform can see it.
 */

export type FindingType =
  | 'bulk_download'
  | 'post_revocation_attempt'
  | 'harvesting_without_offers'
  | 'off_platform_contact_pattern'
  | 'rapid_decline'
  | 'off_hours_burst';

export type Severity = 'info' | 'warning' | 'critical';

export interface Finding {
  type: FindingType;
  severity: Severity;
  providerOrgId: string;
  summary: string;
  evidence: Record<string, number | string>;
  /** What a reviewer should do. Findings without a next step get ignored. */
  suggestedAction: string;
}

export interface ProviderActivity {
  providerOrgId: string;
  providerName: string;
  windowDays: number;

  documentsOpened: number;
  documentsDownloaded: number;
  distinctMerchantsAccessed: number;

  deniedAccessAttempts: number;
  postRevocationAttempts: number;

  authorizationsReceived: number;
  filesReviewed: number;
  offersMade: number;
  declinesIssued: number;
  /** Declines issued within an hour of gaining access. */
  declinesWithinOneHour: number;

  flaggedMessages: number;
  distinctMerchantsFlagged: number;

  /** Document accesses outside 07:00–20:00 local. */
  offHoursAccesses: number;
}

const RULES: Array<(a: ProviderActivity) => Finding | null> = [
  /**
   * Opening files and never offering. The lead-harvesting pattern.
   *
   * Requires volume before it fires — a funder with four authorizations and no
   * offers is having a slow week, not building a list.
   */
  (a) => {
    if (a.authorizationsReceived < 10) return null;
    const offerRate = a.offersMade / a.authorizationsReceived;
    if (offerRate > 0.1) return null;

    return {
      type: 'harvesting_without_offers',
      severity: 'critical',
      providerOrgId: a.providerOrgId,
      summary: `${a.providerName} accessed ${a.distinctMerchantsAccessed} merchant files in ${a.windowDays} days and made ${a.offersMade} offers.`,
      evidence: {
        authorizations: a.authorizationsReceived,
        offers: a.offersMade,
        offerRate: Math.round(offerRate * 100) / 100,
        merchantsAccessed: a.distinctMerchantsAccessed,
      },
      suggestedAction:
        'Ask the funder directly. A real answer exists (appetite paused, credit box changed). No answer is grounds for suspension.',
    };
  },

  /**
   * Trying to reach a file after the merchant revoked. One is a stale browser
   * tab. Several is a funder testing whether revocation is real.
   */
  (a) => {
    if (a.postRevocationAttempts < 3) return null;
    return {
      type: 'post_revocation_attempt',
      severity: 'critical',
      providerOrgId: a.providerOrgId,
      summary: `${a.providerName} attempted to reach revoked files ${a.postRevocationAttempts} times.`,
      evidence: {
        attempts: a.postRevocationAttempts,
        totalDenied: a.deniedAccessAttempts,
      },
      suggestedAction:
        'Confirm it is not a cached client. If it is deliberate, this is a participation agreement breach.',
    };
  },

  /**
   * Contact details in messages across multiple merchants. One flag is a
   * misunderstanding. The same funder across many merchants is a policy.
   */
  (a) => {
    if (a.distinctMerchantsFlagged < 3) return null;
    return {
      type: 'off_platform_contact_pattern',
      severity: 'critical',
      providerOrgId: a.providerOrgId,
      summary: `${a.providerName} shared contact details with ${a.distinctMerchantsFlagged} different merchants.`,
      evidence: {
        flaggedMessages: a.flaggedMessages,
        distinctMerchants: a.distinctMerchantsFlagged,
      },
      suggestedAction:
        'Pull the flagged messages. This is the evidence an anti-circumvention claim rests on.',
    };
  },

  /**
   * Downloading in volume relative to files worked. Underwriting a file
   * involves a handful of documents; a much higher ratio is archiving.
   */
  (a) => {
    if (a.documentsDownloaded < 30) return null;
    const perFile = a.documentsDownloaded / Math.max(1, a.authorizationsReceived);
    if (perFile < 6) return null;

    return {
      type: 'bulk_download',
      severity: 'warning',
      providerOrgId: a.providerOrgId,
      summary: `${a.providerName} downloaded ${a.documentsDownloaded} documents across ${a.authorizationsReceived} files.`,
      evidence: {
        downloads: a.documentsDownloaded,
        files: a.authorizationsReceived,
        perFile: Math.round(perFile * 10) / 10,
      },
      suggestedAction:
        'Usually a document-heavy underwriting process. Worth one conversation, not an accusation.',
    };
  },

  /**
   * Declining within an hour of access, repeatedly. Funders see nothing before
   * authorization (Sep 2026), so either the suggested set is too wide — stale
   * criteria or appetite, a platform problem — or the funder is opening files without
   * intending to work them.
   */
  (a) => {
    if (a.declinesIssued < 8) return null;
    const rapid = a.declinesWithinOneHour / a.declinesIssued;
    if (rapid < 0.7) return null;

    return {
      type: 'rapid_decline',
      severity: 'warning',
      providerOrgId: a.providerOrgId,
      summary: `${a.providerName} declined ${a.declinesWithinOneHour} of ${a.declinesIssued} files within an hour of access.`,
      evidence: {
        declines: a.declinesIssued,
        rapid: a.declinesWithinOneHour,
        rate: Math.round(rapid * 100) / 100,
      },
      suggestedAction:
        'Check match precision first: the suggested set may be wider than this funder actually buys. Refresh their criteria and appetite before talking to them.',
    };
  },

  (a) => {
    const total = a.documentsOpened + a.documentsDownloaded;
    if (total < 20) return null;
    const offHours = a.offHoursAccesses / total;
    if (offHours < 0.5) return null;

    return {
      type: 'off_hours_burst',
      severity: 'info',
      providerOrgId: a.providerOrgId,
      summary: `${Math.round(offHours * 100)}% of ${a.providerName}'s document access is outside business hours.`,
      evidence: { offHours: a.offHoursAccesses, total },
      suggestedAction:
        'Often a different time zone or an overnight underwriting desk. Informational only.',
    };
  },
];

export function detectAnomalies(activity: ProviderActivity): Finding[] {
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return RULES.map((rule) => rule(activity))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

export function scanAll(activities: ProviderActivity[]): Finding[] {
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return activities
    .flatMap(detectAnomalies)
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * A funder in good standing produces no findings. Stated as its own function
 * because "the queue is empty" should be a verifiable state, not an absence
 * someone assumes means the detector is broken.
 */
export function isClean(activity: ProviderActivity): boolean {
  return detectAnomalies(activity).length === 0;
}
