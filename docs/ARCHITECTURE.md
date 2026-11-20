# Architecture

Status: **Accepted** (2026-11-18). Decisions on open questions: `docs/OPEN_QUESTIONS.md`.

## 1. Shape of the system

```
 data/seed/*.json ──► CompanyDataSource ──► Engine (packages/engine, pure TS)
                                              │  state: CompanyState
                                              │  in:   Command
                                              │  out:  Event[]  ──► Ledger (append-only)
                                              ▼
                                         Selectors / Projections
                                              │ (read-only view models)
             ┌────────────────────────────────┼──────────────────────────────┐
             ▼                                ▼                              ▼
   apps/web (React UI)             Advisors (rule-based V1)         AI layer (later, optional)
   Zustand store holds             cite selector values,            read-only tools over
   engine instance + UI state      never compute their own          selectors; proposals need
                                   numbers                          human approval → Command
```

Everything that changes the company goes through `engine.dispatch(command)`. Nothing else
can mutate state.

## 2. Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/engine` | Domain model, systems, commands, events, rules, projections, selectors, RNG | nothing (no DOM, no React, no LLM, no I/O) |
| `packages/i18n` | `tr`/`en` catalogues (every engine code + `ui.*`), `createTranslator` (`{param:format}` placeholders, id → name directory), formatters from engine units (`formatMoney`, `formatBps`, `formatScoreDelta`, `formatDays`, …) | none (tests use engine + seed-data) |
| `packages/import` | Excel template import, pure (ADR-0008): template export, validation report, `toSeedBundle`, profiles, `TemplateDataSource` on a neutral workbook model | engine, i18n, seed-data |
| `apps/web` | Rooms (Desk, Decision Room, Archive Room), physical-object components, Zustand stores, engine and archive Web Workers, localStorage saves, IndexedDB company store | engine, import (workers; types and pure helpers on the main thread), i18n |
| `scripts/` | `generate-seed.ts` (fixed seed → `data/seed/*.json`) | engine types |

Monorepo via pnpm workspaces (ADR-0003). TypeScript strict across all packages.

## 3. Engine API (sketch)

```ts
interface CompanyDataSource { load(workspaceId: WorkspaceId): Promise<SeedBundle> }

createEngine(seed: SeedBundle, opts: { rngSeed: number; workspaceId: WorkspaceId }): Engine

interface Engine {
  state(): Readonly<CompanyState>
  dispatch(cmd: Command): DispatchResult          // validated; returns produced events
  advance(days: number): Event[]                  // runs the daily tick N times
  project(cmds: Command[], days: number): Projection  // run on a cloned state, original untouched
  ledger(): readonly LedgerEntry[]
  snapshot(): SaveGame                            // seed ref + rng state + command log
}
```

- `dispatch` is the only write path. A command is validated, turned into events, and events
  are reduced into state (ADR-0005).
- `project` powers every "impact" figure (Decision Room short-term vs 30 days, Scenario Study
  30/90/180/365). Options are previewed by **running the real engine forward on a clone**, so
  the numbers shown before a decision are the same code path that produces the numbers after.
- Selectors (`selectMorningReport`, `selectDecision(id)`, `selectAdvisorBrief(role)`…) are
  pure functions `CompanyState → ViewModel`. UI and advisors only see these.

## 4. Persistence

V1 is fully in-browser. Save game = `{ seedVersion, rngSeed, commandLog }` in localStorage.
Loading replays the command log (deterministic), so saves stay small and verifiable. Periodic
state snapshots can be added if replay gets slow. Supabase later, behind the same interface.

