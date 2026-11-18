import type { CompanyState, Decision } from '../model/types';
import { addM, mulBps, subM, timesQty } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, fromEvent } from '../events/tx';
import type { Cause } from '../events/types';
import { openOrders, family } from '../systems/capacity';
import { offerOf } from '../systems/costing';
import { changeSatisfaction } from '../systems/customers';
import { changeSupplierPrice, placePurchaseOrder, switchSupplier, recostOpenOrders } from '../systems/procurement';
import { CUSTOM_ALLOWED, type Command, type CommandError, type OperationalCommand } from './types';

const err = (code: string, params: CommandError['params'] = {}): CommandError => ({ code, params });
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const has = <T extends { id: string }>(arr: readonly T[], id: string): boolean => arr.some((x) => x.id === id);

export function validateOperational(s: CompanyState, c: OperationalCommand): CommandError | null {
  switch (c.type) {
    case 'setSupplierPrice':
      if (!has(s.suppliers, c.supplierId)) return err('error.unknownSupplier', { supplierId: c.supplierId });
      if (!offerOf(s, c.supplierId, c.materialId)) return err('error.noOffer', { supplierId: c.supplierId, materialId: c.materialId });
      if (!isPosInt(c.unitPrice)) return err('error.invalidAmount', { field: 'unitPrice' });
      return null;
    case 'placePurchaseOrder':
      if (!has(s.suppliers, c.supplierId)) return err('error.unknownSupplier', { supplierId: c.supplierId });
      if (!offerOf(s, c.supplierId, c.materialId)) return err('error.noOffer', { supplierId: c.supplierId, materialId: c.materialId });
      if (!isPosInt(c.qty)) return err('error.invalidAmount', { field: 'qty' });
      return null;
    case 'switchSupplier': {
      if (!has(s.materials, c.materialId)) return err('error.unknownMaterial', { materialId: c.materialId });
      if (!has(s.suppliers, c.toSupplierId)) return err('error.unknownSupplier', { supplierId: c.toSupplierId });
      if (!offerOf(s, c.toSupplierId, c.materialId)) return err('error.noOffer', { supplierId: c.toSupplierId, materialId: c.materialId });
      if (byId(s.materials, c.materialId).preferredSupplierId === c.toSupplierId) return err('error.alreadyPreferred', { supplierId: c.toSupplierId });
      return null;
    }
    case 'repriceOrders':
      if (!has(s.materials, c.materialId)) return err('error.unknownMaterial', { materialId: c.materialId });
      if (!isInt(c.unitCostIncrease)) return err('error.invalidAmount', { field: 'unitCostIncrease' });
      if (!isInt(c.passThroughBps) || c.passThroughBps < 0 || c.passThroughBps > 10000) return err('error.invalidRate', { field: 'passThroughBps' });
      return null;
    case 'grantDiscount':
      if (!has(s.customers, c.customerId)) return err('error.unknownCustomer', { customerId: c.customerId });
      if (!isInt(c.discountBps) || c.discountBps < 0 || c.discountBps > 5000) return err('error.invalidRate', { field: 'discountBps' });
      return null;
    case 'customerReaction':
      if (!has(s.customers, c.customerId)) return err('error.unknownCustomer', { customerId: c.customerId });
      return null;
    default:
      return err('error.unknownCommand', { type: (c as { type: string }).type });
  }
}

