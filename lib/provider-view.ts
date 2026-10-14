/**
 * CapNet — Provider view resolution
 *
 * One function decides what a funder sees about a merchant, and it decides it
 * from the authorization state rather than from where the request came in.
 *
 * ── WHY THIS IS ONE FUNCTION ───────────────────────────────────────────────
 *
 * The tempting design is a summary endpoint and a full endpoint: the queue
 * returns cards, the detail page returns files. It reads cleanly and it has a
 * standing bug waiting in it — the day someone adds a third surface (an email
 * digest, a CSV export, a mobile queue) they pick whichever loader is
 * convenient, and what an unauthorized funder sees depends on a developer's routing choice rather
 * than on whether the merchant said yes.
 *
 * Since Sep 2026 there is nothing at all before authorization: the resolver
 * returns the full file against a live grant, or `no_access` with no data.
 *
 * So there is no full-file loader. There is one resolver that returns a
 * discriminated union, and the only way to reach identity is to hand it an
 * ACTIVE grant. A caller cannot ask for the full file; it can only present a
 * grant and be given whatever that grant covers.
 *
 * ── SCOPE IS ENFORCED HERE TOO ─────────────────────────────────────────────
 *
 * A grant is not binary. `documents` lists the types covered and
 * `rawDocuments` gates statement PDFs separately, matching the rule in
 * `policy.ts` exactly. Both layers apply it: policy governs the fetch of a
 * single document, this governs what appears in a list. A file the funder
 * cannot open should not be visible as a row they can ask about.
 */

// ---------------------------------------------------------------------------
// The internal record and the allowlisted file summary
// ---------------------------------------------------------------------------
//
// Moved here from the pre-authorization card module, deleted Sep 2026.
// There is no longer any pre-authorization view, so the only thing a funder
// ever receives is the full file below — and even that is BUILT FROM AN
// ALLOWLIST rather than produced by deleting fields from this record. A field
// added to FullApplicantRecord (an internal score, a new identifier) is
// invisible to funders until someone deliberately adds it to toFileSummary or
// to the identity block in resolveProviderView.

export type Confidence = 'verified' | 'parsed' | 'stated';

/** The full internal record. Never returned to a provider as-is. */
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

  /**
   * INTERNAL ONLY. Grading picks the suggested funder set and is never shown
   * to a funder (founder decision, Sep 2026). Not on the allowlist below.
   */
  grade: string | null;
  /** INTERNAL ONLY, same reason as grade. */
  matchScore: number;
  /** INTERNAL ONLY. Phrased for the merchant, not the funder. */
  matchReasons: string[];

  priorApplications: number;
  priorFundings: number;
  priorDeclines: number;

  identityHash: string;
}

/** Underwriting substance an AUTHORIZED funder sees. No grade, no match data. */
export interface FileSummary {
  industry: { naicsCode: string | null; label: string | null };
  location: { state: string; locality: string | null };
  timeInBusinessMonths: number | null;
  request: { productType: string; amount: number; preferredFrequency: string | null };
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
  paymentToRevenueIfFunded: number | null;
  creditBand: string | null;
  platformHistory: { priorApplications: number; priorFundings: number; priorDeclines: number };
  identityHash: string;
}

/**
 * Keys that must never appear in anything a funder receives, in any view.
 * Exported so tests can sweep serialized output for them.
 */
