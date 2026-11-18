/**
 * Command validation: invalid commands return a typed error (i18n code + params) and change nothing:
 * not the state, not the ledger, not the save-game log.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, engineAt } from '../test/seedFixture';
import {
  type Command,
  type CompanyState,
  CUSTOMER_RULES,
  CUSTOM_ALLOWED,
  type Customer,
  type Engine,
  type OperationalCommand,
  mulBps,
  stateHash,
  subM,
  timesQty,
  tl,
} from './index';
import { COMMAND_LIMITS, validateOperational } from './commands/handle';
import { passOnReaction } from './systems/customers';

function expectRejected(e: Engine, cmd: Command, code: string): void {
  const h = stateHash(e.state());
  const json = JSON.stringify(e.state());
  const ledgerLen = e.ledger().length;
  const log = JSON.stringify(e.snapshot().log);
  const r = e.dispatch(cmd);
  expect(r.ok, `${JSON.stringify(cmd)} should be rejected`).toBe(false);
  if (r.ok) return;
  expect(r.error.code).toBe(code);
  expect(typeof r.error.params).toBe('object');
  expect(stateHash(e.state())).toBe(h);
  expect(JSON.stringify(e.state())).toBe(json);
  expect(e.ledger().length).toBe(ledgerLen);
  expect(JSON.stringify(e.snapshot().log)).toBe(log);
}

const approve = (optionId: string, decisionId = STEEL_DECISION): Command => ({ type: 'approveOption', decisionId, optionId });

describe('decision commands', () => {
  it('approving a non-existent option or decision', () => {
    const e = engineAt();
    expectRejected(e, approve('nope'), 'error.unknownOption');
    expectRejected(e, approve('absorb', 'dec-9999'), 'error.unknownDecision');
    expectRejected(e, { type: 'rejectDecision', decisionId: 'dec-9999' }, 'error.unknownDecision');
    expectRejected(e, { type: 'requestAnalysis', decisionId: 'dec-9999' }, 'error.unknownDecision');
  });

  it('approving twice, or acting on a decision already decided', () => {
    const e = engineAt();
    expect(e.dispatch(approve('negotiate')).ok).toBe(true);
    expectRejected(e, approve('negotiate'), 'error.decisionClosed');
    expectRejected(e, approve('switch'), 'error.decisionClosed');
    expectRejected(e, { type: 'rejectDecision', decisionId: STEEL_DECISION }, 'error.decisionClosed');
    expectRejected(e, { type: 'requestAnalysis', decisionId: STEEL_DECISION }, 'error.decisionClosed');
    expectRejected(
      e,
      { type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1000 }] },
      'error.decisionClosed',
    );
  });

  it('approving a decision closed by its deadline', () => {
    const e = engineAt();
    e.advance(7);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('expired');
    const r = e.dispatch(approve('switch'));
    expect(r.ok ? null : r.error).toEqual({ code: 'error.decisionClosed', params: { decisionId: STEEL_DECISION, status: 'expired' } });
    expectRejected(e, approve('switch'), 'error.decisionClosed');
  });

  it('requesting analysis twice', () => {
    const e = engineAt();
    expect(e.dispatch({ type: 'requestAnalysis', decisionId: STEEL_DECISION }).ok).toBe(true);
    expectRejected(e, { type: 'requestAnalysis', decisionId: STEEL_DECISION }, 'error.analysisAlreadyRequested');
  });
});

describe('custom decisions and operational commands', () => {
  it('rejects command types not on the allow-list, inside a custom decision or on their own', () => {
    const e = engineAt();
    expect(CUSTOM_ALLOWED).not.toContain('customerReaction');
    const reaction = { type: 'customerReaction', customerId: 'cus_demirhan', satisfactionDelta: 1000, churnRiskDelta: -1000, reasonCode: 'reason.test' } as unknown as Command;
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [reaction as never] }, 'error.commandNotAllowed');
    expectRejected(
      e,
      {
        type: 'customDecision',
        decisionId: STEEL_DECISION,
        commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1000 }, reaction as never],
      },
      'error.commandNotAllowed',
    );
    expectRejected(e, reaction, 'error.commandNotAllowed');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }] } as unknown as Command, 'error.commandNotAllowed');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [] }, 'error.emptyCustomDecision');
    expectRejected(e, { type: 'launchRocket' } as unknown as Command, 'error.commandNotAllowed');
  });

  it('validates operational parameters (ids, integer money, ranges)', () => {
    const e = engineAt();
    // setSupplierPrice is engine-built only: the CEO cannot send it; its own checks still guard engine options
    const steelDecision = e.state().decisions.find((d) => d.id === STEEL_DECISION) ?? null;
    const engineCases: [OperationalCommand, string][] = [
      [{ type: 'setSupplierPrice', supplierId: 'sup_nobody', materialId: 'steel', unitPrice: tl(40) }, 'error.unknownSupplier'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'aluminium', unitPrice: tl(40) }, 'error.noOffer'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 40.5 as never }, 'error.invalidAmount'],
      [{ type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 0 as never }, 'error.invalidAmount'],
    ];
    for (const [cmd, code] of engineCases) {
      expect(validateOperational(e.state(), cmd, steelDecision)?.code, JSON.stringify(cmd)).toBe(code);
      expectRejected(e, cmd as unknown as Command, 'error.commandNotAllowed');
      expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [cmd as never] }, 'error.commandNotAllowed');
    }
    const cases: [Command, string][] = [
      [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 0 }, 'error.invalidAmount'],
      [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1.5 }, 'error.invalidAmount'],
      [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }, 'error.alreadyPreferred'],
      [{ type: 'switchSupplier', materialId: 'unobtainium', toSupplierId: 'sup_dogumetal' }, 'error.unknownMaterial'],
      [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_alpaka' }, 'error.noOffer'],
      [{ type: 'grantDiscount', customerId: 'cus_nobody', discountBps: 500 }, 'error.unknownCustomer'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 6000 }, 'error.invalidRate'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: -1 }, 'error.invalidRate'],
      [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 10001 }, 'error.invalidRate'],
    ];
    for (const [cmd, code] of cases) expectRejected(e, cmd, code);
    // the same checks guard custom decisions
    for (const [cmd, code] of cases) expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [cmd as never] }, code);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('open');
  });

  it('a valid custom decision with allowed commands resolves the decision', () => {
    const e = engineAt();
    const pos = e.state().purchaseOrders.length;
    const r = e.dispatch({
      type: 'customDecision',
      decisionId: STEEL_DECISION,
      commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 43_000 }],
    });
    expect(r.ok).toBe(true);
    const d = e.state().decisions.find((x) => x.id === STEEL_DECISION);
    expect(d?.status).toBe('approved');
    expect(d?.chosenOptionId).toBeNull();
    expect(d?.custom).toHaveLength(1);
    expect(e.state().purchaseOrders).toHaveLength(pos + 1);
    expect(e.state().purchaseOrders[pos]).toMatchObject({ supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 43_000, forOrderId: null });
  });
});

describe('desk commands', () => {
  it('acknowledging unknown, already-read, or decision-bearing telegrams', () => {
    const e = engineAt();
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-9999' }, 'error.unknownDevelopment');
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0002' }, 'error.developmentHasOpenDecision');
    expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }).ok).toBe(true);
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }, 'error.developmentNotNew');
    expect(e.dispatch(approve('absorb')).ok).toBe(true);
    expectRejected(e, { type: 'acknowledgeDevelopment', developmentId: 'dev-0002' }, 'error.developmentNotNew');
  });
});

describe('CEO commands carry intent only; the engine derives every outcome (review fix 1)', () => {
  const DISCOUNT = 'dec-0002';
  const steel = (s: Readonly<CompanyState>, sup = 'sup_kuzeycelik'): number =>
    s.suppliers.find((x) => x.id === sup)?.offers.find((o) => o.materialId === 'steel')?.unitPrice ?? NaN;
  const cust = (s: Readonly<CompanyState>, id: string): Customer => {
    const c = s.customers.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };

  it('rejects floats, NaN, Infinity, strings, missing / extra fields and out-of-range numbers, state unchanged', () => {
    const e = engineAt();
    const po = { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel' };
    const bad: [unknown, string][] = [
      [{ ...po, qty: 2.5 }, 'error.invalidAmount'],
      [{ ...po, qty: Number.NaN }, 'error.invalidAmount'],
      [{ ...po, qty: Number.POSITIVE_INFINITY }, 'error.invalidAmount'],
      [{ ...po, qty: '1000' }, 'error.invalidAmount'],
      [{ ...po, qty: -10 }, 'error.invalidAmount'],
      [{ ...po, qty: COMMAND_LIMITS.maxPurchaseQty + 1 }, 'error.invalidAmount'],
      [po, 'error.missingField'],
      [{ ...po, qty: 1000, unitPrice: 1 }, 'error.unexpectedField'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 2.5 }, 'error.invalidRate'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: Number.NaN }, 'error.invalidRate'],
      [{ type: 'grantDiscount', customerId: 'cus_velora' }, 'error.missingField'],
      [{ type: 'grantDiscount', discountBps: 500 }, 'error.missingField'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 500, satisfactionDelta: 2.5 }, 'error.unexpectedField'],
      [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 500, churnRiskDelta: -10000 }, 'error.unexpectedField'],
      [{ type: 'repriceOrders', materialId: 'steel' }, 'error.missingField'],
      [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000.5 }, 'error.invalidRate'],
      [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 10000, unitCostIncrease: 100 }, 'error.unexpectedField'],
      [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 10000, reaction: { satisfactionDelta: 0, churnRiskDelta: 0, paymentDelayDays: 0 } }, 'error.unexpectedField'],
      [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 42 }, 'error.invalidField'],
      [{ type: 'switchSupplier', toSupplierId: 'sup_dogumetal' }, 'error.missingField'],
    ];
    for (const [cmd, code] of bad) {
      expectRejected(e, cmd as Command, code);
      expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [cmd as never] }, code);
    }
    // malformed envelopes are typed errors too, never a TypeError
    expectRejected(e, null as unknown as Command, 'error.invalidCommand');
    expectRejected(e, {} as unknown as Command, 'error.invalidCommand');
    expectRejected(e, { type: 7 } as unknown as Command, 'error.invalidCommand');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [null as never] }, 'error.invalidCommand');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: 'all' as never }, 'error.invalidField');
    expectRejected(e, { type: 'approveOption', decisionId: STEEL_DECISION } as unknown as Command, 'error.missingField');
    expectRejected(e, { type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch', extra: 1 } as unknown as Command, 'error.unexpectedField');
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('open');
  });

  it("probe: a custom decision cannot set a customer's satisfaction or churn risk", () => {
    const e = engineAt();
    const before = cust(e.state(), 'cus_demirhan');
    const probe = { type: 'grantDiscount', customerId: 'cus_demirhan', discountBps: 0, satisfactionDelta: 2.5, churnRiskDelta: -10000 };
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [probe as never] }, 'error.unexpectedField');
    expect(cust(e.state(), 'cus_demirhan')).toEqual(before);
  });

  it('probe: setSupplierPrice (steel at 1 kuruş) cannot be dispatched or composed', () => {
    const e = engineAt();
    expect(CUSTOM_ALLOWED).not.toContain('setSupplierPrice');
    const cheap = { type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: 1 };
    expectRejected(e, cheap as unknown as Command, 'error.commandNotAllowed');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [cheap as never] }, 'error.commandNotAllowed');
    expect(steel(e.state())).toBe(4560);
  });

  it('probe: repriceOrders with no reaction is a typed error; it needs a supplier-price decision on its material', () => {
    const e = engineAt();
    const pass = { type: 'repriceOrders', materialId: 'steel', passThroughBps: 10000 } as const;
    expectRejected(e, pass, 'error.noPriceChangeToPass');
    expectRejected(e, { type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ ...pass, materialId: 'aluminium' }] }, 'error.noPriceChangeToPass');
    e.advance(8);
    expectRejected(e, { type: 'customDecision', decisionId: DISCOUNT, commands: [pass] }, 'error.noPriceChangeToPass');
  });

  it('a custom half pass-through gets half the rise and half the reaction, derived from the decision basis', () => {
    const e = engineAt();
    const d = e.state().decisions.find((x) => x.id === STEEL_DECISION);
    if (d?.basis.kind !== 'supplierPrice') throw new Error('steel basis');
    const basis = d.basis;
    const before = e.state();
    expect(e.dispatch({ type: 'customDecision', decisionId: STEEL_DECISION, commands: [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 }] }).ok).toBe(true);
    const after = e.state();
    const half = passOnReaction(basis.customerReaction, 5000);
    expect(half).toEqual({ satisfactionDelta: -350, churnRiskDelta: 450, paymentDelayDays: 5 });
    const touched = new Set<string>();
    for (const o of before.orders.filter((x) => ['registered', 'scheduled', 'in_production'].includes(x.status))) {
      const bom = before.productFamilies.find((f) => f.id === o.familyId)?.bom.find((b) => b.materialId === 'steel');
      if (!bom) continue;
      touched.add(o.customerId);
      const inc = mulBps(timesQty(subM(basis.newPrice, basis.previousPrice), bom.qtyPerUnit), 5000);
      expect(after.orders.find((x) => x.id === o.id)?.unitPrice).toBe(o.unitPrice + inc);
    }
    expect(touched.size).toBeGreaterThan(0);
    for (const id of touched) {
      const b = cust(before, id);
      const a = cust(after, id);
      expect(a.satisfaction - b.satisfaction, id).toBe(half.satisfactionDelta);
      expect(a.churnRisk - b.churnRisk, id).toBe(half.churnRiskDelta);
      expect(a.paymentDelayDays - b.paymentDelayDays, id).toBe(half.paymentDelayDays);
      expect(Number.isInteger(a.satisfaction)).toBe(true);
    }
    for (const c of after.customers.filter((x) => !touched.has(x.id))) expect(c).toEqual(cust(before, c.id));
  });

  it('a partial discount on a discount demand interpolates between refusal and acceptance; an unsolicited one earns rule goodwill', () => {
    const e = engineAt();
    e.advance(8);
    const d = e.state().decisions.find((x) => x.id === DISCOUNT);
    if (d?.basis.kind !== 'discountDemand') throw new Error('discount basis');
    const { customerId, refusal, acceptance } = d.basis;
    const before = cust(e.state(), customerId);
    expect(e.dispatch({ type: 'customDecision', decisionId: DISCOUNT, commands: [{ type: 'grantDiscount', customerId, discountBps: 400 }] }).ok).toBe(true);
    const after = cust(e.state(), customerId);
    // half of 800 bps: halfway from refusal (-6.00 / +800 bps) to acceptance (+3.00 / -500 bps)
    expect(after.satisfaction - before.satisfaction).toBe(refusal.satisfactionDelta + (acceptance.satisfactionDelta - refusal.satisfactionDelta) / 2);
    expect(after.satisfaction - before.satisfaction).toBe(-150);
    expect(after.churnRisk - before.churnRisk).toBe(150);
    expect(after.discountBps).toBe(400);
    const ledger = e.ledger();
    expect(ledger.some((x) => x.type === 'CustomerSatisfactionChanged' && x.payload.customerId === customerId && x.payload.reasonCode === 'reason.discountPartial')).toBe(true);

    // unsolicited: +400 bps over the current 0 → 400 × 25 / 100 = +1.00 point; churn follows satisfaction
    const other = cust(e.state(), 'cus_tunca');
    expect(other.discountBps).toBe(0);
    expect(e.dispatch({ type: 'grantDiscount', customerId: 'cus_tunca', discountBps: 400 }).ok).toBe(true);
    const otherAfter = cust(e.state(), 'cus_tunca');
    expect(otherAfter.satisfaction - other.satisfaction).toBe((400 * CUSTOMER_RULES.discountGoodwillPer100Bps) / 100);
    expect(otherAfter.churnRisk - other.churnRisk).toBe(-(otherAfter.satisfaction - other.satisfaction));
  });
});
