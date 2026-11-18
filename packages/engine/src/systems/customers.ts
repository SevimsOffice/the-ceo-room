import type { Customer } from '../model/types';
import { type Bps, type Score, clamp } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, rule } from '../events/tx';
import type { Cause } from '../events/types';
import { openOrders } from './capacity';

/** Explicit customer-reaction rules (SIMULATION_DESIGN §3 step 8). */
export const CUSTOMER_RULES = {
  onTimeShipment: 100 as Score,
  latePerDay: -80 as Score,
  lateMax: -1000 as Score,
  overduePerDay: -20 as Score,
  /** churn risk moves 1 bps per 1/100 point of satisfaction lost (and back) */
  churnPerSatisfaction: -1,
  churnThresholdBps: 6000 as Bps,
} as const;

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
