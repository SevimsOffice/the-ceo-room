/**
 * Workbook validation in three levels (docs/DATA_IMPORT_DESIGN.md §3):
 * 1. structure (template version, sheets, columns, row limits),
 * 2. field (types, units, enums, dates, ranges, unique ids, privacy guard),
 * 3. cross-sheet and business rules (foreign keys, BOM, prices, dates vs snapshot, plausibility),
 * then defaults for blank optional cells, each reported as `info`.
 * Pure and deterministic: the same workbook always gives the same report and the same parsed rows.
 */
import { dateToSimDay, epochDayToIso, isIsoDate, isWorkday, isoToEpochDay, isoWeekdayIndex } from '@ceo-room/engine';
import { type ImportReport, type IssueCode, IssueList } from './report';
import { type PrivacyHit, isPersonalHeader, normaliseHeader, privacyHits } from './privacy';
import {
  type ColumnSpec,
  FIRST_DATA_ROW,
  MAX_ROWS_PER_SHEET,
  MAX_TEXT_LENGTH,
  type SheetName,
  type SheetSpec,
  TEMPLATE,
  TEMPLATE_MARKER,
  TEMPLATE_VERSION,
} from './template';
import {
  type Cell,
  type Row,
  type Workbook,
  cellText,
  columnLetter,
  decimalIsInteger,
  isBlank,
  isBlankRow,
  parseBoolCell,
  parseDateCell,
  parseDecimal,
  scaleDecimal,
} from './workbook';

/** A parsed cell: text/id/enum/country/date (ISO) → string, numbers → integer in engine units, idList → string[]. */
export type Value = string | number | boolean | string[] | null;

export interface ParsedRow {
  /** Excel row number */
  row: number;
  values: Record<string, Value>;
}

export interface ParsedSheet {
  spec: SheetSpec;
  present: boolean;
  /** column key → 0-based column index */
  columns: Map<string, number>;
  rows: ParsedRow[];
}

export interface Analysis {
  report: ImportReport;
  sheets: Record<SheetName, ParsedSheet>;
  snapshotDate: string | null;
}

export interface ValidateOptions {
  /** Day 1 of the import; overrides Settings.snapshot_date when given */
  snapshotDate?: string;
}

const NUMERIC = new Set(['int', 'money', 'percent', 'score', 'date']);
const MAX_INT = 1_000_000_000;

/** Fixed defaults of optional columns (engine units). `estimated` = a guess, not a fact of the company. */
const STATIC_DEFAULTS: Record<string, { value: Value; display: string | number | boolean; estimated?: boolean }> = {
  'Settings.energy_cost_per_line_hour': { value: 0, display: 0 },
  'Settings.max_overtime_hours_per_line_day': { value: 3, display: 3 },
  'Settings.overtime_crew_per_line': { value: 9, display: 9, estimated: true },
  'Settings.mrp_cover_days': { value: 14, display: 14 },
  'Capacity.status': { value: 'running', display: 'running' },
  'Materials.safety_stock': { value: 0, display: 0 },
  'Materials.reorder_lot_size': { value: 1, display: 1 },
  'Suppliers.deposit_pct': { value: 0, display: 0 },
  'Suppliers.on_time_delivery_pct': { value: 9500, display: 95, estimated: true },
  'Suppliers.established': { value: true, display: true },
  'Customers.segment': { value: 'general', display: 'general' },
  'Customers.key_account': { value: false, display: false },
  'Customers.avg_payment_delay_days': { value: 0, display: 0 },
  'Customers.discount_pct': { value: 0, display: 0 },
  'Customers.annual_revenue': { value: 0, display: 0 },
  'Customers.satisfaction_score': { value: 7500, display: 75, estimated: true },
  'Customers.churn_risk_pct': { value: 1000, display: 10, estimated: true },
  'OpenOrders.status': { value: 'scheduled', display: 'scheduled' },
  'OpenOrders.units_done': { value: 0, display: 0 },
  'OpenPurchaseOrders.deposit': { value: 0, display: 0 },
  'Workforce.monthly_turnover_pct': { value: 100, display: 1, estimated: true },
  'History.overtime_person_hours': { value: 0, display: 0 },
};

