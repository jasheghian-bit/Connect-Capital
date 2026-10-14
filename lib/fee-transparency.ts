/**
 * CapNet — Fee transparency
 *
 * Founder decisions, pinned here:
 *  - The funder prices CapNet's platform fee into its offer. The merchant
 *    never sees the funder's buy rate or loading — that is the funder's
 *    commercial term, not a cost to the merchant.
 *  - The merchant IS told, plainly, that the offer includes CapNet's platform
 *    fee paid by the funder. A fee folded into price and never mentioned is
 *    the definition of hidden.
 *  - Every cost the merchant bears is itemized: factor / total repayment and
 *    every origination or other fee. A fee in the offer that is not in the
 *    disclosed list is refused, not warned about.
 *
 * Does not change disclosure math (lib/disclosure.ts).
 */

import type { Disclosure, Fee, OfferTerms } from './disclosure';

export function merchantFeeNotice(): string {
  return (
    'This offer includes CapNet’s platform fee, which is paid by the funder and ' +
    'priced into the offer. You do not pay CapNet separately. Every cost you pay ' +
    'is listed below: the total repayment and each fee, with nothing left out.'
  );
}

export class UndisclosedFee extends Error {
  constructor(public readonly problems: string[]) {
    super(`offer has undisclosed or invalid fees: ${problems.join('; ')}`);
  }
}

// Labels that describe the funder's economics, not a merchant cost. They must
// never reach a merchant-facing itemization.
const FUNDER_INTERNAL = /\b(buy ?rate|loading|points|commission|iso)\b/i;

const sameFee = (a: Fee, b: Fee) =>
  a.label === b.label && a.amount === b.amount && a.deductedUpfront === b.deductedUpfront;

export function undisclosedFeeProblems(terms: OfferTerms, disclosure: Disclosure): string[] {
  const problems: string[] = [];
  const disclosed = [...disclosure.itemizedFees];
  for (const fee of terms.fees) {
    if (!fee.label?.trim()) problems.push('fee with no label');
    if (!(fee.amount >= 0) || !Number.isFinite(fee.amount)) problems.push(`fee "${fee.label}" has invalid amount`);
    if (FUNDER_INTERNAL.test(fee.label ?? '')) problems.push(`fee "${fee.label}" exposes funder-internal pricing`);
    const i = disclosed.findIndex((d) => sameFee(d, fee));
    if (i === -1) problems.push(`fee "${fee.label}" is not in the disclosure`);
    else disclosed.splice(i, 1);
  }
  if (disclosure.totalRepayment !== Math.round(terms.totalRepayment))
    problems.push('total repayment differs from disclosure');
  return problems;
}

export function assertNoUndisclosedFees(terms: OfferTerms, disclosure: Disclosure): void {
  const p = undisclosedFeeProblems(terms, disclosure);
  if (p.length) throw new UndisclosedFee(p);
}
