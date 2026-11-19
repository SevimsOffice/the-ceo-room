# @ceo-room/engine

Pure, deterministic simulation of NOVARA (simulated). No DOM, React, LLM, I/O, `Math.random` or
`Date`; enforced by `tsconfig.json` (`types: []`) and the purity test in `src/engine.smoke.test.ts`.

Units: `Money` = integer kuruş (branded, helpers in `model/units.ts`, banker's rounding),
`Bps` = basis points, `Score` = hundredths of a 0–100 point (8100 = 81.00), `SimDay` = integer,
Day 1 = Monday. The engine emits i18n codes + params (`event.code = 'ledger.<Type>'`,
`Msg { code, params }`), never sentences.

## API

```ts
import { createEngine, fromSnapshot, selectMorningReport, selectProjectedRunway, selectOverallHealth,
         selectWorkforce, selectDecision, selectDecisionOutlook, selectAdvisorBrief, selectOrderImpact,
         selectOrderBook, listMessageCodes, stateHash, tuning } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';          // validated SeedBundle

const engine = createEngine(loadSeed(), { rngSeed: 42, workspaceId: 'ws_demo' });
engine.state();                       // Readonly<CompanyState>, Day 1 morning (cards already fired)
engine.dispatch(cmd);                 // { ok, commandId, events } | { ok: false, error: Msg }
engine.advance(1 | 7 | 30);           // runs N days, returns the events
engine.project(cmds, days, [7, 30]);  // runs a clone; live state untouched
engine.ledger();                      // every event, each with seq, day, cause, code, params
engine.snapshot();                    // { format, seedVersion, rngSeed, workspaceId, log }
fromSnapshot(seed, save);             // replay → identical state (compare with stateHash)
```

Pure building blocks (same code paths): `applyCommand(state, cmd)`, `advanceState(state, n)`,
`projectState(state, cmds, days, checkpoints)`, `projectedRunway(state)`, `decisionImpacts(state, id)`.

### Commands

- Decision: `approveOption {decisionId, optionId}`, `rejectDecision` (runs the default option),
  `requestAnalysis` (stays open; 90-day impacts appear in `selectDecision(...).analysis` from the
  next morning, so it costs a day), `customDecision {decisionId, commands}` (allow-list in
  `CUSTOM_ALLOWED`; on a discount demand without a `grantDiscount` to that customer the card's
  refusal reaction applies, as on reject).
- Desk: `acknowledgeDevelopment {developmentId}` (telegrams without an open decision).
- Operational, CEO intent only (allow-listed): `placePurchaseOrder {supplierId, materialId, qty}`,
  `switchSupplier {materialId, toSupplierId}`, `repriceOrders {materialId, passThroughBps}` (needs a
  supplier-price decision on that material), `grantDiscount {customerId, discountBps}`. Prices and
  customer reactions are derived by the engine from the decision's `basis` and `CUSTOMER_RULES`
  (ADR-0007). `setSupplierPrice` and `customerReaction` are engine-built, usable only inside
  decision options.

Invalid commands (unknown type, missing or extra field, non-integer or out-of-range number) return
a typed error and change nothing. `COMMAND_LIMITS` (exported) gives the bounds on CEO-supplied
numbers (purchase quantity, discount); pass-through is 0–10000 bps. Committed state, ledger events and memoised read models are
deep-frozen.

### Selectors

- `selectMorningReport(state, { includeRunway? = true })`: day, weekday + `weekdayCode`, revenue
  (last closed month, the one before, change, month to date), cash, projected runway, `health`,
  backlog (open orders count/value), satisfaction (+change), capacity utilisation, gross margin,
  on-time delivery, people, `workforce`, risk, `developments` (new telegrams), `telegrams` (new + read,
  with severity, day, message code+params, linked decision/order), `pendingDecisions` (deadline, days
  left, linked development, analysis ready). With `{ includeRunway: false }` it skips the 180-day
  projection: `runway` and `health` are `null` (type `MorningReportWithoutRunway`).
- `selectProjectedRunway(state)`: `Runway { days, capped, firstNegativeDay, horizonDays }` (memoised).
- `selectOverallHealth(state, runway?)`: `{ score 0–100, band good|fair|poor|critical, code,
  components[{ id, code, value, score (0–10000), weight }] }`; formula in ADR-0007, weights in
  `config/tuning.ts`. Pass a runway computed elsewhere to avoid recomputing it.
- `selectWorkforce(state)`: per department and total: headcount, monthly turnover rate now vs last
  month (bps, change), overtime person-hours this month and last.
- `selectDecision(state, id)`: situation, supporting figures, options with `impacts` at +7 and +30
  (baseline snapshot, option snapshot, delta, risk level, `payablesDue` in the window).
- `selectDecisionOutlook(state, id)`: the same impacts at +7 / +30 / +90 (advisors' view; open
  decisions only). `HorizonImpact.payablesDue` = supplier bills due in [previous checkpoint, this
  one), baseline vs option, with the first day the option's extra bills start.
- `previewCustomDecision(state, id, commands, horizons = [7, 30])`: a custom decision memo's
  impact, `{ decisionId, horizons, baseline, impact: OptionImpact }` (optionId `'custom'`), from
  `project([customDecision], H)` against the same memoised baseline run as the options. The memo is
  checked as on dispatch; a refusal is `impact.error`. Null for an unknown or closed decision.
  Equals sealing the memo and advancing (test).
- `selectAdvisorBrief(state, 'cfo' | 'coo', id)`: recommended option, ranking, `thirtyDayPick`,
  `pickChanged`, `deferred[{ optionId, amount, firstDueDay }]`, `caveats` (Msg), rationale code,
  citations `{ selector, value }`, assumptions. Ranking rules (worse of +30 / +90) in ADR-0007.
- `selectOrderImpact(state, orderId)`: the stored pipeline plan (capacity, materials, POs, cost,
  cash curve, overtime, delivery), live progress, and `live`: `OrderFigures` where each field is
  `Compared<T> { plan, live, differs }` (value, material cost, total cost, margin, promise day,
  expected ship day, supplier bills, last supplier payment day, receivable day).
- `selectOrderBook(state)`: every open order with the same `OrderFigures`, an overall `differs`
  flag and totals (memoised, frozen).
- `listMessageCodes(state?)`: every i18n code the engine can emit, `{ code, params, kind }`, sorted;
  with a state it adds the seed's codes (`card.<kindKey>`, names, titles, department notes).
  `LEDGER_PARAMS` / `CARD_PARAMS` give the param names per event type / card effect.

### Tuning

`config/tuning.ts` (exported as `tuning`) holds the calibration constants: horizons
(`DECISION_HORIZONS` 7/30, `OUTLOOK_HORIZONS` 7/30/90), `CUSTOMER_RULES`,
`DISCOUNT_GOODWILL_PER_100_BPS`, supplier slip, coverage, `CFO_CASH_TOLERANCE`, `RISK_RULES`, health
weights and thresholds. Company facts stay in the seed.

## Daily tick

`advance(1)` = evening of today (3 procurement deliveries + MRP, 4 production, 5 shipping/invoicing,
6 cash, 7 people, 8 customers, 9 KPI row), then morning of tomorrow (period close, line repairs,
decision deadlines, 1 event cards, 2 sales intake). The CEO acts between morning and evening, so
the morning report always shows the day's new telegrams.

## Layout

`model/` types + units · `rng/` named mulberry32 streams · `events/` event types, reducer, `Tx` ·
`commands/` validation + handlers · `systems/` one per subsystem + `tick.ts` · `rules/` event cards,
decision option builders, risk rules, CFO/COO advisors · `projection/` forward runs + impacts ·
`selectors/` read models (`desk.ts` health/workforce/runway, `orders.ts` live vs plan) · `config/`
tuning constants · `messages.ts` i18n code catalogue · `seed/` bundle types, validation, initial state.

## Testing notes

- `test/seedFixture.ts` gives `seed()`, `rawSeed()` and `newEngine(rngSeed)` from `data/seed`.
- Determinism: `stateHash(engine.state())`; replay via `fromSnapshot`.
- Cash conservation: `cash = openingCash + Σ ReceivableCollected − Σ PayableSettled − Σ RecurringCostPaid`.
- Reducer throws `InvariantError` on negative stock or a double settlement.
- `selectDecision` / outlook / runway / order book results are memoised per state object and frozen
  (states are never mutated).
- Advisor citations resolve through `test/citations.ts` (`selectMorningReport.…`,
  `selectDecision(id).…`, `selectDecisionOutlook(id).…`).
- `src/messages.test.ts` fails if anything emits an i18n code or param missing from `listMessageCodes`.
