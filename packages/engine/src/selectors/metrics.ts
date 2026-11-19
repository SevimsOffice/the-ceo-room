import type { CompanyState } from '../model/types';
import { type Bps, type Money, type SimDay, addM, money, mulDiv, ratioBps } from '../model/units';
import { availableMinutes, minutesRequired, openOrders, remainingMinutes } from '../systems/capacity';
import { allocatedQty, inboundQty } from '../systems/costing';
import { isWorkday, periodOf } from '../systems/calendar';
import { COVERAGE_CAP_DAYS, COVERAGE_INBOUND_DAYS, COVERAGE_NEED_WINDOW_DAYS } from '../config/tuning';

/** Derived read models shared by selectors, risk rules and advisors. Never stored. */

export function backlog(s: CompanyState): { count: number; value: Money } {
  const open = openOrders(s);
  return { count: open.length, value: money(open.reduce((t, o) => t + o.value, 0)) };
}

/** Remaining work of open orders vs line-minutes available until the last promise date. */
export function capacityUtilisationBps(s: CompanyState): Bps {
  const open = openOrders(s);
  if (open.length === 0) return 0;
  const horizon = Math.max(s.day, ...open.map((o) => o.promisedDay));
  const required = open.reduce((t, o) => t + remainingMinutes(s, o), 0);
  const available = s.plants.reduce((t, p) => t + availableMinutes(s, p.id, s.day, horizon), 0);
  return ratioBps(required, available);
}

/** Actual cost of a shipped order (materials at average cost + energy + labour line-hours). */
export function actualCost(s: CompanyState, orderId: string): Money {
  const o = s.orders.find((x) => x.id === orderId);
  if (!o) return money(0);
  return addM(o.materialCost, o.energyCost, mulDiv(s.settings.labourCostPerLineHour, minutesRequired(s, o), 60));
}

/** Gross margin of the book: orders shipped since `sinceDay` (actual) + open orders (estimate). */
export function bookMarginBps(s: CompanyState, sinceDay: SimDay): Bps {
  let value = 0;
  let cost = 0;
  for (const o of s.orders) {
    if (o.shippedDay !== null && o.shippedDay >= sinceDay) {
      value += o.value;
      cost += actualCost(s, o.id);
    } else if (o.shippedDay === null) {
      value += o.value;
      cost += o.costEstimate;
    }
  }
  return ratioBps(value - cost, value);
}

/** Delivery slip: late days of orders shipped since `sinceDay` plus days overdue of open orders. */
export function deliverySlip(s: CompanyState, sinceDay: SimDay): { slipDays: number; lateOrders: number } {
  let slipDays = 0;
  let lateOrders = 0;
  for (const o of s.orders) {
    let late = 0;
    if (o.shippedDay !== null) {
      if (o.shippedDay >= sinceDay) late = Math.max(0, o.shippedDay - o.promisedDay);
    } else {
      late = Math.max(0, s.day - o.promisedDay);
    }
    if (late > 0) {
      slipDays += late;
      lateOrders++;
    }
  }
  return { slipDays, lateOrders };
}

/** Average promised lead time (days) of open orders. */
export function avgLeadTimeDays(s: CompanyState): number {
  const open = openOrders(s);
  if (open.length === 0) return 0;
  return Math.round(open.reduce((t, o) => t + (o.promisedDay - o.receivedDay), 0) / open.length);
}

/** Workdays of production need (next 30 days) covered by stock + inbound due within 7 days (config/tuning.ts). */
export function materialCoverageDays(s: CompanyState, materialId: string): number {
  const m = s.materials.find((x) => x.id === materialId);
  if (!m) return 0;
  const horizon = s.day + COVERAGE_NEED_WINDOW_DAYS;
  let workdays = 0;
  for (let d = s.day; d < horizon; d++) if (isWorkday(d, s.company.day1Weekday)) workdays++;
  const need = allocatedQty(s, materialId, undefined, horizon);
  if (need === 0 || workdays === 0) return COVERAGE_CAP_DAYS;
  const daily = need / workdays;
  return Math.min(COVERAGE_CAP_DAYS, Math.floor((m.stockQty + inboundQty(s, materialId, s.day + COVERAGE_INBOUND_DAYS)) / daily));
}

export function blockedOrders(s: CompanyState): number {
  return openOrders(s).filter((o) => o.blockedBy !== null).length;
}

export function currentPeriod(s: CompanyState): number {
  return periodOf(s.day, s.settings.periodLengthDays);
}

export function periodRevenue(s: CompanyState, period: number): Money | null {
  const p = s.periods.find((x) => x.period === period);
  return p ? p.revenue : null;
}

export function revenueSince(s: CompanyState, sinceDay: SimDay): Money {
  return money(s.daily.filter((k) => k.day >= sinceDay).reduce((t, k) => t + k.revenue, 0) + s.dayAcc.revenue);
}

export function overtimeSince(s: CompanyState, sinceDay: SimDay): number {
  return s.daily.filter((k) => k.day >= sinceDay).reduce((t, k) => t + k.overtimePersonHours, 0);
}
