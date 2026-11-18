import type { Bps, Money, Score, SimDay } from './units';
import type { StreamName } from '../rng/rng';
import type { OperationalCommand } from '../commands/types';

/** i18n message: the engine emits codes + params, never sentences. */
export type I18nParams = Record<string, string | number | boolean>;
export interface Msg {
  code: string;
  params: I18nParams;
}

export type WorkspaceId = string;
export type DepartmentId = 'sales' | 'operations' | 'procurement' | 'finance' | 'people' | 'cx';
export const DEPARTMENT_IDS: readonly DepartmentId[] = [
  'sales',
  'operations',
  'procurement',
  'finance',
  'people',
  'cx',
];

export interface Settings {
  periodLengthDays: number;
  runwayHorizonDays: number;
  /** labour cost per line-hour used in order cost estimates (cash = payroll) */
  labourCostPerLineHour: Money;
  energyCostPerLineHour: Money;
  overtimeCrewPerLine: number;
  overtimeRatePerPersonHour: Money;
  maxOvertimeHoursPerLineDay: number;
  mrpCoverDays: number;
  /** turnover bps added per overtime person-hour per head over the trailing period */
  turnoverBpsPerOvertimeHourPerHead: Bps;
}

export interface Company {
  workspaceId: WorkspaceId;
  id: string;
  nameKey: string;
  city: string;
  currency: string;
  simulated: true;
  seedVersion: number;
}

export interface Department {
  workspaceId: WorkspaceId;
  id: DepartmentId;
  nameKey: string;
  headName: string;
  headTitleKey: string;
  kpis: string[];
  constraints: Msg[];
  activeTasks: Msg[];
  risks: Msg[];
  dependsOn: DepartmentId[];
}

export interface WorkforceRow {
  workspaceId: WorkspaceId;
  departmentId: DepartmentId;
  headcount: number;
  baseTurnoverBps: Bps;
  avgMonthlyCost: Money;
}

export interface Plant {
  workspaceId: WorkspaceId;
  id: string;
  name: string;
  city: string;
  headcount: number;
  productFamilies: string[];
}

export interface ProductionLine {
  workspaceId: WorkspaceId;
  id: string;
  plantId: string;
  kindKey: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  status: 'running' | 'down';
  /** first day the line runs again (null = not scheduled) */
  repairDueDay: SimDay | null;
}

export interface BomLine {
  materialId: string;
  qtyPerUnit: number;
}

export interface ProductFamily {
  workspaceId: WorkspaceId;
  id: string;
  nameKey: string;
  unitPrice: Money;
  minutesPerUnit: number;
  bom: BomLine[];
}

export interface Material {
  workspaceId: WorkspaceId;
  id: string;
  nameKey: string;
  unit: 'kg' | 'pcs' | 'set';
  stockQty: number;
  stockValue: Money;
  safetyStock: number;
  lotSize: number;
  preferredSupplierId: string;
}

export interface SupplierOffer {
  materialId: string;
  unitPrice: Money;
  leadTimeDays: number;
}

export interface Supplier {
  workspaceId: WorkspaceId;
  id: string;
  name: string;
  country: string;
  offers: SupplierOffer[];
  paymentTermsDays: number;
  /** share of each PO paid up front at placement */
  depositBps: Bps;
  reliabilityBps: Bps;
  /** extra days on the first delivery from a supplier we have not bought from */
  onboardingDays: number;
  established: boolean;
  /** earliest delivery day once onboarding started (null = not started / established) */
  firstDeliveryDay: SimDay | null;
}

export interface CustomerDemand {
  familyId: string;
  qtyMin: number;
  qtyMax: number;
  cadenceDays: number;
  leadDays: number;
  nextOrderDay: SimDay;
}

export interface Customer {
  workspaceId: WorkspaceId;
  id: string;
  name: string;
  segmentKey: string;
  country: string;
  key: boolean;
  paymentTermsDays: number;
  paymentDelayDays: number;
  satisfaction: Score;
  churnRisk: Bps;
  discountBps: Bps;
  annualRevenue: Money;
  status: 'active' | 'churned';
  demand: CustomerDemand | null;
}

