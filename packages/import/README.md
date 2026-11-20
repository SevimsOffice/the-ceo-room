# @ceo-room/import

Excel template import, pure core (Milestone 4a, docs/DATA_IMPORT_DESIGN.md). No DOM, no I/O, no
clock, no randomness: same workbook → same report → same `SeedBundle` → same engine state hash.
Library-free: it works on a **neutral workbook model**; the UI picks the xlsx reader/writer.

```ts
type Cell = string | number | boolean | null;
type Workbook = Record<string, Cell[][]>;   // sheet → rows; rows[0] = Excel row 1, cells[0] = column A
```

Dates may arrive as ISO strings (`2027-01-31`, optionally with a time), `DD.MM.YYYY` text or Excel
serial numbers (1900 system); numbers as numbers or text (`1250,50`, `48 500 000`, `41.200.000,00`, `1,250.50`; a single dot
or comma before exactly three digits, `1.250`, is `import.field.ambiguousSeparator`); booleans as booleans, `TRUE/FALSE`, `EVET/HAYIR`,
`DOĞRU/YANLIŞ`, `1/0`. `isoToExcelSerial(iso)` helps writers that want real Excel dates.

## API

```ts
import {
  exportTemplate, validateWorkbook, toSeedBundle, TemplateDataSource, reportRows, canImport, cellRef,
  NOVARA_PROFILE, GENERIC_PROFILE, TEMPLATE, TEMPLATE_VERSION, listImportCodes,
} from '@ceo-room/import';

// 1. Template download (rows only; write them with any xlsx library)
exportTemplate(seed: SeedBundle, { lang: 'tr' | 'en', example: boolean, snapshotDate?: string }): Workbook
//   example: true  → filled with that company (the download example = NOVARA, Day 1 = 2027-01-04)
//   example: false → headers only. Sheet order: README, then TEMPLATE.sheets order.

// 2. Validation (run in the worker; nothing leaves the browser)
validateWorkbook(wb: Workbook, { snapshotDate?: string }): ImportReport
//   snapshotDate overrides Settings.snapshot_date (noted as info when they differ)

// 3. Import (re-validates; only builds a bundle when there are no errors)
toSeedBundle(wb, { workspaceId, profile: ImportProfile, snapshotDate? }):
  { ok: true; bundle: SeedBundle; report: ImportReport } | { ok: false; report: ImportReport }
createEngine(bundle, { rngSeed, workspaceId })              // as for the seed

new TemplateDataSource(wb, { profile }).load(workspaceId)   // CompanyDataSource; rejects with ImportFailedError(report)

// Report helpers
canImport(report): boolean                       // summary.errors === 0
cellRef(issue): string                           // 'OpenOrders!C7'
reportRows(report, lang, currency?): Cell[][]    // translated table for the CSV/XLSX download
analyseWorkbook(wb, opts): { report, sheets, snapshotDate }   // parsed rows in engine units (browse view)
```

### ImportReport (design §3, JSON)

```ts
{
  templateVersion: number | null,       // README!B1
  snapshotDate: string | null,          // effective Day 1
  summary: { errors, warnings, info, rows: { [sheet]: dataRows } },
  issues: [{
    severity: 'error' | 'warning' | 'info',
    code: 'import.…',                   // i18n key (tr + en in @ceo-room/i18n), params below
    sheet: string | null, row: number | null,           // Excel row (data from row 4)
    column: string | null, columnLetter: string | null, // column key (row 1) + letter
    value?: Cell,                       // the cell as read; never on a cell with a privacy hit or for over-long text
    params: Record<string, string | number | boolean>,
  }]
}
```

Render a message with `createTranslator(lang).t(issue.code, issue.params)`. Money params (`expected`,
`total`, `receivables`, `annualRevenue`) are kuruş and use the catalogue's `money` format.
`ISSUE_CODES` lists every code with its params; `listImportCodes()` adds the template texts.

### Profiles

A profile supplies what the template cannot carry (`ImportProfile`):

- `company`: id, i18n name key (or null → `company.imported` plus the plain `Company.name`),
  `seedVersion`, `simulated`.
- `settings`: `periodLengthDays`, `runwayHorizonDays`, `turnoverBpsPerOvertimeHourPerHead`.
- `labelKeys`: i18n keys for known product/material ids (others keep their plain `name`).
- `departments()`: department records (heads, notes); `eventCards(bundle)`: the cards.

`NOVARA_PROFILE` (built from the seed): storyline cards, department narrative, label keys. Applied to
another company's data it fails with `import.profile.mismatch`. `GENERIC_PROFILE` (real companies):
six departments without head names or notes, and data-driven cards only, using the engine's
condition triggers: `cashSqueeze` when cash falls below one month of fixed costs, `turnoverRising`
when operations turnover passes max(4%, 2 × base). No late-payment or capacity cards (no trigger
for them yet).

### Labels of imported records

Real companies have plain names. The engine records keep their i18n key fields and gain optional
plain labels, so numbers are untouched: `Company.name`, `ProductFamily.name`, `Material.name`,
`ProductionLine.kindName` (customer, supplier and plant names are already plain). Imported records
use the generic keys `company.imported`, `product.imported`, `material.imported`, `line.imported`
(and `segment.general`). **UI rule:** show `name ?? t(nameKey)` (`kindName ?? t(kindKey)`); a
`Directory` for the translator can map ids straight to the plain names (unknown keys print as they
are).

### Calendar (engine)

