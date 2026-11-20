/**
 * xlsx ⇄ the import package's neutral Workbook model (`Record<sheet, Cell[][]>`), for the Archive
 * Room's worker. Writing: write-excel-file; reading: read-excel-file (both MIT, maintained, fflate
 * based, no network). The "universal" builds are used: they need no DOM (DOMParser, document), so
 * they run in a Web Worker and in Node (tests) alike.
 *
 * Dates: ISO `YYYY-MM-DD` strings in the template's date columns are written as real Excel dates
 * (UTC midnight, shown as yyyy-mm-dd); any date cell read back becomes an ISO string again
 * (`YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SS` when it has a time). Everything else is written as it is.
 */
import writeXlsxFile from 'write-excel-file/universal';
import readXlsxFile from 'read-excel-file/universal';
import { type Cell, FIRST_DATA_ROW, type Row, TEMPLATE, type Workbook } from '@ceo-room/import';
import { MAX_CELLS, MAX_COLUMNS, MAX_FILE_BYTES, MAX_UNZIPPED_BYTES, type ReadFailure } from './limits';
import { fractionToPercent, percentCells } from './formats';
import { readZipDirectory, unzippedSize } from './zip';

export { MAX_CELLS, MAX_COLUMNS, MAX_FILE_BYTES, MAX_UNZIPPED_BYTES, XLSX_MIME, type ReadFailure } from './limits';

