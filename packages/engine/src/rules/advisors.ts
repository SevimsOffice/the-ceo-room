import type { CompanyState, Msg } from '../model/types';
import { type DecisionImpacts, type HorizonImpact, decisionImpacts } from '../projection/impact';
import { projectedRunway } from '../projection/project';

export type AdvisorRole = 'cfo' | 'coo';

export interface Citation {
  selector: string;
  value: number | string;
}

export interface AdvisorBrief {
  role: AdvisorRole;
  decisionId: string;
  advisorName: string;
  titleKey: string;
  objective: Msg;
  recommendedOptionId: string;
  ranking: Ranking;
  rationale: Msg;
  citations: Citation[];
  assumptions: Msg[];
}

/** Scope: which departments' data a role may read (SIMULATION_DESIGN §6). */
export const ADVISOR_SCOPE: Record<AdvisorRole, { departmentId: 'finance' | 'operations'; reads: string[] }> = {
  cfo: { departmentId: 'finance', reads: ['cash', 'minCash', 'grossMarginBps', 'runway'] },
  coo: { departmentId: 'operations', reads: ['deliverySlipDays', 'lateOrders', 'coverageDays', 'overtimeHours'] },
};

/** CFO treats options whose +30 minimum cash is within this many kuruş (100k TRY) of the best as tied. */
export const CFO_CASH_TOLERANCE = 10_000_000;

const at = (impacts: DecisionImpacts, optionId: string, h: number): HorizonImpact | undefined =>
  impacts.options.find((o) => o.optionId === optionId)?.horizons.find((x) => x.horizonDays === h);

function headOf(s: CompanyState, dept: 'finance' | 'operations'): string {
  return s.departments.find((d) => d.id === dept)?.headName ?? '';
}

export type Ranking = { optionId: string; rank: number }[];

/** Ranks rows by a lexicographic key (all ascending = better first); stable on input order. */
function rank<R extends { optionId: string }>(rows: readonly R[], key: (r: R) => number[]): Ranking {
  const sorted = rows
    .map((r, i) => ({ id: r.optionId, i, k: key(r) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) {
        const d = (a.k[j] ?? 0) - (b.k[j] ?? 0);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    });
  return sorted.map((x, r) => ({ optionId: x.id, rank: r + 1 }));
}

/** The CFO's ranking keys for one option, all +30-day deltas against the baseline. */
export interface CfoRow {
  optionId: string;
  minCash: number;
  grossMarginBps: number;
}

/**
 * CFO ranking: find the best +30 minimum cash; every option within `tolerance` kuruş of it is tied
 * (inclusive) and ranked by gross margin; options further away follow by minimum cash, then margin.
 */
export function rankCfo(rows: readonly CfoRow[], tolerance: number = CFO_CASH_TOLERANCE): Ranking {
  if (rows.length === 0) return [];
  const best = Math.max(...rows.map((r) => r.minCash));
  return rank(rows, (r) => (best - r.minCash <= tolerance ? [0, 0, -r.grossMarginBps] : [1, -r.minCash, -r.grossMarginBps]));
}

/** The COO's ranking keys for one option: +30 deltas, and the affected material's coverage. */
export interface CooRow {
  optionId: string;
  deliverySlipDays: number;
  lateOrders: number;
  overtimeHours: number;
  /** coverage days of the decision's material at +7 and +30 (0 when the decision has no material) */
  coverage7: number;
  coverage30: number;
}

/**
 * COO ranking, lexicographic: least delivery slip, fewest late orders, no extra overtime (any
 * increase counts the same), then most material coverage at +7, then at +30.
 */
export function rankCoo(rows: readonly CooRow[]): Ranking {
  return rank(rows, (r) => [r.deliverySlipDays, r.lateOrders, r.overtimeHours > 0 ? 1 : 0, -r.coverage7, -r.coverage30]);
}

/**
 * CFO: protect the minimum projected cash over the next 30 days; options within CFO_CASH_TOLERANCE
 * of the best are tied and gross margin decides. Every ranking key of every option is cited; cash
 * and runway are cited as context (not ranked).
 */
export function cfoBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId);
  if (!d || !impacts) return null;
  const rows: CfoRow[] = [];
  for (const o of impacts.options) {
    const h = o.error ? undefined : at(impacts, o.optionId, 30);
    if (h) rows.push({ optionId: o.optionId, minCash: h.delta.minCash, grossMarginBps: h.delta.grossMarginBps });
  }
  const ranking = rankCfo(rows);
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const b30 = at(impacts, best, 30);
  const b7 = at(impacts, best, 7);
  const runway = projectedRunway(s);
  const sel = `selectDecision(${decisionId})`;
  const citations: Citation[] = [
    { selector: 'selectMorningReport.cash', value: s.cash },
    { selector: 'selectMorningReport.runway.days', value: runway.days },
  ];
  for (const r of rows) {
    citations.push({ selector: `${sel}.options[${r.optionId}].d30.delta.minCash`, value: r.minCash });
    citations.push({ selector: `${sel}.options[${r.optionId}].d30.delta.grossMarginBps`, value: r.grossMarginBps });
  }
  if (b30) citations.push({ selector: `${sel}.baseline.d30.minCash`, value: b30.baseline.minCash });
  if (b7) citations.push({ selector: `${sel}.options[${best}].d7.delta.cash`, value: b7.delta.cash });
  const opt = d.options.find((o) => o.id === best);
  return {
    role: 'cfo',
    decisionId,
    advisorName: headOf(s, 'finance'),
    titleKey: 'role.cfo',
    objective: { code: 'advisor.cfo.objective', params: { horizonDays: 30 } },
    recommendedOptionId: best,
    ranking,
    rationale: {
      code: 'advisor.cfo.rationale',
      params: {
        optionId: best,
        minCashDelta: b30 ? b30.delta.minCash : 0,
        marginDelta: b30 ? b30.delta.grossMarginBps : 0,
        runwayDays: runway.days,
      },
    },
    citations,
    assumptions: [
      { code: 'assumption.advisor.expectedPath', params: {} },
      { code: 'assumption.advisor.cfoHorizon', params: { horizonDays: 30 } },
      ...(opt ? opt.assumptions : []),
    ],
  };
}

