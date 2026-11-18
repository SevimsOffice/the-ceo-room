# ADR-0003: pnpm workspace monorepo, TypeScript strict

- Status: Proposed
- Date: 2026-11-18

## Context
The engine must stay independent of the UI, and later the AI layer, while sharing types.

## Decision
pnpm workspaces: `packages/engine`, `packages/i18n`, `apps/web`, `scripts/`. TypeScript strict,
ESM, Vitest for unit/integration tests, Playwright for e2e, ESLint + Prettier. Web: React +
Vite + Tailwind + Zustand.

## Consequences
+ Engine can be tested and versioned alone; the UI cannot reach into engine internals.
− Slightly more setup than a single package.
