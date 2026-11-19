/**
 * listMessageCodes() is complete: every decision path run for 90 days, the Desk / Decision Room /
 * advisor / order selectors along the way, and every command error path emit only codes (and param
 * names) that the catalogue lists. The UI's translation-completeness test builds on this list.
 */
import { describe, expect, it } from 'vitest';
import { STEEL_DECISION, engineAt, seed } from '../test/seedFixture';
import { cloneState } from './events/tx';
import {
  type Command,
  type CompanyState,
  type Engine,
  type GameEvent,
  type MessageCodeSpec,
  type OperationalCommand,
  type SaveGame,
  advanceState,
  fromSnapshot,
  listMessageCodes,
  selectAdvisorBrief,
  selectDecision,
  selectDecisionOutlook,
  selectMorningReport,
  selectOrderBook,
  selectOrderImpact,
  selectWorkforce,
} from './index';
import { COMMAND_LIMITS } from './commands/handle';

interface Found {
  code: string;
  params: string[];
  where: string;
}

/** Collect every emitted code: Msg objects, `*Key` / `*Code` fields, and code-valued params. */
function collect(x: unknown, where: string, out: Found[]): void {
  if (Array.isArray(x)) {
    for (const v of x) collect(v, where, out);
    return;
  }
  if (x === null || typeof x !== 'object') return;
  const o = x as Record<string, unknown>;
  if (typeof o.code === 'string' && typeof o.params === 'object' && o.params !== null && !Array.isArray(o.params)) {
    out.push({ code: o.code, params: Object.keys(o.params), where });
  }
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && (/(Key|Code)$/.test(k) || k === 'reason')) out.push({ code: v, params: [], where: `${where}.${k}` });
    else collect(v, where, out);
  }
}

function fromLedger(events: readonly GameEvent[], out: Found[]): void {
  for (const e of events) {
    out.push({ code: e.code, params: Object.keys(e.params), where: `ledger ${e.type}` });
    collect(e.params, `ledger ${e.type}.params`, out);
    collect(e.payload, `ledger ${e.type}.payload`, out);
  }
}

function fromSelectors(s: Readonly<CompanyState>, out: Found[], opts: { runway?: boolean; advisors?: boolean } = {}): void {
  collect(opts.runway ? selectMorningReport(s) : selectMorningReport(s, { includeRunway: false }), `report day ${s.day}`, out);
  collect(selectWorkforce(s), `workforce day ${s.day}`, out);
  collect(selectOrderBook(s), `orderBook day ${s.day}`, out);
  for (const o of s.orders) collect(selectOrderImpact(s, o.id), `order ${o.id}`, out);
  for (const d of s.decisions) {
    collect(selectDecision(s, d.id), `decision ${d.id}`, out);
    if (opts.advisors && d.status === 'open') {
      collect(selectDecisionOutlook(s, d.id), `outlook ${d.id}`, out);
      for (const role of ['cfo', 'coo'] as const) collect(selectAdvisorBrief(s, role, d.id), `${role} ${d.id}`, out);
    }
  }
}

