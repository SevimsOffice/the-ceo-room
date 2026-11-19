# Roadmap

Each milestone ends with: app runs, tests pass, existing behaviour preserved, docs/ADRs
updated, a done-vs-outstanding report, and a stop for approval.

| # | Milestone | Acceptance criteria |
|---|---|---|
| 0 | **Phase 0: docs** *(done)* | CLAUDE.md, ARCHITECTURE, DOMAIN_MODEL, SIMULATION_DESIGN, ROADMAP, ADRs, sub-agents. Open questions answered. |
| 1 | **Domain model + engine + seed + vertical slice** *(done)* | pnpm monorepo; `packages/engine` with model, RNG, daily tick, order pipeline, supplier-price card, decision with 3 options, CFO/COO rules, `project()`; `data/seed` from `scripts/generate-seed.ts`; Vitest: determinism, invariants, spec steps 1–8, options produce different states, delayed cash effect. No UI. |
| 2 | **The Desk UI** *(done)* | React/Vite/Tailwind app renders morning report, telegrams, pending folders, capacity + projected-runway gauges, overall health, employee turnover, calendar, advance-day bell + week/month/pause brass dial, all from selectors; TR default with remembered TR/EN switch; self-hosted fonts; desktop ≥1280px scaled scene, smaller screens show a "best viewed on desktop" note; localStorage save/load; looks like `design/`. Order figures show live values with the plan alongside where they differ. Engine runs in a Web Worker (no UI freeze). Deployed to GitHub Pages by GitHub Actions. |
| 3 | **Decision Room** *(current)* | Opens from a telegram/folder; situation, supporting figures, options with today vs +30 deltas from `project()` incl. a people row (overtime/turnover); CFO/COO notes signed with fictional names ("Ayşe Kaya — CFO"); approve (seal), reject, request analysis, custom decision; state changes and ledger entries visible on the Desk. Playwright journey. |
| 4 | **More workflows & departments** | All 8 event cards live; breakdown, export, turnover, late payment, cash squeeze flows; department data complete. Negotiation outcomes with seeded uncertainty (success probability, range of settled prices). Breakdown re-plans promise dates. Probabilistic churn and lost-demand modelling. Forfeited deposits and other one-off losses in margin/P&L metrics. |
| 4a | **Real data: Excel import (local)** | Per `docs/DATA_IMPORT_DESIGN.md`: downloadable xlsx template (one sheet per entity, TR/EN), in-browser validation (structure, field, cross-sheet, privacy guard) with error report, `TemplateDataSource` → `SeedBundle`, Day 1 = snapshot date and time = forecast, Archive Room (Arşiv Odası) with browse, data sources register and NOVARA / My company switch. Data stays in the browser. Same file → same state hash. |
| 4b | **Real data: Supabase** | Auth, `workspace_id` + Row Level Security per workspace, roles, import audit log, EU hosting, export/delete workspace; saves and imports synced. |
| 4c | **Real data: connectors** | Read-only ERP adapters (Logo, Netsis, Mikro) and bank API connectors as `CompanyDataSource`s through the same validation; scheduled refresh. LLM use of imported data only with explicit per-workspace consent. |
| 5 | **Scenario Study** | Current course vs A vs B; 30/90/180/365 projections; printed-style charts. |
| 6 | **Board Meeting** | CFO, COO, CMO, CHRO, Risk with scoped data, citations, assumptions; rule-based; optional LLM adapter (cached, off by default, server-side keys). |
| 7 | **Wall map + Ledger** | Engraved map of plants/customers/suppliers/flows; bound ledger with filters and causes. |
| 8 | **Camera mode (optional)** | MediaPipe hand cursor with dwell select, thumbs up/down with confirm, optional head pan; off by default; app fully works without it. |
| 9 | **Deployment** | Static hosting build, CI (lint, typecheck, test, e2e), production hardening (Supabase arrives in 4b). |

## Carried over from Milestone 1

- Negotiation outcomes are deterministic → seeded uncertainty in **M4**.
- Press-line breakdown delays shipments but does not re-plan promise dates → **M4**.
- Churn is a deterministic threshold → probabilistic churn / lost demand in **M4**.
- Forfeited deposits are in the ledger only, not in margin/P&L → **M4**.
- Period-1 revenue is lumpy (+21% as the backlog ships) → revisit seed calibration in **M4**.
- Cold runway forecast ~260 ms → engine in a Web Worker in **M2**.
- New ledger/error codes need tr/en translations → **M2** (`packages/i18n`).

## Notes from Milestone 2

- E2E (`pnpm e2e`) runs the main journey on the built site with Playwright (Chromium) locally and
  in the Pages workflow.
- The scene is scaled to the window but never below 0.78 (a 1280×700 window; shorter windows
  scroll). Small print is 15.5 px and controls 57 px in the 1440×900 scene, so on screen text is
  ≥ 12 px and controls ≥ 44 px (e2e checks both).
- Telegrams with an open decision stay "new" until the Decision Room (M3) resolves them.

## Out of scope for now

Real data import, multi-tenant UI, accounts/auth, mobile layout beyond basic usability,
Three.js scenes.
