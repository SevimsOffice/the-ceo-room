/**
 * The archive worker's message handler, as a plain module (no Worker, no DOM, no storage): the
 * worker entry wires it to `self`; tests call `handle()` directly. Every request is answered once.
 */
import type { SeedBundle } from '@ceo-room/engine';
import {
  GENERIC_PROFILE,
  type ImportProfile,
  type ImportReport,
  NOVARA_PROFILE,
  TEMPLATE,
  type Workbook,
  analyseWorkbook,
  exportTemplate,
  reportRows,
  sanitiseWorkbook,
  toSeedBundle,
  validateWorkbook,
} from '@ceo-room/import';
import { WORKSPACE_ID } from '../worker/handler';
import { XlsxReadError, workbookToXlsx, xlsxToWorkbook } from '../xlsx/xlsx';
import type { ArchiveRequest, ArchiveResponse, BrowseBook, CompanyId, ProfileId } from './protocol';

export interface ArchiveHandlerOptions {
  /** the sample company (the template example and the sample's drawers) */
  seed: SeedBundle;
  post: (msg: ArchiveResponse) => void;
}

/**
 * NOVARA's storyline for its own data imported as My company: the same cards, departments and
 * label keys as the sample, so the import runs exactly like it, but under the plain company name
 * from the file (Settings.company_name) as an imported company.
 */
export const SAMPLE_STORYLINE: ImportProfile = {
  ...NOVARA_PROFILE,
  id: 'novara-storyline',
  company: { ...NOVARA_PROFILE.company, nameKey: null },
};

/** Keys that are labels, not company facts: plain names (the sample's own may be renamed). */
const LABEL_KEYS = new Set(['workspaceId', 'name', 'kindName']);

/** A bundle without its company record, workspace ids and plain labels: the data a storyline depends on. */
function storylineData(b: SeedBundle): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!LABEL_KEYS.has(k)) out[k] = strip(x);
    return out;
  };
  const { company, ...rest } = b;
  return strip({ settings: company.settings, ...rest });
}

/**
 * Whether a bundle built with the sample's storyline is the sample itself: every figure, id and date
 * as in the seed; only the company record (name, city, currency, snapshot date) and plain labels may
 * differ. Anything else gets the generic profile: a storyline scripted for the sample's suppliers,
 * customers and lines must never run on other data, even with the same ids.
 */
export function isSampleData(bundle: SeedBundle, seed: SeedBundle): boolean {
  return JSON.stringify(storylineData(bundle)) === JSON.stringify(storylineData(seed));
}

/**
 * Build My company: the sample's storyline only when the file holds the sample's own data unchanged
 * (isSampleData), otherwise the generic profile (data-driven cards, no department heads, not
 * simulated). Only without errors.
 */
export function buildCompany(wb: Workbook, seed: SeedBundle): { ok: true; bundle: SeedBundle; profile: ProfileId; report: ImportReport } | { ok: false; report: ImportReport } {
  const story = toSeedBundle(wb, { workspaceId: WORKSPACE_ID, profile: SAMPLE_STORYLINE });
  if (story.ok && isSampleData(story.bundle, seed)) return { ok: true, bundle: story.bundle, profile: 'sample', report: story.report };
  const mismatchOnly = story.ok || story.report.issues.every((i) => i.severity !== 'error' || i.code === 'import.profile.mismatch');
  if (!mismatchOnly) return { ok: false, report: story.report };
  const generic = toSeedBundle(wb, { workspaceId: WORKSPACE_ID, profile: GENERIC_PROFILE });
  return generic.ok ? { ok: true, bundle: generic.bundle, profile: 'generic', report: generic.report } : { ok: false, report: generic.report };
}

/**
 * Text a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab or CR first) gets a leading `'`,
 * so a value copied from an uploaded file can never execute when the report is opened.
 */
