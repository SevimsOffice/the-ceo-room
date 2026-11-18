# Simulation design

Status: **Proposed (Phase 0)**.

## 1. Clock

- Unit of time: **1 simulated day** (`SimDay`). Day 1 = Monday. Weekends: production off,
  cash movements still settle (configurable).
- Controls: advance 1 day / 1 week (7) / 1 month (30), pause. The UI "Advance day" bell = 1 day.
- `advance(n)` runs the daily tick `n` times. Open decisions do not block time. A decision
  left open past its deadline triggers its card's default outcome (usually the worst one).

## 2. Determinism

- RNG: small seeded PRNG (sfc32/mulberry32) with **separate named streams** per subsystem
  (`events`, `customers`, `suppliers`, `production`, `people`). The RNG state lives in
  `CompanyState`, so a save game and its replay stay identical.
- Adding a new subsystem must not shift existing streams (stream key → derived seed).
- Engine bans `Math.random`, `Date`, I/O (lint rule + test).
- Golden test: fixed seed + fixed command script → hash of state at Day 31 is stable.

## 3. Daily tick (fixed order)

1. **Scheduled & triggered event cards**: date triggers and condition triggers (e.g. cash
   runway < 30 days → "cash squeeze"). Emit `DevelopmentArrived`, maybe open a `Decision`.
2. **Sales intake**: register new orders, run the order pipeline (§4) for new orders.
3. **Procurement deliveries**: POs whose `dueDay` = today arrive; stock up; create payables.
4. **Production**: allocate available line-hours (shifts × hours × line status) to jobs in
   promised-date order; consume materials per BOM; shortages pause jobs.
5. **Shipping & invoicing**: finished orders ship, create receivables (`dueDay` = ship day + terms).
6. **Cash settlement**: receivables at `expectedPayDay` come in; payables at `dueDay` go out;
   recurring costs (payroll monthly, overhead monthly, energy per production hour).
7. **People**: turnover draws (stream `people`), overtime fatigue raises turnover.
8. **Customers**: satisfaction moves with on-time delivery, price changes, discounts;
   churn risk follows satisfaction.
9. **Derived KPIs snapshot** for the day (for trends and the morning report).

Each step reads state and returns events. Events are reduced in order and appended to the ledger.

## 4. Cross-department order pipeline

```
OrderReceived
 → Sales: register (price, terms, requested date)
 → Operations: capacity check (free line-hours until requested date per family/plant)
 → Procurement: material check (BOM × qty vs stock − allocations)
     → shortage → purchase need → choose supplier (price, lead time, reliability)
       → PurchaseOrder (dueDay = today + leadTime, payable at dueDay + paymentTerms)
 → Finance: production cost (materials + labour hours × rate + energy), margin,
            cash curve (payables out vs receivable in) → peak cash need
 → People: shifts/overtime needed if hours > capacity
 → Operations: earliest feasible delivery = max(material arrival, capacity slot) + production time
 → Sales: customer commitment (promise date). Late vs requested date → satisfaction risk
```

A problem anywhere propagates: a supplier price rise re-costs open purchase needs and the
margin of affected orders; a line breakdown removes hours and pushes promise dates, which
hits satisfaction and delays receivables, which moves the cash curve.

## 5. Decisions and options

- An option is a **list of commands** plus assumption notes, e.g. *Negotiate* =
  `SetSupplierPrice(supplier, +10%)`, `CommitVolume(supplier, qty)`.
- Impact preview = `project(option.commands, 0..30)` vs `project([], 0..30)` (baseline). The
  Decision Room shows the delta on cash, margin, lead time, customer satisfaction, people
  (overtime/turnover) and risk, **today vs Day +30**. Scenario Study reuses this with 30/90/180/365.
- Some outcomes are not certain (e.g. negotiation success). Options carry an explicit
  probability; projections show the expected path and, later, a range. The actual outcome
  is drawn from the seeded stream when approved.
- **Delayed consequences** come from the model, not scripts: payment terms, lead times,
  satisfaction → churn, overtime → turnover. Milestone 1 must show at least one option that
  looks good now and hurts cash by Day +30. Example: switching supplier needs a deposit and
  shorter payment terms, while the customer pays at 90 days.
- Actions: approve (dispatch commands), reject (decision closed, card's default path),
  request analysis (decision stays open; adds a deeper projection/advisor note next
  morning, costs one day), custom decision (later: compose from allowed command types).

## 6. Advisors (rule-based in V1)

- Each role has a **scope** (selectors it may read): CFO = finance + cash projections; COO =
  operations + procurement + capacity.
- A rule scores options against the role's objective (CFO: minimise min-cash and runway risk;
  COO: minimise delivery slip and line risk) and outputs a recommendation with **citations**
  (selector name + value) and assumptions. Different objectives give different
  recommendations from the same numbers.
- The LLM layer, when it lands, only rephrases and argues from the same citations.

## 7. Calibration targets (seed)

The seed generator tunes the starting point so Day 1 roughly matches the design mock-ups:
monthly revenue ≈ 75M TRY (≈ 900M/yr), 15 open orders ≈ 168M TRY, capacity ≈ 90%,
satisfaction ≈ 80. Cash and runway follow from the model (see open question on runway).

## 8. Testing strategy

- Unit: each system with hand-built tiny states.
- Invariants (property tests): cash conservation, no negative stock, single settlement,
  every event has a cause.
- Determinism: same seed+commands → same hash; replay(commandLog) == live state.
- Vertical slice integration: steps 1–8 of the spec, plus "each option leads to a different
  Day-31 state" and "delayed cash effect visible at Day 31 and not at Day 1".
- E2E (later): Playwright walks Desk → Decision Room → approve → advance → Desk.
