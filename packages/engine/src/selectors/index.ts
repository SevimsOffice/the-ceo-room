import type { CompanyState, CompanySource, Decision, Development, Msg, Order, OrderPlan } from '../model/types';
import { simDayToDate } from '../model/calendarDate';
import type { Bps, Money, Score, SimDay } from '../model/units';
import { ratioBps } from '../model/units';
import { type AdvisorBrief, type AdvisorRole, advisorBrief } from '../rules/advisors';
import { type RiskAssessment, assessRisk } from '../rules/risk';
import { type DecisionImpacts, decisionImpacts } from '../projection/impact';
import { type Runway, projectedRunway } from '../projection/project';
import { weekdayIndex } from '../systems/calendar';
import { OUTLOOK_HORIZONS } from '../config/tuning';
import { type OverallHealth, type WeekdayCode, type WorkforceView, isForecastDay, onTimeDeliveryBps, selectOverallHealth, selectWorkforce, weekdayCode } from './desk';
import { remainingMinutes } from '../systems/capacity';
import { avgSatisfaction } from '../systems/kpi';
import { companyTurnoverBps, overtimeHoursTrailing } from '../systems/people';
import { type OrderFigures, orderFigures } from './orders';
import { backlog, bookMarginBps, capacityUtilisationBps, currentPeriod, periodRevenue } from './metrics';

export interface Telegram {
  id: string;
  cardId: string;
  /** day it arrived */
  day: SimDay;
  severity: Development['severity'];
  /** i18n code + params of the telegram text */
  message: Msg;
  decisionId: string | null;
  orderId: string | null;
  status: Development['status'];
}

export interface PendingDecision {
  id: string;
  kind: Decision['kind'];
  situation: Msg;
  /** the decision is decided by its default option on the morning of this day */
  deadlineDay: SimDay;
  daysLeft: number;
  developmentId: string;
  analysisReady: boolean;
}

export interface MorningReport {
  day: SimDay;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  weekdayCode: WeekdayCode;
  period: number;
  company: {
    nameKey: string;
    /** plain name of an imported company (shown instead of nameKey) */
    name: string | null;
    city: string;
    currency: string;
    simulated: boolean;
    source: CompanySource;
    snapshotDate: string | null;
  };
  /** today's real date (ISO) for an imported company, null for the simulated seed */
  date: string | null;
  /** true when today's figures are a projection from the imported snapshot (imported, after Day 1) */
  forecast: boolean;
  /** lastPeriod = last closed month; changeBps = vs the month before; periodToDate = this month so far */
  revenue: { lastPeriod: Money | null; previousPeriod: Money | null; changeBps: Bps | null; periodToDate: Money };
  cash: Money;
  /** absent (null) in MorningReportWithoutRunway; see selectProjectedRunway */
  runway: Runway;
  /** absent (null) in MorningReportWithoutRunway; see selectOverallHealth */
  health: OverallHealth;
  backlog: { openOrders: number; value: Money };
  satisfaction: { average: Score; previousPeriodAverage: Score | null; change: Score | null };
  capacityUtilisationBps: Bps;
  grossMarginBps: Bps;
  onTimeDeliveryBps: Bps;
  people: { headcount: number; turnoverBps: Bps; overtimeHours30: number };
  workforce: WorkforceView;
  risk: RiskAssessment;
  /** telegrams not yet read (status new) */
  developments: Telegram[];
  /** every telegram still on the desk: new and read, oldest first (resolved ones are filed away) */
  telegrams: Telegram[];
  pendingDecisions: PendingDecision[];
}

/** The morning report without the projected runway (and the health score that depends on it). */
export type MorningReportWithoutRunway = Omit<MorningReport, 'runway' | 'health'> & { runway: null; health: null };

export interface MorningReportOptions {
  /** default true; false skips the 180-day runway projection (compute it with selectProjectedRunway) */
  includeRunway?: boolean;
}

