/**
 * config/tuning.ts is the single home of calibration constants; the modules that used to own them
 * re-export the same objects, and the engine's behaviour follows the tuned values.
 */
import { describe, expect, it } from 'vitest';
import * as tuning from './config/tuning';
import { CFO_CASH_TOLERANCE, CUSTOMER_RULES, RISK_RULES, tl } from './index';
import { IN_TRANSIT_DAYS } from './systems/procurement';
import { discountReaction } from './systems/customers';
import { day1State } from '../test/seedFixture';

describe('tuning.ts', () => {
  it('holds the named calibration constants with their documented values', () => {
    expect(tuning.DISCOUNT_GOODWILL_PER_100_BPS).toBe(25);
    expect(tuning.CFO_CASH_TOLERANCE).toBe(tl(100_000));
    expect([tuning.SHORT_HORIZON_DAYS, tuning.LONG_HORIZON_DAYS, tuning.DEEP_HORIZON_DAYS]).toEqual([7, 30, 90]);
    expect(tuning.DECISION_HORIZONS).toEqual([7, 30]);
    expect(tuning.OUTLOOK_HORIZONS).toEqual([7, 30, 90]);
    expect(tuning.HEALTH_RUNWAY_FULL_DAYS).toBe(180);
    expect(tuning.RUNWAY_DANGER_DAYS).toBe(30);
    const w = tuning.HEALTH_WEIGHTS;
    expect(w.runway + w.grossMargin + w.satisfaction + w.onTimeDelivery + w.capacityStrain).toBe(100);
  });

  it('modules re-export the tuned objects (one source of truth)', () => {
    expect(CUSTOMER_RULES).toBe(tuning.CUSTOMER_RULES);
    expect(RISK_RULES).toBe(tuning.RISK_RULES);
    expect(CFO_CASH_TOLERANCE).toBe(tuning.CFO_CASH_TOLERANCE);
    expect(IN_TRANSIT_DAYS).toBe(tuning.IN_TRANSIT_DAYS);
    expect(CUSTOMER_RULES.discountGoodwillPer100Bps).toBe(tuning.DISCOUNT_GOODWILL_PER_100_BPS);
  });

  it('unsolicited discount goodwill follows DISCOUNT_GOODWILL_PER_100_BPS (4% → 1.00 point)', () => {
    const c = day1State().customers.find((x) => x.id === 'cus_velora');
    if (!c) throw new Error('no customer');
    const r = discountReaction(c, c.discountBps + 400, null);
    expect(r.satisfactionDelta).toBe(4 * tuning.DISCOUNT_GOODWILL_PER_100_BPS);
    expect(r.churnRiskDelta).toBeNull();
  });
});
