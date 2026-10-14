/**
 * CapNet — Data inventory, age gate, and deletion planner tests
 */

import { describe, it, expect } from 'vitest';
import { DATA_INVENTORY, isCollectionAllowed, inventoryField, PREQUAL_INPUT_FIELDS } from '../lib/data-inventory';
import { ageOn, checkOwnerAge, parseDate } from '../lib/age';
import { planDeletion, canTransition, DELETION_TRANSITIONS, RETAINED_EVIDENCE_TABLES, EVIDENCE_RETENTION_YEARS } from '../lib/data-deletion';

// Hardcoded copy of the PrequalInput keys in lib/applications.ts (that module
// imports drizzle and cannot load here). Adding a prequal question means
// adding it here AND to the inventory, or this test goes red.
const PREQUAL_KEYS = [
  'sessionToken', 'requestedAmount', 'statedMonthlyRevenue', 'statedTimeInBusinessMonths',
  'state', 'naicsCode', 'statedCreditBand', 'statedPositionCount', 'referralToken',
];

describe('data inventory', () => {
  it('every prequal input is inventoried', () => {
    for (const k of PREQUAL_KEYS) {
      expect(PREQUAL_INPUT_FIELDS[k]).toBeDefined();
      expect(isCollectionAllowed(PREQUAL_INPUT_FIELDS[k])).toBe(true);
    }
    expect(Object.keys(PREQUAL_INPUT_FIELDS)).toHaveLength(PREQUAL_KEYS.length);
  });
  it('founder package fields are present', () => {
    for (const k of ['owner_name', 'owner_dob', 'owner_ssn', 'tax_id', 'ownership_percent', 'business_name',
      'business_start_date', 'merchant_id', 'outstanding_advances_count', 'bank_statements', 'voided_check',
      'email', 'phone', 'bank_connection', 'messages', 'consent_ip_user_agent', 'audit_ip_user_agent'])
      expect(isCollectionAllowed(k)).toBe(true);
  });
  it('unknown fields are not collectable', () => {
    expect(isCollectionAllowed('mothers_maiden_name')).toBe(false);
    expect(isCollectionAllowed('')).toBe(false);
  });
  it('keys are unique and each has a purpose', () => {
    const keys = DATA_INVENTORY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of DATA_INVENTORY) expect(f.purpose.length).toBeGreaterThan(5);
  });
  it('SSN, EIN and DOB live in the vault', () => {
    for (const k of ['owner_ssn', 'tax_id', 'owner_dob']) expect(inventoryField(k)?.storage).toBe('vault_token');
  });
  it('no sensitive field is visible to funders before authorization', () => {
    for (const f of DATA_INVENTORY.filter((x) => x.sensitive))
      expect(['funder_after_authorization', 'platform_only']).toContain(f.visibility);
  });
  it('raw bank connection data is platform only', () => {
    expect(inventoryField('bank_connection')?.visibility).toBe('platform_only');
  });
  it('consent and audit metadata is retained as evidence', () => {
    expect(inventoryField('consent_ip_user_agent')?.deletion).toBe('retain_legal');
    expect(inventoryField('audit_ip_user_agent')?.deletion).toBe('retain_legal');
  });
});