export type OrderStatus =
  | 'registered'
  | 'scheduled'
  | 'in_production'
  | 'shipped'
  | 'invoiced'
  | 'paid';

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['registered', 'scheduled', 'in_production'];

export interface OrderPlan {
  plantId: string;
  requestedDay: SimDay;
  capacity: {
    minutesRequired: number;
    minutesAhead: number;
    freeMinutesUntilRequested: number;
    fits: boolean;
  };
  materials: { materialId: string; need: number; available: number; shortage: number }[];
  purchases: {
    poId: string;
    supplierId: string;
    materialId: string;
    qty: number;
    unitPrice: Money;
    dueDay: SimDay;
    deposit: Money;
    balance: Money;
    balanceDueDay: SimDay;
  }[];
  cost: { materials: Money; labour: Money; energy: Money; total: Money; marginBps: Bps };
  cash: {
    flows: { day: SimDay; amount: Money; kindKey: string }[];
    peakNeed: Money;
    peakNeedDay: SimDay;
    receivableDay: SimDay;
  };
  people: { overtimeLineHours: number; overtimePersonHours: number };
  delivery: {
    materialReadyDay: SimDay;
    regularCompletionDay: SimDay;
    overtimeCompletionDay: SimDay;
    promisedDay: SimDay;
    lateDays: number;
  };
}

export interface Order {
  workspaceId: WorkspaceId;
  id: string;
  customerId: string;
  familyId: string;
  plantId: string;
  qty: number;
  unitPrice: Money;
  value: Money;
  paymentTermsDays: number;
  receivedDay: SimDay;
  requestedDay: SimDay;
  promisedDay: SimDay;
  status: OrderStatus;
  minutesDone: number;
  unitsDone: number;
  materialCost: Money;
  energyCost: Money;
  costEstimate: Money;
  blockedBy: string | null;
  shippedDay: SimDay | null;
  source: 'seed' | 'card' | 'demand';
  plan: OrderPlan | null;
}

export interface PurchaseOrder {
  workspaceId: WorkspaceId;
  id: string;
  supplierId: string;
  materialId: string;
  qty: number;
  unitPrice: Money;
  orderedDay: SimDay;
  /** supplier-confirmed delivery day */
  dueDay: SimDay;
  /** hidden extra delay drawn from the `suppliers` stream at placement */
  delayDays: number;
  deposit: Money;
  paymentTermsDays: number;
  status: 'open' | 'delivered' | 'cancelled';
  forOrderId: string | null;
}

export interface Receivable {
  workspaceId: WorkspaceId;
  id: string;
  source: 'opening' | 'order';
  orderId: string | null;
  customerId: string;
  amount: Money;
  issuedDay: SimDay;
  dueDay: SimDay;
  expectedPayDay: SimDay;
  status: 'open' | 'collected';
}

export interface Payable {
  workspaceId: WorkspaceId;
  id: string;
  source: 'opening' | 'po_deposit' | 'po_balance';
  poId: string | null;
  counterpartyId: string;
  amount: Money;
  dueDay: SimDay;
  status: 'open' | 'settled';
}

export interface RecurringCost {
  workspaceId: WorkspaceId;
  id: string;
  /** payroll = workforce cost + accrued overtime; utilities = fixed + accrued energy; others fixed */
  kind: 'payroll' | 'payroll_tax' | 'overhead' | 'utilities' | 'debt_service';
  amount: Money;
  everyDays: number;
  nextDueDay: SimDay;
}

export interface PeriodClose {
  workspaceId: WorkspaceId;
  period: number;
  revenue: Money;
  cogs: Money;
  avgSatisfaction: Score;
  overtimePersonHours: number;
  closingCash: Money | null;
}

export interface DailyKpi {
  day: SimDay;
  period: number;
  cash: Money;
  revenue: Money;
  cogs: Money;
  overtimePersonHours: number;
  productionMinutes: number;
  avgSatisfaction: Score;
  backlogValue: Money;
  openOrders: number;
}

