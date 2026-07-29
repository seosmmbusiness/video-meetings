@AGENTS.md

# apps/web

Next.js 16.2.12 frontend, App Router, TypeScript, React 19.

## Structure

- `src/app/` — App Router routes. `layout.tsx` is the root layout, `page.tsx` the home route.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Own ESLint config (`eslint-config-next`) — kept separate from `apps/api`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- No real feature modules yet. Once one lands, give it a one-line pointer here to a `module-web-<name>` memory entry — see root `CLAUDE.md`'s Module documentation section for the convention.

## Commands

Run from this directory, or via the root's `npm run dev:web` / `build:web` / `lint:web`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint`

## Status

Default `create-next-app` scaffold (2026-07-28) — no custom pages, components, or API integration yet.
