/** The archive worker transport: answers by request id; a worker that does not answer in time is stopped. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ArchiveWorkerLike, workerArchiveTransport } from './client';
import type { ArchiveRequest, ArchiveResponse } from './protocol';

class FakeWorker implements ArchiveWorkerLike {
  onmessage: ((ev: MessageEvent<ArchiveResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  sent: ArchiveRequest[] = [];
  terminated = false;
  postMessage(msg: ArchiveRequest): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(r: ArchiveResponse): void {
    this.onmessage?.({ data: r } as MessageEvent<ArchiveResponse>);
  }
}

afterEach(() => vi.useRealTimers());

describe('archive transport', () => {
  it('answers each request by its id', async () => {
    const w = new FakeWorker();
    const t = workerArchiveTransport({ spawn: () => w, timeoutMs: 1000 });
    const a = t.call({ type: 'template', lang: 'tr', example: true });
    const b = t.call({ type: 'template', lang: 'en', example: false });
    const [ra, rb] = w.sent;
    w.answer({ type: 'failed', requestId: rb!.requestId, detail: 'b' });
    w.answer({ type: 'failed', requestId: ra!.requestId, detail: 'a' });
    expect(await a).toMatchObject({ detail: 'a' });
    expect(await b).toMatchObject({ detail: 'b' });
  });

  it('stops a worker that does not answer in time and fails the request (the blotter never stays on "reading")', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const t = workerArchiveTransport({ spawn: () => (workers.push(new FakeWorker()), workers.at(-1)!), timeoutMs: 5000 });
    const slow = t.call({ type: 'inspect', bytes: new ArrayBuffer(8) });
    let done = false;
    void slow.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await slow).toEqual({ type: 'failed', requestId: 1, detail: 'timeout' });
    expect(workers[0]!.terminated).toBe(true);
    // a late answer from the stopped worker is ignored; the next request starts a new worker
    workers[0]!.answer({ type: 'failed', requestId: 1, detail: 'late' });
    const next = t.call({ type: 'template', lang: 'tr', example: true });
    expect(workers).toHaveLength(2);
    workers[1]!.answer({ type: 'failed', requestId: 2, detail: 'ok' });
    expect(await next).toMatchObject({ detail: 'ok' });
  });

  it('a worker error fails every waiting request and replaces the worker', async () => {
    const workers: FakeWorker[] = [];
    const t = workerArchiveTransport({ spawn: () => (workers.push(new FakeWorker()), workers.at(-1)!), timeoutMs: 1000 });
    const a = t.call({ type: 'template', lang: 'tr', example: true });
    workers[0]!.onerror?.({ message: 'boom', preventDefault: () => {} } as ErrorEvent);
    expect(await a).toMatchObject({ type: 'failed', detail: 'boom' });
    expect(workers[0]!.terminated).toBe(true);
  });
});
