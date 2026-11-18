/**
 * Every decision path changes state, differently; the ledger records the decision with its cause.
 * Real seed, rngSeed 42. Steel decision dec-0001 opens Day 1; discount decision dec-0002 opens Day 9.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, engineAt } from '../test/seedFixture';
import {
  type Command,
  type CompanyState,
  type Engine,
  type GameEvent,
  type Money,
  type OperationalCommand,
  advanceState,
  mulBps,
  selectDecision,
  selectMorningReport,
  stateHash,
} from './index';
import { cloneState } from './events/tx';

type Path = 'none' | 'absorb' | 'reject' | 'negotiate' | 'switch' | 'passOn' | 'custom';
const PATHS: readonly Path[] = ['none', 'absorb', 'reject', 'negotiate', 'switch', 'passOn', 'custom'];

const CUSTOM: Command = {
  type: 'customDecision',
  decisionId: STEEL_DECISION,
  commands: [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 200_000 }],
};

function commandFor(path: Path): Command | null {
  switch (path) {
    case 'none':
      return null;
    case 'reject':
      return { type: 'rejectDecision', decisionId: STEEL_DECISION };
    case 'custom':
      return CUSTOM;
    default:
      return { type: 'approveOption', decisionId: STEEL_DECISION, optionId: path };
  }
}

interface Run {
  engine: Engine;
  commandId: string | null;
  day1Hash: string;
}

function run(path: Path, days = 30): Run {
  const engine = engineAt();
  const cmd = commandFor(path);
  let commandId: string | null = null;
  if (cmd) {
    const r = engine.dispatch(cmd);
    if (!r.ok) throw new Error(`${path}: ${r.error.code}`);
    commandId = r.commandId;
  }
  const day1Hash = stateHash(engine.state());
  engine.advance(days);
  return { engine, commandId, day1Hash };
}

/** State without decision bookkeeping: what the company actually looks like. */
function operationalHash(s: Readonly<CompanyState>): string {
  return stateHash({ ...s, decisions: [], developments: [], nextSeq: 0, nextCommandSeq: 0 } as CompanyState);
}

const ofType = <T extends GameEvent['type']>(l: readonly GameEvent[], t: T): Extract<GameEvent, { type: T }>[] =>
  l.filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);
const causedBy = (l: readonly GameEvent[], seq: number): GameEvent[] => l.filter((e) => e.cause.kind === 'event' && e.cause.seq === seq);

const runs = new Map<Path, Run>(PATHS.map((p) => [p, run(p)]));
const get = (p: Path): Run => {
  const r = runs.get(p);
  if (!r) throw new Error(p);
  return r;
};
const day1Hash = stateHash(engineAt().state());

