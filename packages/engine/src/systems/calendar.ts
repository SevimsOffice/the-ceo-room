import type { SimDay } from '../model/units';

/**
 * Weekday of a day, 0 = Mon … 6 = Sun. `day1Weekday` is the weekday of Day 1: 0 (Monday) for the
 * simulated seed, the snapshot date's weekday for an imported company (`Company.day1Weekday`).
 * Saturday and Sunday have no production.
 */
export function weekdayIndex(day: SimDay, day1Weekday = 0): number {
  return (((day - 1 + day1Weekday) % 7) + 7) % 7;
}

export function isWorkday(day: SimDay, day1Weekday = 0): boolean {
  return weekdayIndex(day, day1Weekday) < 5;
}

/** Period (simulated month) of a day. Day 1..L = period 1; seeded history uses periods 0, -1. */
export function periodOf(day: SimDay, periodLength: number): number {
  return Math.floor((day - 1) / periodLength) + 1;
}

export function isPeriodStart(day: SimDay, periodLength: number): boolean {
  return (day - 1) % periodLength === 0;
}
