/**
 * Cross-department order pipeline (SIMULATION_DESIGN §4) and propagation.
 * Unit part: the tiny hand-built company (test/tinySeed.ts), where every figure is computed by hand:
 *   order 16 × f1 = 960 line-min, needs 32 × m1; 480 line-min/workday; requested Day 11; 60-day terms.
 * Integration part: the real seed, compared against counterfactual seeds without a given card.
 */
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../test/invariants';
import { STEEL_DECISION, WS, day1State, engineAt, seedWithout } from '../test/seedFixture';
import { TINY_WS, card, tinyWithOrder } from '../test/tinySeed';
import { type CardEffect, type CompanyState, type Engine, type GameEvent, metrics, selectMorningReport, selectOrderImpact, tl } from './index';

const ORDER = 'ord-0001';
/** s1 doubles the m1 price (10 → 20 TRY); the decision it opens is left to expire (absorb). */
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
const ofType = <T extends GameEvent['type']>(l: readonly GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  l.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);
const order = (s: Readonly<CompanyState>, id = ORDER) => {
  const o = s.orders.find((x) => x.id === id);
  if (!o) throw new Error(`order ${id} missing`);
  return o;
};
const runTo = (e: Engine, day: number): Engine => {
  e.advance(day - e.state().day);
  return e;
};

