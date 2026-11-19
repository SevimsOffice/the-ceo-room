/** Worker entry: the engine lives here so the Desk never freezes while days are simulated. */
import { loadSeed } from '@ceo-room/seed-data';
import { type Handler, createHandler, fatalError } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const post = (msg: WorkerResponse): void => scope.postMessage(msg);

// A seed that cannot be loaded leaves no engine: every request is answered with `fatal`.
let handler: Handler | null = null;
let startError: unknown = null;
try {
  handler = createHandler({ seed: loadSeed(), post });
} catch (err) {
  startError = err;
}

scope.onmessage = (ev) => {
  if (!handler) {
    post({ type: 'fatal', error: fatalError(startError) });
    return;
  }
  // handle() posts `fatal` for its own exceptions; this catches anything that still escapes
  handler.handle(ev.data).catch((err: unknown) => post({ type: 'fatal', error: fatalError(err) }));
};