describe('steel decision: each path leads to a different state', () => {
  it('every path reaches Day 31', () => {
    for (const p of PATHS) expect(get(p).engine.state().day).toBe(31);
  });

  it('every action changes the Day-1 state immediately (no-op dispatches do not exist)', () => {
    for (const p of PATHS) if (p !== 'none') expect(get(p).day1Hash, p).not.toBe(day1Hash);
  });

  it('Day-31 stateHash differs between all seven paths (absorb, reject, A, B, C, custom, no decision)', () => {
    const hashes = PATHS.map((p) => stateHash(get(p).engine.state()));
    expect(new Set(hashes).size).toBe(PATHS.length);
  });

  it('A, B, C and custom change the company itself; absorb = reject = deadline expiry (the baseline)', () => {
    const op = (p: Path): string => operationalHash(get(p).engine.state());
    const distinct = ['absorb', 'negotiate', 'switch', 'passOn', 'custom'] as const;
    expect(new Set(distinct.map(op)).size).toBe(distinct.length);
    expect(op('reject')).toBe(op('absorb'));
    expect(op('none')).toBe(op('absorb'));
  });

  it('each option moves the KPIs it is about', () => {
    const s = (p: Path): Readonly<CompanyState> => get(p).engine.state();
    const steelOffer = (st: Readonly<CompanyState>, sup: string): number =>
      st.suppliers.find((x) => x.id === sup)?.offers.find((o) => o.materialId === 'steel')?.unitPrice ?? NaN;
    // A: negotiated price below the +20% price; more steel bought
    expect(steelOffer(s('negotiate'), 'sup_kuzeycelik')).toBeLessThan(steelOffer(s('absorb'), 'sup_kuzeycelik'));
    // B: preferred steel supplier changed
    expect(s('switch').materials.find((m) => m.id === 'steel')?.preferredSupplierId).toBe('sup_dogumetal');
    expect(s('absorb').materials.find((m) => m.id === 'steel')?.preferredSupplierId).toBe('sup_kuzeycelik');
    // C: customers pay more for the same orders and are less satisfied
    const value = (st: Readonly<CompanyState>, id: string): number => st.orders.find((o) => o.id === id)?.value ?? NaN;
    expect(value(s('passOn'), 'ord-0015')).toBeGreaterThan(value(s('absorb'), 'ord-0015'));
    expect(selectMorningReport(s('passOn')).satisfaction.average).toBeLessThan(selectMorningReport(s('absorb')).satisfaction.average);
    // custom: the extra PO exists only on that path
    const extra = (st: Readonly<CompanyState>): number => st.purchaseOrders.filter((p) => p.orderedDay === 1 && p.forOrderId === null && p.qty === 200_000).length;
    expect(extra(s('custom'))).toBe(1);
    expect(extra(s('absorb'))).toBe(0);
  });
});

describe('steel decision: the ledger records each decision with its cause', () => {
  it('approve / reject / custom: DecisionResolved caused by the accepted command, development resolved', () => {
    const expected: Partial<Record<Path, { status: string; optionId: string | null }>> = {
      absorb: { status: 'approved', optionId: 'absorb' },
      negotiate: { status: 'approved', optionId: 'negotiate' },
      switch: { status: 'approved', optionId: 'switch' },
      passOn: { status: 'approved', optionId: 'passOn' },
      reject: { status: 'rejected', optionId: 'absorb' },
      custom: { status: 'approved', optionId: null },
    };
    for (const [p, exp] of Object.entries(expected) as [Path, { status: string; optionId: string | null }][]) {
      const { engine, commandId } = get(p);
      const l = engine.ledger();
      const accepted = ofType(l, 'CommandAccepted').filter((e) => e.payload.commandId === commandId);
      expect(accepted, p).toHaveLength(1);
      const resolved = ofType(l, 'DecisionResolved').filter((e) => e.payload.decisionId === STEEL_DECISION);
      expect(resolved, p).toHaveLength(1);
      const ev = resolved[0];
      expect(ev?.day).toBe(1);
      expect(ev?.cause).toEqual({ kind: 'command', commandId });
      expect({ status: ev?.payload.status, optionId: ev?.payload.optionId }, p).toEqual(exp);
      expect(ev?.code).toBe('ledger.DecisionResolved');
      const dev = causedBy(l, ev?.seq ?? -1).filter((e) => e.type === 'DevelopmentResolved');
      expect(dev, p).toHaveLength(1);
      const d = engine.state().decisions.find((x) => x.id === STEEL_DECISION);
      expect(d?.status).toBe(exp.status);
      expect(d?.chosenOptionId).toBe(exp.optionId);
      expect(d?.decidedDay).toBe(1);
    }
  });

  it("an option's commands produce events caused by the decision", () => {
    const effects = (p: Path): GameEvent['type'][] => {
      const l = get(p).engine.ledger();
      const ev = ofType(l, 'DecisionResolved').find((e) => e.payload.decisionId === STEEL_DECISION);
      return causedBy(l, ev?.seq ?? -1).map((e) => e.type);
    };
    expect(effects('absorb')).toEqual(['DevelopmentResolved']);
    expect(effects('reject')).toEqual(['DevelopmentResolved']);
    expect(effects('negotiate')).toEqual(expect.arrayContaining(['SupplierPriceChanged', 'PurchaseOrderPlaced']));
    expect(effects('switch')).toEqual(expect.arrayContaining(['PreferredSupplierChanged']));
    expect(effects('passOn')).toEqual(expect.arrayContaining(['OrderRepriced']));
    expect(effects('custom')).toEqual(expect.arrayContaining(['PurchaseOrderPlaced']));
    // pass-on reprices every open steel order (all four families use steel)
    const l = get('passOn').engine.ledger();
    const ev = ofType(l, 'DecisionResolved').find((e) => e.payload.decisionId === STEEL_DECISION);
    const repriced = causedBy(l, ev?.seq ?? -1).filter((e) => e.type === 'OrderRepriced').length;
    expect(repriced).toBe(selectMorningReport(engineAt().state()).backlog.openOrders);
  });

  it('no decision: expires to the default option on its deadline morning, not before', () => {
    const e = engineAt();
    const deadline = e.state().decisions.find((d) => d.id === STEEL_DECISION)?.deadlineDay ?? NaN;
    expect(deadline).toBe(8);
    e.advance(deadline - 2);
    expect(e.state().day).toBe(deadline - 1);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('open');
    e.advance(1);
    const d = e.state().decisions.find((x) => x.id === STEEL_DECISION);
    expect(d?.status).toBe('expired');
    expect(d?.chosenOptionId).toBe(d?.defaultOptionId);
    const ev = ofType(e.ledger(), 'DecisionResolved').find((x) => x.payload.decisionId === STEEL_DECISION);
    expect(ev?.day).toBe(deadline);
    expect(ev?.cause).toEqual({ kind: 'rule', ruleId: 'rule.decision.deadline' });
  });
});

