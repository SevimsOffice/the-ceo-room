import type { PurchaseOrder } from '../model/types';
import { type Money, mulBps, subM, timesQty } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, rule, fromEvent } from '../events/tx';
import type { Cause } from '../events/types';
import { chanceBps, intBelow } from '../rng/rng';
import { allocatedQty, inboundQty, offerOf, orderCostEstimate } from './costing';
import { openOrders } from './capacity';

export const pad = (n: number): string => String(n).padStart(4, '0');

/** Days within which an undelivered PO counts as in transit and can no longer be cancelled. */
export const IN_TRANSIT_DAYS = 2;

export function plannedDueDay(tx: Tx, supplierId: string, materialId: string): number {
  const s = tx.s;
  const sup = byId(s.suppliers, supplierId);
  const offer = offerOf(s, supplierId, materialId);
  const lead = offer ? offer.leadTimeDays : 0;
  let due = s.day + lead;
  const first = sup.firstDeliveryDay ?? (sup.established ? null : s.day + lead + sup.onboardingDays);
  if (first !== null && first > due) due = first;
  return due;
}

export function placePurchaseOrder(
  tx: Tx,
  input: { supplierId: string; materialId: string; qty: number; forOrderId: string | null },
  cause: Cause,
): PurchaseOrder | null {
  const s = tx.s;
  const sup = byId(s.suppliers, input.supplierId);
  const offer = offerOf(s, input.supplierId, input.materialId);
  if (!offer || input.qty <= 0) return null;
  const due = plannedDueDay(tx, input.supplierId, input.materialId);
  if (!sup.established) {
    tx.emit('SupplierOnboardingStarted', { supplierId: sup.id, firstDeliveryDay: due }, cause, {
      supplierId: sup.id,
      firstDeliveryDay: due,
    });
  }
  // Reliability: a failed draw hides a 2–6 day slip, revealed on the due day.
  const late = chanceBps(tx.draw('suppliers'), 10000 - sup.reliabilityBps);
  const delayDays = late ? 2 + intBelow(tx.draw('suppliers'), 5) : 0;
  const amount = timesQty(offer.unitPrice, input.qty);
  const deposit = mulBps(amount, sup.depositBps);
  const po: PurchaseOrder = {
    workspaceId: s.workspaceId,
    id: `po-${pad(s.counters.po)}`,
    supplierId: sup.id,
    materialId: input.materialId,
    qty: input.qty,
    unitPrice: offer.unitPrice,
    orderedDay: s.day,
    dueDay: due,
    delayDays,
    deposit,
    paymentTermsDays: sup.paymentTermsDays,
    status: 'open',
    forOrderId: input.forOrderId,
  };
  const ev = tx.emit('PurchaseOrderPlaced', { po }, cause, {
    poId: po.id,
    supplierId: sup.id,
    materialId: po.materialId,
    qty: po.qty,
    amount,
    dueDay: due,
  });
  if (deposit > 0) {
    tx.emit(
      'PayableCreated',
      {
        payable: {
          workspaceId: s.workspaceId,
          id: `pay-${pad(s.counters.payable)}`,
          source: 'po_deposit',
          poId: po.id,
          counterpartyId: sup.id,
          amount: deposit,
          dueDay: s.day,
          status: 'open',
        },
      },
      fromEvent(ev),
      { poId: po.id, amount: deposit, dueDay: s.day },
    );
  }
  tx.flushRng(fromEvent(ev));
  return po;
}

