import type { CompanyState, Msg } from '../model/types';
import type { Money, SimDay } from '../model/units';
import { type DecisionImpacts, type HorizonImpact, decisionImpacts } from '../projection/impact';
import { projectedRunway } from '../projection/project';
import {
  CFO_CASH_TOLERANCE,
  DECISION_HORIZONS,
  DEEP_HORIZON_DAYS,
  LONG_HORIZON_DAYS,
  OUTLOOK_HORIZONS,
  SHORT_HORIZON_DAYS,
} from '../config/tuning';

export type AdvisorRole = 'cfo' | 'coo';

export interface Citation {
  selector: string;
  value: number | string;
}

/** Bills an option adds after the Decision Room's +30 view and by +90, compared with the baseline. */
export interface DeferredPayables {
  optionId: string;
  /** extra bills (kuruş) falling due in [day+30, day+89] vs the baseline; always > 0 here */
  amount: Money;
  /** first day the option's cumulative extra bills in that window turn positive */
  firstDueDay: SimDay;
}

export interface AdvisorBrief {
  role: AdvisorRole;
  decisionId: string;
  advisorName: string;
  titleKey: string;
  objective: Msg;
  recommendedOptionId: string;
  ranking: Ranking;
  /** horizons the advisor looked at (days ahead) */
  horizons: number[];
  /** what the same rule picks when it only sees the Decision Room's +30 view */
  thirtyDayPick: string;
  /** true when looking out to +90 changed the pick */
  pickChanged: boolean;
  /** options that add bills after +30 (invisible in the +30 preview), largest first */
  deferred: DeferredPayables[];
  /** structured warnings for the UI (i18n code + params) */
  caveats: Msg[];
  rationale: Msg;
  citations: Citation[];
  assumptions: Msg[];
}

/** Scope: which departments' data a role may read (SIMULATION_DESIGN §6). */
export const ADVISOR_SCOPE: Record<AdvisorRole, { departmentId: 'finance' | 'operations'; reads: string[] }> = {
  cfo: { departmentId: 'finance', reads: ['cash', 'minCash', 'grossMarginBps', 'runway', 'payablesDue'] },
  // supplier bills an option defers (supplier choice is shared with procurement) are surfaced by both
  coo: { departmentId: 'operations', reads: ['deliverySlipDays', 'lateOrders', 'coverageDays', 'overtimeHours', 'payablesDue'] },
};

export { CFO_CASH_TOLERANCE };

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

/** The CFO's ranking keys for one option (deltas against the baseline). */
export interface CfoRow {
  optionId: string;
  /** the worse (lower) of the +30 and +90 minimum-cash deltas */
  minCash: number;
  /** +30 gross-margin delta */
  grossMarginBps: number;
}

/**
 * CFO ranking: find the best minimum-cash delta; every option within `tolerance` kuruş of it is tied
 * (inclusive) and ranked by gross margin; options further away follow by minimum cash, then margin.
 */
export function rankCfo(rows: readonly CfoRow[], tolerance: number = CFO_CASH_TOLERANCE): Ranking {
  if (rows.length === 0) return [];
  const best = Math.max(...rows.map((r) => r.minCash));
  return rank(rows, (r) => (best - r.minCash <= tolerance ? [0, 0, -r.grossMarginBps] : [1, -r.minCash, -r.grossMarginBps]));
}

/** The COO's ranking keys for one option: worse of +30/+90 deltas, and the affected material's coverage. */
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

const LONG = LONG_HORIZON_DAYS;
const DEEP = DEEP_HORIZON_DAYS;
/** Citation prefix: horizons the Decision Room shows cite selectDecision; the deep one the outlook. */
const src = (decisionId: string, h: number): string =>
  DECISION_HORIZONS.includes(h) ? `selectDecision(${decisionId})` : `selectDecisionOutlook(${decisionId})`;

