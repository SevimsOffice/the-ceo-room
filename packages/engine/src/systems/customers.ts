import type { Customer, DecisionBasis } from '../model/types';
import { type Bps, type Score, clamp, roundHalfEven } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, rule } from '../events/tx';
import type { Cause } from '../events/types';
import { openOrders } from './capacity';
import { CUSTOMER_RULES } from '../config/tuning';

/** Customer-reaction rules live in config/tuning.ts; re-exported here for existing imports. */
export { CUSTOMER_RULES };

export interface DerivedReaction {
  satisfactionDelta: Score;
  /** null = churn risk follows satisfaction (`churnPerSatisfaction`) */
  churnRiskDelta: Bps | null;
  reasonCode: string;
}

/**
 * Reaction to passing on `passThroughBps` of a supplier price rise: the decision basis gives the
 * reaction to a full pass-through; a partial one scales it linearly (banker's rounding).
 */
export function passOnReaction(
  full: { satisfactionDelta: Score; churnRiskDelta: Bps; paymentDelayDays: number },
  passThroughBps: Bps,
): { satisfactionDelta: Score; churnRiskDelta: Bps; paymentDelayDays: number } {
  const scale = (x: number): number => roundHalfEven((x * passThroughBps) / 10000);
  return {
    satisfactionDelta: scale(full.satisfactionDelta),
    churnRiskDelta: scale(full.churnRiskDelta),
    paymentDelayDays: scale(full.paymentDelayDays),
  };
}

/**
 * Reaction to a discount. Answering a discount demand (basis of the decision being resolved, same
 * customer): granting nothing = the refusal reaction, granting at least the demand = the acceptance
 * reaction, a partial grant interpolates linearly. Otherwise an unsolicited discount earns goodwill
 * per 100 bps of increase over the customer's current discount; churn follows satisfaction.
 */
export function discountReaction(customer: Customer, discountBps: Bps, basis: DecisionBasis | null): DerivedReaction {
  if (basis?.kind === 'discountDemand' && basis.customerId === customer.id && basis.discountBps > 0) {
    const given = Math.min(discountBps, basis.discountBps);
    const lerp = (refused: number, accepted: number): number => refused + roundHalfEven(((accepted - refused) * given) / basis.discountBps);
    return {
      satisfactionDelta: lerp(basis.refusal.satisfactionDelta, basis.acceptance.satisfactionDelta),
      churnRiskDelta: lerp(basis.refusal.churnRiskDelta, basis.acceptance.churnRiskDelta),
      reasonCode: given >= basis.discountBps ? 'reason.discountGranted' : given > 0 ? 'reason.discountPartial' : 'reason.discountRefused',
    };
  }
  const increase = Math.max(0, discountBps - customer.discountBps);
  return {
    satisfactionDelta: roundHalfEven((increase * CUSTOMER_RULES.discountGoodwillPer100Bps) / 100),
    churnRiskDelta: null,
    reasonCode: 'reason.discountGranted',
  };
}

export function changeSatisfaction(
  tx: Tx,
  customerId: string,
  delta: Score,
  churnDelta: Bps | null,
  reasonCode: string,
  cause: Cause,
): void {
  const c = byId(tx.s.customers, customerId);
  const satisfaction = clamp(c.satisfaction + delta, 0, 10000);
  const applied = satisfaction - c.satisfaction;
  const cd = churnDelta ?? applied * CUSTOMER_RULES.churnPerSatisfaction;
  const churnRisk = clamp(c.churnRisk + cd, 0, 10000);
  if (applied === 0 && churnRisk === c.churnRisk) return;
  tx.emit('CustomerSatisfactionChanged', { customerId, delta: applied, satisfaction, churnRisk, reasonCode }, cause, {
    customerId,
    delta: applied,
    satisfaction,
    reasonCode,
  });
}

/** Step 8: overdue orders erode satisfaction daily; churn when risk crosses the threshold. */
export function runCustomers(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.customers');
  const overdue = new Set(openOrders(s).filter((o) => o.promisedDay < s.day).map((o) => o.customerId));
  for (const c of s.customers) {
    if (c.status !== 'active') continue;
    if (overdue.has(c.id)) changeSatisfaction(tx, c.id, CUSTOMER_RULES.overduePerDay, null, 'reason.overdueOrder', cause);
  }
  for (const c of s.customers) {
    if (c.status === 'active' && c.churnRisk >= CUSTOMER_RULES.churnThresholdBps) {
      tx.emit('CustomerChurned', { customerId: c.id }, rule('rule.customers.churnThreshold'), {
        customerId: c.id,
        churnRisk: c.churnRisk,
      });
    }
  }
}

export function activeCustomers(customers: readonly Customer[]): Customer[] {
  return customers.filter((c) => c.status === 'active');
}
