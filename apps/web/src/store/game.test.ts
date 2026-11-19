/**
 * The Desk store against the real worker handler (in-process, with asynchronous delivery like a
 * real Worker), plus localStorage in memory: save safety, double advance, dossier refresh, play.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSeed } from '@ceo-room/seed-data';
import type { SeedBundle } from '@ceo-room/engine';
import { createHandler } from '../worker/handler';
import type { StoredSave, WorkerRequest, WorkerResponse } from '../worker/protocol';
import { PLAY_INTERVAL_MS, canDecide, currentMemoPreview, currentRoomView, setTransport, useGame } from './game';
import { BACKUP_KEY, SAVE_KEY } from './storage';

const seed = loadSeed();
const initial = useGame.getState();

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

let storage: MemoryStorage;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Store ⇄ handler, each message delivered on a later macrotask (as postMessage does). */
function connect(opts: { seed?: SeedBundle; restart?: () => void } = {}) {
  const sent: WorkerRequest[] = [];
  let inFlight = 0;
  const h = createHandler({
    seed: opts.seed ?? seed,
    dayDelayMs: 0,
    post: (m: WorkerResponse) => {
      inFlight += 1;
      const copy = structuredClone(m);
      setTimeout(() => {
        inFlight -= 1;
        useGame.getState().receive(copy);
      }, 0);
    },
  });
  setTransport({
    send: (m) => {
      sent.push(m);
      inFlight += 1;
      setTimeout(() => {
        void h.handle(structuredClone(m)).finally(() => {
          inFlight -= 1;
        });
      }, 0);
    },
    restart: opts.restart,
  });
  /** wait until every message both ways has been handled */
  const settle = async () => {
    for (let i = 0; i < 2000; i++) {
      await tick();
      await h.idle();
      if (inFlight === 0) {
        await tick();
        if (inFlight === 0) return;
      }
    }
    throw new Error('did not settle');
  };
  const init = async (save: StoredSave | null) => {
    // what client.ts does on start
    sent.push({ type: 'init', save });
    inFlight += 1;
    setTimeout(() => void h.handle({ type: 'init', save }).finally(() => (inFlight -= 1)), 0);
    await settle();
  };
  return { h, sent, settle, init };
}

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  useGame.setState(initial, true);
});