/** Deferred bills per option (+90 window vs baseline), largest first, with their citations. */
function deferredOf(impacts: DecisionImpacts, decisionId: string, optionIds: readonly string[], citations: Citation[]): DeferredPayables[] {
  const out: DeferredPayables[] = [];
  for (const id of optionIds) {
    const pd = at(impacts, id, DEEP)?.payablesDue;
    if (!pd || pd.delta <= 0 || pd.firstExtraDueDay === null) continue;
    const o = `${src(decisionId, DEEP)}.options[${id}].d${DEEP}.payablesDue`;
    citations.push({ selector: `${o}.delta`, value: pd.delta });
    citations.push({ selector: `${o}.firstExtraDueDay`, value: pd.firstExtraDueDay });
    out.push({ optionId: id, amount: pd.delta, firstDueDay: pd.firstExtraDueDay });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function caveatsOf(deferred: readonly DeferredPayables[], thirtyDayPick: string, pick: string): Msg[] {
  const caveats: Msg[] = deferred.map((x) => ({
    code: 'advisor.caveat.deferredPayables',
    params: { optionId: x.optionId, amount: x.amount, fromDay: x.firstDueDay },
  }));
  if (thirtyDayPick !== pick) {
    caveats.push({ code: 'advisor.caveat.pickChangedAt90', params: { thirtyDayOptionId: thirtyDayPick, optionId: pick, horizonDays: DEEP } });
  }
  return caveats;
}

const valid = (impacts: DecisionImpacts): string[] => impacts.options.filter((o) => !o.error).map((o) => o.optionId);

/**
 * CFO: protect minimum projected cash over the next 90 days. Each option is ranked on the worse of
 * its +30 and +90 minimum-cash deltas (a dip the +30 view hides counts in full, ADR-0007); options
 * within CFO_CASH_TOLERANCE of the best are tied and the +30 gross-margin delta decides. Every
 * ranking key of every option is cited; cash, runway and deferred bills are cited as context.
 */
export function cfoBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId, OUTLOOK_HORIZONS);
  if (!d || !impacts) return null;
  const rows: CfoRow[] = [];
  const rows30: CfoRow[] = [];
  const citations: Citation[] = [];
  const runway = projectedRunway(s);
  citations.push({ selector: 'selectMorningReport.cash', value: s.cash });
  citations.push({ selector: 'selectMorningReport.runway.days', value: runway.days });
  for (const id of valid(impacts)) {
    const h30 = at(impacts, id, LONG);
    const h90 = at(impacts, id, DEEP);
    if (!h30 || !h90) continue;
    rows.push({ optionId: id, minCash: Math.min(h30.delta.minCash, h90.delta.minCash), grossMarginBps: h30.delta.grossMarginBps });
    rows30.push({ optionId: id, minCash: h30.delta.minCash, grossMarginBps: h30.delta.grossMarginBps });
    citations.push({ selector: `${src(decisionId, LONG)}.options[${id}].d${LONG}.delta.minCash`, value: h30.delta.minCash });
    citations.push({ selector: `${src(decisionId, DEEP)}.options[${id}].d${DEEP}.delta.minCash`, value: h90.delta.minCash });
    citations.push({ selector: `${src(decisionId, LONG)}.options[${id}].d${LONG}.delta.grossMarginBps`, value: h30.delta.grossMarginBps });
  }
  const ranking = rankCfo(rows);
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const thirtyDayPick = rankCfo(rows30)[0]?.optionId ?? d.defaultOptionId;
  const b30 = at(impacts, best, LONG);
  const b90 = at(impacts, best, DEEP);
  const b7 = at(impacts, best, SHORT_HORIZON_DAYS);
  if (b30) citations.push({ selector: `${src(decisionId, LONG)}.baseline.d${LONG}.minCash`, value: b30.baseline.minCash });
  if (b7) citations.push({ selector: `${src(decisionId, SHORT_HORIZON_DAYS)}.options[${best}].d${SHORT_HORIZON_DAYS}.delta.cash`, value: b7.delta.cash });
  const deferred = deferredOf(impacts, decisionId, rows.map((r) => r.optionId), citations);
  const opt = d.options.find((o) => o.id === best);
  return {
    role: 'cfo',
    decisionId,
    advisorName: headOf(s, 'finance'),
    titleKey: 'role.cfo',
    objective: { code: 'advisor.cfo.objective', params: { horizonDays: LONG, deepHorizonDays: DEEP } },
    recommendedOptionId: best,
    ranking,
    horizons: [...OUTLOOK_HORIZONS],
    thirtyDayPick,
    pickChanged: thirtyDayPick !== best,
    deferred,
    caveats: caveatsOf(deferred, thirtyDayPick, best),
    rationale: {
      code: 'advisor.cfo.rationale',
      params: {
        optionId: best,
        minCashDelta: rows.find((r) => r.optionId === best)?.minCash ?? 0,
        minCashDelta30: b30 ? b30.delta.minCash : 0,
        minCashDelta90: b90 ? b90.delta.minCash : 0,
        marginDelta: b30 ? b30.delta.grossMarginBps : 0,
        runwayDays: runway.days,
      },
    },
    citations,
    assumptions: [
      { code: 'assumption.advisor.expectedPath', params: {} },
      { code: 'assumption.advisor.cfoHorizon', params: { horizonDays: LONG, deepHorizonDays: DEEP } },
      ...(opt ? opt.assumptions : []),
    ],
  };
}

