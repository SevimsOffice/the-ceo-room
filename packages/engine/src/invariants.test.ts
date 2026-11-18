/**
 * Invariants (SIMULATION_DESIGN §8), property-style: every steel path × several rngSeeds × 60 days,
 * checked every simulated day. Plus unit tests of the reducer guards and the cash system on a
 * tiny hand-built company.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, WS, engineAt } from '../test/seedFixture';
import { checkInvariants } from '../test/invariants';
import { TINY_WS, tinyEngine } from '../test/tinySeed';
import { type Command, type CompanyState, type Engine, type GameEvent, InvariantError, money, tl } from './index';
import { applyEvent } from './events/reduce';
import { cloneState } from './events/tx';

type Path = 'none' | 'absorb' | 'reject' | 'negotiate' | 'switch' | 'passOn' | 'custom';
const PATHS: readonly Path[] = ['none', 'absorb', 'reject', 'negotiate', 'switch', 'passOn', 'custom'];
const RNG_SEEDS = [42, 7, 2026] as const;

function steelCommand(path: Path): Command | null {
  if (path === 'none') return null;
  if (path === 'reject') return { type: 'rejectDecision', decisionId: STEEL_DECISION };
  if (path === 'custom') {
    return {
      type: 'customDecision',
      decisionId: STEEL_DECISION,
      commands: [
        { type: 'setSupplierPrice', supplierId: 'sup_kuzeycelik', materialId: 'steel', unitPrice: tl(42) },
        { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 150_000 },
      ],
    };
  }
  return { type: 'approveOption', decisionId: STEEL_DECISION, optionId: path };
}

describe('invariants hold every day for 60 days, for every option and several rngSeeds', () => {
  const cases = RNG_SEEDS.flatMap((rngSeed) => PATHS.map((path, i) => ({ rngSeed, path, discount: i % 3 })));

  it.each(cases)('rngSeed $rngSeed, steel path $path, discount variant $discount', ({ rngSeed, path, discount }) => {
    const e: Engine = engineAt(rngSeed);
    const check = (when: string): void => {
      const v = checkInvariants(e.state(), e.ledger(), WS);
      if (v.length) throw new Error(`${when}:\n${v.slice(0, 10).join('\n')}`);
    };
    check('day 1 morning');
    const cmd = steelCommand(path);
    if (cmd) {
      const r = e.dispatch(cmd);
      expect(r.ok).toBe(true);
    }
    check('after decision');
    for (let d = 0; d < 60; d++) {
      e.advance(1);
      // vary the discount decision too: grant / refuse / let it expire
      if (e.state().decisions.some((x) => x.id === 'dec-0002' && x.status === 'open') && discount < 2) {
        expect(e.dispatch({ type: 'approveOption', decisionId: 'dec-0002', optionId: discount === 0 ? 'grant' : 'refuse' }).ok).toBe(true);
      }
      check(`day ${e.state().day}`);
    }
    expect(e.state().day).toBe(61);
    // the ledger actually saw money move both ways
    const types = new Set(e.ledger().map((x) => x.type));
    for (const t of ['ReceivableCollected', 'PayableSettled', 'RecurringCostPaid', 'ProductionProgressed', 'OrderShipped'] as const) {
      expect(types.has(t), t).toBe(true);
    }
  });
});

describe('ledger shape', () => {
  it('seq is contiguous from 1 and every event carries day, workspace, cause and an i18n code', () => {
    const e = engineAt();
    e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'negotiate' });
    e.advance(30);
    const l = e.ledger();
    expect(l.map((x) => x.seq)).toEqual(l.map((_, i) => i + 1));
    for (const ev of l) {
      expect(Number.isInteger(ev.day)).toBe(true);
      expect(ev.workspaceId).toBe(WS);
      expect(ev.code).toBe(`ledger.${ev.type}`);
      expect(['command', 'rule', 'event']).toContain(ev.cause.kind);
    }
  });

  it('a failed command leaves no trace in the ledger', () => {
    const e = engineAt();
    const n = e.ledger().length;
    expect(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'nope' }).ok).toBe(false);
    expect(e.ledger().length).toBe(n);
    const ok = e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'absorb' });
    expect(ok.ok).toBe(true);
    expect(e.ledger()[n]?.seq).toBe((e.ledger()[n - 1]?.seq ?? 0) + 1);
  });
});

describe('the invariant checker is not vacuous', () => {
  const e = engineAt();
  e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' });
  e.advance(30);
  const state = e.state();
  const ledger = e.ledger();
  const has = (v: string[], re: RegExp): boolean => v.some((x) => re.test(x));

  it('passes on the real run', () => {
    expect(checkInvariants(state, ledger, WS)).toEqual([]);
  });

  it('catches a missing or duplicated settlement, a broken cause, a wrong workspace and negative stock', () => {
    const settle = ledger.findIndex((x) => x.type === 'PayableSettled');
    expect(settle).toBeGreaterThan(0);
    const dropped = ledger.filter((_, i) => i !== settle);
    expect(has(checkInvariants(state, dropped, WS), /cash .* != opening/)).toBe(true);
    const dup = [...ledger, { ...(ledger[settle] as GameEvent), seq: state.nextSeq }];
    expect(has(checkInvariants(state, dup, WS), /settled 2 times/)).toBe(true);
    const orphan = ledger.map((x, i) => (i === 5 ? ({ ...x, cause: { kind: 'event', seq: 99_999_999 } } as GameEvent) : x));
    expect(has(checkInvariants(state, orphan, WS), /is not an earlier ledger event/)).toBe(true);
    const noCause = ledger.map((x, i) => (i === 5 ? ({ ...x, cause: undefined } as unknown as GameEvent) : x));
    expect(has(checkInvariants(state, noCause, WS), /no cause/)).toBe(true);
    const reordered = [ledger[1] as GameEvent, ledger[0] as GameEvent, ...ledger.slice(2)];
    expect(has(checkInvariants(state, reordered, WS), /seq not strictly increasing/)).toBe(true);
    const tampered = cloneState(state) as CompanyState;
    (tampered.materials[0] as { stockQty: number }).stockQty = -1;
    (tampered.orders[0] as { workspaceId: string }).workspaceId = 'ws_other';
    const v = checkInvariants(tampered, ledger, WS);
    expect(has(v, /negative stock/)).toBe(true);
    expect(has(v, /orders\[0\]\.workspaceId/)).toBe(true);
    expect(has(checkInvariants(state, ledger, 'ws_other'), /workspaceId/)).toBe(true);
  });
});

// ---------------------------------------------------------------- tiny-state unit tests

const ev = <T extends GameEvent['type']>(s: CompanyState, type: T, payload: Extract<GameEvent, { type: T }>['payload']): GameEvent =>
  ({ seq: s.nextSeq, day: s.day, workspaceId: s.workspaceId, type, cause: { kind: 'rule', ruleId: 'test' }, code: `ledger.${type}`, params: {}, payload }) as GameEvent;

describe('reducer guards (tiny state)', () => {
  const withMoney = (): CompanyState => {
    const e = tinyEngine((s) => {
      s.finance.payables.push({ workspaceId: TINY_WS, id: 'pay-1', source: 'opening', poId: null, counterpartyId: 's1', amount: tl(100), dueDay: 3, status: 'open' });
      s.finance.receivables.push({
        workspaceId: TINY_WS, id: 'rcv-1', source: 'opening', orderId: null, customerId: 'c1', amount: tl(250), issuedDay: -30, dueDay: 5, expectedPayDay: 5, status: 'open',
      });
      s.materials[0] = { ...(s.materials[0] as (typeof s.materials)[number]), stockQty: 4, stockValue: tl(40) };
    });
    return cloneState(e.state()) as CompanyState;
  };

  it('settling a payable twice throws InvariantError', () => {
    const s = withMoney();
    applyEvent(s, ev(s, 'PayableSettled', { payableId: 'pay-1', amount: money(tl(100)) }));
    expect(s.cash).toBe(tl(100_000) - tl(100));
    expect(() => applyEvent(s, ev(s, 'PayableSettled', { payableId: 'pay-1', amount: money(tl(100)) }))).toThrow(InvariantError);
  });

  it('collecting a receivable twice throws InvariantError', () => {
    const s = withMoney();
    applyEvent(s, ev(s, 'ReceivableCollected', { receivableId: 'rcv-1', amount: money(tl(250)) }));
    expect(s.cash).toBe(tl(100_000) + tl(250));
    expect(() => applyEvent(s, ev(s, 'ReceivableCollected', { receivableId: 'rcv-1', amount: money(tl(250)) }))).toThrow(InvariantError);
  });

  it('consuming more stock than exists throws InvariantError', () => {
    const s = withMoney();
    s.orders.push({
      workspaceId: TINY_WS, id: 'ord-1', customerId: 'c1', familyId: 'f1', plantId: 'p1', qty: 3, unitPrice: money(tl(1000)), value: money(tl(3000)), paymentTermsDays: 60,
      receivedDay: 1, requestedDay: 10, promisedDay: 10, status: 'scheduled', minutesDone: 0, unitsDone: 0, materialCost: money(0), energyCost: money(0),
      costEstimate: money(0), blockedBy: null, shippedDay: null, source: 'seed', plan: null,
    });
    const consume = (qty: number) =>
      ev(s, 'ProductionProgressed', { orderId: 'ord-1', plantId: 'p1', minutes: 60, units: 1, consumed: [{ materialId: 'm1', qty, value: money(tl(10) * qty) }], energyCost: money(0) });
    applyEvent(s, consume(4));
    expect(s.materials[0]?.stockQty).toBe(0);
    expect(() => applyEvent(s, consume(2))).toThrow(InvariantError);
  });

  it('money must stay an integer', () => {
    expect(() => money(1.5)).toThrow(InvariantError);
    expect(() => tl(0.001)).not.toThrow(); // rounds to whole kuruş
    expect(tl(0.005) % 1).toBe(0);
  });
});

describe('cash system (tiny state)', () => {
  it('settles each payable and receivable exactly once, on its day, and pays recurring costs on schedule', () => {
    const e = tinyEngine((s) => {
      s.finance.payables.push({ workspaceId: TINY_WS, id: 'pay-1', source: 'opening', poId: null, counterpartyId: 's1', amount: tl(100), dueDay: 3, status: 'open' });
      s.finance.receivables.push({
        workspaceId: TINY_WS, id: 'rcv-1', source: 'opening', orderId: null, customerId: 'c1', amount: tl(250), issuedDay: -30, dueDay: 4, expectedPayDay: 5, status: 'open',
      });
      s.finance.recurringCosts.push({ workspaceId: TINY_WS, id: 'rc-ovh', kind: 'overhead', amount: tl(70), everyDays: 7, nextDueDay: 2 });
      s.finance.recurringCosts.push({ workspaceId: TINY_WS, id: 'rc-pay', kind: 'payroll', amount: tl(0), everyDays: 30, nextDueDay: 10 });
    });
    const opening = e.state().cash;
    const cashAfterDay: number[] = [];
    for (let d = 1; d <= 20; d++) {
      e.advance(1);
      cashAfterDay[d] = e.state().cash;
    }
    const l = e.ledger();
    const days = (t: GameEvent['type'], pred: (x: GameEvent) => boolean = () => true): number[] => l.filter((x) => x.type === t && pred(x)).map((x) => x.day);
    expect(days('PayableSettled')).toEqual([3]);
    expect(days('ReceivableCollected')).toEqual([5]);
    expect(days('RecurringCostPaid', (x) => x.type === 'RecurringCostPaid' && x.payload.costId === 'rc-ovh')).toEqual([2, 9, 16]);
    // payroll = Σ headcount × monthly cost (11 people × 1,000 TRY), not the seed's nominal amount
    const payroll = l.find((x) => x.type === 'RecurringCostPaid' && x.payload.costId === 'rc-pay');
    expect(payroll?.day).toBe(10);
    expect(payroll?.type === 'RecurringCostPaid' ? payroll.payload.amount : NaN).toBe(tl(11_000));
    expect(cashAfterDay[1]).toBe(opening);
    expect(cashAfterDay[2]).toBe(opening - tl(70));
    expect(cashAfterDay[3]).toBe(opening - tl(70) - tl(100));
    expect(cashAfterDay[5]).toBe(opening - tl(70) - tl(100) + tl(250));
    expect(cashAfterDay[20]).toBe(opening - 3 * tl(70) - tl(100) + tl(250) - tl(11_000));
    expect(checkInvariants(e.state(), l, TINY_WS)).toEqual([]);
  });
});
