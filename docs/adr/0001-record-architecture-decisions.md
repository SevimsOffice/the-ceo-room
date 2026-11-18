# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-11-18

## Context
The project spans many milestones and sessions; decisions must survive context resets.

## Decision
Use lightweight ADRs in `docs/adr/NNNN-title.md` (Context, Decision, Consequences). Status is
`Proposed` until the user approves, then `Accepted`; superseded ADRs link to their replacement.

## Consequences
Claude Code reads ADRs before changing architecture. A change that contradicts an accepted ADR
needs a new ADR first.
