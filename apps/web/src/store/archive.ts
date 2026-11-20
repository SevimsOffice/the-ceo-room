/**
 * The Archive Room's state: the file under inspection, the company switch, the card-index drawers
 * and the downloads. Reading, validating and writing files happen in the archive worker; My company
 * is kept in this browser's database (companyDb). Nothing here goes over the network.
 */
import { create } from 'zustand';
import { createTranslator } from '@ceo-room/i18n';
import { type ImportReport, type SheetName, type Workbook, canImport } from '@ceo-room/import';
import type { ArchiveTransport } from '../archive/client';
import type { BrowseBook, CompanyId, DownloadKind } from '../archive/protocol';
import { MAX_FILE_BYTES, type ReadFailure, XLSX_MIME } from '../xlsx/limits';
import { type CompanyDb, type MyCompanyMeta, memoryCompanyDb } from './companyDb';
import { canSwitchCompany, useGame } from './game';
import { clearSaves } from './storage';

/** A file chosen or dropped: what the Archive Room needs of a `File`. */
export interface PickedFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Inspection =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string }
  | { status: 'failed'; fileName: string; failure: ReadFailure | 'failed' }
  | { status: 'ready'; fileName: string; fileSize: number; report: ImportReport; workbook: Workbook; imported: boolean };

/** The latest outcome, typed on the blotter (`code` is a ui.archive.* key). */
export interface ArchiveNote {
  code: string;
  params: Record<string, string | number>;
  tone: 'ok' | 'bad';
}

export interface ArchiveState {
  inspection: Inspection;
  /** an import, switch or removal under way */
  pending: 'import' | 'switch' | 'remove' | null;
  /** the question on the table before replacing or removing My company */
  confirm: 'replace' | 'remove' | null;
  note: ArchiveNote | null;
  /** the card-index drawer pulled out */
  drawer: SheetName | null;
  /** the active company's data for the drawers (re-read when the company or language changes) */
  browse: { key: string; status: 'loading' | 'ready' | 'failed'; book: BrowseBook | null } | null;
  downloading: DownloadKind | null;

  inspect(file: PickedFile): Promise<void>;
  /** import the inspected file as My company (asks first when it would replace one) */
  requestImport(): void;
  confirmImport(): Promise<void>;
  askRemove(): void;
  confirmRemove(): Promise<void>;
  cancelConfirm(): void;
  switchCompany(target: CompanyId): Promise<void>;
  download(kind: DownloadKind): Promise<void>;
  openDrawer(sheet: SheetName): void;
  closeDrawer(): void;
  loadBrowse(): Promise<void>;
  dismissNote(): void;
}

interface Services {
  db: CompanyDb;
  archive: ArchiveTransport;
  /** hand a file to the CEO (the browser's download) */
  saveFile: (file: Blob, name: string) => void;
  /** the browser clock, for "imported at" in the register (never used by the engine) */
  now: () => string;
}

