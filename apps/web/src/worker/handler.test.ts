import { describe, expect, it } from 'vitest';
import { createEngine, fromSnapshot, selectMorningReport, selectProjectedRunway, stateHash, type SaveGame } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { RNG_SEED, WORKSPACE_ID, createHandler } from './handler';
import type { WorkerResponse } from './protocol';

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
