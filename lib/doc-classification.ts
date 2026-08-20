/**
 * Connect Capital — Document classification
 *
 * Deliberately dependency-free. This module decides which documents fall under
 * the separate raw-statement consent, and that rule needs to be testable
 * without a database, a connection string, or an ORM — anything that makes a
 * security rule awkward to test is a rule that eventually goes untested.
 */

export type DocType =
  | 'bank_statement'
  | 'government_id'
  | 'voided_check'
  | 'tax_return'
  | 'financial_statement'
  | 'business_license'
  | 'lease_agreement'
  | 'other';

/**
 * True when a document requires the merchant's separate, explicit
 * raw-document grant rather than the default authorization scope.
 *
 * The test is not "is it sensitive" — every document here is sensitive. It is
 * "does the raw artifact expose materially more than the underwriting metrics
 * derived from it." A bank statement does: account number, routing number,
 * business address, and the merchant's entire customer and vendor list, none
 * of which a funder needs to price an advance. A voided check exposes the
 * account number but nothing beyond what the funder already needs to fund.
 *
 * A wrong answer here widens what a metrics-only authorization reaches, and it
 * fails silently — nothing errors, nothing looks wrong, the merchant is simply
 * not protected by the boundary they were shown.
 *
 * Classified server-side from the declared type. Never trusted from a client.
 */
export function isRawStatementType(docType: DocType): boolean {
  switch (docType) {
    case 'bank_statement':
    case 'tax_return':
    case 'financial_statement':
      return true;
    case 'government_id':
    case 'voided_check':
    case 'business_license':
    case 'lease_agreement':
    case 'other':
      return false;
    default: {
      // A new document type added without a classification decision fails the
      // build. Defaulting to false would quietly widen access; defaulting to
      // true would quietly break underwriting. Neither should be automatic.
      const _exhaustive: never = docType;
      throw new Error(`unclassified document type: ${_exhaustive}`);
    }
  }
}

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
]);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