/** Defaults computed from other cells (filled during the cross-sheet pass). */
const DERIVED_DEFAULTS: Record<string, string> = {
  'Settings.overtime_rate_per_person_hour': 'Settings.labour_cost_per_line_hour',
  'Plants.city': 'Settings.city',
  'Suppliers.onboarding_days': 'Suppliers.established',
  'OpenOrders.promised_date': 'OpenOrders.requested_date',
  'OpenOrders.payment_terms_days': 'Customers.payment_terms_days',
  'OpenOrders.minutes_done': 'Products.minutes_per_unit',
  'OpenOrders.material_cost_to_date': 'BOM',
  'OpenOrders.energy_cost_to_date': 'Settings.energy_cost_per_line_hour',
  'OpenPurchaseOrders.payment_terms_days': 'Suppliers.payment_terms_days',
  'Receivables.expected_payment_date': 'Customers.avg_payment_delay_days',
  'History.avg_satisfaction': 'Customers.satisfaction_score',
};

/** Optional columns where blank simply means "none" (no default to report). */
const BLANK_MEANS_NONE = new Set(['OpenOrders.list_unit_price', 'OpenPurchaseOrders.for_order_id', 'Capacity.repair_due_date', 'History.closing_cash']);

/** Onboarding days assumed for a supplier not yet bought from (estimated). */
export const DEFAULT_ONBOARDING_DAYS = 7;

class Ctx {
  readonly issues = new IssueList();
  readonly sheets = {} as Record<SheetName, ParsedSheet>;

  constructor(readonly wb: Workbook) {}

  at(sheet: ParsedSheet, row: number | null, column: string | null, value?: Cell): { sheet: string; row: number | null; column: string | null; columnLetter: string | null; value?: Cell } {
    const idx = column === null ? undefined : sheet.columns.get(column);
    const out: { sheet: string; row: number | null; column: string | null; columnLetter: string | null; value?: Cell } = {
      sheet: sheet.spec.name,
      row,
      column,
      columnLetter: idx === undefined ? null : columnLetter(idx),
    };
    if (value !== undefined) out.value = value;
    return out;
  }

  raw(sheet: ParsedSheet, row: number, column: string): Cell {
    const idx = sheet.columns.get(column);
    if (idx === undefined) return null;
    return this.wb[sheet.spec.name]?.[row - 1]?.[idx] ?? null;
  }
}

// ---- level 1: structure -----------------------------------------------------------------------

function checkVersion(ctx: Ctx): number | null {
  const readme = ctx.wb.README;
  if (!readme) {
    ctx.issues.error('import.structure.notTemplate', { sheet: 'README' });
    return null;
  }
  const marker = cellText(readme[0]?.[0]);
  const raw = readme[0]?.[1] ?? null;
  const d = parseDecimal(raw);
  const found = d && decimalIsInteger(d) ? (scaleDecimal(d, 0)?.value ?? null) : null;
  if (marker !== TEMPLATE_MARKER || found !== TEMPLATE_VERSION) {
    ctx.issues.error('import.structure.version', { sheet: 'README', row: 1, column: null, columnLetter: 'B', value: raw }, { expected: TEMPLATE_VERSION, found: cellText(raw) ?? '' });
  }
  return found;
}

function readHeader(ctx: Ctx, spec: SheetSpec, rows: Row[]): ParsedSheet {
  const sheet: ParsedSheet = { spec, present: true, columns: new Map(), rows: [] };
  const header = rows[0] ?? [];
  const known = new Set(spec.columns.map((c) => c.key));
  header.forEach((h, i) => {
    const text = cellText(h);
    if (text === null) return;
    const key = text.toLowerCase();
    const letter = columnLetter(i);
    if (known.has(key)) {
      if (sheet.columns.has(key)) ctx.issues.error('import.structure.duplicateColumn', { sheet: spec.name, row: 1, column: key, columnLetter: letter });
      else sheet.columns.set(key, i);
      return;
    }
    // Workforce holds department totals only: any extra column may carry person-level data.
    if (spec.name === 'Workforce' || isPersonalHeader(text)) {
      ctx.issues.error('import.privacy.personColumn', { sheet: spec.name, row: 1, column: normaliseHeader(text), columnLetter: letter });
    } else {
      ctx.issues.warning('import.structure.unknownColumn', { sheet: spec.name, row: 1, column: text, columnLetter: letter });
    }
  });
  for (const c of spec.columns) {
    if (!sheet.columns.has(c.key) && c.required) ctx.issues.error('import.structure.missingColumn', { sheet: spec.name, row: 1, column: c.key });
  }
  return sheet;
}

// ---- level 2: fields -------------------------------------------------------------------------

