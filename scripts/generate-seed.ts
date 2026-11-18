/**
 * Deterministic seed generator for NOVARA (simulated). Run once: `pnpm seed`.
 * Fixed RNG seed; same output every run. Bump SEED_VERSION when the seed design changes.
 * Writes data/seed/*.json (small, hand-sized). All companies and people are fictional.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Customer,
  type Department,
  type EventCard,
  type Material,
  type Order,
  type Payable,
  type PeriodClose,
  type PurchaseOrder,
  type Receivable,
  type SeedBundle,
  type Supplier,
  makeGenerator,
  money,
  tl,
  validateSeedBundle,
} from '../packages/engine/src/index';

const SEED_VERSION = 1;
const GENERATOR_SEED = 0x0a7a2026;
const WS = 'ws_demo';
const rnd = makeGenerator(GENERATOR_SEED);
const jitter = (spread: number): number => (rnd() / 4294967296 - 0.5) * 2 * spread; // [-spread, spread)
const pad = (n: number): string => String(n).padStart(4, '0');

// ---------------------------------------------------------------- company
const company: SeedBundle['company'] = {
  company: { workspaceId: WS, id: 'novara', nameKey: 'company.name', city: 'Bursa', currency: 'TRY', simulated: true, seedVersion: SEED_VERSION },
  settings: {
    periodLengthDays: 30,
    runwayHorizonDays: 180,
    labourCostPerLineHour: tl(3600),
    energyCostPerLineHour: tl(900),
    overtimeCrewPerLine: 9,
    overtimeRatePerPersonHour: tl(650),
    maxOvertimeHoursPerLineDay: 3,
    mrpCoverDays: 14,
    turnoverBpsPerOvertimeHourPerHead: 12,
  },
};

// ---------------------------------------------------------------- departments & workforce
const m = (code: string, params: Record<string, string | number> = {}) => ({ code, params });
const departments: Department[] = [
  { id: 'sales', head: 'Selin Arslan', title: 'title.salesDirector', kpis: ['kpi.revenue', 'kpi.backlogValue', 'kpi.openOrders'], dependsOn: ['operations', 'finance'], constraints: [m('constraint.creditLimits')], tasks: [m('task.registerLargeOrder')], risks: [m('risk.customerConcentration')] },
  { id: 'operations', head: 'Murat Demir', title: 'title.coo', kpis: ['kpi.capacityUtilisation', 'kpi.deliverySlip', 'kpi.overtimeHours'], dependsOn: ['procurement', 'people'], constraints: [m('constraint.twoShifts'), m('constraint.noWeekendProduction')], tasks: [m('task.scheduleBacklog')], risks: [m('risk.pressLineAge', { lineId: 'p2_press' })] },
  { id: 'procurement', head: 'Emre Yıldız', title: 'title.supplyChainDirector', kpis: ['kpi.materialCoverage', 'kpi.supplierReliability'], dependsOn: ['finance'], constraints: [m('constraint.steelSingleSource', { materialId: 'steel' })], tasks: [m('task.steelReorders')], risks: [m('risk.steelPriceVolatility')] },
  { id: 'finance', head: 'Ayşe Kaya', title: 'title.cfo', kpis: ['kpi.cash', 'kpi.runway', 'kpi.grossMargin'], dependsOn: ['sales'], constraints: [m('constraint.noNewCredit')], tasks: [m('task.cashForecast')], risks: [m('risk.longReceivables', { days: 90 })] },
  { id: 'people', head: 'Zeynep Şahin', title: 'title.chro', kpis: ['kpi.turnover', 'kpi.headcount'], dependsOn: ['operations'], constraints: [m('constraint.overtimeCap', { hours: 3 })], tasks: [m('task.shiftPlanning')], risks: [m('risk.overtimeFatigue')] },
  { id: 'cx', head: 'Can Öztürk', title: 'title.cxDirector', kpis: ['kpi.satisfaction', 'kpi.churnRisk'], dependsOn: ['sales', 'operations'], constraints: [m('constraint.keyAccountReviews')], tasks: [m('task.satisfactionRecovery')], risks: [m('risk.lateDeliveries')] },
].map((d) => ({
  workspaceId: WS,
  id: d.id as Department['id'],
  nameKey: `department.${d.id}`,
  headName: d.head,
  headTitleKey: d.title,
  kpis: d.kpis,
  constraints: d.constraints,
  activeTasks: d.tasks,
  risks: d.risks,
  dependsOn: d.dependsOn as Department['dependsOn'],
}));

const workforce: SeedBundle['workforce'] = (
  [
    ['sales', 15, 90, 85_000],
    ['operations', 126, 180, 62_000],
    ['procurement', 11, 80, 80_000],
    ['finance', 10, 70, 90_000],
    ['people', 7, 70, 78_000],
    ['cx', 12, 110, 72_000],
  ] as const
).map(([id, hc, to, cost]) => ({ workspaceId: WS, departmentId: id, headcount: hc, baseTurnoverBps: to, avgMonthlyCost: tl(cost) }));

// ---------------------------------------------------------------- plants & lines
const plants: SeedBundle['plants'] = {
  plants: [
    { workspaceId: WS, id: 'plant_nilufer', name: 'Nilüfer', city: 'Bursa', headcount: 46, productFamilies: ['frames', 'panels'] },
    { workspaceId: WS, id: 'plant_gemlik', name: 'Gemlik', city: 'Bursa', headcount: 44, productFamilies: ['presses', 'frames'] },
    { workspaceId: WS, id: 'plant_inegol', name: 'İnegöl', city: 'Bursa', headcount: 36, productFamilies: ['drives', 'panels'] },
  ],
  lines: (
    [
      ['p1_cutting', 'plant_nilufer', 'line.cutting'],
      ['p1_welding', 'plant_nilufer', 'line.welding'],
      ['p2_press', 'plant_gemlik', 'line.press'],
      ['p2_machining', 'plant_gemlik', 'line.machining'],
      ['p3_assembly', 'plant_inegol', 'line.assembly'],
      ['p3_paint', 'plant_inegol', 'line.paint'],
    ] as const
  ).map(([id, plantId, kindKey]) => ({ workspaceId: WS, id, plantId, kindKey, shiftsPerDay: 2, hoursPerShift: 8, status: 'running' as const, repairDueDay: null })),
};

// ---------------------------------------------------------------- products & materials
const productFamilies: SeedBundle['productFamilies'] = [
  { id: 'frames', price: 24_000, mpu: 40, bom: [['steel', 380], ['components', 3], ['packaging', 1]] },
  { id: 'presses', price: 58_000, mpu: 97, bom: [['steel', 700], ['aluminium', 30], ['components', 12], ['packaging', 2]] },
  { id: 'panels', price: 9_500, mpu: 16, bom: [['steel', 115], ['aluminium', 10], ['components', 1], ['packaging', 1]] },
  { id: 'drives', price: 36_000, mpu: 59, bom: [['steel', 250], ['aluminium', 40], ['components', 16], ['packaging', 1]] },
].map((f) => ({
  workspaceId: WS,
  id: f.id,
  nameKey: `product.${f.id}`,
  unitPrice: tl(f.price),
  minutesPerUnit: f.mpu,
  bom: (f.bom as [string, number][]).map(([materialId, qtyPerUnit]) => ({ materialId, qtyPerUnit })),
}));

const PRICE = { steel: 38, aluminium: 120, components: 450, packaging: 85 } as const;
const materials: Material[] = (
  [
    ['steel', 'kg', 150_000, 60_000, 20_000, 'sup_kuzeycelik'],
    ['aluminium', 'kg', 26_000, 6_000, 2_000, 'sup_alpaka'],
    ['components', 'pcs', 9_000, 1_500, 500, 'sup_hidrovar'],
    ['packaging', 'set', 3_000, 800, 500, 'sup_kartopak'],
  ] as const
).map(([id, unit, stock, safety, lot, sup]) => ({
  workspaceId: WS,
  id,
  nameKey: `material.${id}`,
  unit,
  stockQty: stock,
  stockValue: money(stock * tl(PRICE[id])),
  safetyStock: safety,
  lotSize: lot,
  preferredSupplierId: sup,
}));

// ---------------------------------------------------------------- suppliers
const sup = (
  id: string, name: string, country: string, offers: [string, number, number][], terms: number, depositBps: number, reliabilityBps: number, onboardingDays: number, established: boolean,
): Supplier => ({
  workspaceId: WS, id, name, country,
  offers: offers.map(([materialId, price, lead]) => ({ materialId, unitPrice: tl(price), leadTimeDays: lead })),
  paymentTermsDays: terms, depositBps, reliabilityBps, onboardingDays, established, firstDeliveryDay: null,
});
const suppliers: Supplier[] = [
  sup('sup_kuzeycelik', 'Kuzeyçelik Haddecilik A.Ş.', 'TR', [['steel', 38, 7]], 21, 0, 9600, 0, true),
  sup('sup_dogumetal', 'Doğumetal Çelik Servis Ltd.', 'TR', [['steel', 38.5, 12]], 15, 3000, 8000, 4, false),
  sup('sup_alpaka', 'Alpaka Alüminyum San. A.Ş.', 'TR', [['aluminium', 120, 10]], 30, 0, 9500, 0, true),
  sup('sup_hidrovar', 'Hidrovar Komponent A.Ş.', 'TR', [['components', 450, 14]], 45, 0, 9300, 0, true),
  sup('sup_teknoray', 'Teknoray Bileşen Ltd.', 'TR', [['components', 470, 9]], 30, 1000, 9000, 3, false),
  sup('sup_kartopak', 'Kartopak Ambalaj San.', 'TR', [['packaging', 85, 5]], 30, 0, 9800, 0, true),
];

// ---------------------------------------------------------------- customers
// [id, name, segment, country, key, terms, delay, satisfaction, churn, family, monthly value TRY, cadence, first order day]
const CUSTOMERS: [string, string, string, string, boolean, number, number, number, number, string, number, number, number][] = [
  ['cus_demirhan', 'Demirhan Raylı Sistemler A.Ş.', 'segment.rail', 'TR', true, 90, 5, 8000, 1200, 'frames', 11_500_000, 30, 12],
  ['cus_karatas', 'Karataş Tarım Makinaları A.Ş.', 'segment.agri', 'TR', false, 60, 12, 7600, 1800, 'panels', 7_500_000, 30, 8],
  ['cus_velora', 'Velora Otomotiv Yan Sanayi A.Ş.', 'segment.automotive', 'TR', true, 75, 8, 7900, 1400, 'drives', 10_500_000, 30, 15],
  ['cus_nordhafen', 'Nordhafen Maschinenbau GmbH', 'segment.export', 'DE', true, 60, 0, 8800, 600, 'presses', 13_000_000, 30, 19],
  ['cus_egeport', 'Egeport Vinç ve Liman Ekipmanları A.Ş.', 'segment.cranes', 'TR', false, 90, 10, 8200, 1100, 'presses', 8_000_000, 30, 23],
  ['cus_tunca', 'Tunca Enerji Sistemleri A.Ş.', 'segment.energy', 'TR', true, 60, 6, 8300, 1000, 'drives', 10_000_000, 30, 26],
  ['cus_alvenka', 'Alvenka İş Makinaları A.Ş.', 'segment.construction', 'TR', false, 75, 14, 7700, 1700, 'frames', 8_000_000, 30, 29],
  ['cus_mavikent', 'Mavikent Beyaz Eşya San. A.Ş.', 'segment.appliances', 'TR', false, 60, 7, 8500, 800, 'panels', 6_500_000, 30, 33],
];
/** New orders arrive slightly below regular capacity, quoted at the current ~2-month lead time. */
const DEMAND_SCALE = 1.0;
const DEMAND_LEAD_DAYS = 60;
const priceOf = (fam: string): number => productFamilies.find((f) => f.id === fam)!.unitPrice / 100;
const customers: Customer[] = CUSTOMERS.map(([id, name, seg, country, key, terms, delay, sat, churn, fam, monthly, cadence, first]) => {
  const q = (monthly * DEMAND_SCALE) / priceOf(fam);
  return {
    workspaceId: WS, id, name, segmentKey: seg, country, key, paymentTermsDays: terms, paymentDelayDays: delay,
    satisfaction: sat, churnRisk: churn, discountBps: 0, annualRevenue: tl(monthly * 12), status: 'active',
    demand: { familyId: fam, qtyMin: Math.round(q * 0.85), qtyMax: Math.round(q * 1.15), cadenceDays: cadence, leadDays: DEMAND_LEAD_DAYS, nextOrderDay: first },
  };
});

