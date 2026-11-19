/**
 * Desk selectors (Milestone 2 needs): overall health, workforce/turnover, the morning report with
 * the runway split out, telegrams and pending decisions. Real seed, rngSeed 42.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, day1State, engineAt } from '../test/seedFixture';
import {
  type CompanyState,
  type Runway,
  WEEKDAY_CODES,
  metrics,
  onTimeDeliveryBps,
  selectMorningReport,
  selectOverallHealth,
  selectProjectedRunway,
  selectWorkforce,
  tuning,
  weekdayCode,
} from './index';

const runwayOf = (days: number, capped = false): Runway => ({ days, capped, firstNegativeDay: capped ? null : days + 1, horizonDays: 180 });

describe('selectOverallHealth', () => {
  it('Day 1: 68 (fair) from five weighted components, each traceable to a Desk figure', () => {
    const s = day1State();
    const r = selectMorningReport(s);
    const h = selectOverallHealth(s);
    expect(h.components.map((c) => [c.id, c.value, c.score, c.weight])).toEqual([
      ['runway', 65, 3611, 30], // 65 / 180 days
      ['grossMargin', 1662, 6648, 20], // 16.62% of the 25% target
      ['satisfaction', 8125, 8125, 20], // average 81.25
      ['onTimeDelivery', 10000, 10000, 20], // nothing shipped late or overdue yet
      ['capacityStrain', 9180, 8057, 10], // (120% − 91.8%) / (120% − 85%)
    ]);
    expect(h.components.map((c) => c.value)).toEqual([r.runway.days, r.grossMarginBps, r.satisfaction.average, r.onTimeDeliveryBps, r.capacityUtilisationBps]);
    expect(h.components.map((c) => c.weight)).toEqual(Object.values(tuning.HEALTH_WEIGHTS));
    // (30·3611 + 20·6648 + 20·8125 + 20·10000 + 10·8057) / 100 / 100 = 68.436
    expect(h.score).toBe(68);
    expect(h.band).toBe('fair');
    expect(h.code).toBe('health.band.fair');
    expect(r.health).toEqual(h);
  });

  it('the score is the weighted mean of the component scores; the band follows HEALTH_BANDS', () => {
    for (const s of [day1State(), (() => { const e = engineAt(); e.advance(30); return e.state(); })()]) {
      const h = selectOverallHealth(s);
      const w = h.components.reduce((t, c) => t + c.weight, 0);
      expect(h.score).toBe(Math.round(h.components.reduce((t, c) => t + c.weight * c.score, 0) / w / 100));
      expect(h.band).toBe(tuning.HEALTH_BANDS.find((b) => h.score >= b.minScore)?.band ?? 'critical');
      for (const c of h.components) expect(c.score).toBeGreaterThanOrEqual(0);
      for (const c of h.components) expect(c.score).toBeLessThanOrEqual(10000);
    }
  });

  it('runway moves the score: a capped runway is good, an empty one is not', () => {
    const s = day1State();
    const full = selectOverallHealth(s, runwayOf(180, true));
    const none = selectOverallHealth(s, runwayOf(0));
    expect(full.components[0]?.score).toBe(10000);
    expect(none.components[0]?.score).toBe(0);
    expect(full.score).toBe(88); // 68.436 + 0.3 × (100 − 36.11)
    expect(full.band).toBe('good');
    expect(none.score).toBe(58);
    expect(selectOverallHealth(s, selectProjectedRunway(s))).toEqual(selectOverallHealth(s));
  });

  it('on-time delivery counts shipped-late and overdue orders', () => {
    const e = engineAt();
    e.advance(30);
    const s = e.state();
    const late = s.orders.filter((o) => (o.shippedDay !== null ? o.shippedDay >= s.day - 30 && o.shippedDay > o.promisedDay : s.day > o.promisedDay)).length;
    const counted = s.orders.filter((o) => o.shippedDay === null || o.shippedDay >= s.day - 30).length;
    expect(late).toBeGreaterThan(0);
    expect(onTimeDeliveryBps(s)).toBe(Math.round(((counted - late) * 10000) / counted));
    expect(selectOverallHealth(s).components.find((c) => c.id === 'onTimeDelivery')?.value).toBe(onTimeDeliveryBps(s));
  });
});

describe('selectWorkforce', () => {
  it('Day 1: headcount, monthly turnover now vs last month, overtime this month', () => {
    const s = day1State();
    const w = selectWorkforce(s);
    const ops = w.departments.find((d) => d.departmentId === 'operations');
    // now: no overtime yet in the trailing window → base 180; last month: 1650 h over 126 heads × 12 bps
    expect(ops).toMatchObject({ headcount: 126, turnoverBps: 180, lastMonthTurnoverBps: 180 + Math.round((1650 / 126) * 12), overtimeHoursMonth: 0, overtimeHoursLastMonth: 1650 });
    expect(ops?.lastMonthTurnoverBps).toBe(337);
    expect(ops?.turnoverChangeBps).toBe(180 - 337);
    for (const d of w.departments.filter((x) => x.departmentId !== 'operations')) {
      const row = s.workforce.find((x) => x.departmentId === d.departmentId);
      expect(d.turnoverBps).toBe(row?.baseTurnoverBps);
      expect(d.lastMonthTurnoverBps).toBe(row?.baseTurnoverBps);
      expect(d.overtimeHoursMonth).toBe(0);
    }
    expect(w.total).toEqual({ headcount: 181, turnoverBps: 151, lastMonthTurnoverBps: 261, turnoverChangeBps: -110, overtimeHoursMonth: 0, overtimeHoursLastMonth: 1650 });
    const r = selectMorningReport(s);
    expect(r.workforce).toEqual(w);
    expect(w.total.headcount).toBe(r.people.headcount);
    expect(w.total.turnoverBps).toBe(r.people.turnoverBps);
    expect(w.departments.map((d) => d.nameKey)).toEqual(s.departments.map((d) => d.nameKey));
  });

  it('overtime this month is the sum of this month’s daily rows, all booked to operations', () => {
    const e = engineAt();
    e.advance(20);
    const s: Readonly<CompanyState> = e.state();
    const w = selectWorkforce(s);
    const month = s.daily.filter((k) => k.period === w.period).reduce((t, k) => t + k.overtimePersonHours, 0);
    expect(month).toBeGreaterThan(0);
    expect(w.total.overtimeHoursMonth).toBe(month);
    expect(w.departments.reduce((t, d) => t + d.overtimeHoursMonth, 0)).toBe(month);
    expect(w.departments.find((d) => d.departmentId === 'operations')?.turnoverBps).toBeGreaterThan(180);
  });
});

describe('selectMorningReport for the Desk', () => {
  it('{ includeRunway: false } returns the same report without runway and health; the runway comes separately', () => {
    const s = day1State();
    const full = selectMorningReport(s);
    const lite = selectMorningReport(s, { includeRunway: false });
    expect(lite.runway).toBeNull();
    expect(lite.health).toBeNull();
    expect({ ...lite, runway: full.runway, health: full.health }).toEqual(full);
    expect(selectProjectedRunway(s)).toEqual(full.runway);
    expect(selectProjectedRunway(s)).toMatchObject({ days: 65, capped: false });
    expect(selectMorningReport(s, { includeRunway: true })).toEqual(full);
  });

  it('shows the Day-1 Desk: day, weekday, revenue, cash, orders, satisfaction, capacity', () => {
    const s = day1State();
    const r = selectMorningReport(s, { includeRunway: false });
    expect([r.day, r.weekday, r.weekdayCode]).toEqual([1, 0, 'weekday.mon']);
    expect(r.revenue).toMatchObject({ lastPeriod: 7_640_000_000, previousPeriod: 7_210_000_000, changeBps: 596 });
    expect(r.cash).toBe(s.cash);
    expect(r.backlog).toEqual({ openOrders: 15, value: metrics.backlog(s).value });
    expect(r.satisfaction).toEqual({ average: 8125, previousPeriodAverage: 8500, change: -375 });
    expect(r.capacityUtilisationBps).toBe(9180);
  });

  it('weekday codes cycle Monday → Sunday', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => weekdayCode(d))).toEqual([...WEEKDAY_CODES, 'weekday.mon']);
    const e = engineAt();
    e.advance(5);
    expect(selectMorningReport(e.state(), { includeRunway: false }).weekdayCode).toBe('weekday.sat');
  });

  it('telegrams keep read ones (status read); developments lists only new ones', () => {
    const e = engineAt();
    expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }).ok).toBe(true);
    const r = selectMorningReport(e.state(), { includeRunway: false });
    expect(r.developments.map((d) => d.id)).toEqual(['dev-0002']);
    expect(r.telegrams.map((d) => [d.id, d.status, d.day, d.severity])).toEqual([
      ['dev-0001', 'read', 1, 'high'],
      ['dev-0002', 'new', 1, 'high'],
    ]);
    expect(r.telegrams[1]?.message.code).toBe('card.supplierPriceIncrease');
    expect(r.telegrams[1]?.decisionId).toBe(STEEL_DECISION);
    // resolving the decision files the telegram away
    e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'negotiate' });
    expect(selectMorningReport(e.state(), { includeRunway: false }).telegrams.map((d) => d.id)).toEqual(['dev-0001']);
  });

  it('pending decisions carry deadline, days left and the linked telegram', () => {
    const s = day1State();
    const r = selectMorningReport(s, { includeRunway: false });
    expect(r.pendingDecisions).toEqual([
      expect.objectContaining({ id: STEEL_DECISION, kind: 'supplierPrice', deadlineDay: 8, daysLeft: 7, developmentId: 'dev-0002', analysisReady: false }),
    ]);
    const dev = r.telegrams.find((t) => t.id === r.pendingDecisions[0]?.developmentId);
    expect(dev?.decisionId).toBe(STEEL_DECISION);
  });
});
