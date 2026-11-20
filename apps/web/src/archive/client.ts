/** The archive worker, started on first use; each request is answered once (by its requestId). */
import { ARCHIVE_TIMEOUT_MS } from '../xlsx/limits';
import type { ArchiveRequest, ArchiveResponse } from './protocol';

/** A request without its id: the transport numbers it. */
export type ArchiveCall = ArchiveRequest extends infer R ? (R extends ArchiveRequest ? Omit<R, 'requestId'> : never) : never;

export interface ArchiveTransport {
  call(req: ArchiveCall): Promise<ArchiveResponse>;
}

/** The `detail` of a request the worker did not answer in time (the worker was stopped). */
export const ARCHIVE_TIMEOUT = 'timeout';

/** What the transport needs of a Worker (tests pass a fake). */
export interface ArchiveWorkerLike {
  onmessage: ((ev: MessageEvent<ArchiveResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  postMessage(msg: ArchiveRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export interface ArchiveTransportOptions {
  /** how long one request may take before the worker is stopped (default ARCHIVE_TIMEOUT_MS) */
  timeoutMs?: number;
  spawn?: () => ArchiveWorkerLike;
}

const spawnWorker = (): ArchiveWorkerLike => new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' }) as unknown as ArchiveWorkerLike;

/**
 * Requests to the archive worker. A request not answered within `timeoutMs` (a file that takes too
 * long to read, a worker stuck or dead) stops the worker and answers every waiting request with
 * `failed` (`detail: 'timeout'`): the page never waits forever. The next request starts a new worker.
 */
export function workerArchiveTransport(opts: ArchiveTransportOptions = {}): ArchiveTransport {
  const timeoutMs = opts.timeoutMs ?? ARCHIVE_TIMEOUT_MS;
  const spawn = opts.spawn ?? spawnWorker;
  let worker: ArchiveWorkerLike | null = null;
  let next = 0;
  const waiting = new Map<number, { resolve: (r: ArchiveResponse) => void; timer: ReturnType<typeof setTimeout> }>();

  const settle = (requestId: number, r: ArchiveResponse): void => {
    const w = waiting.get(requestId);
    if (!w) return;
    waiting.delete(requestId);
    clearTimeout(w.timer);
    w.resolve(r);
  };

  const failAll = (detail: string): void => {
    for (const requestId of [...waiting.keys()]) settle(requestId, { type: 'failed', requestId, detail });
  };

  /** Stop the worker (broken or too slow); a new one is started on the next request. */
  const stop = (w: ArchiveWorkerLike, detail: string): void => {
    w.terminate();
    if (worker === w) worker = null;
    failAll(detail);
  };

  const ensure = (): ArchiveWorkerLike => {
    if (worker) return worker;
    const w = spawn();
    w.onmessage = (ev: MessageEvent<ArchiveResponse>) => settle(ev.data.requestId, ev.data);
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      stop(w, ev.message || 'archive worker error');
    };
    worker = w;
    return w;
  };

  return {
    call(req) {
      next += 1;
      const requestId = next;
      return new Promise<ArchiveResponse>((resolve) => {
        const w = ensure();
        const timer = setTimeout(() => stop(w, ARCHIVE_TIMEOUT), timeoutMs);
        waiting.set(requestId, { resolve, timer });
        const msg = { ...req, requestId } as ArchiveRequest;
        w.postMessage(msg, msg.type === 'inspect' ? [msg.bytes] : []);
      });
    },
  };
}