describe('request analysis', () => {
  it('changes state, keeps the decision open, and costs a day before the 90-day analysis is ready', () => {
    const e = engineAt();
    const h = stateHash(e.state());
    const r = e.dispatch({ type: 'requestAnalysis', decisionId: STEEL_DECISION });
    expect(r.ok).toBe(true);
    expect(stateHash(e.state())).not.toBe(h);
    expect(e.state().decisions.find((d) => d.id === STEEL_DECISION)?.status).toBe('open');
    const same = selectDecision(e.state(), STEEL_DECISION);
    expect(same?.analysis?.ready).toBe(false);
    expect(same?.analysis?.extended).toBeNull();
    expect(selectMorningReport(e.state()).pendingDecisions[0]?.analysisReady).toBe(false);
    e.advance(1);
    const next = selectDecision(e.state(), STEEL_DECISION);
    expect(next?.analysis?.ready).toBe(true);
    expect(next?.analysis?.extended?.horizons).toEqual([7, 30, 90]);
    expect(next?.analysis?.extended?.options.map((o) => o.horizons.map((x) => x.horizonDays))).toEqual(
      next?.decision.options.map(() => [7, 30, 90]),
    );
    expect(selectMorningReport(e.state()).pendingDecisions[0]?.analysisReady).toBe(true);
    // the decision can still be taken afterwards
    expect(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }).ok).toBe(true);
  });
});