**Two companies (M4a).** The sample NOVARA and My company (imported from Excel) each have their own
save game: `ceo-room.save.v1` (+ `.bak`) and `ceo-room.save.mine.v1` (+ `.bak`); `ceo-room.company`
says which is on the desk. A save holds only `seedVersion`, so My company's bundle is stored beside
it in **IndexedDB** (database `ceo-room`, store `company`): `mine.meta` (file name, imported at by the
browser clock, snapshot date, company name, inspection counts, profile) and `mine.data` (the
workbook and the `SeedBundle` built from it), written and removed in one transaction. IndexedDB
rather than localStorage because a workbook of up to 18 × 5 000 rows runs to megabytes (past
localStorage's ~5 MB of UTF-16 text), structured objects need no JSON, and writes are asynchronous.
Nothing is ever sent over the network (an e2e test intercepts every request). On start the store
resumes the company that was on the desk (`store/resume.ts`); if My company is no longer stored the
sample opens. Switching companies restarts the engine worker from that company's own save; removing
My company deletes both records and its saves.

## 5. UI layer

- React + Vite + Tailwind (tokens from `design/README.md`) + Zustand.
- Rooms as routes: `/desk`, `/decision/:id`, later `/scenarios`, `/board`, `/office/:dept`,
  `/map`, `/ledger`.
- Components model physical objects; charts (later) are styled as printed/ink-drawn.
- Input: mouse/keyboard/touch first. Camera mode (MediaPipe) is a late milestone and only
  emits the same UI actions (`select`, `approve`, `reject`).

## 6. AI layer (later, optional)

Provider-independent adapter, structured outputs, department-scoped read-only tools that
call selectors, cached responses, audit trail. Any state change it suggests is turned into a
`Command` that the CEO must approve. The app is fully usable with AI off; V1 advisors are
rule-based (`rules/advisors/*`). API keys never in the frontend (needs a small server
proxy when this lands).

## 7. First workflow (Milestone 1 vertical slice)

1. Load seed → Day 1 state. `selectMorningReport` gives revenue, cash, runway, backlog,
   satisfaction, capacity, critical developments, pending decisions.
2. Event card "large order" fires → `OrderReceived`. Sales registers it; capacity check,
   material check against BOM, procurement need, supplier lead time, production cost,
   payment terms, shift need and delivery date are computed by the systems (see
   SIMULATION_DESIGN §4).
3. Event card "supplier price increase" fires → `SupplierPriceChanged`, which re-costs open
   purchase needs and affected orders.
4. A `Decision` is opened with options. Each option is a list of commands; `project()` gives
   short-term and +30-day deltas.
5. CFO and COO rules read their department selectors and recommend different options,
   citing the projected values and stating assumptions.
6. CEO approves an option → commands dispatched → events in ledger.
7. `advance(30)` → systems run day by day.
8. Morning report shows consequences, including a delayed cash effect (e.g. supplier payment
   terms due before customer receivables arrive).

Integration tests assert steps 2–8 and that each option leads to a different state.

## 8. Cross-cutting

- **workspaceId** on every entity and event.
- **i18n**: engine emits codes + params (`{ code: 'event.supplierPriceIncrease', params }`), never
  sentences. UI translates.
- **Currency**: engine stores kuruş in the company's currency (TRY). Display currency and
  formatting live in `packages/i18n`.
- **Errors**: invalid commands return typed errors; engine never throws on user input.
- **Engine in a Web Worker (M2)**: `apps/web/src/worker/handler.ts` is a pure message handler
  (unit-tested without a Worker) wired to `self` by `engine.worker.ts`. Requests: `init {save}`,
  `newGame`, `dispatch {command}`, `advance {days}` (one day at a time, a report after each),
  `stop`, `openDecision`, `openOrderBook`. After every state change the worker posts `report`
  (`selectMorningReport(…, { includeRunway: false })`) and `save` (the snapshot, stored by the main
  thread in localStorage); the 180-day `runway` + overall health follow in a separate message once
  nothing newer is pending, so the report shows "calculating…" first. State changes are rejected
  while an advance runs; `stop` interrupts it after the current day. The Desk also marks an
  advance pending as soon as it sends one, so a double ring cannot advance twice.
- **Save safety (M2)**: the stored save carries the `stateHash` its replay must reach. A save that
  cannot be restored (refused replay, malformed log, hash mismatch, unreadable JSON) starts a new
  game; the `ready` message says so before the first `save`, and the Desk copies the old save to
  `ceo-room.save.v1.bak` first. Any exception in the worker (or a worker that fails to load) posts
  / raises `fatal`: the Desk shows an error slip whose New game restarts the worker with no save.
- **Dossier on the Desk** reads `selectDecisionSummary` (no projection, no impacts), re-read after
  state changes but not during an advance; the runway row is the live projected runway.
- **Decision Room in the worker (M3)**: requests `openRoom {decisionId}`, `closeRoom` and
  `previewCustom {requestId, decisionId, commands}`; decisions themselves go through `dispatch`
  (`approveOption`, `rejectDecision`, `requestAnalysis`, `customDecision`). While a room is open the
  worker posts `room {decisionId, version, view}` after every state change, in the background after
  the runway and **never during an advance** (one view when it ends). The view (`RoomView`) is built
  from `selectDecision` (+7 / +30 impacts, `analysis.extended` +7 / +30 / +90 once ready),
  `selectAdvisorBrief` (CFO, COO), `selectProjectedRunway` and a `MemoCatalog` (the allow-listed
  instructions' choices and `COMMAND_LIMITS`), memoised per report version and decision.
  `customPreview {requestId, version, status: ready | closed | busy, preview}` carries
  `previewCustomDecision` (the engine's CommandError in `preview.impact.error`). The store shows a
  room view or memo preview only when its `version` equals the report version on the desk, so
  figures for another day are never shown ("calculating…" until the current one arrives). While
  the Desk is in front the store sends `closeRoom` (the room stays behind its tab) and on return
  `openRoom` again, so the room and an open memo's preview are recalculated once, not after every
  day. Closing the memo drops its preview (`cancelPreview` drops one still queued; a newer
  `previewCustom` also supersedes an older queued one).
- **Seal and stamp (M3)**: the decision command is sent at the press; the seal / stamp coming down
  (650 ms, none with reduced motion) is only drawn. When the engine has answered, the room keeps
  its last view in front (`room.leaving`) until the press is down, then gives way to the Desk. The
  room tabs are aria-disabled while a decision is being sent. Controls that cannot act are
  aria-disabled rather than disabled so focus is kept (and found again after the figures are
  recalculated); focus moves to the options on opening and to
  the Desk (carbon copy, else the decision's telegram or folder, else the report) on closing.
- **Archive Room (M4a)**: `apps/web/src/archive/`. A second worker (`archive.worker.ts`, started on
  first use) reads and writes xlsx with **read-excel-file** / **write-excel-file** (MIT, maintained,
  fflate-based, their DOM-free "universal" builds) through `src/xlsx/xlsx.ts` (Workbook ⇄ bytes; ISO
  dates in template date columns ⇄ real Excel dates). Requests: `template {lang, example}`,
  `inspect {bytes}` (read + `validateWorkbook`; unreadable files answer `notXlsx | corrupt | empty |
  tooLarge`), `build {workbook}` (`toSeedBundle`: NOVARA's storyline profile when the file is the
  sample's own data, else `GENERIC_PROFILE`), `reportFile {report, lang, xlsx|csv}` (`reportRows`)
  and `browse {company, workbook}` (`analyseWorkbook` → the drawers' tables; the sample is read
  through its own filled template). The engine worker's `init` takes an optional `bundle`: My
  company. The store (`store/archive.ts`) keeps the inspection, the drawers, the downloads and the
  confirmations (replace, remove); `useGame` keeps `company`, `myCompany` and `view: 'desk' | 'room' |
  'archive'` (the Archive Room tab is always there; auto-play waits while it is in front). In My
  company mode the header, calendar and report print real dates (`selectCalendarDay` / `report.date`)
  and every day after Day 1 carries a "Tahmin / Forecast" label (header, calendar, report, Decision
  Room).
- **Ledger slip (M3)**: after every state change the worker reads the new part of the ledger for
  `DecisionResolved` and, when a newer decision closed (approved, rejected, expired, or restored
  from a save), posts `ledgerSlip`: that line and every line it caused (by command id or event
  chain, `RngAdvanced` left out), each with its cause, plus the counterparty of every order and
  purchase order it names (`parties`). The carbon copy prints no raw ids: decisions by number,
  instructions by name, orders / purchase orders by number and customer / supplier. The Desk keeps
  it as a carbon copy that opens
  by itself after a decision taken in the room.