export class XlsxReadError extends Error {
  constructor(readonly code: ReadFailure, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'XlsxReadError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Column indexes holding dates, per template sheet. */
const DATE_COLUMNS: ReadonlyMap<string, ReadonlySet<number>> = new Map(
  TEMPLATE.sheets.map((s) => [s.name, new Set(s.columns.flatMap((c, i) => (c.type === 'date' ? [i] : [])))]),
);

function isoToUtcDate(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** A date cell as read (UTC) → ISO text. */
export function dateToIso(d: Date): string {
  const day = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  return h || mi || s ? `${day}T${pad(h)}:${pad(mi)}:${pad(s)}` : day;
}

type OutCell = { value: string | number | boolean | Date; type?: typeof String | typeof Number | typeof Boolean | typeof Date; format?: string; fontWeight?: 'bold'; fontStyle?: 'italic'; textColor?: string; backgroundColor?: string } | null;

function outCell(c: Cell | undefined, sheet: string, row: number, col: number): OutCell {
  if (c === null || c === undefined || c === '') return null;
  const header = TEMPLATE.sheets.some((s) => s.name === sheet) && row < FIRST_DATA_ROW - 1;
  const style = header ? (row === 0 ? { fontWeight: 'bold' as const, backgroundColor: '#E9DFC7' } : { fontStyle: 'italic' as const, textColor: '#5A4A36' }) : {};
  if (typeof c === 'string') {
    if (!header && ISO_DATE.test(c) && DATE_COLUMNS.get(sheet)?.has(col)) {
      const d = isoToUtcDate(c);
      if (d) return { value: d, type: Date, format: 'yyyy-mm-dd', ...style };
    }
    return { value: c, type: String, ...style };
  }
  if (typeof c === 'number') return { value: c, type: Number, ...style };
  return { value: c, type: Boolean, ...style };
}

/** Rough column widths (characters) from the longest text in the first rows. */
function widths(rows: Row[]): { width: number }[] {
  const n = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out: { width: number }[] = [];
  for (let i = 0; i < n; i++) {
    let w = 8;
    for (const r of rows.slice(0, 60)) w = Math.max(w, String(r[i] ?? '').length + 2);
    out.push({ width: Math.min(w, 60) });
  }
  return out;
}

/** The workbook as an .xlsx file (sheet order as in the object). */
export async function workbookToXlsx(wb: Workbook): Promise<Blob> {
  const sheets = Object.entries(wb).map(([name, rows]) => {
    // an empty row still needs a cell for the rows below it to keep their numbers
    const data = (rows.length ? rows : [[]]).map((r, ri) => {
      const cells = r.map((c, ci) => outCell(c, name, ri, ci));
      return cells.length ? cells : [null];
    });
    const template = TEMPLATE.sheets.some((s) => s.name === name);
    return { sheet: name, data, columns: widths(rows), ...(template ? { stickyRowsCount: FIRST_DATA_ROW - 1 } : {}) };
  });
  return writeXlsxFile(sheets as never, { fontFamily: 'Calibri', fontSize: 11 }).toBlob();
}

/** ZIP files start with "PK". */
const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;

/** Column indexes of the template's percent columns in a sheet, from its header row. */
function percentColumns(sheet: string, header: Row | undefined): Set<number> {
  const spec = TEMPLATE.sheets.find((s) => s.name === sheet);
  const out = new Set<number>();
  if (!spec || !header) return out;
  header.forEach((h, i) => {
    const key = typeof h === 'string' ? h.trim().toLowerCase() : null;
    if (key && spec.columns.some((c) => c.key === key && c.type === 'percent')) out.add(i);
  });
  return out;
}

/**
 * Read an .xlsx file into the neutral model. Throws XlsxReadError: `empty`, `tooLarge`, `notXlsx`
 * (not a zip: e.g. .xls, .csv, a picture), `corrupt` (a zip that is not a readable workbook),
 * `unzippedTooLarge` (the zip declares more than MAX_UNZIPPED_BYTES: refused before inflating),
 * `tooManyCells` (more than MAX_CELLS cells or MAX_COLUMNS columns in a sheet).
 *
 * Numbers formatted as percentages in the template's percent columns are read as shown (a cell
 * shown as 95 % is stored as 0.95 and becomes 95).
 */
export async function xlsxToWorkbook(input: ArrayBuffer | Uint8Array, limits: { cells: number; columns: number } = { cells: MAX_CELLS, columns: MAX_COLUMNS }): Promise<Workbook> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new XlsxReadError('empty');
  if (bytes.length > MAX_FILE_BYTES) throw new XlsxReadError('tooLarge');
  if (!isZip(bytes)) throw new XlsxReadError('notXlsx');
  const entries = readZipDirectory(bytes);
  if (!entries) throw new XlsxReadError('corrupt', 'no zip directory');
  if (unzippedSize(entries) > MAX_UNZIPPED_BYTES) throw new XlsxReadError('unzippedTooLarge');
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(bytes, { trim: false })) as { sheet: string; data: unknown[][] }[];
  } catch (err) {
    throw new XlsxReadError('corrupt', err instanceof Error ? err.message : String(err));
  }
  let cells = 0;
  for (const s of sheets) {
    for (const r of s.data) {
      if (r.length > limits.columns) throw new XlsxReadError('tooManyCells');
      cells += r.length;
    }
    if (cells > limits.cells) throw new XlsxReadError('tooManyCells');
  }
  const wb: Workbook = {};
  for (const s of sheets) {
    wb[s.sheet] = s.data.map((r) =>
      r.map((c): Cell => {
        if (c === null || c === undefined) return null;
        if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : dateToIso(c);
        if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return c;
        return String(c);
      }),
    );
  }
  const percent = await percentCells(bytes, entries).catch(() => new Map<string, [number, number][]>());
  for (const [sheet, at] of percent) {
    const rows = wb[sheet];
    const cols = percentColumns(sheet, rows?.[0]);
    if (!rows || cols.size === 0) continue;
    for (const [r, c] of at) {
      const v = rows[r]?.[c];
      if (r >= FIRST_DATA_ROW - 1 && cols.has(c) && typeof v === 'number') rows[r]![c] = fractionToPercent(v);
    }
  }
  return wb;
}

/** Trailing blank cells and rows dropped: how two workbooks are compared after a round trip. */
export function trimWorkbook(wb: Workbook): Workbook {
  const out: Workbook = {};
  for (const [name, rows] of Object.entries(wb)) {
    const trimmed = rows.map((r) => {
      const c = [...r];
      while (c.length && (c[c.length - 1] === null || c[c.length - 1] === '')) c.pop();
      return c;
    });
    while (trimmed.length && trimmed[trimmed.length - 1]!.length === 0) trimmed.pop();
    out[name] = trimmed;
  }
  return out;
}
