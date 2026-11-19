/**
 * The worker's Decision Room messages: views from the engine's selectors, computed only when no
 * advance runs and tagged with the report version; custom memo previews; the ledger slip.
 */
import { describe, expect, it } from 'vitest';
import {
  type CeoCommand,
  createEngine,
  previewCustomDecision,
  selectAdvisorBrief,
  selectDecision,
} from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { RNG_SEED, WORKSPACE_ID, createHandler, storedSave } from './handler';
import type { WorkerResponse } from './protocol';

const seed = loadSeed();
const DEC = 'dec-0001';

function setup(sleep?: (ms: number) => Promise<void>) {
  const out: WorkerResponse[] = [];
  const h = createHandler({ seed, post: (m) => out.push(structuredClone(m)), dayDelayMs: 0, sleep: sleep ?? (() => Promise.resolve()) });
  return { h, out };
}

const ofType = <T extends WorkerResponse['type']>(out: WorkerResponse[], type: T) =>
  out.filter((m): m is Extract<WorkerResponse, { type: T }> => m.type === type);
const lastVersion = (out: WorkerResponse[]) => ofType(out, 'report').at(-1)!.version;

async function ready() {
  const s = setup();
  await s.h.handle({ type: 'init', save: null });
  await s.h.idle();
  s.out.length = 0;
  return s;
}

