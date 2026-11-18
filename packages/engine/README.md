# @ceo-room/engine

Pure, deterministic simulation of NOVARA (simulated). No DOM, React, LLM, I/O, `Math.random` or
`Date`; enforced by `tsconfig.json` (`types: []`) and the purity test in `src/engine.smoke.test.ts`.

Units: `Money` = integer kuruş (branded, helpers in `model/units.ts`, banker's rounding),
`Bps` = basis points, `Score` = hundredths of a 0–100 point (8100 = 81.00), `SimDay` = integer,
Day 1 = Monday. The engine emits i18n codes + params (`event.code = 'ledger.<Type>'`,
`Msg { code, params }`), never sentences.

## API

```ts
import { createEngine, fromSnapshot, selectMorningReport, selectDecision,
         selectAdvisorBrief, selectOrderImpact, stateHash } from '@ceo-room/engine';
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
  `CUSTOM_ALLOWED`).
- Desk: `acknowledgeDevelopment {developmentId}` (telegrams without an open decision).
- Operational (allow-listed): `setSupplierPrice`, `placePurchaseOrder`, `switchSupplier`,
  `repriceOrders`, `grantDiscount`. `customerReaction` is only usable inside decision options.

Invalid commands return a typed error and change nothing.

### Selectors

- `selectMorningReport(state)`: revenue (last/previous period, change), cash, projected runway,
  backlog, satisfaction (+change), capacity utilisation, gross margin, people, risk, new
  developments, pending decisions.
- `selectDecision(state, id)`: situation, supporting figures, options with `impacts` at +7 and +30
  (baseline snapshot, option snapshot, delta, risk level).
- `selectAdvisorBrief(state, 'cfo' | 'coo', id)`: recommended option, ranking, rationale code,
  citations `{ selector, value }`, assumptions.
- `selectOrderImpact(state, orderId)`: the stored pipeline plan (capacity, materials, POs, cost,
  cash curve, overtime, delivery) plus live progress.

## Daily tick

`advance(1)` = evening of today (3 procurement deliveries + MRP, 4 production, 5 shipping/invoicing,
6 cash, 7 people, 8 customers, 9 KPI row), then morning of tomorrow (period close, line repairs,
decision deadlines, 1 event cards, 2 sales intake). The CEO acts between morning and evening, so
the morning report always shows the day's new telegrams.

## Layout

`model/` types + units · `rng/` named mulberry32 streams · `events/` event types, reducer, `Tx` ·
`commands/` validation + handlers · `systems/` one per subsystem + `tick.ts` · `rules/` event cards,
decision option builders, risk rules, CFO/COO advisors · `projection/` forward runs + impacts ·
`selectors/` read models · `seed/` bundle types, validation, initial state.

## Testing notes

- `test/seedFixture.ts` gives `seed()`, `rawSeed()` and `newEngine(rngSeed)` from `data/seed`.
- Determinism: `stateHash(engine.state())`; replay via `fromSnapshot`.
- Cash conservation: `cash = openingCash + Σ ReceivableCollected − Σ PayableSettled − Σ RecurringCostPaid`.
- Reducer throws `InvariantError` on negative stock or a double settlement.
- `selectDecision` / runway results are memoised per state object (states are never mutated).
