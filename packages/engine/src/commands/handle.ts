import type { CompanyState, Decision } from '../model/types';
import { addM, mulBps, subM, timesQty } from '../model/units';
import { byId } from '../events/reduce';
import { Tx, fromEvent } from '../events/tx';
import type { Cause } from '../events/types';
import { openOrders, family } from '../systems/capacity';
import { offerOf } from '../systems/costing';
import { changeSatisfaction, discountReaction, passOnReaction } from '../systems/customers';
import { changeSupplierPrice, placePurchaseOrder, switchSupplier, recostOpenOrders } from '../systems/procurement';
import { CUSTOM_ALLOWED, type CeoCommand, type Command, type CommandError, type OperationalCommand } from './types';

const err = (code: string, params: CommandError['params'] = {}): CommandError => ({ code, params });
const has = <T extends { id: string }>(arr: readonly T[], id: string): boolean => arr.some((x) => x.id === id);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Bounds on CEO-supplied numbers (keep every derived amount a safe integer). */
export const COMMAND_LIMITS = {
  maxPurchaseQty: 10_000_000,
  maxUnitPrice: 1_000_000_000,
  maxDiscountBps: 5000,
  /** repriceOrders: share of the cost rise passed on to open orders (10000 bps = all of it) */
  maxPassThroughBps: 10_000,
} as const;

type Field =
  | { kind: 'id' }
  | { kind: 'list' }
  | { kind: 'reason' }
  | { kind: 'int'; min: number; max: number; code: 'error.invalidAmount' | 'error.invalidRate' | 'error.invalidScore' };
type Shape = Readonly<Record<string, Field>>;

const ID: Field = { kind: 'id' };
const int = (min: number, max: number, code: 'error.invalidAmount' | 'error.invalidRate' | 'error.invalidScore'): Field => ({ kind: 'int', min, max, code });

/** Exact field lists: a command with a missing, extra or ill-typed field is rejected. */
const SHAPES: Readonly<Record<Command['type'] | OperationalCommand['type'], Shape>> = {
  approveOption: { decisionId: ID, optionId: ID },
  rejectDecision: { decisionId: ID },
  requestAnalysis: { decisionId: ID },
  customDecision: { decisionId: ID, commands: { kind: 'list' } },
  acknowledgeDevelopment: { developmentId: ID },
  placePurchaseOrder: { supplierId: ID, materialId: ID, qty: int(1, COMMAND_LIMITS.maxPurchaseQty, 'error.invalidAmount') },
  switchSupplier: { materialId: ID, toSupplierId: ID },
  repriceOrders: { materialId: ID, passThroughBps: int(0, COMMAND_LIMITS.maxPassThroughBps, 'error.invalidRate') },
  grantDiscount: { customerId: ID, discountBps: int(0, COMMAND_LIMITS.maxDiscountBps, 'error.invalidRate') },
  setSupplierPrice: { supplierId: ID, materialId: ID, unitPrice: int(1, COMMAND_LIMITS.maxUnitPrice, 'error.invalidAmount') },
  customerReaction: {
    customerId: ID,
    satisfactionDelta: int(-10000, 10000, 'error.invalidScore'),
    churnRiskDelta: int(-10000, 10000, 'error.invalidRate'),
    reasonCode: { kind: 'reason' },
  },
};

const DECISION_AND_DESK: readonly string[] = ['approveOption', 'rejectDecision', 'requestAnalysis', 'customDecision', 'acknowledgeDevelopment'];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Structural check of a command from outside the engine: an object with a known type and exact fields. */
export function checkShape(c: unknown): CommandError | null {
  if (!isRecord(c) || typeof c.type !== 'string') return err('error.invalidCommand');
  const type = c.type;
  if (!hasOwn(SHAPES, type)) return err('error.commandNotAllowed', { type });
  const shape = SHAPES[type as keyof typeof SHAPES];
  for (const k of Object.keys(c)) {
    if (k !== 'type' && !hasOwn(shape, k)) return err('error.unexpectedField', { type, field: k });
  }
  for (const [field, f] of Object.entries(shape)) {
    const v = c[field];
    if (v === undefined) return err('error.missingField', { type, field });
    switch (f.kind) {
      case 'id':
        if (typeof v !== 'string' || v.length === 0) return err('error.invalidField', { type, field });
        break;
      case 'reason':
        if (typeof v !== 'string' || !/^reason\.[A-Za-z0-9_.]+$/.test(v)) return err('error.invalidField', { type, field });
        break;
      case 'list':
        if (!Array.isArray(v)) return err('error.invalidField', { type, field });
        break;
      case 'int':
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < f.min || v > f.max) {
          return err(f.code, { type, field, min: f.min, max: f.max });
        }
        break;
    }
  }
  return null;
}

