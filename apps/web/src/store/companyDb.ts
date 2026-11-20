/**
 * Where My company is kept: IndexedDB in this browser, nothing else (no server, no network).
 *
 * Why IndexedDB and not localStorage: an imported workbook (up to 18 sheets × 5 000 rows) and the
 * bundle built from it can run to several megabytes, past localStorage's ~5 MB per site (stored as
 * UTF-16 text); IndexedDB keeps structured objects without JSON, asynchronously (the Desk never
 * blocks on it) and has room to spare. The save games (a few kilobytes of commands) stay in
 * localStorage, per company (storage.ts).
 *
 * Two records under fixed keys: `mine.meta` (small: read at start for the switch and the register)
 * and `mine.data` (workbook + bundle: read when My company is opened). Written and removed together.
 */
import type { SeedBundle } from '@ceo-room/engine';
import type { ImportSummary, Workbook } from '@ceo-room/import';
import type { ProfileId } from '../archive/protocol';

export interface MyCompanyMeta {
  /** record layout version */
  format: 1;
  fileName: string;
  fileSize: number;
  /** when it was imported, by the browser's clock (ISO); shown in the register only */
  importedAt: string;
  /** Day 1 */
  snapshotDate: string;
  companyName: string;
  /** the inspection's counts (rows per sheet, errors / warnings / notes) */
  summary: ImportSummary;
  profile: ProfileId;
}

export interface MyCompanyData {
  workbook: Workbook;
  bundle: SeedBundle;
}

export interface MyCompanyRecord {
  meta: MyCompanyMeta;
  data: MyCompanyData;
}

export interface CompanyDb {
  loadMeta(): Promise<MyCompanyMeta | null>;
  loadData(): Promise<MyCompanyData | null>;
  save(record: MyCompanyRecord): Promise<void>;
  remove(): Promise<void>;
}

const DB_NAME = 'ceo-room';
const STORE = 'company';
const META = 'mine.meta';
const DATA = 'mine.data';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The browser's IndexedDB (or a given factory, e.g. fake-indexeddb in tests). */
export function indexedDbCompanyDb(factory: IDBFactory | undefined = globalThis.indexedDB): CompanyDb {
  let opened: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB is not available in this browser'));
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB could not be opened'));
      r.onblocked = () => reject(new Error('IndexedDB is blocked'));
    }).catch((err: unknown) => {
      opened = null;
      throw err;
    });
    return opened;
  };
  const get = async <T>(key: string): Promise<T | null> => {
    const tx = (await db()).transaction(STORE, 'readonly');
    const v = await request(tx.objectStore(STORE).get(key));
    return (v as T | undefined) ?? null;
  };
  return {
    loadMeta: () => get<MyCompanyMeta>(META),
    loadData: () => get<MyCompanyData>(DATA),
    async save(record) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      s.put(record.data, DATA);
      s.put(record.meta, META);
      await done(tx);
    },
    async remove() {
      const tx = (await db()).transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      s.delete(DATA);
      s.delete(META);
      await done(tx);
    },
  };
}

/** In memory (tests, or a browser without IndexedDB: My company then lasts until the tab closes). */
export function memoryCompanyDb(): CompanyDb {
  let rec: MyCompanyRecord | null = null;
  return {
    loadMeta: async () => (rec ? structuredClone(rec.meta) : null),
    loadData: async () => (rec ? structuredClone(rec.data) : null),
    save: async (r) => {
      rec = structuredClone(r);
    },
    remove: async () => {
      rec = null;
    },
  };
}
