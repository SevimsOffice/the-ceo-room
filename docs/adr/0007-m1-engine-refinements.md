# ADR-0007: Milestone 1 engine refinements

- Status: Proposed
- Date: 2026-11-18

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
    `CUSTOMER_RULES.discountGoodwillPer100Bps` (0.25 point per 1%) on the increase over the
    customer's current discount; churn follows satisfaction.
  - discounts reprice open orders from their pre-discount price (`Order.listUnitPrice`) at the new
    rate, the same rule as new orders, so repeated grants never compound.
- **Cancelled purchase orders and deposits.** Cancelling a PO (switching supplier) cancels its
  deposit payable if it is still open (`PayableCancelled`, no cash moves). A deposit already paid is
  **forfeited**: the supplier keeps it, and a `DepositForfeited` event caused by the cancellation
  records the loss in the ledger.
- **Decision deadlines.** At the deadline the default option is validated (on a throw-away copy of
  the draft) before it runs. If it is no longer valid the decision expires with no action and a
  `DecisionDefaultFailed` event records the reason code.
- **Advisor ranking.** CFO: options whose +30 minimum cash is within `CFO_CASH_TOLERANCE` (100k TRY,
  inclusive) of the best are tied and ranked by gross margin; the rest follow by minimum cash. COO:
  +30 delivery slip, late orders, any extra overtime, then the material's coverage at +7 and +30.
  Each brief cites every ranking key of every ranked option, so its ranking can be recomputed from
  its citations alone.
- **Immutability.** The reducer stores copies of record payloads, so the ledger never aliases live
  state. Committed states and ledger events are deep-frozen, memoised projections (impacts, runway)
  are frozen, and a zero-day projection returns a copy.

## Consequences
+ Morning report and telegrams match the Desk's narrative. Calibration is honest: no scripted penalties.
− Option outcomes are deterministic in M1; negotiation success probability and ranges are deferred.
− The 180-day runway projection costs ~260 ms cold (memoised per state); the UI may need a worker.
