/**
 * CapNet — Consent registry and cookie consent tests
 *
 * Pins the two rules most likely to erode under product pressure: nothing is
 * pre-checked, and rejecting is as easy as accepting.
 */

import { describe, it, expect } from 'vitest';
import { FORM_CONSENTS, missingConsents, registryProblems, consentsFor } from '../lib/consents-required';
import {
  defaultState, applyGpc, allowed, bannerRequired, acceptAll, rejectNonEssential,
  save, serialize, parse, resolveState, COOKIE_POLICY_VERSION,
} from '../lib/cookie-consent';

describe('form consents', () => {
  it('registry is sound', () => expect(registryProblems()).toEqual([]));
  it('no consent on any form is pre-checked', () => {
    for (const specs of Object.values(FORM_CONSENTS))
      for (const c of specs) expect(c.defaultChecked).toBe(false);
  });
  it('required consents carry text version and hash', () => {
    for (const specs of Object.values(FORM_CONSENTS))
      for (const c of specs.filter((s) => s.required)) {
        expect(c.textVersion).toBeTruthy();
        expect(c.textHash).toBeTruthy();
      }
  });
  it('raw document access and marketing are optional and off', () => {
    expect(consentsFor('raw_document_access')[0].required).toBe(false);
    expect(consentsFor('marketing_email')[0].required).toBe(false);
    expect(consentsFor('raw_document_access')[0].defaultChecked).toBe(false);
  });
  it('marketing is never required at signup', () => {
    expect(consentsFor('account_signup').find((c) => c.type === 'marketing_email')?.required).toBe(false);
  });
  it('application submit requires terms and privacy', () => {
    expect(missingConsents('application_submit', [])).toEqual(['platform_terms', 'privacy_policy']);
    expect(missingConsents('application_submit', ['platform_terms'])).toEqual(['privacy_policy']);
    expect(missingConsents('application_submit', ['platform_terms', 'privacy_policy'])).toEqual([]);
  });
  it('signup does not require marketing', () => {
    expect(missingConsents('account_signup', ['platform_terms', 'privacy_policy'])).toEqual([]);
  });
  it('optional-only forms have no gaps', () => {
    expect(missingConsents('marketing_email', [])).toEqual([]);
  });
  it('fcra and bank connection are required on their forms', () => {
    expect(missingConsents('fcra_credit_pull', [])).toEqual(['fcra_credit_pull']);
    expect(missingConsents('bank_connection', [])).toEqual(['bank_connection']);
  });
});

describe('cookie consent', () => {
  it('defaults non-essential off', () => {
    const s = defaultState();
    expect(allowed('necessary', s)).toBe(true);
    expect(allowed('preferences', s)).toBe(false);
    expect(allowed('analytics', s)).toBe(false);
    expect(allowed('advertising', s)).toBe(false);
  });
  it('necessary is always allowed even after rejection', () => {
    expect(allowed('necessary', rejectNonEssential())).toBe(true);
  });
  it('accept all and reject are each one call', () => {
    expect(allowed('analytics', acceptAll())).toBe(true);
    expect(allowed('analytics', rejectNonEssential())).toBe(false);
    expect(rejectNonEssential().decidedAt).toBeTruthy();
  });
  it('save only enables explicitly true choices', () => {
    const s = save({ preferences: true });
    expect(s.preferences).toBe(true);
    expect(s.analytics).toBe(false);
    expect(s.advertising).toBe(false);
  });
  it('GPC forces analytics and advertising off', () => {
    const s = applyGpc(acceptAll(), '1');
    expect(s.analytics).toBe(false);
    expect(s.advertising).toBe(false);
    expect(s.preferences).toBe(true);
  });
  it('GPC absent or 0 changes nothing', () => {
    expect(applyGpc(acceptAll(), null).analytics).toBe(true);
    expect(applyGpc(acceptAll(), '0').analytics).toBe(true);
  });
  it('round-trips through the cookie', () => {
    const s = save({ analytics: true });
    expect(parse(serialize(s))).toEqual(s);
  });
  it('malformed cookies parse to null', () => {
    expect(parse('garbage')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse(undefined)).toBeNull();
    expect(parse('2|v|111|x')).toBeNull();
    expect(parse('1|v|1x1|x')).toBeNull();
    expect(parse('%E0%A4%A')).toBeNull();
  });
  it('banner required when undecided or policy version changes', () => {
    expect(bannerRequired(null)).toBe(true);
    expect(bannerRequired(defaultState())).toBe(true);
    expect(bannerRequired(acceptAll())).toBe(false);
    expect(bannerRequired(acceptAll('old-v'), COOKIE_POLICY_VERSION)).toBe(true);
  });
  it('resolveState applies GPC over the stored cookie', () => {
    expect(resolveState(serialize(acceptAll()), '1').advertising).toBe(false);
    expect(resolveState(null).analytics).toBe(false);
  });
});