// ---------------------------------------------------------------- open sales orders (Day 1)
// [customer, family, plant, qty, received, requested/promised, progress %]
const ORDERS: [string, string, string, number, number, number, number][] = [
  ['cus_karatas', 'panels', 'plant_nilufer', 850, -38, 6, 60],
  ['cus_alvenka', 'frames', 'plant_nilufer', 490, -30, 13, 30],
  ['cus_demirhan', 'frames', 'plant_nilufer', 370, -20, 27, 5],
  ['cus_mavikent', 'panels', 'plant_nilufer', 640, -12, 38, 0],
  ['cus_alvenka', 'frames', 'plant_nilufer', 290, -6, 57, 0],
  ['cus_nordhafen', 'presses', 'plant_gemlik', 340, -41, 9, 40],
  ['cus_egeport', 'presses', 'plant_gemlik', 210, -25, 30, 0],
  ['cus_nordhafen', 'presses', 'plant_gemlik', 270, -14, 48, 0],
  ['cus_demirhan', 'frames', 'plant_gemlik', 230, -5, 61, 0],
  ['cus_velora', 'drives', 'plant_inegol', 340, -36, 8, 35],
  ['cus_tunca', 'drives', 'plant_inegol', 430, -27, 25, 10],
  ['cus_karatas', 'panels', 'plant_inegol', 470, -16, 37, 0],
  ['cus_velora', 'drives', 'plant_inegol', 250, -9, 51, 0],
  ['cus_tunca', 'drives', 'plant_inegol', 210, -3, 62, 0],
];
const mpuOf = (fam: string): number => productFamilies.find((f) => f.id === fam)!.minutesPerUnit;
const salesOrders: Order[] = ORDERS.map(([cus, fam, plant, qty, received, promised, pct], i) => {
  const minutes = Math.floor((qty * mpuOf(fam) * pct) / 100);
  const unitsDone = Math.floor(minutes / mpuOf(fam));
  const famRec = productFamilies.find((f) => f.id === fam)!;
  const materialCost = famRec.bom.reduce((t, b) => t + unitsDone * b.qtyPerUnit * tl(PRICE[b.materialId as keyof typeof PRICE]), 0);
  const unitPrice = famRec.unitPrice;
  const c = customers.find((x) => x.id === cus)!;
  return {
    workspaceId: WS, id: `ord-${pad(i + 1)}`, customerId: cus, familyId: fam, plantId: plant, qty, unitPrice,
    value: money(unitPrice * qty), paymentTermsDays: c.paymentTermsDays, receivedDay: received, requestedDay: promised, promisedDay: promised,
    status: pct > 0 ? 'in_production' : 'scheduled', minutesDone: minutes, unitsDone, materialCost: money(materialCost),
    energyCost: money(Math.round((minutes * tl(900)) / 60)), costEstimate: money(0), blockedBy: null, shippedDay: null, source: 'seed', plan: null,
  };
});

