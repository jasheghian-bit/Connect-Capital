/**
 * CapNet — Email, business details, fee transparency, error scrubbing tests
 */

import { describe, it, expect } from 'vitest';
import { canSend, signUnsubscribeToken, verifyUnsubscribeToken, listUnsubscribeHeaders, emailFooter } from '../lib/email-preferences';
import { BUSINESS_DETAILS, placeholdersRemaining, isPlaceholder } from '../lib/business-details';
import { merchantFeeNotice, assertNoUndisclosedFees, undisclosedFeeProblems } from '../lib/fee-transparency';
import { computeDisclosure, type OfferTerms } from '../lib/disclosure';
import { scrubEvent, scrubString } from '../lib/error-scrub';

const SECRET = 'test-secret';

describe('email preferences', () => {
  it('transactional sends while active regardless of marketing', () => {
    expect(canSend('transactional', { marketing: false, accountActive: true })).toBe(true);
    expect(canSend('transactional', { marketing: true, accountActive: false })).toBe(false);
  });
  it('marketing requires opt-in', () => {
    expect(canSend('marketing', { marketing: false, accountActive: true })).toBe(false);
    expect(canSend('marketing', { marketing: true, accountActive: true })).toBe(true);
  });
  it('token round-trips', () => {
    const t = signUnsubscribeToken('user-1', 'marketing', SECRET);
    expect(verifyUnsubscribeToken(t, SECRET)).toEqual({ userId: 'user-1', category: 'marketing' });
  });
  it('rejects wrong secret, tampering, and junk', () => {
    const t = signUnsubscribeToken('user-1', 'marketing', SECRET);
    expect(verifyUnsubscribeToken(t, 'other')).toBeNull();
    const forged = Buffer.from('user-2|marketing').toString('base64url') + '.' + t.split('.')[1];
    expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('abc', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t + 'x', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t, '')).toBeNull();
  });
  it('signing requires a secret', () => {
    expect(() => signUnsubscribeToken('u', 'marketing', '')).toThrow();
  });
  it('RFC 8058 headers', () => {
    const h = listUnsubscribeHeaders('https://capnet.io/u/abc');
    expect(h['List-Unsubscribe']).toBe('<https://capnet.io/u/abc>');
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(() => listUnsubscribeHeaders('http://x')).toThrow();
  });
  it('footer carries postal address', () => {
    const f = emailFooter({ legalName: 'X LLC', dba: 'CapNet', postalAddress: '1 Main St, NY', unsubscribeUrl: 'https://u' });
    expect(f).toContain('1 Main St, NY');
    expect(f).toContain('https://u');
    expect(f).toContain('CapNet');
  });
});

describe('business details', () => {
  it('flags placeholders (currently unfilled — preflight must fail)', () => {
    const left = placeholdersRemaining();
    expect(left).toContain('legalEntityName');
    expect(left).toContain('postalAddress');
    expect(left).not.toContain('dba');
    expect(left).not.toContain('website');
  });
  it('fully filled details have none', () => {
    const filled = Object.fromEntries(Object.keys(BUSINESS_DETAILS).map((k) => [k, 'real']));
    expect(placeholdersRemaining(filled)).toEqual([]);
  });
  it('empty values count as placeholders', () => {
    expect(placeholdersRemaining({ a: '' })).toEqual(['a']);
  });
  it('isPlaceholder', () => {
    expect(isPlaceholder('[FOUNDER: x]')).toBe(true);
    expect(isPlaceholder('CapNet')).toBe(false);
  });
});

describe('fee transparency', () => {
  const terms = (fees: OfferTerms['fees']): OfferTerms => ({
    grossAmount: 50000, totalRepayment: 70000, paymentAmount: 700, frequency: 'daily', fees,
  });
  it('notice names the platform fee and who pays it', () => {
    const n = merchantFeeNotice();
    expect(n).toContain('platform fee');
    expect(n).toContain('paid by the funder');
    expect(n).not.toMatch(/buy rate/i);
  });
  it('accepts itemized fees', () => {
    const t = terms([{ label: 'Origination fee', amount: 1500, deductedUpfront: true }]);
    expect(undisclosedFeeProblems(t, computeDisclosure(t))).toEqual([]);
    assertNoUndisclosedFees(t, computeDisclosure(t));
  });
  it('rejects a fee missing from the disclosure', () => {
    const t = terms([{ label: 'Origination fee', amount: 1500, deductedUpfront: true }]);
    const d = { ...computeDisclosure(t), itemizedFees: [] };
    expect(() => assertNoUndisclosedFees(t, d)).toThrow();
  });
  it('rejects a fee whose amount differs from the disclosure', () => {
    const t = terms([{ label: 'ACH fee', amount: 395, deductedUpfront: false }]);
    const d = { ...computeDisclosure(t), itemizedFees: [{ label: 'ACH fee', amount: 95, deductedUpfront: false }] };
    expect(undisclosedFeeProblems(t, d).length).toBeGreaterThan(0);
  });
  it('rejects funder-internal labels', () => {
    const t = terms([{ label: 'Buy rate loading', amount: 100, deductedUpfront: false }]);
    expect(undisclosedFeeProblems(t, computeDisclosure(t)).join()).toContain('funder-internal');
  });
  it('rejects unlabeled or negative fees', () => {
    const t = terms([{ label: '', amount: -5, deductedUpfront: false }]);
    expect(undisclosedFeeProblems(t, computeDisclosure(t)).length).toBeGreaterThanOrEqual(2);
  });
  it('rejects a repayment mismatch', () => {
    const t = terms([]);
    expect(undisclosedFeeProblems(t, { ...computeDisclosure(t), totalRepayment: 1 })).toContain('total repayment differs from disclosure');
  });
  it('duplicate fees must each be disclosed', () => {
    const fee = { label: 'Wire fee', amount: 25, deductedUpfront: true };
    const t = terms([fee, fee]);
    expect(undisclosedFeeProblems(t, { ...computeDisclosure(t), itemizedFees: [fee] }).length).toBe(1);
  });
});

describe('error scrubbing', () => {
  it('redacts identifier shapes in strings', () => {
    const s = scrubString('ssn 123-45-6789 ein 12-3456789 acct 000123456789 a@b.com (212) 555-1234');
    for (const leak of ['123-45-6789', '12-3456789', '000123456789', 'a@b.com', '555-1234']) expect(s).not.toContain(leak);
    expect(s).toContain('[ssn]');
    expect(s).toContain('[email]');
  });
  it('leaves ordinary text alone', () => {
    expect(scrubString('failed at step 3 of 12')).toBe('failed at step 3 of 12');
  });
  it('redacts sensitive keys and recurses', () => {
    const e = scrubEvent({ message: 'x a@b.com', extra: { ssn: '123456789', account_number: 'abc', nested: [{ email: 'q@r.io' }] }, ok: 4 });
    expect(e.extra.ssn).toBe('[redacted]');
    expect(e.extra.account_number).toBe('[redacted]');
    expect(e.extra.nested[0].email).toBe('[email]');
    expect(e.message).toBe('x [email]');
    expect(e.ok).toBe(4);
  });
  it('does not mutate input', () => {
    const input = { message: 'a@b.com' };
    scrubEvent(input);
    expect(input.message).toBe('a@b.com');
  });
  it('handles null and cycles depth-bounded', () => {
    expect(scrubEvent(null)).toBeNull();
    const a: any = { m: 'x' }; a.self = a;
    expect(() => scrubEvent(a)).not.toThrow();
  });
});