/** Step 3a: POs due today arrive (or reveal their slip); deliveries create the balance payable. */
export function runDeliveries(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.procurement.deliveries');
  const due = s.purchaseOrders.filter((p) => p.status === 'open' && p.dueDay <= s.day);
  for (const po of due) {
    if (po.delayDays > 0) {
      tx.emit('PurchaseOrderDelayed', { poId: po.id, newDueDay: s.day + po.delayDays }, cause, {
        poId: po.id,
        supplierId: po.supplierId,
        delayDays: po.delayDays,
      });
      continue;
    }
    const value = timesQty(po.unitPrice, po.qty);
    const ev = tx.emit('PurchaseOrderDelivered', { poId: po.id, qty: po.qty, value }, cause, {
      poId: po.id,
      materialId: po.materialId,
      qty: po.qty,
    });
    const balance = subM(value, po.deposit);
    if (balance > 0) {
      tx.emit(
        'PayableCreated',
        {
          payable: {
            workspaceId: s.workspaceId,
            id: `pay-${pad(s.counters.payable)}`,
            source: 'po_balance',
            poId: po.id,
            counterpartyId: po.supplierId,
            amount: balance,
            dueDay: s.day + po.paymentTermsDays,
            status: 'open',
          },
        },
        fromEvent(ev),
        { poId: po.id, amount: balance, dueDay: s.day + po.paymentTermsDays },
      );
    }
  }
}

/** Step 3b: reorder so stock + inbound covers open-order need within lead time + cover days. */
export function runMrp(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.procurement.mrp');
  for (const m of s.materials) {
    const due = plannedDueDay(tx, m.preferredSupplierId, m.id);
    const horizon = due + s.settings.mrpCoverDays;
    const requirement = allocatedQty(s, m.id, undefined, horizon) + m.safetyStock;
    const position = m.stockQty + inboundQty(s, m.id);
    const short = requirement - position;
    if (short <= 0) continue;
    const qty = Math.ceil(short / m.lotSize) * m.lotSize;
    placePurchaseOrder(tx, { supplierId: m.preferredSupplierId, materialId: m.id, qty, forOrderId: null }, cause);
  }
}

/** Re-estimate cost of every open order (after a price or supplier change). */
export function recostOpenOrders(tx: Tx, cause: Cause): void {
  for (const o of openOrders(tx.s)) {
    const est = orderCostEstimate(tx.s, o);
    if (est !== o.costEstimate) {
      tx.emit('OrderRecosted', { orderId: o.id, costEstimate: est }, cause, {
        orderId: o.id,
        costEstimate: est,
        previous: o.costEstimate,
      });
    }
  }
}

/** Supplier price change: reprice undelivered POs from that supplier, re-cost open orders. */
export function changeSupplierPrice(
  tx: Tx,
  supplierId: string,
  materialId: string,
  unitPrice: Money,
  cause: Cause,
): void {
  const s = tx.s;
  const offer = offerOf(s, supplierId, materialId);
  if (!offer) return;
  const ev = tx.emit(
    'SupplierPriceChanged',
    { supplierId, materialId, previousPrice: offer.unitPrice, unitPrice },
    cause,
    { supplierId, materialId, previousPrice: offer.unitPrice, unitPrice },
  );
  for (const po of s.purchaseOrders) {
    if (po.status !== 'open' || po.supplierId !== supplierId || po.materialId !== materialId) continue;
    tx.emit('PurchaseOrderRepriced', { poId: po.id, unitPrice }, fromEvent(ev), {
      poId: po.id,
      previousPrice: po.unitPrice,
      unitPrice,
    });
  }
  recostOpenOrders(tx, fromEvent(ev));
}

/** Switch preferred supplier; cancel not-yet-shipped POs at the old one and re-place them. */
export function switchSupplier(tx: Tx, materialId: string, toSupplierId: string, cause: Cause): void {
  const s = tx.s;
  const m = byId(s.materials, materialId);
  const prev = m.preferredSupplierId;
  const ev = tx.emit(
    'PreferredSupplierChanged',
    { materialId, supplierId: toSupplierId, previousSupplierId: prev },
    cause,
    { materialId, supplierId: toSupplierId, previousSupplierId: prev },
  );
  const toCancel = s.purchaseOrders.filter(
    (p) => p.status === 'open' && p.materialId === materialId && p.supplierId === prev && p.dueDay > s.day + IN_TRANSIT_DAYS,
  );
  for (const po of toCancel) {
    const c = tx.emit('PurchaseOrderCancelled', { poId: po.id }, fromEvent(ev), { poId: po.id, supplierId: prev });
    placePurchaseOrder(tx, { supplierId: toSupplierId, materialId, qty: po.qty, forOrderId: po.forOrderId }, fromEvent(c));
  }
  recostOpenOrders(tx, fromEvent(ev));
}