// open purchase orders (placed in the last week, arriving days 2–7)
const PURCHASES: [string, string, number, number, number][] = [
  ['sup_kuzeycelik', 'steel', 120_000, -5, 2],
  ['sup_kuzeycelik', 'steel', 140_000, -2, 5],
  ['sup_kuzeycelik', 'steel', 140_000, 0, 7],
  ['sup_alpaka', 'aluminium', 12_000, -4, 6],
  ['sup_hidrovar', 'components', 6_000, -10, 4],
  ['sup_kartopak', 'packaging', 2_500, -1, 4],
];
const purchaseOrders: PurchaseOrder[] = PURCHASES.map(([supplierId, materialId, qty, ordered, due], i) => {
  const s = suppliers.find((x) => x.id === supplierId)!;
  return {
    workspaceId: WS, id: `po-${pad(i + 1)}`, supplierId, materialId, qty, unitPrice: s.offers[0]!.unitPrice,
    orderedDay: ordered, dueDay: due, delayDays: 0, deposit: money(0), paymentTermsDays: s.paymentTermsDays, status: 'open', forOrderId: null,
  };
});

// ---------------------------------------------------------------- finance
// Invoice history of the last three periods → receivables still open on Day 1.
const HISTORY_REVENUE: Record<number, number> = { [-2]: 69_800_000, [-1]: 72_100_000, [0]: 76_400_000 };
const totalMonthly = CUSTOMERS.reduce((t, c) => t + c[10], 0);
const receivables: Receivable[] = [];
for (const period of [-2, -1, 0]) {
  CUSTOMERS.forEach(([id, , , , , terms, delay, , , , monthly], ci) => {
    // two invoices per customer per period
    for (const half of [0, 1]) {
      const issued = (period - 1) * 30 + 3 + ci * 3 + half * 14;
      const share = (monthly / totalMonthly) * HISTORY_REVENUE[period]! / 2;
      const amount = tl(Math.round(share * (1 + jitter(0.06)) / 1000) * 1000);
      const dueDay = issued + terms;
      const expectedPayDay = dueDay + delay;
      if (expectedPayDay < 1) continue;
      receivables.push({ workspaceId: WS, id: `rcv-${pad(receivables.length + 1)}`, source: 'opening', orderId: null, customerId: id, amount, issuedDay: issued, dueDay, expectedPayDay, status: 'open' });
    }
  });
}
// Supplier payables from recent deliveries (material buys ≈ 46% of revenue).
const payables: Payable[] = [];
const SPEND: [string, number, number][] = [
  ['sup_kuzeycelik', 0.46, 21],
  ['sup_alpaka', 0.064, 30],
  ['sup_hidrovar', 0.10, 45],
  ['sup_kartopak', 0.004, 30],
];
for (const [supplierId, share, terms] of SPEND) {
  for (let delivered = -terms + 3; delivered <= 0; delivered += 7) {
    const amount = tl(Math.round(((76_400_000 * share) / 30) * 7 * (1 + jitter(0.08)) / 1000) * 1000);
    payables.push({ workspaceId: WS, id: `pay-${pad(payables.length + 1)}`, source: 'opening', poId: null, counterpartyId: supplierId, amount, dueDay: delivered + terms, status: 'open' });
  }
}
const history: PeriodClose[] = [
  { workspaceId: WS, period: -1, revenue: tl(HISTORY_REVENUE[-1]!), cogs: tl(55_500_000), avgSatisfaction: 8600, overtimePersonHours: 1400, closingCash: tl(47_900_000) },
  { workspaceId: WS, period: 0, revenue: tl(HISTORY_REVENUE[0]!), cogs: tl(59_300_000), avgSatisfaction: 8500, overtimePersonHours: 1650, closingCash: tl(41_200_000) },
];
const finance: SeedBundle['finance'] = {
  workspaceId: WS,
  cash: tl(41_200_000),
  receivables,
  payables,
  recurringCosts: [
    { workspaceId: WS, id: 'rc_payroll', kind: 'payroll', amount: money(0), everyDays: 30, nextDueDay: 5 },
    { workspaceId: WS, id: 'rc_overhead', kind: 'overhead', amount: tl(5_500_000), everyDays: 30, nextDueDay: 10 },
    { workspaceId: WS, id: 'rc_utilities', kind: 'utilities', amount: tl(800_000), everyDays: 30, nextDueDay: 20 },
    { workspaceId: WS, id: 'rc_payroll_tax', kind: 'payroll_tax', amount: tl(3_900_000), everyDays: 30, nextDueDay: 26 },
    { workspaceId: WS, id: 'rc_debt', kind: 'debt_service', amount: tl(4_600_000), everyDays: 30, nextDueDay: 28 },
  ],
  history,
};