/**
 * COO: protect delivery. Ranks by delivery slip, late orders and extra overtime, each the worse
 * (higher) of its +30 and +90 deltas, then the affected material's coverage days at +7 and +30
 * (see rankCoo). Every ranking key of every option is cited. Cash is outside the COO's scope;
 * riskLevel is not used (it includes cash factors). Deferred supplier bills are surfaced as caveats.
 */
export function cooBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId, OUTLOOK_HORIZONS);
  if (!d || !impacts) return null;
  const materialId = typeof d.situation.params.materialId === 'string' ? d.situation.params.materialId : null;
  const cov = (h: HorizonImpact | undefined): number => (h && materialId ? (h.option.coverageDays[materialId] ?? 0) : 0);
  const rows: CooRow[] = [];
  const rows30: CooRow[] = [];
  const citations: Citation[] = [];
  for (const id of valid(impacts)) {
    const h7 = at(impacts, id, SHORT_HORIZON_DAYS);
    const h30 = at(impacts, id, LONG);
    const h90 = at(impacts, id, DEEP);
    if (!h30 || !h90) continue;
    const c7 = cov(h7);
    const c30 = cov(h30);
    rows.push({
      optionId: id,
      deliverySlipDays: Math.max(h30.delta.deliverySlipDays, h90.delta.deliverySlipDays),
      lateOrders: Math.max(h30.delta.lateOrders, h90.delta.lateOrders),
      overtimeHours: Math.max(h30.delta.overtimeHours, h90.delta.overtimeHours),
      coverage7: c7,
      coverage30: c30,
    });
    rows30.push({ optionId: id, deliverySlipDays: h30.delta.deliverySlipDays, lateOrders: h30.delta.lateOrders, overtimeHours: h30.delta.overtimeHours, coverage7: c7, coverage30: c30 });
    for (const [h, hz] of [[LONG, h30], [DEEP, h90]] as const) {
      const o = `${src(decisionId, h)}.options[${id}].d${h}`;
      citations.push({ selector: `${o}.delta.deliverySlipDays`, value: hz.delta.deliverySlipDays });
      citations.push({ selector: `${o}.delta.lateOrders`, value: hz.delta.lateOrders });
      citations.push({ selector: `${o}.delta.overtimeHours`, value: hz.delta.overtimeHours });
    }
    if (materialId) {
      citations.push({ selector: `${src(decisionId, SHORT_HORIZON_DAYS)}.options[${id}].d${SHORT_HORIZON_DAYS}.option.coverageDays.${materialId}`, value: c7 });
      citations.push({ selector: `${src(decisionId, LONG)}.options[${id}].d${LONG}.option.coverageDays.${materialId}`, value: c30 });
    }
  }
  const ranking = rankCoo(rows);
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const thirtyDayPick = rankCoo(rows30)[0]?.optionId ?? d.defaultOptionId;
  const bestRow = rows.find((r) => r.optionId === best);
  const deferred = deferredOf(impacts, decisionId, rows.map((r) => r.optionId), citations);
  const opt = d.options.find((o) => o.id === best);
  return {
    role: 'coo',
    decisionId,
    advisorName: headOf(s, 'operations'),
    titleKey: 'role.coo',
    objective: { code: 'advisor.coo.objective', params: { horizonDays: LONG, deepHorizonDays: DEEP } },
    recommendedOptionId: best,
    ranking,
    horizons: [...OUTLOOK_HORIZONS],
    thirtyDayPick,
    pickChanged: thirtyDayPick !== best,
    deferred,
    caveats: caveatsOf(deferred, thirtyDayPick, best),
    rationale: {
      code: 'advisor.coo.rationale',
      params: {
        optionId: best,
        slipDelta: bestRow ? bestRow.deliverySlipDays : 0,
        coverageDays: bestRow ? bestRow.coverage7 : 0,
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
