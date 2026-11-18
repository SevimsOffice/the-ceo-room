# THE CEO ROOM — A Cinematic Business Simulation

Paste this into Claude Code in an empty repo named `the-ceo-room`. Use Opus for Phase 0 and Milestone 1, Sonnet afterwards.

---

## Role

You are a senior software architect, simulation engineer and product designer. Build THE CEO ROOM: the user steps into a CEO's private office and runs an entire company. They read the state of the business, receive developments, weigh options, decide, and see measurable consequences over time.

This is NOT an AI agent showcase, a chatbot dashboard, or a set of disconnected widgets. It models a company as an interconnected system.

## Product principles

1. A deterministic simulation engine owns every number. The LLM never invents or changes financial/operational figures. It may only explain and argue, through validated tools that read engine state.
2. Everything is derived from a single company state. No hard-coded dashboard values.
3. A feature is complete only when its interaction works and changes state. No fake buttons, no static mockups presented as features.
4. Data is swappable: the engine reads from a `CompanyDataSource` interface. V1 = pre-loaded simulated company. Real data import comes much later; do not build it now.
5. Turkish and English UI (i18n from the start). Currency default TRY, configurable.
6. Every record has a `workspace_id` (future multi-tenant). No tenancy UI yet.
7. Low token cost: no LLM-generated data, no large datasets, LLM features optional and cached.

## Visual direction — cinematic, painterly, NOT digital

The app must NOT look like a futuristic or digital-age dashboard. No neon, no holograms, no glassmorphism, no sci-fi HUD.

It should feel like a frame from a mid-century period film, or an oil painting of an executive's office:
- Warm tungsten lighting, deep shadows, soft vignette, subtle film grain.
- Mahogany and walnut wood panels, deep burgundy/oxblood, bottle green, brass, aged cream paper, ink black.
- Chiaroscuro: one warm pool of light on the desk, darkness at the edges.
- Information lives on physical objects: the briefing is a typed morning report on paper, developments arrive as telegrams/letters, KPIs are ledger entries and brass gauges, decisions are signed memos with a stamp or seal, the company map is a framed engraved map on the wall, the event history is a bound ledger.
- Typography: classic serif for headings (e.g. Playfair Display / Cormorant), typewriter or old-style serif for reports and figures. Numbers must still be crisp and readable.
- Motion: slow and tactile (paper sliding, page turns, lamp flicker). No flashy effects.
- Visual references are supplied by the user as mood only. Do not copy any film, character or copyrighted image; create original artwork and textures (CSS/SVG/procedural).
- If a design from Claude Design is provided in `design/` or as tokens, follow it.

Readability beats atmosphere: every screen must remain a usable business tool.

## Interaction — mouse first, gestures optional

- Primary input: mouse/touch and keyboard. Every action must work with a click.
- Optional "Camera mode" toggle (off by default), MediaPipe Hands + Face, kept deliberately simple:
  - Hand cursor: index fingertip moves a soft lamp-light cursor; hovering on an item for ~1 second (dwell) selects it. No pinch required.
  - Thumbs up = approve, thumbs down = reject (with an on-screen confirm).
  - Face (optional): head turn pans the office view slightly; nothing important depends on it.
- Gestures only trigger the same actions as buttons; they never have their own logic.
- If the camera is denied or unavailable, the app works fully without it.
- Gestures are a late milestone. Do not build them before the simulation works.

## Simulated company (pre-loaded, small but high-value)

NOVARA Industries, Bursa-based industrial manufacturer (fictional). Label all data "simulated".

Keep the dataset small and hand-sized, shipped as static seed files in the repo (`data/seed/*.json`), generated once by a deterministic script with a fixed seed. The app starts with this data already loaded, no setup screen.