/**
 * Validate an operational command against the state it will run on. `d` is the decision being
 * resolved (its basis is where derived prices and reactions come from), or null for a direct
 * dispatch. Never throws: every failure is a typed CommandError.
 */
export function validateOperational(s: CompanyState, c: OperationalCommand, d: Decision | null): CommandError | null {
  const shape = checkShape(c);
  if (shape) return shape;
  switch (c.type) {
    case 'setSupplierPrice':
      if (!has(s.suppliers, c.supplierId)) return err('error.unknownSupplier', { supplierId: c.supplierId });
      if (!offerOf(s, c.supplierId, c.materialId)) return err('error.noOffer', { supplierId: c.supplierId, materialId: c.materialId });
      return null;
    case 'placePurchaseOrder': {
      if (!has(s.suppliers, c.supplierId)) return err('error.unknownSupplier', { supplierId: c.supplierId });
      const offer = offerOf(s, c.supplierId, c.materialId);
      if (!offer) return err('error.noOffer', { supplierId: c.supplierId, materialId: c.materialId });
      if (!Number.isSafeInteger(offer.unitPrice * c.qty)) return err('error.invalidAmount', { type: c.type, field: 'qty' });
      return null;
    }
    case 'switchSupplier':
      if (!has(s.materials, c.materialId)) return err('error.unknownMaterial', { materialId: c.materialId });
      if (!has(s.suppliers, c.toSupplierId)) return err('error.unknownSupplier', { supplierId: c.toSupplierId });
      if (!offerOf(s, c.toSupplierId, c.materialId)) return err('error.noOffer', { supplierId: c.toSupplierId, materialId: c.materialId });
      if (byId(s.materials, c.materialId).preferredSupplierId === c.toSupplierId) return err('error.alreadyPreferred', { supplierId: c.toSupplierId });
      return null;
    case 'repriceOrders':
      if (!has(s.materials, c.materialId)) return err('error.unknownMaterial', { materialId: c.materialId });
      // The cost rise and the customers' reaction come from a supplier-price decision on this material.
      if (d?.basis.kind !== 'supplierPrice' || d.basis.materialId !== c.materialId) return err('error.noPriceChangeToPass', { materialId: c.materialId });
      return null;
    case 'grantDiscount':
      if (!has(s.customers, c.customerId)) return err('error.unknownCustomer', { customerId: c.customerId });
      return null;
    case 'customerReaction':
      if (!has(s.customers, c.customerId)) return err('error.unknownCustomer', { customerId: c.customerId });
      return null;
  }
}

