/**
 * Sample company / My company: the Archive Room's store against the real archive handler and the
 * real engine handler (in-process, delivered asynchronously like Workers), localStorage in memory
 * and My company in an in-memory database. Each company keeps its own save game and comes back
 * after a reload; removing My company deletes it everywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedBundle } from '@ceo-room/engine';
import { type Workbook, exportTemplate } from '@ceo-room/import';
import { loadSeed } from '@ceo-room/seed-data';
import { createArchiveHandler } from '../archive/handler';
import type { ArchiveRequest, ArchiveResponse, CompanyId } from '../archive/protocol';
import { createHandler } from '../worker/handler';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';
import { workbookToXlsx } from '../xlsx/xlsx';
import { setArchiveServices, useArchive } from './archive';
import { IDBFactory } from 'fake-indexeddb';
import { type CompanyDb, indexedDbCompanyDb, memoryCompanyDb } from './companyDb';
import { setTransport, useGame } from './game';
import { resumeCompany } from './resume';
import { COMPANY_KEY, MINE_SAVE_KEY, SAVE_KEY, loadSave } from './storage';

const seed = loadSeed();
const initialGame = useGame.getState();
const initialArchive = useArchive.getState();

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
let storage: MemoryStorage;
let db: CompanyDb;
let saved: { name: string; file: Blob }[];

/** What client.ts does: a fresh engine "worker" per company, started from that company's save. */
function connect() {
  let gen = 0;
  let inFlight = 0;
  let handler = createHandler({ seed, post: () => {}, dayDelayMs: 0 });
  const deliver = (m: WorkerRequest) => {
    const h = handler;
    inFlight += 1;
    setTimeout(() => void h.handle(structuredClone(m)).finally(() => (inFlight -= 1)), 0);
  };
  const open = (company: CompanyId, bundle: SeedBundle | null) => {
    gen += 1;
    const mine = gen;
    handler = createHandler({
      seed,
      dayDelayMs: 0,
      post: (m: WorkerResponse) => {
        inFlight += 1;
        const copy = structuredClone(m);
        setTimeout(() => {
          inFlight -= 1;
          // a replaced worker is terminated: nothing more of it arrives
          if (mine === gen) useGame.getState().receive(copy);
        }, 0);
      },
    });
    deliver({ type: 'init', ...loadSave(company), bundle });
  };
  setTransport({ send: deliver, open });
  setArchiveServices({
    db,
    archive: {
      call: async (req) => {
        const out: ArchiveResponse[] = [];
        const ah = createArchiveHandler({ seed, post: (m) => out.push(structuredClone(m)) });
        await ah.handle({ ...req, requestId: 1 } as ArchiveRequest);
        return out[0]!;
      },
    },
    saveFile: (file, name) => saved.push({ file, name }),
    now: () => '2027-02-01T09:30:00.000Z',
  });
  const settle = async () => {
    for (let i = 0; i < 4000; i++) {
      await tick();
      await handler.idle();
      if (inFlight === 0) {
        await tick();
        if (inFlight === 0) return;
      }
    }
    throw new Error('did not settle');
  };
  /** start up like a page load: resume the company that was on the desk */
  const boot = async () => {
    const r = await resumeCompany(db);
    useGame.getState().setMyCompany(r.meta);
    if (r.lost) useGame.setState({ company: 'sample' });
    open(r.company, r.bundle);
    await settle();
  };
  return { settle, boot };
}

const file = async (wb: Workbook, name = 'firma.xlsx') => {
  const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice(0) };
};

const report = () => useGame.getState().report!;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  db = memoryCompanyDb();
  saved = [];
  useGame.setState(initialGame, true);
  useArchive.setState(initialArchive, true);
});

afterEach(() => {
  useGame.getState().pause();
  vi.unstubAllGlobals();
});

/** Reload: the stores start again from what the browser kept. */
async function reload() {
  useGame.setState({ ...initialGame, company: storage.getItem(COMPANY_KEY) === 'mine' ? 'mine' : 'sample' }, true);
  useArchive.setState(initialArchive, true);
  const c = connect();
  await c.boot();
  return c;
}

