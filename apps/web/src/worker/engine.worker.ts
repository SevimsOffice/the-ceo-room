/** Worker entry: the engine lives here so the Desk never freezes while days are simulated. */
import { loadSeed } from '@ceo-room/seed-data';
import { createHandler } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const handler = createHandler({ seed: loadSeed(), post: (msg) => scope.postMessage(msg) });

scope.onmessage = (ev) => {
  void handler.handle(ev.data);
};
