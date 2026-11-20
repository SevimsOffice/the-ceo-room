/** Starts the engine worker and connects it to the Desk store; opens the company that was on the desk. */
import type { SeedBundle } from '@ceo-room/engine';
import { setTransport, useGame } from './game';
import { loadSave } from './storage';
import { resumeCompany } from './resume';
import { type CompanyDb, indexedDbCompanyDb, memoryCompanyDb } from './companyDb';
import { setArchiveServices } from './archive';
import { workerArchiveTransport } from '../archive/client';
import type { CompanyId } from '../archive/protocol';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

let started = false;
let worker: Worker | null = null;
/** the company the worker runs (My company carries its imported bundle) */
let current: { company: CompanyId; bundle: SeedBundle | null } = { company: 'sample', bundle: null };

const fatal = (detail: string): void =>
  useGame.getState().receive({ type: 'fatal', error: { code: 'ui.error.engineFailed', params: { detail } } });

/** A new worker wired to the store, started from the company's stored save (or none when `fresh`). */
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
  const { company, bundle } = current;
  const init: WorkerRequest = fresh ? { type: 'init', save: null, bundle } : { type: 'init', ...loadSave(company), bundle };
  w.postMessage(init);
}

/** Open the company that was on the desk: My company needs its bundle from the browser's database. */
async function boot(db: CompanyDb): Promise<void> {
  // the sample needs nothing from the database: it starts at once
  const sample = useGame.getState().company === 'sample';
  if (sample) spawn(false);
  const r = await resumeCompany(db);
  useGame.getState().setMyCompany(r.meta);
  if (sample) return;
  // My company may be gone (site data cleared): then the sample is put back on the desk
  if (r.lost) useGame.setState({ company: 'sample' });
  current = { company: r.company, bundle: r.bundle };
  spawn(false);
}

export function startEngine(): void {
  if (started) return;
  started = true;
  const db = globalThis.indexedDB ? indexedDbCompanyDb() : memoryCompanyDb();
  setArchiveServices({ db, archive: workerArchiveTransport() });
  setTransport({
    send: (msg: WorkerRequest) => worker?.postMessage(msg),
    // after a fatal error the old worker may be unusable: replace it and start with no save
    restart: () => spawn(true),
    open: (company, bundle) => {
      current = { company, bundle };
      spawn(false);
    },
  });
  void boot(db);
}
