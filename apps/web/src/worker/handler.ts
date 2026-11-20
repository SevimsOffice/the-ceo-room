/**
 * The engine worker's message handler, as a plain module: no Worker, no DOM, no storage. The
 * worker entry (engine.worker.ts) wires it to `self`; tests call `handle()` directly.
 *
 * Order of messages after a state change: report → save → ledgerSlip (when a decision closed) →
 * (later, once nothing else is queued and no advance runs) runway → room. The report is shown at
 * once with the runway "calculating…"; the 180-day runway projection and the Decision Room (forward
 * runs of every option) follow in their own messages, tagged with the report version they belong
 * to. During a multi-day advance neither is computed; both follow once the advance ends.
 */
import {
  type Engine,
  type Msg,
  type SeedBundle,
  createEngine,
  fromSnapshot,
  previewCustomDecision,
  selectDecisionSummary,
  selectMorningReport,
  selectOrderBook,
  selectOverallHealth,
  selectProjectedRunway,
  stateHash,
  tuning,
  validateSeedBundle,
} from '@ceo-room/engine';
import { buildDirectory } from './directory';
import type { DossierView, RoomView, StoredSave, WorkerRequest, WorkerResponse } from './protocol';
import { createLedgerTracker, roomView } from './room';

/** One fixed simulation per browser (V1): the seed's NOVARA with this RNG seed and workspace. */
export const RNG_SEED = 42;
export const WORKSPACE_ID = 'ws_desk';
/** Longest single advance accepted (a year). */
export const MAX_ADVANCE_DAYS = 365;

export interface HandlerOptions {
  /** the company the engine starts with (the sample NOVARA); an `init` may bring another (My company) */
  seed: SeedBundle;
  post: (msg: WorkerResponse) => void;
  /** pause between days of a multi-day advance so the Desk can show each day (default 80 ms) */
  dayDelayMs?: number;
  /** waits; tests pass a fake. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface Handler {
  handle(msg: WorkerRequest): Promise<void>;
  /** resolves when pending background work (the runway) is done */
  idle(): Promise<void>;
  /** the live engine (tests) */
  engine(): Engine | null;
}

const decisionNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** The note posted with `fatal`: what went wrong, for the error slip. */
export function fatalError(err: unknown): Msg {
  return { code: 'ui.error.engineFailed', params: { detail: err instanceof Error ? err.message : String(err) } };
}