const DISCOUNT = 'dec-0002';
type Path = { name: string; day1?: Command[]; day9?: Command[] };
const PATHS: Path[] = [
  { name: 'steel absorb', day1: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'absorb' }] },
  { name: 'steel negotiate', day1: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'negotiate' }] },
  { name: 'steel switch + grant', day1: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' }], day9: [{ type: 'approveOption', decisionId: DISCOUNT, optionId: 'grant' }] },
  { name: 'steel passOn + refuse', day1: [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'passOn' }], day9: [{ type: 'approveOption', decisionId: DISCOUNT, optionId: 'refuse' }] },
  { name: 'reject both', day1: [{ type: 'rejectDecision', decisionId: STEEL_DECISION }], day9: [{ type: 'rejectDecision', decisionId: DISCOUNT }] },
  {
    name: 'custom both (partial discount, partial pass-on)',
    day1: [
      { type: 'acknowledgeDevelopment', developmentId: 'dev-0001' },
      {
        type: 'customDecision',
        decisionId: STEEL_DECISION,
        commands: [
          { type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 },
          { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 100_000 },
        ],
      },
    ],
    day9: [{ type: 'customDecision', decisionId: DISCOUNT, commands: [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 400 }] }],
  },
  {
    name: 'custom without a grant + analysis then expiry',
    day1: [{ type: 'requestAnalysis', decisionId: STEEL_DECISION }],
    day9: [{ type: 'customDecision', decisionId: DISCOUNT, commands: [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_dogumetal' }] }],
  },
  { name: 'no decisions (both expire)' },
];

function run(p: Path, out: Found[]): Engine {
  const e = engineAt();
  const ok = (c: Command): void => {
    const r = e.dispatch(c);
    if (!r.ok) throw new Error(`${p.name}: ${c.type} rejected with ${r.error.code}`);
  };
  for (const c of p.day1 ?? []) ok(c);
  e.advance(8);
  fromSelectors(e.state(), out);
  for (const c of p.day9 ?? []) ok(c);
  e.advance(22);
  fromSelectors(e.state(), out);
  e.advance(60);
  expect(e.state().day).toBe(91);
  fromSelectors(e.state(), out);
  fromLedger(e.ledger(), out);
  return e;
}

/** One invalid command per error code (plus save-game errors), each rejected with that code. */
function errorPaths(out: Found[]): void {
  const e = engineAt();
  const PO = { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 1000 };
  const bad: [unknown, string][] = [
    [null, 'error.invalidCommand'],
    [{ type: 'launchRocket' }, 'error.commandNotAllowed'],
    [{ ...PO, unitPrice: 1 }, 'error.unexpectedField'],
    [{ type: 'grantDiscount', customerId: 'cus_velora' }, 'error.missingField'],
    [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 42 }, 'error.invalidField'],
    [{ ...PO, qty: 1.5 }, 'error.invalidAmount'],
    [{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: COMMAND_LIMITS.maxDiscountBps + 1 }, 'error.invalidRate'],
    [{ ...PO, supplierId: 'sup_nobody' }, 'error.unknownSupplier'],
    [{ ...PO, materialId: 'aluminium' }, 'error.noOffer'],
    [{ type: 'switchSupplier', materialId: 'unobtainium', toSupplierId: 'sup_dogumetal' }, 'error.unknownMaterial'],
    [{ type: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }, 'error.alreadyPreferred'],
    [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 }, 'error.noPriceChangeToPass'],
    [{ type: 'grantDiscount', customerId: 'cus_nobody', discountBps: 100 }, 'error.unknownCustomer'],
    [{ type: 'approveOption', decisionId: 'dec-9999', optionId: 'x' }, 'error.unknownDecision'],
    [{ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'x' }, 'error.unknownOption'],
    [{ type: 'acknowledgeDevelopment', developmentId: 'dev-9999' }, 'error.unknownDevelopment'],
    [{ type: 'acknowledgeDevelopment', developmentId: 'dev-0002' }, 'error.developmentHasOpenDecision'],
    [{ type: 'customDecision', decisionId: STEEL_DECISION, commands: [] }, 'error.emptyCustomDecision'],
  ];
  for (const [cmd, code] of bad) {
    const r = e.dispatch(cmd as Command);
    expect(r.ok ? null : r.error.code, JSON.stringify(cmd)).toBe(code);
    if (!r.ok) collect(r.error, `error ${code}`, out);
  }
  const once = (c: Command, code: string): void => {
    const r = e.dispatch(c);
    expect(r.ok ? null : r.error.code).toBe(code);
    if (!r.ok) collect(r.error, `error ${code}`, out);
  };
  expect(e.dispatch({ type: 'requestAnalysis', decisionId: STEEL_DECISION }).ok).toBe(true);
  once({ type: 'requestAnalysis', decisionId: STEEL_DECISION }, 'error.analysisAlreadyRequested');
  expect(e.dispatch({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }).ok).toBe(true);
  once({ type: 'acknowledgeDevelopment', developmentId: 'dev-0001' }, 'error.developmentNotNew');
  expect(e.dispatch({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'absorb' }).ok).toBe(true);
  once({ type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'absorb' }, 'error.decisionClosed');
  // engine-only command fields are validated the same way when they sit in a decision option
  const s = cloneState(engineAt().state()) as CompanyState;
  const d = s.decisions.find((x) => x.id === STEEL_DECISION);
  const absorb = d?.options.find((o) => o.id === 'absorb');
  if (!absorb) throw new Error('absorb');
  absorb.commands = [{ type: 'customerReaction', customerId: 'cus_velora', satisfactionDelta: 20000, churnRiskDelta: 0, reasonCode: 'reason.onTime' } as OperationalCommand];
  const expired = advanceState(s, 7);
  const failed = expired.events.find((x) => x.type === 'DecisionDefaultFailed');
  expect(failed?.params.reason).toBe('error.invalidScore');
  fromLedger(expired.events, out);
  // save games
  const save = e.snapshot();
  for (const [bad2, code] of [
    [{ ...save, format: 2 as 1 }, 'error.saveFormat'],
    [{ ...save, seedVersion: save.seedVersion + 1 }, 'error.seedVersionMismatch'],
    [{ ...save, log: [...save.log, { kind: 'dispatch', command: { type: 'approveOption', decisionId: STEEL_DECISION, optionId: 'switch' } }] }, 'error.replayFailed'],
  ] as [SaveGame, string][]) {
    const r = fromSnapshot(seed(), bad2);
    expect(r.ok ? null : r.error.code).toBe(code);
    if (!r.ok) collect(r.error, `save ${code}`, out);
  }
}

