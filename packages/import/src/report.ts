/**
 * Import report (docs/DATA_IMPORT_DESIGN.md §3): every finding has a severity, an i18n code
 * (`import.*`, tr + en), the cell as Excel users see it (sheet, 1-based row, column key + letter),
 * the offending value (never for privacy hits) and the message params.
 */
import type { Cell } from './workbook';

export type Severity = 'error' | 'warning' | 'info';
export type IssueParams = Record<string, string | number | boolean>;

export interface ImportIssue {
  severity: Severity;
  code: string;
  /** sheet name, null for workbook-level findings */
  sheet: string | null;
  /** Excel row number (1-based; data starts at row 4), null for sheet-level findings */
  row: number | null;
  /** column key (row 1), null when the finding is about a whole row or sheet */
  column: string | null;
  /** Excel column letter of `column` (A, B, …), null when the column is absent */
  columnLetter: string | null;
  /** the cell value as read; omitted for privacy findings so personal data is never echoed */
  value?: Cell;
  params: IssueParams;
}

export interface ImportSummary {
  errors: number;
  warnings: number;
  info: number;
  /** data rows read per template sheet */
  rows: Record<string, number>;
}

export interface ImportReport {
  templateVersion: number | null;
  /** effective snapshot date (Day 1), null when missing or invalid */
  snapshotDate: string | null;
  summary: ImportSummary;
  issues: ImportIssue[];
}

/**
 * Every issue code the import can report, with its params (the catalogue completeness test checks
 * tr and en against this list). Codes are grouped by validation level.
 */
export const ISSUE_CODES = {
  // structure
  'import.structure.notTemplate': [],
  'import.structure.version': ['expected', 'found'],
  'import.structure.missingSheet': [],
  'import.structure.unknownSheet': [],
  'import.structure.missingColumn': [],
  'import.structure.duplicateColumn': [],
  'import.structure.unknownColumn': [],
  'import.structure.tooManyRows': ['max', 'rows'],
  'import.structure.tooFewRows': ['min'],
  'import.structure.singleRow': [],
  // field
  'import.field.required': [],
  'import.field.notNumber': [],
  'import.field.notInteger': [],
  'import.field.negative': [],
  'import.field.outOfRange': ['min', 'max'],
  'import.field.notDate': [],
  'import.field.notBoolean': [],
  'import.field.notCountry': [],
  'import.field.enum': ['allowed'],
  'import.field.tooLong': ['max'],
  'import.field.duplicate': [],
  'import.field.rounded': ['decimals'],
  // privacy guard
  'import.privacy.tckn': [],
  'import.privacy.iban': [],
  'import.privacy.email': [],
  'import.privacy.phone': [],
  'import.privacy.personColumn': [],
  // cross-sheet and business rules
  'import.fk.missing': ['target'],
  'import.bom.missing': [],
  'import.bom.duplicate': [],
  'import.supplierPrice.duplicate': [],
  'import.supplierPrice.missing': ['supplierId', 'materialId'],
  'import.product.noPlant': [],
  'import.plant.noLine': [],
  'import.capacity.tooManyHours': ['hours'],
  'import.capacity.repairPast': [],
  'import.capacity.overloaded': ['plantId', 'loadPct', 'days'],
  'import.order.plantProduct': ['plantId', 'productId'],
  'import.order.progress': [],
  'import.order.overdue': [],
  'import.demand.qtyRange': [],
  'import.date.afterSnapshot': [],
  'import.date.invoiceAfterSnapshot': [],
  'import.date.overdue': [],
  'import.date.beforeSnapshot': [],
  'import.stockValue.implausible': ['expected', 'deviationPct'],
  'import.cash.negative': ['total'],
  'import.receivables.high': ['receivables', 'annualRevenue'],
  'import.fixedCost.noPayroll': [],
  'import.fixedCost.payrollAmountIgnored': [],
  'import.settings.snapshotOverride': ['sheet', 'option'],
  'import.profile.mismatch': ['detail'],
  // defaults applied (info)
  'import.default.applied': ['default'],
  'import.default.estimated': ['default'],
  'import.default.derived': ['source'],
  'import.default.columnAbsent': ['default'],
  'import.default.sheetAbsent': [],
} as const satisfies Record<string, readonly string[]>;

export type IssueCode = keyof typeof ISSUE_CODES;

export class IssueList {
  readonly issues: ImportIssue[] = [];

  add(severity: Severity, code: IssueCode, at: Partial<Omit<ImportIssue, 'severity' | 'code' | 'params'>> = {}, params: IssueParams = {}): void {
    const issue: ImportIssue = {
      severity,
      code,
      sheet: at.sheet ?? null,
      row: at.row ?? null,
      column: at.column ?? null,
      columnLetter: at.columnLetter ?? null,
      params,
    };
    if (at.value !== undefined) issue.value = at.value;
    this.issues.push(issue);
  }

  error(code: IssueCode, at?: Partial<ImportIssue>, params?: IssueParams): void {
    this.add('error', code, at, params);
  }

  warning(code: IssueCode, at?: Partial<ImportIssue>, params?: IssueParams): void {
    this.add('warning', code, at, params);
  }

  info(code: IssueCode, at?: Partial<ImportIssue>, params?: IssueParams): void {
    this.add('info', code, at, params);
  }

  count(sev: Severity): number {
    return this.issues.filter((i) => i.severity === sev).length;
  }
}

/** True when the report has no errors (warnings and info do not block an import). */
export function canImport(report: ImportReport): boolean {
  return report.summary.errors === 0;
}

/** Excel-style cell reference of an issue (`OpenOrders!C7`), or the sheet/workbook when coarser. */
export function cellRef(i: Pick<ImportIssue, 'sheet' | 'row' | 'columnLetter'>): string {
  if (i.sheet === null) return '';
  if (i.row === null) return i.columnLetter ? `${i.sheet}!${i.columnLetter}:${i.columnLetter}` : i.sheet;
  return `${i.sheet}!${i.columnLetter ?? 'A'}${i.row}`;
}
