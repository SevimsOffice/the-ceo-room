import type { CompanyState, RecurringCost } from '../model/types';
import { type Money, ZERO, addM, money } from '../model/units';
import { type Tx, fromEvent, rule } from '../events/tx';

export function recurringAmount(s: CompanyState, c: RecurringCost): { amount: Money; variable: Money } {
  if (c.kind === 'payroll') {
    let base = 0;
    for (const w of s.workforce) base += w.headcount * w.avgMonthlyCost;
    return { amount: addM(money(base), s.accruals.overtime), variable: s.accruals.overtime };
  }
  if (c.kind === 'utilities') return { amount: addM(c.amount, s.accruals.energy), variable: s.accruals.energy };
  return { amount: c.amount, variable: ZERO };
}

/** Step 6: receivables in, payables out, recurring costs. The only places cash moves. */
export function runCash(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.cash');
  for (const r of s.receivables.filter((x) => x.status === 'open' && x.expectedPayDay <= s.day)) {
    const ev = tx.emit('ReceivableCollected', { receivableId: r.id, amount: r.amount }, cause, {
      receivableId: r.id,
      customerId: r.customerId,
      amount: r.amount,
    });
    if (r.orderId) tx.emit('OrderPaid', { orderId: r.orderId }, fromEvent(ev), { orderId: r.orderId });
  }
  for (const p of s.payables.filter((x) => x.status === 'open' && x.dueDay <= s.day)) {
    tx.emit('PayableSettled', { payableId: p.id, amount: p.amount }, cause, {
      payableId: p.id,
      counterpartyId: p.counterpartyId,
      amount: p.amount,
    });
  }
  for (const c of s.recurringCosts) {
    if (c.nextDueDay > s.day) continue;
    const { amount, variable } = recurringAmount(s, c);
    tx.emit('RecurringCostPaid', { costId: c.id, amount, variable, nextDueDay: c.nextDueDay + c.everyDays }, cause, {
      costId: c.id,
      kind: c.kind,
      amount,
    });
  }
}
