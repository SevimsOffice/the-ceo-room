import type { SimDay } from '../model/units';

/** Day 1 is a Monday; Saturday and Sunday have no production. */
export function weekdayIndex(day: SimDay): number {
  return (((day - 1) % 7) + 7) % 7; // 0 = Mon … 6 = Sun
}

export function isWorkday(day: SimDay): boolean {
  return weekdayIndex(day) < 5;
}

/** Period (simulated month) of a day. Day 1..L = period 1; seeded history uses periods 0, -1. */
export function periodOf(day: SimDay, periodLength: number): number {
  return Math.floor((day - 1) / periodLength) + 1;
}

export function isPeriodStart(day: SimDay, periodLength: number): boolean {
  return (day - 1) % periodLength === 0;
}