describe('listMessageCodes', () => {
  const day1 = engineAt().state();
  const list = listMessageCodes(day1);
  const byCode = new Map<string, MessageCodeSpec>(list.map((m) => [m.code, m]));

  it('lists each code once, sorted, with param names; engine-only list has no seed codes', () => {
    expect(new Set(list.map((m) => m.code)).size).toBe(list.length);
    expect(list.map((m) => m.code)).toEqual([...list.map((m) => m.code)].sort());
    const engineOnly = listMessageCodes();
    expect(engineOnly.some((m) => m.kind === 'seed' || m.kind === 'card')).toBe(false);
    for (const m of engineOnly) expect(byCode.get(m.code)?.params).toEqual(expect.arrayContaining([...m.params]));
    for (const k of ['ledger.OrderShipped', 'error.unknownDecision', 'reason.discountRefused', 'advisor.caveat.deferredPayables', 'weekday.sun', 'health.band.critical', 'card.supplierPriceIncrease']) {
      expect(byCode.has(k), k).toBe(true);
    }
    expect(byCode.get('advisor.caveat.deferredPayables')?.params).toEqual(['optionId', 'amount', 'fromDay']);
  });

  it('every decision path for 90 days, its selectors and every error path emit only listed codes and params', () => {
    const found: Found[] = [];
    fromSelectors(day1, found, { runway: true, advisors: true });
    const at9 = engineAt();
    at9.advance(8);
    fromSelectors(at9.state(), found, { advisors: true });
    for (const p of PATHS) run(p, found);
    errorPaths(found);

    const unknown = [...new Set(found.filter((f) => !byCode.has(f.code)).map((f) => `${f.code} (${f.where})`))];
    expect(unknown).toEqual([]);
    const badParams = [
      ...new Set(found.flatMap((f) => f.params.filter((p) => !(byCode.get(f.code)?.params ?? []).includes(p)).map((p) => `${f.code}.${p} (${f.where})`))),
    ];
    expect(badParams).toEqual([]);

    // and the runs reach most of the catalogue: every error, reason, ledger type the seed can produce
    const seen = new Set(found.map((f) => f.code));
    const errors = list.filter((m) => m.kind === 'error').map((m) => m.code);
    expect(errors.filter((c) => !seen.has(c))).toEqual([]);
    expect(seen.has('ledger.DecisionDefaultFailed')).toBe(true);
    expect(seen.has('advisor.caveat.pickChangedAt90')).toBe(true);
    expect(seen.has('reason.discountPartial')).toBe(true);
  }, 60_000);
});