export type CardTrigger =
  | { kind: 'day'; day: SimDay }
  | { kind: 'cashBelow'; threshold: Money; fromDay: SimDay }
  | { kind: 'turnoverAbove'; departmentId: DepartmentId; thresholdBps: Bps; fromDay: SimDay };

export type CardEffect =
  | {
      kind: 'largeOrder';
      customerId: string;
      familyId: string;
      qty: number;
      unitPrice: Money;
      requestedInDays: number;
      paymentTermsDays: number;
    }
  | {
      kind: 'supplierPriceChange';
      supplierId: string;
      materialId: string;
      changeBps: Bps;
      decisionDays: number;
      negotiation: { settleBps: Bps; volumeQty: number };
      alternativeSupplierId: string;
      customerReaction: { satisfactionDelta: Score; churnRiskDelta: Bps; paymentDelayDays: number };
    }
  | { kind: 'discountDemand'; customerId: string; discountBps: Bps; decisionDays: number; refusal: { satisfactionDelta: Score; churnRiskDelta: Bps }; acceptance: { satisfactionDelta: Score; churnRiskDelta: Bps } }
  | { kind: 'lineBreakdown'; lineId: string; repairDays: number }
  | { kind: 'latePayment'; customerId: string; delayDays: number }
  | { kind: 'notice' };

export interface EventCard {
  workspaceId: WorkspaceId;
  id: string;
  kindKey: string;
  severity: 'high' | 'medium' | 'low';
  trigger: CardTrigger;
  effect: CardEffect;
}

export interface Development {
  workspaceId: WorkspaceId;
  id: string;
  cardId: string;
  day: SimDay;
  severity: 'high' | 'medium' | 'low';
  message: Msg;
  status: 'new' | 'read' | 'resolved';
  decisionId: string | null;
  orderId: string | null;
}

export interface DecisionOption {
  id: string;
  labelKey: string;
  commands: OperationalCommand[];
  assumptions: Msg[];
}

export type DecisionStatus = 'open' | 'approved' | 'rejected' | 'expired';

export interface Decision {
  workspaceId: WorkspaceId;
  id: string;
  kind: 'supplierPrice' | 'discountDemand';
  developmentId: string;
  cardId: string;
  situation: Msg;
  status: DecisionStatus;
  openedDay: SimDay;
  deadlineDay: SimDay;
  defaultOptionId: string;
  options: DecisionOption[];
  chosenOptionId: string | null;
  decidedDay: SimDay | null;
  analysis: { requestedDay: SimDay; readyDay: SimDay } | null;
  custom: OperationalCommand[] | null;
}

export interface Counters {
  order: number;
  po: number;
  receivable: number;
  payable: number;
  development: number;
  decision: number;
}

/** Per-day accumulators, reset at DayStarted, folded into DailyKpi at day end. */
export interface DayAccumulator {
  revenue: Money;
  cogs: Money;
  overtimePersonHours: number;
  productionMinutes: number;
}

export interface CompanyState {
  workspaceId: WorkspaceId;
  seedVersion: number;
  rngSeed: number;
  day: SimDay;
  nextSeq: number;
  nextCommandSeq: number;
  counters: Counters;
  settings: Settings;
  company: Company;
  departments: Department[];
  workforce: WorkforceRow[];
  plants: Plant[];
  lines: ProductionLine[];
  productFamilies: ProductFamily[];
  materials: Material[];
  suppliers: Supplier[];
  customers: Customer[];
  orders: Order[];
  purchaseOrders: PurchaseOrder[];
  receivables: Receivable[];
  payables: Payable[];
  recurringCosts: RecurringCost[];
  openingCash: Money;
  cash: Money;
  accruals: { overtime: Money; energy: Money };
  dayAcc: DayAccumulator;
  periods: PeriodClose[];
  daily: DailyKpi[];
  eventCards: EventCard[];
  firedCards: string[];
  developments: Development[];
  decisions: Decision[];
  rng: Record<StreamName, number>;
}
