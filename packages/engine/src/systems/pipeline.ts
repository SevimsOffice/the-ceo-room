import type { Order, OrderPlan } from '../model/types';
import { type Money, type SimDay, money, mulDiv, ratioBps, subM, timesQty } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, fromEvent } from '../events/tx';
import type { Cause } from '../events/types';
import { availableMinutes, completionDay, family, plantQueue, remainingMinutes } from './capacity';
import { freePosition, orderCostEstimate, replacementPrice } from './costing';
import { pad, placePurchaseOrder } from './procurement';

export interface OrderInput {
  customerId: string;
  familyId: string;
  qty: number;
  /** price before the customer's discount */
  listUnitPrice: Money;
  unitPrice: Money;
  requestedDay: SimDay;
  paymentTermsDays: number;
  source: Order['source'];
}

/**
 * Cross-department order pipeline (SIMULATION_DESIGN §4):
 * Sales registers → Operations capacity check → Procurement material check / PO → Finance cost and
 * cash curve → People overtime need → Operations delivery date → Sales customer commitment.
 */
export function registerOrder(tx: Tx, input: OrderInput, cause: Cause): Order {
  const s = tx.s;
  const fam = family(s, input.familyId);
  const value = timesQty(input.unitPrice, input.qty);
  const order: Order = {
    workspaceId: s.workspaceId,
    id: `ord-${pad(s.counters.order)}`,
    customerId: input.customerId,
    familyId: input.familyId,
    plantId: '',
    qty: input.qty,
    listUnitPrice: input.listUnitPrice,
    unitPrice: input.unitPrice,
    value,
    paymentTermsDays: input.paymentTermsDays,
    receivedDay: s.day,
    requestedDay: input.requestedDay,
    promisedDay: input.requestedDay,
    status: 'registered',
    minutesDone: 0,
    unitsDone: 0,
    materialCost: money(0),
    energyCost: money(0),
    costEstimate: money(0),
    blockedBy: null,
    shippedDay: null,
    source: input.source,
    plan: null,
  };
  const received = tx.emit('OrderReceived', { order }, cause, {
    orderId: order.id,
    customerId: order.customerId,
    familyId: order.familyId,
    qty: order.qty,
    value,
    requestedDay: order.requestedDay,
  });
  const why = fromEvent(received);
  const own = order.qty * fam.minutesPerUnit;

  // Operations: capacity check per candidate plant; take the plant with most free minutes.
  let best: { plantId: string; ahead: number; free: number } | null = null;
  for (const p of s.plants) {
    if (!p.productFamilies.includes(fam.id)) continue;
    const ahead = plantQueue(s, p.id)
      .filter((o) => o.promisedDay <= order.requestedDay)
      .reduce((t, o) => t + remainingMinutes(s, o), 0);
    const free = availableMinutes(s, p.id, s.day, order.requestedDay) - ahead;
    if (!best || free > best.free) best = { plantId: p.id, ahead, free };
  }
  if (!best) throw new Error(`no plant makes ${fam.id}`);
  const plantId = best.plantId;

  // Procurement: material check per BOM. Available = free position (stock + inbound − near-term
  // needs within the MRP horizon − safety stock); the order buys only what that does not cover.
  const materials: OrderPlan['materials'] = [];
  const purchases: OrderPlan['purchases'] = [];
  let materialReadyDay = s.day;
  for (const b of fam.bom) {
    const need = order.qty * b.qtyPerUnit;
    const m = byId(s.materials, b.materialId);
    const available = freePosition(s, m.id, order.id);
    const shortage = Math.max(0, need - Math.max(0, available));
    materials.push({ materialId: m.id, need, available, shortage });
    if (shortage === 0) continue;
    const qty = Math.ceil(shortage / m.lotSize) * m.lotSize;
    const po = placePurchaseOrder(tx, { supplierId: m.preferredSupplierId, materialId: m.id, qty, forOrderId: order.id }, why);
    if (!po) continue;
    const amount = timesQty(po.unitPrice, po.qty);
    purchases.push({
      poId: po.id,
      supplierId: po.supplierId,
      materialId: po.materialId,
      qty: po.qty,
      unitPrice: po.unitPrice,
      dueDay: po.dueDay,
      deposit: po.deposit,
      balance: subM(amount, po.deposit),
      balanceDueDay: po.dueDay + po.paymentTermsDays,
    });
    if (po.dueDay > materialReadyDay) materialReadyDay = po.dueDay;
  }

  // Operations + People: delivery date with and without overtime.
  const regular = Math.max(
    completionDay(s, plantId, s.day, best.ahead + own, false),
    completionDay(s, plantId, materialReadyDay, own, false),
  );
  const withOt = Math.max(
    completionDay(s, plantId, s.day, best.ahead + own, true),
    completionDay(s, plantId, materialReadyDay, own, true),
  );
  let promisedDay = order.requestedDay;
  if (regular > order.requestedDay) promisedDay = Math.max(order.requestedDay, withOt);
  const lateDays = promisedDay - order.requestedDay;
  const otEnd = Math.min(promisedDay, Math.max(order.requestedDay, s.day));
  const shortMinutes = regular > order.requestedDay ? Math.max(0, best.ahead + own - availableMinutes(s, plantId, s.day, otEnd)) : 0;
  const overtimeLineHours = Math.ceil(shortMinutes / 60);
  const overtimePersonHours = overtimeLineHours * s.settings.overtimeCrewPerLine;

  // Finance: production cost, margin, cash curve.
  let matCost = 0;
  for (const b of fam.bom) matCost += timesQty(replacementPrice(s, b.materialId), order.qty * b.qtyPerUnit);
  const labour = mulDiv(s.settings.labourCostPerLineHour, own, 60);
  const energy = mulDiv(s.settings.energyCostPerLineHour, own, 60);
  const total = money(matCost + labour + energy);
  const customer = byId(s.customers, order.customerId);
  const receivableDay = promisedDay + order.paymentTermsDays + customer.paymentDelayDays;
  const flows: OrderPlan['cash']['flows'] = [];
  for (const p of purchases) {
    if (p.deposit > 0) flows.push({ day: s.day, amount: money(-p.deposit), kindKey: 'cashflow.supplierDeposit' });
    flows.push({ day: p.balanceDueDay, amount: money(-p.balance), kindKey: 'cashflow.supplierPayment' });
  }
  flows.push({ day: promisedDay, amount: money(-energy), kindKey: 'cashflow.energy' });
  if (overtimePersonHours > 0) {
    flows.push({
      day: promisedDay,
      amount: money(-overtimePersonHours * s.settings.overtimeRatePerPersonHour),
      kindKey: 'cashflow.overtime',
    });
  }
  flows.push({ day: receivableDay, amount: value, kindKey: 'cashflow.customerReceipt' });
  flows.sort((a, b) => a.day - b.day || a.amount - b.amount);
  let cum = 0;
  let peak = 0;
  let peakDay = s.day;
  for (const f of flows) {
    cum += f.amount;
    if (cum < peak) {
      peak = cum;
      peakDay = f.day;
    }
  }

  const plan: OrderPlan = {
    plantId,
    requestedDay: order.requestedDay,
    capacity: {
      minutesRequired: own,
      minutesAhead: best.ahead,
      freeMinutesUntilRequested: best.free,
      fits: best.free >= own,
    },
    materials,
    purchases,
    cost: { materials: money(matCost), labour, energy, total, marginBps: ratioBps(value - total, value) },
    cash: { flows, peakNeed: money(-peak), peakNeedDay: peakDay, receivableDay },
    people: { overtimeLineHours, overtimePersonHours },
    delivery: {
      materialReadyDay,
      regularCompletionDay: regular,
      overtimeCompletionDay: withOt,
      promisedDay,
      lateDays,
    },
  };
  const placed = { ...order, plantId, promisedDay };
  const estimate = orderCostEstimate(s, placed);
  tx.emit('OrderPlanned', { orderId: order.id, plantId, promisedDay, costEstimate: estimate, plan }, why, {
    orderId: order.id,
    plantId,
    promisedDay,
    lateDays,
    overtimeLineHours,
    marginBps: plan.cost.marginBps,
  });
  return byId(s.orders, order.id);
}
