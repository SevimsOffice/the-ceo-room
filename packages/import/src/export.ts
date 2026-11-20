/**
 * Template export: the workbook rows of the Excel template, empty or filled with a company (the
 * downloadable example is NOVARA). Library-free: the UI writes the rows with any xlsx writer.
 * Money is printed in TRY (kuruş ÷ 100), percentages in percent, scores 0–100, dates as ISO strings.
 */
import { OPEN_ORDER_STATUSES, type SeedBundle, simDayToDate } from '@ceo-room/engine';
import { type Locale, createTranslator } from '@ceo-room/i18n';
import { LINE_TYPES, SAMPLE_SNAPSHOT_DATE, SEGMENTS, type SheetName, TEMPLATE, TEMPLATE_MARKER, TEMPLATE_VERSION } from './template';
import { type Cell, type Row, type Workbook, hundredthsToNumber, kurusToTry } from './workbook';

export interface ExportOptions {
  lang: Locale;
  /** true = fill the sheets with the given company; false = headers only */
  example: boolean;
  /** Day-1 date used for the dates (default: the company's snapshot date, else SAMPLE_SNAPSHOT_DATE) */
  snapshotDate?: string;
}

/** Number of README instruction lines (`import.readme.line1` …). */
export const README_LINES = 8;

type Rec = Record<string, Cell>;

/** README, then one sheet per template sheet in template order (row 1 keys, row 2 labels, row 3 units). */
export function exportTemplate(seed: SeedBundle, opts: ExportOptions): Workbook {
  const t = createTranslator(opts.lang);
  const wb: Workbook = { README: readme(t.t, opts.example) };
  const data = opts.example ? exampleRows(seed, opts, t.t) : null;
  for (const spec of TEMPLATE.sheets) {
    const keys: Row = spec.columns.map((c) => c.key);
    const labels: Row = spec.columns.map((c) => `${t.t(c.labelKey)}${c.required ? ` ${t.t('import.template.requiredMark')}` : ''}`);
    const units: Row = spec.columns.map((c) => t.t(`import.unit.${c.unit}`));
    const rows: Row[] = [keys, labels, units];
    for (const rec of data?.[spec.name] ?? []) rows.push(spec.columns.map((c) => rec[c.key] ?? null));
    wb[spec.name] = rows;
  }
  return wb;
}

function readme(t: (code: string) => string, example: boolean): Row[] {
  const rows: Row[] = [[TEMPLATE_MARKER, TEMPLATE_VERSION], [t('import.readme.title')], []];
  for (let i = 1; i <= README_LINES; i++) rows.push([t(`import.readme.line${i}`)]);
  if (example) rows.push([t('import.readme.example')]);
  rows.push([], [t('import.readme.sheet'), t('import.readme.required'), t('import.readme.description')]);
  for (const s of TEMPLATE.sheets) rows.push([s.name, t(s.required ? 'import.readme.yes' : 'import.readme.no'), t(s.descriptionKey)]);
  rows.push([], [t('import.readme.sheet'), t('import.readme.column'), t('import.readme.label'), t('import.readme.unit'), t('import.readme.required'), t('import.readme.description')]);
  for (const s of TEMPLATE.sheets) {
    for (const c of s.columns) {
      rows.push([s.name, c.key, t(c.labelKey), t(`import.unit.${c.unit}`), t(c.required ? 'import.readme.yes' : 'import.readme.no'), t(c.descriptionKey)]);
    }
  }
  return rows;
}

const tl = (k: number): number => kurusToTry(k);
const pct = (bps: number): number => hundredthsToNumber(bps);

