/**
 * The import report as printable rows (header + one row per issue), translated: for the CSV/XLSX
 * download of the inspection report. Columns: severity, cell, code, message, value.
 */
import { type Locale, createTranslator } from '@ceo-room/i18n';
import { type ImportReport, cellRef } from './report';
import type { Row } from './workbook';

export function reportRows(report: ImportReport, lang: Locale, currency = 'TRY'): Row[] {
  const t = createTranslator(lang, { currency });
  const rows: Row[] = [[t.t('import.readme.severity'), t.t('import.readme.cell'), 'code', t.t('import.readme.message'), t.t('import.readme.value')]];
  for (const i of report.issues) {
    rows.push([t.t(`import.severity.${i.severity}`), cellRef(i), i.code, t.t(i.code, i.params), i.value ?? null]);
  }
  return rows;
}
