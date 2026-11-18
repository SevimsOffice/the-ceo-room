# Roadmap

Each milestone ends with: app runs, tests pass, existing behaviour preserved, docs/ADRs
updated, a done-vs-outstanding report, and a stop for approval.

| # | Milestone | Acceptance criteria |
|---|---|---|
| 0 | **Phase 0: docs** *(current)* | CLAUDE.md, ARCHITECTURE, DOMAIN_MODEL, SIMULATION_DESIGN, ROADMAP, ADRs, sub-agents. Open questions answered. |
| 1 | **Domain model + engine + seed + vertical slice** | pnpm monorepo; `packages/engine` with model, RNG, daily tick, order pipeline, supplier-price card, decision with 3 options, CFO/COO rules, `project()`; `data/seed` from `scripts/generate-seed.ts`; Vitest: determinism, invariants, spec steps 1–8, options produce different states, delayed cash effect. No UI. |
| 2 | **The Desk UI** | React/Vite/Tailwind app renders morning report, telegrams, pending folders, gauges, calendar, advance-day bell from selectors in both tr/en; localStorage save/load; looks like `design/`. |
| 3 | **Decision Room** | Opens from a telegram/folder; situation, supporting figures, options with today vs +30 deltas from `project()`; CFO/COO notes; approve (seal), reject, request analysis; state changes and ledger entries visible on the Desk. Playwright journey. |
| 4 | **More workflows & departments** | All 8 event cards live; breakdown, export, turnover, late payment, cash squeeze flows; department data complete. |
| 5 | **Scenario Study** | Current course vs A vs B; 30/90/180/365 projections; printed-style charts. |
| 6 | **Board Meeting** | CFO, COO, CMO, CHRO, Risk with scoped data, citations, assumptions; rule-based; optional LLM adapter (cached, off by default, server-side keys). |
| 7 | **Wall map + Ledger** | Engraved map of plants/customers/suppliers/flows; bound ledger with filters and causes. |
| 8 | **Camera mode (optional)** | MediaPipe hand cursor with dwell select, thumbs up/down with confirm, optional head pan; off by default; app fully works without it. |
| 9 | **Deployment** | Static hosting build, CI (lint, typecheck, test, e2e), optional Supabase persistence behind `CompanyDataSource`/save interface. |

## Out of scope for now

Real data import, multi-tenant UI, accounts/auth, mobile layout beyond basic usability,
Three.js scenes.
