import type { CompanyState } from '../model/types';
import type { Bps, Money, Score } from '../model/units';
import { money } from '../model/units';
import type { CommandError } from '../commands/types';
import type { RiskLevel } from '../rules/risk';
import { type KpiSnapshot, projectState } from './project';

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

export interface HorizonImpact {
  horizonDays: number;
  baseline: KpiSnapshot;
  option: KpiSnapshot;
  delta: ImpactDelta;
  risk: { baseline: RiskLevel; option: RiskLevel };
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

const cache = new WeakMap<CompanyState, Map<string, DecisionImpacts>>();

/**
 * Impact preview: each option = project([approveOption], H) vs baseline project([], H), using the
 * same engine code path as the real run (ADR-0002). Memoised per state object (states are immutable).
 */
export function decisionImpacts(state: CompanyState, decisionId: string, horizons: number[] = [7, 30]): DecisionImpacts | null {
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
        return { horizonDays: h, baseline: b, option: k, delta: deltaOf(b, k), risk: { baseline: b.riskLevel, option: k.riskLevel } };
      }),
    };
  });
  const result: DecisionImpacts = {
    decisionId,
    horizons,
    baseline: horizons.map((h) => ({ horizonDays: h, kpis: baseAt(h) })),
    options,
  };
  perState.set(key, result);
  cache.set(state, perState);
  return result;
}