/**
 * COO: protect delivery. Ranks by +30 delivery slip, late orders and extra overtime, then the
 * affected material's coverage days at +7 and +30 (see rankCoo). Every ranking key of every option
 * is cited. Cash is outside the COO's scope; riskLevel is not used (it includes cash factors).
 */
export function cooBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId);
  if (!d || !impacts) return null;
  const materialId = typeof d.situation.params.materialId === 'string' ? d.situation.params.materialId : null;
  const cov = (h: HorizonImpact | undefined): number => (h && materialId ? (h.option.coverageDays[materialId] ?? 0) : 0);
  const rows: CooRow[] = [];
  for (const o of impacts.options) {
    const h = o.error ? undefined : at(impacts, o.optionId, 30);
    if (!h) continue;
    rows.push({
      optionId: o.optionId,
      deliverySlipDays: h.delta.deliverySlipDays,
      lateOrders: h.delta.lateOrders,
      overtimeHours: h.delta.overtimeHours,
      coverage7: cov(at(impacts, o.optionId, 7)),
      coverage30: cov(h),
    });
  }
  const ranking = rankCoo(rows);
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const b30 = at(impacts, best, 30);
  const sel = `selectDecision(${decisionId})`;
  const citations: Citation[] = [];
  for (const r of rows) {
    const o = `${sel}.options[${r.optionId}]`;
    citations.push({ selector: `${o}.d30.delta.deliverySlipDays`, value: r.deliverySlipDays });
    citations.push({ selector: `${o}.d30.delta.lateOrders`, value: r.lateOrders });
    citations.push({ selector: `${o}.d30.delta.overtimeHours`, value: r.overtimeHours });
    if (materialId) {
      citations.push({ selector: `${o}.d7.option.coverageDays.${materialId}`, value: r.coverage7 });
      citations.push({ selector: `${o}.d30.option.coverageDays.${materialId}`, value: r.coverage30 });
    }
  }
  const opt = d.options.find((o) => o.id === best);
  return {
    role: 'coo',
    decisionId,
    advisorName: headOf(s, 'operations'),
    titleKey: 'role.coo',
    objective: { code: 'advisor.coo.objective', params: { horizonDays: 30 } },
    recommendedOptionId: best,
    ranking,
    rationale: {
      code: 'advisor.coo.rationale',
      params: {
        optionId: best,
        slipDelta: b30 ? b30.delta.deliverySlipDays : 0,
        coverageDays: cov(at(impacts, best, 7)),
      },
    },
    citations,
    assumptions: [
      { code: 'assumption.advisor.expectedPath', params: {} },
      { code: 'assumption.advisor.cooScope', params: { materialId: materialId ?? '' } },
      ...(opt ? opt.assumptions : []),
    ],
  };
}

export function advisorBrief(s: CompanyState, role: AdvisorRole, decisionId: string): AdvisorBrief | null {
  return role === 'cfo' ? cfoBrief(s, decisionId) : cooBrief(s, decisionId);
}
