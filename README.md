# THE CEO ROOM

A management simulation set in a mid-century executive's office. You run **NOVARA**, a simulated
Turkish manufacturer: read the typed morning report, open telegrams, look through decision dossiers
and the order book, and ring the brass bell to move time on. Every figure comes from a deterministic
TypeScript engine (`packages/engine`); nothing on screen is hand-written. Turkish by default,
English on the switch. All company data is simulated.

**Live:** https://sevimsoffice.github.io/the-ceo-room/ (desktop, 1280 px wide or more)

## Commands

```
pnpm install
pnpm dev          # the Desk at http://localhost:5173/the-ceo-room/
pnpm test         # unit tests, all packages
pnpm typecheck
pnpm build        # static site in apps/web/dist
pnpm e2e          # build + Playwright journey (Chromium)
```

## Layout

- `packages/engine`: the simulation (pure, seeded, integer money); see its README.
- `packages/seed-data`: the NOVARA seed (`data/seed/*.json`).
- `packages/i18n`: Turkish and English text and number formatting.
- `apps/web`: the Desk (React, Vite, Tailwind, Zustand); the engine runs in a Web Worker and the
  game is saved in the browser (localStorage).
- `docs/`: architecture, domain model, simulation design, roadmap, decisions (ADRs).
- `CEO_ROOM_CLAUDE_CODE_PROMPT.md`: the product specification.