describe('order pipeline on a tiny company (hand-computed)', () => {
  it('registers, checks capacity and material, buys, costs, plans cash and promises a date', () => {
    const e = tinyWithOrder();
    const s = e.state();
    const plan = selectOrderImpact(s, ORDER)?.plan;
    if (!plan) throw new Error('no plan');
    expect(plan.plantId).toBe('p1');
    expect(plan.capacity).toEqual({ minutesRequired: 960, minutesAhead: 0, freeMinutesUntilRequested: 9 * 480, fits: true });
    expect(plan.materials).toEqual([{ materialId: 'm1', need: 32, available: 0, shortage: 32 }]);
    // one lot-rounded PO at the preferred supplier: due after its lead time, balance after its terms
    expect(plan.purchases).toEqual([
      { poId: 'po-0001', supplierId: 's1', materialId: 'm1', qty: 40, unitPrice: tl(10), dueDay: 6, deposit: 0, balance: tl(400), balanceDueDay: 36 },
    ]);
    expect(s.purchaseOrders.map((p) => [p.id, p.supplierId, p.qty, p.dueDay, p.forOrderId])).toEqual([['po-0001', 's1', 40, 6, ORDER]]);
    expect(plan.cost).toEqual({ materials: tl(320), labour: tl(1600), energy: tl(160), total: tl(2080), marginBps: 8700 });
    expect(plan.people).toEqual({ overtimeLineHours: 0, overtimePersonHours: 0 });
    // material arrives Saturday Day 6 → production Mon 8 + Tue 9 → fits before the requested Day 11
    expect(plan.delivery).toEqual({ materialReadyDay: 6, regularCompletionDay: 9, overtimeCompletionDay: 9, promisedDay: 11, lateDays: 0 });
    expect(plan.cash).toEqual({
      flows: [
        { day: 11, amount: -tl(160), kindKey: 'cashflow.energy' },
        { day: 36, amount: -tl(400), kindKey: 'cashflow.supplierPayment' },
        { day: 71, amount: tl(16_000), kindKey: 'cashflow.customerReceipt' },
      ],
      peakNeed: tl(560),
      peakNeedDay: 36,
      receivableDay: 71,
    });
    expect(order(s).costEstimate).toBe(tl(2080));
    expect(selectOrderImpact(s, ORDER)?.marginBps).toBe(8700);
  });

  it('runs the plan: shortage → delivery on its day → production → shipment → receivable → payment', () => {
    const e = tinyWithOrder();
    const opening = e.state().cash;
    const l = (): readonly GameEvent[] => e.ledger();

    runTo(e, 6); // morning of the due day: not delivered yet
    expect(e.state().purchaseOrders[0]?.status).toBe('open');
    expect(ofType(l(), 'MaterialShortage').map((x) => x.day)).toEqual([1]);
    expect(order(e.state()).unitsDone).toBe(0);

    runTo(e, 7);
    expect(ofType(l(), 'PurchaseOrderDelivered').map((x) => x.day)).toEqual([6]);
    expect(e.state().materials[0]?.stockQty).toBe(40);
    const payable = e.state().payables.find((p) => p.poId === 'po-0001');
    expect(payable).toMatchObject({ source: 'po_balance', amount: tl(400), dueDay: 36, status: 'open' });

    runTo(e, 10);
    expect(ofType(l(), 'ProductionResumed').map((x) => x.day)).toEqual([8]);
    expect(ofType(l(), 'OrderShipped').map((x) => [x.day, x.payload.lateDays, x.payload.revenue, x.payload.cogs])).toEqual([[9, 0, tl(16_000), tl(2080)]]);
    expect(e.state().materials[0]?.stockQty).toBe(8);
    const rcv = e.state().receivables.find((r) => r.orderId === ORDER);
    expect(rcv).toMatchObject({ amount: tl(16_000), issuedDay: 9, dueDay: 69, expectedPayDay: 69, status: 'open' });
    expect(e.state().customers[0]?.satisfaction).toBe(8100); // on-time shipment +1 point
    expect(e.state().cash).toBe(opening);

    runTo(e, 36);
    expect(e.state().cash).toBe(opening); // payable due today, settles this evening
    runTo(e, 37);
    expect(e.state().cash).toBe(opening - tl(400));
    runTo(e, 69);
    expect(e.state().cash).toBe(opening - tl(400));
    runTo(e, 70);
    expect(e.state().cash).toBe(opening - tl(400) + tl(16_000));
    expect(order(e.state()).status).toBe('paid');
    expect(checkInvariants(e.state(), l(), TINY_WS)).toEqual([]);
  });

  it('supplier price → order cost and margin → PO price → cash', () => {
    const base = tinyWithOrder();
    // setSupplierPrice is engine-only: the price rise arrives the way it does in play, as a supplier card
    const e = tinyWithOrder((s) => s.eventCards.push(card('card_price', { kind: 'day', day: 1 }, PRICE_DOUBLES)));
    expect(e.state().suppliers.find((x) => x.id === 's1')?.offers[0]?.unitPrice).toBe(tl(20));
    expect(order(e.state()).costEstimate).toBe(tl(2080) + 32 * tl(10));
    expect(selectOrderImpact(e.state(), ORDER)?.marginBps).toBe(8500);
    expect(e.state().purchaseOrders[0]?.unitPrice).toBe(tl(20));
    runTo(e, 37);
    runTo(base, 37);
    expect(base.state().cash - e.state().cash).toBe(40 * tl(10));
  });

  it('switching to a supplier with deposit, onboarding and short terms: cash out early, order late, customer pays later', () => {
    const base = tinyWithOrder();
    const e = tinyWithOrder();
    expect(e.dispatch({ type: 'switchSupplier', materialId: 'm1', toSupplierId: 's2' }).ok).toBe(true);
    const s = e.state();
    expect(s.purchaseOrders.map((p) => [p.id, p.supplierId, p.status, p.dueDay])).toEqual([
      ['po-0001', 's1', 'cancelled', 6],
      ['po-0002', 's2', 'open', 14], // lead 10 + 3 onboarding days
    ]);
    expect(s.payables).toEqual([expect.objectContaining({ source: 'po_deposit', amount: tl(180), dueDay: 1, status: 'open' })]);
    expect(order(s).costEstimate).toBe(tl(2080) - 32 * tl(1)); // cheaper steel: better margin on paper

    runTo(e, 2);
    runTo(base, 2);
    expect(base.state().cash - e.state().cash).toBe(tl(180)); // deposit left on Day 1
    runTo(e, 30);
    runTo(base, 30);
    const shipped = (x: Engine) => ofType(x.ledger(), 'OrderShipped')[0];
    expect(shipped(base)?.day).toBe(9);
    expect(shipped(e)?.day).toBe(16);
    expect(shipped(e)?.payload.lateDays).toBe(5);
    expect(ofType(e.ledger(), 'OvertimeWorked').length).toBeGreaterThan(0);
    expect(ofType(base.ledger(), 'OvertimeWorked')).toHaveLength(0);
    expect(e.state().customers[0]?.satisfaction).toBeLessThan(base.state().customers[0]?.satisfaction ?? 0);
    const payDay = (x: Engine) => x.state().receivables.find((r) => r.orderId === ORDER)?.expectedPayDay ?? NaN;
    expect(payDay(e)).toBe(payDay(base) + 7);
    const balance = e.state().payables.find((p) => p.source === 'po_balance');
    expect(balance).toMatchObject({ amount: tl(180), dueDay: 21, status: 'settled' });
    expect(checkInvariants(e.state(), e.ledger(), TINY_WS)).toEqual([]);
  });

  it('plans overtime when regular capacity is short, and promises late when overtime is not allowed', () => {
    const big = (maxOt: number) =>
      tinyWithOrder((s) => {
        s.company.settings.maxOvertimeHoursPerLineDay = maxOt;
        s.materials[0] = { ...(s.materials[0] as (typeof s.materials)[number]), stockQty: 1000, stockValue: tl(10_000) };
        const c = s.eventCards[0];
        if (c?.effect.kind === 'largeOrder') c.effect.qty = 80; // 4,800 line-min vs 4,320 regular until Day 11
      });
    const ot = big(2);
    const plan = selectOrderImpact(ot.state(), ORDER)?.plan;
    expect(plan?.capacity.fits).toBe(false);
    expect(plan?.purchases).toEqual([]);
    expect(plan?.people).toEqual({ overtimeLineHours: 8, overtimePersonHours: 16 });
    expect(plan?.delivery).toMatchObject({ regularCompletionDay: 12, promisedDay: 11, lateDays: 0 });
    expect(plan?.cash.flows).toContainEqual({ day: 11, amount: -16 * tl(50), kindKey: 'cashflow.overtime' });
    runTo(ot, 12);
    const shippedOt = ofType(ot.ledger(), 'OrderShipped')[0];
    expect(shippedOt?.day).toBeLessThanOrEqual(11);
    const otMinutes = ofType(ot.ledger(), 'OvertimeWorked').reduce((t, x) => t + x.payload.lineMinutes, 0);
    expect(otMinutes).toBeGreaterThanOrEqual(480);
    expect(ot.state().accruals.overtime).toBeGreaterThan(0);

    const none = big(0);
    expect(selectOrderImpact(none.state(), ORDER)?.plan?.delivery).toMatchObject({ promisedDay: 12, lateDays: 1 });
    expect(order(none.state()).promisedDay).toBe(12);
  });
});

