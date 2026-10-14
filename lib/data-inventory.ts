/**
 * CapNet — Data inventory
 *
 * The authoritative list of every personal or business field CapNet collects.
 * If a field is not here, the platform does not collect it — `isCollectionAllowed`
 * is the gate, and the deletion planner (lib/data-deletion.ts) reads the same
 * list, so a field cannot be collected without also having a deletion answer.
 *
 * The package mirrors what MCA funders actually require to underwrite. Nothing
 * is collected "in case it is useful later": data minimization means each
 * field names the purpose that justifies it.
 *
 * Funder visibility is always AFTER merchant authorization (see policy.ts and
 * blinded.ts). `funder_after_authorization` here is a description, not the
 * enforcement — the enforcement is the allowlist in blinded.ts and RLS.
 */

export type Visibility =
  | 'merchant_and_platform'
  | 'funder_after_authorization'
  | 'platform_only';

export type Storage = 'vault_token' | 'database' | 'object_storage';

/**
 * erase       — removed on a verified deletion request
 * anonymize   — row kept for aggregate integrity, identifiers replaced
 * retain_legal — kept because it is evidence (consents, audit, disclosures,
 *                funded transactions); retention period set by counsel
 */
export type DeletionTreatment = 'erase' | 'anonymize' | 'retain_legal';

export interface InventoryField {
  key: string;
  label: string;
  subject: 'owner' | 'business' | 'visitor' | 'user';
  purpose: string;
  visibility: Visibility;
  storage: Storage;
  deletion: DeletionTreatment;
  sensitive?: boolean;
}

const f = (x: InventoryField) => x;

export const DATA_INVENTORY: readonly InventoryField[] = [
  // Owner — required underwriting package
  f({ key: 'owner_name', label: 'Owner name', subject: 'owner', purpose: 'Identity and funder underwriting', visibility: 'funder_after_authorization', storage: 'database', deletion: 'erase' }),
  f({ key: 'owner_dob', label: 'Owner date of birth', subject: 'owner', purpose: 'Identity verification; 18+ check', visibility: 'funder_after_authorization', storage: 'vault_token', deletion: 'erase', sensitive: true }),
  f({ key: 'owner_ssn', label: 'Owner SSN', subject: 'owner', purpose: 'Identity and credit pull (with FCRA consent)', visibility: 'funder_after_authorization', storage: 'vault_token', deletion: 'erase', sensitive: true }),
  f({ key: 'ownership_percent', label: 'Ownership %', subject: 'owner', purpose: 'Guarantor determination', visibility: 'funder_after_authorization', storage: 'database', deletion: 'erase' }),
  // Business
  f({ key: 'business_name', label: 'Business legal name', subject: 'business', purpose: 'Identity and matching', visibility: 'funder_after_authorization', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'tax_id', label: 'Business tax ID (EIN)', subject: 'business', purpose: 'Business identity / KYB', visibility: 'funder_after_authorization', storage: 'vault_token', deletion: 'erase', sensitive: true }),
  f({ key: 'business_start_date', label: 'Business start date', subject: 'business', purpose: 'Time-in-business eligibility', visibility: 'funder_after_authorization', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'merchant_id', label: 'Card processor merchant ID', subject: 'business', purpose: 'Split-funding / processing verification', visibility: 'funder_after_authorization', storage: 'vault_token', deletion: 'erase', sensitive: true }),
  f({ key: 'outstanding_advances_count', label: 'Number of outstanding advances', subject: 'business', purpose: 'Stacking / position assessment', visibility: 'funder_after_authorization', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'bank_statements', label: '4 months bank statements + MTD', subject: 'business', purpose: 'Revenue and cash-flow underwriting', visibility: 'funder_after_authorization', storage: 'object_storage', deletion: 'erase', sensitive: true }),
  f({ key: 'voided_check', label: 'Voided check', subject: 'business', purpose: 'Disbursement / ACH account verification', visibility: 'funder_after_authorization', storage: 'object_storage', deletion: 'erase', sensitive: true }),
  // Contact and account
  f({ key: 'email', label: 'Email', subject: 'user', purpose: 'Account, transactional notices', visibility: 'funder_after_authorization', storage: 'database', deletion: 'erase' }),
  f({ key: 'phone', label: 'Phone', subject: 'user', purpose: 'Account security, funder contact after authorization', visibility: 'funder_after_authorization', storage: 'database', deletion: 'erase' }),
  // Pre-qualification (anonymous visitor; see PrequalInput in applications.ts)
  f({ key: 'prequal_requested_amount', label: 'Requested amount', subject: 'visitor', purpose: 'Pre-qualification matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_monthly_revenue', label: 'Stated monthly revenue', subject: 'visitor', purpose: 'Pre-qualification matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_time_in_business', label: 'Stated time in business', subject: 'visitor', purpose: 'Pre-qualification matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_state', label: 'State', subject: 'visitor', purpose: 'Jurisdiction rules and matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_naics', label: 'Industry (NAICS)', subject: 'visitor', purpose: 'Funder appetite matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_credit_band', label: 'Stated credit band', subject: 'visitor', purpose: 'Pre-qualification matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_position_count', label: 'Stated position count', subject: 'visitor', purpose: 'Pre-qualification matching', visibility: 'merchant_and_platform', storage: 'database', deletion: 'anonymize' }),
  f({ key: 'prequal_session_token', label: 'Pre-qual session token', subject: 'visitor', purpose: 'Upsert one snapshot per visitor', visibility: 'platform_only', storage: 'database', deletion: 'erase' }),
  f({ key: 'referral_token', label: 'Referral token', subject: 'visitor', purpose: 'Attribution (frozen for fee economics)', visibility: 'platform_only', storage: 'database', deletion: 'retain_legal' }),
  // Bank connection and communications
  f({ key: 'bank_connection', label: 'Bank connection (aggregator token, accounts, transactions)', subject: 'business', purpose: 'Verified financials; raw transactions never reach funders', visibility: 'platform_only', storage: 'vault_token', deletion: 'erase', sensitive: true }),
  f({ key: 'messages', label: 'Messages with funders', subject: 'user', purpose: 'On-platform negotiation record', visibility: 'funder_after_authorization', storage: 'database', deletion: 'anonymize' }),
  // Evidence metadata
  f({ key: 'consent_ip_user_agent', label: 'IP / user agent on consents', subject: 'user', purpose: 'Proof of consent', visibility: 'platform_only', storage: 'database', deletion: 'retain_legal' }),
  f({ key: 'audit_ip_user_agent', label: 'IP / user agent on audit events', subject: 'user', purpose: 'Security and evidentiary audit trail', visibility: 'platform_only', storage: 'database', deletion: 'retain_legal' }),
];

const BY_KEY = new Map(DATA_INVENTORY.map((x) => [x.key, x]));

export function inventoryField(key: string): InventoryField | undefined {
  return BY_KEY.get(key);
}

/** The collection gate. Unknown field = not allowed. */
export function isCollectionAllowed(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * PrequalInput (lib/applications.ts) property → inventory key. Kept here so
 * adding a prequal question without inventorying it fails a test.
 */
export const PREQUAL_INPUT_FIELDS: Record<string, string> = {
  sessionToken: 'prequal_session_token',
  requestedAmount: 'prequal_requested_amount',
  statedMonthlyRevenue: 'prequal_monthly_revenue',
  statedTimeInBusinessMonths: 'prequal_time_in_business',
  state: 'prequal_state',
  naicsCode: 'prequal_naics',
  statedCreditBand: 'prequal_credit_band',
  statedPositionCount: 'prequal_position_count',
  referralToken: 'referral_token',
};
