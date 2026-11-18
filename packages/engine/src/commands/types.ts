import type { Bps, Money, Score } from '../model/units';
import type { Msg } from '../model/types';

/**
 * Commands a CEO may compose in a custom decision or dispatch on their own. They carry intent only
 * (who, what, how much, which rate). Every outcome (prices, customer reactions, payment delays) is
 * derived by the engine from its own rules and the decision's basis, never supplied by the caller.
 */
export type CeoCommand =
  | { type: 'placePurchaseOrder'; supplierId: string; materialId: string; qty: number }
  | { type: 'switchSupplier'; materialId: string; toSupplierId: string }
  /** pass on `passThroughBps` of the decision's supplier price rise to open orders using the material */
  | { type: 'repriceOrders'; materialId: string; passThroughBps: Bps }
  | { type: 'grantDiscount'; customerId: string; discountBps: Bps };

/** Built only by the engine's decision rules (rules/decisions.ts); never accepted from a caller. */
export type EngineCommand =
  | { type: 'setSupplierPrice'; supplierId: string; materialId: string; unitPrice: Money }
  | { type: 'customerReaction'; customerId: string; satisfactionDelta: Score; churnRiskDelta: Bps; reasonCode: string };

/** Commands that change operations; decision options may hold either kind. */
export type OperationalCommand = CeoCommand | EngineCommand;

/** Command types a CEO may compose in a custom decision or dispatch directly (M1 allow-list). */
export const CUSTOM_ALLOWED: readonly CeoCommand['type'][] = ['placePurchaseOrder', 'switchSupplier', 'repriceOrders', 'grantDiscount'];

export type DecisionCommand =
  | { type: 'approveOption'; decisionId: string; optionId: string }
  | { type: 'rejectDecision'; decisionId: string }
  | { type: 'requestAnalysis'; decisionId: string }
  | { type: 'customDecision'; decisionId: string; commands: CeoCommand[] };

/** Desk actions that change only the CEO's view of developments. */
export type DeskCommand = { type: 'acknowledgeDevelopment'; developmentId: string };

export type Command = DecisionCommand | DeskCommand | CeoCommand;

export type CommandError = Msg;

export type DispatchResult<E> =
  | { ok: true; commandId: string; events: E[] }
  | { ok: false; error: CommandError };
