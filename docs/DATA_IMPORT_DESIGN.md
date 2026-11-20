# Data import design: running the engine on a real company

Status: **4a part 1 built** (import core, `packages/import`; refinements in §8). Archive Room UI next;
4b / 4c design only (see ROADMAP).

## 1. Goal

Run the **same deterministic engine** on a real company's data instead of NOVARA.

- **Day 1 = the snapshot date** of the imported data (e.g. 2027-01-31). The calendar shows real
  dates; `SimDay` stays an integer offset from the snapshot (Day 1 = snapshot date).
- **Advancing time becomes a forecast.** Every figure after Day 1 is a projection from the
  imported position plus the engine's rules, labelled *forecast* / *tahmin*, never presented as
  actuals.
- Nothing in the engine changes per source: import produces a `SeedBundle` and goes through
  `CompanyDataSource` (ADR-0006). The engine never knows whether data is simulated or real.
- The sample company (NOVARA) stays available at all times.

## 2. Excel template (`ceo-room-template-v1.xlsx`)

One sheet per entity, plus `README` (instructions, TR + EN) and `Settings`. Row 1 = column keys
(machine names, fixed), row 2 = TR/EN labels, row 3 = units, data from row 4. Two example rows
pre-filled (greyed, deleted by the user). Dropdowns (Excel data validation) for enums and ids
from other sheets.

**Conventions:** money in **TRY with up to 2 decimals** (converted to integer kuruş); percentages
as **percent** (`8` = 8%, converted to bps); dates as Excel dates or `YYYY-MM-DD`; quantities
decimal allowed only where marked; ids are the company's own codes (text, unique per sheet).
Required columns marked **(R)**.

### Settings
| key | type | unit | notes |
|---|---|---|---|
| company_name (R) | text | | shown on the report |
| snapshot_date (R) | date | | becomes Day 1 |
| currency (R) | enum | | `TRY` (others later) |
| city | text | | |
| labour_cost_per_line_hour (R) | money | TRY/h | used in order costing |
| energy_cost_per_line_hour | money | TRY/h | default 0 |
| overtime_rate_per_person_hour | money | TRY/h | default 1.5 × labour/person |
| max_overtime_hours_per_line_day | number | h | default 3 |

Example: `Örnek Makina A.Ş.`, `2027-01-31`, `TRY`, `Konya`, `1450`, `210`, `385`, `3`.

### Customers
| column | type | unit | |
|---|---|---|---|
| customer_id (R) | text | | |
| name (R) | text | | company name only, no personal data |
| country (R) | ISO-2 | | |
| segment | enum | | automotive, rail, energy, agri, other |
| key_account | bool | | |
| payment_terms_days (R) | int | days | contractual |
| avg_payment_delay_days | int | days | default: derived from receivables history if given, else 0 |
| discount_pct | percent | % | standing discount |
| annual_revenue | money | TRY | last 12 months |
| satisfaction_score | number | 0–100 | optional; default 75, flagged *estimated* |

Example: `C-0012`, `Anadolu Raylı A.Ş.`, `TR`, `rail`, `TRUE`, `90`, `12`, `0`, `48 500 000`, *(blank)*.

### Suppliers / SupplierPrices
`Suppliers`: supplier_id (R), name (R), country (R), payment_terms_days (R), deposit_pct,
on_time_delivery_pct (→ reliabilityBps, default 95), established (bool, default TRUE).
`SupplierPrices` (one row per supplier × material): supplier_id (R), material_id (R),
unit_price (R, TRY per material unit), lead_time_days (R).

### Products / BOM
`Products`: product_id (R), name (R), unit_price (R, TRY), minutes_per_unit (R, line minutes),
plant_ids (R, comma list). `BOM`: product_id (R), material_id (R), qty_per_unit (R, decimal).

### Materials (inventory)
material_id (R), name (R), unit (R: kg/pcs/set), stock_qty (R), stock_value (R, TRY),
safety_stock, reorder_lot_size, preferred_supplier_id (R).