describe('Decision Room in the worker', () => {
  it('openRoom posts the room for the current version, from the engine selectors', async () => {
    const { h, out } = setup();
    await h.handle({ type: 'init', save: null });
    await h.handle({ type: 'openRoom', decisionId: DEC });
    await h.idle();
    const rooms = ofType(out, 'room');
    expect(rooms).toHaveLength(1);
    const r = rooms[0]!;
    expect(r.version).toBe(lastVersion(out));
    // posted after the runway (background order: runway, then room)
    expect(out.indexOf(r)).toBeGreaterThan(out.findIndex((m) => m.type === 'runway'));
    const v = r.view!;
    const ref = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID }).state();
    const sel = selectDecision(ref, DEC)!;
    expect(v.status).toBe('open');
    expect(v.number).toBe(1);
    expect(v.daysLeft).toBe(7);
    expect(v.defaultOptionId).toBe('absorb');
    expect(v.options.map((o) => o.id)).toEqual(['absorb', 'negotiate', 'switch', 'passOn']);
    expect(v.impacts).toEqual(structuredClone(sel.impacts));
    expect(v.figures.map((f) => f.code)).not.toContain('figure.runwayDays');
    expect(v.runway.days).toBe(sel.supportingFigures.find((f) => f.code === 'figure.runwayDays')!.value);
    expect(v.advisors.map((b) => b.role)).toEqual(['cfo', 'coo']);
    expect(v.advisors[0]).toEqual(structuredClone(selectAdvisorBrief(ref, 'cfo', DEC)));
    expect(v.advisors[0]!.advisorName).toBe('Ayşe Kaya');
    expect(v.advisors[0]!.recommendedOptionId).not.toBe(v.advisors[1]!.recommendedOptionId);
    expect(v.telegram?.message.code).toBe('card.supplierPriceIncrease');
    expect(v.memo?.repriceMaterialId).toBe('steel');
    expect(v.memo?.limits.maxDiscountBps).toBe(5000);
  });

  it('an unknown decision gets a null view', async () => {
    const { h, out } = await ready();
    await h.handle({ type: 'openRoom', decisionId: 'dec-9999' });
    await h.idle();
    expect(ofType(out, 'room')).toEqual([{ type: 'room', decisionId: 'dec-9999', version: 1, view: null }]);
  });

  it('is not recomputed during an advance: one room, for the last day, after the advance ends', async () => {
    const { h, out } = await ready();
    await h.handle({ type: 'openRoom', decisionId: DEC });
    await h.idle();
    out.length = 0;
    await h.handle({ type: 'advance', days: 5 });
    await h.idle();
    const rooms = ofType(out, 'room');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.version).toBe(lastVersion(out));
    expect(rooms[0]!.view!.day).toBe(6);
    expect(out.indexOf(rooms[0]!)).toBeGreaterThan(out.findIndex((m) => m.type === 'busy' && m.busy === null));
  });

  it('opened while an advance runs, the room waits for the advance to end', async () => {
    let handlerRef: ReturnType<typeof createHandler> | null = null;
    let armed = false;
    const { h, out } = setup(async () => {
      if (!armed) return;
      armed = false;
      await handlerRef!.handle({ type: 'openRoom', decisionId: DEC });
    });
    handlerRef = h;
    await h.handle({ type: 'init', save: null });
    await h.idle();
    out.length = 0;
    armed = true;
    await h.handle({ type: 'advance', days: 3 });
    await h.idle();
    const rooms = ofType(out, 'room');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.view!.day).toBe(4);
    expect(rooms[0]!.version).toBe(lastVersion(out));
  });

  it('a state change re-posts the room for the new version; closeRoom stops it', async () => {
    const { h, out } = await ready();
    await h.handle({ type: 'openRoom', decisionId: DEC });
    await h.idle();
    const first = ofType(out, 'room')[0]!;
    await h.handle({ type: 'dispatch', command: { type: 'requestAnalysis', decisionId: DEC } });
    await h.idle();
    const second = ofType(out, 'room').at(-1)!;
    expect(second.version).toBe(first.version + 1);
    expect(second.view!.analysis).toEqual({ requestedDay: 1, readyDay: 2, ready: false, extended: null });

    await h.handle({ type: 'advance', days: 1 });
    await h.idle();
    const third = ofType(out, 'room').at(-1)!;
    expect(third.view!.analysis!.ready).toBe(true);
    expect(third.view!.analysis!.extended!.horizons).toEqual([7, 30, 90]);

    await h.handle({ type: 'closeRoom' });
    out.length = 0;
    await h.handle({ type: 'advance', days: 1 });
    await h.idle();
    expect(ofType(out, 'room')).toHaveLength(0);
  });

  it('a stale request (state moved on before the background ran) is not answered for the old version', async () => {
    const { h, out } = await ready();
    // openRoom and a dispatch in the same turn: only the newer version's room is posted
    const a = h.handle({ type: 'openRoom', decisionId: DEC });
    const b = h.handle({ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId: 'dev-0001' } });
    await Promise.all([a, b]);
    await h.idle();
    const rooms = ofType(out, 'room');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.version).toBe(lastVersion(out));
  });

  it('approving closes the decision; the ledger slip lists its lines with causes', async () => {
    const { h, out } = await ready();
    await h.handle({ type: 'openRoom', decisionId: DEC });
    await h.idle();
    await h.handle({ type: 'dispatch', command: { type: 'approveOption', decisionId: DEC, optionId: 'negotiate' } });
    await h.idle();
    const types = out.map((m) => m.type);
    expect(types.indexOf('ledgerSlip')).toBeGreaterThan(types.indexOf('save'));
    const slip = ofType(out, 'ledgerSlip')[0]!.slip;
    expect(slip).toMatchObject({ decisionId: DEC, status: 'approved', optionId: 'negotiate', optionLabelKey: 'option.supplierPrice.negotiate', custom: false, day: 1 });
    const codes = slip.lines.map((l) => l.code);
    expect(codes[0]).toBe('ledger.CommandAccepted');
    expect(codes).toContain('ledger.DecisionResolved');
    expect(codes).toContain('ledger.SupplierPriceChanged');
    expect(codes).toContain('ledger.PurchaseOrderPlaced');
    expect(codes).toContain('ledger.DevelopmentResolved');
    expect(codes).not.toContain('ledger.RngAdvanced');
    expect(slip.lines[0]!.cause).toEqual({ kind: 'command', commandId: 'cmd-0001', commandType: 'approveOption' });
    const resolved = slip.lines.find((l) => l.code === 'ledger.DecisionResolved')!;
    expect(slip.lines.find((l) => l.code === 'ledger.SupplierPriceChanged')!.cause).toEqual({ kind: 'event', seq: resolved.seq });
    // the room (still open in the worker) now reads as closed
    expect(ofType(out, 'room').at(-1)!.view!.status).toBe('approved');
    expect(ofType(out, 'room').at(-1)!.view!.advisors).toEqual([]);
    // the slip is posted once per decision
    out.length = 0;
    await h.handle({ type: 'advance', days: 2 });
    expect(ofType(out, 'ledgerSlip')).toHaveLength(0);
  });

  it('a decision that expires at its deadline gets a slip caused by the deadline rule', async () => {
    const { h, out } = await ready();
    await h.handle({ type: 'advance', days: 7 });
    const slip = ofType(out, 'ledgerSlip').at(-1)!.slip;
    expect(slip).toMatchObject({ decisionId: DEC, status: 'expired', optionId: 'absorb', day: 8 });
    expect(slip.lines[0]!.code).toBe('ledger.DecisionResolved');
    expect(slip.lines[0]!.cause).toEqual({ kind: 'rule', ruleId: 'rule.decision.deadline' });
  });

  it('a restored game posts the slip of its latest decision', async () => {
    const e = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    e.dispatch({ type: 'rejectDecision', decisionId: DEC });
    e.advance(2);
    const { h, out } = setup();
    await h.handle({ type: 'init', save: storedSave(e) });
    expect(ofType(out, 'ready')[0]!.restored).toBe(true);
    expect(ofType(out, 'ledgerSlip')[0]!.slip).toMatchObject({ decisionId: DEC, status: 'rejected', optionId: 'absorb' });
  });

  describe('custom memo preview', () => {
    const memo: CeoCommand[] = [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 2500 }];

    it('posts the engine preview for the current version', async () => {
      const { h, out } = await ready();
      await h.handle({ type: 'previewCustom', requestId: 7, decisionId: DEC, commands: memo });
      await h.idle();
      const p = ofType(out, 'customPreview');
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ requestId: 7, decisionId: DEC, version: 1, status: 'ready' });
      const ref = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID }).state();
      expect(p[0]!.preview).toEqual(structuredClone(previewCustomDecision(ref, DEC, memo)));
      // nothing changed: no report, no save
      expect(ofType(out, 'report')).toHaveLength(0);
    });

    it('a memo the engine refuses comes back with its CommandError', async () => {
      const { h, out } = await ready();
      await h.handle({ type: 'previewCustom', requestId: 1, decisionId: DEC, commands: [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 9999 }] });
      await h.idle();
      expect(ofType(out, 'customPreview')[0]!.preview!.impact.error?.code).toBe('error.invalidRate');
    });

    it('is `closed` for a decided decision and `busy` while days run', async () => {
      let handlerRef: ReturnType<typeof createHandler> | null = null;
      let armed = false;
      const { h, out } = setup(async () => {
        if (!armed) return;
        armed = false;
        await handlerRef!.handle({ type: 'previewCustom', requestId: 2, decisionId: DEC, commands: memo });
      });
      handlerRef = h;
      await h.handle({ type: 'init', save: null });
      await h.idle();
      armed = true;
      await h.handle({ type: 'advance', days: 2 });
      expect(ofType(out, 'customPreview')).toEqual([{ type: 'customPreview', requestId: 2, decisionId: DEC, version: 2, status: 'busy', preview: null }]);
      await h.handle({ type: 'dispatch', command: { type: 'rejectDecision', decisionId: DEC } });
      await h.handle({ type: 'previewCustom', requestId: 3, decisionId: DEC, commands: memo });
      await h.idle();
      expect(ofType(out, 'customPreview').at(-1)).toMatchObject({ requestId: 3, status: 'closed', preview: null });
    });
  });
});
