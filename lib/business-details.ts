/**
 * CapNet — Business details
 *
 * The one place the company's legal identity lives. Email footers (CAN-SPAM
 * postal address), the privacy policy, terms, and disclosures all read from
 * here, so a change of address is one edit rather than a search.
 *
 * Values in [FOUNDER: ...] brackets are placeholders. scripts/preflight.ts
 * fails the deploy gate while any remain — shipping "[FOUNDER: postal
 * address]" in a commercial email is a CAN-SPAM violation, not a typo.
 */

export const BUSINESS_DETAILS = {
  legalEntityName: '[FOUNDER: legal entity name]',
  dba: 'CapNet',
  stateOfFormation: '[FOUNDER: state of formation]',
  postalAddress: '[FOUNDER: postal address]',
  supportEmail: '[FOUNDER: support email]',
  phone: '[FOUNDER: support phone]',
  website: 'https://capnet.io',
} as const;

export type BusinessDetailKey = keyof typeof BUSINESS_DETAILS;

export const isPlaceholder = (v: string): boolean => /\[FOUNDER:[^\]]*\]/.test(v);

export function placeholdersRemaining(
  details: Record<string, string> = BUSINESS_DETAILS,
): string[] {
  return Object.entries(details).filter(([, v]) => !v || isPlaceholder(v)).map(([k]) => k);
}
