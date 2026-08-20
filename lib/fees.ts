/**
 * Connect Capital — Fee engine
 *
 * R6: the fee rate is configurable data, never a constant in code. "3%" is a
 * row in a table with an effective date and an agreement behind it, because
 * the first provider who negotiates 2.5% will arrive long before anyone is
 * ready to ship a migration for them.
 *
 * ── THE BUG THIS FILE IS BUILT TO AVOID ────────────────────────────────────
 *
 * Computing a fee against the schedule in effect NOW rather than the schedule
 * in effect WHEN THE DEAL FUNDED.
 *
 * It never surfaces during development, because during development those are
 * the same date. It surfaces the first time a rate changes and someone re-runs
 * a report over historical fundings — every past deal silently reprices, the
 * numbers stop matching the invoices already sent, and reconciling it means
 * reconstructing what the rate used to be from memory.
 *
 * So `resolveSchedule` takes the funding date and every function here is
 * evaluated as-of that date. There is no "current schedule" accessor.
 */

export type FeeType = 'success' | 'subscription' | 'specialist' | 'data';
export type OriginationChannel = 'self_serve' | 'specialist_assisted' | 'funder_referral' | 'partner';

export interface FeeTier {
  /** Upper bound of this tier. null means "everything above". */
  upToAmount: number | null;
  rateBps: number;
}

export interface FeeSchedule {
  id: string;
  /** null = platform default, applying to any provider without their own. */
  providerOrgId: string | null;
  /** null = any product. */
  productType: string | null;
  /** null = any origination channel. */
  channel: OriginationChannel | null;
  feeType: FeeType;
  rateBps: number;
  minFee: number | null;
  maxFee: number | null;
  /** Marginal, like tax brackets. Empty means flat rateBps throughout. */
  tiers: FeeTier[];
  effectiveFrom: Date;
  effectiveTo: Date | null;
  agreementId: string | null;
}

export interface FeeContext {
  providerOrgId: string;
  productType: string;
  channel: OriginationChannel;
  feeType: FeeType;
  fundedAt: Date;
}

/**
 * Specificity. A schedule negotiated with one provider beats the platform
 * default; a product-specific rate beats a general one.
 *
 * Weights are powers of two so the ordering can never tie on different
 * combinations — provider alone always outranks product plus channel together,
 * which is the intended precedence and would be fragile with weights of
 * 3/2/1.
 */
function specificity(s: FeeSchedule): number {
  return (s.providerOrgId ? 4 : 0) + (s.productType ? 2 : 0) + (s.channel ? 1 : 0);
}

function appliesTo(s: FeeSchedule, ctx: FeeContext): boolean {
  if (s.feeType !== ctx.feeType) return false;
  if (s.providerOrgId && s.providerOrgId !== ctx.providerOrgId) return false;
  if (s.productType && s.productType !== ctx.productType) return false;
  if (s.channel && s.channel !== ctx.channel) return false;
  if (s.effectiveFrom > ctx.fundedAt) return false;
  if (s.effectiveTo && s.effectiveTo <= ctx.fundedAt) return false;
  return true;
}

/**
 * The schedule that governed this deal on the day it funded.
 *
 * Returns null rather than falling back to something plausible. A funding with
 * no applicable schedule is a configuration gap that needs a human, and
 * silently applying a default would bill a provider under terms they never
 * agreed to.
 */
export function resolveSchedule(
  schedules: FeeSchedule[],
  ctx: FeeContext,
): FeeSchedule | null {
  const candidates = schedules.filter((s) => appliesTo(s, ctx));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;
    // Same specificity: the most recently effective one won the negotiation.
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  })[0];
}

export interface FeeComputation {
  scheduleId: string;
  basisAmount: number;
  /** Effective rate after tiering, floors, and caps. For reporting. */
  effectiveRateBps: number;
  feeAmount: number;
  appliedFloor: boolean;
  appliedCap: boolean;
  breakdown: Array<{ band: string; amount: number; rateBps: number; fee: number }>;
}