export const NEVER_FUNDER_FACING = [
  'grade',
  'gradeScore',
  'matchScore',
  'matchReasons',
  'ownerSsnToken',
  'otherGranteeCount',
  'authorizedProviderCount',
] as const;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function toFileSummary(rec: FullApplicantRecord): FileSummary {
  const has = rec.positions.length > 0;
  return {
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
      totalBalance: has ? rec.positions.reduce((s, p) => s + (p.balance ?? 0), 0) : null,
      totalPaymentAmount: has
        ? rec.positions.reduce((s, p) => s + (p.paymentAmount ?? 0), 0)
        : null,
    },
    paymentToRevenueIfFunded: estimatePaymentToRevenue(rec),
    creditBand: rec.selfReportedCreditBand,
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
 * Deliberately crude: assumes a 1.35 factor over roughly 6 months of daily
 * payments — the middle of the market, not a quote.
 */
export function estimatePaymentToRevenue(rec: FullApplicantRecord): number | null {
  if (!rec.avgMonthlyRevenue || rec.avgMonthlyRevenue <= 0) return null;
  const ASSUMED_FACTOR = 1.35;
  const ASSUMED_TERM_MONTHS = 6;
  const newMonthlyPayment = (rec.requestedAmount * ASSUMED_FACTOR) / ASSUMED_TERM_MONTHS;
  const existingMonthlyPayment = rec.positions.reduce((s, p) => s + (p.paymentAmount ?? 0), 0);
  return round((newMonthlyPayment + existingMonthlyPayment) / rec.avgMonthlyRevenue, 3);
}

export interface GrantScope {
  profile: boolean;
  financialSummary: boolean;
  documents: string[];
  rawDocuments: boolean;
}

export interface ActiveGrant {
  authorizationId: string;
  status: 'active' | 'revoked' | 'expired';
  scope: GrantScope;
  expiresAt: Date | null;
}

export interface DocumentSummary {
  documentId: string;
  currentVersionId: string;
  docType: string;
  isRawStatement: boolean;
  versionNo: number;
  uploadedAt: Date;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface OpenRequest {
  requestId: string;
  docType: string;
  description: string | null;
  createdAt: Date;
}

export interface FullFileView {
  applicationId: string;
  identity: {
    legalName: string;
    dba: string | null;
    streetAddress: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    ownerNames: string[];
  };
  summary: FileSummary;
  documents: DocumentSummary[];
  /** Documents that exist but this grant doesn't reach. Count only. */
  documentsOutsideScope: number;
  openRequests: OpenRequest[];
  grant: { authorizationId: string; scope: GrantScope; expiresAt: Date | null };
}

/**
 * Two outcomes only (founder decision, Sep 2026). `no_access` carries NO
 * applicant data and no reason: it does not say whether the file exists,
 * whether this funder was matched, or whether access was revoked or expired.
 * Any of those would tell an unauthorized funder something about a merchant.
 */
export type ProviderView =
  | { kind: 'no_access' }
  | { kind: 'full'; file: FullFileView };

export const NO_ACCESS: ProviderView = Object.freeze({ kind: 'no_access' }) as ProviderView;

export function isGrantLive(grant: ActiveGrant | null, now: Date = new Date()): boolean {
  if (!grant) return false;
  if (grant.status !== 'active') return false;
  if (grant.expiresAt && grant.expiresAt <= now) return false;
  return true;
}

/**
 * A document is visible when its type is covered AND, if it is a raw
 * statement, the merchant turned that on explicitly. Same rule as `policy.ts`.
 */
export function documentInScope(doc: DocumentSummary, scope: GrantScope): boolean {
  if (!scope.documents.includes(doc.docType)) return false;
  if (doc.isRawStatement && !scope.rawDocuments) return false;
  return true;
}

export function resolveProviderView(
  record: FullApplicantRecord,
  grant: ActiveGrant | null,
  documents: DocumentSummary[] = [],
  openRequests: OpenRequest[] = [],
  now: Date = new Date(),
): ProviderView {
  // Revocation and expiry are immediate and total, and indistinguishable from
  // never having been authorized. No read-only window, no grace period.
  if (!grant || !isGrantLive(grant, now) || !grant.scope.profile) {
    return { kind: 'no_access' };
  }

  const inScope = documents.filter((d) => documentInScope(d, grant.scope));

  return {
    kind: 'full',
    file: {
      applicationId: record.applicationId,
      identity: {
        legalName: record.legalName,
        dba: record.dba,
        streetAddress: record.streetAddress,
        phone: record.phone,
        email: record.email,
        website: record.website,
        // Names only. The SSN token never crosses to a funder — each one pulls
        // its own credit under its own permissible purpose, rather than the
        // platform pulling once and redistributing.
        ownerNames: record.ownerNames,
      },
      summary: toFileSummary(record),
      documents: inScope,
      documentsOutsideScope: documents.length - inScope.length,
      openRequests,
      grant: {
        authorizationId: grant.authorizationId,
        scope: grant.scope,
        expiresAt: grant.expiresAt,
      },
    },
  };
}

/**
 * The only thing a funder is told on a no-access result. Identical for every
 * cause — no file, never matched, never authorized, revoked, expired — so the
 * message itself leaks nothing, and never invites a call to the merchant.
 */
export function explainNoAccess(): string {
  return "No file here. You'll see a file once a merchant gives you access.";
}