describe('age gate', () => {
  it('counts whole years', () => {
    expect(ageOn('2000-06-15', '2018-06-14')).toBe(17);
    expect(ageOn('2000-06-15', '2018-06-15')).toBe(18);
    expect(ageOn('2000-06-15', '2018-12-31')).toBe(18);
  });
  it('handles leap-day birthdays', () => {
    expect(ageOn('2004-02-29', '2022-02-28')).toBe(17);
    expect(ageOn('2004-02-29', '2022-03-01')).toBe(18);
    expect(ageOn('2004-02-29', '2024-02-29')).toBe(20);
  });
  it('rejects impossible dates', () => {
    expect(parseDate('2023-02-29')).toBeNull();
    expect(parseDate('2023-13-01')).toBeNull();
    expect(parseDate('06/15/2000')).toBeNull();
    expect(ageOn('nope', '2020-01-01')).toBeNull();
  });
  it('checkOwnerAge outcomes', () => {
    expect(checkOwnerAge('1990-01-01', '2026-10-14')).toEqual({ ok: true });
    expect(checkOwnerAge('2008-10-15', '2026-10-14')).toEqual({ ok: false, reason: 'under_18' });
    expect(checkOwnerAge('2008-10-14', '2026-10-14')).toEqual({ ok: true });
    expect(checkOwnerAge('2030-01-01', '2026-10-14')).toEqual({ ok: false, reason: 'future_date' });
    expect(checkOwnerAge('2001-02-30', '2026-10-14')).toEqual({ ok: false, reason: 'invalid_date' });
    expect(checkOwnerAge('1990-01-01', 'bad')).toEqual({ ok: false, reason: 'invalid_date' });
  });
  it('rejection carries no DOB', () => {
    const r = checkOwnerAge('2010-01-01', '2026-10-14');
    expect(JSON.stringify(r)).not.toContain('2010');
  });
});

describe('deletion planner', () => {
  const clean = { legalHolds: 0, hasFundedTransactions: false, openApplications: 0 };
  it('blocked under legal hold', () => {
    const p = planDeletion(DATA_INVENTORY, { ...clean, legalHolds: 1 });
    expect(p.blocked?.reason).toBe('legal_hold');
    expect(p.erase).toHaveLength(0);
  });
  it('blocked while an application is in underwriting', () => {
    expect(planDeletion(DATA_INVENTORY, { ...clean, openApplications: 1 }).blocked?.reason).toBe('open_application');
  });
  it('legal hold wins over open application', () => {
    expect(planDeletion(DATA_INVENTORY, { ...clean, legalHolds: 1, openApplications: 2 }).blocked?.reason).toBe('legal_hold');
  });
  it('erases identifiers and destroys vault tokens', () => {
    const p = planDeletion(DATA_INVENTORY, clean);
    expect(p.blocked).toBeNull();
    expect(p.erase).toContain('owner_ssn');
    expect(p.erase).toContain('email');
    expect(p.destroyVaultTokens).toContain('owner_ssn');
    expect(p.destroyVaultTokens).toContain('tax_id');
    expect(p.destroyVaultTokens).toContain('owner_dob');
  });
  it('retains evidence with a reason', () => {
    const p = planDeletion(DATA_INVENTORY, clean);
    const keys = p.retain.map((r) => r.key);
    expect(keys).toContain('consent_ip_user_agent');
    expect(keys).toContain('audit_ip_user_agent');
    for (const r of p.retain) expect(r.reason).toBeTruthy();
    for (const t of ['consents', 'audit_events', 'offer_revisions', 'fundings']) expect(RETAINED_EVIDENCE_TABLES).toContain(t);
  });
  it('every field gets exactly one treatment', () => {
    const p = planDeletion(DATA_INVENTORY, clean);
    expect(p.erase.length + p.anonymize.length + p.retain.length).toBe(DATA_INVENTORY.length);
  });
  it('funded deals anonymize business facts rather than erase', () => {
    const p = planDeletion(DATA_INVENTORY, { ...clean, hasFundedTransactions: true });
    expect(p.anonymize).toContain('business_name');
    expect(p.erase).toContain('owner_ssn');
  });
  it('retention period is an explicit counsel placeholder', () => {
    expect(EVIDENCE_RETENTION_YEARS).toBeNull();
  });
  it('state machine', () => {
    expect(canTransition('requested', 'verified')).toBe(true);
    expect(canTransition('requested', 'completed')).toBe(false);
    expect(canTransition('verified', 'blocked')).toBe(true);
    expect(canTransition('blocked', 'verified')).toBe(true);
    expect(canTransition('blocked', 'completed')).toBe(false);
    expect(DELETION_TRANSITIONS.completed).toHaveLength(0);
    expect(DELETION_TRANSITIONS.rejected).toHaveLength(0);
  });
});
