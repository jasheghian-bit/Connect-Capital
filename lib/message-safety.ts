/**
 * Connect Capital — Message safety
 *
 * The platform's central promise to a merchant is that their authorized
 * funders reach them here, so any other call can be ignored. That promise
 * collapses the first time a funder types "call me at 555-0142" into a message
 * thread and takes the relationship off-platform.
 *
 * Every other circumvention vector leaves a trace the audit log can see. This
 * one is a sentence in a textarea. Without detection here, the message channel
 * is the widest hole in the anti-circumvention story — and it is the one the
 * platform hands people for free.
 *
 * ── FLAG, DO NOT BLOCK ─────────────────────────────────────────────────────
 *
 * Blocking messages is the wrong instinct. A funder with a legitimate reason
 * to share a number will find another way to say it, and a false positive that
 * eats a message during live underwriting damages the transaction the platform
 * exists to complete. Flagging preserves the conversation and creates the
 * evidence that makes the contractual term enforceable — which was always the
 * honest claim: not prevention, but attribution.
 *
 * Obfuscation is handled because it is the tell. Nobody writes "five five five
 * zero one four two" by accident.
 */

export type FindingKind =
  | 'phone_number'
  | 'email_address'
  | 'external_link'
  | 'contact_solicitation'
  | 'obfuscated_contact';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** The matched span, for the reviewer. Never shown to the counterparty. */
  excerpt: string;
}

export interface ScanResult {
  findings: Finding[];
  severity: Severity | 'none';
  /** True when a human should look before this becomes evidence of a pattern. */
  reviewRecommended: boolean;
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL = /\bhttps?:\/\/[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|io|co)\b/gi;

const SOLICITATION = [
  'call me',
  'call my',
  'text me',
  'reach me at',
  'reach out directly',
  'my cell',
  'my direct',
  'my mobile',
  'off the platform',
  'outside the platform',
  'outside of this',
  'email me directly',
  'give me a ring',
  'hit me up at',
  "here's my number",
  'my number is',
  'faster if you call',
];

const OBFUSCATION = [
  /\bat\s+g\s*mail\s+dot\s+com\b/i,
  /\bdot\s+com\b/i,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)){6,}/i,
  /\(at\)/i,
  /\[at\]/i,
  /\bdot\s+net\b/i,
];

/** Platform-owned hosts. A link to our own docs is not an exfiltration route. */
const ALLOWED_HOSTS = ['connectcapital.com', 'app.connectcapital.com'];

function isAllowedHost(match: string): boolean {
  return ALLOWED_HOSTS.some((h) => match.toLowerCase().includes(h));
}

const clip = (s: string, n = 40) => (s.length > n ? s.slice(0, n) + '…' : s);

export function scanMessage(body: string): ScanResult {
  const findings: Finding[] = [];
  const lower = body.toLowerCase();

  for (const m of body.match(PHONE) ?? []) {
    // A bare number could be a funding amount or an account reference; a
    // number next to an invitation is not ambiguous.
    const solicited = SOLICITATION.some((s) => lower.includes(s));
    findings.push({
      kind: 'phone_number',
      severity: solicited ? 'high' : 'medium',
      excerpt: clip(m),
    });
  }

  for (const m of body.match(EMAIL) ?? []) {
    if (isAllowedHost(m)) continue;
    findings.push({ kind: 'email_address', severity: 'high', excerpt: clip(m) });
  }

  for (const m of body.match(URL) ?? []) {
    if (isAllowedHost(m)) continue;
    findings.push({ kind: 'external_link', severity: 'low', excerpt: clip(m) });
  }

  for (const phrase of SOLICITATION) {
    if (lower.includes(phrase)) {
      findings.push({
        kind: 'contact_solicitation',
        severity: 'high',
        excerpt: clip(phrase),
      });
      break;
    }
  }

  for (const pattern of OBFUSCATION) {
    const m = body.match(pattern);
    if (m) {
      // Deliberate evasion. Weighted high precisely because the effort to
      // evade is itself the signal.
      findings.push({
        kind: 'obfuscated_contact',
        severity: 'high',
        excerpt: clip(m[0]),
      });
      break;
    }
  }

  const severity: ScanResult['severity'] = findings.length === 0
    ? 'none'
    : findings.some((f) => f.severity === 'high')
      ? 'high'
      : findings.some((f) => f.severity === 'medium')
        ? 'medium'
        : 'low';

  return {
    findings,
    severity,
    reviewRecommended: severity === 'high' || severity === 'medium',
  };
}

/**
 * What the sender is shown when their message trips a high-severity flag.
 *
 * Delivered anyway. The message is not held, the counterparty is not told, and
 * the sender gets one plain sentence — enough to correct genuine confusion
 * about where conversations happen, not enough to teach someone determined
 * exactly which phrasing slips through.
 */
export function senderNotice(result: ScanResult): string | null {
  if (result.severity !== 'high') return null;
  return 'Messages stay on the platform so the merchant has a record of every conversation. This one was delivered and flagged.';
}