function parseCell(ctx: Ctx, sheet: ParsedSheet, row: number, c: ColumnSpec, raw: Cell): Value {
  const where = (): ReturnType<Ctx['at']> => ctx.at(sheet, row, c.key, raw);
  // money: only the sign is checked; ints, percents and scores also against [min, max] (in template units)
  const range = (v: number, scale: number): number | null => {
    if (c.signed) return v;
    if (v < 0) {
      ctx.issues.error('import.field.negative', where());
      return null;
    }
    if (c.type === 'money') return v;
    const min = c.min ?? 0;
    const max = c.max ?? MAX_INT;
    if (v < min * scale || v > max * scale) {
      ctx.issues.error('import.field.outOfRange', where(), { min, max });
      return null;
    }
    return v;
  };
  switch (c.type) {
    case 'id':
    case 'text': {
      const t = cellText(raw)!;
      if (t.length > MAX_TEXT_LENGTH) {
        ctx.issues.error('import.field.tooLong', where(), { max: MAX_TEXT_LENGTH });
        return null;
      }
      return t;
    }
    case 'int': {
      const d = parseDecimal(raw);
      if (!d) return fail(ctx, 'import.field.notNumber', where());
      if (!decimalIsInteger(d)) return fail(ctx, 'import.field.notInteger', where());
      const s = scaleDecimal(d, 0);
      if (!s) return fail(ctx, 'import.field.notNumber', where());
      return range(s.value, 1);
    }
    case 'money':
    case 'percent':
    case 'score': {
      const d = parseDecimal(raw);
      if (!d) return fail(ctx, 'import.field.notNumber', where());
      const s = scaleDecimal(d, 2);
      if (!s) return fail(ctx, 'import.field.notNumber', where());
      if (s.rounded) ctx.issues.info('import.field.rounded', where(), { decimals: 2 });
      return range(s.value, 100);
    }
    case 'date': {
      const iso = parseDateCell(raw);
      return iso ?? fail(ctx, 'import.field.notDate', where());
    }
    case 'bool': {
      const b = parseBoolCell(raw);
      return b ?? fail(ctx, 'import.field.notBoolean', where());
    }
    case 'enum': {
      const t = cellText(raw)!.toLowerCase();
      const hit = (c.values ?? []).find((v) => v.toLowerCase() === t);
      return hit ?? fail(ctx, 'import.field.enum', where(), { allowed: (c.values ?? []).join(', ') });
    }
    case 'country': {
      const t = cellText(raw)!.toUpperCase();
      return /^[A-Z]{2}$/.test(t) ? t : fail(ctx, 'import.field.notCountry', where());
    }
    case 'idList': {
      const ids = cellText(raw)!
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      return ids.length ? ids : fail(ctx, 'import.field.required', where());
    }
  }
}

function fail(ctx: Ctx, code: Parameters<IssueList['error']>[0], at: ReturnType<Ctx['at']>, params?: Record<string, string | number>): null {
  ctx.issues.error(code, at, params);
  return null;
}

function readRows(ctx: Ctx, sheet: ParsedSheet, rows: Row[]): void {
  const spec = sheet.spec;
  const unique = new Map<string, Set<string>>();
  for (let i = FIRST_DATA_ROW - 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlankRow(r)) continue;
    const excelRow = i + 1;
    const values: Record<string, Value> = {};
    for (const c of spec.columns) {
      const idx = sheet.columns.get(c.key);
      const raw = idx === undefined ? null : (r?.[idx] ?? null);
      if (isBlank(raw)) {
        values[c.key] = null;
        if (c.required && idx !== undefined) ctx.issues.error('import.field.required', ctx.at(sheet, excelRow, c.key));
        continue;
      }
      const v = parseCell(ctx, sheet, excelRow, c, raw);
      values[c.key] = v;
      if (c.unique && v !== null) {
        const seen = unique.get(c.key) ?? new Set<string>();
        const k = String(v);
        if (seen.has(k)) ctx.issues.error('import.field.duplicate', ctx.at(sheet, excelRow, c.key, raw));
        seen.add(k);
        unique.set(c.key, seen);
      }
    }
    sheet.rows.push({ row: excelRow, values });
  }
}

const PRIVACY_CODES: Record<PrivacyHit, IssueCode> = {
  tckn: 'import.privacy.tckn',
  iban: 'import.privacy.iban',
  email: 'import.privacy.email',
  phone: 'import.privacy.phone',
};