/**
 * Marginal tiering, deliberately.
 *
 * Flat-by-tier creates a cliff: at a 3%/2% break on $250,000, a $250,001 deal
 * would earn $5,000 while a $250,000 deal earns $7,500. That is an incentive to
 * shave a deal by a dollar, and it is the kind of thing nobody notices until a
 * provider notices it first.
 *
 * With marginal tiers, a larger funding always earns at least as much. There is
 * a test that asserts exactly that across the whole range.
 */
export function computeFee(
  schedule: FeeSchedule,
  basisAmount: number,
): FeeComputation {
  if (basisAmount <= 0) {
    return {
      scheduleId: schedule.id,
      basisAmount: 0,
      effectiveRateBps: 0,
      feeAmount: 0,
      appliedFloor: false,
      appliedCap: false,
      breakdown: [],
    };
  }

  const breakdown: FeeComputation['breakdown'] = [];
  let raw = 0;

  if (schedule.tiers.length === 0) {
    raw = (basisAmount * schedule.rateBps) / 10000;
    breakdown.push({
      band: 'all',
      amount: basisAmount,
      rateBps: schedule.rateBps,
      fee: Math.round(raw * 100) / 100,
    });
  } else {
    const tiers = [...schedule.tiers].sort((a, b) => {
      if (a.upToAmount === null) return 1;
      if (b.upToAmount === null) return -1;
      return a.upToAmount - b.upToAmount;
    });

    let floorOfBand = 0;
    for (const tier of tiers) {
      const ceiling = tier.upToAmount ?? Infinity;
      if (basisAmount <= floorOfBand) break;

      const inBand = Math.min(basisAmount, ceiling) - floorOfBand;
      if (inBand <= 0) {
        floorOfBand = ceiling;
        continue;
      }

      const bandFee = (inBand * tier.rateBps) / 10000;
      raw += bandFee;

      breakdown.push({
        band:
          ceiling === Infinity
            ? `above ${floorOfBand.toLocaleString('en-US')}`
            : `${floorOfBand.toLocaleString('en-US')}–${ceiling.toLocaleString('en-US')}`,
        amount: Math.round(inBand),
        rateBps: tier.rateBps,
        fee: Math.round(bandFee * 100) / 100,
      });

      floorOfBand = ceiling;
    }
  }

  let feeAmount = raw;
  let appliedFloor = false;
  let appliedCap = false;

  if (schedule.minFee !== null && feeAmount < schedule.minFee) {
    feeAmount = schedule.minFee;
    appliedFloor = true;
  }
  if (schedule.maxFee !== null && feeAmount > schedule.maxFee) {
    feeAmount = schedule.maxFee;
    appliedCap = true;
  }

  feeAmount = Math.round(feeAmount * 100) / 100;

  return {
    scheduleId: schedule.id,
    basisAmount,
    effectiveRateBps: Math.round((feeAmount / basisAmount) * 10000),
    feeAmount,
    appliedFloor,
    appliedCap,
    breakdown,
  };
}

export interface FeeResult {
  computed: FeeComputation | null;
  /** Populated when no schedule applied. Needs a human, not a default. */
  gap: string | null;
}

export function feeForFunding(
  schedules: FeeSchedule[],
  ctx: FeeContext,
  basisAmount: number,
): FeeResult {
  const schedule = resolveSchedule(schedules, ctx);
  if (!schedule) {
    return {
      computed: null,
      gap: `no ${ctx.feeType} schedule in effect for provider ${ctx.providerOrgId}, product ${ctx.productType}, channel ${ctx.channel} on ${ctx.fundedAt.toISOString().slice(0, 10)}`,
    };
  }
  return { computed: computeFee(schedule, basisAmount), gap: null };
}

/**
 * The platform default. Seeded as data, not compiled in — this is the shape a
 * migration inserts, and it is here so the default is written down in one
 * legible place rather than reconstructed from a SQL file.
 */
export function defaultSuccessFeeSchedule(effectiveFrom: Date): Omit<FeeSchedule, 'id'> {
  return {
    providerOrgId: null,
    productType: null,
    channel: null,
    feeType: 'success',
    rateBps: 300,
    minFee: null,
    maxFee: null,
    tiers: [],
    effectiveFrom,
    effectiveTo: null,
    agreementId: null,
  };
}