/** Run a validated operational command. Prices and reactions are derived here, never read from the caller. */
function executeOperational(tx: Tx, c: OperationalCommand, d: Decision | null, cause: Cause): void {
  const s = tx.s;
  switch (c.type) {
    case 'setSupplierPrice':
      changeSupplierPrice(tx, c.supplierId, c.materialId, c.unitPrice, cause);
      return;
    case 'placePurchaseOrder':
      placePurchaseOrder(tx, { supplierId: c.supplierId, materialId: c.materialId, qty: c.qty, forOrderId: null }, cause);
      return;
    case 'switchSupplier':
      switchSupplier(tx, c.materialId, c.toSupplierId, cause);
      return;
    case 'repriceOrders': {
      if (d?.basis.kind !== 'supplierPrice') return; // unreachable after validation
      const unitCostIncrease = subM(d.basis.newPrice, d.basis.previousPrice);
      const reaction = passOnReaction(d.basis.customerReaction, c.passThroughBps);
      const touched: string[] = [];
      for (const o of openOrders(s)) {
        const b = family(s, o.familyId).bom.find((x) => x.materialId === c.materialId);
        if (!b) continue;
        const inc = mulBps(timesQty(unitCostIncrease, b.qtyPerUnit), c.passThroughBps);
        if (inc === 0) continue;
        const unitPrice = addM(o.unitPrice, inc);
        const ev = tx.emit(
          'OrderRepriced',
          { orderId: o.id, listUnitPrice: addM(o.listUnitPrice, inc), unitPrice, value: timesQty(unitPrice, o.qty) },
          cause,
          { orderId: o.id, customerId: o.customerId, previousValue: o.value, value: timesQty(unitPrice, o.qty) },
        );
        if (!touched.includes(o.customerId)) {
          touched.push(o.customerId);
          const cust = byId(s.customers, o.customerId);
          changeSatisfaction(tx, cust.id, reaction.satisfactionDelta, reaction.churnRiskDelta, 'reason.priceIncrease', fromEvent(ev));
          tx.emit(
            'CustomerTermsChanged',
            { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays + reaction.paymentDelayDays, discountBps: cust.discountBps },
            fromEvent(ev),
            { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays + reaction.paymentDelayDays },
          );
        }
      }
      return;
    }
    case 'grantDiscount': {
      const cust = byId(s.customers, c.customerId);
      const reaction = discountReaction(cust, c.discountBps, d ? d.basis : null);
      const ev = tx.emit(
        'CustomerTermsChanged',
        { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays, discountBps: c.discountBps },
        cause,
        { customerId: cust.id, discountBps: c.discountBps },
      );
      // Reprice from the pre-discount price at the new rate (same rule as new orders in systems/demand.ts).
      for (const o of openOrders(s).filter((x) => x.customerId === cust.id)) {
        const unitPrice = subM(o.listUnitPrice, mulBps(o.listUnitPrice, c.discountBps));
        if (unitPrice === o.unitPrice) continue;
        tx.emit('OrderRepriced', { orderId: o.id, listUnitPrice: o.listUnitPrice, unitPrice, value: timesQty(unitPrice, o.qty) }, fromEvent(ev), {
          orderId: o.id,
          customerId: cust.id,
          previousValue: o.value,
          value: timesQty(unitPrice, o.qty),
        });
      }
      changeSatisfaction(tx, cust.id, reaction.satisfactionDelta, reaction.churnRiskDelta, reaction.reasonCode, fromEvent(ev));
      recostOpenOrders(tx, fromEvent(ev));
      return;
    }
    case 'customerReaction':
      changeSatisfaction(tx, c.customerId, c.satisfactionDelta, c.churnRiskDelta, c.reasonCode, cause);
      return;
  }
}

/** Validate against the current draft, then execute. */
function runOperational(tx: Tx, c: OperationalCommand, d: Decision | null, cause: Cause): CommandError | null {
  const e = validateOperational(tx.s, c, d);
  if (e) return e;
  executeOperational(tx, c, d, cause);
  return null;
}

/**
 * A custom decision on a discount demand that does not grant that customer a discount is a refusal:
 * the card's refusal reaction applies first, exactly as on reject or expiry (ADR-0007). A
 * `grantDiscount` to that customer answers the demand itself (0 bps = refusal via discountReaction).
 */
export function unansweredDemandReaction(d: Decision, commands: readonly CeoCommand[]): OperationalCommand[] {
  if (d.basis.kind !== 'discountDemand') return [];
  const b = d.basis;
  if (commands.some((c) => c.type === 'grantDiscount' && c.customerId === b.customerId)) return [];
  return [
    {
      type: 'customerReaction',
      customerId: b.customerId,
      satisfactionDelta: b.refusal.satisfactionDelta,
      churnRiskDelta: b.refusal.churnRiskDelta,
      reasonCode: 'reason.discountRefused',
    },
  ];
}

function openDecision(s: CompanyState, id: string): Decision | CommandError {
  const d = s.decisions.find((x) => x.id === id);
  if (!d) return err('error.unknownDecision', { decisionId: id });
  if (d.status !== 'open') return err('error.decisionClosed', { decisionId: id, status: d.status });
  return d;
}

/**
 * Resolve a decision and run its commands in order, each validated against the state its
 * predecessors left. On error the caller must discard the transaction (applyCommand does).
 */
export function resolveDecision(
  tx: Tx,
  d: Decision,
  status: 'approved' | 'rejected' | 'expired',
  optionId: string | null,
  commands: readonly OperationalCommand[],
  custom: CeoCommand[] | null,
  cause: Cause,
): CommandError | null {
  const ev = tx.emit('DecisionResolved', { decisionId: d.id, status, optionId, custom }, cause, {
    decisionId: d.id,
    status,
    optionId: optionId ?? 'custom',
  });
  for (const c of commands) {
    const e = runOperational(tx, c, d, fromEvent(ev));
    if (e) return e;
  }
  tx.emit('DevelopmentResolved', { developmentId: d.developmentId }, fromEvent(ev), { developmentId: d.developmentId });
  return null;
}

