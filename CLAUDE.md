# THE CEO ROOM — working notes for Claude Code

Source of truth: `CEO_ROOM_CLAUDE_CODE_PROMPT.md` (product spec). Visual reference: `design/`.
Architecture and model: `docs/`. Decisions: `docs/adr/`. When these disagree, the spec wins
unless an accepted ADR says otherwise.

**Current phase:** Phase 0 (docs only). No application code until the user approves.

## Principles (non-negotiable)

1. **The engine owns every number.** `packages/engine` is a deterministic, pure TypeScript
   simulation. UI and (later) LLM only read engine state through typed selectors/tools. The LLM never
   creates or alters a financial or operational figure.
2. **One company state.** Every figure on screen is derived from `CompanyState`. No hard-coded values
   in UI, no "display-only" numbers.
3. **Done = interactive and state-changing.** No fake buttons, no static mock-ups shipped as features.
4. **Swappable data.** The engine loads through `CompanyDataSource`. V1 = `SeedDataSource`
   (`data/seed/*.json`). No real-data import yet.
5. **i18n from day one.** `tr` and `en`; no user-facing string literals in components. Currency TRY,
   configurable.
6. **`workspaceId` on every record.** No tenancy UI.
7. **Low token cost.** Small seed files, no LLM-generated data, LLM features optional and cached.

## Determinism rules (engine)

- No `Date.now()`, `Math.random()`, `new Date()` or I/O inside `packages/engine`. Time is `SimDay`
  (integer), randomness comes from the seeded RNG streams passed in state.
- Money is **integer kuruş** (`Money` branded number). Never floats for money. Percentages are basis
  points (`Bps`, integer).
- State changes only through `Command → Event[] → reduce`. Every event is appended to the ledger
  with a `cause` (the command, rule or event that produced it).
- Same seed + same commands = byte-identical state. A test enforces this.

## Repository layout (planned)

```
CEO_ROOM_CLAUDE_CODE_PROMPT.md   product spec (source of truth)
CLAUDE.md                        this file
design/                          Claude Design export (reference only, placeholder numbers)
docs/                            ARCHITECTURE, DOMAIN_MODEL, SIMULATION_DESIGN, ROADMAP, adr/
data/seed/*.json                 static seed (generated once by scripts/generate-seed.ts, fixed seed)
packages/engine/                 pure simulation (no React, no LLM, no DOM)
packages/i18n/                   tr/en message catalogues + number/currency formatting
apps/web/                        React + Vite + Tailwind + Zustand UI
scripts/                         seed generator, tooling
.claude/agents/                  simulation-engineer, test-writer, code-reviewer
```

## Commands (will exist after Milestone 1; pnpm workspaces)

```
pnpm install
pnpm test               # vitest, all packages
pnpm --filter engine test
pnpm seed               # regenerate data/seed (only when the seed design changes)
pnpm dev                # web app
pnpm e2e                # playwright, main CEO journey
pnpm lint && pnpm typecheck
```

## Conventions

- TypeScript strict, ESM. No `any` in engine. Named exports.
- Engine modules: `model/` (types), `systems/` (one per subsystem, pure functions of state+day+rng),
  `commands/`, `events/`, `rules/` (event cards, advisor rules), `projection/` (forward runs),
  `selectors/` (read models for UI and advisors).
- Tests next to code (`*.test.ts`). Every decision option needs a test proving it changes state.
- UI: one component per physical object (`TypedReport`, `Telegram`, `BrassGauge`, `WaxSeal`,
  `LedgerBook`…). Components receive selector output, never raw state mutation.
- Commits: small, imperative subject, reference the milestone (`M1: …`).
- Keep diffs focused; don't regenerate seed data or reformat unrelated files.

## Visual direction (reference images are NOT in the repo)

The office is a **frame from a mid-century period film / an oil painting of an executive's private
office**, never a digital dashboard.

- **Light:** one warm tungsten pool on the desk (amber, ~2700K), falling off into deep brown-black
  at the edges. Chiaroscuro. Soft vignette and fine film grain over everything. Highlights warm, never
  pure white; shadows warm, never pure black or blue.
- **Materials:** dark mahogany and walnut wood with visible grain, oxblood/burgundy leather and
  ribbons, bottle-green felt and folders, polished but aged brass, cream paper yellowed at the edges,
  ink-black type. Night-blue only as a rare accent (a railway-carriage window at night).
- **Information as objects:** morning report = typed sheet with a paperclip and fold line; developments
  = telegram forms stacked at an angle; KPIs = ledger lines with dotted leaders and brass dial gauges;
  pending decisions = manila / oxblood / green folders; options = pinned memo notes; approvals = wax
  seal you press; history = bound ledger; company map = framed engraved map; day = tear-off calendar
  leaf; advance time = brass desk bell.
- **Type:** Playfair Display for headings, Cormorant Garamond italic for hand-written notes, Courier
  Prime for reports and **all figures** (crisp, tabular, large enough to read).
- **Motion:** slow and tactile: paper slides in, pages turn, lamp flickers faintly, seal presses down.
  No glows, bounces or flashy transitions. Respect `prefers-reduced-motion`.
- **Forbidden:** neon, holograms, glassmorphism, sci-fi HUD, gradients-as-decoration, emoji, stock
  photos, copying any film frame/character/poster. All artwork original CSS/SVG/procedural.
- **Readability beats atmosphere:** text contrast ≥ 4.5:1, figures never decorative, every action
  reachable by mouse and keyboard, touch targets ≥ 44px.

## Working rules

- Read `docs/ROADMAP.md` for the current milestone and its acceptance criteria before coding.
- After each milestone: app runs, tests pass, behaviour preserved, ADR/notes updated, report
  done vs outstanding, then wait for approval.
- Use sub-agents: `simulation-engineer` (engine work), `test-writer` (tests), `code-reviewer`
  (review before commit).