// ---------------------------------------------------------------- event cards
const card = (id: string, kindKey: string, severity: EventCard['severity'], trigger: EventCard['trigger'], effect: EventCard['effect']): EventCard => ({ workspaceId: WS, id, kindKey, severity, trigger, effect });
const eventCards: EventCard[] = [
  card('card_large_order', 'largeOrder', 'high', { kind: 'day', day: 1 }, {
    kind: 'largeOrder', customerId: 'cus_demirhan', familyId: 'frames', qty: 920, unitPrice: tl(24_000), requestedInDays: 45, paymentTermsDays: 90,
  }),
  card('card_steel_price', 'supplierPriceIncrease', 'high', { kind: 'day', day: 1 }, {
    kind: 'supplierPriceChange', supplierId: 'sup_kuzeycelik', materialId: 'steel', changeBps: 2000, decisionDays: 7,
    negotiation: { settleBps: 900, volumeQty: 500_000 }, alternativeSupplierId: 'sup_dogumetal',
    customerReaction: { satisfactionDelta: -700, churnRiskDelta: 900, paymentDelayDays: 10 },
  }),
  card('card_discount_demand', 'discountDemand', 'medium', { kind: 'day', day: 9 }, {
    kind: 'discountDemand', customerId: 'cus_velora', discountBps: 800, decisionDays: 5,
    refusal: { satisfactionDelta: -600, churnRiskDelta: 800 }, acceptance: { satisfactionDelta: 300, churnRiskDelta: -500 },
  }),
  card('card_press_breakdown', 'machineBreakdown', 'high', { kind: 'day', day: 16 }, { kind: 'lineBreakdown', lineId: 'p2_press', repairDays: 5 }),
  card('card_late_payment', 'latePayment', 'medium', { kind: 'day', day: 22 }, { kind: 'latePayment', customerId: 'cus_karatas', delayDays: 21 }),
  card('card_export', 'exportOpportunity', 'low', { kind: 'day', day: 40 }, { kind: 'notice' }),
  card('card_turnover', 'turnoverRising', 'medium', { kind: 'turnoverAbove', departmentId: 'operations', thresholdBps: 400, fromDay: 2 }, { kind: 'notice' }),
  card('card_cash_squeeze', 'cashSqueeze', 'high', { kind: 'cashBelow', threshold: tl(5_000_000), fromDay: 2 }, { kind: 'notice' }),
];

// ---------------------------------------------------------------- write
const bundle: SeedBundle = {
  company, departments, plants, productFamilies, materials, suppliers, customers,
  orders: { salesOrders, purchaseOrders }, workforce, finance, eventCards,
};
const check = validateSeedBundle(JSON.parse(JSON.stringify(bundle)));
if (!check.ok) {
  console.error(check.errors.join('\n'));
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(bundle)) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 1) + '\n');
}
console.log(`seed v${SEED_VERSION} written to ${out}`);
