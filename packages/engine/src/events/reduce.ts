import type { CompanyState } from '../model/types';
import { InvariantError, addM, money, subM } from '../model/units';
import type { GameEvent } from './types';

interface HasId {
  id: string;
}

/**
 * Records entering state from an event payload are stored as copies, so later events never mutate
 * what the ledger recorded (and the ledger never aliases live state).
 */
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function byId<T extends HasId>(arr: readonly T[], id: string): T {
  const x = arr.find((a) => a.id === id);
  if (!x) throw new InvariantError(`unknown id ${id}`);
  return x;
}

/**
 * The reducer. Applies one event to a private draft (a clone owned by the running transaction).
 * Every state change in the engine goes through here.
 */
export function applyEvent(s: CompanyState, e: GameEvent): void {
  s.nextSeq = e.seq + 1;
  switch (e.type) {
    case 'SeedLoaded':
      return;
    case 'CommandAccepted':
      s.nextCommandSeq++;
      return;
    case 'DayStarted':
      s.day = e.payload.day;
      s.dayAcc = { revenue: money(0), cogs: money(0), overtimePersonHours: 0, productionMinutes: 0 };
      return;
    case 'PeriodClosed':
      s.periods.push(copy(e.payload.close));
      return;
    case 'DailyKpiRecorded':
      s.daily.push(copy(e.payload.kpi));
      return;
    case 'RngAdvanced':
      for (const [k, v] of Object.entries(e.payload.streams)) {
        if (v !== undefined) s.rng[k as keyof typeof s.rng] = v;
      }
      return;
    case 'DevelopmentArrived':
      s.developments.push(copy(e.payload.development));
      s.counters.development++;
      if (!s.firedCards.includes(e.payload.development.cardId)) s.firedCards.push(e.payload.development.cardId);
      return;
    case 'DevelopmentRead':
      byId(s.developments, e.payload.developmentId).status = 'read';
      return;
    case 'DevelopmentResolved':
      byId(s.developments, e.payload.developmentId).status = 'resolved';
      return;
    case 'DecisionOpened':
      s.decisions.push(copy(e.payload.decision));
      s.counters.decision++;
      return;
    case 'DecisionResolved': {
      const d = byId(s.decisions, e.payload.decisionId);
      d.status = e.payload.status;
      d.chosenOptionId = e.payload.optionId;
      d.custom = copy(e.payload.custom);
      d.decidedDay = e.day;
      return;
    }
    case 'DecisionDefaultFailed':
      return;
    case 'AnalysisRequested':
      byId(s.decisions, e.payload.decisionId).analysis = { requestedDay: e.day, readyDay: e.payload.readyDay };
      return;
    case 'OrderReceived':
      s.orders.push(copy(e.payload.order));
      s.counters.order++;
      return;
    case 'OrderPlanned': {
      const o = byId(s.orders, e.payload.orderId);
      o.plantId = e.payload.plantId;
      o.promisedDay = e.payload.promisedDay;
      o.costEstimate = e.payload.costEstimate;
      o.plan = copy(e.payload.plan);
      o.status = 'scheduled';
      return;
    }
    case 'OrderRecosted':
      byId(s.orders, e.payload.orderId).costEstimate = e.payload.costEstimate;
      return;
    case 'OrderRepriced': {
      const o = byId(s.orders, e.payload.orderId);
      o.listUnitPrice = e.payload.listUnitPrice;
      o.unitPrice = e.payload.unitPrice;
      o.value = e.payload.value;
      return;
    }
    case 'OrderShipped': {
      const o = byId(s.orders, e.payload.orderId);
      o.status = 'invoiced';
      o.shippedDay = e.day;
      o.blockedBy = null;
      s.dayAcc.revenue = addM(s.dayAcc.revenue, e.payload.revenue);
      s.dayAcc.cogs = addM(s.dayAcc.cogs, e.payload.cogs);
      return;
    }
    case 'OrderPaid':
      byId(s.orders, e.payload.orderId).status = 'paid';
      return;
    case 'PurchaseOrderPlaced':
      s.purchaseOrders.push(copy(e.payload.po));
      s.counters.po++;
      return;
    case 'PurchaseOrderRepriced':
      byId(s.purchaseOrders, e.payload.poId).unitPrice = e.payload.unitPrice;
      return;
    case 'PurchaseOrderCancelled':
      byId(s.purchaseOrders, e.payload.poId).status = 'cancelled';
      return;
    case 'PurchaseOrderDelayed': {
      const po = byId(s.purchaseOrders, e.payload.poId);
      po.dueDay = e.payload.newDueDay;
      po.delayDays = 0;
      return;
    }
    case 'PurchaseOrderDelivered': {
      const po = byId(s.purchaseOrders, e.payload.poId);
      po.status = 'delivered';
      const m = byId(s.materials, po.materialId);
      m.stockQty += e.payload.qty;
      m.stockValue = addM(m.stockValue, e.payload.value);
      return;
    }
    case 'PayableCreated':
      s.payables.push(copy(e.payload.payable));
      s.counters.payable++;
      return;
    case 'PayableSettled': {
      const p = byId(s.payables, e.payload.payableId);
      if (p.status !== 'open') throw new InvariantError(`payable ${p.id} settled twice`);
      p.status = 'settled';
      s.cash = subM(s.cash, e.payload.amount);
      return;
    }
    case 'PayableCancelled': {
      const p = byId(s.payables, e.payload.payableId);
      if (p.status !== 'open') throw new InvariantError(`payable ${p.id} cancelled while ${p.status}`);
      p.status = 'cancelled';
      return;
    }
    case 'DepositForfeited':
      if (byId(s.payables, e.payload.payableId).status !== 'settled') throw new InvariantError(`deposit ${e.payload.payableId} forfeited but not paid`);
      return;
    case 'ReceivableCreated':
      s.receivables.push(copy(e.payload.receivable));
      s.counters.receivable++;
      return;
    case 'ReceivableCollected': {
      const r = byId(s.receivables, e.payload.receivableId);
      if (r.status !== 'open') throw new InvariantError(`receivable ${r.id} collected twice`);
      r.status = 'collected';
      s.cash = addM(s.cash, e.payload.amount);
      return;
    }
    case 'ReceivableDelayed':
      byId(s.receivables, e.payload.receivableId).expectedPayDay = e.payload.expectedPayDay;
      return;
    case 'RecurringCostPaid': {
      const c = byId(s.recurringCosts, e.payload.costId);
      c.nextDueDay = e.payload.nextDueDay;
      s.cash = subM(s.cash, e.payload.amount);
      if (c.kind === 'payroll') s.accruals.overtime = subM(s.accruals.overtime, e.payload.variable);
      if (c.kind === 'utilities') s.accruals.energy = subM(s.accruals.energy, e.payload.variable);
      return;
    }
    case 'SupplierPriceChanged': {
      const sup = byId(s.suppliers, e.payload.supplierId);
      const offer = sup.offers.find((o) => o.materialId === e.payload.materialId);
      if (!offer) throw new InvariantError('offer missing');
      offer.unitPrice = e.payload.unitPrice;
      return;
    }
    case 'PreferredSupplierChanged':
      byId(s.materials, e.payload.materialId).preferredSupplierId = e.payload.supplierId;
      return;
    case 'SupplierOnboardingStarted': {
      const sup = byId(s.suppliers, e.payload.supplierId);
      sup.established = true;
      sup.firstDeliveryDay = e.payload.firstDeliveryDay;
      return;
    }
    case 'ProductionProgressed': {
      const o = byId(s.orders, e.payload.orderId);
      o.minutesDone += e.payload.minutes;
      o.unitsDone += e.payload.units;
      o.status = 'in_production';
      let matCost = 0;
      for (const c of e.payload.consumed) {
        const m = byId(s.materials, c.materialId);
        m.stockQty -= c.qty;
        m.stockValue = subM(m.stockValue, c.value);
        if (m.stockQty < 0) throw new InvariantError(`negative stock ${m.id}`);
        matCost += c.value;
      }
      o.materialCost = addM(o.materialCost, money(matCost));
      o.energyCost = addM(o.energyCost, e.payload.energyCost);
      s.accruals.energy = addM(s.accruals.energy, e.payload.energyCost);
      s.dayAcc.productionMinutes += e.payload.minutes;
      return;
    }
    case 'MaterialShortage':
      byId(s.orders, e.payload.orderId).blockedBy = e.payload.materialId;
      return;
    case 'ProductionResumed':
      byId(s.orders, e.payload.orderId).blockedBy = null;
      return;
    case 'OvertimeWorked':
      s.accruals.overtime = addM(s.accruals.overtime, e.payload.cost);
      s.dayAcc.overtimePersonHours += e.payload.personHours;
      return;
    case 'LineDown': {
      const l = byId(s.lines, e.payload.lineId);
      l.status = 'down';
      l.repairDueDay = e.payload.repairDueDay;
      return;
    }
    case 'LineRepaired': {
      const l = byId(s.lines, e.payload.lineId);
      l.status = 'running';
      l.repairDueDay = null;
      return;
    }
    case 'CustomerSatisfactionChanged': {
      const c = byId(s.customers, e.payload.customerId);
      c.satisfaction = e.payload.satisfaction;
      c.churnRisk = e.payload.churnRisk;
      return;
    }
    case 'CustomerTermsChanged': {
      const c = byId(s.customers, e.payload.customerId);
      c.paymentDelayDays = e.payload.paymentDelayDays;
      c.discountBps = e.payload.discountBps;
      return;
    }
    case 'CustomerChurned':
      byId(s.customers, e.payload.customerId).status = 'churned';
      return;
    case 'CustomerOrderCycleAdvanced': {
      const c = byId(s.customers, e.payload.customerId);
      if (c.demand) c.demand.nextOrderDay = e.payload.nextOrderDay;
      return;
    }
    case 'EmployeeLeft': {
      const w = s.workforce.find((r) => r.departmentId === e.payload.departmentId);
      if (!w) throw new InvariantError('workforce row missing');
      w.headcount = e.payload.headcount;
      return;
    }
  }
}
