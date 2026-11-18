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
  ranking: { optionId: string; rank: number }[];
  rationale: Msg;
  citations: Citation[];
  assumptions: Msg[];
}

/** Scope: which departments' data a role may read (SIMULATION_DESIGN §6). */
export const ADVISOR_SCOPE: Record<AdvisorRole, { departmentId: 'finance' | 'operations'; reads: string[] }> = {
  cfo: { departmentId: 'finance', reads: ['cash', 'minCash', 'grossMarginBps', 'runway'] },
  coo: { departmentId: 'operations', reads: ['deliverySlipDays', 'lateOrders', 'coverageDays', 'overtimeHours'] },
};

/** CFO treats cash differences under this many kuruş (100k TRY) as a tie. */
export const CFO_CASH_TOLERANCE = 10_000_000;

const at = (impacts: DecisionImpacts, optionId: string, h: number): HorizonImpact | undefined =>
  impacts.options.find((o) => o.optionId === optionId)?.horizons.find((x) => x.horizonDays === h);

function headOf(s: CompanyState, dept: 'finance' | 'operations'): string {
  return s.departments.find((d) => d.id === dept)?.headName ?? '';
}

/** Ranks options by a lexicographic key (all ascending = better first); stable on option order. */
function rank(ids: string[], key: (id: string) => number[]): { optionId: string; rank: number }[] {
  const sorted = ids
    .map((id, i) => ({ id, i, k: key(id) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) {
        const d = (a.k[j] ?? 0) - (b.k[j] ?? 0);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    });
  return sorted.map((x, r) => ({ optionId: x.id, rank: r + 1 }));
}

/**
 * CFO: protect minimum projected cash over the next 30 days (and runway); margin breaks ties.
 */
export function cfoBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId);
  if (!d || !impacts) return null;
  const ids = impacts.options.filter((o) => !o.error).map((o) => o.optionId);
  const ranking = rank(ids, (id) => {
    const h = at(impacts, id, 30);
    return h ? [-Math.round(h.delta.minCash / CFO_CASH_TOLERANCE), -h.delta.grossMarginBps] : [Infinity];
  });
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const b30 = at(impacts, best, 30);
  const b7 = at(impacts, best, 7);
  const runway = projectedRunway(s);
  const sel = `selectDecision(${decisionId})`;
  const citations: Citation[] = [
    { selector: 'selectMorningReport.cash', value: s.cash },
    { selector: 'selectMorningReport.runway.days', value: runway.days },
  ];
  for (const id of ids) {
    const h = at(impacts, id, 30);
    if (h) citations.push({ selector: `${sel}.options[${id}].d30.delta.minCash`, value: h.delta.minCash });
  }
  if (b30) {
    citations.push({ selector: `${sel}.baseline.d30.minCash`, value: b30.baseline.minCash });
    citations.push({ selector: `${sel}.options[${best}].d30.delta.grossMarginBps`, value: b30.delta.grossMarginBps });
  }
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
 * COO: minimise delivery slip and line risk. Key: slip days, late orders, extra overtime, then
 * near-term (+7) and +30 coverage days of the affected material. Cash is outside the COO's scope.
 */
export function cooBrief(s: CompanyState, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  const impacts = decisionImpacts(s, decisionId);
  if (!d || !impacts) return null;
  const materialId = typeof d.situation.params.materialId === 'string' ? d.situation.params.materialId : null;
  const ids = impacts.options.filter((o) => !o.error).map((o) => o.optionId);
  const cov = (h: HorizonImpact | undefined): number => (h && materialId ? (h.option.coverageDays[materialId] ?? 0) : 0);
  const ranking = rank(ids, (id) => {
    const h = at(impacts, id, 30);
    if (!h) return [Infinity];
    return [h.delta.deliverySlipDays, h.delta.lateOrders, h.delta.overtimeHours > 0 ? 1 : 0, -cov(at(impacts, id, 7)), -cov(h)];
  });
  const best = ranking[0]?.optionId ?? d.defaultOptionId;
  const b30 = at(impacts, best, 30);
  const sel = `selectDecision(${decisionId})`;
  const citations: Citation[] = [];
  for (const id of ids) {
    const h = at(impacts, id, 30);
    if (!h) continue;
    citations.push({ selector: `${sel}.options[${id}].d30.delta.deliverySlipDays`, value: h.delta.deliverySlipDays });
    if (materialId) citations.push({ selector: `${sel}.options[${id}].d7.option.coverageDays.${materialId}`, value: cov(at(impacts, id, 7)) });
  }
  if (b30) {
    citations.push({ selector: `${sel}.options[${best}].d30.delta.overtimeHours`, value: b30.delta.overtimeHours });
    citations.push({ selector: `${sel}.options[${best}].d30.option.riskLevel`, value: b30.option.riskLevel });
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
        riskLevel: b30 ? b30.option.riskLevel : 'low',
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
