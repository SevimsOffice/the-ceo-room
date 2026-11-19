/** Starts the engine worker and connects it to the Desk store. */
import { setTransport, useGame } from './game';
import { loadSave } from './storage';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

let started = false;
let worker: Worker | null = null;

const fatal = (detail: string): void =>
  useGame.getState().receive({ type: 'fatal', error: { code: 'ui.error.engineFailed', params: { detail } } });

/** A new worker wired to the store, started from the stored save (or none when `fresh`). */
function spawn(fresh: boolean): void {
  worker?.terminate();
  const w = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    if (worker === w) useGame.getState().receive(ev.data);
  };
  // the worker script failed to load or threw outside a request; or a message could not be read
  w.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    if (worker === w) fatal(ev.message || 'worker error');
  };
  w.onmessageerror = () => {
    if (worker === w) fatal('messageerror');
  };
  const init: WorkerRequest = fresh ? { type: 'init', save: null } : { type: 'init', ...loadSave() };
  w.postMessage(init);
}

export function startEngine(): void {
  if (started) return;
  started = true;
  setTransport({
    send: (msg: WorkerRequest) => worker?.postMessage(msg),
    // after a fatal error the old worker may be unusable: replace it and start with no save
    restart: () => spawn(true),
  });
  spawn(false);
}
