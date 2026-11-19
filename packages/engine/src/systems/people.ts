import type { CompanyState, DepartmentId, Settings, WorkforceRow } from '../model/types';
import type { Bps } from '../model/units';
import { type Tx, rule } from '../events/tx';
import { chance } from '../rng/rng';

/** Overtime person-hours over the trailing period (including today so far). */
export function overtimeHoursTrailing(s: CompanyState, days?: number): number {
  const window = days ?? s.settings.periodLengthDays;
  let t = s.dayAcc.overtimePersonHours;
  for (const k of s.daily) if (k.day > s.day - window && k.day < s.day) t += k.overtimePersonHours;
  return t;
}

/**
 * Monthly turnover rate of a department given the overtime person-hours of a 30-day window:
 * base + overtime fatigue (operations carries the overtime).
 */
export function turnoverRateBps(w: WorkforceRow, overtimeHours: number, settings: Settings): Bps {
  if (w.departmentId !== 'operations' || w.headcount === 0) return w.baseTurnoverBps;
  const perHead = overtimeHours / w.headcount;
  return w.baseTurnoverBps + Math.round(perHead * settings.turnoverBpsPerOvertimeHourPerHead);
}

/** Monthly turnover rate now: base + overtime fatigue over the trailing period. */
export function turnoverBps(s: CompanyState, dept: DepartmentId): Bps {
  const w = s.workforce.find((r) => r.departmentId === dept);
  if (!w) return 0;
  if (dept !== 'operations' || w.headcount === 0) return w.baseTurnoverBps;
  return turnoverRateBps(w, overtimeHoursTrailing(s), s.settings);
}

/** Company-wide turnover, headcount-weighted. */
export function companyTurnoverBps(s: CompanyState): Bps {
  let num = 0;
  let den = 0;
  for (const w of s.workforce) {
    num += turnoverBps(s, w.departmentId) * w.headcount;
    den += w.headcount;
  }
  return den === 0 ? 0 : Math.round(num / den);
}

/** Step 7: daily leaver draws per department from the `people` stream. */
export function runPeople(tx: Tx): void {
  const s = tx.s;
  const cause = rule('tick.people');
  for (const w of s.workforce) {
    if (w.headcount === 0) continue;
    const p = (w.headcount * turnoverBps(s, w.departmentId)) / 10000 / s.settings.periodLengthDays;
    if (chance(tx.draw('people'), p)) {
      tx.emit('EmployeeLeft', { departmentId: w.departmentId, headcount: w.headcount - 1 }, cause, {
        departmentId: w.departmentId,
      });
    }
  }
  tx.flushRng(cause);
}