/** Why an imported bundle cannot run (its seed check fails or the engine refuses it at Day 1), or null. */
export function cannotStart(bundle: SeedBundle): Msg | null {
  const v = validateSeedBundle(JSON.parse(JSON.stringify(bundle)));
  if (!v.ok) return { code: 'ui.error.engineFailed', params: { detail: v.errors[0] ?? 'invalid company data' } };
  try {
    createEngine(bundle, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
    return null;
  } catch (err) {
    return fatalError(err);
  }
}

/** The save game for the current state, with the hash its replay must reach. */
export function storedSave(e: Engine): StoredSave {
  return { ...e.snapshot(), stateHash: stateHash(e.state()) };
}

export function createHandler(opts: HandlerOptions): Handler {
  const { post } = opts;
  /** the company being run: the sample, or the imported bundle of the last `init` that carried one */
  let seed: SeedBundle = opts.seed;
  const dayDelayMs = opts.dayDelayMs ?? 80;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let engine: Engine | null = null;
  let version = 0;
  let busy = false;
  let stopRequested = false;
  let background: Promise<void> = Promise.resolve();
  /** the decision open in the Decision Room (its view follows every state change) */
  let roomId: string | null = null;
  /** the last room view computed, for its version (re-posted, not recomputed, when asked again) */
  let roomCache: { version: number; decisionId: string; view: RoomView | null } | null = null;
  /** the latest memo preview asked for: an older one still queued is not calculated */
  let previewGen = 0;
  const ledger = createLedgerTracker();

  const fresh = (): Engine => createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });

  /** Post the report and the save game for the current state. */
  const publish = (e: Engine): void => {
    version += 1;
    post({ type: 'report', version, report: selectMorningReport(e.state(), { includeRunway: false }) });
    post({ type: 'save', save: storedSave(e) });
    const slip = ledger.update(e);
    if (slip !== undefined) post({ type: 'ledgerSlip', slip });
  };

  /** Run `job` in the background once nothing newer is pending (posts `fatal` if it throws). */
  const later = (job: () => void): void => {
    background = background
      .then(async () => {
        await sleep(0);
        job();
      })
      .catch((err: unknown) => post({ type: 'fatal', error: fatalError(err) }));
  };

  /**
   * Compute and post the Decision Room for the current version, unless the state moves on first or
   * an advance is running (the room follows when it ends). Memoised per version and decision.
   */
  const scheduleRoom = (): void => {
    const v = version;
    const id = roomId;
    if (!id) return;
    later(() => {
      if (v !== version || busy || !engine || roomId !== id) return;
      if (!roomCache || roomCache.version !== v || roomCache.decisionId !== id) {
        roomCache = { version: v, decisionId: id, view: roomView(engine, id) };
      }
      post({ type: 'room', decisionId: id, version: v, view: roomCache.view });
    });
  };

  /** Compute the runway (and the health score that needs it) once nothing newer is pending. */
  const scheduleRunway = (): void => {
    const v = version;
    background = background
      .then(async () => {
        await sleep(0);
        if (v !== version || busy || !engine) return;
        const s = engine.state();
        const runway = selectProjectedRunway(s);
        const health = selectOverallHealth(s, runway);
        if (v !== version) return;
        post({ type: 'runway', version: v, day: s.day, runway, health });
      })
      .catch((err: unknown) => post({ type: 'fatal', error: fatalError(err) }));
  };

  /**
   * Replay a saved game. Anything that keeps it from giving the very state it was saved at counts
   * as a failed restore: a refused replay, a malformed save that throws, a state hash that differs.
   */
  const restore = (save: StoredSave): { ok: true; engine: Engine } | { ok: false; error: Msg } => {
    let r: ReturnType<typeof fromSnapshot>;
    try {
      r = fromSnapshot(seed, save);
    } catch {
      return { ok: false, error: { code: 'ui.error.saveCorrupt', params: {} } };
    }
    if (!r.ok) return r;
    if (typeof save.stateHash === 'string' && stateHash(r.engine.state()) !== save.stateHash) {
      return { ok: false, error: { code: 'ui.error.saveHashMismatch', params: {} } };
    }
    return r;
  };

  /** The background reads that follow a state change: runway first, then the open room. */
  const afterChange = (): void => {
    scheduleRunway();
    scheduleRoom();
  };

  const start = (save: StoredSave | null, unreadable = false): void => {
    let restored = false;
    roomId = null;
    roomCache = null;
    ledger.reset();
    let restoreError: Msg | null = unreadable ? { code: 'ui.error.saveUnreadable', params: {} } : null;
    engine = null;
    if (save) {
      const r = restore(save);
      if (r.ok) {
        engine = r.engine;
        restored = true;
      } else {
        restoreError = r.error;
      }
    }
    engine ??= fresh();
    const s = engine.state();
    post({
      type: 'ready',
      directory: buildDirectory(s),
      currency: s.company.currency,
      thresholds: {
        capacityComfortBps: tuning.HEALTH_CAPACITY_COMFORT_BPS,
        capacityMaxBps: tuning.HEALTH_CAPACITY_MAX_BPS,
        runwayDangerDays: tuning.RUNWAY_DANGER_DAYS,
        runwayHorizonDays: s.settings.runwayHorizonDays,
      },
      restored,
      restoreError,
    });
    publish(engine);
    afterChange();
  };

  const advance = async (e: Engine, days: number): Promise<void> => {
    const n = Math.min(MAX_ADVANCE_DAYS, Math.max(1, Math.floor(days)));
    busy = true;
    stopRequested = false;
    const fromDay = e.state().day;
    post({ type: 'busy', busy: { fromDay, toDay: fromDay + n } });
    let interrupted = false;
    try {
      for (let i = 0; i < n; i++) {
        if (stopRequested) {
          interrupted = true;
          break;
        }
        e.advance(1);
        publish(e);
        // let the Desk paint this day and let a 'stop' in
        if (i < n - 1) await sleep(dayDelayMs);
      }
    } finally {
      busy = false;
      stopRequested = false;
      post({ type: 'busy', busy: null, interrupted });
    }
    afterChange();
  };

  const dossier = (e: Engine, decisionId: string): DossierView | null => {
    // the summary runs no projection: the dossier is re-read after state changes
    const v = selectDecisionSummary(e.state(), decisionId);
    if (!v) return null;
    const d = v.decision;
    return {
      id: d.id,
      number: decisionNumber(d.id),
      kind: d.kind,
      status: d.status,
      situation: v.situation,
      openedDay: d.openedDay,
      deadlineDay: d.deadlineDay,
      daysLeft: d.deadlineDay - e.state().day,
      defaultOptionId: d.defaultOptionId,
      options: d.options.map((o) => ({ id: o.id, labelKey: o.labelKey })),
      figures: v.supportingFigures.map((f) => ({ code: f.code, value: f.value })),
    };
  };

  return {
    engine: () => engine,
    idle: async () => {
      // background work may chain more background work
      let seen: Promise<void> | null = null;
      while (seen !== background) {
        seen = background;
        await background;
      }
    },
    async handle(msg) {
      try {
        // only an advance waits (between days); everything else completes in this call
        const pending = route(msg);
        if (pending) await pending;
      } catch (err) {
        post({ type: 'fatal', error: fatalError(err) });
      }
    },
  };

  /** One request; exceptions are caught by handle() and posted as `fatal`. */
  function route(msg: WorkerRequest): Promise<void> | undefined {
    if (msg.type === 'stop') {
      stopRequested = busy;
      return;
    }
    const mutating = msg.type === 'init' || msg.type === 'newGame' || msg.type === 'dispatch' || msg.type === 'advance';
    if (mutating && busy) {
      post({ type: 'rejected', request: msg.type, reason: 'busy' });
      return;
    }
    if (msg.type === 'init') {
      if (msg.bundle) {
        // an imported company that cannot start (stored by an older version, or damaged) is refused
        // before anything runs: the Desk puts the sample back instead of failing on every reload
        const error = cannotStart(msg.bundle);
        if (error) {
          seed = opts.seed;
          engine = null;
          post({ type: 'companyFailed', error });
          return;
        }
      }
      seed = msg.bundle ?? opts.seed;
      start(msg.save, msg.unreadable === true);
      return;
    }
    if (msg.type === 'newGame') {
      start(null);
      return;
    }
    const e = engine;
    if (!e) {
      post({ type: 'rejected', request: msg.type, reason: 'notReady' });
      return;
    }
    switch (msg.type) {
      case 'dispatch': {
        const r = e.dispatch(msg.command);
        if (r.ok) {
          post({ type: 'dispatched', ok: true, command: msg.command });
          publish(e);
          afterChange();
        } else {
          post({ type: 'dispatched', ok: false, command: msg.command, error: r.error });
        }
        return;
      }
      case 'advance':
        return advance(e, msg.days);
      case 'openDecision':
        post({ type: 'dossier', decisionId: msg.decisionId, view: dossier(e, msg.decisionId) });
        return;
      case 'openOrderBook':
        post({ type: 'orderBook', book: selectOrderBook(e.state()) });
        return;
      case 'openRoom':
        roomId = msg.decisionId;
        scheduleRoom();
        return;
      case 'closeRoom':
        roomId = null;
        return;
      case 'cancelPreview':
        previewGen += 1;
        return;
      case 'previewCustom': {
        const { requestId, decisionId } = msg;
        // the caller's list is checked by the engine like a dispatch (allow-list, fields, limits)
        const commands = Array.isArray(msg.commands) ? msg.commands : [];
        if (busy) {
          post({ type: 'customPreview', requestId, decisionId, version, status: 'busy', preview: null });
          return;
        }
        previewGen += 1;
        const gen = previewGen;
        later(() => {
          // superseded by a newer preview, or the memo was put away
          if (!engine || gen !== previewGen) return;
          if (busy) {
            post({ type: 'customPreview', requestId, decisionId, version, status: 'busy', preview: null });
            return;
          }
          const preview = previewCustomDecision(engine.state(), decisionId, commands);
          post({ type: 'customPreview', requestId, decisionId, version, status: preview ? 'ready' : 'closed', preview });
        });
        return;
      }
    }
  }
}
