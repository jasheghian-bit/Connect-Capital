/**
 * CapNet — File grading
 *
 * A–F on the industry's own vocabulary. Grading exists for one commercial
 * reason: match precision is a funder-retention feature.
 *
 * A D-paper merchant shown twelve funders wastes eleven underwriters' time and
 * teaches every one of them that CapNet sends junk. The same merchant
 * shown three funders who actually buy D paper is a good file for all four
 * parties. Grading is what makes narrow routing possible.
 *
 * ── HONESTY ────────────────────────────────────────────────────────────────
 *
 * This is a weighted rubric, not a model. It has no training data behind it
 * and it does not predict default. It sorts files into bands roughly the way
 * an experienced underwriter would at a glance, so the matching engine can
 * route narrowly.
 *
 * Every grade carries `rubricVersion` and the factors that produced it, so
 * that when there ARE funded outcomes to learn from, the rubric can be
 * replaced and old grades stay interpretable.
 *
 * The grade is never shown to the merchant. "You are a C" is not information a
 * business owner can act on, and it is a claim the platform cannot substantiate.
 */

export const RUBRIC_VERSION = 'mca-v1';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Confidence = 'verified' | 'parsed' | 'stated';

export interface GradingInput {
  avgMonthlyRevenue: number | null;
  avgDailyBalance: number | null;
  timeInBusinessMonths: number | null;
  negativeDays: number | null;
  nsfCount: number | null;
  depositCount: number | null;
  monthsCovered: number | null;
  positionCount: number;
  confidence: Confidence;
}

export interface GradeFactor {
  name: string;
  points: number;
  max: number;
  note: string;
}

export interface GradeResult {
  grade: Grade;
  score: number;
  rubricVersion: string;
  factors: GradeFactor[];
  /** True when the file cannot be graded meaningfully yet. */
  insufficientData: boolean;
}

function band(
  value: number | null,
  thresholds: Array<[number, number]>,
  max: number,
  name: string,
  fmt: (v: number) => string,
): GradeFactor {
  if (value === null) {
    return { name, points: 0, max, note: 'not provided' };
  }
  for (const [threshold, points] of thresholds) {
    if (value >= threshold) {
      return { name, points, max, note: fmt(value) };
    }
  }
  return { name, points: 0, max, note: fmt(value) };
}

function inverseBand(
  value: number | null,
  thresholds: Array<[number, number]>,
  max: number,
  name: string,
  fmt: (v: number) => string,
): GradeFactor {
  if (value === null) {
    return { name, points: 0, max, note: 'not provided' };
  }
  for (const [ceiling, points] of thresholds) {
    if (value <= ceiling) {
      return { name, points, max, note: fmt(value) };
    }
  }
  return { name, points: 0, max, note: fmt(value) };
}

export function gradeFile(input: GradingInput): GradeResult {
  // Below three months there is nothing to grade. Returning 'F' would be a
  // judgment the data does not support — the file is thin, not bad, and the
  // remediation path is completely different.
  if (!input.monthsCovered || input.monthsCovered < 3 || !input.avgMonthlyRevenue) {
    return {
      grade: 'F',
      score: 0,
      rubricVersion: RUBRIC_VERSION,
      insufficientData: true,
      factors: [
        {
          name: 'Banking history',
          points: 0,
          max: 100,
          note: 'fewer than 3 months of activity',
        },
      ],
    };
  }

  const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

  const factors: GradeFactor[] = [
    band(
      input.avgMonthlyRevenue,
      [
        [150000, 25],
        [80000, 21],
        [40000, 16],
        [20000, 10],
        [10000, 5],
      ],
      25,
      'Monthly revenue',
      money,
    ),

    band(
      input.timeInBusinessMonths,
      [
        [60, 20],
        [36, 17],
        [24, 13],
        [12, 8],
        [6, 4],
      ],
      20,
      'Time in business',
      (v) => (v >= 24 ? `${Math.floor(v / 12)} yrs` : `${v} months`),
    ),

    // Negative days are the strongest single signal an underwriter reacts to.
    // A merchant who goes negative is a merchant whose daily debit will bounce.
    inverseBand(
      input.negativeDays,
      [
        [0, 20],
        [2, 16],
        [4, 11],
        [7, 5],
        [10, 2],
      ],
      20,
      'Negative days',
      (v) => `${v} days`,
    ),

    inverseBand(
      input.nsfCount,
      [
        [0, 10],
        [1, 8],
        [3, 5],
        [5, 2],
      ],
      10,
      'NSF activity',
      (v) => `${v} returns`,
    ),

    band(
      input.avgDailyBalance,
      [
        [25000, 10],
        [10000, 8],
        [5000, 6],
        [2000, 3],
        [500, 1],
      ],
      10,
      'Average daily balance',
      money,
    ),

    // Deposit frequency separates steady operating revenue from a business
    // living on two large invoices a month.
    band(
      input.depositCount,
      [
        [60, 8],
        [30, 6],
        [15, 4],
        [8, 2],
      ],
      8,
      'Deposit frequency',
      (v) => `${v} deposits`,
    ),

    inverseBand(
      input.positionCount,
      [
        [0, 7],
        [1, 5],
        [2, 2],
      ],
      7,
      'Open positions',
      (v) => `${v} open`,
    ),
  ];

  const raw = factors.reduce((s, f) => s + f.points, 0);

  // Self-reported figures are discounted rather than rejected. A merchant who
  // will not link a bank is not disqualified; their file is simply worth less
  // certainty, and the discount is what makes the bank-link ask honest.
  const confidenceMultiplier =
    input.confidence === 'verified' ? 1 : input.confidence === 'parsed' ? 0.95 : 0.85;

  const score = Math.round(raw * confidenceMultiplier);

  factors.push({
    name: 'Data confidence',
    points: score - raw,
    max: 0,
    note:
      input.confidence === 'verified'
        ? 'bank-verified'
        : input.confidence === 'parsed'
          ? 'parsed from statements'
          : 'self-reported (discounted)',
  });

  return {
    grade: toGrade(score),
    score,
    rubricVersion: RUBRIC_VERSION,
    insufficientData: false,
    factors,
  };
}

function toGrade(score: number): Grade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 48) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}
