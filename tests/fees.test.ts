/**
 * CapNet — Fee engine tests
 *
 * This is where the company's revenue is computed. Two failure modes matter
 * more than the rest: pricing a historical funding against today's schedule,
 * and a tier cliff that makes a larger deal earn less than a smaller one.
 *
 *   npx tsx tests/fees.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSchedule,
  computeFee,
  feeForFunding,
  defaultSuccessFeeSchedule,
  type FeeSchedule,
  type FeeContext,
} from '../lib/fees';

const d = (iso: string) => new Date(iso + 'T00:00:00Z');

const sched = (over: Partial<FeeSchedule> & { id: string }): FeeSchedule => ({
  providerOrgId: null,
  productType: null,
  channel: null,
  feeType: 'success',
  rateBps: 300,
  minFee: null,
  maxFee: null,
  tiers: [],
  effectiveFrom: d('2026-01-01'),
  effectiveTo: null,
  agreementId: null,
  ...over,
});

const ctx = (over: Partial<FeeContext> = {}): FeeContext => ({
  providerOrgId: 'org_harbor',
  productType: 'mca',
  channel: 'self_serve',
  feeType: 'success',
  fundedAt: d('2026-06-15'),
  ...over,
});

describe('the platform default', () => {
  it('is 3%, as data rather than as code', () => {
    const s = { ...defaultSuccessFeeSchedule(d('2026-01-01')), id: 'default' };
    expect(computeFee(s, 100000).feeAmount).toBe(3000);
  });
});

describe('schedule resolution', () => {
  it('a provider-specific rate beats the platform default', () => {
    const chosen = resolveSchedule(
      [
        sched({ id: 'default', rateBps: 300 }),
        sched({ id: 'harbor', providerOrgId: 'org_harbor', rateBps: 250 }),
      ],
      ctx(),
    );
    expect(chosen.id).toBe('harbor');
  });

  it('another provider\'s rate does not apply', () => {
    const chosen = resolveSchedule(
      [
        sched({ id: 'default', rateBps: 300 }),
        sched({ id: 'ridgeline', providerOrgId: 'org_ridgeline', rateBps: 200 }),
      ],
      ctx(),
    );
    expect(chosen.id).toBe('default');
  });

  it('provider alone outranks product plus channel together', () => {
    const chosen = resolveSchedule(
      [
        sched({ id: 'harbor', providerOrgId: 'org_harbor' }),
        sched({ id: 'prod_chan', productType: 'mca', channel: 'self_serve' }),
      ],
      ctx(),
    );
    expect(chosen.id).toBe('harbor');
  });

  it('channel-specific schedules separate the two economies', () => {
    const schedules = [
      sched({ id: 'self', channel: 'self_serve', rateBps: 300 }),
      sched({ id: 'assisted', channel: 'specialist_assisted', rateBps: 0 }),
    ];
    expect(resolveSchedule(schedules, ctx({ channel: 'self_serve' })).id).toBe('self');
    expect(
      resolveSchedule(schedules, ctx({ channel: 'specialist_assisted' })).id,
    ).toBe('assisted');
  });

  it('returns null rather than inventing a rate when nothing applies', () => {
    expect(resolveSchedule([sched({ id: 'x', feeType: 'subscription' })], ctx())).toBe(null);
  });
});

describe('effective dating — the reporting bug', () => {
  const schedules = [
    sched({ id: 'old', rateBps: 300, effectiveFrom: d('2026-01-01'), effectiveTo: d('2026-06-01') }),
    sched({ id: 'new', rateBps: 250, effectiveFrom: d('2026-06-01') }),
  ];

  it('a deal funded in March is priced at the March rate', () => {
    expect(resolveSchedule(schedules, ctx({ fundedAt: d('2026-03-10') })).id).toBe('old');
  });

  it('a deal funded in July is priced at the July rate', () => {
    expect(resolveSchedule(schedules, ctx({ fundedAt: d('2026-07-10') })).id).toBe('new');
  });

  it('re-running a historical funding does NOT reprice it', () => {
    // The failure that silently rewrites every invoice already sent.
    const march = feeForFunding(schedules, ctx({ fundedAt: d('2026-03-10') }), 100000);
    expect(march.computed.feeAmount).toBe(3000);
    expect(march.computed.feeAmount).not.toBe(2500);
  });

  it('a schedule not yet in effect never applies', () => {
    const future = [sched({ id: 'future', effectiveFrom: d('2027-01-01') })];
    expect(resolveSchedule(future, ctx())).toBe(null);
  });
});

describe('marginal tiering', () => {
  const tiered = sched({
    id: 'tiered',
    tiers: [
      { upToAmount: 250000, rateBps: 300 },
      { upToAmount: null, rateBps: 200 },
    ],
  });

  it('charges the first band at the first rate', () => {
    expect(computeFee(tiered, 100000).feeAmount).toBe(3000);
  });

  it('charges only the excess at the second rate', () => {
    // 250,000 @ 3% = 7,500 · 250,000 @ 2% = 5,000
    expect(computeFee(tiered, 500000).feeAmount).toBe(12500);
  });

  it('has NO cliff — one dollar more never earns less', () => {
    for (const amount of [249999, 250000, 250001, 250100]) {
      const here = computeFee(tiered, amount).feeAmount;
      const more = computeFee(tiered, amount + 1).feeAmount;
      expect(more >= here).toBe(true);
    }
  });

  it('shows the band breakdown for the invoice', () => {
    const r = computeFee(tiered, 500000);
    expect(r.breakdown.length).toBe(2);
    expect(r.breakdown[0].fee).toBe(7500);
    expect(r.breakdown[1].fee).toBe(5000);
  });

  it('reports an effective rate below the headline on large deals', () => {
    expect(computeFee(tiered, 500000).effectiveRateBps).toBe(250);
  });
});

describe('floors and caps', () => {
  it('a floor protects the economics of small deals', () => {
    const s = sched({ id: 'floored', minFee: 500 });
    const r = computeFee(s, 10000);
    expect(r.feeAmount).toBe(500);
    expect(r.appliedFloor).toBe(true);
  });

  it('a cap limits the fee on very large deals', () => {
    const s = sched({ id: 'capped', maxFee: 15000 });
    const r = computeFee(s, 1000000);
    expect(r.feeAmount).toBe(15000);
    expect(r.appliedCap).toBe(true);
  });

  it('flags when a floor or cap moved the number, for reconciliation', () => {
    const r = computeFee(sched({ id: 'plain' }), 100000);
    expect(r.appliedFloor).toBe(false);
    expect(r.appliedCap).toBe(false);
  });
});

describe('configuration gaps', () => {
  it('reports the gap instead of billing a made-up rate', () => {
    const r = feeForFunding([], ctx(), 100000);
    expect(r.computed).toBe(null);
    expect(r.gap.includes('no success schedule')).toBe(true);
  });

  it('the gap message names what was missing', () => {
    const r = feeForFunding([], ctx({ providerOrgId: 'org_x' }), 100000);
    expect(r.gap.includes('org_x')).toBe(true);
    expect(r.gap.includes('mca')).toBe(true);
  });

  it('a zero-amount funding produces a zero fee, not an error', () => {
    expect(computeFee(sched({ id: 's' }), 0).feeAmount).toBe(0);
  });
});
