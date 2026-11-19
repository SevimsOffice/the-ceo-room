import type { CompanyState, Order } from '../model/types';
import { type SimDay, money, mulDiv } from '../model/units';
import { byId } from '../events/reduce';
import { type Tx, rule } from '../events/tx';
import { availableMinutes, family, plantOvertimeMinutes, plantQueue, plantRegularMinutes, remainingMinutes } from './capacity';
import { isWorkday } from './calendar';
import { stockValueOf } from './costing';

/**
 * Overtime policy: for every earliest-due-date prefix of the queue, the minutes it lacks within
 * regular hours until its promise date are spread evenly over the workdays left (overdue = today).
 * Overtime today = the largest such daily need, capped by the plant's overtime capacity.
 */
export function overtimeNeeded(s: CompanyState, plantId: string, queue: Order[], day: SimDay): number {
  let cum = 0;
  let need = 0;
  for (const o of queue) {
    cum += remainingMinutes(s, o);
    const until = Math.max(day, o.promisedDay);
    const regular = o.promisedDay >= day ? availableMinutes(s, plantId, day, o.promisedDay) : 0;
    const short = cum - regular;
    if (short <= 0) continue;
    let workdays = 0;
    for (let d = day; d <= until; d++) if (isWorkday(d, s.company.day1Weekday)) workdays++;
    need = Math.max(need, Math.ceil(short / Math.max(1, workdays)));
  }
  return Math.min(need, plantOvertimeMinutes(s, plantId, day));
}

/** Step 4: allocate line-minutes to jobs in promise order, consume BOM, shortages block jobs. */
export function runProduction(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.production');
  for (const plant of s.plants) {
    const regular = plantRegularMinutes(s, plant.id, s.day);
    if (regular === 0) continue;
    const queue = plantQueue(s, plant.id);
    const overtime = overtimeNeeded(s, plant.id, queue, s.day);
    let avail = regular + overtime;
    let used = 0;
    for (const o of queue) {
      const fam = family(s, o.familyId);
      const mpu = fam.minutesPerUnit;
      const remaining = remainingMinutes(s, o);
      if (remaining <= 0) continue;
      if (avail <= 0) {
        // Not reached today: clear a stale shortage flag once material for a unit is back.
        const canStart = fam.bom.every((b) => byId(s.materials, b.materialId).stockQty >= b.qtyPerUnit);
        if (o.blockedBy !== null && canStart) tx.emit('ProductionResumed', { orderId: o.id }, cause, { orderId: o.id });
        continue;
      }
      let give = Math.min(remaining, avail);
      let newUnits = Math.min(o.qty, Math.floor((o.minutesDone + give) / mpu)) - o.unitsDone;
      let blockedBy: string | null = null;
      for (const b of fam.bom) {
        const canMake = Math.floor(byId(s.materials, b.materialId).stockQty / b.qtyPerUnit);
        if (canMake < newUnits || (canMake === 0 && give > 0)) {
          if (canMake < newUnits) newUnits = canMake;
          blockedBy = blockedBy ?? b.materialId;
        }
      }
      if (blockedBy !== null) give = Math.max(0, Math.min(give, (o.unitsDone + newUnits) * mpu - o.minutesDone));
      if (give > 0 || newUnits > 0) {
        const consumed = fam.bom
          .map((b) => ({ materialId: b.materialId, qty: newUnits * b.qtyPerUnit }))
          .filter((c) => c.qty > 0)
          .map((c) => ({ ...c, value: stockValueOf(s, c.materialId, c.qty) }));
        tx.emit(
          'ProductionProgressed',
          {
            orderId: o.id,
            plantId: plant.id,
            minutes: give,
            units: newUnits,
            consumed,
            energyCost: mulDiv(s.settings.energyCostPerLineHour, give, 60),
          },
          cause,
          { orderId: o.id, plantId: plant.id, units: newUnits },
        );
        avail -= give;
        used += give;
      }
      const current = byId(s.orders, o.id);
      if (blockedBy !== null && current.blockedBy === null) {
        tx.emit('MaterialShortage', { orderId: o.id, materialId: blockedBy }, cause, { orderId: o.id, materialId: blockedBy });
      } else if (blockedBy === null && current.blockedBy !== null) {
        tx.emit('ProductionResumed', { orderId: o.id }, cause, { orderId: o.id });
      }
    }
    const otMinutes = Math.max(0, used - regular);
    if (otMinutes > 0) {
      const personHours = Math.ceil((otMinutes * s.settings.overtimeCrewPerLine) / 60);
      tx.emit(
        'OvertimeWorked',
        {
          plantId: plant.id,
          lineMinutes: otMinutes,
          personHours,
          cost: money(personHours * s.settings.overtimeRatePerPersonHour),
        },
        cause,
        { plantId: plant.id, personHours },
      );
    }
  }
}
