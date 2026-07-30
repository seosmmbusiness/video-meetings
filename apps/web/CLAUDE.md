@AGENTS.md

# apps/web

Next.js 16.2.12 frontend, App Router, TypeScript, React 19.

## Structure

- `src/app/` — App Router routes. `layout.tsx` is the root layout, `page.tsx` the home route. `register/`, `login/` — registration/login pages against `apps/api`'s auth endpoints; see `.claude/modules/module-web-auth.md`.
- `src/lib/` — `auth-api.ts` (fetch client for `apps/api`'s `/auth/*`) and `auth-storage.ts` (JWT `localStorage` helpers); see `.claude/modules/module-web-auth.md`.
- `e2e/` — Playwright e2e specs, run against a dev server Playwright starts itself (see `playwright.config.ts`).
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Own ESLint config (`eslint-config-next`) — kept separate from `apps/api`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- No shared types package with `apps/api` — request/response shapes for backend calls (e.g. `RegisterInput`/`AuthResponse` in `src/lib/auth-api.ts`) are hand-duplicated from the backend DTOs and must be kept in sync manually.
- Calling `apps/api` cross-origin from the browser (port 3000 → 3001 in dev) needs CORS enabled on the backend (`CORS_ORIGIN` in `apps/api`'s `main.ts`) — see `apps/api/CLAUDE.md`. Nothing to configure on this side beyond pointing `NEXT_PUBLIC_API_URL` at the API if it's not the `http://localhost:3001` default.
- UI components come from [HeroUI v3](https://heroui.com/docs/react) (`@heroui/react`), styled via Tailwind CSS v4 (`@heroui/styles` imported after `tailwindcss` in `src/app/globals.css`). No `HeroUIProvider` — v3 doesn't need one. Use HeroUI's compound components (`Card.Header`, `Card.Title`, ...) rather than flattening to props, and `onPress` instead of `onClick`. Theme is fixed to `light` (`className="light" data-theme="light"` on `<html>` in `layout.tsx`) — no theme switching wired up yet.

## Development workflow

- **Performance and bundle size**: before writing or reviewing any React/Next.js code, consult the `vercel-react-best-practices` skill and follow it — Server Components, code-splitting, image/font optimization, avoiding unnecessary client-side JS, etc. By default, prefer Server Components, Server Actions, and whatever the current Next.js version's idiomatic data-fetching/mutation APIs are over older patterns (client-side `fetch` in `useEffect`, API route handlers called from the client, etc.). Reach for a Client Component only when the page genuinely needs interactivity, local state, or a browser API (e.g. the current `/register`/`/login` pages and the home page's signed-in state — all client components today because they read/write `localStorage` and hold form state; see `.claude/modules/module-web-auth.md`). Re-evaluate that as auth moves to a more server-driven approach (e.g. cookies + Server Actions) — don't assume the current auth pages are the template for future ones.
- **Caching and Redis**: any server-side caching added here (Route Handlers, Server Actions, `fetch`/`unstable_cache`, etc.) must treat Redis as optional/best-effort, per the root `CLAUDE.md`'s Redis convention — degrade to the uncached/direct path if it's unavailable, never fail the request. Use short TTLs (minutes, not hours) so a stale cache can't compound into a large blast radius, while still absorbing bursty request volume. When a mutation changes the cached state (e.g. a `POST`/`PATCH`/`DELETE` against `apps/api`), invalidate the specific cache key(s) it affects immediately rather than waiting on TTL expiry — don't do a broad/blanket flush.
- **UI review**: after building or changing UI, review it with the `web-design-guidelines` skill first, then the `ui-ux-pro-max` skill (higher-priority pass — its findings take precedence over `web-design-guidelines`'s where they conflict). Use the Playwright MCP tools for visual verification (navigate, snapshot, screenshot) against a running dev server rather than judging from source alone — this is also how the auth pages were verified (see `.claude/modules/module-web-auth.md`).

## Commands

Run from this directory, or via the root's `npm run dev:web` / `build:web` / `lint:web`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint`
- `npm run test:e2e` — run Playwright e2e tests (auto-starts the dev server)
- `npm run test:e2e:ui` — same, in Playwright's UI mode

## Status

Default `create-next-app` scaffold (2026-07-28), since extended with Playwright e2e testing (2026-07-30, single smoke test against the home page; Playwright's system dependencies aren't installed — `playwright install --with-deps` needs sudo, unavailable in this environment — only the Chromium binary itself is installed, which is enough for local test runs) and HeroUI v3 + Tailwind v4 (2026-07-30, home page now a HeroUI `Card`/`Button`). First real feature module landed (2026-07-30): `/register` and `/login` pages against `apps/api`'s email/password auth, with JWT storage and a signed-in state on the home page — see `.claude/modules/module-web-auth.md`. Requires `apps/api`'s CORS to be enabled for this app's origin (see `apps/api/CLAUDE.md`). No e2e coverage for the auth pages yet (existing `e2e/home.spec.ts` is unchanged).
