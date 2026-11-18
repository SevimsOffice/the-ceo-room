import type { CompanyState, Development, EventCard, I18nParams } from '../model/types';
import { addM, mulBps, timesQty } from '../model/units';
import { type Tx, fromEvent, rule } from '../events/tx';
import { offerOf } from '../systems/costing';
import { changeSupplierPrice, pad } from '../systems/procurement';
import { registerOrder } from '../systems/pipeline';
import { turnoverBps } from '../systems/people';
import { buildDiscountDecision, buildSupplierPriceDecision, nextDecisionId } from './decisions';

export function cardTriggered(s: CompanyState, card: EventCard): boolean {
  if (s.firedCards.includes(card.id)) return false;
  const t = card.trigger;
  switch (t.kind) {
    case 'day':
      return s.day >= t.day;
    case 'cashBelow':
      return s.day >= t.fromDay && s.cash < t.threshold;
    case 'turnoverAbove':
      return s.day >= t.fromDay && turnoverBps(s, t.departmentId) > t.thresholdBps;
  }
}

function messageParams(s: CompanyState, card: EventCard): I18nParams {
  const e = card.effect;
  switch (e.kind) {
    case 'largeOrder':
      return {
        customerId: e.customerId,
        familyId: e.familyId,
        qty: e.qty,
        value: timesQty(e.unitPrice, e.qty),
        requestedDay: s.day + e.requestedInDays,
        paymentTermsDays: e.paymentTermsDays,
      };
    case 'supplierPriceChange':
      return { supplierId: e.supplierId, materialId: e.materialId, changeBps: e.changeBps };
    case 'discountDemand':
      return { customerId: e.customerId, discountBps: e.discountBps };
    case 'lineBreakdown':
      return { lineId: e.lineId, repairDays: e.repairDays };
    case 'latePayment':
      return { customerId: e.customerId, delayDays: e.delayDays };
    case 'notice':
      return {};
  }
}

/** Fire one event card: a Development (telegram), then its effect through the systems. */
export function fireCard(tx: Tx, card: EventCard): void {
  const s = tx.s;
  const e = card.effect;
  const development: Development = {
    workspaceId: s.workspaceId,
    id: `dev-${pad(s.counters.development)}`,
    cardId: card.id,
    day: s.day,
    severity: card.severity,
    message: { code: `card.${card.kindKey}`, params: messageParams(s, card) },
    status: 'new',
    decisionId: e.kind === 'supplierPriceChange' || e.kind === 'discountDemand' ? nextDecisionId(s) : null,
    orderId: e.kind === 'largeOrder' ? `ord-${pad(s.counters.order)}` : null,
  };
  const dev = tx.emit('DevelopmentArrived', { development }, rule(`card.${card.id}`), {
    cardId: card.id,
    severity: card.severity,
  });
  const why = fromEvent(dev);
  switch (e.kind) {
    case 'largeOrder':
      registerOrder(
        tx,
        {
          customerId: e.customerId,
          familyId: e.familyId,
          qty: e.qty,
          listUnitPrice: e.unitPrice,
          unitPrice: e.unitPrice,
          requestedDay: s.day + e.requestedInDays,
          paymentTermsDays: e.paymentTermsDays,
          source: 'card',
        },
        why,
      );
      return;
    case 'supplierPriceChange': {
      const offer = offerOf(s, e.supplierId, e.materialId);
      if (!offer) return;
      const previous = offer.unitPrice;
      changeSupplierPrice(tx, e.supplierId, e.materialId, addM(previous, mulBps(previous, e.changeBps)), why);
      const decision = buildSupplierPriceDecision(s, card, e, development.id, previous);
      tx.emit('DecisionOpened', { decision }, why, { decisionId: decision.id, deadlineDay: decision.deadlineDay });
      return;
    }
    case 'discountDemand': {
      const decision = buildDiscountDecision(s, card, e, development.id);
      tx.emit('DecisionOpened', { decision }, why, { decisionId: decision.id, deadlineDay: decision.deadlineDay });
      return;
    }
    case 'lineBreakdown':
      tx.emit('LineDown', { lineId: e.lineId, repairDueDay: s.day + e.repairDays }, why, {
        lineId: e.lineId,
        repairDueDay: s.day + e.repairDays,
      });
      return;
    case 'latePayment': {
      const open = s.receivables
        .filter((r) => r.status === 'open' && r.customerId === e.customerId && r.expectedPayDay >= s.day)
        .sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
      const r = open[0];
      if (r) {
        tx.emit('ReceivableDelayed', { receivableId: r.id, expectedPayDay: r.expectedPayDay + e.delayDays }, why, {
          receivableId: r.id,
          customerId: e.customerId,
          delayDays: e.delayDays,
        });
      }
      return;
    }
    case 'notice':
      return;
  }
}

/** Step 1: scheduled and condition-triggered cards, in seed order. */
export function runCards(tx: Tx): void {
  for (const card of tx.s.eventCards) {
    if (cardTriggered(tx.s, card)) fireCard(tx, card);
  }
}
