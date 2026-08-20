/**
 * Connect Capital — Message safety tests
 *
 * The message channel is the one circumvention route that leaves no trace in
 * any log. Everything else the platform can see; a funder typing a phone
 * number into a textarea it cannot, unless this module works.
 *
 *   npx tsx tests/message-safety.test.ts
 */

import { describe, it, expect } from 'vitest';
import { scanMessage, senderNotice } from '../lib/message-safety';

describe('contact detail detection', () => {
  it('catches a plain phone number', () => {
    const r = scanMessage('Sounds good. My direct is 732-555-0142 if easier.');
    expect(r.severity).toBe('high');
    expect(r.findings.some((f) => f.kind === 'phone_number')).toBe(true);
  });

  it('catches an email address', () => {
    const r = scanMessage('Send the statement to dana@harborpoint.com');
    expect(r.severity).toBe('high');
    expect(r.findings.some((f) => f.kind === 'email_address')).toBe(true);
  });

  it('catches solicitation without any number at all', () => {
    const r = scanMessage('This will go faster if you call me directly.');
    expect(r.severity).toBe('high');
    expect(r.findings.some((f) => f.kind === 'contact_solicitation')).toBe(true);
  });

  it('catches spelled-out obfuscation', () => {
    const r = scanMessage('reach me at seven three two five five five zero one four two');
    expect(r.severity).toBe('high');
  });

  it('catches dot-com obfuscation', () => {
    const r = scanMessage('mail me at dana at gmail dot com');
    expect(r.severity).toBe('high');
    expect(r.findings.some((f) => f.kind === 'obfuscated_contact')).toBe(true);
  });

  it('catches an explicit invitation to leave the platform', () => {
    const r = scanMessage('We can handle this outside the platform, quicker that way.');
    expect(r.severity).toBe('high');
  });
});

describe('false positives are the cost of getting this wrong', () => {
  it('a normal underwriting question is clean', () => {
    const r = scanMessage(
      'Thanks for the file. Could you upload the August statement when you get a chance?',
    );
    expect(r.severity).toBe('none');
    expect(r.reviewRecommended).toBe(false);
  });

  it('discussing amounts and terms is clean', () => {
    const r = scanMessage('We can look at $120,000 at a 1.32 over roughly 6 months.');
    expect(r.severity).toBe('none');
  });

  it('a platform link is clean', () => {
    const r = scanMessage('The document is at https://app.connectcapital.com/docs/4471');
    expect(r.severity).toBe('none');
  });

  it('a bare reference number is medium, not high — could be legitimate', () => {
    const r = scanMessage('Reference 732 555 0142 on the deposit.');
    expect(r.severity).toBe('medium');
  });
});

describe('handling', () => {
  it('messages are flagged, never blocked', () => {
    const r = scanMessage('call me at 732-555-0142');
    expect(r.reviewRecommended).toBe(true);
    expect('blocked' in r).toBe(false);
  });

  it('the sender notice explains the norm without teaching evasion', () => {
    const notice = senderNotice(scanMessage('call me at 732-555-0142'));
    expect(notice !== null).toBe(true);
    expect(notice.toLowerCase().includes('phone')).toBe(false);
    expect(notice.toLowerCase().includes('detected')).toBe(false);
  });

  it('clean messages get no notice', () => {
    expect(senderNotice(scanMessage('Uploading that now, thanks.'))).toBe(null);
  });

  it('an external link alone is low severity — worth logging, not chasing', () => {
    const r = scanMessage('Their site is northshoreauto.com if you want context.');
    expect(r.severity).toBe('low');
    expect(r.reviewRecommended).toBe(false);
  });
});
