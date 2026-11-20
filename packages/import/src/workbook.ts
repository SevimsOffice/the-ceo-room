/**
 * Neutral workbook model and cell parsing. Any xlsx reader/writer can feed or print it: a workbook is
 * sheet name → rows → cells, with row 0 = Excel row 1 and column 0 = Excel column A. Cells are plain
 * values; dates are ISO `YYYY-MM-DD` strings (or Excel serial numbers / `DD.MM.YYYY` on input).
 * Pure: no host clock, no I/O, no floating-point money (decimal strings are scaled exactly).
 */
import { daysFromCivil, epochDayToIso, parseIsoDate } from '@ceo-room/engine';

export type Cell = string | number | boolean | null;
export type Row = Cell[];
export type Workbook = Record<string, Row[]>;

/** Excel column letter of a 0-based column index (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function isBlank(c: Cell | undefined): boolean {
  return c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
}

export function isBlankRow(r: Row | undefined): boolean {
  return !r || r.every((c) => isBlank(c));
}

/** Text of a cell (numbers as written, booleans as TRUE/FALSE); null when blank. */
export function cellText(c: Cell | undefined): string | null {
  if (isBlank(c)) return null;
  if (typeof c === 'string') return c.trim();
  if (typeof c === 'boolean') return c ? 'TRUE' : 'FALSE';
  return String(c);
}

// ---- numbers ------------------------------------------------------------------------------------

/** A decimal number as sign + digit strings, never through binary floating point. */
interface Decimal {
  negative: boolean;
  int: string;
  frac: string;
}

const GROUP_SPACES = /[\s\u00a0\u202f]/g;
const NUMBER_TEXT = /^([+-]?)(\d[\d.,]*)$/;

