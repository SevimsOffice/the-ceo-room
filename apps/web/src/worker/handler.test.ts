import { describe, expect, it } from 'vitest';
import { createEngine, fromSnapshot, selectDecisionSummary, selectMorningReport, selectProjectedRunway, stateHash, tuning, type SaveGame, type SeedBundle } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { RNG_SEED, WORKSPACE_ID, createHandler } from './handler';
import type { StoredSave, WorkerResponse } from './protocol';

const seed = loadSeed();

function setup(sleep?: (ms: number) => Promise<void>) {
  const out: WorkerResponse[] = [];
  const h = createHandler({ seed, post: (m) => out.push(structuredClone(m)), dayDelayMs: 0, sleep: sleep ?? (() => Promise.resolve()) });
  return { h, out };
}

const ofType = <T extends WorkerResponse['type']>(out: WorkerResponse[], type: T) =>
  out.filter((m): m is Extract<WorkerResponse, { type: T }> => m.type === type);

describe('engine worker handler', () => {
  it('init posts ready, then the Day 1 report without runway, then the save; the runway follows separately', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    expect(out.map((m) => m.type)).toEqual(['ready', 'report', 'save']);
    const ready = ofType(out, 'ready')[0]!;
    expect(ready.restored).toBe(false);
    expect(ready.directory.customers.cus_demirhan).toBe('Demirhan Raylı Sistemler A.Ş.');
    const report = ofType(out, 'report')[0]!;
    expect(report.report.day).toBe(1);
    expect(report.report.runway).toBeNull();
    expect(report.report.health).toBeNull();

    // the report equals the engine selector for the same state
    const ref = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    expect(report.report).toEqual(structuredClone(selectMorningReport(ref.state(), { includeRunway: false })));

    await h.idle();
    const runway = ofType(out, 'runway');
    expect(runway).toHaveLength(1);
    expect(out.at(-1)!.type).toBe('runway');
    expect(runway[0]!.version).toBe(report.version);
    expect(runway[0]!.runway).toEqual(selectProjectedRunway(ref.state()));
    expect(runway[0]!.health.score).toBeGreaterThan(0);
  });

  it('advance steps one day at a time and posts a report after each day', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.idle();
    out.length = 0;
    await h.handle({ type: 'advance', days: 7 });
    const reports = ofType(out, 'report');
    expect(reports.map((r) => r.report.day)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(ofType(out, 'save')).toHaveLength(7);
    expect(ofType(out, 'busy').map((b) => b.busy)).toEqual([{ fromDay: 1, toDay: 8 }, null]);
    // no runway while the jump runs; one after it, for the last version
    await h.idle();
    const runway = ofType(out, 'runway');
    expect(runway).toHaveLength(1);
    expect(out.indexOf(runway[0]!)).toBeGreaterThan(out.indexOf(reports.at(-1)!));
    expect(out.indexOf(runway[0]!)).toBeGreaterThan(out.findIndex((m) => m.type === 'busy' && m.busy === null));
    expect(runway[0]!.version).toBe(reports.at(-1)!.version);
    expect(runway[0]!.day).toBe(8);
  });

  it('telegrams arrive with the day they happen on (discount demand on Day 9)', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.handle({ type: 'advance', days: 10 });
    const reports = ofType(out, 'report');
    const day8 = reports.find((r) => r.report.day === 8)!;
    const day9 = reports.find((r) => r.report.day === 9)!;
    expect(day8.report.telegrams.some((t) => t.message.code === 'card.discountDemand')).toBe(false);
    expect(day9.report.telegrams.some((t) => t.message.code === 'card.discountDemand')).toBe(true);
  });

  it('stop interrupts a running advance after the current day', async () => {
    let handlerRef: ReturnType<typeof createHandler> | null = null;
    let days = 0;
    const { h, out } = setup(async () => {
      days += 1;
      if (days === 3) await handlerRef!.handle({ type: 'stop' });
    });
    handlerRef = h;
    await h.handle({ type: 'init', save: null });
    await h.idle();
    days = 0;
    out.length = 0;
    await h.handle({ type: 'advance', days: 30 });
    const reports = ofType(out, 'report');
    expect(reports.length).toBeLessThan(30);
    expect(reports.length).toBeGreaterThan(0);
    expect(ofType(out, 'busy').at(-1)).toEqual({ type: 'busy', busy: null, interrupted: true });
    expect(h.engine()!.state().day).toBe(1 + reports.length);
  });

  it('rejects state changes while an advance runs, but answers read-only requests', async () => {
    let handlerRef: ReturnType<typeof createHandler> | null = null;
    let armed = false;
    const { h, out } = setup(async () => {
      if (!armed) return;
      armed = false;
      await handlerRef!.handle({ type: 'advance', days: 1 });
      await handlerRef!.handle({ type: 'openOrderBook' });
    });
    handlerRef = h;
    await h.handle({ type: 'init', save: null });
    await h.idle();
    out.length = 0;
    armed = true;
    await h.handle({ type: 'advance', days: 3 });
    expect(ofType(out, 'rejected')).toEqual([{ type: 'rejected', request: 'advance', reason: 'busy' }]);
    expect(ofType(out, 'orderBook')).toHaveLength(1);
    expect(h.engine()!.state().day).toBe(4);
  });

  it('dispatch acknowledges a telegram and posts the new report', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    const first = ofType(out, 'report')[0]!.report;
    const tg = first.telegrams.find((t) => t.decisionId === null)!;
    expect(tg.status).toBe('new');
    await h.handle({ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId: tg.id } });
    expect(ofType(out, 'dispatched')[0]).toMatchObject({ ok: true });
    const after = ofType(out, 'report').at(-1)!.report;
    expect(after.telegrams.find((t) => t.id === tg.id)!.status).toBe('read');

    // a telegram with an open decision cannot be filed: typed error, nothing changes
    const withDecision = first.telegrams.find((t) => t.decisionId !== null)!;
    const reportsBefore = ofType(out, 'report').length;
    await h.handle({ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId: withDecision.id } });
    const res = ofType(out, 'dispatched').at(-1)!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('error.developmentHasOpenDecision');
    expect(ofType(out, 'report')).toHaveLength(reportsBefore);
  });

  it('save/restore round trip gives the same state (stateHash)', async () => {
    const a = setup();
    await a.h.handle({ type: 'init', save: null });
    await a.h.handle({ type: 'advance', days: 5 });
    const tg = ofType(a.out, 'report').at(-1)!.report.telegrams.find((t) => t.decisionId === null && t.status === 'new')!;
    await a.h.handle({ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId: tg.id } });
    await a.h.handle({ type: 'advance', days: 4 });
    const save: SaveGame = ofType(a.out, 'save').at(-1)!.save;
    const hashA = stateHash(a.h.engine()!.state());

    const b = setup();
    await b.h.handle({ type: 'init', save: JSON.parse(JSON.stringify(save)) as SaveGame });
    expect(ofType(b.out, 'ready')[0]!.restored).toBe(true);
    expect(stateHash(b.h.engine()!.state())).toBe(hashA);
    expect(ofType(b.out, 'report')[0]!.report).toEqual(ofType(a.out, 'report').at(-1)!.report);

    const replay = fromSnapshot(seed, save);
    expect(replay.ok && stateHash(replay.engine.state())).toBe(hashA);
  });

  it('a save from another seed version starts a new game and says why', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: { format: 1, seedVersion: 999, rngSeed: 42, workspaceId: WORKSPACE_ID, log: [] } });
    const ready = ofType(out, 'ready')[0]!;
    expect(ready.restored).toBe(false);
    expect(ready.restoreError?.code).toBe('error.seedVersionMismatch');
    expect(ofType(out, 'report')[0]!.report.day).toBe(1);
  });

  it('each save carries the stateHash of the state it was taken at', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.handle({ type: 'advance', days: 3 });
    const save = ofType(out, 'save').at(-1)!.save;
    expect(save.stateHash).toBe(stateHash(h.engine()!.state()));
  });

  it('a save whose replay does not reach its stateHash is a failed restore: new game, typed note', async () => {
    const a = setup();
    await a.h.handle({ type: 'init', save: null });
    await a.h.handle({ type: 'advance', days: 4 });
    const save: StoredSave = { ...ofType(a.out, 'save').at(-1)!.save, stateHash: 'deadbeef' };

    const { h, out } = setup();
    await h.handle({ type: 'init', save });
    const ready = ofType(out, 'ready')[0]!;
    expect(ready.restored).toBe(false);
    expect(ready.restoreError?.code).toBe('ui.error.saveHashMismatch');
    expect(ofType(out, 'report')[0]!.report.day).toBe(1);
    // the note comes before the first save, so the Desk can back the old one up first
    expect(out.findIndex((m) => m.type === 'ready')).toBeLessThan(out.findIndex((m) => m.type === 'save'));
  });

  it('a malformed log entry (null) falls back to a new game instead of throwing', async () => {
    const good = setup();
    await good.h.handle({ type: 'init', save: null });
    const base = ofType(good.out, 'save')[0]!.save;
    const save = { ...base, stateHash: undefined, log: [null] } as unknown as StoredSave;

    const { h, out } = setup();
    await h.handle({ type: 'init', save });
    expect(ofType(out, 'fatal')).toEqual([]);
    const ready = ofType(out, 'ready')[0]!;
    expect(ready.restored).toBe(false);
    expect(ready.restoreError?.code).toBe('ui.error.saveCorrupt');
    expect(ofType(out, 'report')[0]!.report.day).toBe(1);
    // the game goes on
    await h.handle({ type: 'advance', days: 1 });
    expect(ofType(out, 'report').at(-1)!.report.day).toBe(2);
  });

  it('an unreadable stored save is reported as a failed restore', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null, unreadable: true });
    expect(ofType(out, 'ready')[0]!.restoreError?.code).toBe('ui.error.saveUnreadable');
    expect(ofType(out, 'report')[0]!.report.day).toBe(1);
  });

  it('an exception while starting posts fatal (no ready, so no endless loading)', async () => {
    const out: WorkerResponse[] = [];
    const h = createHandler({ seed: {} as SeedBundle, post: (m) => out.push(structuredClone(m)), dayDelayMs: 0, sleep: () => Promise.resolve() });
    await expect(h.handle({ type: 'init', save: null })).resolves.toBeUndefined();
    expect(out.map((m) => m.type)).toEqual(['fatal']);
    const f = ofType(out, 'fatal')[0]!;
    expect(f.error.code).toBe('ui.error.engineFailed');
    expect(typeof f.error.params.detail).toBe('string');
    // a later request is answered, not left hanging
    await h.handle({ type: 'advance', days: 1 });
    expect(ofType(out, 'rejected')).toEqual([{ type: 'rejected', request: 'advance', reason: 'notReady' }]);
  });

  it('an exception during an advance ends the busy state and posts fatal', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.idle();
    out.length = 0;
    const e = h.engine()!;
    e.advance = () => {
      throw new Error('boom');
    };
    await h.handle({ type: 'advance', days: 3 });
    expect(out.map((m) => m.type)).toEqual(['busy', 'busy', 'fatal']);
    expect(ofType(out, 'busy').at(-1)!.busy).toBeNull();
    expect(ofType(out, 'fatal')[0]!.error.params.detail).toBe('boom');
    // a new game still works afterwards
    await h.handle({ type: 'newGame' });
    expect(ofType(out, 'report').at(-1)!.report.day).toBe(1);
  });

  it('ready carries the engine thresholds the Desk draws with (runway danger from tuning)', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    expect(ofType(out, 'ready')[0]!.thresholds).toEqual({
      capacityComfortBps: tuning.HEALTH_CAPACITY_COMFORT_BPS,
      capacityMaxBps: tuning.HEALTH_CAPACITY_MAX_BPS,
      runwayDangerDays: tuning.RUNWAY_DANGER_DAYS,
      runwayHorizonDays: h.engine()!.state().settings.runwayHorizonDays,
    });
  });

  it('newGame resets to Day 1', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.handle({ type: 'advance', days: 3 });
    await h.handle({ type: 'newGame' });
    expect(ofType(out, 'report').at(-1)!.report.day).toBe(1);
    expect(ofType(out, 'save').at(-1)!.save.log).toEqual([]);
  });

  it('opens a read-only dossier from selectDecision and the order book from selectOrderBook', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.handle({ type: 'openDecision', decisionId: 'dec-0001' });
    const d = ofType(out, 'dossier')[0]!;
    expect(d.view?.number).toBe(1);
    expect(d.view?.kind).toBe('supplierPrice');
    expect(d.view?.options.map((o) => o.labelKey)).toContain('option.supplierPrice.negotiate');
    expect(d.view?.figures.map((f) => f.code)).toContain('figure.cash');
    // the light summary: no runway figure (the Desk prints the live runway), nothing projected
    expect(d.view?.figures.map((f) => f.code)).not.toContain('figure.runwayDays');
    const summary = selectDecisionSummary(h.engine()!.state(), 'dec-0001')!;
    expect(d.view?.figures).toEqual(summary.supportingFigures.map((f) => ({ code: f.code, value: f.value })));
    await h.handle({ type: 'openDecision', decisionId: 'dec-9999' });
    expect(ofType(out, 'dossier')[1]!.view).toBeNull();

    await h.handle({ type: 'openOrderBook' });
    const book = ofType(out, 'orderBook')[0]!.book;
    const report = ofType(out, 'report')[0]!.report;
    expect(book.totals.count).toBe(report.backlog.openOrders);
    // the state did not change
    expect(ofType(out, 'report')).toHaveLength(1);
  });
});

