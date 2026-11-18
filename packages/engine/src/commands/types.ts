import type { Bps, Money, Score } from '../model/units';
import type { Msg } from '../model/types';

/** Commands that change operations; usable inside decision options and custom decisions. */
export type OperationalCommand =
  | { type: 'setSupplierPrice'; supplierId: string; materialId: string; unitPrice: Money }
  | { type: 'placePurchaseOrder'; supplierId: string; materialId: string; qty: number }
  | { type: 'switchSupplier'; materialId: string; toSupplierId: string }
  | {
      type: 'repriceOrders';
      materialId: string;
      /** cost increase per material unit (kuruş) passed on to open orders */
      unitCostIncrease: Money;
      passThroughBps: Bps;
      reaction: { satisfactionDelta: Score; churnRiskDelta: Bps; paymentDelayDays: number };
    }
  | { type: 'grantDiscount'; customerId: string; discountBps: Bps; satisfactionDelta: Score; churnRiskDelta: Bps }
  | { type: 'customerReaction'; customerId: string; satisfactionDelta: Score; churnRiskDelta: Bps; reasonCode: string };

/** Command types a CEO may compose in a custom decision (M1 allow-list). */
export const CUSTOM_ALLOWED: readonly OperationalCommand['type'][] = [
  'setSupplierPrice',
  'placePurchaseOrder',
  'switchSupplier',
  'repriceOrders',
  'grantDiscount',
];

export type DecisionCommand =
  | { type: 'approveOption'; decisionId: string; optionId: string }
  | { type: 'rejectDecision'; decisionId: string }
  | { type: 'requestAnalysis'; decisionId: string }
  | { type: 'customDecision'; decisionId: string; commands: OperationalCommand[] };

/** Desk actions that change only the CEO's view of developments. */
export type DeskCommand = { type: 'acknowledgeDevelopment'; developmentId: string };

export type Command = DecisionCommand | DeskCommand | OperationalCommand;

export type CommandError = Msg;

export type DispatchResult<E> =
  | { ok: true; commandId: string; events: E[] }
  | { ok: false; error: CommandError };
