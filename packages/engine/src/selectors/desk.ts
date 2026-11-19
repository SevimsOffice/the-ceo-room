import type { CompanyState, DepartmentId } from '../model/types';
import { type Bps, type Score, type SimDay, clamp, roundHalfEven } from '../model/units';
import {
  HEALTH_BANDS,
  HEALTH_CAPACITY_COMFORT_BPS,
  HEALTH_CAPACITY_MAX_BPS,
  HEALTH_MARGIN_FLOOR_BPS,
  HEALTH_MARGIN_TARGET_BPS,
  HEALTH_ON_TIME_WINDOW_DAYS,
  HEALTH_RUNWAY_FULL_DAYS,
  HEALTH_WEIGHTS,
} from '../config/tuning';
import { type Runway, projectedRunway } from '../projection/project';
import { isWorkday, weekdayIndex } from '../systems/calendar';
import { simDayToDate } from '../model/calendarDate';
import { avgSatisfaction } from '../systems/kpi';
import { companyTurnoverBps, turnoverBps, turnoverRateBps } from '../systems/people';
import { bookMarginBps, capacityUtilisationBps, currentPeriod } from './metrics';

// ---- Calendar ------------------------------------------------------------------------------

export const WEEKDAY_CODES = ['weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/** i18n code of a day's weekday (`day1Weekday` = weekday of Day 1, 0 = Monday as in the seed). */
export function weekdayCode(day: SimDay, day1Weekday = 0): WeekdayCode {
  return WEEKDAY_CODES[weekdayIndex(day, day1Weekday)] ?? 'weekday.mon';
}

/**
 * True when a day's figures are a forecast: the company was imported (Day 1 = its snapshot date, the
 * only actual figures) and the day is after Day 1. The simulated seed is never a forecast.
 */
export function isForecastDay(company: Pick<CompanyState['company'], 'source'>, day: SimDay): boolean {
  return company.source === 'import' && day > 1;
}

export interface CalendarDay {
  day: SimDay;
  /** real ISO date of the day (imported company), null for the simulated seed */
  date: string | null;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  weekdayCode: WeekdayCode;
  workday: boolean;
  forecast: boolean;
}

/** Calendar view of a day (default: today) for the UI: real date, weekday and the forecast flag. */
export function selectCalendarDay(s: CompanyState, day: SimDay = s.day): CalendarDay {
  const w = s.company.day1Weekday;
  return {
    day,
    date: simDayToDate(s.company.snapshotDate, day),
    weekday: weekdayIndex(day, w),
    weekdayCode: weekdayCode(day, w),
    workday: isWorkday(day, w),
    forecast: isForecastDay(s.company, day),
  };
}

// ---- Runway --------------------------------------------------------------------------------

/**
 * Projected runway on its own (the expensive part of the Desk: a 180-day baseline run, ~0.3 s cold,
 * memoised per state). The UI may compute it in a worker and pass it to selectOverallHealth.
 */
export function selectProjectedRunway(s: CompanyState): Runway {
  return projectedRunway(s);
}

// ---- On-time delivery ----------------------------------------------------------------------

/**
 * On-time delivery (bps): orders shipped in the trailing window on or before their promise day,
 * plus open orders not yet overdue, over all of those. No such orders = 10000.
 */
export function onTimeDeliveryBps(s: CompanyState, windowDays: number = HEALTH_ON_TIME_WINDOW_DAYS): Bps {
  let total = 0;
  let onTime = 0;
  for (const o of s.orders) {
    if (o.shippedDay !== null) {
      if (o.shippedDay < s.day - windowDays) continue;
      total++;
      if (o.shippedDay <= o.promisedDay) onTime++;
    } else {
      total++;
      if (s.day <= o.promisedDay) onTime++;
    }
  }
  return total === 0 ? 10000 : roundHalfEven((onTime * 10000) / total);
}

// ---- Overall health ------------------------------------------------------------------------

export type HealthComponentId = keyof typeof HEALTH_WEIGHTS;
export type HealthBand = 'good' | 'fair' | 'poor' | 'critical';

export interface HealthComponent {
  id: HealthComponentId;
  code: string;
  /** the input figure: runway days, gross margin bps, satisfaction Score, on-time bps, utilisation bps */
  value: number;
  /** component score in hundredths of a point (0–10000 = 0–100) */
  score: Score;
  weight: number;
}

export interface OverallHealth {
  /** 0–100 */
  score: number;
  band: HealthBand;
  code: string;
  components: HealthComponent[];
}

/** Linear 0–10000 between lo (0) and hi (10000), clamped. */
function linear(x: number, lo: number, hi: number): Score {
  if (hi <= lo) return x >= hi ? 10000 : 0;
  return roundHalfEven(clamp(((x - lo) * 10000) / (hi - lo), 0, 10000));
}

/**
 * Overall health (ADR-0007): a weighted mean of five component scores, each 0–100:
 * runway (days / 180, capped = 100), gross margin (0% → 0, 25% → 100), average customer
 * satisfaction (as is), on-time delivery (share of on-time orders), capacity strain (utilisation
 * ≤ 85% → 100, ≥ 120% → 0). Weights and thresholds are in config/tuning.ts. `runway` defaults to
 * the memoised projection; pass one computed elsewhere (e.g. a worker) to avoid recomputing.
 */
export function selectOverallHealth(s: CompanyState, runway: Runway = projectedRunway(s)): OverallHealth {
  const margin = bookMarginBps(s, s.day);
  const sat = avgSatisfaction(s);
  const onTime = onTimeDeliveryBps(s);
  const util = capacityUtilisationBps(s);
  const parts: [HealthComponentId, number, Score][] = [
    ['runway', runway.days, runway.capped ? 10000 : linear(runway.days, 0, HEALTH_RUNWAY_FULL_DAYS)],
    ['grossMargin', margin, linear(margin, HEALTH_MARGIN_FLOOR_BPS, HEALTH_MARGIN_TARGET_BPS)],
    ['satisfaction', sat, clamp(sat, 0, 10000)],
    ['onTimeDelivery', onTime, onTime],
    ['capacityStrain', util, 10000 - linear(util, HEALTH_CAPACITY_COMFORT_BPS, HEALTH_CAPACITY_MAX_BPS)],
  ];
  const components: HealthComponent[] = parts.map(([id, value, score]) => ({
    id,
    code: `health.component.${id}`,
    value,
    score,
    weight: HEALTH_WEIGHTS[id],
  }));
  const wsum = components.reduce((t, c) => t + c.weight, 0);
  const score = wsum === 0 ? 0 : roundHalfEven(components.reduce((t, c) => t + c.weight * c.score, 0) / wsum / 100);
  const band: HealthBand = HEALTH_BANDS.find((b) => score >= b.minScore)?.band ?? 'critical';
  return { score, band, code: `health.band.${band}`, components };
}

// ---- Workforce -----------------------------------------------------------------------------

export interface WorkforceFigures {
  headcount: number;
  /** monthly turnover rate now (base + overtime fatigue over the trailing 30 days) */
  turnoverBps: Bps;
  /** the same rate at the close of last month (null before any closed month) */
  lastMonthTurnoverBps: Bps | null;
  turnoverChangeBps: Bps | null;
  /** overtime person-hours worked so far this month */
  overtimeHoursMonth: number;
  overtimeHoursLastMonth: number | null;
}

export interface WorkforceView {
  period: number;
  departments: (WorkforceFigures & { departmentId: DepartmentId; nameKey: string })[];
  total: WorkforceFigures;
}

/**
 * People figures for the Desk, per department and total. Overtime is worked by production crews, so
 * it is booked to operations (as in the turnover model). Last month's rate applies the same formula
 * to last month's overtime with today's headcount (headcount history is not kept).
 */
export function selectWorkforce(s: CompanyState): WorkforceView {
  const p = currentPeriod(s);
  const last = s.periods.find((x) => x.period === p - 1) ?? null;
  const otMonth = s.daily.filter((k) => k.period === p).reduce((t, k) => t + k.overtimePersonHours, 0) + s.dayAcc.overtimePersonHours;
  const otLast = last ? last.overtimePersonHours : null;
  const departments = s.workforce.map((w) => {
    const ops = w.departmentId === 'operations';
    const now = turnoverBps(s, w.departmentId);
    const before = otLast === null ? null : turnoverRateBps(w, otLast, s.settings);
    return {
      departmentId: w.departmentId,
      nameKey: s.departments.find((d) => d.id === w.departmentId)?.nameKey ?? `department.${w.departmentId}`,
      headcount: w.headcount,
      turnoverBps: now,
      lastMonthTurnoverBps: before,
      turnoverChangeBps: before === null ? null : now - before,
      overtimeHoursMonth: ops ? otMonth : 0,
      overtimeHoursLastMonth: otLast === null ? null : ops ? otLast : 0,
    };
  });
  const headcount = departments.reduce((t, d) => t + d.headcount, 0);
  const weighted = (f: (d: (typeof departments)[number]) => number | null): number | null => {
    if (headcount === 0) return 0;
    let num = 0;
    for (const d of departments) {
      const v = f(d);
      if (v === null) return null;
      num += v * d.headcount;
    }
    return Math.round(num / headcount);
  };
  const now = companyTurnoverBps(s);
  const before = weighted((d) => d.lastMonthTurnoverBps);
  return {
    period: p,
    departments,
    total: {
      headcount,
      turnoverBps: now,
      lastMonthTurnoverBps: before,
      turnoverChangeBps: before === null ? null : now - before,
      overtimeHoursMonth: otMonth,
      overtimeHoursLastMonth: otLast,
    },
  };
}
