# ADR-0006: CompanyDataSource interface with static seed files

- Status: Proposed
- Date: 2026-11-18

## Context
V1 ships a pre-loaded simulated company; real data import comes much later.

## Decision
- Engine loads a `SeedBundle` through `CompanyDataSource`. V1 = `SeedDataSource` reading
  `data/seed/*.json`, validated with a schema at load.
- Seed files are generated once by `scripts/generate-seed.ts` with a fixed seed and committed;
  they are not regenerated unless the seed design changes (token/cost rule).
- All seed records carry `workspaceId` and are labelled simulated.

## Consequences
+ App starts with data, no setup screen; swapping in a real source later touches one adapter.
− Seed schema changes need a seed version bump and save-game migration.
