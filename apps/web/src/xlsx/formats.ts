/**
 * Which cells of an .xlsx are formatted as percentages. The xlsx library returns a cell shown as
 * "95 %" as its stored value 0.95; the template wants 95. Read from the workbook's own parts
 * (workbook.xml, its relationships, styles.xml and each sheet), with plain pattern matching: only
 * cell addresses and style numbers are read, never cell values.
 */
import { type ZipEntry, readZipEntry } from './zip';

/** Built-in number formats that are percentages (0% and 0.00%). */
const BUILT_IN_PERCENT = new Set([9, 10]);

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[2] ?? m[3] ?? '';
  return out;
};

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** A custom format code shows a percentage when it has a `%` outside quotes, escapes and [brackets]. */
export function isPercentFormatCode(code: string): boolean {
  return /%/.test(code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, ''));
}

/** "B4" → [row 3, column 1] (0-based). */
export function cellAddress(ref: string): [number, number] | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

const resolve = (base: string, target: string): string => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
};

/**
 * Sheet name → addresses ([row, column], 0-based) of numeric cells with a percent format. Empty when
 * the parts cannot be read (the validator's warning then catches fractions in percent columns).
 */
export async function percentCells(bytes: Uint8Array, entries: readonly ZipEntry[]): Promise<Map<string, [number, number][]>> {
  const out = new Map<string, [number, number][]>();
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    const b = e ? await readZipEntry(bytes, e) : null;
    return b ? new TextDecoder().decode(b) : null;
  };
  const wbPath = 'xl/workbook.xml';
  const [workbook, rels] = await Promise.all([text(wbPath), text('xl/_rels/workbook.xml.rels')]);
  if (!workbook || !rels) return out;
  const targets = new Map<string, { type: string; path: string }>();
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) targets.set(a.Id, { type: a.Type ?? '', path: resolve(wbPath, a.Target) });
  }
  const stylesPath = [...targets.values()].find((t) => t.type.endsWith('/styles'))?.path ?? 'xl/styles.xml';
  const styles = await text(stylesPath);
  if (!styles) return out;

  const customPercent = new Set<number>();
  for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.numFmtId !== undefined && a.formatCode !== undefined && isPercentFormatCode(unescapeXml(a.formatCode))) customPercent.add(Number(a.numFmtId));
  }
  const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles)?.[1] ?? '';
  const percentStyles = new Set<number>();
  let i = 0;
  for (const m of xfs.matchAll(/<(?:\w+:)?xf\b[^>]*>/g)) {
    const id = Number(attrs(m[0]).numFmtId ?? 0);
    if (BUILT_IN_PERCENT.has(id) || customPercent.has(id)) percentStyles.add(i);
    i += 1;
  }
  if (percentStyles.size === 0) return out;

  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a['r:id'] ?? Object.entries(a).find(([k]) => k.endsWith(':id'))?.[1];
    const target = rid ? targets.get(rid) : undefined;
    if (!a.name || !target) continue;
    const sheet = await text(target.path);
    if (!sheet) continue;
    const cells: [number, number][] = [];
    for (const c of sheet.matchAll(/<(?:\w+:)?c\b([^>]*)>/g)) {
      const ca = attrs(c[1]!);
      if (ca.s === undefined || !percentStyles.has(Number(ca.s))) continue;
      if (ca.t !== undefined && ca.t !== 'n') continue;
      const at = ca.r ? cellAddress(ca.r) : null;
      if (at) cells.push(at);
    }
    if (cells.length) out.set(unescapeXml(a.name), cells);
  }
  return out;
}

/** A fraction shown as a percentage → the percentage (0.95 → 95), by moving the decimal point (no float error). */
export function fractionToPercent(n: number): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(n));
  if (!m) return n;
  let digits = (m[2] ?? '') + (m[3] ?? '');
  let point = (m[2] ?? '').length + Number(m[4] ?? 0) + 2;
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const int = digits.slice(0, point) || '0';
  const frac = digits.slice(point);
  return Number(`${m[1]}${int}${frac ? `.${frac}` : ''}`);
}
