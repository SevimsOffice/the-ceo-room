import type { CompanyState, Order, OrderPlan } from '../model/types';
import { type Bps, type Money, type SimDay, money, ratioBps, timesQty } from '../model/units';
import { deepFreeze } from '../model/freeze';
import { byId } from '../events/reduce';
import { completionDay, family, isOpen, plantQueue, remainingMinutes } from '../systems/capacity';
import { orderCostEstimate, replacementPrice } from '../systems/costing';
import { actualCost } from './metrics';

/** A figure as planned when the order arrived next to its live value (null plan = no plan stored). */
export interface Compared<T> {
  plan: T | null;
  live: T;
  /** true when a plan exists and the live value is different */
  differs: boolean;
}

/**
 * Live order figures next to the plan captured at arrival (OrderPlan). Live = today's prices and
 * schedule: material at the preferred supplier's current price, the queue as it stands, POs as
 * repriced/replaced, the customer's current payment delay.
 */
export interface OrderFigures {
  value: Compared<Money>;
  /** consumed material at actual cost + remaining material at replacement price */
  materialCost: Compared<Money>;
  totalCost: Compared<Money>;
  marginBps: Compared<Bps>;
  promisedDay: Compared<SimDay>;
  /** estimated ship day (same rule as order intake: queue ahead + own work, material, overtime if late) */
  expectedShipDay: Compared<SimDay>;
  /** supplier bills for POs bought for this order (deposit + balance) */
  supplierBills: Compared<Money>;
  /** day the last of those bills falls due (null = no PO for this order) */
  lastSupplierPaymentDay: Compared<SimDay | null>;
  /** expected customer payment day (receivable's expected pay day once invoiced) */
  receivableDay: Compared<SimDay>;
}

const cmp = <T>(plan: T | null, live: T): Compared<T> => ({ plan, live, differs: plan !== null && plan !== live });

/** Plan value = the customer receipt in the plan's cash curve (the order value at arrival). */
function planValue(p: OrderPlan): Money | null {
  const f = p.cash.flows.find((x) => x.kindKey === 'cashflow.customerReceipt');
  return f ? f.amount : null;
}

function planShipDay(p: OrderPlan): SimDay {
  return p.delivery.regularCompletionDay <= p.requestedDay ? p.delivery.regularCompletionDay : p.delivery.overtimeCompletionDay;
}

/** Live material cost: consumed at actual cost, the rest at today's replacement price. */
export function liveMaterialCost(s: CompanyState, o: Order): Money {
  if (!isOpen(o)) return o.materialCost;
  const remainingUnits = o.qty - o.unitsDone;
  let t = o.materialCost as number;
  for (const b of family(s, o.familyId).bom) t += timesQty(replacementPrice(s, b.materialId), remainingUnits * b.qtyPerUnit);
  return money(t);
}

/**
 * Estimated ship day of an order, by the order-intake rule (systems/pipeline.ts) applied to today's
 * queue: regular hours if that meets the promise, else with overtime; never before this order's
 * own open POs are due (a hidden supplier slip is not known in advance).
 */
export function expectedShipDay(s: CompanyState, o: Order): SimDay {
  if (o.shippedDay !== null) return o.shippedDay;
  let ahead = 0;
  for (const q of plantQueue(s, o.plantId)) {
    if (q.id === o.id) break;
    ahead += remainingMinutes(s, q);
  }
  const own = remainingMinutes(s, o);
  let materialReady = s.day;
  for (const po of s.purchaseOrders) {
    if (po.forOrderId === o.id && po.status === 'open' && po.dueDay > materialReady) materialReady = po.dueDay;
  }
  const at = (overtime: boolean): SimDay =>
    Math.max(completionDay(s, o.plantId, s.day, ahead + own, overtime), completionDay(s, o.plantId, materialReady, own, overtime));
  const regular = at(false);
  return regular <= o.promisedDay ? regular : at(true);
}

