import type { CompanyState } from '../model/types';
import type { Bps, Money, Score, SimDay } from '../model/units';
import { money } from '../model/units';
import { deepFreeze } from '../model/freeze';
import type { CeoCommand, Command, CommandError } from '../commands/types';
import type { RiskLevel } from '../rules/risk';
import { type KpiSnapshot, type Projection, projectState } from './project';
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
const baselineCache = new WeakMap<CompanyState, Map<string, Projection>>();

/**
 * The baseline run (no new command: open decisions stay open and expire to their defaults) to the
 * last horizon, with a checkpoint at each one. Memoised per state object and horizon list, so the
 * Decision Room's options and any custom-decision preview share one baseline run.
 */
function baselineRun(state: CompanyState, horizons: readonly number[]): Projection | null {
  const key = horizons.join(',');
  const perState = baselineCache.get(state) ?? new Map<string, Projection>();
  const hit = perState.get(key);
  if (hit) return hit;
  const base = projectState(state, [], Math.max(...horizons), horizons);
  if (!base.ok) return null;
  perState.set(key, base);
  baselineCache.set(state, perState);
  return base;
}

const kpisAt = (p: Projection, h: number): KpiSnapshot => {
  const c = p.checkpoints.find((x) => x.days === h);
  if (!c) throw new Error(`missing checkpoint ${h}`);
  return c.kpis;
};

/** One course of action (a command list) against the baseline, at each horizon. */
function impactOf(state: CompanyState, base: Projection, optionId: string, cmds: readonly Command[], horizons: readonly number[]): OptionImpact {
  const p = projectState(state, cmds, Math.max(...horizons), horizons);
  if (!p.ok) return { optionId, horizons: [], error: p.error };
  return {
    optionId,
    error: null,
    horizons: horizons.map((h) => {
      const b = kpisAt(base, h);
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
}

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
  const base = baselineRun(state, horizons);
  if (!base) return null;
  const options: OptionImpact[] = d.options.map((o) => impactOf(state, base, o.id, [{ type: 'approveOption', decisionId, optionId: o.id }], horizons));
  const result: DecisionImpacts = {
    decisionId,
    horizons: [...horizons],
    baseline: horizons.map((h) => ({ horizonDays: h, kpis: kpisAt(base, h) })),
    options,
  };
  // Cached and shared between callers: frozen so no caller can alter what the next one reads.
  perState.set(key, deepFreeze(result));
  cache.set(state, perState);
  return result;
}

/** A custom decision's preview: the same impact shape as an option of the Decision Room. */
export interface CustomDecisionPreview {
  decisionId: string;
  horizons: number[];
  baseline: { horizonDays: number; kpis: KpiSnapshot }[];
  /** `optionId` is 'custom'; `error` is the engine's CommandError when the memo is refused */
  impact: OptionImpact;
}

/**
 * Preview a custom decision on an open decision: project([customDecision {decisionId, commands}], H)
 * against the same baseline as the options (ADR-0002: the real command path, on a copy). The
 * commands are checked exactly as on dispatch (allow-list, fields, limits, the decision's basis);
 * a refusal comes back as `impact.error`. Null when the decision is unknown or already closed.
 * Not memoised (each memo is new); the baseline run is shared with decisionImpacts.
 */
export function previewCustomDecision(
  state: CompanyState,
  decisionId: string,
  commands: readonly CeoCommand[],
  horizons: readonly number[] = DECISION_HORIZONS,
): CustomDecisionPreview | null {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d || d.status !== 'open') return null;
  const base = baselineRun(state, horizons);
  if (!base) return null;
  // the caller's list is copied: the preview never keeps or alters what it was given
  const cmd: Command = { type: 'customDecision', decisionId, commands: JSON.parse(JSON.stringify(commands)) as CeoCommand[] };
  return deepFreeze({
    decisionId,
    horizons: [...horizons],
    baseline: horizons.map((h) => ({ horizonDays: h, kpis: kpisAt(base, h) })),
    impact: impactOf(state, base, 'custom', [cmd], horizons),
  });
}