export function executeOperational(tx: Tx, c: OperationalCommand, cause: Cause): void {
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
      const touched: string[] = [];
      for (const o of openOrders(s)) {
        const b = family(s, o.familyId).bom.find((x) => x.materialId === c.materialId);
        if (!b) continue;
        const inc = mulBps(timesQty(c.unitCostIncrease, b.qtyPerUnit), c.passThroughBps);
        const unitPrice = addM(o.unitPrice, inc);
        const ev = tx.emit('OrderRepriced', { orderId: o.id, unitPrice, value: timesQty(unitPrice, o.qty) }, cause, {
          orderId: o.id,
          customerId: o.customerId,
          previousValue: o.value,
          value: timesQty(unitPrice, o.qty),
        });
        if (!touched.includes(o.customerId)) {
          touched.push(o.customerId);
          const cust = byId(s.customers, o.customerId);
          changeSatisfaction(tx, cust.id, c.reaction.satisfactionDelta, c.reaction.churnRiskDelta, 'reason.priceIncrease', fromEvent(ev));
          tx.emit(
            'CustomerTermsChanged',
            { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays + c.reaction.paymentDelayDays, discountBps: cust.discountBps },
            fromEvent(ev),
            { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays + c.reaction.paymentDelayDays },
          );
        }
      }
      return;
    }
    case 'grantDiscount': {
      const cust = byId(s.customers, c.customerId);
      const ev = tx.emit(
        'CustomerTermsChanged',
        { customerId: cust.id, paymentDelayDays: cust.paymentDelayDays, discountBps: c.discountBps },
        cause,
        { customerId: cust.id, discountBps: c.discountBps },
      );
      for (const o of openOrders(s).filter((x) => x.customerId === cust.id)) {
        const unitPrice = subM(o.unitPrice, mulBps(o.unitPrice, c.discountBps));
        tx.emit('OrderRepriced', { orderId: o.id, unitPrice, value: timesQty(unitPrice, o.qty) }, fromEvent(ev), {
          orderId: o.id,
          customerId: cust.id,
          previousValue: o.value,
          value: timesQty(unitPrice, o.qty),
        });
      }
      changeSatisfaction(tx, cust.id, c.satisfactionDelta, c.churnRiskDelta, 'reason.discountGranted', fromEvent(ev));
      recostOpenOrders(tx, fromEvent(ev));
      return;
    }
    case 'customerReaction':
      changeSatisfaction(tx, c.customerId, c.satisfactionDelta, c.churnRiskDelta, c.reasonCode, cause);
      return;
  }
}

function openDecision(s: CompanyState, id: string): Decision | CommandError {
  const d = s.decisions.find((x) => x.id === id);
  if (!d) return err('error.unknownDecision', { decisionId: id });
  if (d.status !== 'open') return err('error.decisionClosed', { decisionId: id, status: d.status });
  return d;
}

function validateAll(s: CompanyState, cmds: readonly OperationalCommand[]): CommandError | null {
  for (const c of cmds) {
    const e = validateOperational(s, c);
    if (e) return e;
  }
  return null;
}

/** Resolve a decision and run its commands (shared by approve, reject, custom and deadline expiry). */
export function resolveDecision(
  tx: Tx,
  d: Decision,
  status: 'approved' | 'rejected' | 'expired',
  optionId: string | null,
  commands: readonly OperationalCommand[],
  custom: OperationalCommand[] | null,
  cause: Cause,
): void {
  const ev = tx.emit('DecisionResolved', { decisionId: d.id, status, optionId, custom }, cause, {
    decisionId: d.id,
    status,
    optionId: optionId ?? 'custom',
  });
  for (const c of commands) executeOperational(tx, c, fromEvent(ev));
  tx.emit('DevelopmentResolved', { developmentId: d.developmentId }, fromEvent(ev), { developmentId: d.developmentId });
}

/** Validate then execute. Returns an error without emitting anything if invalid. */
export function handleCommand(tx: Tx, cmd: Command, cause: Cause): CommandError | null {
  const s = tx.s;
  switch (cmd.type) {
    case 'approveOption': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      const opt = d.options.find((o) => o.id === cmd.optionId);
      if (!opt) return err('error.unknownOption', { decisionId: d.id, optionId: cmd.optionId });
      const e = validateAll(s, opt.commands);
      if (e) return e;
      resolveDecision(tx, d, 'approved', opt.id, opt.commands, null, cause);
      return null;
    }
    case 'rejectDecision': {
      const d = openDecision(s, cmd.decisionId);
      if ('code' in d) return d;
      const opt = d.options.find((o) => o.id === d.defaultOptionId);
      const cmds = opt ? opt.commands : [];
      const e = validateAll(s, cmds);
      if (e) return e;
      resolveDecision(tx, d, 'rejected', d.defaultOptionId, cmds, null, cause);
      return null;
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
      if (!Array.isArray(cmd.commands) || cmd.commands.length === 0) return err('error.emptyCustomDecision', { decisionId: d.id });
      for (const c of cmd.commands) {
        if (!CUSTOM_ALLOWED.includes(c.type)) return err('error.commandNotAllowed', { type: c.type });
      }
      const e = validateAll(s, cmd.commands);
      if (e) return e;
      resolveDecision(tx, d, 'approved', null, cmd.commands, [...cmd.commands], cause);
      return null;
    }
    default: {
      if (!CUSTOM_ALLOWED.includes(cmd.type)) return err('error.commandNotAllowed', { type: cmd.type });
      const e = validateOperational(s, cmd);
      if (e) return e;
      executeOperational(tx, cmd, cause);
      return null;
    }
  }
}
