/**
 * The Excel template (docs/DATA_IMPORT_DESIGN.md §2), version TEMPLATE_VERSION. One sheet per entity
 * plus README. Row 1 = column keys (fixed machine names), row 2 = labels (tr/en), row 3 = units,
 * data from row 4. Sheet names and keys never change with the language; only rows 2–3 and README do.
 */

export const TEMPLATE_VERSION = 1;
/** README!A1 holds this marker and README!B1 the template version. */
export const TEMPLATE_MARKER = 'ceo_room_template_version';
/** Excel row (1-based) of the first data row. */
export const FIRST_DATA_ROW = 4;
export const MAX_ROWS_PER_SHEET = 5000;
export const MAX_TEXT_LENGTH = 120;
/** Day-1 date used when exporting the simulated sample (it has none): a Monday, like its Day 1. */
export const SAMPLE_SNAPSHOT_DATE = '2027-01-04';

export type ColumnType =
  /** company's own code, text */
  | 'id'
  | 'text'
  | 'int'
  | 'money'
  /** percent, 8 = 8% → basis points */
  | 'percent'
  /** 0–100 with up to 2 decimals → Score (hundredths) */
  | 'score'
  | 'date'
  | 'bool'
  | 'enum'
  /** ISO 3166 alpha-2 */
  | 'country'
  /** comma-separated ids */
  | 'idList';

export type UnitCode =
  | 'try'
  | 'tryPerHour'
  | 'tryPerUnit'
  | 'pct'
  | 'score'
  | 'days'
  | 'date'
  | 'hours'
  | 'minutes'
  | 'qty'
  | 'people'
  | 'personHours'
  | 'bool'
  | 'id'
  | 'idList'
  | 'text'
  | 'choice'
  | 'country';

export type SheetName =
  | 'Settings'
  | 'Plants'
  | 'Capacity'
  | 'Products'
  | 'BOM'
  | 'Materials'
  | 'Suppliers'
  | 'SupplierPrices'
  | 'Customers'
  | 'Demand'
  | 'OpenOrders'
  | 'OpenPurchaseOrders'
  | 'Receivables'
  | 'Payables'
  | 'Cash'
  | 'FixedCosts'
  | 'Workforce'
  | 'History';

export interface ColumnSpec {
  key: string;
  type: ColumnType;
  required: boolean;
  unit: UnitCode;
  /** allowed values (enum), lower case */
  values?: readonly string[];
  min?: number;
  max?: number;
  /** money that may be negative (cash, closing cash) */
  signed?: boolean;
  /** values must be unique in the sheet (ids) */
  unique?: boolean;
  /** foreign key: the value (or each id of an idList) must exist in this sheet's id column */
  ref?: SheetName;
  /** i18n keys of the label (row 2) and of the description (README) */
  labelKey: string;
  descriptionKey: string;
}

export interface SheetSpec {
  name: SheetName;
  /** a workbook without this sheet is rejected; optional sheets may be left out entirely */
  required: boolean;
  /** minimum data rows (Settings: exactly one) */
  minRows: number;
  single?: boolean;
  /** the id column other sheets refer to */
  idColumn?: string;
  columns: ColumnSpec[];
  labelKey: string;
  descriptionKey: string;
}

type ColOpts = Partial<Omit<ColumnSpec, 'key' | 'type' | 'unit'>> & { label?: string; description?: string };

/** Column keys share labels across sheets (`import.col.<key>`); a few carry a sheet-specific text. */
function col(key: string, type: ColumnType, unit: UnitCode, opts: ColOpts = {}): ColumnSpec {
  const { label, description, ...rest } = opts;
  return {
    key,
    type,
    unit,
    required: false,
    ...rest,
    labelKey: `import.col.${label ?? key}`,
    descriptionKey: `import.col.${description ?? label ?? key}.desc`,
  };
}

const R = { required: true } as const;
const id = (key: string, opts: ColOpts = {}): ColumnSpec => col(key, 'id', 'id', { required: true, ...opts });
const pk = (key: string): ColumnSpec => id(key, { unique: true });
const fk = (key: string, ref: SheetName, opts: ColOpts = {}): ColumnSpec => id(key, { ref, ...opts });
const int = (key: string, unit: UnitCode, opts: ColOpts = {}): ColumnSpec => col(key, 'int', unit, { min: 0, ...opts });
const money = (key: string, unit: UnitCode = 'try', opts: ColOpts = {}): ColumnSpec => col(key, 'money', unit, opts);
const pct = (key: string, opts: ColOpts = {}): ColumnSpec => col(key, 'percent', 'pct', { min: 0, max: 100, ...opts });
const date = (key: string, opts: ColOpts = {}): ColumnSpec => col(key, 'date', 'date', opts);
const text = (key: string, opts: ColOpts = {}): ColumnSpec => col(key, 'text', 'text', opts);
const choice = (key: string, values: readonly string[], opts: ColOpts = {}): ColumnSpec => col(key, 'enum', 'choice', { values, ...opts });

