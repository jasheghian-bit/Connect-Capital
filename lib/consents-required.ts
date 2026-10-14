/**
 * CapNet — Consents required per form
 *
 * The one registry of which checkbox appears on which form, which are
 * required, and what state each starts in.
 *
 * ── WHY A REGISTRY ─────────────────────────────────────────────────────────
 *
 * A consent that is pre-checked is not consent; it is a default the user
 * failed to notice. Regulators (FTC, state UDAP, GDPR-style regimes) and
 * plaintiffs read it that way. Keeping every form's checkboxes in one
 * declared table lets a test pin "nothing starts checked" for every form at
 * once, instead of trusting each component author to remember.
 *
 * Required consents produce an immutable `consents` row carrying the exact
 * text version and hash shown — see db/kernel.ts. A required consent with no
 * versioned text cannot be proven later, so the registry refuses it.
 */

export type ConsentType =
  | 'platform_terms'
  | 'privacy_policy'
  | 'provider_authorization'
  | 'raw_document_access'
  | 'bank_connection'
  | 'fcra_credit_pull'
  | 'marketing_email'
  | 'cookie_preferences';

export type FormId =
  | 'account_signup'
  | 'application_submit'
  | 'provider_authorization'
  | 'raw_document_access'
  | 'bank_connection'
  | 'fcra_credit_pull'
  | 'marketing_email';

export interface ConsentSpec {
  type: ConsentType;
  required: boolean;
  /** Always false. Declared explicitly so the test can assert it everywhere. */
  defaultChecked: false;
  /**
   * Version and hash of the text shown. Placeholder until counsel finalizes
   * the copy — `textHash: null` on a required consent fails `assertRegistry`.
   */
  textVersion: string | null;
  textHash: string | null;
}

// Text versions are placeholders: the legal copy lives in docs/legal and is
// not final. The hash is filled in by the release that ships the final text.
const spec = (type: ConsentType, required: boolean): ConsentSpec => ({
  type,
  required,
  defaultChecked: false,
  textVersion: `${type}-v0-draft`,
  textHash: required ? `PENDING-${type}-v0-draft` : null,
});

export const FORM_CONSENTS: Record<FormId, ConsentSpec[]> = {
  account_signup: [
    spec('platform_terms', true),
    spec('privacy_policy', true),
    // Marketing is never bundled with terms. Optional, off, separate box.
    spec('marketing_email', false),
  ],
  application_submit: [spec('platform_terms', true), spec('privacy_policy', true)],
  provider_authorization: [spec('provider_authorization', true)],
  // Narrower and separate on purpose: authorizing a funder does not by itself
  // release the statement PDFs. The merchant opts in, per funder.
  raw_document_access: [spec('raw_document_access', false)],
  bank_connection: [spec('bank_connection', true)],
  fcra_credit_pull: [spec('fcra_credit_pull', true)],
  marketing_email: [spec('marketing_email', false)],
};

export function consentsFor(form: FormId): ConsentSpec[] {
  return FORM_CONSENTS[form];
}

/** Required consent types the user has not accepted. Empty = may proceed. */
export function missingConsents(
  form: FormId,
  accepted: Iterable<ConsentType>,
): ConsentType[] {
  const got = new Set(accepted);
  return FORM_CONSENTS[form].filter((c) => c.required && !got.has(c.type)).map((c) => c.type);
}

/** Problems with the registry itself. Run by tests; empty = sound. */
export function registryProblems(): string[] {
  const problems: string[] = [];
  for (const [form, specs] of Object.entries(FORM_CONSENTS)) {
    for (const c of specs) {
      if (c.defaultChecked !== false) problems.push(`${form}.${c.type} is pre-checked`);
      if (c.required && (!c.textVersion || !c.textHash))
        problems.push(`${form}.${c.type} is required but has no versioned text`);
    }
  }
  return problems;
}
