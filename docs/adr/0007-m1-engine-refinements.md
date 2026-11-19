# ADR-0007: Milestone 1 engine refinements

- Status: Accepted
- Date: 2026-11-18 (amended 2026-11-19: pre-M2 engine follow-ups — tuning, 90-day advisors, Desk selectors)

## Context
Building and calibrating the Milestone 1 engine needed a few choices not covered by
ADRs 0002–0006 or SIMULATION_DESIGN.

## Decision
- **Morning/evening tick split.** The daily tick keeps the order from SIMULATION_DESIGN §3, but
  steps 1–2 (event cards, sales intake) run in the *morning* and steps 3–9 run in the
  *evening*. The CEO sees the day's telegrams and can act before production and cash settle.
- **Units.** `Money` is branded (integer kuruş). `Bps` and `SimDay` are plain integer aliases.
  Satisfaction uses `Score` (integer hundredths of a point, 0–10000). Entity IDs are plain
  strings in M1; branding can come later if mix-ups appear.
- **Decision Room horizons.** Short term = +7 days, long term = +30 days (decision Q6).
  `requestAnalysis` adds 90-day impacts that are ready next morning.
- **Rejecting a decision** applies the card's default option (absorb the price rise), which
  is also the baseline for impact deltas.
- **Cost model.** Recurring costs include payroll tax and debt service so that margins and
  runway are realistic. Cash moves only through `ReceivableCollected`, `PayableSettled` and
  `RecurringCostPaid` events.
