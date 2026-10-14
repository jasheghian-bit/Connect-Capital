/**
 * CapNet — Provider view resolution
 *
 * One function decides what a funder sees about a merchant, and it decides it
 * from the authorization state rather than from where the request came in.
 *
 * ── WHY THIS IS ONE FUNCTION ───────────────────────────────────────────────
 *
 * The tempting design is a blinded endpoint and a full endpoint: the queue
 * returns cards, the detail page returns files. It reads cleanly and it has a
 * standing bug waiting in it — the day someone adds a third surface (an email
 * digest, a CSV export, a mobile queue) they pick whichever loader is
 * convenient, and the blinding depends on a developer's routing choice rather
 * than on whether the merchant said yes.
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

import type { FullApplicantRecord, BlindedCard } from './blinded';
import { toBlindedCard } from './blinded';

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
  card: BlindedCard;
  documents: DocumentSummary[];
  /** Documents that exist but this grant doesn't reach. Count only. */
  documentsOutsideScope: number;
  openRequests: OpenRequest[];
  grant: { authorizationId: string; scope: GrantScope; expiresAt: Date | null };
}

export type ProviderView =
  | { kind: 'blinded'; card: BlindedCard; reason: BlindedReason }
  | { kind: 'full'; file: FullFileView };

export type BlindedReason =
  | 'no_grant'
  | 'grant_revoked'
  | 'grant_expired'
  | 'profile_not_in_scope';

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
  const card = toBlindedCard(record);

  if (!grant) return { kind: 'blinded', card, reason: 'no_grant' };

  if (grant.status === 'revoked') {
    // Revocation is immediate and total. No read-only window, no grace period
    // on records they already touched — the merchant expects "revoke" to have
    // already happened, and anything softer needs explaining on the screen.
    return { kind: 'blinded', card, reason: 'grant_revoked' };
  }

  if (grant.expiresAt && grant.expiresAt <= now) {
    return { kind: 'blinded', card, reason: 'grant_expired' };
  }

  if (grant.status !== 'active' || !grant.scope.profile) {
    return { kind: 'blinded', card, reason: 'profile_not_in_scope' };
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
      card,
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
 * What the funder is told when they hit a blinded view they expected to be
 * full. Never says "the merchant revoked you" in a way that invites a phone
 * call to ask why — that call is the exact behaviour the platform exists to
 * remove.
 */
export function explainBlinded(reason: BlindedReason): string {
  switch (reason) {
    case 'no_grant':
      return 'Awaiting merchant authorization.';
    case 'grant_revoked':
      return 'Access to this file has ended.';
    case 'grant_expired':
      return 'Access to this file has expired.';
    case 'profile_not_in_scope':
      return 'This authorization does not include the full profile.';
  }
}
