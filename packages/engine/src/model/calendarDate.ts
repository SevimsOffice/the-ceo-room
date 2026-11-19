import type { SimDay } from './units';

/**
 * Pure proleptic-Gregorian civil-date arithmetic on ISO `YYYY-MM-DD` strings (no host clock or
 * time-zone; integer maths only). Imported companies anchor Day 1 to their snapshot date; the engine
 * itself still runs on SimDay integers.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/** Parse a valid ISO calendar date (years 1000–9999); null when malformed or not a real date. */
export function parseIsoDate(iso: string): CivilDate | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isIsoDate(iso: string): boolean {
  return parseIsoDate(iso) !== null;
}

/** Days since 1970-01-01 (H. Hinnant's days_from_civil). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of daysFromCivil. */
export function civilFromDays(n: number): CivilDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function formatIsoDate(c: CivilDate): string {
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

/** Days since 1970-01-01 of an ISO date; throws on an invalid date (callers validate first). */
export function isoToEpochDay(iso: string): number {
  const c = parseIsoDate(iso);
  if (!c) throw new RangeError(`invalid ISO date: ${iso}`);
  return daysFromCivil(c.year, c.month, c.day);
}

export function epochDayToIso(n: number): string {
  return formatIsoDate(civilFromDays(n));
}

/** Weekday of an ISO date, 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export function isoWeekdayIndex(iso: string): number {
  return (((isoToEpochDay(iso) + 3) % 7) + 7) % 7;
}

/** Real date of a SimDay for a company whose Day 1 is `snapshotDate` (null for the simulated seed). */
export function simDayToDate(snapshotDate: string | null, day: SimDay): string | null {
  if (snapshotDate === null) return null;
  return epochDayToIso(isoToEpochDay(snapshotDate) + day - 1);
}

/** SimDay of a real date: Day 1 = the snapshot date, the day before = Day 0, … */
export function dateToSimDay(snapshotDate: string, iso: string): SimDay {
  return isoToEpochDay(iso) - isoToEpochDay(snapshotDate) + 1;
}
