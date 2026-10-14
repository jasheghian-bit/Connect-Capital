/**
 * CapNet — Email preferences and unsubscribe
 *
 * Two categories, and the line between them is a legal one (CAN-SPAM):
 *  - transactional: security alerts, offers, messages, funding events. These
 *    are the service the merchant signed up for and cannot be opted out of
 *    while the account is active — an unsubscribed merchant who misses an
 *    offer expiring is harmed, not protected.
 *  - marketing: everything else. Opt-in (lib/consents-required.ts defaults it
 *    OFF), one-click unsubscribe, honored immediately.
 *
 * Unsubscribe tokens are HMAC-signed so the link works without login (RFC
 * 8058 one-click requires that) and cannot be forged to unsubscribe someone
 * else. They do not expire: CAN-SPAM requires the mechanism to keep working
 * for at least 30 days, and an unsubscribe link that dies is worse than none.
 *
 * Not wired: Resend sending and the /unsubscribe route do not exist yet.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type EmailCategory = 'transactional' | 'marketing';

export interface EmailPreferences {
  marketing: boolean;
  accountActive: boolean;
}

export function canSend(category: EmailCategory, prefs: EmailPreferences): boolean {
  if (category === 'transactional') return prefs.accountActive;
  return prefs.marketing === true;
}

const b64url = (b: Buffer) => b.toString('base64url');

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** Token = base64url(userId|category).base64url(hmac). */
export function signUnsubscribeToken(userId: string, category: EmailCategory, secret: string): string {
  if (!secret) throw new Error('unsubscribe secret required');
  const payload = `${userId}|${category}`;
  return `${b64url(Buffer.from(payload))}.${b64url(mac(payload, secret))}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { userId: string; category: EmailCategory } | null {
  if (!secret || typeof token !== 'string') return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const payload = Buffer.from(p, 'base64url').toString();
  const expected = mac(payload, secret);
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [userId, category] = payload.split('|');
  if (!userId || (category !== 'marketing' && category !== 'transactional')) return null;
  return { userId, category };
}

/** RFC 8058 one-click headers. Gmail/Yahoo bulk-sender rules require both. */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  if (!/^https:\/\//.test(url)) throw new Error('unsubscribe URL must be https');
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export interface FooterDetails {
  legalName: string;
  dba: string;
  postalAddress: string;
  unsubscribeUrl?: string;
}

/** CAN-SPAM: a valid physical postal address in every commercial email. */
export function emailFooter(d: FooterDetails): string {
  const lines = [`${d.dba} (${d.legalName})`, d.postalAddress];
  if (d.unsubscribeUrl) lines.push(`Unsubscribe from marketing emails: ${d.unsubscribeUrl}`);
  return lines.join('\n');
}
