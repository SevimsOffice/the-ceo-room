/**
 * M4a: pure civil-date arithmetic, the SimDay ↔ real-date mapping of imported companies, the
 * snapshot weekday driving the work calendar, and the forecast flag.
 */
import { describe, expect, it } from 'vitest';
import { engineAt, seed, WS } from '../test/seedFixture';
import {
  type CompanyState,
  type SeedBundle,
  civilFromDays,
  createEngine,
  dateToSimDay,
  daysFromCivil,
  epochDayToIso,
  isForecastDay,
  isIsoDate,
  isWorkday,
  isoToEpochDay,
  isoWeekdayIndex,
  parseIsoDate,
  selectCalendarDay,
  selectMorningReport,
  simDayToDate,
  stateHash,
  validateSeedBundle,
  weekdayIndex,
} from './index';

function imported(snapshotDate: string): SeedBundle {
  const b = seed();
  b.company.company = { ...b.company.company, source: 'import', simulated: false, snapshotDate };
  return b;
}

const withoutCompanyMeta = (s: CompanyState): string => {
  const { source: _a, snapshotDate: _b, day1Weekday: _c, simulated: _d, ...company } = s.company;
  return stateHash({ ...s, company } as unknown as CompanyState);
};

describe('civil dates (pure integer arithmetic)', () => {
  it('parses only real ISO dates', () => {
    expect(parseIsoDate('2027-01-31')).toEqual({ year: 2027, month: 1, day: 31 });
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2027-02-29', '2100-02-29', '2027-13-01', '2027-00-10', '2027-1-5', '31.01.2027', '', '0999-01-01']) {
      expect(isIsoDate(bad), bad).toBe(false);
    }
    expect(isIsoDate('2000-02-29')).toBe(true);
  });

  it('round-trips day numbers across eras, leap years and month ends', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(isoToEpochDay('2000-03-01')).toBe(11017);
    for (let n = -800_000; n <= 800_000; n += 997) {
      const c = civilFromDays(n);
      expect(daysFromCivil(c.year, c.month, c.day)).toBe(n);
    }
    expect(epochDayToIso(isoToEpochDay('2028-02-28') + 1)).toBe('2028-02-29');
    expect(epochDayToIso(isoToEpochDay('2027-12-31') + 1)).toBe('2028-01-01');
  });

  it('knows weekdays (0 = Monday)', () => {
    expect(isoWeekdayIndex('1970-01-01')).toBe(3);
    expect(isoWeekdayIndex('2027-01-04')).toBe(0);
    expect(isoWeekdayIndex('2027-01-31')).toBe(6);
    expect(isoWeekdayIndex('1969-12-29')).toBe(0);
  });

  it('maps SimDay to the real date: Day 1 = snapshot date, Day 0 = the day before', () => {
    expect(simDayToDate('2027-01-31', 1)).toBe('2027-01-31');
    expect(simDayToDate('2027-01-31', 0)).toBe('2027-01-30');
    expect(simDayToDate('2027-01-31', 30)).toBe('2027-03-01');
    expect(simDayToDate('2027-01-31', -38)).toBe('2026-12-23');
    expect(simDayToDate(null, 5)).toBeNull();
    for (const d of [-90, -1, 0, 1, 2, 29, 365]) expect(dateToSimDay('2027-01-31', simDayToDate('2027-01-31', d)!)).toBe(d);
  });

  it('shifts the work calendar by the weekday of Day 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => isWorkday(d))).toEqual([true, true, true, true, true, false, false]);
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => isWorkday(d, 6))).toEqual([false, true, true, true, true, true, false]);
    expect(weekdayIndex(1, 6)).toBe(6);
    expect(weekdayIndex(-5, 2)).toBe(3); // six days before a Wednesday
  });
});

