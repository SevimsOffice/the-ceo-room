# ADR-0002: A deterministic, pure engine owns all numbers

- Status: Accepted
- Date: 2026-11-18

## Context
The spec forbids hard-coded dashboard values and LLM-invented figures, and requires
reproducible, testable consequences.

## Decision
- `packages/engine` is pure TypeScript with no DOM, React, LLM or I/O dependencies.
- All randomness comes from a seeded PRNG with named streams stored in state; `Math.random`
  and `Date` are banned in the engine (lint + test).
- UI, advisors and any future LLM read state only through selectors and tools.
- Option impacts are computed by running the same engine forward on a cloned state (`project()`).

## Consequences
+ Same seed + commands → identical state; easy golden tests and replayable saves.
+ Preview numbers and actual outcomes use one code path.
− Every displayed metric needs a selector; no shortcuts in the UI.
