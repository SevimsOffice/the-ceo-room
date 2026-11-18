/**
 * Units (ADR-0004).
 * - Money: integer kuruş, branded. Never a float.
 * - Bps: integer basis points (10000 = 100%).
 * - Score: integer hundredths of a point on a 0–100 scale (8100 = 81.00).
 * - SimDay: integer day index, Day 1 = Monday.
 */
export type Money = number & { readonly __brand: 'Money' };
export type Bps = number;
export type Score = number;
export type SimDay = number;

export class InvariantError extends Error {}

export function money(n: number): Money {
  if (!Number.isSafeInteger(n)) throw new InvariantError(`money must be a safe integer, got ${n}`);
  return n as Money;
}

export const ZERO = 0 as Money;

/** Banker's rounding (round half to even); the one rounding helper for the engine. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function addM(...xs: Money[]): Money {
  let t = 0;
  for (const x of xs) t += x;
  return money(t);
}

export function subM(a: Money, b: Money): Money {
  return money(a - b);
}

export function sumM(xs: readonly Money[]): Money {
  let t = 0;
  for (const x of xs) t += x;
  return money(t);
}

export function negM(a: Money): Money {
  return money(-a);
}

/** unit price × integer quantity */
export function timesQty(unit: Money, qty: number): Money {
  return money(unit * qty);
}

/** money × bps / 10000, banker's rounding */
export function mulBps(m: Money, bps: Bps): Money {
  return money(roundHalfEven((m * bps) / 10000));
}

/** money × num / den, banker's rounding */
export function mulDiv(m: Money, num: number, den: number): Money {
  if (den === 0) return ZERO;
  return money(roundHalfEven((m * num) / den));
}

/** num / den as basis points */
export function ratioBps(num: number, den: number): Bps {
  if (den === 0) return 0;
  return roundHalfEven((num * 10000) / den);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function minM(a: Money, b: Money): Money {
  return (a < b ? a : b);
}

export function maxM(a: Money, b: Money): Money {
  return (a > b ? a : b);
}

/** whole TRY → kuruş (seed/test helper) */
export function tl(n: number): Money {
  return money(roundHalfEven(n * 100));
}
