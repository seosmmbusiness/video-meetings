@AGENTS.md

# apps/web

Next.js 16.3.1 frontend, App Router, TypeScript, React 19.

Why anything here is the way it is: [`HISTORY.md`](HISTORY.md) (repo-wide changes: [root `HISTORY.md`](../../HISTORY.md)).

## Structure

- `src/app/` — App Router routes. `layout.tsx` is the root layout, `page.tsx` the home route (a Server Component; auth-gated dashboard — redirects to `/login` without a valid session, otherwise shows the signed-in email and the caller's meetings, each row linking to its own page). `register/`, `login/` — registration/login pages against `apps/api`'s auth endpoints; `actions/auth.ts` — the Server Actions backing them; see `docs/modules/module-web-auth.md`. `meetings/[id]/page.tsx` — the meeting detail page (fields, live/deleted file lists, upload, preview, download, delete/restore); `actions/files.ts` — the delete/restore Server Actions; `api/meetings/[meetingId]/files/route.ts` and `.../files/[fileId]/content/route.ts` — the same-origin proxies that accept and serve a file's bytes without exposing the session token to the browser; see `docs/modules/module-web-meeting-files.md`. `profile/page.tsx` — the account's profile page (email, avatar mark, name form); `actions/profile.ts` — the Server Action that stores the name; see `docs/modules/module-web-profile.md`.
- `src/lib/` — `auth-api.ts` (server-only fetch client for `apps/api`'s `/auth/*`), `session.ts` (the `httpOnly` session cookie: read/write/clear plus JWT claim decoding), and `meetings-api.ts` (server-only fetch client for `apps/api`'s `GET /meetings`, plus the upcoming/recent-past split used by the home page); see `docs/modules/module-web-auth.md`. `files-api.ts` (server-only fetch client for a meeting and its live/deleted files), `api-proxy.ts` (the allow-listed request/response forwarder both proxy routes use), `file-limits.ts` (the browser-side 500 MB check, hand-duplicated from `apps/api`'s own limit), and `file-preview.ts` (which types preview in place vs. download-only, hand-duplicated from `apps/api`'s own split); see `docs/modules/module-web-meeting-files.md`. `profile-api.ts` (server-only fetch client for `apps/api`'s `GET`/`PATCH /profile`, plus the name-or-email choice the profile page and the dashboard both render); see `docs/modules/module-web-profile.md`.
- `src/components/files/file-uploader.tsx` — the Client Component driving multi-file upload (progress, cancel, retry) from the meeting page; `file-preview.tsx` — the Client Component rendering a file in place (video/audio/image/PDF); see `docs/modules/module-web-meeting-files.md`. `src/components/profile/name-form.tsx` and `user-avatar.tsx` — the profile page's name form and its initials-based avatar mark; see `docs/modules/module-web-profile.md`.
- `src/components/icons/video-camera-icon.tsx` — the app's video-camera SVG mark, shown on `/`, `/register`, and `/login`; `src/app/icon.tsx` generates the matching favicon at request time via `next/og`'s `ImageResponse` (Next.js's code-based app-icon convention), replacing the default `create-next-app` `favicon.ico`.
- `e2e/` — Playwright e2e specs, run against a dev server Playwright starts itself (see `playwright.config.ts`). `auth.spec.ts`, `home.spec.ts`, `meeting-page.spec.ts`, `meeting-file-upload.spec.ts`, `meeting-file-preview.spec.ts` and `profile.spec.ts` additionally require `apps/api` + Postgres to already be running (Playwright only manages the `apps/web` dev server) — see `docs/modules/module-web-auth.md` and `docs/modules/module-web-meeting-files.md`.
- Unit (`*.spec.ts`/`.tsx`) and integration (`*.int-spec.ts`/`.tsx`) specs are colocated with the code they cover, under `src/` — Vitest is configured in `vitest.config.mts` (with `vitest.setup.ts` and the `server-only` stand-in in `test/stubs/`). See the Testing section below.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- Own ESLint config (`eslint-config-next`) — kept separate from `apps/api`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- No shared types package with `apps/api` — request/response shapes for backend calls (e.g. `RegisterInput`/`AuthResponse` in `src/lib/auth-api.ts`) are hand-duplicated from the backend DTOs and must be kept in sync manually.
- Calling `apps/api` cross-origin from the browser (port 3000 → 3001 in dev) needs CORS enabled on the backend (`CORS_ORIGIN` in `apps/api`'s `main.ts`) — see `apps/api/CLAUDE.md`. `/auth/register` and `/auth/login` are called server-to-server from Server Actions (see the no-flash rule below), so CORS isn't needed for those specifically, but the mechanism stays in place for any future browser-side call. The API's base URL for these server-to-server calls comes from `API_BASE_URL` in the monorepo-root `.env` (default `http://localhost:3001`), loaded via `@next/env` in `next.config.ts` since this app has no `.env` of its own — see `docs/modules/module-web-auth.md`.
- UI components come from [HeroUI v3](https://heroui.com/docs/react) (`@heroui/react`), styled via Tailwind CSS v4 (`@heroui/styles` imported after `tailwindcss` in `src/app/globals.css`). No `HeroUIProvider` — v3 doesn't need one. Use HeroUI's compound components (`Card.Header`, `Card.Title`, ...) rather than flattening to props, and `onPress` instead of `onClick`. Theme is fixed to `light` (`className="light" data-theme="light"` on `<html>` in `layout.tsx`) — no theme switching wired up yet.
- **No flash of wrong auth/session state**: any user/session state that affects the initial render (signed-in/signed-out, theme and anything derived from it) must be read and applied _before_ the page renders, not read client-side after mount — reading it in a `useEffect`/`useSyncExternalStore` against `localStorage` produces a visible flicker or layout shift as the UI flips from signed-out to signed-in once JS runs. In practice this means the JWT (or whatever replaces it) needs to live in a cookie the server can read in a Server Component/middleware, so the initial HTML already reflects sign-in state, rather than in `localStorage` read client-side. The auth module follows this: the JWT lives in an `httpOnly` cookie set by a Server Action, and the home page reads it server-side via `getSession()` before rendering — see `docs/modules/module-web-auth.md`.
- **Auth-gated routes redirect server-side, before render**: the home page (`/`) has no signed-out state to render at all — `getSession()` is checked first thing in the Server Component and `redirect('/login')` runs before any JSX is produced if there's no session (or if a present-but-invalid session is rejected by the first `apps/api` call that verifies it, e.g. a `401` from `GET /meetings`). Any future protected page should follow the same shape rather than rendering a client-side "redirecting..." state or gating in `useEffect`.

## Development workflow

- **Performance and bundle size**: before writing or reviewing any React/Next.js code, consult the `vercel-react-best-practices` skill and follow it — Server Components, code-splitting, image/font optimization, avoiding unnecessary client-side JS, etc. By default, prefer Server Components, Server Actions, and whatever the current Next.js version's idiomatic data-fetching/mutation APIs are over older patterns (client-side `fetch` in `useEffect`, API route handlers called from the client, etc.). Reach for a Client Component only when the page genuinely needs interactivity, local state, or a browser API — e.g. `/register`/`/login` are Client Components for their live per-keystroke validation and controlled inputs, but submit through a Server Action rather than a local `fetch`; the home page is a Server Component, reading sign-in state server-side (see `docs/modules/module-web-auth.md`).
- **Caching and Redis**: any server-side caching added here (Route Handlers, Server Actions, `fetch`/`unstable_cache`, etc.) must treat Redis as optional/best-effort, per the root `CLAUDE.md`'s Redis convention — degrade to the uncached/direct path if it's unavailable, never fail the request. Use short TTLs (minutes, not hours) so a stale cache can't compound into a large blast radius, while still absorbing bursty request volume. When a mutation changes the cached state (e.g. a `POST`/`PATCH`/`DELETE` against `apps/api`), invalidate the specific cache key(s) it affects immediately rather than waiting on TTL expiry — don't do a broad/blanket flush.
- **UI review**: after building or changing UI, review it with the `web-design-guidelines` skill first, then the `ui-ux-pro-max` skill (higher-priority pass — its findings take precedence over `web-design-guidelines`'s where they conflict). Use the Playwright MCP tools for visual verification (navigate, snapshot, screenshot) against a running dev server rather than judging from source alone — this is also how the auth pages were verified (see `docs/modules/module-web-auth.md`).
- **Refactoring**: only refactor when there's an actual need and an explicit request for it — never speculatively, just because a change is passing through the area. Before starting: run the full check (`npm run lint`, `npm test`, `npm run test:e2e`) and confirm everything passes, then capture the current visual state of every affected page with the Playwright MCP tools (`browser_navigate` + `browser_take_screenshot`, saved under `screenshots/` per the screenshot convention) as a baseline. Apply the refactor in small steps; after each step, re-run lint/tests and re-screenshot the same pages to confirm both the tests still pass and the visual output is unchanged from the baseline before moving to the next step.
- **Tests come before the code**, at every tier that applies — not e2e alone. See the Testing section below for what that means here.

## Testing

Three tiers, per the root `CLAUDE.md`'s Testing section. Playwright owns `e2e/` as before; **unit and integration now run on Vitest + React Testing Library** and are written first, in the inner loop, against the units the e2e scenario needs.

- **Unit** — `src/**/*.spec.ts(x)`, colocated. Pure logic in `src/lib` (`file-limits.ts`, `file-preview.ts`, `meetings-api.ts`'s upcoming/past split, `session.ts`'s claim decoding) and **Client Components** through RTL, driven with `@testing-library/user-event` and queried by role/label rather than by class or test id. HeroUI's `onPress` responds to `userEvent.click` in jsdom — `src/components/files/file-preview.spec.tsx` is the worked example.
- **Integration** — `src/**/*.int-spec.ts(x)`, colocated. **Route Handlers and Server Actions called directly**: import the exported `GET`/`POST` (or the action), hand it a real `Request` and Next's `params` Promise, mock `next/headers` with `vi.mock` and `fetch` with `vi.stubGlobal`, then assert on what reached the upstream and what came back. This is the tier that pins the security-critical seams the browser can't see into — the proxy's request/response header allow-list, the bearer token being attached server-side while the caller's own `Authorization` is dropped, the pre-upstream `401`. `src/app/api/meetings/[meetingId]/files/[fileId]/content/route.int-spec.ts` is the worked example.
- **E2E** — `e2e/*.spec.ts` (Playwright, unchanged). Pages, navigation, redirects, the real API, and everything that only exists in a browser.

**Async Server Components cannot be rendered by Vitest/RTL** — a React-level limitation Next's own Vitest guide states outright (bundled at the repo root, `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — `next` is hoisted there, not into `apps/web/node_modules`). Don't fight it with mocks: a page's rendering, its auth gate and its data fetching are e2e's job. What a Server Component delegates to — the `src/lib` function that computes the split, the Client Component it renders, the Server Action it binds — is exactly what the two lower tiers cover, so pushing logic out of the component and into those places is what makes it testable.

Mechanics worth knowing before writing a spec:

- The default environment is **jsdom**. A spec that needs real Node globals (`Request`/`Response`/`fetch`, `Buffer`) — anything testing a Route Handler or a server-only module — opts out per file with a `// @vitest-environment node` docblock on the first line.
- `describe`/`it`/`expect`/`vi` are **imported explicitly** from `vitest` (no `globals: true`), so nothing depends on ambient types. `@testing-library/jest-dom`'s matchers and RTL's between-test cleanup are wired in `vitest.setup.ts`.
- `server-only` is aliased to an inert stub (`test/stubs/server-only.ts`), because the real package throws unless the resolver applies React's `react-server` condition — which Vitest can't, since it would swap React itself for its server build. Without that alias every `src/lib` module would be unimportable from a spec.
- Vitest only ever looks under `src/`, so Playwright's `e2e/` is never picked up by `npm test`, and vice versa.

**Security test cases are mandatory, not optional**, and each belongs at the lowest tier that can prove it: the proxy routes' header allow-list, unauthenticated refusal before any upstream call, and id escaping as integration specs; session/cookie handling (the cookie is `httpOnly` and invisible to `document.cookie`), protected UI against a missing/cleared/tampered session, safe rendering of user-controlled input (no XSS), and the absence of tokens or other sensitive data from the page source, client bundle and browser-visible responses as e2e specs. Same standard as `apps/api`'s — see its CLAUDE.md's Development workflow section.

## Commands

Run from this directory, or via the root's `npm run dev:web` / `build:web` / `lint:web` / `test:web`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint`
- `npm test` — unit + integration tests (Vitest, one pass; both tiers are hermetic and need no infrastructure)
- `npm run test:watch` — same, in watch mode
- `npm run test:e2e` — run Playwright e2e tests (auto-starts the dev server)
- `npm run test:e2e:ui` — same, in Playwright's UI mode

## Status

Where things stand now. **How it got here — and why — is in [`HISTORY.md`](HISTORY.md)**; per-module architecture and function references are in `docs/modules/`.

- **Auth** — `/register` and `/login` against `apps/api`, on an `httpOnly` session cookie set by Server Actions and read server-side before render. See `docs/modules/module-web-auth.md`.
- **Dashboard** — `/` is auth-gated with no signed-out state: it redirects to `/login` server-side before producing any JSX, and otherwise greets the caller by their stored name (their email when they have none) and lists their meetings split into upcoming and the three most recent past ones, each row linking to its meeting.
- **Profile** — `/profile`, auth-gated the same way, shows the account's email, an initials avatar mark and a name form that stores the name through a Server Action; linked from the dashboard beside sign-out. See `docs/modules/module-web-profile.md`.
- **Meeting page** — `/meetings/[id]` shows a meeting's fields, its live and deleted files, and handles upload (per-file progress, cancel, retry), download, in-page preview (video/audio/image/PDF) and delete/restore. Bytes move through same-origin proxy Route Handlers that attach the session token server-side, so it never reaches the browser. See `docs/modules/module-web-meeting-files.md`.
- **UI** — HeroUI v3 + Tailwind CSS v4, theme fixed to light.
- **Tests** — Vitest + React Testing Library for unit and integration, Playwright for e2e, per the Testing section.

Update this section when the current state changes, and record the change itself in `HISTORY.md`.
