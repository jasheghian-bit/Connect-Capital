/**
 * CapNet — Cookie consent
 *
 * At launch CapNet uses only strictly necessary cookies (session, CSRF). No
 * analytics and no advertising tags are installed — see docs/sdk-audit.md.
 * The categories exist so that the day someone adds one, the gate is already
 * here and defaults to OFF.
 *
 * Rules:
 *  - Non-essential categories default OFF. Silence is not consent.
 *  - Rejecting is one action, exactly like accepting. A "reject" hidden behind
 *    a settings screen is a dark pattern regulators now name specifically.
 *  - Global Privacy Control (Sec-GPC: 1) is an opt-out of sale/sharing under
 *    CCPA/CPRA and several state laws. It forces analytics and advertising
 *    off regardless of what the cookie says.
 *  - When the cookie policy version changes, the stored choice no longer
 *    describes what the user agreed to, so the banner re-prompts.
 *
 * Not wired: no banner component or middleware reads this yet.
 */

export type CookieCategory = 'necessary' | 'preferences' | 'analytics' | 'advertising';

export const COOKIE_NAME = 'capnet_consent';
export const COOKIE_POLICY_VERSION = 'cookie-policy-v0-draft';

export interface CookieConsentState {
  policyVersion: string;
  preferences: boolean;
  analytics: boolean;
  advertising: boolean;
  decidedAt: string | null;
}

export function defaultState(policyVersion = COOKIE_POLICY_VERSION): CookieConsentState {
  return { policyVersion, preferences: false, analytics: false, advertising: false, decidedAt: null };
}

export function applyGpc(state: CookieConsentState, gpcHeader?: string | null): CookieConsentState {
  if (gpcHeader?.trim() !== '1') return state;
  return { ...state, analytics: false, advertising: false };
}

export function allowed(category: CookieCategory, state: CookieConsentState): boolean {
  if (category === 'necessary') return true;
  return state[category] === true;
}

export function bannerRequired(state: CookieConsentState | null, policyVersion = COOKIE_POLICY_VERSION): boolean {
  return !state || !state.decidedAt || state.policyVersion !== policyVersion;
}

const now = () => new Date().toISOString();

export const acceptAll = (v = COOKIE_POLICY_VERSION): CookieConsentState =>
  ({ policyVersion: v, preferences: true, analytics: true, advertising: true, decidedAt: now() });

export const rejectNonEssential = (v = COOKIE_POLICY_VERSION): CookieConsentState =>
  ({ ...defaultState(v), decidedAt: now() });

export const save = (
  choices: Partial<Pick<CookieConsentState, 'preferences' | 'analytics' | 'advertising'>>,
  v = COOKIE_POLICY_VERSION,
): CookieConsentState => ({
  policyVersion: v,
  preferences: choices.preferences === true,
  analytics: choices.analytics === true,
  advertising: choices.advertising === true,
  decidedAt: now(),
});

// Format: "1|<policyVersion>|<p><a><d>|<decidedAt>" — the leading "1" is the
// format version, so the encoding can change without misreading old cookies.
export function serialize(s: CookieConsentState): string {
  const bits = [s.preferences, s.analytics, s.advertising].map((b) => (b ? '1' : '0')).join('');
  return encodeURIComponent(['1', s.policyVersion, bits, s.decidedAt ?? ''].join('|'));
}

/** Anything malformed parses to null — the caller then shows the banner. */
export function parse(raw: string | null | undefined): CookieConsentState | null {
  if (!raw) return null;
  let parts: string[];
  try { parts = decodeURIComponent(raw).split('|'); } catch { return null; }
  if (parts.length !== 4 || parts[0] !== '1' || !/^[01]{3}$/.test(parts[2])) return null;
  const [p, a, d] = parts[2].split('').map((c) => c === '1');
  return { policyVersion: parts[1], preferences: p, analytics: a, advertising: d, decidedAt: parts[3] || null };
}

/** The effective state for a request: cookie, else defaults, then GPC on top. */
export function resolveState(cookie: string | null | undefined, gpcHeader?: string | null): CookieConsentState {
  return applyGpc(parse(cookie) ?? defaultState(), gpcHeader);
}
