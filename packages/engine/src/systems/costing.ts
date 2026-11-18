import type { CompanyState, Order, SupplierOffer } from '../model/types';
import { type Money, addM, money, mulDiv, timesQty } from '../model/units';
import { byId } from '../events/reduce';
import { family, minutesRequired, openOrders } from './capacity';

export function offerOf(s: CompanyState, supplierId: string, materialId: string): SupplierOffer | undefined {
  return byId(s.suppliers, supplierId).offers.find((o) => o.materialId === materialId);
}

/** Current replacement price of a material = preferred supplier's offer. */
export function replacementPrice(s: CompanyState, materialId: string): Money {
  const m = byId(s.materials, materialId);
  const offer = offerOf(s, m.preferredSupplierId, materialId);
  return offer ? offer.unitPrice : money(0);
}

export function lineHourRate(s: CompanyState): Money {
  return addM(s.settings.labourCostPerLineHour, s.settings.energyCostPerLineHour);
}

/** Cost estimate: consumed materials at actual + remaining materials at replacement + line-hours. */
export function orderCostEstimate(s: CompanyState, o: Order): Money {
  const fam = family(s, o.familyId);
  const remainingUnits = o.qty - o.unitsDone;
  let mat = o.materialCost as number;
  for (const b of fam.bom) mat += timesQty(replacementPrice(s, b.materialId), remainingUnits * b.qtyPerUnit);
  return addM(money(mat), mulDiv(lineHourRate(s), minutesRequired(s, o), 60));
}

export function remainingNeed(s: CompanyState, o: Order, materialId: string): number {
  const b = family(s, o.familyId).bom.find((x) => x.materialId === materialId);
  return b ? (o.qty - o.unitsDone) * b.qtyPerUnit : 0;
}

export function inboundQty(s: CompanyState, materialId: string, untilDay?: number): number {
  let t = 0;
  for (const po of s.purchaseOrders) {
    if (po.status !== 'open' || po.materialId !== materialId) continue;
    if (untilDay !== undefined && po.dueDay > untilDay) continue;
    t += po.qty;
  }
  return t;
}

/** Material still needed by open orders (optionally only those promised by `untilDay`). */
export function allocatedQty(s: CompanyState, materialId: string, excludeOrderId?: string, untilDay?: number): number {
  let t = 0;
  for (const o of openOrders(s)) {
    if (o.id === excludeOrderId) continue;
    if (untilDay !== undefined && o.promisedDay > untilDay) continue;
    t += remainingNeed(s, o, materialId);
  }
  return t;
}

/** Average stock value of `qty` units at current weighted-average cost. */
export function stockValueOf(s: CompanyState, materialId: string, qty: number): Money {
  const m = byId(s.materials, materialId);
  if (m.stockQty <= 0 || qty <= 0) return money(0);
  if (qty >= m.stockQty) return m.stockValue;
  return mulDiv(m.stockValue, qty, m.stockQty);
}

/** Days ahead the MRP protects for a material: preferred supplier lead time + cover days. */
export function mrpHorizon(s: CompanyState, materialId: string): number {
  const m = byId(s.materials, materialId);
  const offer = offerOf(s, m.preferredSupplierId, materialId);
  return s.day + (offer ? offer.leadTimeDays : 0) + s.settings.mrpCoverDays;
}

/**
 * Free position: stock + all inbound − needs of open orders due within the MRP horizon − safety stock.
 * Shared by order intake and MRP so the two never double-buy, and surplus stock (e.g. a forward
 * purchase) is used before new purchases are made.
 */
export function freePosition(s: CompanyState, materialId: string, excludeOrderId?: string): number {
  const m = byId(s.materials, materialId);
  return m.stockQty + inboundQty(s, materialId) - allocatedQty(s, materialId, excludeOrderId, mrpHorizon(s, materialId)) - m.safetyStock;
}
