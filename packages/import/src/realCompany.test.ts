/**
 * A small real company (fixture, fictitious data) imports with the generic profile, runs 30 days as a
 * forecast from its snapshot date, and the import is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  isWorkday,
  listMessageCodes,
  selectCalendarDay,
  selectMorningReport,
  simDayToDate,
  stateHash,
} from '@ceo-room/engine';
import { CATALOGS } from '@ceo-room/i18n';
import { REAL_SNAPSHOT, realCompany } from '../test/fixtures';
import { GENERIC_PROFILE, NOVARA_PROFILE, exportTemplate, toSeedBundle } from './index';

const OPTS = { workspaceId: 'ws_real', profile: GENERIC_PROFILE };

function imported() {
  const r = toSeedBundle(realCompany(), OPTS);
  if (!r.ok) throw new Error(JSON.stringify(r.report.issues.filter((i) => i.severity === 'error')));
  return r;
}

describe('a real company with a snapshot date', () => {
  const { bundle, report } = imported();

  it('imports with warnings and noted defaults but no errors', () => {
    expect(report.summary.errors).toBe(0);
    expect(report.summary.rows).toMatchObject({ Customers: 3, Suppliers: 2, Products: 2, OpenOrders: 3 });
  });

  it('converts units: TRY → kuruş, % → bps, 0–100 → Score, dates → SimDay from the snapshot', () => {
    const c = bundle.company.company;
    expect(c).toMatchObject({ source: 'import', simulated: false, snapshotDate: REAL_SNAPSHOT, nameKey: 'company.imported', name: 'Örnek Makina A.Ş.', id: 'company' });
    expect(bundle.company.settings).toMatchObject({ labourCostPerLineHour: 145000, energyCostPerLineHour: 21000, overtimeCrewPerLine: 9, overtimeRatePerPersonHour: 24167 });
    expect(bundle.productFamilies.map((f) => [f.id, f.nameKey, f.name, f.unitPrice])).toEqual([
      ['VLV-10', 'product.imported', 'Vana gövdesi', 125050],
      ['PMP-20', 'product.imported', 'Pompa', 480000],
    ]);
    expect(bundle.plants.lines.map((l) => [l.kindKey, l.kindName])).toEqual([
      ['line.machining', undefined],
      ['line.imported', 'Kaynak robotu'],
    ]);
    expect(bundle.plants.plants[0]?.city).toBe('Konya');
    const [c1, c2, c3] = bundle.customers;
    expect([c1?.satisfaction, c1?.churnRisk, c1?.key, c1?.segmentKey]).toEqual([8000, 800, true, 'segment.agri']);
    expect([c2?.satisfaction, c2?.churnRisk, c2?.key]).toEqual([7500, 1000, false]);
    expect([c3?.discountBps, c3?.annualRevenue, c3?.segmentKey, c3?.country]).toEqual([200, 900000000, 'segment.export', 'DE']);
    expect(c1?.demand).toEqual({ familyId: 'VLV-10', qtyMin: 300, qtyMax: 400, cadenceDays: 30, leadDays: 45, nextOrderDay: 11 });
    const [o1, o2, o3] = bundle.orders.salesOrders;
    // Day 1 = 2027-01-31: 2027-01-10 is Day -20, 2027-02-20 is Day 21
    expect([o1?.receivedDay, o1?.requestedDay, o1?.promisedDay, o1?.paymentTermsDays, o1?.status]).toEqual([-20, 21, 21, 60, 'in_production']);
    expect([o1?.unitsDone, o1?.minutesDone, o1?.materialCost, o1?.energyCost, o1?.value]).toEqual([120, 3600, 120 * (12 * 3800 + 2 * 4500), 1260000, 400 * 125050]);
    expect([o2?.receivedDay, o2?.status, o2?.paymentTermsDays]).toEqual([-10, 'scheduled', 90]);
    expect([o3?.receivedDay, o3?.unitPrice, o3?.listUnitPrice]).toEqual([-5, 470400, 480000]); // Excel serial 46412
    expect(bundle.suppliers.map((s) => [s.depositBps, s.reliabilityBps, s.established, s.onboardingDays, s.country])).toEqual([
      [0, 9600, true, 0, 'TR'],
      [0, 9500, true, 0, 'TR'],
    ]);
    expect(bundle.suppliers[0]?.offers.map((o) => o.materialId)).toEqual(['SAC', 'CNT']);
    expect(bundle.finance.cash).toBe(186500000);
    expect(bundle.finance.receivables.map((r) => [r.issuedDay, r.dueDay, r.expectedPayDay])).toEqual([
      [-46, 14, 24],
      [-71, -11, -11],
    ]);
    expect(bundle.finance.recurringCosts.map((r) => r.kind)).toEqual(['payroll', 'overhead', 'utilities', 'debt_service']);
    expect(bundle.finance.history.map((h) => [h.period, h.revenue, h.avgSatisfaction, h.closingCash])).toEqual([
      [-1, 175000000, 7800, 210000000],
      [0, 190000000, Math.round((8000 + 7500 + 7500) / 3), null],
    ]);
    expect(bundle.workforce.map((w) => [w.departmentId, w.baseTurnoverBps, w.avgMonthlyCost])).toEqual([
      ['operations', 150, 5200000],
      ['sales', 100, 7000000],
      ['finance', 80, 7500000],
    ]);
    expect(bundle.departments.map((d) => [d.id, d.headName, d.risks.length])).toEqual(
      ['sales', 'operations', 'procurement', 'finance', 'people', 'cx'].map((id) => [id, '', 0]),
    );
  });

  it('gets the data-driven cards only (cash squeeze at one month of fixed costs, operations turnover)', () => {
    const monthly = 48 * 5200000 + 6 * 7000000 + 4 * 7500000 + 18000000 + 4000000 + 9500000;
    expect(bundle.eventCards).toEqual([
      { workspaceId: 'ws_real', id: 'card_cash_squeeze', kindKey: 'cashSqueeze', severity: 'high', trigger: { kind: 'cashBelow', threshold: monthly, fromDay: 2 }, effect: { kind: 'notice' } },
      { workspaceId: 'ws_real', id: 'card_turnover', kindKey: 'turnoverRising', severity: 'medium', trigger: { kind: 'turnoverAbove', departmentId: 'operations', thresholdBps: 400, fromDay: 2 }, effect: { kind: 'notice' } },
    ]);
  });

  it('runs 30 days: Day 1 is the snapshot date (a Sunday, no production), later days are a forecast', () => {
    const e = createEngine(bundle, { rngSeed: 7, workspaceId: 'ws_real' });
    expect(simDayToDate(e.state().company.snapshotDate, 1)).toBe(REAL_SNAPSHOT);
    expect(selectCalendarDay(e.state())).toEqual({ day: 1, date: REAL_SNAPSHOT, weekday: 6, weekdayCode: 'weekday.sun', workday: false, forecast: false });
    const day1 = selectMorningReport(e.state());
    expect(day1.company).toMatchObject({ name: 'Örnek Makina A.Ş.', source: 'import', simulated: false, snapshotDate: REAL_SNAPSHOT });
    expect([day1.date, day1.forecast, day1.cash]).toEqual([REAL_SNAPSHOT, false, 186500000]);
    e.advance(30);
    const s = e.state();
    expect(s.day).toBe(31);
    expect(selectCalendarDay(s)).toMatchObject({ date: '2027-03-02', forecast: true });
    expect(s.daily).toHaveLength(30);
    expect(s.daily[0]?.productionMinutes).toBe(0); // Sunday
    expect(isWorkday(2, s.company.day1Weekday)).toBe(true);
    expect(s.daily[1]?.productionMinutes).toBeGreaterThan(0); // Monday
    expect(s.orders.some((o) => o.status === 'shipped' || o.status === 'invoiced' || o.status === 'paid')).toBe(true);
    expect(s.orders.some((o) => o.source === 'demand')).toBe(true); // the Demand sheet placed C-001's repeat order
    const report = selectMorningReport(s);
    expect(report.forecast).toBe(true);
    expect(Number.isSafeInteger(report.cash)).toBe(true);
  });

  it('emits only catalogued codes (labels of imported records included)', () => {
    const e = createEngine(bundle, { rngSeed: 7, workspaceId: 'ws_real' });
    e.advance(30);
    for (const spec of listMessageCodes(e.state())) {
      expect(CATALOGS.en[spec.code], spec.code).toBeDefined();
      expect(CATALOGS.tr[spec.code], spec.code).toBeDefined();
    }
  });

  it('exports back to the template and re-imports to the same bundle', () => {
    for (const lang of ['tr', 'en'] as const) {
      const wb = exportTemplate(bundle, { lang, example: true });
      const again = toSeedBundle(wb, OPTS);
      expect(again.ok && JSON.stringify(again.bundle)).toBe(JSON.stringify(bundle));
      if (again.ok) expect(again.report.summary.info).toBe(0);
    }
  });

  it('NOVARA’s storyline profile does not fit another company', () => {
    const r = toSeedBundle(realCompany(), { workspaceId: 'w', profile: NOVARA_PROFILE });
    expect(r.ok).toBe(false);
    expect(r.report.issues.filter((i) => i.code === 'import.profile.mismatch').length).toBeGreaterThan(0);
    expect(r.report.summary.errors).toBe(r.report.issues.filter((i) => i.severity === 'error').length);
  });
});

describe('determinism', () => {
  it('the same workbook gives the same report, bundle and state hash', () => {
    const a = toSeedBundle(realCompany(), OPTS);
    const b = toSeedBundle(realCompany(), OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (!a.ok || !b.ok) throw new Error('import failed');
    const ea = createEngine(a.bundle, { rngSeed: 3, workspaceId: 'w' });
    const eb = createEngine(b.bundle, { rngSeed: 3, workspaceId: 'w' });
    ea.advance(30);
    eb.advance(30);
    expect(stateHash(ea.state())).toBe(stateHash(eb.state()));
  });

  it('does not mutate the workbook', () => {
    const wb = realCompany();
    const before = JSON.stringify(wb);
    toSeedBundle(wb, OPTS);
    expect(JSON.stringify(wb)).toBe(before);
  });

  it('errors block the bundle', () => {
    const wb = realCompany();
    wb.OpenOrders![3]![1] = 'C-404';
    const r = toSeedBundle(wb, OPTS);
    expect(r.ok).toBe(false);
    expect(r.report.summary.errors).toBeGreaterThan(0);
  });
});
