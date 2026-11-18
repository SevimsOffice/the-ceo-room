import { type Tx, rule } from '../events/tx';
import { expireDecision } from '../commands/handle';
import { runCards } from '../rules/cards';
import { isPeriodStart, periodOf } from './calendar';
import { runCash } from './cash';
import { runCustomers } from './customers';
import { runDemand } from './demand';
import { closePeriod, runKpiSnapshot } from './kpi';
import { runPeople } from './people';
import { runDeliveries, runMrp } from './procurement';
import { runProduction } from './production';
import { runShipping } from './shipping';

/**
 * The daily tick (SIMULATION_DESIGN §3) is split around the CEO's working day:
 *   morning  = open the day: period close, repairs, decision deadlines, 1 event cards, 2 sales intake
 *   (CEO reads the morning report and dispatches commands)
 *   evening  = 3 procurement, 4 production, 5 shipping, 6 cash, 7 people, 8 customers, 9 KPI snapshot
 * `advance(1)` runs the evening of today and the morning of tomorrow.
 */
export function openDay(tx: Tx, day: number): void {
  const s = tx.s;
  if (day !== s.day) tx.emit('DayStarted', { day }, rule('clock'), { day });
  if (isPeriodStart(day, s.settings.periodLengthDays) && day > 1) {
    closePeriod(tx, periodOf(day - 1, s.settings.periodLengthDays));
  }
  for (const l of s.lines) {
    if (l.status === 'down' && l.repairDueDay !== null && l.repairDueDay <= day) {
      tx.emit('LineRepaired', { lineId: l.id }, rule('rule.maintenance.repairDue'), { lineId: l.id });
    }
  }
  for (const d of s.decisions) {
    if (d.status !== 'open' || d.deadlineDay > day) continue;
    expireDecision(tx, d, rule('rule.decision.deadline'));
  }
  runCards(tx);
  runDemand(tx);
}

export function closeDay(tx: Tx): void {
  runDeliveries(tx);
  runMrp(tx);
  runProduction(tx);
  runShipping(tx);
  runCash(tx);
  runPeople(tx);
  runCustomers(tx);
  runKpiSnapshot(tx);
  tx.flushRng(rule('tick'));
}