function scanPrivacy(ctx: Ctx): void {
  for (const [name, rows] of Object.entries(ctx.wb)) {
    const sheet = ctx.sheets[name as SheetName] as ParsedSheet | undefined;
    const typeAt = new Map<number, string>();
    if (sheet) for (const c of sheet.spec.columns) {
      const idx = sheet.columns.get(c.key);
      if (idx !== undefined) typeAt.set(idx, c.type);
    }
    // Template sheets: data rows only (rows 2–3 are our labels); other sheets and README: every row but README!A1:B1.
    const from = sheet ? FIRST_DATA_ROW - 1 : name === 'README' ? 1 : 0;
    for (let i = from; i < rows.length; i++) {
      (rows[i] ?? []).forEach((cell, j) => {
        if (isBlank(cell)) return;
        const type = typeAt.get(j);
        for (const hit of privacyHits(cell, type !== undefined && NUMERIC.has(type))) {
          const key = sheet ? ([...sheet.columns.entries()].find(([, x]) => x === j)?.[0] ?? null) : null;
          ctx.issues.error(PRIVACY_CODES[hit], { sheet: name, row: i + 1, column: key, columnLetter: columnLetter(j) });
        }
      });
    }
  }
}

// ---- level 3: cross-sheet ----------------------------------------------------------------------

const s = (r: ParsedRow, k: string): string | null => (typeof r.values[k] === 'string' ? (r.values[k] as string) : null);
const n = (r: ParsedRow, k: string): number | null => (typeof r.values[k] === 'number' ? (r.values[k] as number) : null);

function idsOf(sheet: ParsedSheet): Set<string> {
  const col = sheet.spec.idColumn;
  const out = new Set<string>();
  if (!col) return out;
  for (const r of sheet.rows) {
    const v = s(r, col);
    if (v !== null) out.add(v);
  }
  return out;
}

