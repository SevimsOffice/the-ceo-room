# ADR-0004: Money in integer kuruş, rates in basis points, time in SimDay

- Status: Accepted
- Date: 2026-11-18

## Context
Floating-point money causes drift and non-deterministic rounding across long runs.

## Decision
- `Money` = integer minor units (kuruş) of the company currency (TRY), branded type.
  Max safe value (~9×10^13 TRY) is far above our scale.
- Percent/rates = integer basis points (`Bps`). Rounding: banker's rounding in one helper.
- Time = `SimDay` integer; Day 1 is a Monday. No calendar dates inside the engine; the UI maps
  SimDay to labels.
- Formatting (`76,4 milyon TL` / `76.4 M TL`) lives only in `packages/i18n`.

## Consequences
+ Exact, deterministic arithmetic; locale formatting isolated.
− Helpers needed for multiplication/division of Money by rates.
