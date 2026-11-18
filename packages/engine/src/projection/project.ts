import type { CompanyState, DailyKpi } from '../model/types';
import type { Bps, Money, Score, SimDay } from '../model/units';
import type { Command, CommandError } from '../commands/types';
import { advanceState, applyCommand } from '../core';
import { type RiskLevel, assessRisk } from '../rules/risk';
import {
  avgLeadTimeDays,
  backlog,
  bookMarginBps,
  capacityUtilisationBps,
  deliverySlip,
  materialCoverageDays,
  overtimeSince,
  revenueSince,
} from '../selectors/metrics';
import { avgSatisfaction } from '../systems/kpi';
import { turnoverBps } from '../systems/people';

/** KPIs of a (projected) state, measured over the window that began on `sinceDay`. */
export interface KpiSnapshot {
  day: SimDay;
  cash: Money;
  /** lowest end-of-day cash inside the window (projection only; equals cash otherwise) */
  minCash: Money;
  minCashDay: SimDay;
  revenue: Money;
  backlogValue: Money;
  openOrders: number;
  grossMarginBps: Bps;
  deliverySlipDays: number;
  lateOrders: number;
  avgLeadTimeDays: number;
  avgSatisfaction: Score;
  overtimeHours: number;
  turnoverBps: Bps;
  capacityUtilisationBps: Bps;
  coverageDays: Record<string, number>;
  riskScore: number;
  riskLevel: RiskLevel;
}

export function snapshotKpis(s: CompanyState, sinceDay: SimDay): KpiSnapshot {
  const rows = s.daily.filter((k) => k.day >= sinceDay);
  let minCash = s.cash;
  let minCashDay = s.day;
  for (const k of rows) {
    if (k.cash < minCash) {
      minCash = k.cash;
      minCashDay = k.day;
    }
  }
  const slip = deliverySlip(s, sinceDay);
  const risk = assessRisk(s, sinceDay);
  const coverageDays: Record<string, number> = {};
  for (const m of s.materials) coverageDays[m.id] = materialCoverageDays(s, m.id);
  const bl = backlog(s);
  return {
    day: s.day,
    cash: s.cash,
    minCash,
    minCashDay,
    revenue: revenueSince(s, sinceDay),
    backlogValue: bl.value,
    openOrders: bl.count,
    grossMarginBps: bookMarginBps(s, sinceDay),
    deliverySlipDays: slip.slipDays,
    lateOrders: slip.lateOrders,
    avgLeadTimeDays: avgLeadTimeDays(s),
    avgSatisfaction: avgSatisfaction(s),
    overtimeHours: overtimeSince(s, sinceDay),
    turnoverBps: turnoverBps(s, 'operations'),
    capacityUtilisationBps: capacityUtilisationBps(s),
    coverageDays,
    riskScore: risk.score,
    riskLevel: risk.level,
  };
}

export interface Projection {
  ok: true;
  fromDay: SimDay;
  toDay: SimDay;
  state: CompanyState;
  daily: DailyKpi[];
  checkpoints: { days: number; kpis: KpiSnapshot }[];
  eventCount: number;
}

export type ProjectionResult = Projection | { ok: false; error: CommandError };

/**
 * Run the real engine forward on a copy of `state`: apply `cmds`, then advance `days`, taking KPI
 * snapshots at each checkpoint (days after start). The input state is never touched.
 */
export function projectState(state: CompanyState, cmds: readonly Command[], days: number, checkpoints: number[] = [days]): ProjectionResult {
  let s = state;
  let eventCount = 0;
  for (const c of cmds) {
    const r = applyCommand(s, c);
    if (!r.ok) return { ok: false, error: r.error };
    s = r.state;
    eventCount += r.events.length;
  }
  const start = state.day;
  const marks = [...new Set([...checkpoints.filter((d) => d > 0 && d <= days), days])].sort((a, b) => a - b);
  const out: { days: number; kpis: KpiSnapshot }[] = [];
  let done = 0;
  for (const m of marks) {
    const r = advanceState(s, m - done);
    s = r.state;
    eventCount += r.events.length;
    done = m;
    out.push({ days: m, kpis: snapshotKpis(s, start) });
  }
  return {
    ok: true,
    fromDay: start,
    toDay: s.day,
    state: s,
    daily: s.daily.filter((k) => k.day >= start),
    checkpoints: out,
    eventCount,
  };
}

export interface Runway {
  /** days from today until projected cash first goes below zero (capped at the horizon) */
  days: number;
  capped: boolean;
  firstNegativeDay: SimDay | null;
  horizonDays: number;
}

const runwayCache = new WeakMap<CompanyState, Runway>();

/** Projected cash runway = days until the baseline forecast (no new commands) shows cash < 0. */
export function projectedRunway(state: CompanyState): Runway {
  const hit = runwayCache.get(state);
  if (hit) return hit;
  const horizon = state.settings.runwayHorizonDays;
  let result: Runway;
  if (state.cash < 0) {
    result = { days: 0, capped: false, firstNegativeDay: state.day, horizonDays: horizon };
  } else {
    const { state: end } = advanceState(state, horizon);
    const neg = end.daily.find((k) => k.day >= state.day && k.cash < 0);
    result = neg
      ? { days: neg.day - state.day, capped: false, firstNegativeDay: neg.day, horizonDays: horizon }
      : { days: horizon, capped: true, firstNegativeDay: null, horizonDays: horizon };
  }
  runwayCache.set(state, result);
  return result;
}
