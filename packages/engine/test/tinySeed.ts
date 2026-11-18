/**
 * Tiny hand-built company for unit tests: one plant with one line, one product family, one material,
 * two suppliers, one customer, no cards. Every figure is small enough to compute by hand.
 *
 *   line l1: 1 shift × 8 h = 480 line-minutes per workday (Day 1 = Monday, weekends off)
 *   family f1: 60 min/unit, BOM = 2 × m1, list price 1,000 TRY
 *   m1: no stock, no safety stock, lot size 10
 *   s1 (preferred): 10 TRY, lead 5 days, pays at 30 days, no deposit, always on time, established
 *   s2 (alternative): 9 TRY, lead 10 days, pays at 7 days, 50% deposit, 3 onboarding days
 *   c1: 60-day terms, pays on time, satisfaction 80.00
 */
import { type CardEffect, type CardTrigger, type Engine, type SeedBundle, createEngine, tl, validateSeedBundle } from '../src/index';

export const TINY_WS = 'ws_tiny';

export function tinySeed(): SeedBundle {
  const ws = TINY_WS;
  const raw = {
    company: {
      company: { workspaceId: ws, id: 'tiny', nameKey: 'company.name', city: 'Test', currency: 'TRY', simulated: true, seedVersion: 1 },
      settings: {
        periodLengthDays: 30,
        runwayHorizonDays: 60,
        labourCostPerLineHour: tl(100),
        energyCostPerLineHour: tl(10),
        overtimeCrewPerLine: 2,
        overtimeRatePerPersonHour: tl(50),
        maxOvertimeHoursPerLineDay: 2,
        mrpCoverDays: 0,
        turnoverBpsPerOvertimeHourPerHead: 0,
      },
    },
    departments: (['operations', 'finance'] as const).map((id) => ({
      workspaceId: ws,
      id,
      nameKey: `department.${id}`,
      headName: `Head ${id}`,
      headTitleKey: `title.${id}`,
      kpis: [],
      constraints: [],
      activeTasks: [],
      risks: [],
      dependsOn: [],
    })),
    plants: {
      plants: [{ workspaceId: ws, id: 'p1', name: 'P1', city: 'Test', headcount: 10, productFamilies: ['f1'] }],
      lines: [{ workspaceId: ws, id: 'l1', plantId: 'p1', kindKey: 'line.test', shiftsPerDay: 1, hoursPerShift: 8, status: 'running', repairDueDay: null }],
    },
    productFamilies: [{ workspaceId: ws, id: 'f1', nameKey: 'family.f1', unitPrice: tl(1000), minutesPerUnit: 60, bom: [{ materialId: 'm1', qtyPerUnit: 2 }] }],
    materials: [{ workspaceId: ws, id: 'm1', nameKey: 'material.m1', unit: 'kg', stockQty: 0, stockValue: 0, safetyStock: 0, lotSize: 10, preferredSupplierId: 's1' }],
    suppliers: [
      {
        workspaceId: ws, id: 's1', name: 'S1', country: 'TR', offers: [{ materialId: 'm1', unitPrice: tl(10), leadTimeDays: 5 }],
        paymentTermsDays: 30, depositBps: 0, reliabilityBps: 10000, onboardingDays: 0, established: true, firstDeliveryDay: null,
      },
      {
        workspaceId: ws, id: 's2', name: 'S2', country: 'TR', offers: [{ materialId: 'm1', unitPrice: tl(9), leadTimeDays: 10 }],
        paymentTermsDays: 7, depositBps: 5000, reliabilityBps: 10000, onboardingDays: 3, established: false, firstDeliveryDay: null,
      },
    ],
    customers: [
      {
        workspaceId: ws, id: 'c1', name: 'C1', segmentKey: 'segment.test', country: 'TR', key: true, paymentTermsDays: 60, paymentDelayDays: 0,
        satisfaction: 8000, churnRisk: 1000, discountBps: 0, annualRevenue: tl(1_000_000), status: 'active', demand: null,
      },
    ],
    orders: { salesOrders: [], purchaseOrders: [] },
    workforce: [
      { workspaceId: ws, departmentId: 'operations', headcount: 10, baseTurnoverBps: 0, avgMonthlyCost: tl(1000) },
      { workspaceId: ws, departmentId: 'finance', headcount: 1, baseTurnoverBps: 0, avgMonthlyCost: tl(1000) },
    ],
    finance: { workspaceId: ws, cash: tl(100_000), receivables: [], payables: [], recurringCosts: [], history: [] },
    eventCards: [],
  };
  const v = validateSeedBundle(raw);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.bundle;
}

export function card(id: string, trigger: CardTrigger, effect: CardEffect): SeedBundle['eventCards'][number] {
  return { workspaceId: TINY_WS, id, kindKey: id, severity: 'high', trigger, effect };
}

/** The standard tiny order: 16 units of f1 for c1 at 1,000 TRY, requested in 10 days, 60-day terms. */
export const TINY_ORDER: CardEffect = {
  kind: 'largeOrder',
  customerId: 'c1',
  familyId: 'f1',
  qty: 16,
  unitPrice: tl(1000),
  requestedInDays: 10,
  paymentTermsDays: 60,
};

export function tinyEngine(edit: (s: SeedBundle) => void = () => {}, rngSeed = 1): Engine {
  const s = tinySeed();
  edit(s);
  return createEngine(s, { rngSeed, workspaceId: TINY_WS });
}

/** Tiny engine whose Day-1 morning brings TINY_ORDER through the pipeline. */
export function tinyWithOrder(edit: (s: SeedBundle) => void = () => {}): Engine {
  return tinyEngine((s) => {
    // a copy: edits to this seed's card (e.g. a bigger qty) must not leak into TINY_ORDER
    s.eventCards.push(card('card_order', { kind: 'day', day: 1 }, { ...TINY_ORDER }));
    edit(s);
  });
}
