import { mulBps, subM } from '../model/units';
import { type Tx, rule } from '../events/tx';
import { intBelow } from '../rng/rng';
import { family } from './capacity';
import { registerOrder } from './pipeline';

/** Step 2 (recurring intake): active customers place orders on their cadence. */
export function runDemand(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.sales.demand');
  for (const c of s.customers) {
    const d = c.demand;
    if (c.status !== 'active' || !d || d.nextOrderDay > s.day) continue;
    const qty = d.qtyMin + intBelow(tx.draw('customers'), d.qtyMax - d.qtyMin + 1);
    const list = family(s, d.familyId).unitPrice;
    const unitPrice = subM(list, mulBps(list, c.discountBps));
    registerOrder(
      tx,
      {
        customerId: c.id,
        familyId: d.familyId,
        qty,
        unitPrice,
        requestedDay: s.day + d.leadDays,
        paymentTermsDays: c.paymentTermsDays,
        source: 'demand',
      },
      cause,
    );
    tx.emit('CustomerOrderCycleAdvanced', { customerId: c.id, nextOrderDay: s.day + d.cadenceDays }, cause, {
      customerId: c.id,
    });
  }
  tx.flushRng(cause);
}
