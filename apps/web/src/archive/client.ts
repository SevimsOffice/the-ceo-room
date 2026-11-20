/** The archive worker, started on first use; each request is answered once (by its requestId). */
import type { ArchiveRequest, ArchiveResponse } from './protocol';

/** A request without its id: the transport numbers it. */
export type ArchiveCall = ArchiveRequest extends infer R ? (R extends ArchiveRequest ? Omit<R, 'requestId'> : never) : never;

export interface ArchiveTransport {
  call(req: ArchiveCall): Promise<ArchiveResponse>;
}

export function workerArchiveTransport(): ArchiveTransport {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, (r: ArchiveResponse) => void>();

  const failAll = (detail: string): void => {
    for (const [requestId, resolve] of waiting) resolve({ type: 'failed', requestId, detail });
    waiting.clear();
  };

  const ensure = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<ArchiveResponse>) => {
      const resolve = waiting.get(ev.data.requestId);
      waiting.delete(ev.data.requestId);
      resolve?.(ev.data);
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      // a broken worker is replaced on the next request
      w.terminate();
      if (worker === w) worker = null;
      failAll(ev.message || 'archive worker error');
    };
    worker = w;
    return w;
  };

  return {
    call(req) {
      next += 1;
      const requestId = next;
      return new Promise<ArchiveResponse>((resolve) => {
        waiting.set(requestId, resolve);
        const msg = { ...req, requestId } as ArchiveRequest;
        ensure().postMessage(msg, msg.type === 'inspect' ? [msg.bytes] : []);
      });
    },
  };
}