- **RNG draws are ledgered** (`RngAdvanced`), so replay checks cover randomness too.
- **CEO commands carry intent only.** `placePurchaseOrder {supplierId, materialId, qty}`,
  `switchSupplier {materialId, toSupplierId}`, `repriceOrders {materialId, passThroughBps}` and
  `grantDiscount {customerId, discountBps}` are the only commands a CEO may dispatch or compose in a
  custom decision. Every field is checked (exact field list, integers, ranges) and failures are typed
  `CommandError`s. `setSupplierPrice` and `customerReaction` are engine-built only (decision options).
  Each decision stores a `basis` captured when it opens (price before/after a supplier rise, the
  card's customer reactions); outcomes are derived from it:
  - pass-through: order price rises by `passThroughBps` of the cost rise per unit; each affected
    customer's reaction (satisfaction, churn risk, payment delay) is the card's full reaction scaled
    by the same share (banker's rounding). Without a supplier-price decision on that material the
    command is rejected (`error.noPriceChangeToPass`).
  - discount answering a discount demand: 0 = refusal reaction, at least the demand = acceptance
    reaction, in between = linear interpolation. Any other discount earns goodwill of
    `DISCOUNT_GOODWILL_PER_100_BPS` (0.25 point per 1%, provisional; `config/tuning.ts`) on the
    increase over the customer's current discount; churn follows satisfaction.
  - a custom decision on a discount demand that does not `grantDiscount` to that customer is a
    refusal: the card's refusal reaction runs first, exactly as on reject or expiry (no free
    "answer with something else").
  - discounts reprice open orders from their pre-discount price (`Order.listUnitPrice`) at the new
    rate, the same rule as new orders, so repeated grants never compound.
- **Cancelled purchase orders and deposits.** Cancelling a PO (switching supplier) cancels its
  deposit payable if it is still open (`PayableCancelled`, no cash moves). A deposit already paid is
  **forfeited**: the supplier keeps it, and a `DepositForfeited` event caused by the cancellation
  records the loss in the ledger.
- **Decision deadlines.** At the deadline the default option is validated (on a throw-away copy of
  the draft) before it runs. If it is no longer valid the decision expires with no action and a
  `DecisionDefaultFailed` event records the reason code.
- **Advisor ranking (90-day outlook).** Advisors read `selectDecisionOutlook` = the Decision Room's
  impacts plus +90 (`OUTLOOK_HORIZONS`); the Decision Room preview itself stays +7 / +30.
  - CFO: each option's cash key is the **worse of its +30 and +90 minimum-cash deltas**, so a dip
    the +30 view cannot see counts in full and a +30 dip is not forgiven by a later recovery.
    Options within `CFO_CASH_TOLERANCE` (100k TRY, inclusive) of the best are tied and ranked by the
    +30 gross-margin delta (the +90 book margin is diluted by orders not yet placed); the rest follow
    by the cash key.
  - COO: delivery slip, late orders and any extra overtime, each the worse (higher) of its +30 and
    +90 deltas, then the material's coverage at +7 and +30 (coverage is a near-term measure).
  - Both report `thirtyDayPick` (same rule on the +30 view only) and `pickChanged`, and surface
    **deferred payables**: per option, supplier bills (payables not cancelled) falling due on days
    [today+30, today+89], option minus baseline, with the first day the cumulative extra turns
    positive (`HorizonImpact.payablesDue` of the +90 window). Options adding bills appear in
    `deferred` and as caveats `advisor.caveat.deferredPayables {optionId, amount, fromDay}`; a
    changed pick adds `advisor.caveat.pickChangedAt90 {thirtyDayOptionId, optionId, horizonDays}`.
  - Day 1 (steel): CFO switch → **absorb** (switch is best at +30, +4.69M TRY minimum cash, but its
    +90 minimum cash is −2.66M TRY and it adds 8.41M TRY of bills from Day 32); COO stays negotiate.
  - Each brief cites every ranking key of every ranked option (+30 keys via `selectDecision`, +90
    keys via `selectDecisionOutlook`), so its ranking can be recomputed from its citations alone.
- **Tunables.** Calibration constants (horizons, customer reaction rules, discount goodwill, supplier
  slip, coverage, CFO tolerance, risk rules, health weights and thresholds) live in
  `packages/engine/src/config/tuning.ts`; the modules that owned them re-export the same objects.
  Company facts stay in the seed (e.g. `settings.runwayHorizonDays` = 180).
- **Overall health** (`selectOverallHealth`, 0–100): weighted mean of five component scores (each
  0–100, computed in hundredths, banker's rounding):
  runway = days / 180 (capped runway = 100), weight 30; gross margin of the book = linear from
  0% (0) to 25% (100), weight 20; average customer satisfaction as is, weight 20; on-time delivery =
  share of orders shipped in the last 30 days on or before their promise plus open orders not yet
  overdue (none = 100), weight 20; capacity strain = 100 up to 85% utilisation, 0 from 120%, linear
  between, weight 10. Bands: good ≥ 75, fair ≥ 55, poor ≥ 35, else critical. Day 1 (rngSeed 42):
  65 days → 36.11, 16.62% → 66.48, 81.25, 100, 91.8% → 80.57 ⇒ **68, fair**. Runway is the expensive
  input, so `selectMorningReport(s, { includeRunway: false })` omits runway and health and the UI
  computes `selectProjectedRunway(s)` / `selectOverallHealth(s, runway)` asynchronously.
- **Turnover on the Desk** (`selectWorkforce`): the monthly turnover *rate* the people model uses
  (base + overtime fatigue over the trailing 30 days), now vs last month (same formula on last
  month's closed overtime, with today's headcount; headcount history is not kept). Overtime is
  booked to operations.
- **Live vs plan order figures.** `OrderPlan` stays as captured at arrival. `selectOrderImpact().live`
  and `selectOrderBook` add live figures (material at today's replacement price, cost estimate and
  margin, promise day, estimated ship day by the intake rule on today's queue, supplier bills of the
  order's non-cancelled POs and their last due day, expected customer payment day) with a `differs`
  flag per field. The plan's receipt day used the promise day; the live one uses the estimated ship
  day (an early finish shows as a difference).
- **Message catalogue.** `listMessageCodes(state?)` lists every i18n code the engine emits with its
  param names (seed-defined codes such as `card.<kindKey>` when a state is given); a test runs every
  decision path for 90 days plus all error paths and fails on any unlisted code or param.
- **Immutability.** The reducer stores copies of record payloads, so the ledger never aliases live
  state. Committed states and ledger events are deep-frozen, memoised projections (impacts, runway)
  are frozen, and a zero-day projection returns a copy.

## Consequences
+ Morning report and telegrams match the Desk's narrative. Calibration is honest: no scripted penalties.
− Option outcomes are deterministic in M1; negotiation success probability and ranges are deferred.
− The 180-day runway projection costs ~260 ms cold (memoised per state); the UI may need a worker.
− Advisor briefs now run 90-day projections for every option (~0.3–0.5 s cold per decision,
  memoised per state and shared with the requested analysis).
− Health weights, thresholds and discount goodwill are provisional until calibrated in play.
