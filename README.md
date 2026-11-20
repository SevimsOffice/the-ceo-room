# THE CEO ROOM

**A decision simulation for executive training.** You sit at the desk of a mid-century executive
office and run a company: read the typed morning report, open telegrams, weigh your advisors'
memos, press the wax seal, and ring the brass bell to see what your decision does to cash,
margins, deliveries, customers and people over the following weeks.

It is built for leadership workshops and self-study: every number is produced by a deterministic
simulation engine, so a group that takes the same decision gets the same outcome, and groups that
take different decisions can lay their results side by side.

**Live:** https://sevimsoffice.github.io/the-ceo-room/ (desktop browser, 1280 px wide or more;
Turkish by default, English on the switch)

**Version:** v1.0 (frozen)

---

## A short walkthrough: the steel decision

You run **NOVARA Sanayi / NOVARA Industries**, a simulated industrial manufacturer in Bursa.

1. **Day 1, the Desk.** The morning report shows monthly revenue of 76.4M TL, 41.2M TL in cash,
   15 open orders worth about 166M TL, customer satisfaction around 81 and capacity at 92%. Two
   telegrams arrive: a 22M TL order from a key customer on 90-day payment terms, and the main steel
   supplier raising prices by 20%.
2. **The Decision Room.** The price rise opens a decision. A green baseline card shows what happens
   if you simply absorb it; three pinned notes show the alternatives, each as a change against that
   baseline after **7 days** and **30 days**: cash, margin, delivery delay, customer satisfaction,
   overtime, employee turnover and risk.
   - **A, Negotiate:** the supplier settles near +9% in exchange for a forward purchase. Nothing
     changes in cash after 7 days, but around **−18M TL after 30 days**, because the 20.7M TL bill
     for the forward steel falls due on day 29.
   - **B, Switch supplier:** a deposit costs about 6M TL up front; after 30 days cash looks
     *better*, but over 8M TL of the new supplier's bills start falling due from day 32, and
     deliveries slip.
   - **C, Pass the price on:** margins recover, customer satisfaction drops about 7 points.
3. **Two advisors disagree, with reasons.** *Ayşe Kaya, CFO* looks 90 days ahead, warns that
   option B only postpones bills, and recommends absorbing the rise. *Murat Demir, COO* recommends
   negotiating: no late deliveries and the most steel in stock. Both cite the engine's figures.
4. **Decide.** Approve an option with the wax seal, reject (absorb), request a deeper analysis
   (a +90-day column appears the next morning), or write a custom memo and preview its effect
   before sealing it.
5. **Advance 30 days.** Back at the Desk, ring the bell or use the time dial. The ledger carbon
   copy lists every consequence of your decision with its cause, and the morning report shows
   where the company actually ended up, including the delayed effects you were warned about, or
   not.

The figures above come from the built-in sample at its fixed seed; the app shows the exact values.

## What makes it work

- **A deterministic engine owns every number.** `packages/engine` is pure TypeScript with no UI,
  network or clock: money in integer kuruş, rates in basis points, time in simulation days,
  randomness from seeded streams stored in the state. The same starting data and the same
  decisions always give byte-identical results, enforced by a golden-hash test.
- **An event ledger explains everything.** State changes only through commands that produce
  events, and each event records its cause (your decision, an engine rule or an earlier event).
  The ledger is what the carbon copy on the Desk shows.
- **Previews equal outcomes.** The +7/+30/+90 figures in the Decision Room are produced by running
  the real engine forward on a copy of the company. Tests check that each option's preview equals
  what actually happens after you seal it and advance time.
- **Advisors are rule-based and honest.** The CFO and COO rank options against their own
  objectives using only the figures in their own scope, cite every figure they rank on, and flag
  caveats such as bills deferred beyond the preview window. No language model produces numbers.
- **The UI never computes.** React components render engine selectors; formatting and all text go
  through Turkish/English catalogues, with a test that fails if any engine message lacks a
  translation. The engine runs in a Web Worker so long forecasts never freeze the screen.

## The Archive Room: your own company, privately

The Archive Room (Arşiv Odası) runs the same engine on a real company's data.

- Download an Excel template (18 sheets: customers, suppliers and prices, products and bills of
  materials, inventory, open orders and purchase orders, receivables, payables, cash, fixed costs,
  capacity, workforce by department, history), filled with NOVARA as the example or empty.
- Upload it back: the file is validated in the browser and an inspection report lists every
  problem by sheet, cell, column and plain-language explanation, in Turkish or English. Import is
  enabled only when there are no errors.