const telegram = (d: Development): Telegram => ({
  id: d.id,
  cardId: d.cardId,
  day: d.day,
  severity: d.severity,
  message: d.message,
  decisionId: d.decisionId,
  orderId: d.orderId,
  status: d.status,
});

/** The Desk: everything the CEO reads each morning, derived from state. */
export function selectMorningReport(s: CompanyState): MorningReport;
export function selectMorningReport(s: CompanyState, opts: { includeRunway: true }): MorningReport;
export function selectMorningReport(s: CompanyState, opts: { includeRunway: false }): MorningReportWithoutRunway;
export function selectMorningReport(s: CompanyState, opts?: MorningReportOptions): MorningReport | MorningReportWithoutRunway;
export function selectMorningReport(s: CompanyState, opts: MorningReportOptions = {}): MorningReport | MorningReportWithoutRunway {
  const p = currentPeriod(s);
  const last = periodRevenue(s, p - 1);
  const prev = periodRevenue(s, p - 2);
  const prevSat = s.periods.find((x) => x.period === p - 1)?.avgSatisfaction ?? null;
  const avg = avgSatisfaction(s);
  const bl = backlog(s);
  const base = {
    day: s.day,
    weekday: weekdayIndex(s.day, s.company.day1Weekday),
    weekdayCode: weekdayCode(s.day, s.company.day1Weekday),
    period: p,
    company: {
      nameKey: s.company.nameKey,
      name: s.company.name ?? null,
      city: s.company.city,
      currency: s.company.currency,
      simulated: s.company.simulated,
      source: s.company.source,
      snapshotDate: s.company.snapshotDate,
    },
    date: simDayToDate(s.company.snapshotDate, s.day),
    forecast: isForecastDay(s.company, s.day),
    revenue: {
      lastPeriod: last,
      previousPeriod: prev,
      changeBps: last !== null && prev !== null ? ratioBps(last - prev, prev) : null,
      periodToDate: s.daily.filter((k) => k.period === p).reduce((t, k) => (t + k.revenue) as Money, 0 as Money),
    },
    cash: s.cash,
    backlog: { openOrders: bl.count, value: bl.value },
    satisfaction: { average: avg, previousPeriodAverage: prevSat, change: prevSat === null ? null : avg - prevSat },
    capacityUtilisationBps: capacityUtilisationBps(s),
    grossMarginBps: bookMarginBps(s, s.day),
    onTimeDeliveryBps: onTimeDeliveryBps(s),
    people: {
      headcount: s.workforce.reduce((t, w) => t + w.headcount, 0),
      turnoverBps: companyTurnoverBps(s),
      overtimeHours30: overtimeHoursTrailing(s),
    },
    workforce: selectWorkforce(s),
    risk: assessRisk(s, s.day),
    developments: s.developments.filter((d) => d.status === 'new').map(telegram),
    telegrams: s.developments.filter((d) => d.status !== 'resolved').map(telegram),
    pendingDecisions: s.decisions
      .filter((d) => d.status === 'open')
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        situation: d.situation,
        deadlineDay: d.deadlineDay,
        daysLeft: d.deadlineDay - s.day,
        developmentId: d.developmentId,
        analysisReady: d.analysis !== null && s.day >= d.analysis.readyDay,
      })),
  };
  if (opts.includeRunway === false) return { ...base, runway: null, health: null };
  const runway = projectedRunway(s);
  return { ...base, runway, health: selectOverallHealth(s, runway) };
}

export interface DecisionView {
  decision: Decision;
  situation: Msg;
  supportingFigures: { code: string; selector: string; value: number }[];
  impacts: DecisionImpacts | null;
  analysis: { requestedDay: SimDay; readyDay: SimDay; ready: boolean; extended: DecisionImpacts | null } | null;
}