/** A download made in the page: an object URL clicked by an `<a download>`, then revoked. */
function browserSave(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

let services: Services = {
  db: memoryCompanyDb(),
  archive: { call: () => Promise.reject(new Error('archive worker not started')) },
  saveFile: browserSave,
  now: () => new Date().toISOString(),
};

export function setArchiveServices(s: Partial<Services>): void {
  services = { ...services, ...s };
}

export function getCompanyDb(): CompanyDb {
  return services.db;
}

let inspectGen = 0;

const browseKey = (company: CompanyId, locale: string, mine: MyCompanyMeta | null): string => `${company}:${locale}:${company === 'mine' ? (mine?.importedAt ?? '') : ''}`;

const FILE_NAMES: Record<DownloadKind, string> = {
  example: 'ui.archive.file.example',
  empty: 'ui.archive.file.empty',
  reportXlsx: 'ui.archive.file.reportXlsx',
  reportCsv: 'ui.archive.file.reportCsv',
};

export const useArchive = create<ArchiveState>()((set, get) => ({
  inspection: { status: 'idle' },
  pending: null,
  confirm: null,
  note: null,
  drawer: null,
  browse: null,
  downloading: null,

  async inspect(file) {
    inspectGen += 1;
    const gen = inspectGen;
    const fileName = file.name;
    set({ note: null, confirm: null });
    if (file.size > MAX_FILE_BYTES) return set({ inspection: { status: 'failed', fileName, failure: 'tooLarge' } });
    if (file.size === 0) return set({ inspection: { status: 'failed', fileName, failure: 'empty' } });
    set({ inspection: { status: 'reading', fileName } });
    let r: Awaited<ReturnType<ArchiveTransport['call']>>;
    try {
      const bytes = await file.arrayBuffer();
      r = await services.archive.call({ type: 'inspect', bytes });
    } catch {
      r = { type: 'failed', requestId: 0, detail: 'read' };
    }
    if (gen !== inspectGen) return;
    if (r.type === 'inspected' && r.ok) {
      set({ inspection: { status: 'ready', fileName, fileSize: file.size, report: r.report, workbook: r.workbook, imported: false } });
    } else {
      set({ inspection: { status: 'failed', fileName, failure: r.type === 'inspected' && !r.ok ? r.failure : 'failed' } });
    }
  },

  requestImport() {
    const i = get().inspection;
    if (i.status !== 'ready' || i.imported || !canImport(i.report) || get().pending) return;
    if (useGame.getState().myCompany) set({ confirm: 'replace' });
    else void get().confirmImport();
  },

  async confirmImport() {
    const i = get().inspection;
    set({ confirm: null });
    if (i.status !== 'ready' || i.imported || !canImport(i.report) || get().pending) return;
    if (!canSwitchCompany(useGame.getState())) return set({ note: { code: 'ui.archive.note.clockRunning', params: {}, tone: 'bad' } });
    set({ pending: 'import', note: null });
    const r = await services.archive.call({ type: 'build', workbook: i.workbook });
    if (r.type !== 'built' || !r.ok) {
      set({ pending: null, note: { code: 'ui.archive.note.importFailed', params: {}, tone: 'bad' }, ...(r.type === 'built' ? { inspection: { ...i, report: r.report } } : {}) });
      return;
    }
    const snapshotDate = r.bundle.company.company.snapshotDate ?? r.report.snapshotDate ?? '';
    const meta: MyCompanyMeta = {
      format: 1,
      fileName: i.fileName,
      fileSize: i.fileSize,
      importedAt: services.now(),
      snapshotDate,
      companyName: r.companyName,
      summary: r.report.summary,
      profile: r.profile,
    };
    try {
      await services.db.save({ meta, data: { workbook: i.workbook, bundle: r.bundle } });
    } catch {
      set({ pending: null, note: { code: 'ui.archive.note.storeFailed', params: {}, tone: 'bad' } });
      return;
    }
    // a new My company starts at its Day 1: the old one's save game goes with it
    clearSaves('mine');
    const game = useGame.getState();
    game.setMyCompany(meta);
    game.openCompany('mine', r.bundle);
    set({
      pending: null,
      inspection: { ...i, imported: true },
      browse: null,
      note: { code: 'ui.archive.note.imported', params: { date: snapshotDate }, tone: 'ok' },
    });
  },

  askRemove() {
    if (useGame.getState().myCompany && !get().pending) set({ confirm: 'remove' });
  },

  async confirmRemove() {
    set({ confirm: null });
    const game = useGame.getState();
    if (!game.myCompany || get().pending) return;
    if (!canSwitchCompany(game)) return set({ note: { code: 'ui.archive.note.clockRunning', params: {}, tone: 'bad' } });
    set({ pending: 'remove' });
    if (game.company === 'mine') game.openCompany('sample', null);
    try {
      await services.db.remove();
    } catch {
      set({ pending: null, note: { code: 'ui.archive.note.removeFailed', params: {}, tone: 'bad' } });
      return;
    }
    clearSaves('mine');
    useGame.getState().setMyCompany(null);
    const i = get().inspection;
    set({
      pending: null,
      browse: null,
      inspection: i.status === 'ready' ? { ...i, imported: false } : i,
      note: { code: 'ui.archive.note.removed', params: {}, tone: 'ok' },
    });
  },

  cancelConfirm: () => set({ confirm: null }),

  async switchCompany(target) {
    const game = useGame.getState();
    if (game.company === target || get().pending) return;
    if (target === 'mine' && !game.myCompany) return;
    if (!canSwitchCompany(game)) return set({ note: { code: 'ui.archive.note.clockRunning', params: {}, tone: 'bad' } });
    set({ pending: 'switch', note: null });
    let bundle = null;
    if (target === 'mine') {
      const data = await services.db.loadData().catch(() => null);
      if (!data) {
        useGame.getState().setMyCompany(null);
        set({ pending: null, note: { code: 'ui.archive.note.missing', params: {}, tone: 'bad' } });
        return;
      }
      bundle = data.bundle;
    }
    useGame.getState().openCompany(target, bundle);
    set({ pending: null, browse: null });
  },

  async download(kind) {
    if (get().downloading) return;
    const locale = useGame.getState().locale;
    const t = createTranslator(locale);
    const i = get().inspection;
    let r: Awaited<ReturnType<ArchiveTransport['call']>>;
    set({ downloading: kind });
    try {
      if (kind === 'example' || kind === 'empty') {
        r = await services.archive.call({ type: 'template', lang: locale, example: kind === 'example' });
      } else {
        if (i.status !== 'ready') return;
        r = await services.archive.call({ type: 'reportFile', report: i.report, lang: locale, format: kind === 'reportCsv' ? 'csv' : 'xlsx' });
      }
      if (r.type === 'file') {
        const file = kind === 'reportCsv' ? r.file : new Blob([r.file], { type: XLSX_MIME });
        services.saveFile(file, t.t(FILE_NAMES[kind]));
      } else {
        set({ note: { code: 'ui.archive.note.downloadFailed', params: {}, tone: 'bad' } });
      }
    } finally {
      set({ downloading: null });
    }
  },

  openDrawer(sheet) {
    set({ drawer: sheet });
    void get().loadBrowse();
  },
  closeDrawer: () => set({ drawer: null }),

  async loadBrowse() {
    const g = useGame.getState();
    const key = browseKey(g.company, g.locale, g.myCompany);
    const b = get().browse;
    if (b && b.key === key && b.status !== 'failed') return;
    set({ browse: { key, status: 'loading', book: null } });
    let workbook: Workbook | null = null;
    if (g.company === 'mine') workbook = (await services.db.loadData().catch(() => null))?.workbook ?? null;
    const r = g.company === 'mine' && !workbook ? null : await services.archive.call({ type: 'browse', company: g.company, workbook, lang: g.locale });
    if (get().browse?.key !== key) return;
    set({ browse: r?.type === 'browsed' ? { key, status: 'ready', book: r.book } : { key, status: 'failed', book: null } });
  },

  dismissNote: () => set({ note: null }),
}));

/** Whether the inspected file may be imported now (no errors, not yet imported, nothing running). */
export function importReady(a: Pick<ArchiveState, 'inspection' | 'pending'>): boolean {
  const i = a.inspection;
  return i.status === 'ready' && !i.imported && canImport(i.report) && a.pending === null;
}
