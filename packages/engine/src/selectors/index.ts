import type { CompanyState, Decision, Development, Msg, Order, OrderPlan } from '../model/types';
import type { Bps, Money, Score, SimDay } from '../model/units';
import { ratioBps } from '../model/units';
import { type AdvisorBrief, type AdvisorRole, advisorBrief } from '../rules/advisors';
import { type RiskAssessment, assessRisk } from '../rules/risk';
import { type DecisionImpacts, decisionImpacts } from '../projection/impact';
import { type Runway, projectedRunway } from '../projection/project';
import { weekdayIndex } from '../systems/calendar';
import { remainingMinutes } from '../systems/capacity';
import { avgSatisfaction } from '../systems/kpi';
import { companyTurnoverBps, overtimeHoursTrailing } from '../systems/people';
import { backlog, bookMarginBps, capacityUtilisationBps, currentPeriod, periodRevenue } from './metrics';

export interface MorningReport {
  day: SimDay;
  weekday: number;
  period: number;
  company: { nameKey: string; city: string; currency: string; simulated: true };
  revenue: { lastPeriod: Money | null; previousPeriod: Money | null; changeBps: Bps | null; periodToDate: Money };
  cash: Money;
  runway: Runway;
  backlog: { openOrders: number; value: Money };
  satisfaction: { average: Score; previousPeriodAverage: Score | null; change: Score | null };
  capacityUtilisationBps: Bps;
  grossMarginBps: Bps;
  people: { headcount: number; turnoverBps: Bps; overtimeHours30: number };
  risk: RiskAssessment;
  developments: { id: string; cardId: string; day: SimDay; severity: Development['severity']; message: Msg; decisionId: string | null; orderId: string | null; status: Development['status'] }[];
  pendingDecisions: { id: string; situation: Msg; deadlineDay: SimDay; analysisReady: boolean }[];
}

/** The Desk: everything the CEO reads each morning, derived from state. */
export function selectMorningReport(s: CompanyState): MorningReport {
  const p = currentPeriod(s);
  const last = periodRevenue(s, p - 1);
  const prev = periodRevenue(s, p - 2);
  const prevSat = s.periods.find((x) => x.period === p - 1)?.avgSatisfaction ?? null;
  const avg = avgSatisfaction(s);
  const bl = backlog(s);
  return {
    day: s.day,
    weekday: weekdayIndex(s.day),
    period: p,
    company: { nameKey: s.company.nameKey, city: s.company.city, currency: s.company.currency, simulated: true },
    revenue: {
      lastPeriod: last,
      previousPeriod: prev,
      changeBps: last !== null && prev !== null ? ratioBps(last - prev, prev) : null,
      periodToDate: s.daily.filter((k) => k.period === p).reduce((t, k) => (t + k.revenue) as Money, 0 as Money),
    },
    cash: s.cash,
    runway: projectedRunway(s),
    backlog: { openOrders: bl.count, value: bl.value },
    satisfaction: { average: avg, previousPeriodAverage: prevSat, change: prevSat === null ? null : avg - prevSat },
    capacityUtilisationBps: capacityUtilisationBps(s),
    grossMarginBps: bookMarginBps(s, s.day),
    people: {
      headcount: s.workforce.reduce((t, w) => t + w.headcount, 0),
      turnoverBps: companyTurnoverBps(s),
      overtimeHours30: overtimeHoursTrailing(s),
    },
    risk: assessRisk(s, s.day),
    developments: s.developments
      .filter((d) => d.status === 'new')
      .map((d) => ({ id: d.id, cardId: d.cardId, day: d.day, severity: d.severity, message: d.message, decisionId: d.decisionId, orderId: d.orderId, status: d.status })),
    pendingDecisions: s.decisions
      .filter((d) => d.status === 'open')
      .map((d) => ({ id: d.id, situation: d.situation, deadlineDay: d.deadlineDay, analysisReady: d.analysis !== null && s.day >= d.analysis.readyDay })),
  };
}

export interface DecisionView {
  decision: Decision;
  situation: Msg;
  supportingFigures: { code: string; selector: string; value: number }[];
  impacts: DecisionImpacts | null;
  analysis: { requestedDay: SimDay; readyDay: SimDay; ready: boolean; extended: DecisionImpacts | null } | null;
}

/** Decision Room: situation, supporting figures, options with +7 / +30 impacts from project(). */
export function selectDecision(s: CompanyState, decisionId: string): DecisionView | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  if (!d) return null;
  const runway = projectedRunway(s);
  const bl = backlog(s);
  const figures: DecisionView['supportingFigures'] = [
    { code: 'figure.cash', selector: 'selectMorningReport.cash', value: s.cash },
    { code: 'figure.runwayDays', selector: 'selectMorningReport.runway.days', value: runway.days },
    { code: 'figure.backlogValue', selector: 'selectMorningReport.backlog.value', value: bl.value },
    { code: 'figure.grossMarginBps', selector: 'selectMorningReport.grossMarginBps', value: bookMarginBps(s, s.day) },
  ];
  const materialId = d.situation.params.materialId;
  if (typeof materialId === 'string') {
    const affected = s.orders.filter((o) => o.shippedDay === null && s.productFamilies.find((f) => f.id === o.familyId)?.bom.some((b) => b.materialId === materialId));
    figures.push({ code: 'figure.affectedOrders', selector: `orders[bom includes ${materialId}].count`, value: affected.length });
    figures.push({ code: 'figure.affectedOrderValue', selector: `orders[bom includes ${materialId}].value`, value: affected.reduce((t, o) => t + o.value, 0) });
  }
  const open = d.status === 'open';
  const ready = d.analysis !== null && s.day >= d.analysis.readyDay;
  return {
    decision: d,
    situation: d.situation,
    supportingFigures: figures,
    impacts: open ? decisionImpacts(s, d.id) : null,
    analysis: d.analysis
      ? { ...d.analysis, ready, extended: ready && open ? decisionImpacts(s, d.id, [7, 30, 90]) : null }
      : null,
  };
}

export function selectAdvisorBrief(s: CompanyState, role: AdvisorRole, decisionId: string): AdvisorBrief | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  if (!d || d.status !== 'open') return null;
  return advisorBrief(s, role, decisionId);
}

export interface OrderImpactView {
  order: Order;
  plan: OrderPlan | null;
  progress: { unitsDone: number; qty: number; remainingMinutes: number; blockedBy: string | null };
  marginBps: Bps;
}

/** The cross-department pipeline result for one order, plus live progress. */
export function selectOrderImpact(s: CompanyState, orderId: string): OrderImpactView | null {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) return null;
  return {
    order: o,
    plan: o.plan,
    progress: { unitsDone: o.unitsDone, qty: o.qty, remainingMinutes: remainingMinutes(s, o), blockedBy: o.blockedBy },
    marginBps: ratioBps(o.value - o.costEstimate, o.value),
  };
}

export type { AdvisorBrief, AdvisorRole, Runway, DecisionImpacts, RiskAssessment };
