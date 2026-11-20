/**
 * Messages between the Archive Room (main thread) and the archive worker, which reads and writes
 * the xlsx files and runs the import package (template export, validation, conversion). Nothing
 * here touches the network: files come from the CEO's disk and go back to it as downloads.
 */
import type { SeedBundle } from '@ceo-room/engine';
import type { Locale } from '@ceo-room/i18n';
import type { ColumnType, ImportReport, SheetName, UnitCode, Value, Workbook } from '@ceo-room/import';
import type { ReadFailure } from '../xlsx/limits';

/** Which company: the built-in sample (NOVARA) or the CEO's own, imported from Excel. */
export type CompanyId = 'sample' | 'mine';

/** The story a company runs with: NOVARA's storyline (its own data re-imported) or data-driven cards only. */
export type ProfileId = 'sample' | 'generic';

export interface BrowseColumn {
  key: string;
  type: ColumnType;
  unit: UnitCode;
  labelKey: string;
}

/** A sheet of the company's data as the card-index drawer shows it (values in engine units). */
export interface BrowseSheet {
  name: SheetName;
  present: boolean;
  columns: BrowseColumn[];
  /** one row per data row, values in column order (money in kuruş, percent in bps, score in hundredths, dates ISO) */
  rows: Value[][];
  /** Excel row numbers of `rows` */
  rowNumbers: number[];
}

export interface BrowseBook {
  company: CompanyId;
  /** Day 1: the snapshot date (sample: the template's example date, shown as day numbers) */
  snapshotDate: string | null;
  sheets: BrowseSheet[];
}

export type DownloadKind = 'example' | 'empty' | 'reportXlsx' | 'reportCsv';

export type ArchiveRequest =
  /** the Excel template: filled with the sample company (example) or empty, in a language */
  | { type: 'template'; requestId: number; lang: Locale; example: boolean }
  /** read and validate an uploaded file (nothing is stored; the answer carries the sanitised workbook) */
  | { type: 'inspect'; requestId: number; bytes: ArrayBuffer }
  /** convert a validated workbook into the engine's SeedBundle (My company) */
  | { type: 'build'; requestId: number; workbook: Workbook }
  /** the inspection report as a file */
  | { type: 'reportFile'; requestId: number; report: ImportReport; lang: Locale; format: 'xlsx' | 'csv' }
  /** a company's data for the card-index drawers */
  | { type: 'browse'; requestId: number; company: CompanyId; workbook: Workbook | null; lang: Locale };

export type ArchiveResponse =
  | { type: 'file'; requestId: number; file: Blob }
  | { type: 'inspected'; requestId: number; ok: true; workbook: Workbook; report: ImportReport }
  | { type: 'inspected'; requestId: number; ok: false; failure: ReadFailure }
  /** `workbook`: the sanitised workbook (template sheets and known columns only), the one to keep */
  | { type: 'built'; requestId: number; ok: true; workbook: Workbook; bundle: SeedBundle; profile: ProfileId; report: ImportReport; companyName: string }
  | { type: 'built'; requestId: number; ok: false; report: ImportReport }
  | { type: 'browsed'; requestId: number; book: BrowseBook }
  /** an unexpected exception while handling the request */
  | { type: 'failed'; requestId: number; detail: string };