function liveSupplier(s: CompanyState, o: Order): { bills: Money; lastDay: SimDay | null } {
  let bills = 0;
  let lastDay: SimDay | null = null;
  for (const po of s.purchaseOrders) {
    if (po.forOrderId !== o.id || po.status === 'cancelled') continue;
    bills += timesQty(po.unitPrice, po.qty);
    const balance = s.payables.find((p) => p.source === 'po_balance' && p.poId === po.id);
    const day = balance ? balance.dueDay : po.dueDay + po.paymentTermsDays;
    if (lastDay === null || day > lastDay) lastDay = day;
  }
  return { bills: money(bills), lastDay };
}

/** Live vs plan figures of one order. */
export function orderFigures(s: CompanyState, o: Order): OrderFigures {
  const p = o.plan;
  const totalCost = isOpen(o) ? orderCostEstimate(s, o) : actualCost(s, o.id);
  const ship = expectedShipDay(s, o);
  const sup = liveSupplier(s, o);
  const rcv = s.receivables.find((r) => r.orderId === o.id);
  const customer = byId(s.customers, o.customerId);
  // After invoicing, the receivable itself; before, invoice at the expected ship day + terms + the
  // customer's current delay. (The plan used the promise day, so an early finish shows as a difference.)
  const receivableDay = rcv ? rcv.expectedPayDay : ship + o.paymentTermsDays + customer.paymentDelayDays;
  const planBills = p ? money(p.purchases.reduce((t, x) => t + x.deposit + x.balance, 0)) : null;
  const planLast = p ? (p.purchases.length === 0 ? null : Math.max(...p.purchases.map((x) => x.balanceDueDay))) : null;
  return {
    value: cmp(p ? planValue(p) : null, o.value),
    materialCost: cmp(p ? p.cost.materials : null, liveMaterialCost(s, o)),
    totalCost: cmp(p ? p.cost.total : null, totalCost),
    marginBps: cmp(p ? p.cost.marginBps : null, ratioBps(o.value - totalCost, o.value)),
    promisedDay: cmp(p ? p.delivery.promisedDay : null, o.promisedDay),
    expectedShipDay: cmp(p ? planShipDay(p) : null, ship),
    supplierBills: cmp(planBills, sup.bills),
    lastSupplierPaymentDay: { plan: planLast, live: sup.lastDay, differs: p !== null && planLast !== sup.lastDay },
    receivableDay: cmp(p ? p.cash.receivableDay : null, receivableDay),
  };
}

export interface OrderBookLine {
  orderId: string;
  customerId: string;
  familyId: string;
  plantId: string;
  qty: number;
  status: Order['status'];
  receivedDay: SimDay;
  requestedDay: SimDay;
  unitsDone: number;
  blockedBy: string | null;
  hasPlan: boolean;
  figures: OrderFigures;
  /** true when any figure differs from its plan */
  differs: boolean;
}

export interface OrderBook {
  day: SimDay;
  orders: OrderBookLine[];
  totals: { count: number; value: Money };
}

export function orderBookLine(s: CompanyState, o: Order): OrderBookLine {
  const figures = orderFigures(s, o);
  return {
    orderId: o.id,
    customerId: o.customerId,
    familyId: o.familyId,
    plantId: o.plantId,
    qty: o.qty,
    status: o.status,
    receivedDay: o.receivedDay,
    requestedDay: o.requestedDay,
    unitsDone: o.unitsDone,
    blockedBy: o.blockedBy,
    hasPlan: o.plan !== null,
    figures,
    differs: Object.values(figures).some((f: Compared<unknown>) => f.differs),
  };
}

const bookCache = new WeakMap<CompanyState, OrderBook>();

/** All open orders with live figures and the plan alongside (the Desk's order book). Memoised, frozen. */
export function selectOrderBook(s: CompanyState): OrderBook {
  const hit = bookCache.get(s);
  if (hit) return hit;
  const open = s.orders.filter(isOpen);
  const book: OrderBook = {
    day: s.day,
    orders: open.map((o) => orderBookLine(s, o)),
    totals: { count: open.length, value: money(open.reduce((t, o) => t + o.value, 0)) },
  };
  bookCache.set(s, deepFreeze(book));
  return book;
}
