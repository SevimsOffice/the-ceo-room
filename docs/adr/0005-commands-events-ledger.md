# ADR-0005: Commands → events → reducer, with an append-only ledger

- Status: Accepted
- Date: 2026-11-18

## Context
The spec requires an event ledger that explains why every state exists, and proof that
decisions change state.

## Decision
- The only write path is `dispatch(command)` and the daily tick. Both produce `Event`s, which
  are reduced into `CompanyState` and appended to the ledger with a `cause` (command id, rule id
  or parent event).
- Events carry i18n codes + params, never sentences.
- Save game = seed version + RNG seed + command log; load = replay. Snapshots optional later.

## Consequences
+ Full causality for the Ledger room and for advisor citations; easy assertions in tests.
− Reducers must stay pure and fast; very long games may need snapshots.