afterEach(() => {
  useGame.getState().pause();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const day = () => useGame.getState().report?.day;

describe('double advance', () => {
  it('two rapid advance calls advance exactly one day', async () => {
    const c = connect();
    await c.init(null);
    expect(day()).toBe(1);
    useGame.getState().advance(1);
    useGame.getState().advance(1);
    expect(useGame.getState().advancePending).toBe(true);
    await c.settle();
    expect(day()).toBe(2);
    expect(c.sent.filter((m) => m.type === 'advance')).toHaveLength(1);
    expect(useGame.getState().advancePending).toBe(false);
    // and the next ring works again
    useGame.getState().advance(1);
    await c.settle();
    expect(day()).toBe(3);
  });

  it('an advance the worker rejects clears the pending flag', () => {
    setTransport({ send: () => {} });
    useGame.setState({ phase: 'ready' });
    useGame.getState().advance(7);
    expect(useGame.getState().advancePending).toBe(true);
    useGame.getState().receive({ type: 'rejected', request: 'advance', reason: 'busy' });
    expect(useGame.getState().advancePending).toBe(false);
  });
});

describe('save safety', () => {
  async function savedGameAtDay(days: number): Promise<StoredSave> {
    const c = connect();
    await c.init(null);
    useGame.getState().advance(days);
    await c.settle();
    const raw = storage.getItem(SAVE_KEY)!;
    useGame.setState(initial, true);
    return JSON.parse(raw) as StoredSave;
  }

  it('a stored save restores to the same day (hash verified)', async () => {
    const save = await savedGameAtDay(5);
    expect(typeof save.stateHash).toBe('string');
    const c = connect();
    await c.init(save);
    expect(day()).toBe(6);
    expect(useGame.getState().notice).toBeNull();
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
  });

  it('a save from another seed version is kept in the backup key before the new game saves', async () => {
    const old: StoredSave = { ...(await savedGameAtDay(3)), seedVersion: 999 };
    const raw = JSON.stringify(old);
    storage.setItem(SAVE_KEY, raw);
    const c = connect();
    await c.init(old);
    expect(day()).toBe(1);
    expect(storage.getItem(BACKUP_KEY)).toBe(raw);
    // the new game's save replaced the old one
    expect((JSON.parse(storage.getItem(SAVE_KEY)!) as StoredSave).log).toEqual([]);
    expect(useGame.getState().notice).toMatchObject({ key: 'ui.status.restoreFailed', detail: { code: 'error.seedVersionMismatch' } });
  });

  it('a hash mismatch counts as a failed restore: backup, new game, slip', async () => {
    const old: StoredSave = { ...(await savedGameAtDay(4)), stateHash: '00000000' };
    const raw = JSON.stringify(old);
    storage.setItem(SAVE_KEY, raw);
    const c = connect();
    await c.init(old);
    expect(day()).toBe(1);
    expect(storage.getItem(BACKUP_KEY)).toBe(raw);
    expect(useGame.getState().notice?.detail.code).toBe('ui.error.saveHashMismatch');
  });

  it('a malformed log entry (null) gives a new game and a slip, never endless loading', async () => {
    const old = { ...(await savedGameAtDay(2)), log: [null] } as unknown as StoredSave;
    const raw = JSON.stringify(old);
    storage.setItem(SAVE_KEY, raw);
    const c = connect();
    await c.init(old);
    expect(useGame.getState().phase).toBe('ready');
    expect(useGame.getState().fatal).toBeNull();
    expect(day()).toBe(1);
    expect(storage.getItem(BACKUP_KEY)).toBe(raw);
    expect(useGame.getState().notice?.detail.code).toBe('ui.error.saveCorrupt');
  });
});

describe('fatal errors', () => {
  it('a worker exception shows the error; New game restarts the worker, keeps a backup and clears the save', async () => {
    storage.setItem(SAVE_KEY, '{"format":1,"log":[]}');
    const restart = vi.fn();
    const c = connect({ seed: {} as SeedBundle, restart });
    await c.init(null);
    const s = useGame.getState();
    expect(s.phase).toBe('loading');
    expect(s.fatal?.code).toBe('ui.error.engineFailed');

    s.newGame();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(storage.getItem(BACKUP_KEY)).toBe('{"format":1,"log":[]}');
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(useGame.getState().fatal).toBeNull();
    expect(useGame.getState().version).toBe(0);
  });

  it('without a restartable transport, New game after a failure asks the worker for a new game', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().advance(3);
    useGame.getState().receive({ type: 'fatal', error: { code: 'ui.error.engineFailed', params: { detail: 'x' } } });
    expect(useGame.getState().advancePending).toBe(false);
    await c.settle();
    useGame.getState().newGame();
    await c.settle();
    expect(useGame.getState().fatal).toBeNull();
    expect(useGame.getState().phase).toBe('ready');
    expect(day()).toBe(1);
  });
});

describe('dossier refresh and auto-play', () => {
  it('an open dossier is not re-read during an advance, and is re-read once when it ends', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openDossier('dec-0001');
    await c.settle();
    expect(useGame.getState().dossier?.loaded).toBe(true);
    c.sent.length = 0;
    useGame.getState().advance(7);
    await c.settle();
    expect(day()).toBe(8);
    expect(c.sent.filter((m) => m.type === 'openDecision')).toHaveLength(1);
    // a state change outside an advance (a telegram filed) re-reads it at once
    const tg = useGame.getState().report!.telegrams.find((x) => x.status === 'new' && x.decisionId === null)!;
    c.sent.length = 0;
    useGame.getState().acknowledge(tg.id);
    await c.settle();
    expect(c.sent.filter((m) => m.type === 'openDecision')).toHaveLength(1);
  });

  it('auto-play waits while a sheet is open and goes on when it is closed', () => {
    vi.useFakeTimers();
    const sent: WorkerRequest[] = [];
    setTransport({ send: (m) => sent.push(m) });
    useGame.setState({ phase: 'ready' });
    const advances = () => sent.filter((m) => m.type === 'advance').length;

    useGame.getState().play();
    useGame.getState().openDossier('dec-0001');
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3);
    expect(advances()).toBe(0);
    useGame.getState().closeDossier();

    useGame.getState().askNewGame();
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 2);
    expect(advances()).toBe(0);
    useGame.getState().cancelNewGame();

    vi.advanceTimersByTime(PLAY_INTERVAL_MS);
    expect(advances()).toBe(1);
    // the next tick waits for the day to finish
    vi.advanceTimersByTime(PLAY_INTERVAL_MS);
    expect(advances()).toBe(1);
    useGame.getState().receive({ type: 'busy', busy: null });
    vi.advanceTimersByTime(PLAY_INTERVAL_MS);
    expect(advances()).toBe(2);
  });
});

