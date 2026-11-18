# Design reference

Export of the Claude Design canvas **"The CEO Room — Desk & Decision Room"**
(live canvas: https://claude.ai/artifact/J8sJjo3o3ZEPkNSbEJRtub).

| File | Screen | Lang | Size |
|---|---|---|---|
| `claude-design/Main.dc.html` | The Desk (morning report) | EN | 1440×900 |
| `claude-design/Decision.dc.html` | Decision Room (supplier price rise) | EN | 1440×980 |
| `claude-design/Masa.dc.html` | Masa (Sabah Raporu) | TR | 1440×900 |
| `claude-design/Karar.dc.html` | Karar Odası | TR | 1440×980 |
| `claude-design/canvas.json` | Canvas layout index | – | – |

## How to use these files

- They are **visual reference, not application code**. `.dc.html` is the Claude Design
  component format (`<x-dc>`, `{{holes}}`, `<sc-for>`); it needs the design runtime
  and will not open as a plain web page. Read them for layout, palette, type scale,
  textures and component anatomy, and rebuild in React + Tailwind.
- **Every number in them is a placeholder** (hand-written, not engine output). This
  includes the option-impact figures in the Decision Room, which were invented for the
  mock-up. In the app, all figures come from the simulation engine (see `docs/`).
- All textures (wood, paper, film grain, brass, gauges, bell, wax seal) are procedural
  CSS/SVG. No raster images and no third-party artwork are used.

## Design tokens extracted from the mock-ups

| Token | Value | Use |
|---|---|---|
| `desk.base` | `#170b07` / `#1f0e08` | dark walnut desk |
| `paper` | `#ece1c5 → #e3d5b3` | typed reports, memos |
| `telegram` | `#e4d3a4` | telegram forms |
| `ink` | `#241a10` | body text on paper |
| `ink.muted` | `#4a3a28` | labels on paper |
| `oxblood` | `#6a1c1f` / `#8a1818` | bands, seals, negative figures |
| `bottle` | `#2f4a3a` / `#1f5a34` | folders, positive figures |
| `amber.ink` | `#7a4a00` | warnings |
| `brass` | `linear-gradient(135deg,#ecd084,#c19a43 40%,#8c6b25 68%,#dcb862)` | plates, gauges, bell |
| `cream.onDark` | `#efe3c4` / `#f1e4c6` | text on wood |
| fonts | Playfair Display (headings), Cormorant Garamond italic (handwritten notes), Courier Prime (reports and all figures) |

Courier Prime and Playfair cover Turkish glyphs (ş ğ ı İ). Special Elite does not, so it is not used.
