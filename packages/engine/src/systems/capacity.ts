import type { CompanyState, Order, ProductFamily, ProductionLine } from '../model/types';
import { OPEN_ORDER_STATUSES } from '../model/types';
import type { SimDay } from '../model/units';
import { byId } from '../events/reduce';
import { isWorkday } from './calendar';

const MAX_SCHEDULE_DAYS = 730;

export function lineUpOn(line: ProductionLine, day: SimDay): boolean {
  if (line.status === 'running') return true;
  return line.repairDueDay !== null && day >= line.repairDueDay;
}

export function lineMinutesOn(line: ProductionLine, day: SimDay): number {
  return lineUpOn(line, day) ? line.shiftsPerDay * line.hoursPerShift * 60 : 0;
}

export function plantLines(s: CompanyState, plantId: string): ProductionLine[] {
  return s.lines.filter((l) => l.plantId === plantId);
}

export function plantRegularMinutes(s: CompanyState, plantId: string, day: SimDay): number {
  if (!isWorkday(day, s.company.day1Weekday)) return 0;
  let t = 0;
  for (const l of plantLines(s, plantId)) t += lineMinutesOn(l, day);
  return t;
}

export function plantOvertimeMinutes(s: CompanyState, plantId: string, day: SimDay): number {
  if (!isWorkday(day, s.company.day1Weekday)) return 0;
  const up = plantLines(s, plantId).filter((l) => lineUpOn(l, day)).length;
  return up * s.settings.maxOvertimeHoursPerLineDay * 60;
}

/** Line-minutes available in a plant over [from, to] inclusive. */
export function availableMinutes(s: CompanyState, plantId: string, from: SimDay, to: SimDay, overtime = false): number {
  let t = 0;
  for (let d = from; d <= to; d++) {
    t += plantRegularMinutes(s, plantId, d);
    if (overtime) t += plantOvertimeMinutes(s, plantId, d);
  }
  return t;
}

export function isOpen(o: Order): boolean {
  return OPEN_ORDER_STATUSES.includes(o.status);
}

export function openOrders(s: CompanyState): Order[] {
  return s.orders.filter(isOpen);
}

export function family(s: CompanyState, id: string): ProductFamily {
  return byId(s.productFamilies, id);
}

export function minutesRequired(s: CompanyState, o: Order): number {
  return o.qty * family(s, o.familyId).minutesPerUnit;
}

export function remainingMinutes(s: CompanyState, o: Order): number {
  return Math.max(0, minutesRequired(s, o) - o.minutesDone);
}

/** Earliest-due-date queue of open orders in a plant. */
export function compareEdd(a: Order, b: Order): number {
  return a.promisedDay - b.promisedDay || a.receivedDay - b.receivedDay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function plantQueue(s: CompanyState, plantId: string): Order[] {
  return openOrders(s)
    .filter((o) => o.plantId === plantId)
    .sort(compareEdd);
}

/** Day on which `minutes` of work starting on `startDay` completes in a plant. */
export function completionDay(
  s: CompanyState,
  plantId: string,
  startDay: SimDay,
  minutes: number,
  overtime: boolean,
): SimDay {
  let left = minutes;
  let d = startDay;
  if (left <= 0) return startDay;
  for (let i = 0; i < MAX_SCHEDULE_DAYS; i++, d++) {
    left -= plantRegularMinutes(s, plantId, d);
    if (overtime) left -= plantOvertimeMinutes(s, plantId, d);
    if (left <= 0) return d;
  }
  return d;
}
