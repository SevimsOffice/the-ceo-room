import type { CompanyState } from '../model/types';
import type { Bps, Money, Score, SimDay } from '../model/units';
import { money } from '../model/units';
import { deepFreeze } from '../model/freeze';
import type { CommandError } from '../commands/types';
import type { RiskLevel } from '../rules/risk';
import { type KpiSnapshot, projectState } from './project';
import { DECISION_HORIZONS } from '../config/tuning';

export interface ImpactDelta {
  cash: Money;
  minCash: Money;
  grossMarginBps: Bps;
  deliverySlipDays: number;
  lateOrders: number;
  avgLeadTimeDays: number;
  avgSatisfaction: Score;
  overtimeHours: number;
  turnoverBps: Bps;
  riskScore: number;
}

/**
 * Supplier bills (payables, not cancelled) falling due in this horizon's window
 * [start + previous checkpoint, start + horizon): the days whose evenings this checkpoint adds.
 * A later horizon shows bills an earlier view cannot (e.g. +90 shows what falls due after +30).
 */
export interface PayablesDue {
  fromDay: SimDay;
  /** inclusive */
  toDay: SimDay;
  baseline: Money;
  option: Money;
  /** option − baseline */
  delta: Money;
  /** first day in the window on which the option's cumulative bills exceed the baseline's (null = never) */
  firstExtraDueDay: SimDay | null;
}

export interface HorizonImpact {
  horizonDays: number;
  baseline: KpiSnapshot;
  option: KpiSnapshot;
  delta: ImpactDelta;
  risk: { baseline: RiskLevel; option: RiskLevel };
  payablesDue: PayablesDue;
}

export interface OptionImpact {
  optionId: string;
  horizons: HorizonImpact[];
  error: CommandError | null;
}

export interface DecisionImpacts {
  decisionId: string;
  horizons: number[];
  baseline: { horizonDays: number; kpis: KpiSnapshot }[];
  options: OptionImpact[];
}

export function deltaOf(base: KpiSnapshot, opt: KpiSnapshot): ImpactDelta {
  return {
    cash: money(opt.cash - base.cash),
    minCash: money(opt.minCash - base.minCash),
    grossMarginBps: opt.grossMarginBps - base.grossMarginBps,
    deliverySlipDays: opt.deliverySlipDays - base.deliverySlipDays,
    lateOrders: opt.lateOrders - base.lateOrders,
    avgLeadTimeDays: opt.avgLeadTimeDays - base.avgLeadTimeDays,
    avgSatisfaction: opt.avgSatisfaction - base.avgSatisfaction,
    overtimeHours: opt.overtimeHours - base.overtimeHours,
    turnoverBps: opt.turnoverBps - base.turnoverBps,
    riskScore: opt.riskScore - base.riskScore,
  };
}

/** Payables (not cancelled) due on each day of [from, to] in a projected end state. */
function dueByDay(s: CompanyState, from: SimDay, to: SimDay): Map<SimDay, number> {
  const out = new Map<SimDay, number>();
  for (const p of s.payables) {
    if (p.status === 'cancelled' || p.dueDay < from || p.dueDay > to) continue;
    out.set(p.dueDay, (out.get(p.dueDay) ?? 0) + p.amount);
  }
  return out;
}

/** Compare bills due in [from, to] between two projected end states (both run at least to `to`). */
export function payablesDue(base: CompanyState, opt: CompanyState, from: SimDay, to: SimDay): PayablesDue {
  const b = dueByDay(base, from, to);
  const o = dueByDay(opt, from, to);
  let bt = 0;
  let ot = 0;
  let cum = 0;
  let first: SimDay | null = null;
  for (let d = from; d <= to; d++) {
    const bd = b.get(d) ?? 0;
    const od = o.get(d) ?? 0;
    bt += bd;
    ot += od;
    cum += od - bd;
    if (first === null && cum > 0) first = d;
  }
  return { fromDay: from, toDay: to, baseline: money(bt), option: money(ot), delta: money(ot - bt), firstExtraDueDay: first };
}

const cache = new WeakMap<CompanyState, Map<string, DecisionImpacts>>();

/**
 * Impact preview: each option = project([approveOption], H) vs baseline project([], H), using the
 * same engine code path as the real run (ADR-0002). Memoised per state object (states are immutable); the result is deep-frozen.
 */
export function decisionImpacts(state: CompanyState, decisionId: string, horizons: readonly number[] = DECISION_HORIZONS): DecisionImpacts | null {
  const key = `${decisionId}:${horizons.join(',')}`;
  const perState = cache.get(state) ?? new Map<string, DecisionImpacts>();
  const hit = perState.get(key);
  if (hit) return hit;
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d) return null;
  const max = Math.max(...horizons);
  const base = projectState(state, [], max, horizons);
  if (!base.ok) return null;
  const baseAt = (h: number): KpiSnapshot => {
    const c = base.checkpoints.find((x) => x.days === h);
    if (!c) throw new Error(`missing checkpoint ${h}`);
    return c.kpis;
  };
  const options: OptionImpact[] = d.options.map((o) => {
    const p = projectState(state, [{ type: 'approveOption', decisionId, optionId: o.id }], max, horizons);
    if (!p.ok) return { optionId: o.id, horizons: [], error: p.error };
    return {
      optionId: o.id,
      error: null,
      horizons: horizons.map((h) => {
        const b = baseAt(h);
        const c = p.checkpoints.find((x) => x.days === h);
        const k = c ? c.kpis : b;
        const prev = Math.max(0, ...horizons.filter((x) => x < h));
        return {
          horizonDays: h,
          baseline: b,
          option: k,
          delta: deltaOf(b, k),
          risk: { baseline: b.riskLevel, option: k.riskLevel },
          payablesDue: payablesDue(base.state, p.state, state.day + prev, state.day + h - 1),
        };
      }),
    };
  });
  const result: DecisionImpacts = {
    decisionId,
    horizons: [...horizons],
    baseline: horizons.map((h) => ({ horizonDays: h, kpis: baseAt(h) })),
    options,
  };
  // Cached and shared between callers: frozen so no caller can alter what the next one reads.
  perState.set(key, deepFreeze(result));
  cache.set(state, perState);
  return result;
}
