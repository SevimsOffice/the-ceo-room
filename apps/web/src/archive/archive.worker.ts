/** Archive worker entry: xlsx reading/writing and the import run here, off the main thread. */
import { loadSeed } from '@ceo-room/seed-data';
import { createArchiveHandler } from './handler';
import type { ArchiveRequest, ArchiveResponse } from './protocol';

interface WorkerScope {
  postMessage(msg: ArchiveResponse): void;
  onmessage: ((ev: MessageEvent<ArchiveRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const handler = createArchiveHandler({ seed: loadSeed(), post: (msg) => scope.postMessage(msg) });
scope.onmessage = (ev) => void handler.handle(ev.data);