describe('propagation on the real seed', () => {
  it('steel +20% re-costs every open steel order, lowers its margin and reprices open steel POs', () => {
    const withRise = day1State();
    const without = engineAt(42, seedWithout('card_steel_price')).state();
    const offer = (s: Readonly<CompanyState>) => s.suppliers.find((x) => x.id === 'sup_kuzeycelik')?.offers.find((o) => o.materialId === 'steel')?.unitPrice ?? NaN;
    const rise = offer(withRise) - offer(without);
    expect(rise).toBe(Math.round(offer(without) * 0.2));
    const steelPerUnit = (s: Readonly<CompanyState>, familyId: string) => s.productFamilies.find((f) => f.id === familyId)?.bom.find((b) => b.materialId === 'steel')?.qtyPerUnit ?? 0;
    const open = withRise.orders.filter((o) => o.shippedDay === null && steelPerUnit(withRise, o.familyId) > 0);
    expect(open.length).toBe(15);
    for (const o of open) {
      const before = order(without, o.id);
      expect(o.costEstimate - before.costEstimate, o.id).toBe((o.qty - o.unitsDone) * steelPerUnit(withRise, o.familyId) * rise);
      expect(selectOrderImpact(withRise, o.id)?.marginBps ?? 0).toBeLessThan(selectOrderImpact(without, o.id)?.marginBps ?? 0);
    }
    expect(metrics.bookMarginBps(withRise, 1)).toBeLessThan(metrics.bookMarginBps(without, 1));
    // undelivered POs at the supplier now carry the new price, each repricing caused by the price change
    const changed = ofType(engineAt().ledger(), 'SupplierPriceChanged')[0];
    const repriced = ofType(engineAt().ledger(), 'PurchaseOrderRepriced');
    const steelPos = withRise.purchaseOrders.filter((p) => p.status === 'open' && p.supplierId === 'sup_kuzeycelik' && p.materialId === 'steel');
    expect(steelPos.length).toBeGreaterThan(0);
    for (const p of steelPos) {
      expect(p.unitPrice).toBe(offer(withRise));
      expect(repriced.find((r) => r.payload.poId === p.id)?.cause).toEqual({ kind: 'event', seq: changed?.seq });
    }
  });

  it('steel +20% reaches cash within 30 days (repriced payables), with no decision taken', () => {
    const a = engineAt();
    const b = engineAt(42, seedWithout('card_steel_price'));
    a.advance(30);
    b.advance(30);
    expect(a.state().cash).toBeLessThan(b.state().cash);
  });

  it('Plant 2 press breakdown (Day 16) pushes deliveries, receivables and satisfaction the wrong way', () => {
    const a = engineAt();
    const b = engineAt(42, seedWithout('card_press_breakdown'));
    a.advance(14);
    expect(a.state().day).toBe(15);
    expect(a.state().lines.find((l) => l.id === 'p2_press')?.status).toBe('running');
    a.advance(1);
    const down = ofType(a.ledger(), 'LineDown');
    expect(down.map((x) => [x.day, x.payload.lineId])).toEqual([[16, 'p2_press']]);
    expect(a.state().lines.find((l) => l.id === 'p2_press')?.status).toBe('down');
    expect(selectMorningReport(a.state()).developments.some((d) => d.cardId === 'card_press_breakdown')).toBe(true);
    a.advance(45);
    b.advance(60);
    expect(a.state().day).toBe(b.state().day);
    const repairDay = down[0]?.payload.repairDueDay;
    expect(ofType(a.ledger(), 'LineRepaired').map((x) => x.day)).toEqual([repairDay]);

    const sa = a.state();
    const sb = b.state();
    const both = sa.orders.filter((o) => o.shippedDay !== null && sb.orders.find((x) => x.id === o.id)?.shippedDay != null);
    const shipDelta = both.map((o) => (o.shippedDay ?? 0) - (order(sb, o.id).shippedDay ?? 0));
    expect(Math.min(...shipDelta)).toBeGreaterThanOrEqual(0); // nothing ships earlier
    expect(Math.max(...shipDelta)).toBeGreaterThan(0); // at least one delivery is pushed
    for (const o of both.filter((x, i) => (shipDelta[i] ?? 0) > 0)) expect(o.plantId).toBe('plant_gemlik');

    const pay = (s: Readonly<CompanyState>, id: string) => s.receivables.find((r) => r.orderId === id)?.expectedPayDay ?? NaN;
    const payDelta = both.map((o) => pay(sa, o.id) - pay(sb, o.id));
    expect(Math.min(...payDelta)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...payDelta)).toBeGreaterThan(0); // the cash curve moves out

    expect(metrics.deliverySlip(sa, 1).slipDays).toBeGreaterThan(metrics.deliverySlip(sb, 1).slipDays);
    for (const c of sa.customers) expect(c.satisfaction, c.id).toBeLessThanOrEqual(sb.customers.find((x) => x.id === c.id)?.satisfaction ?? NaN);
    expect(selectMorningReport(sa).satisfaction.average).toBeLessThan(selectMorningReport(sb).satisfaction.average);
    expect(sa.decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('expired');
  });
});