describe('sample company and My company', () => {
  it('imports NOVARA’s template as My company: Day 1 has the snapshot date, the sample keeps its own day', async () => {
    const c = connect();
    await c.boot();
    expect(report().day).toBe(1);
    useGame.getState().advance(3);
    await c.settle();
    expect(report().day).toBe(4);
    const sampleFigures = { cash: report().cash, backlog: report().backlog };

    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'tr', example: true })));
    const ins = useArchive.getState().inspection;
    expect(ins.status === 'ready' && ins.report.summary.errors).toBe(0);
    useArchive.getState().requestImport();
    await c.settle();
    await vi.waitFor(() => expect(useGame.getState().company).toBe('mine'));
    await c.settle();
    expect(useArchive.getState().note).toMatchObject({ code: 'ui.archive.note.imported', params: { date: '2027-01-04' } });
    expect(useGame.getState().myCompany).toMatchObject({ fileName: 'firma.xlsx', snapshotDate: '2027-01-04', companyName: 'NOVARA Sanayi', profile: 'sample' });
    expect(report()).toMatchObject({ day: 1, date: '2027-01-04', forecast: false, company: { name: 'NOVARA Sanayi', source: 'import' } });

    useGame.getState().advance(1);
    await c.settle();
    expect(report()).toMatchObject({ day: 2, date: '2027-01-05', forecast: true });
    // separate save games
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).log.length).toBeGreaterThan(0);
    expect(storage.getItem(MINE_SAVE_KEY)).not.toBeNull();
    expect(storage.getItem(MINE_SAVE_KEY)).not.toBe(storage.getItem(SAVE_KEY));

    // back to the sample: its own Day 4, nothing of My company in it
    await useArchive.getState().switchCompany('sample');
    await c.settle();
    expect(useGame.getState().company).toBe('sample');
    expect(report()).toMatchObject({ day: 4, date: null, forecast: false });
    expect({ cash: report().cash, backlog: report().backlog }).toEqual(sampleFigures);

    await useArchive.getState().switchCompany('mine');
    await c.settle();
    expect(report()).toMatchObject({ day: 2, date: '2027-01-05', forecast: true });
  });

  it('comes back after a reload with the same company and day; a lost My company falls back to the sample', async () => {
    const c = connect();
    await c.boot();
    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'en', example: true })));
    useArchive.getState().requestImport();
    await vi.waitFor(() => expect(useGame.getState().company).toBe('mine'));
    await c.settle();
    useGame.getState().advance(7);
    await c.settle();
    expect(report().day).toBe(8);

    await reload();
    expect(useGame.getState().company).toBe('mine');
    expect(useGame.getState().myCompany?.fileName).toBe('firma.xlsx');
    expect(report()).toMatchObject({ day: 8, date: '2027-01-11', forecast: true });

    // the browser's database was cleared behind our back
    await db.remove();
    await reload();
    expect(useGame.getState().company).toBe('sample');
    expect(useGame.getState().myCompany).toBeNull();
    expect(storage.getItem(COMPANY_KEY)).toBeNull();
    expect(report().date).toBeNull();
  });

  it('re-importing asks first and starts the new file at Day 1; removing deletes My company everywhere', async () => {
    const c = connect();
    await c.boot();
    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'tr', example: true })));
    useArchive.getState().requestImport();
    await vi.waitFor(() => expect(useGame.getState().company).toBe('mine'));
    await c.settle();
    useGame.getState().advance(2);
    await c.settle();

    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'en', example: true }), 'second.xlsx'));
    useArchive.getState().requestImport();
    expect(useArchive.getState().confirm).toBe('replace');
    useArchive.getState().cancelConfirm();
    expect(useGame.getState().myCompany?.fileName).toBe('firma.xlsx');
    useArchive.getState().requestImport();
    await useArchive.getState().confirmImport();
    await c.settle();
    expect(useGame.getState().myCompany?.fileName).toBe('second.xlsx');
    expect(report()).toMatchObject({ day: 1, date: '2027-01-04' });

    useArchive.getState().askRemove();
    expect(useArchive.getState().confirm).toBe('remove');
    await useArchive.getState().confirmRemove();
    await c.settle();
    expect(useGame.getState()).toMatchObject({ company: 'sample', myCompany: null });
    expect(await db.loadMeta()).toBeNull();
    expect(await db.loadData()).toBeNull();
    expect(storage.getItem(MINE_SAVE_KEY)).toBeNull();
    expect(useArchive.getState().note?.code).toBe('ui.archive.note.removed');
    // with no My company the switch cannot go there
    await useArchive.getState().switchCompany('mine');
    expect(useGame.getState().company).toBe('sample');
  });

  it('a file with errors cannot be imported; non-xlsx and oversized files get a reason', async () => {
    const c = connect();
    await c.boot();
    const wb = exportTemplate(seed, { lang: 'tr', example: true });
    const col = wb.Customers![0]!.indexOf('name');
    wb.Customers![4]![col] = 'muhasebe@firma.com.tr';
    await useArchive.getState().inspect(await file(wb));
    const ins = useArchive.getState().inspection;
    expect(ins.status === 'ready' && ins.report.summary.errors).toBe(1);
    useArchive.getState().requestImport();
    await c.settle();
    expect(useGame.getState().company).toBe('sample');
    expect(useGame.getState().myCompany).toBeNull();

    const text = new TextEncoder().encode('not a workbook');
    await useArchive.getState().inspect({ name: 'notes.txt', size: text.byteLength, arrayBuffer: async () => text.buffer });
    expect(useArchive.getState().inspection).toMatchObject({ status: 'failed', failure: 'notXlsx', fileName: 'notes.txt' });
    let read = false;
    await useArchive.getState().inspect({ name: 'huge.xlsx', size: 50 * 1024 * 1024, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) });
    expect(useArchive.getState().inspection).toMatchObject({ status: 'failed', failure: 'tooLarge' });
    expect(read).toBe(false);
  });

  it('downloads the templates and the report in the chosen language; browses the active company', async () => {
    const c = connect();
    await c.boot();
    await useArchive.getState().download('example');
    useGame.getState().setLocale('en');
    await useArchive.getState().download('empty');
    expect(saved.map((s) => s.name)).toEqual(['ceo-room-ornek-sablon-novara.xlsx', 'ceo-room-template.xlsx']);
    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'en', example: true })));
    await useArchive.getState().download('reportCsv');
    expect(saved.at(-1)!.name).toBe('ceo-room-inspection-report.csv');

    useArchive.getState().openDrawer('Customers');
    await vi.waitFor(() => expect(useArchive.getState().browse?.status).toBe('ready'));
    expect(useArchive.getState().browse!.book!.company).toBe('sample');
    expect(useArchive.getState().browse!.book!.sheets.find((s) => s.name === 'Customers')!.rows).toHaveLength(8);
  });

  it('keeps only the sanitised workbook in IndexedDB: no unknown sheet or column, no label rows', async () => {
    const factory = new IDBFactory();
    db = indexedDbCompanyDb(factory);
    const c = connect();
    await c.boot();
    const wb = exportTemplate(seed, { lang: 'tr', example: true });
    wb.Notlar = [['konu', 'not'], ['stok sayımı', 'pazartesi bakılacak']];
    wb.Customers![0]!.push('remarks');
    wb.Customers![3]!.push('öğleden önce aranmalı');
    await useArchive.getState().inspect(await file(wb));
    const ins = useArchive.getState().inspection;
    expect(ins.status === 'ready' && ins.report.summary.errors).toBe(0);
    expect(ins.status === 'ready' && Object.keys(ins.workbook)).not.toContain('Notlar');
    useArchive.getState().requestImport();
    await vi.waitFor(() => expect(useGame.getState().company).toBe('mine'));
    await c.settle();
    // read back what the browser's database holds, through a second connection to it
    const stored = (await indexedDbCompanyDb(factory).loadData())!;
    const text = JSON.stringify(stored.workbook);
    expect(Object.keys(stored.workbook)).not.toContain('Notlar');
    expect(stored.workbook.Customers![0]).not.toContain('remarks');
    expect(text).not.toMatch(/stok sayımı|pazartesi|öğleden|remarks/);
    expect(stored.workbook.Customers![1]).toEqual([]);
    expect(stored.workbook.Customers!.length).toBe(wb.Customers!.length);
  });

  it('a stored My company that cannot start puts the sample on the desk with a slip, and stays there after a reload', async () => {
    const c = connect();
    await c.boot();
    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'tr', example: true })));
    useArchive.getState().requestImport();
    await vi.waitFor(() => expect(useGame.getState().company).toBe('mine'));
    await c.settle();
    // damage the stored company as an older version could have stored it: a card names a missing supplier
    const data = (await db.loadData())!;
    const card = data.bundle.eventCards.find((x) => x.effect.kind === 'supplierPriceChange')!;
    if (card.effect.kind === 'supplierPriceChange') card.effect.alternativeSupplierId = 'sup_gone';
    await db.save({ meta: (await db.loadMeta())!, data });

    await reload();
    expect(useGame.getState()).toMatchObject({ company: 'sample', fatal: null, phase: 'ready' });
    expect(useGame.getState().notice).toMatchObject({ key: 'ui.status.companyFailed' });
    expect(report()).toMatchObject({ day: 1, date: null });
    expect(storage.getItem(COMPANY_KEY)).toBeNull();
    // My company's data is still there for the Archive Room
    expect(useGame.getState().myCompany?.fileName).toBe('firma.xlsx');
    await reload();
    expect(useGame.getState()).toMatchObject({ company: 'sample', fatal: null, phase: 'ready', notice: null });
    // asking for it again says so again, without breaking the desk
    await useArchive.getState().switchCompany('mine');
    await c.settle();
    await vi.waitFor(() => expect(useGame.getState().phase).toBe('ready'));
    expect(useGame.getState()).toMatchObject({ company: 'sample', fatal: null, notice: { key: 'ui.status.companyFailed' } });
  });

  it('a request the archive worker does not answer in time ends the reading with a reason', async () => {
    setArchiveServices({ db, archive: { call: async () => ({ type: 'failed', requestId: 0, detail: 'timeout' }) } });
    await useArchive.getState().inspect(await file(exportTemplate(seed, { lang: 'tr', example: false })));
    expect(useArchive.getState().inspection).toMatchObject({ status: 'failed', failure: 'timeout', fileName: 'firma.xlsx' });
  });
});