function crossChecks(ctx: Ctx, snapshot: string | null): void {
  const S = ctx.sheets;
  const ids = new Map<SheetName, Set<string>>();
  for (const sp of TEMPLATE.sheets) if (sp.idColumn) ids.set(sp.name, idsOf(S[sp.name]));
  // foreign keys
  for (const sp of TEMPLATE.sheets) {
    const sheet = S[sp.name];
    for (const c of sp.columns) {
      if (!c.ref) continue;
      const target = ids.get(c.ref) ?? new Set<string>();
      for (const r of sheet.rows) {
        const v = r.values[c.key];
        const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
        for (const x of list) {
          if (!target.has(x)) ctx.issues.error('import.fk.missing', ctx.at(sheet, r.row, c.key, x), { target: c.ref });
        }
      }
    }
  }
  const products = new Map(S.Products.rows.map((r) => [s(r, 'product_id'), r]));
  const suppliers = new Map(S.Suppliers.rows.map((r) => [s(r, 'supplier_id'), r]));
  const prices = new Map<string, number>();
  // BOM: one line per product × material, every product has one
  const bomSeen = new Set<string>();
  for (const r of S.BOM.rows) {
    const k = `${s(r, 'product_id')}\u0000${s(r, 'material_id')}`;
    if (bomSeen.has(k)) ctx.issues.error('import.bom.duplicate', ctx.at(S.BOM, r.row, 'material_id', s(r, 'material_id')));
    bomSeen.add(k);
  }
  const withBom = new Set(S.BOM.rows.map((r) => s(r, 'product_id')));
  for (const r of S.Products.rows) {
    if (!withBom.has(s(r, 'product_id'))) ctx.issues.error('import.bom.missing', ctx.at(S.Products, r.row, 'product_id', s(r, 'product_id')));
  }
  // supplier prices: unique per supplier × material; the preferred supplier quotes each material
  for (const r of S.SupplierPrices.rows) {
    const k = `${s(r, 'supplier_id')}\u0000${s(r, 'material_id')}`;
    if (prices.has(k)) ctx.issues.error('import.supplierPrice.duplicate', ctx.at(S.SupplierPrices, r.row, 'material_id', s(r, 'material_id')));
    else prices.set(k, n(r, 'unit_price') ?? 0);
  }
  for (const r of S.Materials.rows) {
    const sup = s(r, 'preferred_supplier_id');
    const mat = s(r, 'material_id');
    if (sup !== null && mat !== null && suppliers.has(sup) && !prices.has(`${sup}\u0000${mat}`)) {
      ctx.issues.error('import.supplierPrice.missing', ctx.at(S.Materials, r.row, 'preferred_supplier_id', sup), { supplierId: sup, materialId: mat });
    }
  }
  // plants, lines, products
  const linesByPlant = new Map<string, ParsedRow[]>();
  for (const r of S.Capacity.rows) {
    const p = s(r, 'plant_id');
    if (p !== null) linesByPlant.set(p, [...(linesByPlant.get(p) ?? []), r]);
    const shifts = n(r, 'shifts_per_day');
    const hours = n(r, 'hours_per_shift');
    if (shifts !== null && hours !== null && shifts * hours > 24) {
      ctx.issues.error('import.capacity.tooManyHours', ctx.at(S.Capacity, r.row, 'hours_per_shift', hours), { hours: shifts * hours });
    }
    const repair = s(r, 'repair_due_date');
    if (s(r, 'status') === 'down' && repair !== null && snapshot !== null && repair <= snapshot) {
      ctx.issues.warning('import.capacity.repairPast', ctx.at(S.Capacity, r.row, 'repair_due_date', repair));
    }
  }
  const madeIn = new Map<string, Set<string>>();
  for (const r of S.Plants.rows) {
    const plant = s(r, 'plant_id');
    const list = r.values.product_ids;
    if (plant === null || !Array.isArray(list)) continue;
    for (const p of list) madeIn.set(p, (madeIn.get(p) ?? new Set()).add(plant));
    if (list.length > 0 && !(linesByPlant.get(plant)?.length)) ctx.issues.error('import.plant.noLine', ctx.at(S.Plants, r.row, 'plant_id', plant));
  }
  for (const r of S.Products.rows) {
    const p = s(r, 'product_id');
    if (p !== null && !madeIn.has(p)) ctx.issues.error('import.product.noPlant', ctx.at(S.Products, r.row, 'product_id', p));
  }
  // dates against the snapshot
  const after = (sheet: ParsedSheet, r: ParsedRow, k: string): void => {
    const d = s(r, k);
    if (snapshot !== null && d !== null && d > snapshot) ctx.issues.error('import.date.afterSnapshot', ctx.at(sheet, r.row, k, d));
  };
  const overdue = (sheet: ParsedSheet, r: ParsedRow, k: string): void => {
    const d = s(r, k);
    if (snapshot !== null && d !== null && d < snapshot) ctx.issues.warning('import.date.overdue', ctx.at(sheet, r.row, k, d));
  };
  const notBefore = (sheet: ParsedSheet, r: ParsedRow, k: string): void => {
    const d = s(r, k);
    if (snapshot !== null && d !== null && d < snapshot) ctx.issues.warning('import.date.beforeSnapshot', ctx.at(sheet, r.row, k, d));
  };
  for (const r of S.OpenOrders.rows) {
    after(S.OpenOrders, r, 'order_date');
    const plant = s(r, 'plant_id');
    const product = s(r, 'product_id');
    if (plant !== null && product !== null && products.has(product) && madeIn.has(product) && !madeIn.get(product)!.has(plant)) {
      ctx.issues.error('import.order.plantProduct', ctx.at(S.OpenOrders, r.row, 'plant_id', plant), { plantId: plant, productId: product });
    }
    const qty = n(r, 'qty');
    const done = n(r, 'units_done');
    if (qty !== null && done !== null && done > qty) ctx.issues.error('import.order.progress', ctx.at(S.OpenOrders, r.row, 'units_done', done));
    const due = s(r, 'promised_date') ?? s(r, 'requested_date');
    if (snapshot !== null && due !== null && due < snapshot) {
      ctx.issues.warning('import.order.overdue', ctx.at(S.OpenOrders, r.row, s(r, 'promised_date') !== null ? 'promised_date' : 'requested_date', due));
    }
  }
  for (const r of S.OpenPurchaseOrders.rows) {
    after(S.OpenPurchaseOrders, r, 'order_date');
    overdue(S.OpenPurchaseOrders, r, 'due_date');
  }
  for (const r of S.Receivables.rows) {
    after(S.Receivables, r, 'invoice_date');
    overdue(S.Receivables, r, 'due_date');
  }
  for (const r of S.Payables.rows) overdue(S.Payables, r, 'due_date');
  for (const r of S.FixedCosts.rows) notBefore(S.FixedCosts, r, 'next_due_date');
  for (const r of S.History.rows) after(S.History, r, 'period_end');
  for (const r of S.Demand.rows) {
    notBefore(S.Demand, r, 'next_order_date');
    const lo = n(r, 'qty_min');
    const hi = n(r, 'qty_max');
    if (lo !== null && hi !== null && lo > hi) ctx.issues.error('import.demand.qtyRange', ctx.at(S.Demand, r.row, 'qty_max', hi));
  }
  // fixed costs: payroll comes from Workforce
  const payroll = S.FixedCosts.rows.filter((r) => s(r, 'kind') === 'payroll');
  if (S.FixedCosts.present && payroll.length === 0) ctx.issues.warning('import.fixedCost.noPayroll', { sheet: 'FixedCosts' });
  for (const r of payroll) if ((n(r, 'amount') ?? 0) !== 0) ctx.issues.info('import.fixedCost.payrollAmountIgnored', ctx.at(S.FixedCosts, r.row, 'amount', n(r, 'amount')));

  // plausibility (warnings)
  for (const r of S.Materials.rows) {
    const qty = n(r, 'stock_qty');
    const value = n(r, 'stock_value');
    const price = prices.get(`${s(r, 'preferred_supplier_id')}\u0000${s(r, 'material_id')}`);
    if (qty === null || value === null || price === undefined) continue;
    const expected = qty * price;
    if (expected > 0 && Math.abs(value - expected) * 2 > expected) {
      ctx.issues.warning('import.stockValue.implausible', ctx.at(S.Materials, r.row, 'stock_value', value / 100), {
        expected,
        deviationPct: Math.round((Math.abs(value - expected) * 100) / expected),
      });
    }
  }
  const cash = S.Cash.rows.reduce((t, r) => t + (n(r, 'balance') ?? 0), 0);
  if (S.Cash.rows.length > 0 && cash < 0) ctx.issues.warning('import.cash.negative', { sheet: 'Cash' }, { total: cash });
  const receivables = S.Receivables.rows.reduce((t, r) => t + (n(r, 'amount') ?? 0), 0);
  const annual = S.Customers.rows.reduce((t, r) => t + (n(r, 'annual_revenue') ?? 0), 0);
  if (annual > 0 && receivables > annual) ctx.issues.warning('import.receivables.high', { sheet: 'Receivables' }, { receivables, annualRevenue: annual });
  if (snapshot !== null) {
    const weekday = isoWeekdayIndex(snapshot);
    let workdays = 0;
    for (let d = 1; d <= CAPACITY_WINDOW_DAYS; d++) if (isWorkday(d, weekday)) workdays++;
    for (const plant of S.Plants.rows) {
      const id = s(plant, 'plant_id');
      if (id === null) continue;
      const perDay = (linesByPlant.get(id) ?? []).filter((l) => s(l, 'status') !== 'down').reduce((t, l) => t + (n(l, 'shifts_per_day') ?? 0) * (n(l, 'hours_per_shift') ?? 0) * 60, 0);
      const need = S.OpenOrders.rows
        .filter((o) => s(o, 'plant_id') === id)
        .reduce((t, o) => {
          const mpu = n(products.get(s(o, 'product_id')) ?? { row: 0, values: {} }, 'minutes_per_unit') ?? 0;
          return t + Math.max(0, (n(o, 'qty') ?? 0) * mpu - (n(o, 'minutes_done') ?? (n(o, 'units_done') ?? 0) * mpu));
        }, 0);
      const capacity = perDay * workdays;
      if (need > 0 && need * 100 > capacity * CAPACITY_WARN_PCT) {
        ctx.issues.warning('import.capacity.overloaded', ctx.at(S.Plants, plant.row, 'plant_id', id), {
          plantId: id,
          loadPct: capacity === 0 ? 999 : Math.round((need * 100) / capacity),
          days: CAPACITY_WINDOW_DAYS,
        });
      }
    }
  }
}