/**
 * Deadline expiry: run the default option. It is first tried on a throw-away copy of the draft; if
 * it is no longer valid the decision expires with no action and the reason is ledgered.
 */
export function expireDecision(tx: Tx, d: Decision, cause: Cause): void {
  const opt = d.options.find((o) => o.id === d.defaultOptionId);
  const cmds = opt ? opt.commands : [];
  const trial = new Tx(tx.s);
  const error = resolveDecision(trial, d, 'expired', d.defaultOptionId, cmds, null, cause);
  if (!error) {
    resolveDecision(tx, d, 'expired', d.defaultOptionId, cmds, null, cause);
    return;
  }
  const failed = tx.emit('DecisionDefaultFailed', { decisionId: d.id, optionId: d.defaultOptionId, error }, cause, {
    decisionId: d.id,
    optionId: d.defaultOptionId,
    reason: error.code,
  });
  resolveDecision(tx, d, 'expired', null, [], null, fromEvent(failed));
}

/** Validate then execute. On an error the transaction must be discarded (applyCommand does). */
export function handleCommand(tx: Tx, cmd: Command, cause: Cause): CommandError | null {
  const s = tx.s;
  const raw: unknown = cmd;
  if (!isRecord(raw) || typeof raw.type !== 'string') return err('error.invalidCommand');
  if (!DECISION_AND_DESK.includes(raw.type) && !(CUSTOM_ALLOWED as readonly string[]).includes(raw.type)) {
    return err('error.commandNotAllowed', { type: raw.type });
  }
  const shape = checkShape(cmd);
  if (shape) return shape;
  switch (cmd.type) {
    case 'approveOption': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      const opt = d.options.find((o) => o.id === cmd.optionId);
      if (!opt) return err('error.unknownOption', { decisionId: d.id, optionId: cmd.optionId });
      return resolveDecision(tx, d, 'approved', opt.id, opt.commands, null, cause);
    }
    case 'rejectDecision': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      const opt = d.options.find((o) => o.id === d.defaultOptionId);
      return resolveDecision(tx, d, 'rejected', d.defaultOptionId, opt ? opt.commands : [], null, cause);
    }
    case 'requestAnalysis': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      if (d.analysis) return err('error.analysisAlreadyRequested', { decisionId: d.id });
      tx.emit('AnalysisRequested', { decisionId: d.id, readyDay: s.day + 1 }, cause, { decisionId: d.id, readyDay: s.day + 1 });
      return null;
    }
    case 'acknowledgeDevelopment': {
      const dev = s.developments.find((x) => x.id === cmd.developmentId);
      if (!dev) return err('error.unknownDevelopment', { developmentId: cmd.developmentId });
      if (dev.status !== 'new') return err('error.developmentNotNew', { developmentId: dev.id, status: dev.status });
      const open = dev.decisionId !== null && s.decisions.some((d) => d.id === dev.decisionId && d.status === 'open');
      if (open) return err('error.developmentHasOpenDecision', { developmentId: dev.id, decisionId: dev.decisionId ?? '' });
      tx.emit('DevelopmentRead', { developmentId: dev.id }, cause, { developmentId: dev.id });
      return null;
    }
    case 'customDecision': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      if (cmd.commands.length === 0) return err('error.emptyCustomDecision', { decisionId: d.id });
      for (const c of cmd.commands as unknown[]) {
        if (!isRecord(c) || typeof c.type !== 'string') return err('error.invalidCommand');
        if (!(CUSTOM_ALLOWED as readonly string[]).includes(c.type)) return err('error.commandNotAllowed', { type: c.type });
      }
      // The ledger keeps its own copy: later changes to the caller's objects cannot rewrite history.
      const commands = copy(cmd.commands);
      const run: OperationalCommand[] = [...unansweredDemandReaction(d, commands), ...commands];
      return resolveDecision(tx, d, 'approved', null, run, copy(commands), cause);
    }
    default:
      return runOperational(tx, cmd, null, cause);
  }
}
