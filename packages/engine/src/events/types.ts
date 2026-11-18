import type { Money, Score, SimDay, Bps } from '../model/units';
import type {
  DailyKpi,
  Decision,
  DecisionStatus,
  Development,
  I18nParams,
  Order,
  OrderPlan,
  Payable,
  PeriodClose,
  PurchaseOrder,
  Receivable,
  DepartmentId,
  WorkspaceId,
} from '../model/types';
import type { StreamName } from '../rng/rng';
import type { OperationalCommand } from '../commands/types';

/** Why an event happened (ADR-0005). */
export type Cause =
  | { kind: 'command'; commandId: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'event'; seq: number };

export interface EventPayloads {
  SeedLoaded: { seedVersion: number };
  CommandAccepted: { commandId: string; commandType: string };
  DayStarted: { day: SimDay };
  PeriodClosed: { close: PeriodClose };
  DailyKpiRecorded: { kpi: DailyKpi };
  RngAdvanced: { streams: Partial<Record<StreamName, number>> };
  DevelopmentArrived: { development: Development };
  DevelopmentRead: { developmentId: string };
  DevelopmentResolved: { developmentId: string };
  DecisionOpened: { decision: Decision };
  DecisionResolved: {
    decisionId: string;
    status: Exclude<DecisionStatus, 'open'>;
    optionId: string | null;
    custom: OperationalCommand[] | null;
  };
  AnalysisRequested: { decisionId: string; readyDay: SimDay };
  OrderReceived: { order: Order };
  OrderPlanned: { orderId: string; plantId: string; promisedDay: SimDay; costEstimate: Money; plan: OrderPlan };
  OrderRecosted: { orderId: string; costEstimate: Money };
  OrderRepriced: { orderId: string; unitPrice: Money; value: Money };
  OrderShipped: { orderId: string; lateDays: number; revenue: Money; cogs: Money };
  OrderPaid: { orderId: string };
  PurchaseOrderPlaced: { po: PurchaseOrder };
  PurchaseOrderRepriced: { poId: string; unitPrice: Money };
  PurchaseOrderCancelled: { poId: string };
  PurchaseOrderDelayed: { poId: string; newDueDay: SimDay };
  PurchaseOrderDelivered: { poId: string; qty: number; value: Money };
  PayableCreated: { payable: Payable };
  PayableSettled: { payableId: string; amount: Money };
  ReceivableCreated: { receivable: Receivable };
  ReceivableCollected: { receivableId: string; amount: Money };
  ReceivableDelayed: { receivableId: string; expectedPayDay: SimDay };
  RecurringCostPaid: { costId: string; amount: Money; variable: Money; nextDueDay: SimDay };
  SupplierPriceChanged: { supplierId: string; materialId: string; previousPrice: Money; unitPrice: Money };
  PreferredSupplierChanged: { materialId: string; supplierId: string; previousSupplierId: string };
  SupplierOnboardingStarted: { supplierId: string; firstDeliveryDay: SimDay };
  ProductionProgressed: {
    orderId: string;
    plantId: string;
    minutes: number;
    units: number;
    consumed: { materialId: string; qty: number; value: Money }[];
    energyCost: Money;
  };
  MaterialShortage: { orderId: string; materialId: string };
  ProductionResumed: { orderId: string };
  OvertimeWorked: { plantId: string; lineMinutes: number; personHours: number; cost: Money };
  LineDown: { lineId: string; repairDueDay: SimDay };
  LineRepaired: { lineId: string };
  CustomerSatisfactionChanged: { customerId: string; delta: Score; satisfaction: Score; churnRisk: Bps; reasonCode: string };
  CustomerTermsChanged: { customerId: string; paymentDelayDays: number; discountBps: Bps };
  CustomerChurned: { customerId: string };
  CustomerOrderCycleAdvanced: { customerId: string; nextOrderDay: SimDay };
  EmployeeLeft: { departmentId: DepartmentId; headcount: number };
}

export type EventType = keyof EventPayloads;

export type GameEvent = {
  [K in EventType]: {
    seq: number;
    day: SimDay;
    workspaceId: WorkspaceId;
    type: K;
    cause: Cause;
    /** i18n code for the ledger line */
    code: string;
    params: I18nParams;
    payload: EventPayloads[K];
  };
}[EventType];

export type EventOf<K extends EventType> = Extract<GameEvent, { type: K }>;

/** A ledger entry is the event itself (it already carries code + params). */
export type LedgerEntry = GameEvent;
