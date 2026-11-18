import type { CompanyState, DailyKpi, PeriodClose } from '../model/types';
import { type Score, money } from '../model/units';
import { type Tx, rule } from '../events/tx';
import { openOrders } from './capacity';
import { activeCustomers } from './customers';
import { periodOf } from './calendar';

export function avgSatisfaction(s: CompanyState): Score {
  const act = activeCustomers(s.customers);
  if (act.length === 0) return 0;
  return Math.round(act.reduce((t, c) => t + c.satisfaction, 0) / act.length);
}

/** Step 9: record the day's KPI row (feeds trends, period closes, projections). */
export function runKpiSnapshot(tx: Tx): void {
  const s = tx.s;
  const open = openOrders(s);
  const kpi: DailyKpi = {
    day: s.day,
    period: periodOf(s.day, s.settings.periodLengthDays),
    cash: s.cash,
    revenue: s.dayAcc.revenue,
    cogs: s.dayAcc.cogs,
    overtimePersonHours: s.dayAcc.overtimePersonHours,
    productionMinutes: s.dayAcc.productionMinutes,
    avgSatisfaction: avgSatisfaction(s),
    backlogValue: money(open.reduce((t, o) => t + o.value, 0)),
    openOrders: open.length,
  };
  tx.emit('DailyKpiRecorded', { kpi }, rule('tick.kpi'), { day: s.day });
}

/** Close the previous period at the first morning of a new one. */
export function closePeriod(tx: Tx, period: number): void {
  const s = tx.s;
  const rows = s.daily.filter((k) => k.period === period);
  if (rows.length === 0) return;
  const last = rows[rows.length - 1];
  const close: PeriodClose = {
    workspaceId: s.workspaceId,
    period,
    revenue: money(rows.reduce((t, k) => t + k.revenue, 0)),
    cogs: money(rows.reduce((t, k) => t + k.cogs, 0)),
    avgSatisfaction: Math.round(rows.reduce((t, k) => t + k.avgSatisfaction, 0) / rows.length),
    overtimePersonHours: rows.reduce((t, k) => t + k.overtimePersonHours, 0),
    closingCash: last ? last.cash : null,
  };
  tx.emit('PeriodClosed', { close }, rule('clock.periodClose'), { period, revenue: close.revenue });
}
