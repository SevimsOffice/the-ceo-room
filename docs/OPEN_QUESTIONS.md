# Phase 0 questions: resolved (2026-11-18)

| # | Question | Decision |
|---|---|---|
| 1 | Company name | Localised: EN **"NOVARA Industries"**, TR **"NOVARA Sanayi"** (i18n key `company.name`). |
| 2 | Cash runway definition | **(c)** Days until projected cash < 0 from the engine forecast. Label: "projected cash runway" / "öngörülen nakit süresi". |
| 3 | Design numbers vs engine | Calibrate the seed so Day 1 is roughly the mock-up: 76.4M revenue, 41.2M cash, 15 orders / 168M, 81% satisfaction, 92% capacity. **All option deltas come from the engine**, never from the mock-up. |
| 4 | Day 1 storyline | Day 1 = morning report + **two telegrams**: big order arrival and steel supplier +20%. The 8% discount demand and the Plant 2 press-line breakdown arrive later as time advances. |
| 5 | Desk contents | Milestone 2 adds **overall health** and **employee turnover**; keep the capacity and runway gauges. |
| 6 | Decision Room | Add a **people** row (overtime / turnover) and a 4th action **"custom decision"**. Long-term horizon in the Decision Room = **+30 days**; 90/180/365 only in Scenario Study. |
| 7 | Time controls | Add **week, month, pause** as a small brass dial/lever next to the bell. |
| 8 | Advisor identity | **Fictional Turkish name + role**, e.g. "Ayşe Kaya — CFO". |
| 9 | Default locale | **TR** by default, TR/EN switch, choice remembered (localStorage). |
| 10 | Layout width | **Desktop only, min 1280px**, scale the scene. Below that, a styled "best viewed on desktop" note. Mobile later. |
| 11 | Fonts | **Self-host** Playfair Display, Cormorant Garamond, Courier Prime. |

All ADRs 0001–0006 approved (Accepted).