describe('discount demand (Day 9): grant, refuse and expiry', () => {
  const DISCOUNT = 'dec-0002';
  const atDay9 = (): Engine => {
    const e = engineAt();
    e.advance(8);
    return e;
  };

  it('opens on Day 9 with grant / refuse options, refuse as default', () => {
    const e = engineAt();
    e.advance(7);
    expect(e.state().decisions.some((d) => d.id === DISCOUNT)).toBe(false);
    e.advance(1);
    const d = e.state().decisions.find((x) => x.id === DISCOUNT);
    expect(d?.status).toBe('open');
    expect(d?.openedDay).toBe(9);
    expect(d?.options.map((o) => o.id)).toEqual(['grant', 'refuse']);
    expect(d?.defaultOptionId).toBe('refuse');
  });

  it('grant cuts the customer’s open orders by the discount and raises satisfaction; refuse lowers it', () => {
    const base = atDay9().state();
    const card = base.eventCards.find((c) => c.id === 'card_discount_demand');
    if (card?.effect.kind !== 'discountDemand') throw new Error('discount card missing');
    const fx = card.effect;
    const cust = (s: Readonly<CompanyState>) => s.customers.find((c) => c.id === fx.customerId);
    const open = base.orders.filter((o) => o.customerId === fx.customerId && ['registered', 'scheduled', 'in_production'].includes(o.status));
    expect(open.length).toBeGreaterThan(0);

    const g = atDay9();
    expect(g.dispatch({ type: 'approveOption', decisionId: DISCOUNT, optionId: 'grant' }).ok).toBe(true);
    for (const o of open) {
      const after = g.state().orders.find((x) => x.id === o.id);
      expect(after?.unitPrice).toBe(o.unitPrice - mulBps(o.unitPrice, fx.discountBps));
      expect(after?.value).toBe((after?.unitPrice ?? 0) * o.qty);
    }
    expect(cust(g.state())?.discountBps).toBe(fx.discountBps);
    expect((cust(g.state())?.satisfaction ?? 0) - (cust(base)?.satisfaction ?? 0)).toBe(fx.acceptance.satisfactionDelta);

    const r = atDay9();
    expect(r.dispatch({ type: 'approveOption', decisionId: DISCOUNT, optionId: 'refuse' }).ok).toBe(true);
    expect((cust(r.state())?.satisfaction ?? 0) - (cust(base)?.satisfaction ?? 0)).toBe(fx.refusal.satisfactionDelta);
    expect((cust(r.state())?.churnRisk ?? 0) - (cust(base)?.churnRisk ?? 0)).toBe(fx.refusal.churnRiskDelta);
    expect(r.state().orders.filter((o) => o.customerId === fx.customerId).map((o) => o.value)).toEqual(
      base.orders.filter((o) => o.customerId === fx.customerId).map((o) => o.value),
    );
  });

  it('grant, refuse and expiry give three different Day-31 states', () => {
    const final = (opt: 'grant' | 'refuse' | null): string => {
      const e = atDay9();
      if (opt) expect(e.dispatch({ type: 'approveOption', decisionId: DISCOUNT, optionId: opt }).ok).toBe(true);
      e.advance(22);
      expect(e.state().day).toBe(31);
      return stateHash(e.state());
    };
    expect(new Set([final('grant'), final('refuse'), final(null)]).size).toBe(3);
  });
});

