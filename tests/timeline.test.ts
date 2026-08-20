/**
 * Connect Capital — Timeline tests
 *
 * The timeline is the platform's closing promise: what happened, in order, in
 * plain language. It reads from the audit log, which carries things a merchant
 * must never see — refused access attempts naming a provider that was probing
 * them, admin elevation reasons referencing a dispute.
 *
 * Same failure mode as the blinded card: a leak here is silent and permanent.
 *
 *   npx tsx tests/timeline.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildTimeline,
  isMerchantVisible,
  MERCHANT_VISIBLE_ACTIONS,
  type AuditEventInput,
} from '../lib/timeline';

const at = (h: number) => new Date(`2026-08-17T${String(h).padStart(2, '0')}:00:00Z`);

const ev = (
  action: string,
  actorOrgType: AuditEventInput['actorOrgType'],
  hour: number,
  extra: Partial<AuditEventInput> = {},
): AuditEventInput => ({ action, actorOrgType, at: at(hour), ...extra });

describe('internal events never surface', () => {
  const INTERNAL = [
    'access.denied',
    'admin.elevated',
    'admin.impersonated',
    'provider.kyb_checked',
    'provider.suspended',
    'message.sent',
    'underwriting.pending_conditions',
    'some.future.event.nobody.thought.about',
  ];

  for (const action of INTERNAL) {
    it(`HIDDEN — ${action}`, () => {
      expect(isMerchantVisible(action)).toBe(false);
      expect(buildTimeline([ev(action, 'platform', 1)]).length).toBe(0);
    });
  }

  it('an unknown event renders nothing at all — not a generic row', () => {
    const out = buildTimeline([
      ev('brand.new.action', 'platform', 1),
      ev('application.submitted', 'merchant', 2),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].text.includes('brand.new')).toBe(false);
  });

  it('a refused access attempt never names the provider who tried', () => {
    const out = buildTimeline([
      ev('access.denied', 'provider', 1, { providerName: 'Cardinal Advance' }),
    ]);
    expect(out.length).toBe(0);
  });

  it('no raw action string reaches any rendered entry', () => {
    const all = MERCHANT_VISIBLE_ACTIONS.map((a) => ev(a, 'provider', 1, { providerName: 'Harbor Point' }));
    for (const entry of buildTimeline(all)) {
      expect(entry.text.includes('.')).toBe(true);
      expect(/^[a-z_]+\.[a-z_]+$/.test(entry.text)).toBe(false);
    }
  });
});

describe('the merchant story reads in plain language', () => {
  const story = buildTimeline([
    ev('application.submitted', 'merchant', 9),
    ev('authorization.granted', 'merchant', 10, { providerName: 'Harbor Point Capital' }),
    ev('document.viewed', 'provider', 11, { providerName: 'Harbor Point Capital', metadata: { docType: 'bank_statement' } }),
    ev('offer.submitted', 'provider', 12, { providerName: 'Harbor Point Capital', metadata: { amountFinanced: 118500 } }),
    ev('offer.countered', 'merchant', 13),
    ev('offer.accepted', 'merchant', 14, { providerName: 'Harbor Point Capital' }),
    ev('funding.confirmed', 'provider', 15, { providerName: 'Harbor Point Capital', metadata: { fundedAmount: 120000 } }),
  ]);

  it('renders every step', () => {
    expect(story.length).toBe(7);
  });

  it('keeps events in chronological order regardless of input order', () => {
    const shuffled = buildTimeline([
      ev('funding.confirmed', 'provider', 15),
      ev('application.submitted', 'merchant', 9),
      ev('offer.accepted', 'merchant', 14),
    ]);
    expect(shuffled[0].at.getTime() < shuffled[1].at.getTime()).toBe(true);
  });

  it('addresses the merchant as "you"', () => {
    expect(story[0].actor).toBe('you');
    expect(story[0].text.startsWith('You')).toBe(true);
  });

  it('names the funder on their actions', () => {
    expect(story[2].text.includes('Harbor Point Capital')).toBe(true);
  });

  it('formats money readably', () => {
    expect(story[3].text.includes('$118,500')).toBe(true);
  });

  it('translates document types out of jargon', () => {
    expect(story[2].text.includes('bank statement')).toBe(true);
    expect(story[2].text.includes('bank_statement')).toBe(false);
  });

  it('falls back gracefully when a provider name is missing', () => {
    const out = buildTimeline([ev('offer.revised', 'provider', 12)]);
    expect(out[0].text.includes('A funder')).toBe(true);
  });

  it('groups entries by kind for the UI', () => {
    const kinds = new Set(story.map((s) => s.kind));
    expect(kinds.has('offers')).toBe(true);
    expect(kinds.has('funding')).toBe(true);
  });
});

describe('access events are the trust story', () => {
  it('records that a funder opened a document', () => {
    const out = buildTimeline([
      ev('document.downloaded', 'provider', 11, {
        providerName: 'Ridgeline Funding',
        metadata: { docType: 'government_id' },
      }),
    ]);
    expect(out[0].text).toBe('Ridgeline Funding downloaded your ID.');
  });

  it('records revocation in the merchant\'s own voice', () => {
    const out = buildTimeline([
      ev('authorization.revoked', 'merchant', 14, { providerName: 'Cardinal Advance' }),
    ]);
    expect(out[0].text.startsWith('You ended')).toBe(true);
  });
});