describe('My company (an imported bundle)', () => {
  it('init with a bundle runs that company: real dates, its own save; newGame and restore stay on it', async () => {
    const { exportTemplate } = await import('@ceo-room/import');
    const { buildCompany } = await import('../archive/handler');
    const built = buildCompany(exportTemplate(seed, { lang: 'tr', example: true }), seed);
    if (!built.ok) throw new Error('not built');
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null, bundle: built.bundle });
    const first = ofType(out, 'report')[0]!.report;
    expect(first).toMatchObject({ day: 1, date: '2027-01-04', forecast: false, company: { source: 'import', name: 'NOVARA Sanayi' } });
    await h.handle({ type: 'advance', days: 2 });
    const save = ofType(out, 'save').at(-1)!.save;
    expect(ofType(out, 'report').at(-1)!.report).toMatchObject({ day: 3, date: '2027-01-06', forecast: true });

    // a restart from that save (same bundle) comes back to Day 3
    out.length = 0;
    await h.handle({ type: 'init', save, bundle: built.bundle });
    expect(ofType(out, 'ready')[0]!.restored).toBe(true);
    expect(ofType(out, 'report')[0]!.report.day).toBe(3);
    // a new game keeps the company
    out.length = 0;
    await h.handle({ type: 'newGame' });
    expect(ofType(out, 'report')[0]!.report).toMatchObject({ day: 1, date: '2027-01-04' });
    // and an init without a bundle is the sample again
    out.length = 0;
    await h.handle({ type: 'init', save: null });
    expect(ofType(out, 'report')[0]!.report).toMatchObject({ day: 1, date: null, company: { source: 'seed' } });
  });
});