describe('cancelled purchase orders and their deposits (review fix 2)', () => {
  /** Every deposit of a cancelled PO is either cancelled unpaid or explicitly forfeited, never silently lost. */
  const depositsOfCancelled = (e: Engine) => {
    const s = e.state();
    const l = e.ledger();
    const cancelled = s.purchaseOrders.filter((p) => p.status === 'cancelled');
    const rows = cancelled.flatMap((po) => s.payables.filter((p) => p.source === 'po_deposit' && p.poId === po.id).map((p) => ({ po, p })));
    for (const { po, p } of rows) {
      const cancelEv = ofType(l, 'PurchaseOrderCancelled').filter((x) => x.payload.poId === po.id);
      expect(cancelEv, po.id).toHaveLength(1);
      const byCancel = l.filter((x) => x.cause.kind === 'event' && x.cause.seq === cancelEv[0]?.seq);
      const unpaid = ofType(l, 'PayableCancelled').filter((x) => x.payload.payableId === p.id);
      const lost = ofType(l, 'DepositForfeited').filter((x) => x.payload.payableId === p.id);
      if (p.status === 'cancelled') {
        expect(unpaid, p.id).toHaveLength(1);
        expect(lost, p.id).toHaveLength(0);
        expect(ofType(l, 'PayableSettled').some((x) => x.payload.payableId === p.id), p.id).toBe(false);
        expect(byCancel).toContain(unpaid[0]);
      } else {
        expect(p.status, p.id).toBe('settled');
        expect(lost, p.id).toHaveLength(1);
        expect(lost[0]?.payload).toEqual({ poId: po.id, payableId: p.id, supplierId: po.supplierId, amount: p.amount });
        expect(lost[0]?.params).toMatchObject({ poId: po.id, amount: p.amount });
        expect(byCancel).toContain(lost[0]);
      }
    }
    return rows;
  };

  it('probe: switch, advance 3 days, switch back: every paid deposit is forfeited in the ledger', () => {
    const e = engineAt();
    expect(e.dispatch({ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_dogumetal' }).ok).toBe(true);
    e.advance(3);
    expect(e.dispatch({ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }).ok).toBe(true);
    const rows = depositsOfCancelled(e);
    const forfeited = ofType(e.ledger(), 'DepositForfeited');
    expect(forfeited.length).toBeGreaterThan(0);
    expect(forfeited.reduce((t, x) => t + x.payload.amount, 0)).toBe(rows.filter((r) => r.p.status === 'settled').reduce((t, r) => t + r.p.amount, 0));
    expect(checkInvariants(e.state(), e.ledger(), WS)).toEqual([]);
    e.advance(5);
    expect(checkInvariants(e.state(), e.ledger(), WS)).toEqual([]);
  });

  it('a same-morning switch and switch back charges no deposit for the cancelled POs', () => {
    const base = engineAt();
    const e = engineAt();
    expect(e.dispatch({ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_dogumetal' }).ok).toBe(true);
    const deposits = e.state().payables.filter((p) => p.source === 'po_deposit' && p.status === 'open');
    expect(deposits.length).toBeGreaterThan(0);
    expect(e.dispatch({ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }).ok).toBe(true);
    for (const p of deposits) expect(e.state().payables.find((x) => x.id === p.id)?.status, p.id).toBe('cancelled');
    const rows = depositsOfCancelled(e);
    expect(rows.filter((r) => r.p.status === 'cancelled')).toHaveLength(deposits.length);
    expect(ofType(e.ledger(), 'DepositForfeited')).toHaveLength(0);
    e.advance(1);
    base.advance(1);
    expect(ofType(e.ledger(), 'PayableSettled').filter((x) => deposits.some((p) => p.id === x.payload.payableId))).toHaveLength(0);
    expect(e.state().cash).toBe(base.state().cash);
    expect(checkInvariants(e.state(), e.ledger(), WS)).toEqual([]);
  });

  it('tiny company: cancelling a PO whose deposit is open cancels the payable; once paid, it is forfeited', () => {
    // s2 asks a 50% deposit. Switch to s2 (deposit due today), then back the same day: cancelled unpaid.
    const same = tinyWithOrder();
    expect(same.dispatch({ type: 'switchSupplier', materialId: 'm1', toSupplierId: 's2' }).ok).toBe(true);
    expect(same.dispatch({ type: 'switchSupplier', materialId: 'm1', toSupplierId: 's1' }).ok).toBe(true);
    expect(same.state().payables).toEqual([expect.objectContaining({ source: 'po_deposit', amount: tl(180), status: 'cancelled' })]);
    const opening = same.state().cash;
    runTo(same, 2);
    expect(same.state().cash).toBe(opening);
    // switch back a day later: the 180 TRY deposit was paid on Day 1 evening and is forfeited
    const late = tinyWithOrder();
    expect(late.dispatch({ type: 'switchSupplier', materialId: 'm1', toSupplierId: 's2' }).ok).toBe(true);
    runTo(late, 2);
    expect(late.dispatch({ type: 'switchSupplier', materialId: 'm1', toSupplierId: 's1' }).ok).toBe(true);
    const lost = ofType(late.ledger(), 'DepositForfeited');
    expect(lost.map((x) => [x.day, x.payload.supplierId, x.payload.amount])).toEqual([[2, 's2', tl(180)]]);
    expect(late.state().cash).toBe(opening - tl(180));
    expect(checkInvariants(late.state(), late.ledger(), TINY_WS)).toEqual([]);
  });
});