describe('discounts reprice from the pre-discount price (review fix 5)', () => {
  it('granting 800 bps twice leaves open orders at 8% off, the same price a new order gets', () => {
    const e = engineAt();
    e.advance(8);
    const d = e.state().decisions.find((x) => x.id === 'dec-0002');
    if (d?.basis.kind !== 'discountDemand') throw new Error('discount basis');
    const { customerId, discountBps } = d.basis;
    expect(discountBps).toBe(800);
    const isOpen = (o: { status: string }): boolean => ['registered', 'scheduled', 'in_production'].includes(o.status);
    const open = e.state().orders.filter((o) => o.customerId === customerId && isOpen(o));
    expect(open.length).toBeGreaterThan(0);
    expect(e.dispatch({ type: 'approveOption', decisionId: 'dec-0002', optionId: 'grant' }).ok).toBe(true);
    const satAfterFirst = e.state().customers.find((c) => c.id === customerId)?.satisfaction;
    expect(e.dispatch({ type: 'grantDiscount', customerId, discountBps }).ok).toBe(true);
    const listOf = (familyId: string): Money => {
      const f = e.state().productFamilies.find((x) => x.id === familyId);
      if (!f) throw new Error(familyId);
      return f.unitPrice;
    };
    for (const o of open) {
      const now = e.state().orders.find((x) => x.id === o.id);
      expect(now?.listUnitPrice).toBe(o.listUnitPrice);
      expect(now?.unitPrice, o.id).toBe(o.listUnitPrice - mulBps(o.listUnitPrice, 800));
      // seed and demand orders are at list price: exactly what systems/demand.ts charges a new order
      expect(now?.unitPrice).toBe(listOf(o.familyId) - mulBps(listOf(o.familyId), 800));
    }
    // the second, identical grant is not a further concession: no extra goodwill
    expect(e.state().customers.find((c) => c.id === customerId)?.satisfaction).toBe(satAfterFirst);
    // the customer's next order (its cadence) arrives at the same price as the repriced ones
    const known = new Set(e.state().orders.map((o) => o.id));
    e.advance(10);
    const fresh = e.state().orders.filter((o) => o.customerId === customerId && !known.has(o.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const o of fresh) {
      expect(o.listUnitPrice).toBe(listOf(o.familyId));
      expect(o.unitPrice).toBe(listOf(o.familyId) - mulBps(listOf(o.familyId), 800));
      const repriced = open.find((x) => x.familyId === o.familyId);
      if (repriced) expect(o.unitPrice).toBe(e.state().orders.find((x) => x.id === repriced.id)?.unitPrice);
    }
  });
});

describe('deadline expiry validates the default option (review fix 8)', () => {
  /** Day-1 state whose steel default option ('absorb') holds a command that is not valid. */
  const withInvalidDefault = (bad: OperationalCommand): CompanyState => {
    const s = cloneState(engineAt().state()) as CompanyState;
    const d = s.decisions.find((x) => x.id === STEEL_DECISION);
    const absorb = d?.options.find((o) => o.id === d.defaultOptionId);
    if (!absorb) throw new Error('default option');
    absorb.commands = [bad];
    return s;
  };

  it.each([
    [{ type: 'placePurchaseOrder', supplierId: 'sup_nobody', materialId: 'steel', qty: 1000 } as OperationalCommand, 'error.unknownSupplier'],
    [{ type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1.5 } as OperationalCommand, 'error.invalidAmount'],
    [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' } as OperationalCommand, 'error.alreadyPreferred'],
  ])('%j: expires with no action and ledgers the reason', (bad, code) => {
    const start = withInvalidDefault(bad);
    const r = advanceState(start, 7);
    const s = r.state;
    expect(s.day).toBe(8);
    const d = s.decisions.find((x) => x.id === STEEL_DECISION);
    expect(d?.status).toBe('expired');
    expect(d?.chosenOptionId).toBeNull();
    expect(s.developments.find((x) => x.id === d?.developmentId)?.status).toBe('resolved');
    const failed = r.events.filter((x) => x.type === 'DecisionDefaultFailed');
    expect(failed).toHaveLength(1);
    const f = failed[0];
    if (f?.type !== 'DecisionDefaultFailed') throw new Error('no failure event');
    expect(f.day).toBe(8);
    expect(f.cause).toEqual({ kind: 'rule', ruleId: 'rule.decision.deadline' });
    expect(f.payload).toMatchObject({ decisionId: STEEL_DECISION, optionId: 'absorb', error: { code } });
    expect(f.params.reason).toBe(code);
    const resolved = r.events.filter((x) => x.type === 'DecisionResolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.cause).toEqual({ kind: 'event', seq: f.seq });
    // nothing from the invalid command ran: the resolution caused only the development's resolution
    expect(r.events.filter((x) => x.cause.kind === 'event' && x.cause.seq === resolved[0]?.seq).map((x) => x.type)).toEqual(['DevelopmentResolved']);
    expect(s.materials.find((m) => m.id === 'steel')?.preferredSupplierId).toBe('sup_kuzeycelik');
    expect(s.purchaseOrders.some((p) => p.supplierId === 'sup_nobody' || p.qty === 1.5)).toBe(false);
  });
});