export const DEPARTMENTS = ['sales', 'operations', 'procurement', 'finance', 'people', 'cx'] as const;
/** Customer segments with an i18n label (`segment.<value>`); `general` for anything else. */
export const SEGMENTS = ['automotive', 'rail', 'energy', 'agri', 'construction', 'cranes', 'export', 'appliances', 'general'] as const;
/** Line types with an i18n label (`line.<value>`); any other text is kept as a plain label. */
export const LINE_TYPES = ['cutting', 'welding', 'press', 'machining', 'assembly', 'paint'] as const;
export const ORDER_STATUSES = ['scheduled', 'in_production'] as const;
export const LINE_STATUSES = ['running', 'down'] as const;
export const COST_KINDS = ['payroll', 'payroll_tax', 'overhead', 'utilities', 'debt_service', 'other'] as const;
export const MATERIAL_UNITS = ['kg', 'pcs', 'set'] as const;
export const CURRENCIES = ['TRY'] as const;

function sheet(name: SheetName, required: boolean, minRows: number, columns: ColumnSpec[], extra: Partial<SheetSpec> = {}): SheetSpec {
  return { name, required, minRows, columns, labelKey: `import.sheet.${name}`, descriptionKey: `import.sheet.${name}.desc`, ...extra };
}

export const TEMPLATE: { version: number; sheets: readonly SheetSpec[] } = {
  version: TEMPLATE_VERSION,
  sheets: [
    sheet(
      'Settings',
      true,
      1,
      [
        text('company_name', R),
        date('snapshot_date', R),
        choice('currency', CURRENCIES, R),
        text('city', R),
        money('labour_cost_per_line_hour', 'tryPerHour', R),
        money('energy_cost_per_line_hour', 'tryPerHour'),
        money('overtime_rate_per_person_hour', 'tryPerHour'),
        int('max_overtime_hours_per_line_day', 'hours', { max: 12 }),
        int('overtime_crew_per_line', 'people', { min: 1, max: 100 }),
        int('mrp_cover_days', 'days', { min: 1, max: 365 }),
      ],
      { single: true },
    ),
    sheet(
      'Plants',
      true,
      1,
      [pk('plant_id'), text('name', { ...R, label: 'plant_name' }), text('city'), int('headcount', 'people', R), col('product_ids', 'idList', 'idList', { ...R, ref: 'Products' })],
      { idColumn: 'plant_id' },
    ),
    sheet(
      'Capacity',
      true,
      1,
      [
        pk('line_id'),
        fk('plant_id', 'Plants'),
        text('line_type', R),
        int('shifts_per_day', 'qty', { ...R, min: 1, max: 3 }),
        int('hours_per_shift', 'hours', { ...R, min: 1, max: 12 }),
        choice('status', LINE_STATUSES, { label: 'line_status' }),
        date('repair_due_date'),
      ],
      { idColumn: 'line_id' },
    ),
    sheet(
      'Products',
      true,
      1,
      [pk('product_id'), text('name', { ...R, label: 'product_name' }), money('unit_price', 'tryPerUnit', { ...R, label: 'list_price' }), int('minutes_per_unit', 'minutes', { ...R, min: 1 })],
      { idColumn: 'product_id' },
    ),
    sheet('BOM', true, 1, [fk('product_id', 'Products'), fk('material_id', 'Materials'), int('qty_per_unit', 'qty', { ...R, min: 1 })]),
    sheet(
      'Materials',
      true,
      1,
      [
        pk('material_id'),
        text('name', { ...R, label: 'material_name' }),
        choice('unit', MATERIAL_UNITS, R),
        int('stock_qty', 'qty', R),
        money('stock_value', 'try', R),
        int('safety_stock', 'qty'),
        int('reorder_lot_size', 'qty', { min: 1 }),
        fk('preferred_supplier_id', 'Suppliers'),
      ],
      { idColumn: 'material_id' },
    ),
    sheet(
      'Suppliers',
      true,
      1,
      [
        pk('supplier_id'),
        text('name', { ...R, label: 'supplier_name' }),
        col('country', 'country', 'country', R),
        int('payment_terms_days', 'days', { ...R, max: 365, label: 'supplier_terms' }),
        pct('deposit_pct'),
        pct('on_time_delivery_pct'),
        col('established', 'bool', 'bool'),
        int('onboarding_days', 'days', { max: 365 }),
      ],
      { idColumn: 'supplier_id' },
    ),
    sheet('SupplierPrices', true, 1, [
      fk('supplier_id', 'Suppliers'),
      fk('material_id', 'Materials'),
      money('unit_price', 'tryPerUnit', { ...R, label: 'supplier_price' }),
      int('lead_time_days', 'days', { ...R, max: 365 }),
    ]),
    sheet(
      'Customers',
      true,
      1,
      [
        pk('customer_id'),
        text('name', { ...R, label: 'customer_name' }),
        col('country', 'country', 'country', R),
        choice('segment', SEGMENTS),
        col('key_account', 'bool', 'bool'),
        int('payment_terms_days', 'days', { ...R, max: 365, label: 'customer_terms' }),
        int('avg_payment_delay_days', 'days', { max: 365 }),
        pct('discount_pct'),
        money('annual_revenue'),
        col('satisfaction_score', 'score', 'score', { min: 0, max: 100 }),
        pct('churn_risk_pct'),
      ],
      { idColumn: 'customer_id' },
    ),
    sheet('Demand', false, 0, [
      fk('customer_id', 'Customers', { unique: true }),
      fk('product_id', 'Products'),
      int('qty_min', 'qty', { ...R, min: 1 }),
      int('qty_max', 'qty', { ...R, min: 1 }),
      int('interval_days', 'days', { ...R, min: 1, max: 365 }),
      int('lead_days', 'days', { ...R, max: 365 }),
      date('next_order_date', R),
    ]),
    sheet(
      'OpenOrders',
      true,
      0,
      [
        pk('order_id'),
        fk('customer_id', 'Customers'),
        fk('product_id', 'Products'),
        fk('plant_id', 'Plants'),
        int('qty', 'qty', { ...R, min: 1 }),
        money('unit_price', 'tryPerUnit', { ...R, label: 'order_price' }),
        money('list_unit_price', 'tryPerUnit'),
        date('order_date', R),
        date('requested_date', R),
        date('promised_date'),
        int('payment_terms_days', 'days', { max: 365, label: 'order_terms' }),
        choice('status', ORDER_STATUSES, { label: 'order_status' }),
        int('units_done', 'qty'),
        int('minutes_done', 'minutes'),
        money('material_cost_to_date'),
        money('energy_cost_to_date'),
      ],
      { idColumn: 'order_id' },
    ),
    sheet(
      'OpenPurchaseOrders',
      false,
      0,
      [
        pk('po_id'),
        fk('supplier_id', 'Suppliers'),
        fk('material_id', 'Materials'),
        int('qty', 'qty', { ...R, min: 1, label: 'po_qty' }),
        money('unit_price', 'tryPerUnit', { ...R, label: 'po_price' }),
        date('order_date', { ...R, label: 'po_date' }),
        date('due_date', { ...R, label: 'po_due_date' }),
        money('deposit'),
        int('payment_terms_days', 'days', { max: 365, label: 'po_terms' }),
        fk('for_order_id', 'OpenOrders', { required: false }),
      ],
      { idColumn: 'po_id' },
    ),
    sheet('Receivables', false, 0, [
      pk('receivable_id'),
      fk('customer_id', 'Customers'),
      money('amount', 'try', R),
      date('invoice_date', R),
      date('due_date', R),
      date('expected_payment_date'),
    ]),
    sheet('Payables', false, 0, [pk('payable_id'), fk('supplier_id', 'Suppliers'), money('amount', 'try', R), date('due_date', R)]),
    sheet('Cash', true, 1, [text('account', R), money('balance', 'try', { ...R, signed: true })]),
    sheet('FixedCosts', true, 0, [
      pk('cost_id'),
      choice('kind', COST_KINDS, R),
      money('amount', 'try', { ...R, label: 'cost_amount' }),
      int('every_days', 'days', { ...R, min: 1, max: 366 }),
      date('next_due_date', R),
    ]),
    sheet('Workforce', true, 1, [
      choice('department', DEPARTMENTS, { ...R, unique: true }),
      int('headcount', 'people', { ...R, label: 'dept_headcount' }),
      money('avg_monthly_cost_per_head', 'try', R),
      pct('monthly_turnover_pct'),
    ]),
    sheet('History', false, 0, [
      date('period_end', { ...R, unique: true }),
      money('revenue', 'try', R),
      money('cogs', 'try', R),
      col('avg_satisfaction', 'score', 'score', { min: 0, max: 100 }),
      int('overtime_person_hours', 'personHours'),
      money('closing_cash', 'try', { signed: true }),
    ]),
  ],
};

export const SHEET_NAMES: readonly SheetName[] = TEMPLATE.sheets.map((s) => s.name);

export function sheetSpec(name: SheetName): SheetSpec {
  const s = TEMPLATE.sheets.find((x) => x.name === name);
  if (!s) throw new Error(`unknown template sheet ${name}`);
  return s;
}

export const UNIT_CODES: readonly UnitCode[] = [
  'try',
  'tryPerHour',
  'tryPerUnit',
  'pct',
  'score',
  'days',
  'date',
  'hours',
  'minutes',
  'qty',
  'people',
  'personHours',
  'bool',
  'id',
  'idList',
  'text',
  'choice',
  'country',
];
