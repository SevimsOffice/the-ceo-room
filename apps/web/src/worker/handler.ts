/**
 * The engine worker's message handler, as a plain module: no Worker, no DOM, no storage. The
 * worker entry (engine.worker.ts) wires it to `self`; tests call `handle()` directly.
 *
 * Order of messages after a state change: report → save → (later, once nothing else is queued)
 * runway. The report is shown at once with the runway "calculating…"; the 180-day runway
 * projection follows in its own message.
 */
import {
  type Engine,
  type Msg,
  type SeedBundle,
  createEngine,
  fromSnapshot,
  selectDecisionSummary,
  selectMorningReport,
  selectOrderBook,
  selectOverallHealth,
  selectProjectedRunway,
  stateHash,
  tuning,
} from '@ceo-room/engine';
import { buildDirectory } from './directory';
import type { DossierView, StoredSave, WorkerRequest, WorkerResponse } from './protocol';

/** One fixed simulation per browser (V1): the seed's NOVARA with this RNG seed and workspace. */
export const RNG_SEED = 42;
export const WORKSPACE_ID = 'ws_desk';
/** Longest single advance accepted (a year). */
export const MAX_ADVANCE_DAYS = 365;

export interface HandlerOptions {
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

/** The save game for the current state, with the hash its replay must reach. */
export function storedSave(e: Engine): StoredSave {
  return { ...e.snapshot(), stateHash: stateHash(e.state()) };
}

export function createHandler(opts: HandlerOptions): Handler {
  const { seed, post } = opts;
  const dayDelayMs = opts.dayDelayMs ?? 80;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let engine: Engine | null = null;
  let version = 0;
  let busy = false;
  let stopRequested = false;
  let background: Promise<void> = Promise.resolve();

  const fresh = (): Engine => createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });

  /** Post the report and the save game for the current state. */
  const publish = (e: Engine): void => {
    version += 1;
    post({ type: 'report', version, report: selectMorningReport(e.state(), { includeRunway: false }) });
    post({ type: 'save', save: storedSave(e) });
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

  const start = (save: StoredSave | null, unreadable = false): void => {
    let restored = false;
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
    scheduleRunway();
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
    scheduleRunway();
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
          scheduleRunway();
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
    }
  }
}
