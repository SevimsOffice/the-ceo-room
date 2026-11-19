/**
 * Milestone 1 vertical slice (spec steps 1–8), end to end on the real seed (rngSeed 42).
 * All expectations are engine values (selectors, state, ledger); targets are tolerant ranges.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, engineAt, seedWithout } from '../test/seedFixture';
import { resolveCitation } from '../test/citations';
import { type GameEvent, metrics, selectAdvisorBrief, selectDecision, selectMorningReport, selectOrderImpact, tl } from './index';
import { offerOf } from './systems/costing';

const within = (actual: number, target: number, pct: number): boolean => Math.abs(actual - target) <= Math.abs(target) * pct;
const eventsOf = <T extends GameEvent['type']>(ledger: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  ledger.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('vertical slice: morning report → big order → supplier problem → advisors → decide → +30 days', () => {
  it('runs spec steps 1–8 with computed, consistent consequences', () => {
    const ceo = engineAt();
    const day1 = ceo.state();

    // ---- 1. The CEO sees the morning report (calibrated Day 1). ------------------------------
    const r1 = selectMorningReport(day1);
    expect(r1.day).toBe(1);
    expect(r1.revenue.lastPeriod).not.toBeNull();
    expect(within(r1.revenue.lastPeriod ?? 0, tl(76_400_000), 0.05)).toBe(true);
    expect(r1.revenue.changeBps).toBeGreaterThanOrEqual(500); // ≈ +6%
    expect(r1.revenue.changeBps).toBeLessThanOrEqual(700);
    expect(within(r1.cash, tl(41_200_000), 0.05)).toBe(true);
    expect(r1.cash).toBe(day1.cash);
    expect(r1.backlog.openOrders).toBe(15);
    expect(within(r1.backlog.value, tl(166_000_000), 0.05)).toBe(true);
    expect(r1.backlog.value).toBe(metrics.backlog(day1).value);
    expect(within(r1.satisfaction.average, 8100, 0.05)).toBe(true);
    expect(r1.satisfaction.change).not.toBeNull();
    expect(r1.satisfaction.change ?? 0).toBeLessThan(-300); // ≈ −4 points
    expect(r1.satisfaction.change ?? 0).toBeGreaterThan(-500);
    expect(within(r1.capacityUtilisationBps, 9200, 0.05)).toBe(true);
    expect(r1.runway.capped).toBe(false);
    expect(within(r1.runway.days, 65, 0.05)).toBe(true);

    // ---- 2. A big customer order arrives (telegram + registered order). ---------------------
    const [orderDev, steelDev] = r1.developments;
    expect(orderDev?.cardId).toBe('card_large_order');
    const orderId = orderDev?.orderId ?? '';
    expect(orderId).toBe('ord-0015');
    const order = day1.orders.find((o) => o.id === orderId);
    expect(order?.source).toBe('card');
    expect(order?.receivedDay).toBe(1);
    const bigCard = day1.eventCards.find((c) => c.id === 'card_large_order');
    if (bigCard?.effect.kind !== 'largeOrder' || !order) throw new Error('large order card/order missing');
    expect(order.value).toBe(bigCard.effect.unitPrice * bigCard.effect.qty);
    const received = eventsOf(ceo.ledger(), 'OrderReceived').find((e) => e.payload.order.id === orderId);
    const arrived = eventsOf(ceo.ledger(), 'DevelopmentArrived').find((e) => e.payload.development.id === orderDev?.id);
    expect(received?.cause).toEqual({ kind: 'event', seq: arrived?.seq });

    // ---- 3. Effect on production, stock, procurement and cash is computed. ------------------
    const view = selectOrderImpact(day1, orderId);
    const plan = view?.plan;
    if (!plan) throw new Error('large order has no pipeline plan');
    const fam = day1.productFamilies.find((f) => f.id === order.familyId);
    if (!fam) throw new Error('family missing');
    // production: load, plant, delivery
    expect(plan.capacity.minutesRequired).toBe(order.qty * fam.minutesPerUnit);
    expect(plan.plantId).toBe(order.plantId);
    expect(plan.delivery.promisedDay).toBe(order.promisedDay);
    expect(plan.delivery.promisedDay).toBe(plan.requestedDay + plan.delivery.lateDays);
    expect(plan.delivery.promisedDay).toBeGreaterThanOrEqual(plan.delivery.materialReadyDay);
    if (!plan.capacity.fits) expect(plan.people.overtimeLineHours + plan.delivery.lateDays).toBeGreaterThan(0);
    const noOrder = engineAt(42, seedWithout('card_large_order')).state();
    expect(metrics.capacityUtilisationBps(day1)).toBeGreaterThan(metrics.capacityUtilisationBps(noOrder));
    // stock: BOM need vs free position
    for (const b of fam.bom) {
      const line = plan.materials.find((x) => x.materialId === b.materialId);
      expect(line?.need).toBe(order.qty * b.qtyPerUnit);
      expect(line?.shortage).toBe(Math.max(0, (line?.need ?? 0) - Math.max(0, line?.available ?? 0)));
    }
    // procurement: every planned purchase is a real PO with the supplier's lead time and terms
    const steelLine = plan.materials.find((x) => x.materialId === 'steel');
    expect(steelLine?.shortage).toBeGreaterThan(0);
    expect(plan.purchases.some((p) => p.materialId === 'steel')).toBe(true);
    for (const p of plan.purchases) {
      const po = day1.purchaseOrders.find((x) => x.id === p.poId);
      const sup = day1.suppliers.find((x) => x.id === p.supplierId);
      const offer = offerOf(day1, p.supplierId, p.materialId);
      const mat = day1.materials.find((m) => m.id === p.materialId);
      if (!po || !sup || !offer || !mat) throw new Error(`PO ${p.poId} not in state`);
      expect(po.forOrderId).toBe(orderId);
      expect(po.qty).toBe(p.qty);
      expect(p.qty % mat.lotSize).toBe(0);
      expect(p.qty).toBeGreaterThanOrEqual(plan.materials.find((x) => x.materialId === p.materialId)?.shortage ?? Infinity);
      expect(p.dueDay).toBe(po.orderedDay + offer.leadTimeDays);
      expect(p.balanceDueDay).toBe(p.dueDay + sup.paymentTermsDays);
    }
    // cash: supplier payments go out before the customer pays (peak need > 0)
    const customer = day1.customers.find((c) => c.id === order.customerId);
    expect(plan.cash.receivableDay).toBe(plan.delivery.promisedDay + order.paymentTermsDays + (customer?.paymentDelayDays ?? NaN));
    expect(plan.cash.receivableDay).toBeGreaterThan(Math.max(...plan.purchases.map((p) => p.balanceDueDay)));
    expect(plan.cash.peakNeed).toBeGreaterThan(0);
    expect(plan.cost.total).toBe(plan.cost.materials + plan.cost.labour + plan.cost.energy);

    // ---- 4. A supplier problem occurs and opens a decision. ---------------------------------
    expect(steelDev?.cardId).toBe('card_steel_price');
    expect(steelDev?.decisionId).toBe(STEEL_DECISION);
    expect(r1.pendingDecisions.map((d) => d.id)).toEqual([STEEL_DECISION]);
    const room = selectDecision(day1, STEEL_DECISION);
    if (!room?.impacts) throw new Error('decision room has no impacts');
    const sit = room.situation.params;
    expect(offerOf(day1, String(sit.supplierId), 'steel')?.unitPrice).toBe(sit.newPrice);
    expect(Number(sit.newPrice)).toBe(Math.round(Number(sit.previousPrice) * (1 + Number(sit.changeBps) / 10000)));
    expect(sit.changeBps).toBe(2000);
    expect(room.decision.options.map((o) => o.id)).toEqual(['absorb', 'negotiate', 'switch', 'passOn']);
    expect(room.decision.defaultOptionId).toBe('absorb');
    // the big order's steel PO was repriced by the rise (cross-department propagation)
    const steelPo = day1.purchaseOrders.find((p) => p.id === plan.purchases.find((x) => x.materialId === 'steel')?.poId);
    expect(steelPo?.unitPrice).toBe(sit.newPrice);

    // ---- 5. CFO and COO give different, data-grounded recommendations. ----------------------
    const cfo = selectAdvisorBrief(day1, 'cfo', STEEL_DECISION);
    const coo = selectAdvisorBrief(day1, 'coo', STEEL_DECISION);
    if (!cfo || !coo) throw new Error('advisor brief missing');
    // ADR-0007 90-day outlook: B (switch) is best on the +30 view, but bills and slip after Day 30
    // make absorbing safer for cash; the CFO recommends absorb and flags the change and switch's bills.
    expect(cfo.recommendedOptionId).toBe('absorb');
    expect(cfo.thirtyDayPick).toBe('switch'); // B
    expect(cfo.caveats.map((c) => c.code)).toEqual(['advisor.caveat.deferredPayables', 'advisor.caveat.pickChangedAt90']);
    expect(coo.recommendedOptionId).toBe('negotiate'); // A
    for (const c of [...cfo.citations, ...coo.citations]) expect({ selector: c.selector, value: resolveCitation(day1, c.selector) }).toEqual(c);

    // ---- 6. CEO decides: approves the COO's option A (negotiate). ---------------------------
    const neg = room.impacts.options.find((o) => o.optionId === 'negotiate');
    const preview7 = neg?.horizons.find((h) => h.horizonDays === 7);
    const preview30 = neg?.horizons.find((h) => h.horizonDays === 30);
    if (!preview7 || !preview30) throw new Error('negotiate preview missing');
    // looks good now: no cash cost at +7, better margin; the preview already shows the +30 hit
    expect(preview7.delta.cash).toBe(0);
    expect(preview7.delta.grossMarginBps).toBeGreaterThan(0);
    expect(preview30.delta.cash).toBeLessThan(-tl(10_000_000));

    const approved = ceo.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'negotiate' });
    expect(approved.ok).toBe(true);
    const negPo = ceo.state().purchaseOrders.find((p) => p.forOrderId === null && p.orderedDay === 1 && p.qty === 500_000);
    if (!negPo) throw new Error('negotiation volume PO missing');
    const baseline = engineAt(); // same morning, decision left open (expires to absorb)

    // ---- 7. Simulation advances 30 days (checked at +7 on the way). -------------------------
    ceo.advance(7);
    baseline.advance(7);
    const ceo7 = selectMorningReport(ceo.state());
    const base7 = selectMorningReport(baseline.state());
    expect(ceo7.day).toBe(8);
    // +7: the delayed cost is NOT visible yet
    expect(ceo7.cash).toBe(base7.cash);
    expect(ceo7.cash - base7.cash).toBe(preview7.delta.cash);
    expect(ceo.state().payables.some((p) => p.poId === negPo.id)).toBe(false);
    expect(ceo7.grossMarginBps).toBeGreaterThan(base7.grossMarginBps);

    ceo.advance(23);
    baseline.advance(23);

    // ---- 8. Consequences visible in the morning report, including the delayed one. ----------
    const s31 = ceo.state();
    const r31 = selectMorningReport(s31);
    const b31 = selectMorningReport(baseline.state());
    expect(r31.day).toBe(31);
    expect(r31.cash).toBe(s31.cash);
    expect(r31.cash - b31.cash).toBe(preview30.delta.cash);
    expect(r31.cash - b31.cash).toBeLessThan(-tl(10_000_000));
    expect(r31.revenue.lastPeriod).toBe(s31.periods.find((p) => p.period === 1)?.revenue);
    expect(r31.pendingDecisions.some((d) => d.id === STEEL_DECISION)).toBe(false);
    // the cash squeeze reaches the desk as a telegram on the CEO's path only
    expect(r31.developments.some((d) => d.cardId === 'card_cash_squeeze')).toBe(true);
    expect(b31.developments.some((d) => d.cardId === 'card_cash_squeeze')).toBe(false);
    expect(r31.risk.score).toBeGreaterThan(b31.risk.score);
    // the delayed hit is the forward purchase's payable: delivered at +7, due after supplier terms
    const supplier = s31.suppliers.find((x) => x.id === negPo.supplierId);
    const payable = s31.payables.find((p) => p.poId === negPo.id);
    expect(payable?.amount).toBe(negPo.qty * negPo.unitPrice);
    expect(payable?.dueDay).toBe(negPo.dueDay + (supplier?.paymentTermsDays ?? NaN));
    expect(payable?.status).toBe('settled');
    const settledEv = eventsOf(ceo.ledger(), 'PayableSettled').filter((e) => e.payload.payableId === payable?.id);
    expect(settledEv).toHaveLength(1);
    expect(settledEv[0]?.day).toBe(payable?.dueDay);
    expect(settledEv[0]?.day).toBeGreaterThan(8);
    expect(settledEv[0]?.day).toBeLessThanOrEqual(31);
    // and the ledger explains the chain: command → decision → PO → delivery → payable → settlement
    const resolved = eventsOf(ceo.ledger(), 'DecisionResolved').find((e) => e.payload.decisionId === STEEL_DECISION);
    expect(resolved?.cause).toEqual({ kind: 'command', commandId: approved.ok ? approved.commandId : '' });
    const placed = eventsOf(ceo.ledger(), 'PurchaseOrderPlaced').find((e) => e.payload.po.id === negPo.id);
    expect(placed?.cause).toEqual({ kind: 'event', seq: resolved?.seq });
    const delivered = eventsOf(ceo.ledger(), 'PurchaseOrderDelivered').find((e) => e.payload.poId === negPo.id);
    const created = eventsOf(ceo.ledger(), 'PayableCreated').find((e) => e.payload.payable.poId === negPo.id);
    expect(created?.cause).toEqual({ kind: 'event', seq: delivered?.seq });
    expect(delivered?.day).toBe(negPo.dueDay);
  });
});
