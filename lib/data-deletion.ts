/**
 * CapNet — Data deletion requests
 *
 * Pure planner and state machine. Execution (vault token destruction, object
 * deletion, column scrubbing) is NOT built; this decides what must happen.
 *
 * ── IMMUTABILITY IS A FEATURE, NOT AN OBSTACLE ─────────────────────────────
 *
 * Consents, audit events, disclosures, offers and funded transactions are
 * evidence. They are retained — the merchant's own protection in a dispute
 * depends on them existing — and the database refuses to delete them anyway.
 * What a deletion request DOES reach: personal identifiers in non-evidence
 * tables (erased or anonymized) and vault tokens (destroyed, which renders
 * the SSN/EIN/DOB unrecoverable even where a token reference survives).
 *
 * Blocked while:
 *  - a legal hold exists (legal_holds / under_legal_hold() in 0009), or
 *  - an application is mid-underwriting — a funder is relying on the file;
 *    the merchant withdraws first, then deletes.
 *
 * Retention period for retained evidence is a placeholder for counsel.
 */

import type { InventoryField } from './data-inventory';

/** [COUNSEL] Placeholder. State lending/recordkeeping rules set the real number. */
export const EVIDENCE_RETENTION_YEARS: number | null = null;

export const RETAINED_EVIDENCE_TABLES = [
  'consents',
  'audit_events',
  'offer_revisions',
  'offer_events',
  'disclosure_views',
  'fundings',
  'platform_fees',
] as const;

export interface DeletionContext {
  legalHolds: number;
  hasFundedTransactions: boolean;
  /** Applications in an active underwriting state (not draft/withdrawn/closed). */
  openApplications: number;
}

export interface DeletionPlan {
  blocked: null | { reason: 'legal_hold' | 'open_application'; message: string };
  erase: string[];
  anonymize: string[];
  retain: { key: string; reason: string }[];
  destroyVaultTokens: string[];
  retainedEvidenceTables: readonly string[];
  retentionYears: number | null;
}

export function planDeletion(inventory: readonly InventoryField[], ctx: DeletionContext): DeletionPlan {
  const plan: DeletionPlan = {
    blocked: null,
    erase: [],
    anonymize: [],
    retain: [],
    destroyVaultTokens: [],
    retainedEvidenceTables: RETAINED_EVIDENCE_TABLES,
    retentionYears: EVIDENCE_RETENTION_YEARS,
  };
  if (ctx.legalHolds > 0) {
    plan.blocked = { reason: 'legal_hold', message: 'Subject is under legal hold; deletion waits for release.' };
    return plan;
  }
  if (ctx.openApplications > 0) {
    plan.blocked = { reason: 'open_application', message: 'Withdraw the application in underwriting before deleting.' };
    return plan;
  }
  for (const f of inventory) {
    if (f.storage === 'vault_token') plan.destroyVaultTokens.push(f.key);
    if (f.deletion === 'retain_legal') {
      plan.retain.push({ key: f.key, reason: 'evidence (consent / audit / attribution)' });
    } else if (f.deletion === 'anonymize' || (ctx.hasFundedTransactions && f.subject === 'business' && f.storage === 'database')) {
      // A funded deal's business facts back an immutable disclosure and fee;
      // keep the shape, strip the identity.
      plan.anonymize.push(f.key);
    } else {
      plan.erase.push(f.key);
    }
  }
  return plan;
}

export type DeletionStatus = 'requested' | 'verified' | 'blocked' | 'completed' | 'rejected';

export const DELETION_TRANSITIONS: Record<DeletionStatus, DeletionStatus[]> = {
  requested: ['verified', 'rejected'],
  // A blocked request re-verifies once the hold is released / app withdrawn.
  verified: ['blocked', 'completed', 'rejected'],
  blocked: ['verified', 'rejected'],
  completed: [],
  rejected: [],
};

export function canTransition(from: DeletionStatus, to: DeletionStatus): boolean {
  return DELETION_TRANSITIONS[from].includes(to);
}