/** The supporting figures that need no forward run (everything but the projected runway). */
function plainFigures(s: CompanyState, d: Decision): DecisionView['supportingFigures'] {
  const bl = backlog(s);
  const figures: DecisionView['supportingFigures'] = [
    { code: 'figure.cash', selector: 'selectMorningReport.cash', value: s.cash },
    { code: 'figure.backlogValue', selector: 'selectMorningReport.backlog.value', value: bl.value },
    { code: 'figure.grossMarginBps', selector: 'selectMorningReport.grossMarginBps', value: bookMarginBps(s, s.day) },
  ];
  const materialId = d.situation.params.materialId;
  if (typeof materialId === 'string') {
    const affected = s.orders.filter((o) => o.shippedDay === null && s.productFamilies.find((f) => f.id === o.familyId)?.bom.some((b) => b.materialId === materialId));
    figures.push({ code: 'figure.affectedOrders', selector: `orders[bom includes ${materialId}].count`, value: affected.length });
    figures.push({ code: 'figure.affectedOrderValue', selector: `orders[bom includes ${materialId}].value`, value: affected.reduce((t, o) => t + o.value, 0) });
  }
  return figures;
}

/** Decision Room: situation, supporting figures, options with +7 / +30 impacts from project(). */
export function selectDecision(s: CompanyState, decisionId: string): DecisionView | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  if (!d) return null;
  const runway = projectedRunway(s);
  const [cash, ...rest] = plainFigures(s, d);
  const figures: DecisionView['supportingFigures'] = [
    cash!,
    { code: 'figure.runwayDays', selector: 'selectMorningReport.runway.days', value: runway.days },
    ...rest,
  ];
  const open = d.status === 'open';
  const ready = d.analysis !== null && s.day >= d.analysis.readyDay;
  return {
    decision: d,
    situation: d.situation,
    supportingFigures: figures,
    impacts: open ? decisionImpacts(s, d.id) : null,
    analysis: d.analysis
      ? { ...d.analysis, ready, extended: ready && open ? decisionImpacts(s, d.id, OUTLOOK_HORIZONS) : null }
      : null,
  };
}

export interface DecisionSummary {
  decision: Decision;
  situation: Msg;
  /** selectDecision's supporting figures without the projected runway (read it from selectProjectedRunway) */
  supportingFigures: DecisionView['supportingFigures'];
}

/**
 * A decision's dossier without any forward run: no option impacts, no analysis, no runway. Cheap
 * enough to re-read after every state change; the Decision Room uses selectDecision.
 */
export function selectDecisionSummary(s: CompanyState, decisionId: string): DecisionSummary | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  if (!d) return null;
  return { decision: d, situation: d.situation, supportingFigures: plainFigures(s, d) };
}

/**
 * The advisors' outlook on an open decision: the same impacts as the Decision Room plus +90
 * (OUTLOOK_HORIZONS), with supplier bills falling due per window. Memoised per state; the Decision
 * Room itself stays at +7 / +30 (selectDecision).
 */
export function selectDecisionOutlook(s: CompanyState, decisionId: string): DecisionImpacts | null {
  const d = s.decisions.find((x) => x.id === decisionId);
  if (!d || d.status !== 'open') return null;
  return decisionImpacts(s, decisionId, OUTLOOK_HORIZONS);
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
  /** live margin (= live.marginBps.live for open orders) */
  marginBps: Bps;
  /** live figures next to the plan captured at arrival, with a `differs` flag per field */
  live: OrderFigures;
}

/** The cross-department pipeline result for one order, plus live progress and live vs plan figures. */
export function selectOrderImpact(s: CompanyState, orderId: string): OrderImpactView | null {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) return null;
  return {
    order: o,
    plan: o.plan,
    progress: { unitsDone: o.unitsDone, qty: o.qty, remainingMinutes: remainingMinutes(s, o), blockedBy: o.blockedBy },
    marginBps: ratioBps(o.value - o.costEstimate, o.value),
    live: orderFigures(s, o),
  };
}

export type { AdvisorBrief, AdvisorRole, Runway, DecisionImpacts, RiskAssessment };
