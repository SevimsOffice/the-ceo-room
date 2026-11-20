/**
 * Validated workbook → SeedBundle (docs/DATA_IMPORT_DESIGN.md §4). Units are already engine units
 * after parsing (kuruş, bps, Score); dates become SimDays with Day 1 = the snapshot date. Records
 * are built with the same key order as the seed files so states hash identically.
 */
import {
  type CompanyDataSource,
  type Customer,
  type EventCard,
  type Material,
  type Money,
  type Payable,
  type PeriodClose,
  type ProductFamily,
  type ProductionLine,
  type PurchaseOrder,
  type Receivable,
  type RecurringCost,
  type SeedBundle,
  type SeedCompany,
  type SeedOrder,
  type Supplier,
  type WorkforceRow,
  type WorkspaceId,
  dateToSimDay,
  money,
  validateSeedBundle,
} from '@ceo-room/engine';
import type { BundleWithoutCards, ImportProfile } from './profiles';
import { type ImportReport, IssueList } from './report';
import { LINE_TYPES } from './template';
import { type ParsedRow, type ValidateOptions, analyseWorkbook } from './validate';
import type { Workbook } from './workbook';

export interface ToSeedBundleOptions extends ValidateOptions {
  workspaceId: WorkspaceId;
  profile: ImportProfile;
}

export type ImportResult = { ok: true; bundle: SeedBundle; report: ImportReport } | { ok: false; report: ImportReport };

const str = (r: ParsedRow, k: string): string => {
  const v = r.values[k];
  if (typeof v !== 'string') throw new Error(`import: ${k} at row ${r.row} is not text`);
  return v;
};
const optStr = (r: ParsedRow, k: string): string | null => (typeof r.values[k] === 'string' ? (r.values[k] as string) : null);
const num = (r: ParsedRow, k: string): number => {
  const v = r.values[k];
  if (typeof v !== 'number') throw new Error(`import: ${k} at row ${r.row} is not a number`);
  return v;
};
const optNum = (r: ParsedRow, k: string): number | null => (typeof r.values[k] === 'number' ? (r.values[k] as number) : null);
const kurus = (r: ParsedRow, k: string): Money => money(num(r, k));
const bool = (r: ParsedRow, k: string): boolean => r.values[k] === true;
const list = (r: ParsedRow, k: string): string[] => (Array.isArray(r.values[k]) ? [...(r.values[k] as string[])] : []);

/**
 * Build the SeedBundle of a workbook: validate (same report as validateWorkbook), and only when it has
 * no errors convert it with the profile. The bundle is checked with the engine's seed validator; a
 * profile that does not fit the data (e.g. NOVARA's storyline on another company) is reported as
 * `import.profile.mismatch`.
 */