`Company.source` (`'seed' | 'import'`), `Company.snapshotDate` (ISO, null for NOVARA),
`Company.day1Weekday`. `selectCalendarDay(state, day?)` → `{ day, date, weekday, weekdayCode, workday,
forecast }`; the morning report carries `date` and `forecast` too. `simDayToDate(snapshotDate, day)` /
`dateToSimDay(snapshotDate, iso)` are pure integer civil-date helpers. Every day after Day 1 of an
imported company is a forecast (`isForecastDay`).

## Template v1

README (A1 `ceo_room_template_version`, B1 `1`, instructions, sheet list, data dictionary) and 18
sheets. Row 1 = keys (fixed), row 2 = labels (`(R)`/`(Z)` = required), row 3 = units, data from row
4. Units: money in TRY (≤ 2 decimals, banker's rounding to kuruş), `%` as percent (8 = 8% → 800
bps), scores 0–100 (→ hundredths), dates → SimDay with Day 1 = snapshot date.

| Sheet | Required columns | Optional columns (default) |
|---|---|---|
| Settings (1 row) | company_name, snapshot_date, currency (TRY), city, labour_cost_per_line_hour | energy_cost_per_line_hour (0), overtime_rate_per_person_hour (1.5 × labour ÷ crew), max_overtime_hours_per_line_day (3), overtime_crew_per_line (9, est.), mrp_cover_days (14) |
| Plants | plant_id, name, headcount, product_ids | city (company city) |
| Capacity | line_id, plant_id, line_type, shifts_per_day, hours_per_shift | status (running), repair_due_date |
| Products | product_id, name, unit_price, minutes_per_unit | |
| BOM | product_id, material_id, qty_per_unit (integer) | |
| Materials | material_id, name, unit (kg/pcs/set), stock_qty, stock_value, preferred_supplier_id | safety_stock (0), reorder_lot_size (1) |
| Suppliers | supplier_id, name, country, payment_terms_days | deposit_pct (0), on_time_delivery_pct (95, est.), established (TRUE), onboarding_days (0; 7 if not established) |
| SupplierPrices | supplier_id, material_id, unit_price, lead_time_days | |
| Customers | customer_id, name, country, payment_terms_days | segment (general), key_account (FALSE), avg_payment_delay_days (0), discount_pct (0), annual_revenue (0), satisfaction_score (75, est.), churn_risk_pct (10, est.) |
| Demand (opt.) | customer_id (one row each), product_id, qty_min, qty_max, interval_days, lead_days, next_order_date | |
| OpenOrders | order_id, customer_id, product_id, plant_id, qty, unit_price, order_date, requested_date | list_unit_price, promised_date (requested), payment_terms_days (customer's), status (scheduled / in_production), units_done (0), minutes_done, material_cost_to_date, energy_cost_to_date (derived) |
| OpenPurchaseOrders (opt.) | po_id, supplier_id, material_id, qty, unit_price, order_date, due_date | deposit (0), payment_terms_days (supplier's), for_order_id |
| Receivables (opt.) | receivable_id, customer_id, amount, invoice_date, due_date | expected_payment_date (due + customer delay) |
| Payables (opt.) | payable_id, supplier_id, amount, due_date | |
| Cash | account, balance (may be negative) | |
| FixedCosts | cost_id, kind (payroll / payroll_tax / overhead / utilities / debt_service / other), amount, every_days, next_due_date | |
| Workforce | department (sales / operations / procurement / finance / people / cx, unique), headcount, avg_monthly_cost_per_head | monthly_turnover_pct (1%, est.) |
| History (opt.) | period_end (unique), revenue, cogs | avg_satisfaction (customers' average), overtime_person_hours (0), closing_cash |

## Validation levels

1. **Structure:** README marker + version, required sheets/columns, duplicate or unknown columns,
   ≤ 5 000 data rows, minimum rows, one Settings row, unknown sheets (warning).
2. **Field:** types, integers, non-negative money (Cash balance and closing cash may be negative),
   ranges (percent/score 0–100, shifts 1–3, …), enums, ISO country codes, real dates, unique ids,
   text ≤ 120. **Privacy guard** (error, value never echoed): TCKN (check digits), IBAN (mod 97),
   e-mail, phone numbers in any text cell of any sheet (figures and dates are not scanned for TCKN or
   phone patterns); person-level column headers anywhere, any extra column in Workforce, and sheets
   outside the template with a personal name or header (`import.privacy.personSheet`). A percent
   column with only fractions (0.95) is a warning. `sanitiseWorkbook(wb)` gives the workbook as it
   may be kept: template sheets and known columns only.
3. **Cross-sheet:** foreign keys (incl. each id of `product_ids`), BOM per product, no duplicate BOM or
   price lines, preferred supplier quotes the material, every product made in a plant with lines,
   order plant makes the product, progress ≤ qty, Demand qty range, ≤ 24 h per line-day, dates vs the
   snapshot (orders/POs/history not after it: error; invoices after it, overdue items, past dues:
   warning), payroll row present (warning). Plausibility warnings: stock value vs quantity × preferred
   price (> ±50%), negative cash, receivables above annual revenue, open-order load > 150% of regular
   line hours over 90 days.
4. **Defaults** for blank optional cells: `import.default.applied` / `estimated` / `derived` per cell,
   `columnAbsent` once per missing column, `sheetAbsent` per missing optional sheet.

## Tests

`roundtrip.test.ts` (acceptance: NOVARA → template → import is byte-identical to the seed, Day 1 and
Day 31 engine states, Desk, decisions and advisor briefs equal; tr and en), `validate.test.ts` (one
block per rule family, asserting sheet/row/column/code), `realCompany.test.ts` (fixture in
`test/fixtures.ts`: imports, runs 30 days as a forecast, re-exports and re-imports identically,
determinism), `catalog.test.ts` (tr/en completeness), `workbook.test.ts`, `purity.test.ts`.
