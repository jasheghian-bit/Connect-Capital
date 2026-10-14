/**
 * CapNet — Underwriting state and decline aggregation tests
 *
 *   npx tsx tests/underwriting-state.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  checkTransition,
  waitingOn,
  aggregateDeclines,
  perProviderLabel,
  type RawDecline,
} from '../lib/underwriting-state';

describe('state machine', () => {
  it('follows the normal path', () => {
    expect(canTransition('not_started', 'reviewing')).toBe(true);
    expect(canTransition('reviewing', 'pending_docs')).toBe(true);
    expect(canTransition('pending_docs', 'approved')).toBe(true);
  });

  it('declined is terminal — no quiet reversal', () => {
    expect(checkTransition('declined', 'approved').allowed).toBe(false);
    expect(checkTransition('declined', 'reviewing').allowed).toBe(false);
  });

  it('approved is NOT terminal — a funder can still withdraw before funding', () => {
    expect(canTransition('approved', 'withdrawn')).toBe(true);
  });

  it('a decline without a reason code is refused', () => {
    expect(checkTransition('reviewing', 'declined').allowed).toBe(false);
    expect(checkTransition('reviewing', 'declined', 'negative_days').allowed).toBe(true);
  });

  it('re-entering the same status is refused', () => {
    expect(checkTransition('reviewing', 'reviewing').allowed).toBe(false);
  });

  it('says whose move it is', () => {
    expect(waitingOn('pending_docs')).toBe('merchant');
    expect(waitingOn('reviewing')).toBe('funder');
    expect(waitingOn('declined')).toBe('nobody');
  });
});

const decline = (
  providerId: string,
  reasonCode: string,
  category: RawDecline['category'],
  label: string,
  hint: string | null = null,
): RawDecline => ({
  providerId,
  reasonCode,
  category,
  merchantFacingLabel: label,
  remediationHint: hint,
});

describe('decline aggregation', () => {
  it('five funders citing one reason is ONE fact, not five rejections', () => {
    const s = aggregateDeclines(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((p) =>
        decline(p, 'negative_days', 'credit', 'Too many days with a negative balance', 'Three clean months usually changes this.'),
      ),
      0,
    );
    expect(s.totalDeclines).toBe(5);
    expect(s.reasons.length).toBe(1);
    expect(s.reasons[0].count).toBe(5);
  });

  it('never shows more than three reasons — no wall of red', () => {
    const s = aggregateDeclines(
      [
        decline('p1', 'industry_excluded', 'fit', 'Industry'),
        decline('p2', 'state_excluded', 'fit', 'State'),
        decline('p3', 'amount_below_min', 'fit', 'Amount'),
        decline('p4', 'position_count', 'fit', 'Positions'),
        decline('p5', 'tib_below_min', 'fit', 'Time in business'),
      ],
      2,
    );
    expect(s.reasons.length).toBe(3);
  });

  it('fit-dominant stays matchable — wrong doors, not a bad business', () => {
    const s = aggregateDeclines(
      [
        decline('p1', 'industry_excluded', 'fit', 'Industry not funded'),
        decline('p2', 'state_excluded', 'fit', 'State not served'),
      ],
      4,
    );
    expect(s.stillMatchable).toBe(true);
    expect(s.remediationTrack).toBe(false);
  });

  it('credit-dominant routes to remediation, not to more matching', () => {
    const s = aggregateDeclines(
      [
        decline('p1', 'negative_days', 'credit', 'Negative days', 'Three clean months usually changes this.'),
        decline('p2', 'nsf_activity', 'credit', 'Returned payments', 'A clean statement period usually changes this.'),
        decline('p3', 'industry_excluded', 'fit', 'Industry'),
      ],
      3,
    );
    expect(s.remediationTrack).toBe(true);
    expect(s.stillMatchable).toBe(false);
    expect(s.headline.includes('clean months')).toBe(true);
  });

  it('a fraud or compliance decline never reveals its reason', () => {
    const s = aggregateDeclines(
      [decline('p1', 'document_integrity', 'fraud', 'Document integrity concern')],
      3,
    );
    expect(s.reasons.length).toBe(0);
    expect(s.headline.toLowerCase().includes('document')).toBe(false);
    expect(s.headline.toLowerCase().includes('fraud')).toBe(false);
  });

  it('no decisions yet is not a failure state', () => {
    const s = aggregateDeclines([], 5);
    expect(s.headline).toBe('No decisions yet.');
    expect(s.stillMatchable).toBe(true);
  });

  it('the headline carries the remedy, not just the verdict', () => {
    const s = aggregateDeclines(
      [decline('p1', 'negative_days', 'credit', 'Negative days', 'Three clean months usually changes this.')],
      0,
    );
    expect(s.headline.length > 20).toBe(true);
    expect(s.headline.includes('clean months')).toBe(true);
  });
});

describe('per-provider labels', () => {
  it('never leaks a fraud reason to the merchant', () => {
    const label = perProviderLabel('declined', 'fraud', 'Document integrity concern');
    expect(label).toBe('Not moving forward');
  });

  it('shows a real fit reason', () => {
    expect(perProviderLabel('declined', 'fit', "Doesn't fund your industry")).toBe(
      "Doesn't fund your industry",
    );
  });

  it('has a label for every status', () => {
    for (const s of ['not_started', 'reviewing', 'pending_docs', 'pending_conditions', 'approved', 'withdrawn'] as const) {
      expect(perProviderLabel(s).length > 3).toBe(true);
    }
  });
});
