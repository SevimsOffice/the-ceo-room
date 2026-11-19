import { describe, expect, it } from 'vitest';
import { createEngine, selectMorningReport, selectOverallHealth, selectProjectedRunway } from '@ceo-room/engine';
import { createTranslator, formatBps, formatMoneyParts } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';
import { buildDirectory } from '../worker/directory';
import { daysLeftText, reportLines, reportNote, runwayText } from './figures';

const engine = createEngine(loadSeed(), { rngSeed: 42, workspaceId: 'ws_test' });
const state = engine.state();
const report = selectMorningReport(state, { includeRunway: false });
const runway = selectProjectedRunway(state);
const health = selectOverallHealth(state, runway);
const thresholds = { capacityComfortBps: 8500, capacityMaxBps: 12000, runwayDangerDays: 30, runwayHorizonDays: 180 };
const tr = createTranslator('tr', { directory: buildDirectory(state) });
const en = createTranslator('en', { directory: buildDirectory(state) });

describe('morning report lines come from the engine selectors', () => {
  const byId = (lines: ReturnType<typeof reportLines>) => Object.fromEntries(lines.map((l) => [l.id, l]));

  it('prints the selector values, formatted for the locale', () => {
    const l = byId(reportLines(tr, report, { runway, health }, thresholds));
    expect(l.revenue!.value).toBe(formatMoneyParts(report.revenue.lastPeriod!, 'tr').value);
    expect(l.revenue!.unit).toBe('milyon TL');
    expect(l.cash!.value).toBe(formatMoneyParts(report.cash, 'tr').value);
    expect(l.orders!.value).toBe(String(report.backlog.openOrders));
    expect(l.satisfaction!.value).toBe(formatBps(report.satisfaction.average, 'tr'));
    expect(l.capacity!.value).toBe(formatBps(report.capacityUtilisationBps, 'tr'));
    expect(l.health!.value).toBe(String(health.score));
    expect(l.turnover!.value).toBe(formatBps(report.workforce.total.turnoverBps, 'tr', 1));
    expect(l.cash!.note).toContain(`${runway.days} gün`);
  });

  it('Day 1 matches the calibrated mock-up figures (76,4 / 41,2 / 15 / %81 / %92)', () => {
    const l = byId(reportLines(tr, report, null, thresholds));
    expect([l.revenue!.value, l.cash!.value, l.orders!.value, l.satisfaction!.value, l.capacity!.value]).toEqual(['76,4', '41,2', '15', '%81', '%92']);
    const e = byId(reportLines(en, report, null, thresholds));
    expect(`${e.revenue!.value} ${e.revenue!.unit}`).toBe('76.4 M TL');
  });

  it('runway and health read "calculating" until the worker sends them', () => {
    const l = byId(reportLines(en, report, null, thresholds));
    expect(l.health!.note).toBe('calculating…');
    expect(l.cash!.note).toBe('projected cash runway: calculating…');
    expect(runwayText(en, null)).toBe('calculating…');
    expect(runwayText(en, { days: 180, capped: true, firstNegativeDay: null, horizonDays: 180 })).toBe('180+ days');
    expect(runwayText(tr, { days: 52, capped: false, firstNegativeDay: 53, horizonDays: 180 })).toBe('52 gün');
  });

  it('marks changes with direction and tone', () => {
    const l = byId(reportLines(en, report, null, thresholds));
    expect(l.revenue!.note).toMatch(/^▲ \+6% vs last month$/);
    expect(l.revenue!.tone).toBe('good');
    expect(l.satisfaction!.tone).toBe('bad');
    expect(l.capacity!.note).toBe('close to the limit');
  });

  it('notes and folder lines', () => {
    expect(reportNote(en, 0)).toBe('Figures are simulated. No telegram awaits your reply.');
    expect(reportNote(en, 1)).toBe('Figures are simulated. 1 telegram awaits your reply.');
    expect(reportNote(tr, 2)).toBe('Rakamlar simülasyondur. Yanıtınızı bekleyen 2 telgraf var.');
    expect(daysLeftText(en, 0)).toBe('Decision due today');
    expect(daysLeftText(tr, 7)).toBe('Karar için 7 gün kaldı');
  });
});
