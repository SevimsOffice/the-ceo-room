/**
 * The workbook as it may be kept (docs/DATA_IMPORT_DESIGN.md §7): the template's sheets and known
 * columns only. Unknown sheets and columns, the label rows 2–3, README notes and anything typed
 * outside the template's columns are dropped; data rows keep their Excel row numbers and known
 * columns their letters, so validating the kept workbook points at the same cells as the file.
 */
import { FIRST_DATA_ROW, TEMPLATE, TEMPLATE_MARKER } from './template';
import { type Row, type Workbook, cellText } from './workbook';

const trim = (r: Row): Row => {
  const out = [...r];
  while (out.length && (out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
  return out;
};

export function sanitiseWorkbook(wb: Workbook): Workbook {
  const out: Workbook = {};
  const readme = wb.README?.[0];
  // README: the template marker and version only (what the validator reads)
  if (readme) out.README = [trim([cellText(readme[0]) === TEMPLATE_MARKER ? TEMPLATE_MARKER : null, readme[1] ?? null])];
  for (const spec of TEMPLATE.sheets) {
    const rows = wb[spec.name];
    if (!rows) continue;
    const keys = new Set(spec.columns.map((c) => c.key));
    const keep = new Map<number, string>();
    (rows[0] ?? []).forEach((h, i) => {
      const k = cellText(h)?.toLowerCase();
      if (k !== undefined && keys.has(k)) keep.set(i, k);
    });
    const width = keep.size ? Math.max(...keep.keys()) + 1 : 0;
    const pick = (r: Row | undefined): Row => trim(Array.from({ length: width }, (_, i) => (keep.has(i) ? (r?.[i] ?? null) : null)));
    const header = trim(Array.from({ length: width }, (_, i) => keep.get(i) ?? null));
    out[spec.name] = rows.map((r, i) => (i === 0 ? header : i < FIRST_DATA_ROW - 1 ? [] : pick(r)));
  }
  return out;
}
