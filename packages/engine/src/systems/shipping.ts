import { addM, mulDiv } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, fromEvent, rule } from '../events/tx';
import { minutesRequired, openOrders } from './capacity';
import { CUSTOMER_RULES, changeSatisfaction } from './customers';
import { pad } from './procurement';

/** Step 5: completed orders ship, are invoiced (revenue) and create a receivable. */
export function runShipping(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.shipping');
  const done = openOrders(s).filter((o) => o.unitsDone >= o.qty);
  for (const o of done) {
    const lateDays = Math.max(0, s.day - o.promisedDay);
    const labour = mulDiv(s.settings.labourCostPerLineHour, minutesRequired(s, o), 60);
    const cogs = addM(o.materialCost, o.energyCost, labour);
    const shipped = tx.emit('OrderShipped', { orderId: o.id, lateDays, revenue: o.value, cogs }, cause, {
      orderId: o.id,
      customerId: o.customerId,
      value: o.value,
      lateDays,
    });
    const customer = byId(s.customers, o.customerId);
    const dueDay = s.day + o.paymentTermsDays;
    tx.emit(
      'ReceivableCreated',
      {
        receivable: {
          workspaceId: s.workspaceId,
          id: `rcv-${pad(s.counters.receivable)}`,
          source: 'order',
          orderId: o.id,
          customerId: o.customerId,
          amount: o.value,
          issuedDay: s.day,
          dueDay,
          expectedPayDay: dueDay + customer.paymentDelayDays,
          status: 'open',
        },
      },
      fromEvent(shipped),
      { orderId: o.id, amount: o.value, dueDay },
    );
    const delta =
      lateDays === 0
        ? CUSTOMER_RULES.onTimeShipment
        : Math.max(CUSTOMER_RULES.lateMax, CUSTOMER_RULES.latePerDay * lateDays);
    changeSatisfaction(tx, o.customerId, delta, null, lateDays === 0 ? 'reason.onTime' : 'reason.late', fromEvent(shipped));
  }
}
