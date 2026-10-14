/**
 * CapNet — Grading tests
 *
 *   npx tsx tests/grading.test.ts
 */

import { describe, it, expect } from 'vitest';
import { gradeFile, RUBRIC_VERSION, type GradingInput } from '../lib/grading';

const STRONG: GradingInput = {
  avgMonthlyRevenue: 180000,
  avgDailyBalance: 32000,
  timeInBusinessMonths: 84,
  negativeDays: 0,
  nsfCount: 0,
  depositCount: 70,
  monthsCovered: 6,
  positionCount: 0,
  confidence: 'verified',
};

const MARGINAL: GradingInput = {
  avgMonthlyRevenue: 22000,
  avgDailyBalance: 900,
  timeInBusinessMonths: 14,
  negativeDays: 6,
  nsfCount: 3,
  depositCount: 12,
  monthsCovered: 4,
  positionCount: 2,
  confidence: 'stated',
};

describe('grading bands', () => {
  it('a clean, seasoned, high-revenue file grades A', () => {
    expect(gradeFile(STRONG).grade).toBe('A');
  });

  it('a thin, negative-heavy, stacked file grades D or F', () => {
    expect(['D', 'F'].includes(gradeFile(MARGINAL).grade)).toBe(true);
  });

  it('negative days move the grade materially', () => {
    const clean = gradeFile(STRONG).score;
    const dirty = gradeFile({ ...STRONG, negativeDays: 9 }).score;
    expect(clean - dirty >= 15).toBe(true);
  });

  it('open positions reduce the score', () => {
    expect(gradeFile({ ...STRONG, positionCount: 3 }).score < gradeFile(STRONG).score).toBe(true);
  });
});

describe('insufficient data is not a bad grade', () => {
  it('under 3 months is flagged as insufficient, not judged', () => {
    const r = gradeFile({ ...STRONG, monthsCovered: 2 });
    expect(r.insufficientData).toBe(true);
    expect(r.factors[0].note.includes('3 months')).toBe(true);
  });

  it('a graded file is never flagged insufficient', () => {
    expect(gradeFile(STRONG).insufficientData).toBe(false);
  });
});

describe('confidence discounting', () => {
  it('self-reported scores below bank-verified on identical numbers', () => {
    const verified = gradeFile(STRONG).score;
    const stated = gradeFile({ ...STRONG, confidence: 'stated' }).score;
    expect(stated < verified).toBe(true);
  });

  it('the discount is recorded as a visible factor, not hidden in the score', () => {
    const r = gradeFile({ ...STRONG, confidence: 'stated' });
    const f = r.factors.find((x) => x.name === 'Data confidence');
    expect(f !== undefined).toBe(true);
    expect(f.note.includes('discounted')).toBe(true);
  });
});

describe('auditability', () => {
  it('every grade carries its rubric version', () => {
    expect(gradeFile(STRONG).rubricVersion).toBe(RUBRIC_VERSION);
  });

  it('every grade explains itself factor by factor', () => {
    const r = gradeFile(STRONG);
    expect(r.factors.length >= 7).toBe(true);
    for (const f of r.factors) expect(f.note.length > 0).toBe(true);
  });
});