const CAPACITY_WINDOW_DAYS = 90;
const CAPACITY_WARN_PCT = 150;

// ---- defaults ----------------------------------------------------------------------------------

function applyDefaults(ctx: Ctx): void {
  const S = ctx.sheets;
  const settings = S.Settings.rows[0];
  const customers = new Map(S.Customers.rows.map((r) => [s(r, 'customer_id'), r]));
  const suppliers = new Map(S.Suppliers.rows.map((r) => [s(r, 'supplier_id'), r]));
  const products = new Map(S.Products.rows.map((r) => [s(r, 'product_id'), r]));
  const preferred = new Map(S.Materials.rows.map((r) => [s(r, 'material_id'), s(r, 'preferred_supplier_id')]));
  const prices = new Map(S.SupplierPrices.rows.map((r) => [`${s(r, 'supplier_id')}\u0000${s(r, 'material_id')}`, n(r, 'unit_price')]));
  const bom = new Map<string, ParsedRow[]>();
  for (const r of S.BOM.rows) bom.set(s(r, 'product_id') ?? '', [...(bom.get(s(r, 'product_id') ?? '') ?? []), r]);
  const avgSatisfaction = (): number | null => {
    const xs = S.Customers.rows.map((r) => n(r, 'satisfaction_score')).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null;
  };

  const derive = (sheet: SheetName, r: ParsedRow, key: string): Value => {
    switch (`${sheet}.${key}`) {
      case 'Settings.overtime_rate_per_person_hour': {
        const labour = n(r, 'labour_cost_per_line_hour');
        const crew = n(r, 'overtime_crew_per_line') ?? (STATIC_DEFAULTS['Settings.overtime_crew_per_line']!.value as number);
        return labour === null || crew === null || crew === 0 ? null : Math.round((labour * 3) / (2 * crew));
      }
      case 'Plants.city':
        return settings ? s(settings, 'city') : null;
      case 'Suppliers.onboarding_days':
        return r.values.established === false ? DEFAULT_ONBOARDING_DAYS : 0;
      case 'OpenOrders.promised_date':
        return s(r, 'requested_date');
      case 'OpenOrders.payment_terms_days': {
        const c = customers.get(s(r, 'customer_id'));
        return c ? n(c, 'payment_terms_days') : null;
      }
      case 'OpenOrders.minutes_done': {
        const p = products.get(s(r, 'product_id'));
        const done = n(r, 'units_done');
        return p && done !== null ? done * (n(p, 'minutes_per_unit') ?? 0) : null;
      }
      case 'OpenOrders.material_cost_to_date': {
        const done = n(r, 'units_done');
        if (done === null) return null;
        let perUnit = 0;
        for (const b of bom.get(s(r, 'product_id') ?? '') ?? []) {
          const m = s(b, 'material_id');
          perUnit += (n(b, 'qty_per_unit') ?? 0) * (prices.get(`${preferred.get(m)}\u0000${m}`) ?? 0);
        }
        return done * perUnit;
      }
      case 'OpenOrders.energy_cost_to_date': {
        const minutes = n(r, 'minutes_done');
        const rate = settings ? n(settings, 'energy_cost_per_line_hour') : null;
        return minutes === null || rate === null ? null : roundHalfEvenDiv(minutes * rate, 60);
      }
      case 'OpenPurchaseOrders.payment_terms_days': {
        const sup = suppliers.get(s(r, 'supplier_id'));
        return sup ? n(sup, 'payment_terms_days') : null;
      }
      case 'Receivables.expected_payment_date': {
        const due = s(r, 'due_date');
        const c = customers.get(s(r, 'customer_id'));
        return due === null || !c ? null : epochDayToIso(isoToEpochDay(due) + (n(c, 'avg_payment_delay_days') ?? 0));
      }
      case 'History.avg_satisfaction':
        return avgSatisfaction();
      default:
        return null;
    }
  };

  const failed = new Set(ctx.issues.issues.filter((i) => i.severity === 'error' && i.row !== null).map((i) => `${i.sheet}\u0000${i.row}`));
  // Order matters: Settings and Customers before the sheets deriving from them; units_done before minutes before energy.
  for (const sp of TEMPLATE.sheets) {
    const sheet = S[sp.name];
    if (!sheet.present) continue;
    for (const c of sp.columns) {
      if (c.required) continue;
      const k = `${sp.name}.${c.key}`;
      if (BLANK_MEANS_NONE.has(k)) continue;
      const fixed = STATIC_DEFAULTS[k];
      const derived = DERIVED_DEFAULTS[k];
      const absent = !sheet.columns.has(c.key);
      let reported = false;
      for (const r of sheet.rows) {
        if (r.values[c.key] !== null) continue;
        if (failed.has(`${sp.name}\u0000${r.row}`)) continue;
        if (fixed) r.values[c.key] = fixed.value;
        else if (derived) r.values[c.key] = derive(sp.name, r, c.key);
        if (absent) {
          if (!reported) {
            ctx.issues.info('import.default.columnAbsent', { sheet: sp.name, column: c.key }, { default: fixed ? fixed.display : (derived ?? '') });
            reported = true;
          }
        } else if (fixed) {
          ctx.issues.info(fixed.estimated ? 'import.default.estimated' : 'import.default.applied', ctx.at(sheet, r.row, c.key), { default: fixed.display });
        } else if (derived) {
          ctx.issues.info('import.default.derived', ctx.at(sheet, r.row, c.key), { source: derived });
        }
      }
    }
  }
}

