/**
 * CapNet — Owner age gate
 *
 * CapNet serves business owners aged 18 and over. It does not knowingly
 * collect children's data, and an MCA contract with a minor is voidable — a
 * funder relying on it holds nothing.
 *
 * Must run at owner intake BEFORE the DOB is sent to the vault. On rejection
 * the DOB is discarded, not stored: a rejected minor's birthdate is exactly
 * the data we promised not to keep. Owner intake is not built yet; this is
 * the check it must call.
 */

export type AgeCheck =
  | { ok: true }
  | { ok: false; reason: 'under_18' | 'invalid_date' | 'future_date' };

export const MINIMUM_AGE = 18;

/** Parses YYYY-MM-DD strictly (no rollover: 2023-02-30 is invalid). */
export function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * Whole years completed on `onDate`. Calendar arithmetic, not milliseconds /
 * 365.25 — that approximation is off by a day around birthdays. A Feb 29
 * birthday is treated as reached on Mar 1 in non-leap years (the common legal
 * reading; counsel may confirm per state).
 */
export function ageOn(dob: string, onDate: string): number | null {
  const b = parseDate(dob);
  const t = parseDate(onDate);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  return age;
}

export function checkOwnerAge(dob: string, today: string): AgeCheck {
  const b = parseDate(dob);
  const t = parseDate(today);
  if (!b || !t) return { ok: false, reason: 'invalid_date' };
  if (dob > today) return { ok: false, reason: 'future_date' };
  return (ageOn(dob, today) ?? 0) >= MINIMUM_AGE ? { ok: true } : { ok: false, reason: 'under_18' };
}
