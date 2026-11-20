# ADR-0008: Data import core (Milestone 4a, part 1)

- Status: Accepted
- Date: 2026-11-20

## Context
docs/DATA_IMPORT_DESIGN.md asks for the same deterministic engine to run on a real company imported
from an Excel template, Day 1 = the snapshot date, later days a forecast, with no engine behaviour
per source.

## Decision
- New pure package `packages/import` on a neutral workbook model (`Record<sheet, Cell[][]>`); no xlsx
  library in the core. `exportTemplate`, `validateWorkbook` (report in the design's JSON shape),
  `toSeedBundle` (only without errors), `TemplateDataSource` (ADR-0006).
- **Profiles** carry what a template cannot: identity, a few engine settings, department narrative,
  label keys, event cards. `NOVARA_PROFILE` (storyline), `GENERIC_PROFILE` (condition-triggered cards).
- **Engine:** `Company.simulated: boolean`, `source`, `snapshotDate`, derived `day1Weekday`; the work
  calendar uses the snapshot's real weekday. Seeds may omit the new fields. Civil-date arithmetic is
  integer-only (`model/calendarDate.ts`); no host clock.
- **Labels:** keep the i18n key fields (`nameKey`, `kindKey`) and add optional plain labels (`name`,
  `kindName`) with generic keys (`*.imported`); numeric behaviour is unchanged and the UI shows
  `name ?? t(nameKey)`.
- Import messages and template texts are `import.*` codes in the tr/en catalogues, checked by the
  import package against `listImportCodes()`.

## Consequences
+ NOVARA round-trips through the template byte for byte (bundle) and hash for hash (engine state).
+ Same workbook → same report → same bundle → same state hash.
− The golden Day-31 hash moved (new company fields only; a test proves the rest is unchanged).
− BOM quantities must be whole numbers; history months map to 30-day periods by rank.
− Late-payment and capacity-strain cards for real companies need new engine triggers (M4).