function roundHalfEvenDiv(num: number, den: number): number {
  const q = Math.floor(num / den);
  const r = num - q * den;
  if (r * 2 > den) return q + 1;
  if (r * 2 < den) return q;
  return q % 2 === 0 ? q : q + 1;
}

// ---- entry points -----------------------------------------------------------------------------

/** Parse and check a workbook; the parsed rows (engine units, defaults filled) feed toSeedBundle. */
export function analyseWorkbook(wb: Workbook, opts: ValidateOptions = {}): Analysis {
  const ctx = new Ctx(wb);
  const templateVersion = checkVersion(ctx);
  const known = new Set<string>(['README', ...TEMPLATE.sheets.map((x) => x.name)]);
  for (const name of Object.keys(wb)) if (!known.has(name)) ctx.issues.warning('import.structure.unknownSheet', { sheet: name });
  for (const spec of TEMPLATE.sheets) {
    const rows = wb[spec.name];
    if (!rows) {
      if (spec.required) ctx.issues.error('import.structure.missingSheet', { sheet: spec.name });
      else ctx.issues.info('import.default.sheetAbsent', { sheet: spec.name });
      ctx.sheets[spec.name] = { spec, present: false, columns: new Map(), rows: [] };
      continue;
    }
    const sheet = readHeader(ctx, spec, rows);
    ctx.sheets[spec.name] = sheet;
    const dataRows = rows.slice(FIRST_DATA_ROW - 1).filter((r) => !isBlankRow(r)).length;
    if (dataRows > MAX_ROWS_PER_SHEET) {
      ctx.issues.error('import.structure.tooManyRows', { sheet: spec.name }, { max: MAX_ROWS_PER_SHEET, rows: dataRows });
      continue;
    }
    readRows(ctx, sheet, rows);
    if (sheet.rows.length < spec.minRows) ctx.issues.error('import.structure.tooFewRows', { sheet: spec.name, row: FIRST_DATA_ROW }, { min: spec.minRows });
    if (spec.single && sheet.rows.length > 1) ctx.issues.error('import.structure.singleRow', { sheet: spec.name, row: sheet.rows[1]!.row });
  }
  scanPrivacy(ctx);

  const settings = ctx.sheets.Settings.rows[0];
  const fromSheet = settings ? s(settings, 'snapshot_date') : null;
  let snapshotDate = fromSheet;
  if (opts.snapshotDate !== undefined) {
    if (!isIsoDate(opts.snapshotDate)) throw new RangeError(`snapshotDate must be YYYY-MM-DD, got ${opts.snapshotDate}`);
    if (fromSheet !== null && fromSheet !== opts.snapshotDate) {
      ctx.issues.info('import.settings.snapshotOverride', ctx.at(ctx.sheets.Settings, settings!.row, 'snapshot_date', fromSheet), { sheet: fromSheet, option: opts.snapshotDate });
    }
    snapshotDate = opts.snapshotDate;
  }

  // Cross-sheet rules need the sheets themselves; with structural errors they would only add noise.
  const structural = ctx.issues.issues.some((i) => i.severity === 'error' && i.code.startsWith('import.structure.'));
  if (!structural) {
    crossChecks(ctx, snapshotDate);
    applyDefaults(ctx);
  }

  const rows: Record<string, number> = {};
  for (const spec of TEMPLATE.sheets) if (ctx.sheets[spec.name].present) rows[spec.name] = ctx.sheets[spec.name].rows.length;
  const report: ImportReport = {
    templateVersion,
    snapshotDate,
    summary: { errors: ctx.issues.count('error'), warnings: ctx.issues.count('warning'), info: ctx.issues.count('info'), rows },
    issues: ctx.issues.issues,
  };
  return { report, sheets: ctx.sheets, snapshotDate };
}

/** Validate a workbook: the report in the design's JSON shape (errors block the import). */
export function validateWorkbook(wb: Workbook, opts: ValidateOptions = {}): ImportReport {
  return analyseWorkbook(wb, opts).report;
}

/** SimDay of an ISO date for a snapshot (Day 1 = snapshot date). */
export function simDayOf(snapshotDate: string, iso: string): number {
  return dateToSimDay(snapshotDate, iso);
}