export function neutraliseFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** CSV of rows (RFC 4180 quoting, CRLF, UTF-8 BOM so Excel reads Turkish letters); text never starts a formula. */
export function toCsv(rows: readonly (readonly (string | number | boolean | null)[])[]): string {
  const cell = (c: string | number | boolean | null): string => {
    if (c === null) return '';
    const s = typeof c === 'boolean' ? (c ? 'TRUE' : 'FALSE') : typeof c === 'number' ? String(c) : neutraliseFormula(c);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** The drawers' tables: every template sheet with its rows parsed into engine units. */
export function browseBook(company: CompanyId, wb: Workbook): BrowseBook {
  const a = analyseWorkbook(wb);
  return {
    company,
    snapshotDate: a.snapshotDate,
    sheets: TEMPLATE.sheets.map((spec) => {
      const sheet = a.sheets[spec.name];
      const columns = spec.columns.map((c) => ({ key: c.key, type: c.type, unit: c.unit, labelKey: c.labelKey }));
      return {
        name: spec.name,
        present: sheet.present,
        columns,
        rows: sheet.rows.map((r) => columns.map((c) => r.values[c.key] ?? null)),
        rowNumbers: sheet.rows.map((r) => r.row),
      };
    }),
  };
}

export interface ArchiveHandler {
  handle(msg: ArchiveRequest): Promise<void>;
}

export function createArchiveHandler(opts: ArchiveHandlerOptions): ArchiveHandler {
  const { seed, post } = opts;
  return {
    async handle(msg) {
      try {
        await route(msg);
      } catch (err) {
        post({ type: 'failed', requestId: msg.requestId, detail: err instanceof Error ? err.message : String(err) });
      }
    },
  };

  async function route(msg: ArchiveRequest): Promise<void> {
    switch (msg.type) {
      case 'template': {
        const wb = exportTemplate(seed, { lang: msg.lang, example: msg.example });
        post({ type: 'file', requestId: msg.requestId, file: await workbookToXlsx(wb) });
        return;
      }
      case 'inspect': {
        let wb: Workbook;
        try {
          wb = await xlsxToWorkbook(msg.bytes);
        } catch (err) {
          if (err instanceof XlsxReadError) {
            post({ type: 'inspected', requestId: msg.requestId, ok: false, failure: err.code });
            return;
          }
          throw err;
        }
        // the report is on the file as uploaded; only the sanitised workbook leaves the worker
        // (template sheets and known columns: nothing else is kept or stored)
        post({ type: 'inspected', requestId: msg.requestId, ok: true, workbook: sanitiseWorkbook(wb), report: validateWorkbook(wb) });
        return;
      }
      case 'build': {
        const workbook = sanitiseWorkbook(msg.workbook);
        const r = buildCompany(workbook, seed);
        if (!r.ok) {
          post({ type: 'built', requestId: msg.requestId, ok: false, report: r.report });
          return;
        }
        const c = r.bundle.company.company;
        post({ type: 'built', requestId: msg.requestId, ok: true, workbook, bundle: r.bundle, profile: r.profile, report: r.report, companyName: c.name ?? c.nameKey });
        return;
      }
      case 'reportFile': {
        const rows = reportRows(msg.report, msg.lang);
        // xlsx: every cell as plain text, never a formula
        const text = rows.map((r) => r.map((c) => (c === null ? null : neutraliseFormula(typeof c === 'boolean' ? (c ? 'TRUE' : 'FALSE') : String(c)))));
        const file =
          msg.format === 'csv'
            ? new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
            : await workbookToXlsx({ [msg.lang === 'tr' ? 'Rapor' : 'Report']: text });
        post({ type: 'file', requestId: msg.requestId, file });
        return;
      }
      case 'browse': {
        // the sample is read through its own filled template: the same parser and tables as an import
        const wb = msg.company === 'sample' || !msg.workbook ? exportTemplate(seed, { lang: msg.lang, example: true }) : msg.workbook;
        post({ type: 'browsed', requestId: msg.requestId, book: browseBook(msg.company, wb) });
        return;
      }
    }
  }
}