function exampleRows(seed: SeedBundle, opts: ExportOptions, t: (code: string) => string): Record<SheetName, Rec[]> {
  const c = seed.company.company;
  const st = seed.company.settings;
  const snap = opts.snapshotDate ?? c.snapshotDate ?? SAMPLE_SNAPSHOT_DATE;
  const date = (day: number): string => simDayToDate(snap, day)!;
  const segment = (key: string): string => {
    const s = key.replace(/^segment\./, '');
    return (SEGMENTS as readonly string[]).includes(s) ? s : 'general';
  };
  const lineType = (kindKey: string, kindName: string | undefined): string => {
    if (kindName !== undefined) return kindName;
    const s = kindKey.replace(/^line\./, '');
    return (LINE_TYPES as readonly string[]).includes(s) ? s : t(kindKey);
  };
  const open = seed.orders.salesOrders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status));
  return {
    Settings: [
      {
        company_name: c.name ?? t(c.nameKey),
        snapshot_date: snap,
        currency: c.currency,
        city: c.city,
        labour_cost_per_line_hour: tl(st.labourCostPerLineHour),
        energy_cost_per_line_hour: tl(st.energyCostPerLineHour),
        overtime_rate_per_person_hour: tl(st.overtimeRatePerPersonHour),
        max_overtime_hours_per_line_day: st.maxOvertimeHoursPerLineDay,
        overtime_crew_per_line: st.overtimeCrewPerLine,
        mrp_cover_days: st.mrpCoverDays,
      },
    ],
    Plants: seed.plants.plants.map((p) => ({ plant_id: p.id, name: p.name, city: p.city, headcount: p.headcount, product_ids: p.productFamilies.join(', ') })),
    Capacity: seed.plants.lines.map((l) => ({
      line_id: l.id,
      plant_id: l.plantId,
      line_type: lineType(l.kindKey, l.kindName),
      shifts_per_day: l.shiftsPerDay,
      hours_per_shift: l.hoursPerShift,
      status: l.status,
      repair_due_date: l.status === 'down' && l.repairDueDay !== null ? date(l.repairDueDay) : null,
    })),
    Products: seed.productFamilies.map((f) => ({ product_id: f.id, name: f.name ?? t(f.nameKey), unit_price: tl(f.unitPrice), minutes_per_unit: f.minutesPerUnit })),
    BOM: seed.productFamilies.flatMap((f) => f.bom.map((b) => ({ product_id: f.id, material_id: b.materialId, qty_per_unit: b.qtyPerUnit }))),
    Materials: seed.materials.map((m) => ({
      material_id: m.id,
      name: m.name ?? t(m.nameKey),
      unit: m.unit,
      stock_qty: m.stockQty,
      stock_value: tl(m.stockValue),
      safety_stock: m.safetyStock,
      reorder_lot_size: m.lotSize,
      preferred_supplier_id: m.preferredSupplierId,
    })),
    Suppliers: seed.suppliers.map((s) => ({
      supplier_id: s.id,
      name: s.name,
      country: s.country,
      payment_terms_days: s.paymentTermsDays,
      deposit_pct: pct(s.depositBps),
      on_time_delivery_pct: pct(s.reliabilityBps),
      established: s.established,
      onboarding_days: s.onboardingDays,
    })),
    SupplierPrices: seed.suppliers.flatMap((s) =>
      s.offers.map((o) => ({ supplier_id: s.id, material_id: o.materialId, unit_price: tl(o.unitPrice), lead_time_days: o.leadTimeDays })),
    ),
    Customers: seed.customers.map((cu) => ({
      customer_id: cu.id,
      name: cu.name,
      country: cu.country,
      segment: segment(cu.segmentKey),
      key_account: cu.key,
      payment_terms_days: cu.paymentTermsDays,
      avg_payment_delay_days: cu.paymentDelayDays,
      discount_pct: pct(cu.discountBps),
      annual_revenue: tl(cu.annualRevenue),
      satisfaction_score: pct(cu.satisfaction),
      churn_risk_pct: pct(cu.churnRisk),
    })),
    Demand: seed.customers.flatMap((cu) =>
      cu.demand
        ? [
            {
              customer_id: cu.id,
              product_id: cu.demand.familyId,
              qty_min: cu.demand.qtyMin,
              qty_max: cu.demand.qtyMax,
              interval_days: cu.demand.cadenceDays,
              lead_days: cu.demand.leadDays,
              next_order_date: date(cu.demand.nextOrderDay),
            },
          ]
        : [],
    ),
    OpenOrders: open.map((o) => ({
      order_id: o.id,
      customer_id: o.customerId,
      product_id: o.familyId,
      plant_id: o.plantId,
      qty: o.qty,
      unit_price: tl(o.unitPrice),
      list_unit_price: o.listUnitPrice === undefined ? null : tl(o.listUnitPrice),
      order_date: date(o.receivedDay),
      requested_date: date(o.requestedDay),
      promised_date: date(o.promisedDay),
      payment_terms_days: o.paymentTermsDays,
      status: o.status === 'in_production' ? 'in_production' : 'scheduled',
      units_done: o.unitsDone,
      minutes_done: o.minutesDone,
      material_cost_to_date: tl(o.materialCost),
      energy_cost_to_date: tl(o.energyCost),
    })),
    OpenPurchaseOrders: seed.orders.purchaseOrders
      .filter((po) => po.status === 'open')
      .map((po) => ({
        po_id: po.id,
        supplier_id: po.supplierId,
        material_id: po.materialId,
        qty: po.qty,
        unit_price: tl(po.unitPrice),
        order_date: date(po.orderedDay),
        due_date: date(po.dueDay),
        deposit: tl(po.deposit),
        payment_terms_days: po.paymentTermsDays,
        for_order_id: po.forOrderId,
      })),
    Receivables: seed.finance.receivables
      .filter((r) => r.status === 'open')
      .map((r) => ({
        receivable_id: r.id,
        customer_id: r.customerId,
        amount: tl(r.amount),
        invoice_date: date(r.issuedDay),
        due_date: date(r.dueDay),
        expected_payment_date: date(r.expectedPayDay),
      })),
    Payables: seed.finance.payables
      .filter((p) => p.status === 'open')
      .map((p) => ({ payable_id: p.id, supplier_id: p.counterpartyId, amount: tl(p.amount), due_date: date(p.dueDay) })),
    Cash: [{ account: t('import.example.cashAccount'), balance: tl(seed.finance.cash) }],
    FixedCosts: seed.finance.recurringCosts.map((r) => ({
      cost_id: r.id,
      kind: r.kind,
      amount: tl(r.amount),
      every_days: r.everyDays,
      next_due_date: date(r.nextDueDay),
    })),
    Workforce: seed.workforce.map((w) => ({
      department: w.departmentId,
      headcount: w.headcount,
      avg_monthly_cost_per_head: tl(w.avgMonthlyCost),
      monthly_turnover_pct: pct(w.baseTurnoverBps),
    })),
    History: seed.finance.history.map((h) => ({
      period_end: date(h.period * st.periodLengthDays),
      revenue: tl(h.revenue),
      cogs: tl(h.cogs),
      avg_satisfaction: pct(h.avgSatisfaction),
      overtime_person_hours: h.overtimePersonHours,
      closing_cash: h.closingCash === null ? null : tl(h.closingCash),
    })),
  };
}
