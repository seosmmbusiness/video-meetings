@AGENTS.md

# apps/web

Next.js 16.2.12 frontend, App Router, TypeScript, React 19.

## Structure

- `src/app/` — App Router routes. `layout.tsx` is the root layout, `page.tsx` the home route.
- `e2e/` — Playwright e2e specs, run against a dev server Playwright starts itself (see `playwright.config.ts`).
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Own ESLint config (`eslint-config-next`) — kept separate from `apps/api`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- No real feature modules yet. Once one lands, give it a one-line pointer here to `.claude/modules/module-web-<name>.md` — see root `CLAUDE.md`'s Module documentation section for the convention.
- UI components come from [HeroUI v3](https://heroui.com/docs/react) (`@heroui/react`), styled via Tailwind CSS v4 (`@heroui/styles` imported after `tailwindcss` in `src/app/globals.css`). No `HeroUIProvider` — v3 doesn't need one. Use HeroUI's compound components (`Card.Header`, `Card.Title`, ...) rather than flattening to props, and `onPress` instead of `onClick`. Theme is fixed to `light` (`className="light" data-theme="light"` on `<html>` in `layout.tsx`) — no theme switching wired up yet.

## Commands

Run from this directory, or via the root's `npm run dev:web` / `build:web` / `lint:web`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint`
- `npm run test:e2e` — run Playwright e2e tests (auto-starts the dev server)
- `npm run test:e2e:ui` — same, in Playwright's UI mode

## Status

Default `create-next-app` scaffold (2026-07-28), since extended with Playwright e2e testing (2026-07-30, single smoke test against the home page; Playwright's system dependencies aren't installed — `playwright install --with-deps` needs sudo, unavailable in this environment — only the Chromium binary itself is installed, which is enough for local test runs) and HeroUI v3 + Tailwind v4 (2026-07-30, home page now a HeroUI `Card`/`Button`). Still no real feature modules or API integration.