- In **My company** mode, Day 1 is your snapshot date and every later day is labelled a
  **forecast**. The sample and your company keep separate saved games.

**Privacy by design:**

- **Nothing leaves the browser.** Validation and simulation run locally; the data is stored only
  in the browser's IndexedDB. An end-to-end test intercepts every request and fails on anything
  other than the site's own static files.
- **Department totals only.** The template has no place for individual employees. A privacy guard
  rejects Turkish ID numbers and IBANs (checksum-verified), e-mail addresses, phone numbers and
  person-level sheets or columns.
- **Data minimisation.** Only the template's own sheets and columns are stored; anything else in
  the file is dropped. The error report never repeats a private value, and its CSV/XLSX download
  is protected against spreadsheet formula injection.
- **You stay in control.** "Remove my data" deletes the company, its save and its backups from the
  browser.
- **Acceptance test:** importing the NOVARA template reproduces exactly the same Day 1 as the
  built-in sample, and the same 30 days after it.

## Tests

| Suite | Tests |
|---|---|
| Engine (determinism, invariants, every decision path, previews = outcomes, advisors) | 202 |
| Import (template round trip, validation rules, privacy guard, real-company fixture) | 97 |
| i18n (catalogue completeness, number and money formatting) | 42 |
| Seed data | 3 |
| Web (worker protocol, store, components, xlsx adapter, storage) | 133 |
| **Unit total** | **477** |
| End-to-end, Playwright (CEO journey, Decision Room, Archive Room, legibility at 1280×700, no network) | 36 |

Every push runs typecheck, unit tests, build and the end-to-end suite in GitHub Actions before
deploying to GitHub Pages.

## Tech stack

TypeScript (strict) · pnpm workspaces · React 19 · Vite · Tailwind CSS 4 · Zustand · Web Workers ·
Vitest · Playwright · read-excel-file / write-excel-file · IndexedDB · GitHub Actions and GitHub
Pages. Fonts (Playfair Display, Cormorant Garamond, Courier Prime) are self-hosted. All artwork
(wood, paper, brass, wax, film grain) is original CSS and SVG.

```
packages/engine      deterministic simulation (pure)
packages/import      Excel template, validation, privacy guard (pure)
packages/i18n        Turkish/English catalogues and formatting
packages/seed-data   the NOVARA sample (data/seed)
apps/web             the rooms: Desk, Decision Room, Archive Room
docs/                architecture, domain model, simulation design, data import design, ADRs
```

```
pnpm install
pnpm dev          # http://localhost:5173/the-ceo-room/
pnpm test         # unit tests
pnpm typecheck
pnpm e2e          # build + Playwright (Chromium)
pnpm build        # static site in apps/web/dist
```

## Known limitations

This is a training simulation, not a forecasting or accounting tool. In v1.0:

- **Simplified outcomes.** Decision outcomes are deterministic: negotiation always succeeds on the
  modelled terms, customer churn is a fixed threshold, and there is no range of possible results.
- **Few scripted decisions.** The sample has two full decisions (steel price, key-customer
  discount); other events (press-line breakdown, cash squeeze, turnover) have simple effects. A
  breakdown delays shipments but does not re-plan promised delivery dates.
- **Calibration is illustrative.** Constants such as how much goodwill a discount buys are
  provisional, first-month revenue in the sample is lumpy, and forfeited deposits appear in the
  ledger but not in margin figures.
- **Real-company forecasts are rough.** Imported companies get a generic setup with only two
  condition-triggered events; the model has no taxes, financing decisions or seasonality. Some day
  references (telegrams, dossiers, the Decision Room) still show day numbers instead of dates.
- **Template constraints.** No Excel dropdowns, whole-number bill-of-material quantities, TRY only,
  and data drawers show 250 rows at a time (search narrows the rest).
- **One browser only.** Saves and imported data live in the browser that created them; there are
  no accounts or sync, and clearing browser data deletes them.
- **Desktop only.** The rooms are designed for screens 1280 px wide or more; smaller screens get a
  note instead of a layout.
- **No AI advisors.** The CFO and COO are rule-based; there is no language-model layer.
- **Testing scope.** End-to-end tests run in Chromium only, and accessibility is checked by
  automated tests (contrast, target sizes, keyboard paths), not by screen-reader user testing.

## Credits

Designed and directed by **Sevim Durmuş**:
[Instagram](https://www.instagram.com/sevimsoffice/) ·
[LinkedIn](https://www.linkedin.com/in/sevimdurmus/)

Built with Claude Code. NOVARA and every company, person and figure in the sample are fictional.
