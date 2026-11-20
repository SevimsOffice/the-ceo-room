/** Test fixtures: template workbooks built from rows keyed by column (the template's own headers). */
import { loadSeed } from '@ceo-room/seed-data';
import { type Cell, type SheetName, type Workbook, exportTemplate } from '../src/index';

export type SheetRows = Partial<Record<SheetName, Record<string, Cell>[]>>;

/** An empty template (tr labels) with the given data rows appended from row 4. */
export function makeWorkbook(data: SheetRows): Workbook {
  const wb = exportTemplate(loadSeed(), { lang: 'tr', example: false });
  for (const [name, rows] of Object.entries(data) as [SheetName, Record<string, Cell>[]][]) {
    const keys = wb[name]![0]!.map(String);
    for (const r of rows) wb[name]!.push(keys.map((k) => r[k] ?? null));
  }
  return wb;
}

/** Deep copy (workbooks are plain data). */
export function clone(wb: Workbook): Workbook {
  return JSON.parse(JSON.stringify(wb)) as Workbook;
}

/** Set one cell by sheet, Excel row and column key. */
export function setCell(wb: Workbook, sheet: SheetName, row: number, key: string, value: Cell): Workbook {
  const col = wb[sheet]![0]!.indexOf(key);
  if (col < 0) throw new Error(`no column ${key} in ${sheet}`);
  const r = wb[sheet]![row - 1]!;
  while (r.length <= col) r.push(null);
  r[col] = value;
  return wb;
}

export const REAL_SNAPSHOT = '2027-01-31';

/**
 * A small real-looking company (fictitious): one plant with two lines, two products, two materials,
 * three customers, two suppliers. Several optional cells are blank on purpose (defaults reported).
 */