Size:
- 6 departments: Sales, Operations/Manufacturing, Procurement & Supply Chain, Finance, People/HR, Customer Experience.
- 3 plants, ~180 employees (aggregated by department, not individual records).
- 6 key suppliers, 8 key customers (few, but large accounts).
- 4 product families.
- ~15 open orders with large values (roughly 2–25 million TRY each).
- Annual revenue around 900 million TRY, monthly cash position, receivables, payables, inventory by product family.
- 6–8 pre-written event cards (supplier price increase, key customer threatens to leave, machine breakdown, big export opportunity, turnover rising, cash squeeze, late payment from a big customer).

Each department: head (fictional name), KPIs, capacity/constraints, active tasks, risks, dependencies on others.

## Core simulation (must be real)

Simulation clock: advance day/week/month, pause. Event-driven, seeded RNG, fully reproducible. The event ledger explains why every state exists.

Cross-department workflow that must work end to end:
large order arrives -> Sales registers it -> capacity check -> material availability -> procurement need -> supplier lead time -> production cost -> cash flow and payment terms -> staffing/shifts -> delivery date -> customer commitment. A problem in any step propagates to the others.

## Vertical slice (Milestone 1 success criteria — build first)

1. CEO sees the morning report (current state).
2. A big customer order arrives.
3. Its effect on production, stock, procurement and cash is computed.
4. A supplier problem occurs.
5. CFO and COO give different, data-grounded recommendations (rule-based in V1; LLM later).
6. CEO decides.
7. Simulation advances 30 days.
8. CEO sees consequences, including a delayed one (looks good now, hurts cash in 30 days).

Prove with automated tests that decisions really change state.

## Rooms (build in this order)

1. The Desk — morning report (health, revenue, cash, backlog, satisfaction, turnover, critical developments, pending decisions).
2. Decision Room — situation, supporting figures, options, financial/operational/customer/people impact, short vs long term; approve / reject / ask for analysis / custom decision.
3. Scenario Study — current course vs scenario A vs B; 30/90/180/365-day projections ("what if we lose our biggest customer / raise prices 10% / supplier fails / add a shift / export to Germany").
4. Board Meeting — CFO, COO, CMO, CHRO, Risk; each sees only its department data, cites engine values, states assumptions; CEO decides.
5. Department offices (Operations, Finance, Sales, Supply Chain, People).
6. Wall map of the company (customers, suppliers, plants, flows).
7. The Ledger — simulation history.

## AI layer (later milestone, optional)

Provider-independent LLM adapter, structured outputs, department-scoped read-only tools, human approval for every state change, audit trail. Cache responses; the app must be fully usable with AI turned off (rule-based executives). Never expose API keys in frontend code.

## Tech stack

TypeScript. Simulation engine as a pure package (`packages/engine`) with no UI or LLM dependencies. Frontend: React + Vite + Tailwind + Zustand; charts styled to look hand-drawn/printed (Recharts or D3 with custom styling). Three.js only if it clearly adds value (not required). MediaPipe for optional camera mode. V1 runs fully in the browser with seed files and localStorage save; Supabase comes later. Tests: Vitest for engine, integration tests for workflows, Playwright for the main CEO journey.

## Working rules for Claude Code

- Phase 0 (no code): write `docs/ARCHITECTURE.md`, `docs/DOMAIN_MODEL.md`, `docs/SIMULATION_DESIGN.md`, `docs/ROADMAP.md`, first ADRs in `docs/adr/`. Explain the architecture and first workflow, then wait for my approval.
- Create `CLAUDE.md` with conventions, structure, commands and the principles above.
- Create sub-agents in `.claude/agents/`: `simulation-engineer`, `test-writer`, `code-reviewer`.
- Keep token use low: small seed files, no regeneration of data, focused edits.
- Milestones: 1 domain model + engine + seed data + vertical slice tests; 2 The Desk UI in the cinematic style; 3 Decision Room; 4 more workflows and departments; 5 Scenario Study; 6 Board Meeting (rule-based, then optional LLM); 7 wall map and ledger; 8 optional camera mode; 9 deployment.
- After each milestone: app runs, tests pass, existing behavior preserved, decisions documented, report done vs outstanding.
- Do not start with visuals. Start with Phase 0, then Milestone 1.
