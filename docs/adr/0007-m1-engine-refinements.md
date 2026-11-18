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

## Consequences
+ Morning report and telegrams match the Desk's narrative. Calibration is honest: no scripted penalties.
− Option outcomes are deterministic in M1; negotiation success probability and ranges are deferred.
− The 180-day runway projection costs ~260 ms cold (memoised per state); the UI may need a worker.