describe('Decision Room', () => {
  const DEC = 'dec-0001';
  const room = () => useGame.getState().room;

  it('opens on a decision, shows the current view, approves the selected option and returns to the Desk', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    expect(useGame.getState().view).toBe('room');
    expect(c.sent.at(-1)).toEqual({ type: 'openRoom', decisionId: DEC });
    await c.settle();
    const v = currentRoomView(useGame.getState())!;
    expect(v.decisionId).toBe(DEC);
    expect(canDecide(useGame.getState())).toBe(true);

    // the seal needs a selection; the default option is the baseline, not a choice
    useGame.getState().approve();
    expect(c.sent.filter((m) => m.type === 'dispatch')).toHaveLength(0);
    useGame.getState().selectOption('absorb');
    expect(room()?.selected).toBeNull();
    useGame.getState().selectOption('switch');
    useGame.getState().approve();
    useGame.getState().approve();
    expect(c.sent.filter((m) => m.type === 'dispatch')).toEqual([
      { type: 'dispatch', command: { type: 'approveOption', decisionId: DEC, optionId: 'switch' } },
    ]);
    expect(room()?.pending).toBe('approve');
    await c.settle();

    // decided: the room and its tab are gone, the carbon copy of the ledger is open on the Desk
    const s = useGame.getState();
    expect(s.room).toBeNull();
    expect(s.view).toBe('desk');
    expect(c.sent).toContainEqual({ type: 'closeRoom' });
    expect(s.ledgerSlip).toMatchObject({ decisionId: DEC, status: 'approved', optionId: 'switch' });
    expect(s.ledgerOpen).toBe(true);
    expect(s.report?.pendingDecisions).toEqual([]);
    useGame.getState().closeLedger();
    expect(useGame.getState().ledgerOpen).toBe(false);
  });

  it('reject runs the default; a refused command keeps the room open with a slip', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    // a refusal from the engine (here: the decision closed behind the room's back)
    useGame.getState().receive({ type: 'dispatched', ok: false, command: { type: 'rejectDecision', decisionId: DEC }, error: { code: 'error.decisionClosed', params: {} } });
    expect(useGame.getState().notice?.detail.code).toBe('error.decisionClosed');
    useGame.getState().dismissNotice();

    useGame.getState().reject();
    expect(room()?.pending).toBe('reject');
    await c.settle();
    expect(useGame.getState().room).toBeNull();
    expect(useGame.getState().ledgerSlip).toMatchObject({ status: 'rejected', optionId: 'absorb' });
  });

  it('an engine error clears the pending action and the room stays', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    useGame.getState().selectOption('negotiate');
    useGame.getState().approve();
    useGame.getState().receive({ type: 'dispatched', ok: false, command: { type: 'approveOption', decisionId: DEC, optionId: 'negotiate' }, error: { code: 'error.unknownOption', params: {} } });
    expect(room()?.pending).toBeNull();
    expect(useGame.getState().view).toBe('room');
    expect(useGame.getState().notice).toMatchObject({ key: 'ui.status.commandFailed', detail: { code: 'error.unknownOption' } });
    await c.settle();
  });

  it('a view for an older version is never shown; the Desk tab keeps the room, which follows the day', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    const old = room()!.view!;
    // a stale view arriving late is dropped
    useGame.getState().receive({ type: 'room', decisionId: DEC, version: old.version - 1, view: null });
    expect(room()!.view).toEqual(old);

    useGame.getState().showDesk();
    expect(useGame.getState().view).toBe('desk');
    useGame.getState().advance(3);
    await c.settle();
    expect(day()).toBe(4);
    // only one room view after the advance (none during it), for the new version
    const fresh = currentRoomView(useGame.getState())!;
    expect(fresh.day).toBe(4);
    expect(fresh.daysLeft).toBe(4);
    useGame.getState().showRoom();
    expect(useGame.getState().view).toBe('room');
    useGame.getState().closeRoom();
    expect(useGame.getState().room).toBeNull();
    expect(c.sent.at(-1)).toEqual({ type: 'closeRoom' });
  });

  it('while the report is newer than the room view, the view reads as missing', () => {
    setTransport({ send: () => {} });
    useGame.setState({ phase: 'ready', version: 5, room: { decisionId: DEC, view: { version: 4, data: null }, selected: null, pending: null, memoOpen: false, memo: null } });
    expect(currentRoomView(useGame.getState())).toBeNull();
    expect(canDecide(useGame.getState())).toBe(false);
  });

  it('request analysis stays in the room; the +90 view follows the next day', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    useGame.getState().requestAnalysis();
    await c.settle();
    expect(useGame.getState().view).toBe('room');
    expect(room()?.pending).toBeNull();
    expect(currentRoomView(useGame.getState())!.analysis).toMatchObject({ readyDay: 2, ready: false });
    // a second request is not sent
    useGame.getState().requestAnalysis();
    expect(c.sent.filter((m) => m.type === 'dispatch' && m.command.type === 'requestAnalysis')).toHaveLength(1);
    useGame.getState().advance(1);
    await c.settle();
    expect(currentRoomView(useGame.getState())!.analysis!.extended!.horizons).toEqual([7, 30, 90]);
  });

  it('a memo is previewed, refreshed when the day changes, and sealed exactly as previewed', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    useGame.getState().openMemo();
    expect(room()?.memoOpen).toBe(true);
    // nothing to seal before a preview
    useGame.getState().sealMemo();
    expect(c.sent.filter((m) => m.type === 'dispatch')).toHaveLength(0);

    const memo = [{ type: 'repriceOrders' as const, materialId: 'steel', passThroughBps: 5000 }];
    useGame.getState().previewMemo(memo);
    expect(room()?.memo?.status).toBe('waiting');
    await c.settle();
    expect(currentMemoPreview(useGame.getState())?.preview?.impact.error).toBeNull();

    // a day passes (memo open on another tab): the preview is asked again for the new state
    useGame.getState().showDesk();
    useGame.getState().advance(1);
    await c.settle();
    expect(c.sent.filter((m) => m.type === 'previewCustom')).toHaveLength(2);
    expect(currentMemoPreview(useGame.getState())?.version).toBe(useGame.getState().version);

    useGame.getState().showRoom();
    useGame.getState().sealMemo();
    expect(c.sent.at(-1)).toEqual({ type: 'dispatch', command: { type: 'customDecision', decisionId: DEC, commands: memo } });
    await c.settle();
    expect(useGame.getState().room).toBeNull();
    expect(useGame.getState().ledgerSlip).toMatchObject({ custom: true, status: 'approved' });
  });

  it('a memo the engine refuses cannot be sealed', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    useGame.getState().previewMemo([{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 9000 }]);
    await c.settle();
    expect(currentMemoPreview(useGame.getState())?.preview?.impact.error?.code).toBe('error.invalidRate');
    useGame.getState().sealMemo();
    expect(c.sent.filter((m) => m.type === 'dispatch')).toHaveLength(0);
  });

  it('auto-play waits while the Decision Room is in front, and while the carbon copy is open', () => {
    vi.useFakeTimers();
    const sent: WorkerRequest[] = [];
    setTransport({ send: (m) => sent.push(m) });
    useGame.setState({ phase: 'ready' });
    const advances = () => sent.filter((m) => m.type === 'advance').length;
    useGame.getState().play();
    useGame.getState().openRoom(DEC);
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3);
    expect(advances()).toBe(0);
    useGame.getState().showDesk();
    useGame.setState({ ledgerOpen: true });
    vi.advanceTimersByTime(PLAY_INTERVAL_MS * 2);
    expect(advances()).toBe(0);
    useGame.getState().closeLedger();
    vi.advanceTimersByTime(PLAY_INTERVAL_MS);
    expect(advances()).toBe(1);
  });

  it('a new game closes the room and clears the slip', async () => {
    const c = connect();
    await c.init(null);
    useGame.getState().openRoom(DEC);
    await c.settle();
    useGame.getState().reject();
    await c.settle();
    expect(useGame.getState().ledgerSlip).not.toBeNull();
    useGame.getState().openRoom('dec-0001');
    useGame.getState().newGame();
    await c.settle();
    expect(useGame.getState().room).toBeNull();
    expect(useGame.getState().ledgerSlip).toBeNull();
    expect(useGame.getState().view).toBe('desk');
  });
});