/** Digits grouped in threes by `sep` (1.250.000 or 1,250,000), the first group 1–3 digits. */
const grouped = (s: string, sep: string): boolean => new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`).test(s);

/** Expand a JS number's shortest decimal representation (handles exponent notation). */
function numberToDecimal(n: number): Decimal | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s);
  if (!m) return null;
  const negative = m[1] === '-';
  let digits = (m[2] ?? '') + (m[3] ?? '');
  let point = (m[2] ?? '').length + Number(m[4] ?? 0);
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length);
  return { negative, int: digits.slice(0, point) || '0', frac: digits.slice(point) };
}

/**
 * A number written as text, Turkish or English style, read only when unambiguous:
 * - spaces group digits anywhere (`1 250 000`);
 * - with both `.` and `,` the last one is the decimal separator and the other must group by threes
 *   (`41.200.000,00`, `1,250.50`);
 * - one kind repeated without a decimal part (`1.234.567`) is refused: write it with spaces, plain
 *   digits or a decimal part (`1.234.567,00`);
 * - one separator once is a decimal point (`1,25`, `1250,5`, `0.125`), except before exactly three
 *   digits after a 1–3 digit integer part (`1.250`, `12.500`, `250,000`): thousands or decimals?
 *   That is `'ambiguous'`.
 */
export function parseNumberText(text: string): Decimal | 'ambiguous' | null {
  const m = NUMBER_TEXT.exec(text.replace(GROUP_SPACES, ''));
  if (!m) return null;
  const negative = m[1] === '-';
  const body = m[2]!;
  const dot = body.lastIndexOf('.');
  const comma = body.lastIndexOf(',');
  const plain = (int: string, frac: string): Decimal | null => (/^\d+$/.test(int) && /^\d*$/.test(frac) ? { negative, int, frac } : null);
  if (dot < 0 && comma < 0) return plain(body, '');
  if (dot >= 0 && comma >= 0) {
    const decAt = Math.max(dot, comma);
    const group = dot > comma ? ',' : '.';
    const int = body.slice(0, decAt);
    const frac = body.slice(decAt + 1);
    if (!grouped(int, group) || !/^\d+$/.test(frac)) return null;
    return plain(int.split(group).join(''), frac);
  }
  const sep = dot >= 0 ? '.' : ',';
  const parts = body.split(sep);
  if (parts.length > 2) return null;
  const [int, frac] = parts as [string, string];
  if (frac.length === 0) return null;
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(int)) return 'ambiguous';
  return plain(int, frac);
}

/**
 * Parse a numeric cell: a number, or text as `parseNumberText` reads it (null when not a number or
 * ambiguous; the validator reports the ambiguous case on its own).
 */
export function parseDecimal(c: Cell | undefined): Decimal | null {
  if (typeof c === 'number') return numberToDecimal(c);
  if (typeof c !== 'string') return null;
  const d = parseNumberText(c);
  return d === 'ambiguous' ? null : d;
}

export interface Scaled {
  /** value × 10^scale, rounded half to even */
  value: number;
  /** true when digits beyond the scale were rounded away */
  rounded: boolean;
}

/** value × 10^scale as an integer, banker's rounding on the dropped digits (exact, string based). */
export function scaleDecimal(d: Decimal, scale: number): Scaled | null {
  const kept = d.frac.slice(0, scale).padEnd(scale, '0');
  const rest = d.frac.slice(scale);
  const digits = (d.int + kept).replace(/^0+(?=\d)/, '');
  let value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  const restNonZero = /[1-9]/.test(rest);
  if (restNonZero) {
    const first = rest.charCodeAt(0) - 48;
    const tail = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && (tail || value % 2 === 1))) value += 1;
  }
  if (!Number.isSafeInteger(value)) return null;
  return { value: d.negative && value !== 0 ? -value : value, rounded: restNonZero };
}

export function decimalIsInteger(d: Decimal): boolean {
  return !/[1-9]/.test(d.frac);
}

/** Integer kuruş → TRY as a JS number for the template (exact for any safe kuruş amount ÷ 100). */
export function kurusToTry(k: number): number {
  return k / 100;
}

/** Basis points / hundredths → percent or 0–100 score as a JS number. */
export function hundredthsToNumber(v: number): number {
  return v / 100;
}

// ---- dates --------------------------------------------------------------------------------------

/** Excel 1900 date system: serial 25569 = 1970-01-01; serials below 61 skip the fictitious 1900-02-29. */
const EXCEL_EPOCH_OFFSET = 25569;

/**
 * Parse a date cell to ISO: `YYYY-MM-DD` (optionally followed by a time), `DD.MM.YYYY`, or an
 * Excel serial number (time of day ignored). Years 1900–2199; null when not a real date.
 */
export function parseDateCell(c: Cell | undefined): string | null {
  if (typeof c === 'number') {
    if (!Number.isFinite(c) || c < 1) return null;
    const serial = Math.floor(c);
    const epochDay = serial < 61 ? serial - EXCEL_EPOCH_OFFSET + 1 : serial - EXCEL_EPOCH_OFFSET;
    const iso = epochDayToIso(epochDay);
    return inRange(iso) ? iso : null;
  }
  if (typeof c !== 'string') return null;
  const s = c.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ][0-9:.]+Z?)?$/.exec(s);
  if (iso) return parseIsoDate(iso[1]!) && inRange(iso[1]!) ? iso[1]! : null;
  const tr = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (tr) {
    const out = `${tr[3]}-${tr[2]!.padStart(2, '0')}-${tr[1]!.padStart(2, '0')}`;
    return parseIsoDate(out) && inRange(out) ? out : null;
  }
  return null;
}

function inRange(iso: string): boolean {
  const y = Number(iso.slice(0, 4));
  return y >= 1900 && y <= 2199;
}

/** Excel serial number of an ISO date (for writers that want real Excel dates). */
export function isoToExcelSerial(iso: string): number {
  const c = parseIsoDate(iso);
  if (!c) throw new RangeError(`invalid ISO date: ${iso}`);
  const epochDay = daysFromCivil(c.year, c.month, c.day);
  const serial = epochDay + EXCEL_EPOCH_OFFSET;
  return serial < 61 ? serial - 1 : serial;
}

// ---- booleans -----------------------------------------------------------------------------------

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'evet', 'e', 'doğru', 'dogru', 'x', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'hayır', 'hayir', 'h', 'yanlış', 'yanlis', 'yanliş', '0']);

/** TRUE/FALSE in English or Turkish (DOĞRU/YANLIŞ, EVET/HAYIR), 1/0, or a boolean cell. */
export function parseBoolCell(c: Cell | undefined): boolean | null {
  if (typeof c === 'boolean') return c;
  if (typeof c === 'number') return c === 1 ? true : c === 0 ? false : null;
  if (typeof c !== 'string') return null;
  // Turkish casing without a locale: dotless I → ı before lower-casing (HAYIR → hayır)
  const s = c.trim().replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  const ascii = c.trim().toLowerCase();
  if (TRUE_WORDS.has(s) || TRUE_WORDS.has(ascii)) return true;
  if (FALSE_WORDS.has(s) || FALSE_WORDS.has(ascii)) return false;
  return null;
}