export function toSeedBundle(wb: Workbook, opts: ToSeedBundleOptions): ImportResult {
  const a = analyseWorkbook(wb, opts);
  if (a.report.summary.errors > 0 || a.snapshotDate === null) return { ok: false, report: a.report };
  const snap = a.snapshotDate;
  const day = (iso: string): number => dateToSimDay(snap, iso);
  const ws = opts.workspaceId;
  const p = opts.profile;
  const S = a.sheets;
  const settingsRow = S.Settings.rows[0]!;

  const company: SeedCompany = {
    workspaceId: ws,
    id: p.company.id,
    nameKey: p.company.nameKey ?? 'company.imported',
    ...(p.company.nameKey === null ? { name: str(settingsRow, 'company_name') } : {}),
    city: str(settingsRow, 'city'),
    currency: str(settingsRow, 'currency'),
    simulated: p.company.simulated,
    seedVersion: p.company.seedVersion,
    source: 'import',
    snapshotDate: snap,
  };
  const settings = {
    periodLengthDays: p.settings.periodLengthDays,
    runwayHorizonDays: p.settings.runwayHorizonDays,
    labourCostPerLineHour: kurus(settingsRow, 'labour_cost_per_line_hour'),
    energyCostPerLineHour: kurus(settingsRow, 'energy_cost_per_line_hour'),
    overtimeCrewPerLine: num(settingsRow, 'overtime_crew_per_line'),
    overtimeRatePerPersonHour: kurus(settingsRow, 'overtime_rate_per_person_hour'),
    maxOvertimeHoursPerLineDay: num(settingsRow, 'max_overtime_hours_per_line_day'),
    mrpCoverDays: num(settingsRow, 'mrp_cover_days'),
    turnoverBpsPerOvertimeHourPerHead: p.settings.turnoverBpsPerOvertimeHourPerHead,
  };

  const plants = S.Plants.rows.map((r) => ({
    workspaceId: ws,
    id: str(r, 'plant_id'),
    name: str(r, 'name'),
    city: str(r, 'city'),
    headcount: num(r, 'headcount'),
    productFamilies: list(r, 'product_ids'),
  }));
  const lines: ProductionLine[] = S.Capacity.rows.map((r) => {
    const type = str(r, 'line_type');
    const known = (LINE_TYPES as readonly string[]).find((t) => t === type.toLowerCase());
    const down = str(r, 'status') === 'down';
    const repair = optStr(r, 'repair_due_date');
    return {
      workspaceId: ws,
      id: str(r, 'line_id'),
      plantId: str(r, 'plant_id'),
      kindKey: known ? `line.${known}` : 'line.imported',
      ...(known ? {} : { kindName: type }),
      shiftsPerDay: num(r, 'shifts_per_day'),
      hoursPerShift: num(r, 'hours_per_shift'),
      status: down ? 'down' : 'running',
      repairDueDay: down && repair !== null ? day(repair) : null,
    };
  });
  const productFamilies: ProductFamily[] = S.Products.rows.map((r) => {
    const id = str(r, 'product_id');
    const key = p.labelKeys.productFamilies[id];
    return {
      workspaceId: ws,
      id,
      nameKey: key ?? 'product.imported',
      ...(key ? {} : { name: str(r, 'name') }),
      unitPrice: kurus(r, 'unit_price'),
      minutesPerUnit: num(r, 'minutes_per_unit'),
      bom: S.BOM.rows.filter((b) => str(b, 'product_id') === id).map((b) => ({ materialId: str(b, 'material_id'), qtyPerUnit: num(b, 'qty_per_unit') })),
    };
  });
  const materials: Material[] = S.Materials.rows.map((r) => {
    const id = str(r, 'material_id');
    const key = p.labelKeys.materials[id];
    return {
      workspaceId: ws,
      id,
      nameKey: key ?? 'material.imported',
      ...(key ? {} : { name: str(r, 'name') }),
      unit: str(r, 'unit') as Material['unit'],
      stockQty: num(r, 'stock_qty'),
      stockValue: kurus(r, 'stock_value'),
      safetyStock: num(r, 'safety_stock'),
      lotSize: num(r, 'reorder_lot_size'),
      preferredSupplierId: str(r, 'preferred_supplier_id'),
    };
  });
  const suppliers: Supplier[] = S.Suppliers.rows.map((r) => {
    const id = str(r, 'supplier_id');
    return {
      workspaceId: ws,
      id,
      name: str(r, 'name'),
      country: str(r, 'country'),
      offers: S.SupplierPrices.rows
        .filter((o) => str(o, 'supplier_id') === id)
        .map((o) => ({ materialId: str(o, 'material_id'), unitPrice: kurus(o, 'unit_price'), leadTimeDays: num(o, 'lead_time_days') })),
      paymentTermsDays: num(r, 'payment_terms_days'),
      depositBps: num(r, 'deposit_pct'),
      reliabilityBps: num(r, 'on_time_delivery_pct'),
      onboardingDays: num(r, 'onboarding_days'),
      established: bool(r, 'established'),
      firstDeliveryDay: null,
    };
  });
  const demand = new Map(S.Demand.rows.map((r) => [str(r, 'customer_id'), r]));
  const customers: Customer[] = S.Customers.rows.map((r) => {
    const id = str(r, 'customer_id');
    const d = demand.get(id);
    return {
      workspaceId: ws,
      id,
      name: str(r, 'name'),
      segmentKey: `segment.${str(r, 'segment')}`,
      country: str(r, 'country'),
      key: bool(r, 'key_account'),
      paymentTermsDays: num(r, 'payment_terms_days'),
      paymentDelayDays: num(r, 'avg_payment_delay_days'),
      satisfaction: num(r, 'satisfaction_score'),
      churnRisk: num(r, 'churn_risk_pct'),
      discountBps: num(r, 'discount_pct'),
      annualRevenue: kurus(r, 'annual_revenue'),
      status: 'active',
      demand: d
        ? {
            familyId: str(d, 'product_id'),
            qtyMin: num(d, 'qty_min'),
            qtyMax: num(d, 'qty_max'),
            cadenceDays: num(d, 'interval_days'),
            leadDays: num(d, 'lead_days'),
            nextOrderDay: day(str(d, 'next_order_date')),
          }
        : null,
    };
  });
  const salesOrders: SeedOrder[] = S.OpenOrders.rows.map((r) => {
    const qty = num(r, 'qty');
    const unitPrice = kurus(r, 'unit_price');
    const list = optNum(r, 'list_unit_price');
    return {
      workspaceId: ws,
      id: str(r, 'order_id'),
      customerId: str(r, 'customer_id'),
      familyId: str(r, 'product_id'),
      plantId: str(r, 'plant_id'),
      qty,
      unitPrice,
      value: money(unitPrice * qty),
      paymentTermsDays: num(r, 'payment_terms_days'),
      receivedDay: day(str(r, 'order_date')),
      requestedDay: day(str(r, 'requested_date')),
      promisedDay: day(str(r, 'promised_date')),
      status: str(r, 'status') as SeedOrder['status'],
      minutesDone: num(r, 'minutes_done'),
      unitsDone: num(r, 'units_done'),
      materialCost: kurus(r, 'material_cost_to_date'),
      energyCost: kurus(r, 'energy_cost_to_date'),
      costEstimate: money(0),
      blockedBy: null,
      shippedDay: null,
      source: 'seed',
      plan: null,
      // last, as the engine appends it when absent (same key order either way)
      ...(list === null ? {} : { listUnitPrice: money(list) }),
    };
  });
  const purchaseOrders: PurchaseOrder[] = S.OpenPurchaseOrders.rows.map((r) => ({
    workspaceId: ws,
    id: str(r, 'po_id'),
    supplierId: str(r, 'supplier_id'),
    materialId: str(r, 'material_id'),
    qty: num(r, 'qty'),
    unitPrice: kurus(r, 'unit_price'),
    orderedDay: day(str(r, 'order_date')),
    dueDay: day(str(r, 'due_date')),
    delayDays: 0,
    deposit: kurus(r, 'deposit'),
    paymentTermsDays: num(r, 'payment_terms_days'),
    status: 'open',
    forOrderId: optStr(r, 'for_order_id'),
  }));
  const workforce: WorkforceRow[] = S.Workforce.rows.map((r) => ({
    workspaceId: ws,
    departmentId: str(r, 'department') as WorkforceRow['departmentId'],
    headcount: num(r, 'headcount'),
    baseTurnoverBps: num(r, 'monthly_turnover_pct'),
    avgMonthlyCost: kurus(r, 'avg_monthly_cost_per_head'),
  }));
  const receivables: Receivable[] = S.Receivables.rows.map((r) => ({
    workspaceId: ws,
    id: str(r, 'receivable_id'),
    source: 'opening',
    orderId: null,
    customerId: str(r, 'customer_id'),
    amount: kurus(r, 'amount'),
    issuedDay: day(str(r, 'invoice_date')),
    dueDay: day(str(r, 'due_date')),
    expectedPayDay: day(str(r, 'expected_payment_date')),
    status: 'open',
  }));
  const payables: Payable[] = S.Payables.rows.map((r) => ({
    workspaceId: ws,
    id: str(r, 'payable_id'),
    source: 'opening',
    poId: null,
    counterpartyId: str(r, 'supplier_id'),
    amount: kurus(r, 'amount'),
    dueDay: day(str(r, 'due_date')),
    status: 'open',
  }));
  const recurringCosts: RecurringCost[] = S.FixedCosts.rows.map((r) => {
    const kind = str(r, 'kind');
    return {
      workspaceId: ws,
      id: str(r, 'cost_id'),
      kind: (kind === 'other' ? 'overhead' : kind) as RecurringCost['kind'],
      amount: kurus(r, 'amount'),
      everyDays: num(r, 'every_days'),
      nextDueDay: day(str(r, 'next_due_date')),
    };
  });
  // History: the latest period ending on or before the snapshot is period 0, the one before -1, …
  const sorted = [...S.History.rows].sort((x, y) => (str(x, 'period_end') < str(y, 'period_end') ? -1 : 1));
  const history: PeriodClose[] = sorted.map((r, i) => {
    const closing = optNum(r, 'closing_cash');
    return {
      workspaceId: ws,
      period: i - (sorted.length - 1),
      revenue: kurus(r, 'revenue'),
      cogs: kurus(r, 'cogs'),
      avgSatisfaction: num(r, 'avg_satisfaction'),
      overtimePersonHours: num(r, 'overtime_person_hours'),
      closingCash: closing === null ? null : money(closing),
    };
  });
  const cash = money(S.Cash.rows.reduce((t, r) => t + num(r, 'balance'), 0));

  const withoutCards: BundleWithoutCards = {
    company: { company, settings },
    departments: p.departments().map((d) => ({ ...d, workspaceId: ws })),
    plants: { plants, lines },
    productFamilies,
    materials,
    suppliers,
    customers,
    orders: { salesOrders, purchaseOrders },
    workforce,
    finance: { workspaceId: ws, cash, receivables, payables, recurringCosts, history },
  };
  const eventCards: EventCard[] = p.eventCards(withoutCards).map((c) => ({ ...c, workspaceId: ws }));
  const bundle: SeedBundle = { ...withoutCards, eventCards };

  const check = validateSeedBundle(JSON.parse(JSON.stringify(bundle)));
  if (!check.ok) {
    const issues = new IssueList();
    for (const detail of check.errors) issues.error('import.profile.mismatch', {}, { detail });
    const all = [...a.report.issues, ...issues.issues];
    return { ok: false, report: { ...a.report, summary: { ...a.report.summary, errors: a.report.summary.errors + issues.issues.length }, issues: all } };
  }
  return { ok: true, bundle, report: a.report };
}

export class ImportFailedError extends Error {
  constructor(readonly report: ImportReport) {
    super(`import failed with ${report.summary.errors} error(s)`);
  }
}

/** `CompanyDataSource` (ADR-0006) over a template workbook; `load` rejects with ImportFailedError on errors. */
export class TemplateDataSource implements CompanyDataSource {
  constructor(
    private readonly wb: Workbook,
    private readonly opts: Omit<ToSeedBundleOptions, 'workspaceId'>,
  ) {}

  async load(workspaceId: WorkspaceId): Promise<SeedBundle> {
    const r = toSeedBundle(this.wb, { ...this.opts, workspaceId });
    if (!r.ok) throw new ImportFailedError(r.report);
    return r.bundle;
  }
}