### OpenOrders (sales)
order_id (R), customer_id (R), product_id (R), plant_id (R), qty (R), unit_price (R, TRY,
after discount), list_unit_price (TRY, default = unit_price), order_date (R), requested_date (R),
promised_date (default = requested), payment_terms_days (default = customer's),
status (R: registered / in_production / shipped_not_invoiced).

### OpenPurchaseOrders
po_id (R), supplier_id (R), material_id (R), qty (R), unit_price (R), order_date (R),
due_date (R, confirmed delivery), deposit_paid (TRY, default 0), payment_terms_days
(default = supplier's), for_order_id (optional link to a sales order).

### Receivables / Payables
`Receivables`: receivable_id (R), customer_id (R), amount (R, TRY, open balance), invoice_date
(R), due_date (R), order_id (optional). `Payables`: payable_id (R), counterparty_id (R, supplier
id or a cost code), amount (R), due_date (R), po_id (optional).

### Cash
account (R, free text, e.g. "Bank A TRY"), balance (R, TRY at snapshot). Summed into cash.
No account numbers / IBANs (rejected by validation).

### FixedCosts
cost_id (R), kind (R: payroll / payroll_tax / overhead / utilities / debt_service / other),
amount (R, TRY), every_days (R: 7 / 30 / 90 / 365), next_due_date (R).

### Capacity (lines)
line_id (R), plant_id (R), plant_name (R), line_type (R), shifts_per_day (R), hours_per_shift (R),
status (running / down, default running), repair_due_date (if down).

### Workforce (department totals only)
department (R: sales / operations / procurement / finance / people / cx), headcount (R),
avg_monthly_cost_per_head (R, TRY), monthly_turnover_pct (last 12 months average),
overtime_hours_last_month. **No names, IDs, salaries per person or any personal data.**

### History (optional, improves trends)
period_end (R), revenue (R), cogs, avg_satisfaction, overtime_person_hours. Last 2–12 months.

## 3. Validation

Three levels, run entirely in the browser (Web Worker) before anything is stored:

1. **Structure:** template version (`README!B1`), required sheets and columns present,
   no unknown required-column renames, row count limits (e.g. ≤ 5 000 rows per sheet).
2. **Field:** types, units, enums, dates parse, non-negative money/qty, percent 0–100,
   ids unique, text length limits, **privacy guard** (rejects columns or values that look like
   TCKN, IBAN, phone, e-mail, person names in `Workforce`).
3. **Cross-sheet and business rules:** foreign keys resolve (order → customer/product/plant,
   PO → supplier/material, BOM → material, SupplierPrices exist for every preferred supplier);
   dates vs snapshot (order_date ≤ snapshot; due dates may be past = overdue, warned);
   every product has a BOM and ≥ 1 line in a listed plant; stock_value / stock_qty plausible
   vs supplier price (warn > ±50%); totals sanity (receivables vs annual revenue, cash ≥ 0 or
   warned overdraft); capacity: open-order minutes vs line hours (warn > 150% next 90 days).

**Severities:** `error` blocks import; `warning` imports with a note; `info` (defaults applied).
Defaults applied are listed so the CEO knows which figures are estimates.

**Error report format** (JSON, rendered on paper in the Archive Room and downloadable as CSV/XLSX):

```json
{
  "templateVersion": 1,
  "snapshotDate": "2027-01-31",
  "summary": { "errors": 2, "warnings": 5, "info": 11, "rows": { "OpenOrders": 23 } },
  "issues": [
    { "severity": "error", "code": "import.fk.missing",
      "sheet": "OpenOrders", "row": 7, "column": "customer_id",
      "value": "C-0099", "params": { "target": "Customers" } },
    { "severity": "warning", "code": "import.stockValue.implausible",
      "sheet": "Materials", "row": 4, "column": "stock_value",
      "params": { "expected": "≈ 1 820 000", "deviationPct": 64 } }
  ]
}
```

Codes are i18n keys (`import.*`, TR + EN) like every other engine/UI message; cells are referenced
as Excel users see them (`OpenOrders!C7`).

## 4. Mapping into `CompanyDataSource`

New adapter `TemplateDataSource` (package `packages/import`, pure, no engine changes needed
except the small model additions below):

`parse (SheetJS) → raw rows → validate → normalise → SeedBundle → CompanyDataSource.load()`

| Template | `SeedBundle` | Conversion |
|---|---|---|
| Settings | `company.company`, `company.settings` | `simulated: false`, `snapshotDate`, `source: 'import'` |
| Customers | `customers` | % → bps, score 0–100 → `Score` (×100); `demand` = derived from History/OpenOrders cadence, flagged *estimated* (or none) |
| Suppliers + SupplierPrices | `suppliers[].offers` | on-time % → `reliabilityBps` |
| Products + BOM | `productFamilies[]` | price → kuruş |
| Materials | `materials` | |
| OpenOrders | `orders.salesOrders` | dates → `SimDay = days(date − snapshot) + 1`; status mapped; `plan` recomputed by the engine's pipeline on load |
| OpenPurchaseOrders | `orders.purchaseOrders` | `delayDays = 0` (no hidden delay for real POs) |
| Receivables / Payables | `finance.receivables/payables` | `source: 'opening'`; `expectedPayDay = dueDay + customer delay` |
| Cash | `finance.cash` | sum |
| FixedCosts | `finance.recurringCosts` | `other` → `overhead` |
| Capacity | `plants`, `lines` | |
| Workforce | `workforce`, `departments` | head names left empty (no personal data) |
| History | `finance.history` | |
| — | `eventCards`, `departments` | from the import **profile** (§8): `GENERIC_PROFILE` = data-driven cards only (cash squeeze, operations turnover); `NOVARA_PROFILE` = the sample storyline |

**Model changes required (small, in 4a):** `Company.simulated: boolean` (today a literal `true`),
`Company.snapshotDate?: string` (UI maps SimDay → real date), `Company.source: 'seed' | 'import'`,
`settings` defaults for fields a real company cannot know (`turnoverBpsPerOvertimeHourPerHead`,
`mrpCoverDays`) taken from `config/tuning.ts` and listed in the report as *assumed*.
The import is deterministic: same file → same `SeedBundle` → same state hash.

## 5. The Archive Room (Arşiv Odası)

Cinematic, same visual rules as the Desk: a records room with oak filing cabinets, card-index
drawers, brass label holders and a green-shaded reading lamp.

- **Template:** a printed form in a pigeonhole, "Download template / Şablonu indir" (xlsx,
  generated client-side, TR/EN headers).
- **Upload and validate:** drop the file on the blotter (or click to browse). Validation runs in
  a worker; the result comes back as a **typed inspection report** on paper: red ink stamps for
  errors (cell references, plain-language fix), amber for warnings, pencil notes for defaults.
  Import is enabled only with zero errors; it shows "Imported as forecast from 31 Ocak 2027".
- **Browse imported data:** card-index drawers per entity (Customers, Suppliers, Orders…) with
  ledger-style tables, search, and figures in Courier Prime. Read-only.
- **Data sources:** a register book listing each source (Excel upload, later ERP/bank) with
  last-updated date, snapshot date, row counts, who uploaded (4b), and validation status.
- **Company switch:** a brass two-way switch "Örnek şirket (NOVARA) / Şirketim (My company)".
  Each company has its own save game and ledger; switching never mixes data.
- Banner on every room when a real company is loaded: "Forecast from snapshot DD.MM.YYYY".

## 6. Phases

- **4a: Excel import, local only.** Template, validation, Archive Room, `TemplateDataSource`,
  stored only in the browser (IndexedDB), never uploaded. Company switch.
- **4b: Supabase.** Auth (e-mail magic link / SSO later), `workspace_id` on every row with
  Postgres **Row Level Security** per workspace, roles (owner, viewer), encrypted at rest, audit
  log of imports, EU region hosting, data export + delete-my-workspace. Save games and imports
  sync across devices.
- **4c: Connectors.** ERP adapters for **Logo, Netsis, Mikro** (read-only; via their export/APIs
  or an on-prem agent where needed) and **bank API** connectors (Turkish open-banking / bank
  statement APIs) for cash and receivable/payable status. Each connector is just another
  `CompanyDataSource` that produces the same `SeedBundle`, run through the same validation.
  Scheduled refresh updates the snapshot date.

## 7. Privacy and consent

- **No personal employee data:** workforce only as department totals; the privacy guard rejects
  personal identifiers anywhere in the file. Customer/supplier records are companies.
- **Local first:** in 4a nothing leaves the browser.
- **LLM consent:** before any imported data is sent to an LLM (Milestone 6+), an explicit,
  per-workspace consent stating what is sent (selector outputs only, department-scoped, never raw
  sheets), to which provider, and retention. Off by default; revocable; every LLM call logged.
  Sample company data needs no consent.
- KVKK/GDPR: data minimisation, purpose limitation (simulation only), deletion on request,
  processing record in 4b.

## 8. As built (M4a part 1, `packages/import`)

API and full column list: `packages/import/README.md`. Refinements of §2–§4:

- **Neutral workbook model** (`Record<sheet, Cell[][]>`), no xlsx library in the core; the UI reads
  and writes the files. Dates are accepted as ISO text, `DD.MM.YYYY` or Excel serials.
- **Sheets:** a `Plants` sheet (plant_id, name, city, headcount, product_ids) replaces `plant_name` in
  Capacity and `plant_ids` in Products; an optional **`Demand`** sheet (customer, product, qty_min,
  qty_max, interval_days, lead_days, next_order_date) mirrors `Customer.demand` so the sample round-
  trips. Settings gains `overtime_crew_per_line` and `mrp_cover_days`; Customers gains
  `churn_risk_pct`; Suppliers gains `onboarding_days`; OpenOrders gains progress columns
  (`units_done`, `minutes_done`, `material_cost_to_date`, `energy_cost_to_date`) and its status is
  `scheduled | in_production` (shipped-not-invoiced belongs in Receivables); Receivables gains
  `expected_payment_date`; History gains `closing_cash`. Dropped: Receivables.order_id,
  Payables.po_id, Workforce.overtime_hours_last_month; Payables use `supplier_id` (cost codes go to
  FixedCosts).
- **BOM quantities are whole numbers** (the engine's material units are integers); a fraction is an
  error (`import.field.notInteger`): use a smaller unit.
- **History periods** are ranked: the latest `period_end` (≤ snapshot) is period 0, the one before
  −1, …; the engine's periods are 30-day blocks from Day 1.
- **Invoices dated after the snapshot** are a warning, not an error (the balance is open either way).
- **Profiles** supply what a template cannot carry: company id and name key, `periodLengthDays`,
  `runwayHorizonDays`, `turnoverBpsPerOvertimeHourPerHead`, label keys, departments (head names and
  notes) and event cards. `GENERIC_PROFILE` departments have no head names (no personal data) and
  only condition-triggered cards (`cashBelow` one month of fixed costs, `turnoverAbove` max(4%,
  2 × base)); late payment and capacity strain need new engine triggers (M4).
- **Engine model:** `Company.simulated: boolean`, `Company.source`, `Company.snapshotDate`, derived
  `Company.day1Weekday` so the work calendar follows the real weekday of the snapshot date (a Sunday
  snapshot runs no production on Day 1); optional plain labels `name` / `kindName` beside the i18n
  keys (`company.imported`, `product.imported`, `material.imported`, `line.imported`,
  `segment.general`). `selectCalendarDay`, `isForecastDay`, `simDayToDate`, `dateToSimDay`; the
  morning report has `date` and `forecast`. NOVARA's state is unchanged apart from the new company
  fields.
- **Acceptance:** NOVARA → template (tr or en) → validate (0 errors) → `toSeedBundle(NOVARA_PROFILE)`
  rebuilds the seed bundle byte for byte apart from `source` / `snapshotDate`; the engine's Day-1 and
  Day-31 (same commands) states hash identically after normalising the company record.

