/**
 * CapNet — Error payload scrubbing
 *
 * Error reports (Sentry) leave our infrastructure. A stack trace from a
 * failed intake can carry an SSN in a variable dump, and the vendor's
 * dashboard is not where a merchant's SSN may live. This runs in Sentry's
 * beforeSend (not wired yet — Sentry is not installed) and redacts known
 * identifier shapes plus any value under a sensitive-looking key.
 *
 * Redaction is pattern-based and therefore best-effort; it backs up, never
 * replaces, the rule that identifiers stay in the vault.
 */

const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\b\d{2}-\d{7}\b/g, '[ein]'],
  [/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone]'],
  // Bare 9–17 digit runs: unformatted SSN/EIN, bank account and card numbers.
  [/\b\d{9,17}\b/g, '[number]'],
];

const SENSITIVE_KEY = /ssn|social|ein|tax_?id|taxid|account_?n(umber|o)|routing|dob|birth|password|secret|token|authorization|cookie/i;

export function scrubString(s: string): string {
  return PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

export function scrubEvent<T>(event: T, depth = 0): T {
  if (depth > 20) return '[truncated]' as unknown as T;
  if (typeof event === 'string') return scrubString(event) as unknown as T;
  if (Array.isArray(event)) return event.map((v) => scrubEvent(v, depth + 1)) as unknown as T;
  if (event && typeof event === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && v != null ? '[redacted]' : scrubEvent(v, depth + 1);
    }
    return out as T;
  }
  return event;
}
