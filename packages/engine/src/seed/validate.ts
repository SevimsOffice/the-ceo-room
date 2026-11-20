import { DEPARTMENT_IDS } from '../model/types';
import { isIsoDate } from '../model/calendarDate';
import type { SeedBundle } from './types';
import { SEED_FILES } from './types';

/**
 * Hand-written shape guards for the seed (ADR-0006). Checks types, integer money/quantities,
 * workspaceId on every record, and referential integrity. Returns all problems found.
 */
type Kind = 'str' | 'text' | 'int' | 'bool' | 'arr' | 'obj' | 'intOrNull' | 'strOrNull' | 'objOrNull';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

function check(v: unknown, k: Kind): boolean {
  switch (k) {
    case 'str':
      return typeof v === 'string' && v.length > 0;
    case 'text':
      return typeof v === 'string';
    case 'int':
      return typeof v === 'number' && Number.isSafeInteger(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'arr':
      return Array.isArray(v);
    case 'obj':
      return isRec(v);
    case 'intOrNull':
      return v === null || (typeof v === 'number' && Number.isSafeInteger(v));
    case 'strOrNull':
      return v === null || typeof v === 'string';
    case 'objOrNull':
      return v === null || isRec(v);
  }
}

class Checker {
  errors: string[] = [];
  fields(path: string, x: unknown, spec: Record<string, Kind>, workspace = true): x is Rec {
    if (!isRec(x)) {
      this.errors.push(`${path}: expected object`);
      return false;
    }
    const full: Record<string, Kind> = workspace ? { workspaceId: 'str', ...spec } : spec;
    for (const [f, k] of Object.entries(full)) {
      if (!check(x[f], k)) this.errors.push(`${path}.${f}: expected ${k}`);
    }
    return true;
  }
  list(path: string, x: unknown, spec: Record<string, Kind>, each?: (r: Rec, p: string) => void): Rec[] {
    if (!Array.isArray(x)) {
      this.errors.push(`${path}: expected array`);
      return [];
    }
    const out: Rec[] = [];
    x.forEach((r, i) => {
      const p = `${path}[${i}]`;
      if (this.fields(p, r, spec)) {
        out.push(r);
        each?.(r, p);
      }
    });
    return out;
  }
  ref(path: string, id: unknown, ids: Set<string>): void {
    if (typeof id !== 'string' || !ids.has(id)) this.errors.push(`${path}: unknown reference ${String(id)}`);
  }
}

const idsOf = (rs: Rec[]): Set<string> => new Set(rs.map((r) => String(r.id)));

/** Optional plain display label (imported companies): absent, or a non-empty string. */
function optionalText(c: Checker, path: string, v: unknown): void {
  if (v !== undefined && (typeof v !== 'string' || v.length === 0)) c.errors.push(`${path}: expected non-empty string when present`);
}

export type SeedValidation = { ok: true; bundle: SeedBundle } | { ok: false; errors: string[] };

export function validateSeedBundle(raw: unknown): SeedValidation {
  const c = new Checker();
  if (!isRec(raw)) return { ok: false, errors: ['bundle: expected object'] };
  for (const f of SEED_FILES) if (!(f in raw)) c.errors.push(`bundle.${f}: missing file`);
  if (c.errors.length) return { ok: false, errors: c.errors };

  const company = raw.company as Rec;
  if (c.fields('company', company, { company: 'obj', settings: 'obj' }, false)) {
    c.fields('company.company', company.company, { id: 'str', nameKey: 'str', city: 'str', currency: 'str', simulated: 'bool', seedVersion: 'int' });
    if (isRec(company.company)) {
      const co = company.company;
      if (co.source !== undefined && co.source !== 'seed' && co.source !== 'import') c.errors.push('company.company.source: expected seed | import');
      const snap = co.snapshotDate;
      if (snap !== undefined && snap !== null && (typeof snap !== 'string' || !isIsoDate(snap))) c.errors.push('company.company.snapshotDate: expected YYYY-MM-DD or null');
      if (co.source === 'import' && typeof snap !== 'string') c.errors.push('company.company.snapshotDate: an imported company needs its snapshot date');
      if (co.source !== 'import' && co.simulated !== true) c.errors.push('company.company.simulated: must be true for a seed company');
      optionalText(c, 'company.company.name', co.name);
    }
    c.fields(
      'company.settings',
      company.settings,
      {
        periodLengthDays: 'int',
        runwayHorizonDays: 'int',
        labourCostPerLineHour: 'int',
        energyCostPerLineHour: 'int',
        overtimeCrewPerLine: 'int',
        overtimeRatePerPersonHour: 'int',
        maxOvertimeHoursPerLineDay: 'int',
        mrpCoverDays: 'int',
        turnoverBpsPerOvertimeHourPerHead: 'int',
      },
      false,
    );
  }

  const depts = c.list('departments', raw.departments, {
    id: 'str', nameKey: 'str', headName: 'text', headTitleKey: 'str', kpis: 'arr', constraints: 'arr', activeTasks: 'arr', risks: 'arr', dependsOn: 'arr',
  });
  for (const d of depts) if (!DEPARTMENT_IDS.includes(d.id as never)) c.errors.push(`departments: unknown id ${String(d.id)}`);
  const deptIds = idsOf(depts);

  const plantsFile = raw.plants as Rec;
  let plantIds = new Set<string>();
  let lineIds = new Set<string>();
  const familyRefs: [string, unknown][] = [];
  if (c.fields('plants', plantsFile, { plants: 'arr', lines: 'arr' }, false)) {
    const plants = c.list('plants.plants', plantsFile.plants, { id: 'str', name: 'str', city: 'str', headcount: 'int', productFamilies: 'arr' }, (r, p) => {
      (r.productFamilies as unknown[]).forEach((f, i) => familyRefs.push([`${p}.productFamilies[${i}]`, f]));
    });
    plantIds = idsOf(plants);
    const lines = c.list('plants.lines', plantsFile.lines, {
      id: 'str', plantId: 'str', kindKey: 'str', shiftsPerDay: 'int', hoursPerShift: 'int', status: 'str', repairDueDay: 'intOrNull',
    }, (r, p) => {
      c.ref(`${p}.plantId`, r.plantId, plantIds);
      optionalText(c, `${p}.kindName`, r.kindName);
    });
    lineIds = idsOf(lines);
  }

  const materials = c.list('materials', raw.materials, {
    id: 'str', nameKey: 'str', unit: 'str', stockQty: 'int', stockValue: 'int', safetyStock: 'int', lotSize: 'int', preferredSupplierId: 'str',
  });
  const materialIds = idsOf(materials);
  for (const m of materials) {
    if ((m.lotSize as number) <= 0) c.errors.push(`materials.${String(m.id)}.lotSize: must be > 0`);
    optionalText(c, `materials.${String(m.id)}.name`, m.name);
  }

  const families = c.list('productFamilies', raw.productFamilies, { id: 'str', nameKey: 'str', unitPrice: 'int', minutesPerUnit: 'int', bom: 'arr' }, (r, p) => {
    optionalText(c, `${p}.name`, r.name);
    (r.bom as unknown[]).forEach((b, i) => {
      if (c.fields(`${p}.bom[${i}]`, b, { materialId: 'str', qtyPerUnit: 'int' }, false)) c.ref(`${p}.bom[${i}].materialId`, b.materialId, materialIds);
    });
  });
  const familyIds = idsOf(families);
  for (const [p, f] of familyRefs) c.ref(p, f, familyIds);

  const suppliers = c.list('suppliers', raw.suppliers, {
    id: 'str', name: 'str', country: 'str', offers: 'arr', paymentTermsDays: 'int', depositBps: 'int', reliabilityBps: 'int', onboardingDays: 'int', established: 'bool', firstDeliveryDay: 'intOrNull',
  }, (r, p) => {
    (r.offers as unknown[]).forEach((o, i) => {
      if (c.fields(`${p}.offers[${i}]`, o, { materialId: 'str', unitPrice: 'int', leadTimeDays: 'int' }, false)) c.ref(`${p}.offers[${i}].materialId`, o.materialId, materialIds);
    });
  });
  const supplierIds = idsOf(suppliers);
  for (const m of materials) c.ref(`materials.${String(m.id)}.preferredSupplierId`, m.preferredSupplierId, supplierIds);

  const customers = c.list('customers', raw.customers, {
    id: 'str', name: 'str', segmentKey: 'str', country: 'str', key: 'bool', paymentTermsDays: 'int', paymentDelayDays: 'int', satisfaction: 'int', churnRisk: 'int', discountBps: 'int', annualRevenue: 'int', status: 'str', demand: 'objOrNull',
  }, (r, p) => {
    if (isRec(r.demand) && c.fields(`${p}.demand`, r.demand, { familyId: 'str', qtyMin: 'int', qtyMax: 'int', cadenceDays: 'int', leadDays: 'int', nextOrderDay: 'int' }, false)) {
      c.ref(`${p}.demand.familyId`, r.demand.familyId, familyIds);
    }
  });
  const customerIds = idsOf(customers);

  const ordersFile = raw.orders as Rec;
  if (c.fields('orders', ordersFile, { salesOrders: 'arr', purchaseOrders: 'arr' }, false)) {
    c.list('orders.salesOrders', ordersFile.salesOrders, {
      id: 'str', customerId: 'str', familyId: 'str', plantId: 'str', qty: 'int', unitPrice: 'int', value: 'int', paymentTermsDays: 'int', receivedDay: 'int', requestedDay: 'int', promisedDay: 'int', status: 'str', minutesDone: 'int', unitsDone: 'int', materialCost: 'int', energyCost: 'int', costEstimate: 'int', blockedBy: 'strOrNull', shippedDay: 'intOrNull', source: 'str', plan: 'objOrNull',
    }, (r, p) => {
      c.ref(`${p}.customerId`, r.customerId, customerIds);
      c.ref(`${p}.familyId`, r.familyId, familyIds);
      c.ref(`${p}.plantId`, r.plantId, plantIds);
      if ((r.qty as number) * (r.unitPrice as number) !== r.value) c.errors.push(`${p}.value: must equal qty × unitPrice`);
    });
    c.list('orders.purchaseOrders', ordersFile.purchaseOrders, {
      id: 'str', supplierId: 'str', materialId: 'str', qty: 'int', unitPrice: 'int', orderedDay: 'int', dueDay: 'int', delayDays: 'int', deposit: 'int', paymentTermsDays: 'int', status: 'str', forOrderId: 'strOrNull',
    }, (r, p) => {
      c.ref(`${p}.supplierId`, r.supplierId, supplierIds);
      c.ref(`${p}.materialId`, r.materialId, materialIds);
    });
  }

  c.list('workforce', raw.workforce, { departmentId: 'str', headcount: 'int', baseTurnoverBps: 'int', avgMonthlyCost: 'int' }, (r, p) =>
    c.ref(`${p}.departmentId`, r.departmentId, deptIds),
  );

  const fin = raw.finance as Rec;
  if (c.fields('finance', fin, { cash: 'int', receivables: 'arr', payables: 'arr', recurringCosts: 'arr', history: 'arr' })) {
    c.list('finance.receivables', fin.receivables, {
      id: 'str', source: 'str', orderId: 'strOrNull', customerId: 'str', amount: 'int', issuedDay: 'int', dueDay: 'int', expectedPayDay: 'int', status: 'str',
    }, (r, p) => c.ref(`${p}.customerId`, r.customerId, customerIds));
    c.list('finance.payables', fin.payables, { id: 'str', source: 'str', poId: 'strOrNull', counterpartyId: 'str', amount: 'int', dueDay: 'int', status: 'str' }, (r, p) =>
      c.ref(`${p}.counterpartyId`, r.counterpartyId, supplierIds),
    );
    c.list('finance.recurringCosts', fin.recurringCosts, { id: 'str', kind: 'str', amount: 'int', everyDays: 'int', nextDueDay: 'int' });
    c.list('finance.history', fin.history, { period: 'int', revenue: 'int', cogs: 'int', avgSatisfaction: 'int', overtimePersonHours: 'int', closingCash: 'intOrNull' });
  }

  // Every id a card names must exist (a card firing on a missing record would stop the engine).
  const offers = new Map(suppliers.map((s) => [String(s.id), new Set((s.offers as Rec[]).filter(isRec).map((o) => String(o.materialId)))]));
  const workforceDepts = new Set((Array.isArray(raw.workforce) ? (raw.workforce as unknown[]) : []).filter(isRec).map((w) => String(w.departmentId)));
  c.list('eventCards', raw.eventCards, { id: 'str', kindKey: 'str', severity: 'str', trigger: 'obj', effect: 'obj' }, (r, p) => {
    const e = r.effect as Rec;
    const t = r.trigger as Rec;
    if (typeof e.kind !== 'string') c.errors.push(`${p}.effect.kind: expected str`);
    if (typeof t.kind !== 'string') c.errors.push(`${p}.trigger.kind: expected str`);
    if (t.kind === 'turnoverAbove') c.ref(`${p}.trigger.departmentId`, t.departmentId, workforceDepts);
    if (e.kind === 'largeOrder' || e.kind === 'discountDemand' || e.kind === 'latePayment') c.ref(`${p}.effect.customerId`, e.customerId, customerIds);
    if (e.kind === 'largeOrder') c.ref(`${p}.effect.familyId`, e.familyId, familyIds);
    if (e.kind === 'lineBreakdown') c.ref(`${p}.effect.lineId`, e.lineId, lineIds);
    if (e.kind === 'supplierPriceChange') {
      c.ref(`${p}.effect.materialId`, e.materialId, materialIds);
      for (const f of ['supplierId', 'alternativeSupplierId'] as const) {
        c.ref(`${p}.effect.${f}`, e[f], supplierIds);
        const sup = offers.get(String(e[f]));
        if (sup && !sup.has(String(e.materialId))) c.errors.push(`${p}.effect.${f}: supplier ${String(e[f])} has no offer for ${String(e.materialId)}`);
      }
    }
  });

  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, bundle: raw as unknown as SeedBundle };
}
