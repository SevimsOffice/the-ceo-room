/**
 * Calibration constants (ADR-0007). Every number here is a modelling choice, not a fact about the
 * company: the seed holds the company's data, this file holds how the engine judges and reacts.
 * Units follow ADR-0004: money in kuruş, rates in basis points, Score in hundredths of a point,
 * days as integers. Values marked "provisional" are placeholders until calibrated against play.
 */
import type { Bps, Money, Score } from '../model/units';
import { tl } from '../model/units';
import type { RiskLevel } from '../rules/risk';

// ---- Horizons ------------------------------------------------------------------------------

/** Decision Room short-term preview (days ahead). */
export const SHORT_HORIZON_DAYS = 7;
/** Decision Room long-term preview (decision Q6). */
export const LONG_HORIZON_DAYS = 30;
/** Deep look used by advisors and by `requestAnalysis` (deferred bills, slow cash effects). */
export const DEEP_HORIZON_DAYS = 90;
/** Checkpoints of the Decision Room preview. */
export const DECISION_HORIZONS: readonly number[] = [SHORT_HORIZON_DAYS, LONG_HORIZON_DAYS];
/** Checkpoints of the advisors' outlook and the requested analysis. */
export const OUTLOOK_HORIZONS: readonly number[] = [SHORT_HORIZON_DAYS, LONG_HORIZON_DAYS, DEEP_HORIZON_DAYS];

// ---- Customers -----------------------------------------------------------------------------

/** 0.25 satisfaction points per 1% discount; provisional, to be calibrated. */
export const DISCOUNT_GOODWILL_PER_100_BPS: Score = 25;

/** Explicit customer-reaction rules (SIMULATION_DESIGN §3 step 8). */
export const CUSTOMER_RULES = {
  /** satisfaction gained by an on-time shipment */
  onTimeShipment: 100 as Score,
  /** satisfaction lost per day late at shipment, capped at `lateMax` */
  latePerDay: -80 as Score,
  lateMax: -1000 as Score,
  /** satisfaction lost per day an open order is overdue */
  overduePerDay: -20 as Score,
  /** churn risk moves 1 bps per 1/100 point of satisfaction lost (and back) */
  churnPerSatisfaction: -1,
  /** a customer whose churn risk reaches this leaves */
  churnThresholdBps: 6000 as Bps,
  /** goodwill from an unsolicited discount: satisfaction per 100 bps of discount increase */
  discountGoodwillPer100Bps: DISCOUNT_GOODWILL_PER_100_BPS,
} as const;

// ---- Procurement ---------------------------------------------------------------------------

/** Days within which an undelivered PO counts as in transit and can no longer be cancelled. */
export const IN_TRANSIT_DAYS = 2;
/** A supplier slip (failed reliability draw) lasts MIN + draw(0..SPREAD-1) days, i.e. 2–6 days. */
export const SUPPLIER_SLIP_MIN_DAYS = 2;
export const SUPPLIER_SLIP_SPREAD_DAYS = 5;

/** Material coverage: need is averaged over this many days ahead … */
export const COVERAGE_NEED_WINDOW_DAYS = 30;
/** … and inbound POs due within this many days count as cover … */
export const COVERAGE_INBOUND_DAYS = 7;
/** … and the result is capped here (also returned when there is no need). */
export const COVERAGE_CAP_DAYS = 99;

// ---- Advisors ------------------------------------------------------------------------------

/** CFO treats options whose minimum-cash delta is within this many kuruş (100k TRY) of the best as tied. */
export const CFO_CASH_TOLERANCE: Money = tl(100_000);

// ---- Risk ----------------------------------------------------------------------------------

/** Explicit, documented risk rules. Points add up; the level is a band of the total. */
export const RISK_RULES = {
  cashNegative: 3,
  cashLowThreshold: tl(10_000_000),
  cashLow: 1,
  lateOrdersMany: { atLeast: 3, points: 2 },
  lateOrdersSome: { atLeast: 1, points: 1 },
  materialShortage: 2,
  churnHigh: { atLeastBps: 3000, points: 2 },
  churnElevated: { atLeastBps: 2000, points: 1 },
  turnoverHigh: { atLeastBps: 400, points: 1 },
  lineDown: 1,
  bands: [
    { maxScore: 1, level: 'low' },
    { maxScore: 3, level: 'medium' },
    { maxScore: 5, level: 'high' },
  ] as { maxScore: number; level: RiskLevel }[],
} as const;

// ---- Overall health (selectOverallHealth, ADR-0007) ------------------------------------------

/**
 * Component weights (relative; they need not sum to 100). Provisional, to be calibrated.
 * Score = Σ weight × componentScore / Σ weight, each component scored 0–100.
 */
export const HEALTH_WEIGHTS = {
  runway: 30,
  grossMargin: 20,
  satisfaction: 20,
  onTimeDelivery: 20,
  capacityStrain: 10,
} as const;

/** Runway scores 100 at or above this many days (= the runway projection's horizon), 0 at 0 days. */
export const HEALTH_RUNWAY_FULL_DAYS = 180;
/** Gross margin scores 0 at or below the floor and 100 at or above the target, linear between. */
export const HEALTH_MARGIN_FLOOR_BPS: Bps = 0;
export const HEALTH_MARGIN_TARGET_BPS: Bps = 2500;
/** On-time delivery is measured over orders shipped in this many trailing days, plus open orders. */
export const HEALTH_ON_TIME_WINDOW_DAYS = 30;
/** Capacity utilisation scores 100 up to COMFORT and 0 from MAX, linear between. */
export const HEALTH_CAPACITY_COMFORT_BPS: Bps = 8500;
export const HEALTH_CAPACITY_MAX_BPS: Bps = 12000;
/**
 * The Desk's runway gauge marks this many days and fewer as the danger zone (less than a month of
 * cash). Provisional, to be calibrated.
 */
export const RUNWAY_DANGER_DAYS = 30;
/** Bands by overall score (0–100), checked in order; below the last = critical. */
export const HEALTH_BANDS = [
  { minScore: 75, band: 'good' },
  { minScore: 55, band: 'fair' },
  { minScore: 35, band: 'poor' },
] as const;
