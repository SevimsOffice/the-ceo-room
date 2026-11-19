/** Starts the engine worker and connects it to the Desk store. */
import { setTransport, useGame } from './game';
import { loadSave } from './storage';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

let started = false;

export function startEngine(): void {
  if (started) return;
  started = true;
  const worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => useGame.getState().receive(ev.data);
  setTransport({ send: (msg: WorkerRequest) => worker.postMessage(msg) });
  worker.postMessage({ type: 'init', save: loadSave() } satisfies WorkerRequest);
}
