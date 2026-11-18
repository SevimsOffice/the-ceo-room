# Domain model

Status: **Accepted** (2026-11-18). Every entity carries `workspaceId`. IDs are string-branded
(`CustomerId`, `OrderId`…). Money = integer kuruş (`Money`), rates = basis points (`Bps`),
time = `SimDay` (integer day index, Day 1 = Monday).

## Company structure

| Entity | Key fields | Seed size |
|---|---|---|
| `Company` | name (i18n key), city (Bursa), currency, fiscal settings, `simulated: true` | 1 (NOVARA) |
| `Department` | id (`sales`, `operations`, `procurement`, `finance`, `people`, `cx`), headName, headcount, monthlyCost, kpis, constraints, activeTasks, risks, dependsOn[] | 6 |
| `Plant` | id, name, lines[], shiftsPerDay, maxShifts, hoursPerShift, headcount, status | 3 |
| `ProductionLine` | id, plantId, productFamilies[], hourlyCapacity (units/h), status (`running`/`down`), repairDueDay? | ~2 per plant |
| `ProductFamily` | id, unitPrice, unitLaborHours, BOM: `{ materialId, qtyPerUnit }[]` | 4 |
| `Material` | id (steel, aluminium, components, packaging…), unit, stockQty, stockValue, safetyStock | ~4 |
| `Supplier` | id, materials[], unitPrice per material, leadTimeDays, paymentTermsDays, reliability (Bps), shareOfSpend | 6 |
| `Customer` | id, segment, country, paymentTermsDays, paymentDelayDays (behaviour), satisfaction (0–100), churnRisk (Bps), annualRevenue | 8 |
| `Workforce` (per dept) | headcount, monthlyTurnover (Bps), overtimeHours, avgCost | 6 rows (~180 total) |

## Operations

| Entity | Key fields |
|---|---|
| `Order` | id, customerId, productFamilyId, qty, unitPrice, value, receivedDay, promisedDay, status (`registered` → `scheduled` → `in_production` → `shipped` → `invoiced` → `paid`), plantId?, costEstimate |
| `ProductionJob` | orderId, lineId, startDay, hoursRequired, hoursDone |
| `PurchaseOrder` | id, supplierId, materialId, qty, unitPrice, orderedDay, dueDay (lead time), paymentDueDay, status |
| `InventoryPosition` | per material and per product family (finished goods): qty, value |

## Finance

| Entity | Key fields |
|---|---|
| `Cash` | balance (Money), history by day |
| `Receivable` | orderId, customerId, amount, dueDay, expectedPayDay (dueDay + customer delay) |
| `Payable` | poId or cost type, counterparty, amount, dueDay |
| `RecurringCost` | payroll (monthly), overhead (monthly), energy (per production hour) |

Derived (selectors, never stored): revenue (month, trailing), gross margin, backlog value,
capacity utilisation, cash runway, DSO/DPO, customer satisfaction average, turnover.

## Events, decisions, ledger

| Entity | Key fields |
|---|---|
| `EventCard` (definition, seed) | id, kind, trigger (day or condition), severity (`high`/`medium`/`low`), payload, opensDecision? |
| `Development` (instance) | cardId, day, status (`new`/`read`/`resolved`), decisionId? |
| `Decision` | id, sourceDevelopmentId, status (`open`/`approved`/`rejected`/`analysis_requested`), options[], chosenOptionId?, decidedDay? |
| `DecisionOption` | id, labelKey, commands: `Command[]`, assumptions[] |
| `AdvisorBrief` | role (`cfo`, `coo`, later `cmo`, `chro`, `risk`), recommendedOptionId, citations: `{ selector, value }[]`, assumptions[] (rule-based in V1) |
| `Command` | type, payload, issuedDay, source (`ceo`/`system`/`rule`) |
| `Event` | type, payload, day, seq, cause (`commandId` / `ruleId` / parent `eventSeq`) |
| `LedgerEntry` | = Event + human-readable code/params for i18n |

## Seed event cards (spec list)

1. Supplier price increase (steel +20%)
2. Key customer threatens to leave / demands 8% discount
3. Machine breakdown (Plant 2 press line)
4. Big export opportunity
5. Rising employee turnover
6. Cash squeeze
7. Late payment from a big customer
8. Large domestic order (Milestone 1 trigger)

## Invariants (tested)

- Cash balance = opening + Σ cash events. Never mutated directly.
- Every receivable/payable references an order/PO and is settled exactly once.
- Inventory never negative; shortage blocks production and emits `MaterialShortage`.
- Line utilisation ≤ 100% of available hours (overtime/shift changes raise availability, at a cost).
- Every state change has a ledger entry with a cause.