describe('company source and snapshot date in state', () => {
  it('the seed is simulated, sourced from the seed, without a snapshot date, Day 1 a Monday', () => {
    const s = engineAt().state();
    expect(s.company).toMatchObject({ simulated: true, source: 'seed', snapshotDate: null, day1Weekday: 0 });
    expect(selectCalendarDay(s)).toEqual({ day: 1, date: null, weekday: 0, weekdayCode: 'weekday.mon', workday: true, forecast: false });
    const r = selectMorningReport(s, { includeRunway: false });
    expect(r.company).toMatchObject({ nameKey: 'company.name', name: null, simulated: true, source: 'seed', snapshotDate: null });
    expect([r.date, r.forecast]).toEqual([null, false]);
  });

  it('an imported company starts on its snapshot date; every later day is a forecast', () => {
    const e = createEngine(imported('2027-01-31'), { rngSeed: 42, workspaceId: WS });
    expect(e.state().company).toMatchObject({ simulated: false, source: 'import', snapshotDate: '2027-01-31', day1Weekday: 6 });
    expect(selectCalendarDay(e.state())).toEqual({ day: 1, date: '2027-01-31', weekday: 6, weekdayCode: 'weekday.sun', workday: false, forecast: false });
    expect(selectCalendarDay(e.state(), 9)).toMatchObject({ date: '2027-02-08', weekdayCode: 'weekday.mon', forecast: true });
    e.advance(1);
    const r = selectMorningReport(e.state(), { includeRunway: false });
    expect([r.date, r.forecast, r.weekdayCode]).toEqual(['2027-02-01', true, 'weekday.mon']);
    expect(isForecastDay(e.state().company, 1)).toBe(false);
  });

  it('a Sunday snapshot runs no production on Day 1 (the seed, a Monday, does)', () => {
    const sunday = createEngine(imported('2027-01-31'), { rngSeed: 42, workspaceId: WS });
    const monday = engineAt();
    sunday.advance(1);
    monday.advance(1);
    expect(sunday.state().daily[0]?.productionMinutes).toBe(0);
    expect(monday.state().daily[0]?.productionMinutes).toBeGreaterThan(0);
  });

  it('a Monday snapshot runs exactly like the seed (only the company metadata differs)', () => {
    const imp = createEngine(imported('2027-01-04'), { rngSeed: 42, workspaceId: WS });
    const sim = engineAt();
    expect(withoutCompanyMeta(imp.state())).toBe(withoutCompanyMeta(sim.state()));
    imp.advance(30);
    sim.advance(30);
    expect(withoutCompanyMeta(imp.state())).toBe(withoutCompanyMeta(sim.state()));
  });

  it('seed validation checks source, snapshot date and simulated together', () => {
    const errs = (mut: (c: Record<string, unknown>) => void): string[] => {
      const b = JSON.parse(JSON.stringify(seed())) as { company: { company: Record<string, unknown> } };
      mut(b.company.company);
      const v = validateSeedBundle(b);
      return v.ok ? [] : v.errors;
    };
    expect(errs(() => undefined)).toEqual([]);
    expect(errs((c) => Object.assign(c, { source: 'import', simulated: false, snapshotDate: '2027-01-31', name: 'Örnek A.Ş.' }))).toEqual([]);
    expect(errs((c) => Object.assign(c, { source: 'import', simulated: false }))).toHaveLength(1);
    // the sample company imported from its own template stays simulated
    expect(errs((c) => Object.assign(c, { source: 'import', simulated: true, snapshotDate: '2027-01-31' }))).toEqual([]);
    expect(errs((c) => Object.assign(c, { snapshotDate: '2027-02-30' }))[0]).toMatch(/snapshotDate/);
    expect(errs((c) => Object.assign(c, { source: 'erp' }))[0]).toMatch(/source/);
    expect(errs((c) => Object.assign(c, { simulated: false }))[0]).toMatch(/simulated/);
    expect(errs((c) => Object.assign(c, { name: '' }))[0]).toMatch(/name/);
  });
});
