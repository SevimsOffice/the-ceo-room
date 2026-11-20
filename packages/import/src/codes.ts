/**
 * Every i18n code the import package uses, with its params: issue codes (report.ts) and the
 * template's texts (sheet / column labels and descriptions, units, README). The completeness test
 * checks the tr and en catalogues against this list in both directions.
 */
import { ISSUE_CODES } from './report';
import { README_LINES } from './export';
import { TEMPLATE, UNIT_CODES } from './template';

export interface ImportCodeSpec {
  code: string;
  params: readonly string[];
  kind: 'issue' | 'template' | 'severity';
}

export const SEVERITY_CODES = ['import.severity.error', 'import.severity.warning', 'import.severity.info'] as const;

const README_CODES = [
  'import.readme.title',
  'import.readme.example',
  'import.readme.sheet',
  'import.readme.column',
  'import.readme.label',
  'import.readme.unit',
  'import.readme.required',
  'import.readme.description',
  'import.readme.severity',
  'import.readme.cell',
  'import.readme.message',
  'import.readme.value',
  'import.readme.yes',
  'import.readme.no',
  'import.template.requiredMark',
  'import.example.cashAccount',
];

/** Sorted, unique list of the import package's i18n codes. */
export function listImportCodes(): ImportCodeSpec[] {
  const out = new Map<string, ImportCodeSpec>();
  const add = (code: string, params: readonly string[], kind: ImportCodeSpec['kind']): void => {
    if (!out.has(code)) out.set(code, { code, params, kind });
  };
  for (const [code, params] of Object.entries(ISSUE_CODES)) add(code, params, 'issue');
  for (const code of SEVERITY_CODES) add(code, [], 'severity');
  for (const s of TEMPLATE.sheets) {
    add(s.labelKey, [], 'template');
    add(s.descriptionKey, [], 'template');
    for (const c of s.columns) {
      add(c.labelKey, [], 'template');
      add(c.descriptionKey, [], 'template');
    }
  }
  for (const u of UNIT_CODES) add(`import.unit.${u}`, [], 'template');
  for (let i = 1; i <= README_LINES; i++) add(`import.readme.line${i}`, [], 'template');
  for (const code of README_CODES) add(code, [], 'template');
  return [...out.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