export const REAL_COMPANY: SheetRows = {
  Settings: [{ company_name: 'Örnek Makina A.Ş.', snapshot_date: REAL_SNAPSHOT, currency: 'TRY', city: 'Konya', labour_cost_per_line_hour: 1450, energy_cost_per_line_hour: 210, max_overtime_hours_per_line_day: 3 }],
  Plants: [{ plant_id: 'P1', name: 'Konya OSB', headcount: 60, product_ids: 'VLV-10, PMP-20' }],
  Capacity: [
    { line_id: 'L1', plant_id: 'P1', line_type: 'machining', shifts_per_day: 2, hours_per_shift: 8 },
    { line_id: 'L2', plant_id: 'P1', line_type: 'Kaynak robotu', shifts_per_day: 1, hours_per_shift: 8, status: 'running' },
  ],
  Products: [
    { product_id: 'VLV-10', name: 'Vana gövdesi', unit_price: 1250.5, minutes_per_unit: 30 },
    { product_id: 'PMP-20', name: 'Pompa', unit_price: '4 800', minutes_per_unit: 75 },
  ],
  BOM: [
    { product_id: 'VLV-10', material_id: 'SAC', qty_per_unit: 12 },
    { product_id: 'VLV-10', material_id: 'CNT', qty_per_unit: 2 },
    { product_id: 'PMP-20', material_id: 'SAC', qty_per_unit: 40 },
    { product_id: 'PMP-20', material_id: 'CNT', qty_per_unit: 6 },
  ],
  Materials: [
    { material_id: 'SAC', name: 'Sac levha', unit: 'kg', stock_qty: 20000, stock_value: 760000, safety_stock: 5000, reorder_lot_size: 1000, preferred_supplier_id: 'S1' },
    { material_id: 'CNT', name: 'Conta seti', unit: 'set', stock_qty: 3000, stock_value: 135000, reorder_lot_size: 100, preferred_supplier_id: 'S2' },
  ],
  Suppliers: [
    { supplier_id: 'S1', name: 'Anadolu Çelik A.Ş.', country: 'TR', payment_terms_days: 30, deposit_pct: 0, on_time_delivery_pct: 96, established: true, onboarding_days: 0 },
    { supplier_id: 'S2', name: 'Ege Conta Ltd.', country: 'tr', payment_terms_days: 45 },
  ],
  SupplierPrices: [
    { supplier_id: 'S1', material_id: 'SAC', unit_price: 38, lead_time_days: 7 },
    { supplier_id: 'S2', material_id: 'CNT', unit_price: 45, lead_time_days: 10 },
    { supplier_id: 'S1', material_id: 'CNT', unit_price: 47, lead_time_days: 14 },
  ],
  Customers: [
    { customer_id: 'C-001', name: 'Konya Tarım Makinaları A.Ş.', country: 'TR', segment: 'agri', key_account: 'EVET', payment_terms_days: 60, avg_payment_delay_days: 10, discount_pct: 0, annual_revenue: 24000000, satisfaction_score: 80, churn_risk_pct: 8 },
    { customer_id: 'C-002', name: 'Mersin Liman İşletmeleri A.Ş.', country: 'TR', segment: 'cranes', key_account: false, payment_terms_days: 90 },
    { customer_id: 'C-003', name: 'Bavaria Pumpen GmbH', country: 'DE', segment: 'Export', key_account: 'FALSE', payment_terms_days: 45, avg_payment_delay_days: 5, discount_pct: 2, annual_revenue: '9000000' },
  ],
  Demand: [{ customer_id: 'C-001', product_id: 'VLV-10', qty_min: 300, qty_max: 400, interval_days: 30, lead_days: 45, next_order_date: '2027-02-10' }],
  OpenOrders: [
    { order_id: 'SO-1', customer_id: 'C-001', product_id: 'VLV-10', plant_id: 'P1', qty: 400, unit_price: 1250.5, order_date: '2027-01-10', requested_date: '2027-02-20', status: 'in_production', units_done: 120 },
    { order_id: 'SO-2', customer_id: 'C-002', product_id: 'PMP-20', plant_id: 'P1', qty: 80, unit_price: 4800, order_date: '20.01.2027', requested_date: '2027-03-15' },
    { order_id: 'SO-3', customer_id: 'C-003', product_id: 'PMP-20', plant_id: 'P1', qty: 50, unit_price: 4704, list_unit_price: 4800, order_date: 46412, requested_date: '2027-03-01', status: 'scheduled' },
  ],
  OpenPurchaseOrders: [{ po_id: 'PO-1', supplier_id: 'S1', material_id: 'SAC', qty: 10000, unit_price: 38, order_date: '2027-01-28', due_date: '2027-02-04' }],
  Receivables: [
    { receivable_id: 'R-1', customer_id: 'C-001', amount: 450000, invoice_date: '2026-12-15', due_date: '2027-02-13' },
    { receivable_id: 'R-2', customer_id: 'C-002', amount: 300000, invoice_date: '2026-11-20', due_date: '2027-01-19' },
  ],
  Payables: [{ payable_id: 'B-1', supplier_id: 'S1', amount: 220000, due_date: '2027-02-10' }],
  Cash: [
    { account: 'Banka A TL', balance: 1850000 },
    { account: 'Kasa', balance: 15000 },
  ],
  FixedCosts: [
    { cost_id: 'F1', kind: 'payroll', amount: 0, every_days: 30, next_due_date: '2027-02-05' },
    { cost_id: 'F2', kind: 'other', amount: 180000, every_days: 30, next_due_date: '2027-02-10' },
    { cost_id: 'F3', kind: 'utilities', amount: 40000, every_days: 30, next_due_date: '2027-02-20' },
    { cost_id: 'F4', kind: 'debt_service', amount: 95000, every_days: 30, next_due_date: '2027-02-25' },
  ],
  Workforce: [
    { department: 'operations', headcount: 48, avg_monthly_cost_per_head: 52000, monthly_turnover_pct: 1.5 },
    { department: 'sales', headcount: 6, avg_monthly_cost_per_head: 70000 },
    { department: 'finance', headcount: 4, avg_monthly_cost_per_head: 75000, monthly_turnover_pct: 0.8 },
  ],
  History: [
    { period_end: '2026-12-31', revenue: 1900000, cogs: 1450000 },
    { period_end: '2026-11-30', revenue: 1750000, cogs: 1380000, avg_satisfaction: 78, overtime_person_hours: 300, closing_cash: 2100000 },
  ],
};

export function realCompany(): Workbook {
  return makeWorkbook(REAL_COMPANY);
}
