/**
 * Live vs planned order figures (selectOrderImpact().live, selectOrderBook): the plan captured at
 * arrival stays as it was; live figures follow prices, the queue, POs and payments; `differs` flags
 * every field that moved. Tiny company figures are computed by hand (see test/tinySeed.ts).
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, day1State, engineAt } from '../test/seedFixture';
import { card, tinyWithOrder } from '../test/tinySeed';
import {
  type CardEffect,
  type CompanyState,
  type OrderFigures,
  metrics,
  ratioBps,
  selectMorningReport,
  selectOrderBook,
  selectOrderImpact,
  tl,
} from './index';

const live = (s: Readonly<CompanyState>, id: string): OrderFigures => {
  const v = selectOrderImpact(s, id)?.live;
  if (!v) throw new Error(`no order ${id}`);
  return v;
};
const differing = (f: OrderFigures): string[] =>
  Object.entries(f)
    .filter(([, v]) => (v as { differs: boolean }).differs)
    .map(([k]) => k)
    .sort();

const PRICE_DOUBLES: CardEffect = {
  kind: 'supplierPriceChange',
  supplierId: 's1',
  materialId: 'm1',
  changeBps: 10000,
  decisionDays: 60,
  negotiation: { settleBps: 5000, volumeQty: 10 },
  alternativeSupplierId: 's2',
  customerReaction: { satisfactionDelta: -100, churnRiskDelta: 100, paymentDelayDays: 0 },
};

describe('tiny company: live vs plan by hand', () => {
  it('Day 1 without surprises: live = plan, except the receipt (plan used the promise day, live the finish day)', () => {
    const f = live(tinyWithOrder().state(), 'ord-0001');
    expect(f.value).toEqual({ plan: tl(16_000), live: tl(16_000), differs: false });
    expect(f.materialCost).toEqual({ plan: tl(320), live: tl(320), differs: false });
    expect(f.totalCost).toEqual({ plan: tl(2080), live: tl(2080), differs: false });
    expect(f.marginBps).toEqual({ plan: 8700, live: 8700, differs: false });
    expect(f.promisedDay).toEqual({ plan: 11, live: 11, differs: false });
    // material Saturday Day 6 → production Mon 8 + Tue 9
    expect(f.expectedShipDay).toEqual({ plan: 9, live: 9, differs: false });
    expect(f.supplierBills).toEqual({ plan: tl(400), live: tl(400), differs: false });
    expect(f.lastSupplierPaymentDay).toEqual({ plan: 36, live: 36, differs: false });
    // plan: promise 11 + 60 = 71; live: ships Day 9 → 9 + 60 = 69 (the pipeline test collects on Day 69)
    expect(f.receivableDay).toEqual({ plan: 71, live: 69, differs: true });
    expect(differing(f)).toEqual(['receivableDay']);
  });

  it('a supplier price that doubles moves material, cost, margin and supplier bills; the plan stays', () => {
    const e = tinyWithOrder((s) => s.eventCards.push(card('card_price', { kind: 'day', day: 1 }, PRICE_DOUBLES)));
    const s = e.state();
    const f = live(s, 'ord-0001');
    expect(f.materialCost).toEqual({ plan: tl(320), live: tl(640), differs: true });
    expect(f.totalCost).toEqual({ plan: tl(2080), live: tl(2400), differs: true });
    expect(f.marginBps).toEqual({ plan: 8700, live: 8500, differs: true });
    expect(f.supplierBills).toEqual({ plan: tl(400), live: tl(800), differs: true });
    expect(differing(f)).toEqual(['marginBps', 'materialCost', 'receivableDay', 'supplierBills', 'totalCost']);
    expect(selectOrderImpact(s, 'ord-0001')?.marginBps).toBe(f.marginBps.live);
    expect(selectOrderImpact(s, 'ord-0001')?.plan?.cost.marginBps).toBe(8700);
  });

  it('after shipping: actual ship day, actual cost and the receivable’s pay day', () => {
    const e = tinyWithOrder();
    e.advance(9); // Day 10: shipped on Day 9
    const s = e.state();
    const f = live(s, 'ord-0001');
    expect(f.expectedShipDay.live).toBe(9);
    expect(f.totalCost.live).toBe(metrics.actualCost(s, 'ord-0001'));
    expect(f.receivableDay.live).toBe(s.receivables.find((r) => r.orderId === 'ord-0001')?.expectedPayDay);
    expect(f.receivableDay.live).toBe(69);
    // the balance payable exists now; its due day is the live last payment day
    expect(f.lastSupplierPaymentDay.live).toBe(36);
  });
});

describe('ord-0015 (the Day-1 large order) on the real seed', () => {
  it('plan margin 2135 bps at arrival; live ~932 bps after the steel rise re-costed it', () => {
    const s = day1State();
    const o = s.orders.find((x) => x.id === 'ord-0015');
    if (!o) throw new Error('no ord-0015');
    const f = live(s, 'ord-0015');
    expect(f.marginBps).toEqual({ plan: 2135, live: 932, differs: true });
    expect(f.marginBps.live).toBe(ratioBps(o.value - o.costEstimate, o.value));
    expect(f.totalCost.live).toBe(o.costEstimate);
    expect(f.materialCost.live).toBeGreaterThan(f.materialCost.plan ?? Infinity);
    expect(f.value.differs).toBe(false);
    expect(f.promisedDay).toEqual({ plan: 46, live: 46, differs: false });
    // the order's steel PO was repriced by the rise: bills are the live POs bought for this order
    const pos = s.purchaseOrders.filter((p) => p.forOrderId === 'ord-0015' && p.status !== 'cancelled');
    expect(f.supplierBills.live).toBe(pos.reduce((t, p) => t + p.unitPrice * p.qty, 0));
    expect(f.supplierBills.differs).toBe(true);
  });

  it('switching supplier replaces the order’s PO: bills and payment day follow the new supplier', () => {
    const e = engineAt();
    expect(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }).ok).toBe(true);
    const s = e.state();
    const f = live(s, 'ord-0015');
    const pos = s.purchaseOrders.filter((p) => p.forOrderId === 'ord-0015');
    expect(pos.some((p) => p.status === 'cancelled')).toBe(true);
    const kept = pos.filter((p) => p.status !== 'cancelled');
    expect(f.supplierBills.live).toBe(kept.reduce((t, p) => t + p.unitPrice * p.qty, 0));
    expect(f.lastSupplierPaymentDay.live).toBe(Math.max(...kept.map((p) => p.dueDay + p.paymentTermsDays)));
    expect(kept.some((p) => p.supplierId === 'sup_dogumetal')).toBe(true);
    expect(f.supplierBills.live).not.toBe(live(day1State(), 'ord-0015').supplierBills.live);
    expect(f.supplierBills.plan).toBe(live(day1State(), 'ord-0015').supplierBills.plan); // the plan never moves
  });
});

describe('selectOrderBook', () => {
  it('lists every open order with live and plan figures; totals match the morning report backlog', () => {
    const s = day1State();
    const book = selectOrderBook(s);
    const open = s.orders.filter((o) => ['registered', 'scheduled', 'in_production'].includes(o.status));
    expect(book.orders.map((l) => l.orderId)).toEqual(open.map((o) => o.id));
    const r = selectMorningReport(s, { includeRunway: false });
    expect(book.totals).toEqual({ count: r.backlog.openOrders, value: r.backlog.value });
    for (const l of book.orders) {
      expect(l.figures).toEqual(selectOrderImpact(s, l.orderId)?.live);
      expect(l.differs).toBe(differing(l.figures).length > 0);
      if (!l.hasPlan) expect(differing(l.figures)).toEqual([]); // seed orders carry no plan
    }
    expect(book.orders.find((l) => l.orderId === 'ord-0015')?.differs).toBe(true);
  });

  it('is memoised per state and frozen', () => {
    const s = day1State();
    const book = selectOrderBook(s);
    expect(selectOrderBook(s)).toBe(book);
    expect(Object.isFrozen(book.orders[0]?.figures.marginBps)).toBe(true);
  });

  it('follows the state: a month later, shipped orders leave and new ones arrive', () => {
    const e = engineAt();
    e.advance(30);
    const s = e.state();
    const book = selectOrderBook(s);
    expect(book.day).toBe(31);
    expect(book.orders.every((l) => ['registered', 'scheduled', 'in_production'].includes(l.status))).toBe(true);
    expect(book.orders.some((l) => l.hasPlan && l.orderId !== 'ord-0015')).toBe(true);
  });
});
