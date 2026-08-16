# History — apps/web

How this app reached its current shape, newest first. `CLAUDE.md`'s Status section says only where things stand **now**; this file says how they got there and why.

Repo-wide changes (tooling, conventions, cross-app features) live in the root [`HISTORY.md`](../../HISTORY.md); per-module architecture and function references live in `.claude/modules/`. This file records the decisions behind this app's shape — keep it to what a future reader would ask "why is it like this?" about.

**How to keep it:** one `### YYYY-MM-DD — <short title>` entry per change, newest first, grouped under its `## YYYY-MM` heading; say what changed and why; date by when it landed on the base branch; never rewrite older entries. See the root `HISTORY.md` for the full convention.

---

## 2026-08

### 2026-08-16 — First non-browser test runner: Vitest + React Testing Library

Until now Playwright was the only way to execute any of this app's code, so pure logic and the proxy routes were tested through a browser or not at all. Vitest 4 + RTL + jsdom (`vitest.config.mts`, `vitest.setup.ts`, `npm test`) now cover `src/lib`, Client Components, and Route Handlers called directly; pages and async Server Components stay with Playwright, since React cannot render async Server Components in a test environment at all.

One constraint shaped the config and is worth knowing before changing it: `server-only`, which every server-side module under `src/lib` imports, throws unless the resolver applies React's `react-server` condition — and Vitest can't apply it without swapping React itself for its server build, which would break RTL. Hence the alias to an inert stub; without it no `src/lib` module is importable from a spec at all. The rules that follow from the setup (environment per spec, explicit imports, the alias) are in `CLAUDE.md`'s Testing section, where they're operative rather than historical.

### 2026-08-16 — Meeting page, file proxying, upload and in-place preview (`meeting-file-upload` phases 4–6)

`/meetings/[id]`, auth-gated the same way as `/`, linked from every dashboard row; a nonexistent meeting id and one belonging to another owner both answer Next's built-in not-found page rather than distinguishing themselves.

A file's bytes are **never fetched with a browser-visible credential**. Both directions go through same-origin proxy Route Handlers that attach the session token server-side: a `<video>`/`<img>`/`<a download>` can carry the `httpOnly` cookie but not an `Authorization` header, and exposing the token to client JS to work around that would defeat the cookie. Each proxy refuses an unauthenticated request before opening any upstream connection, and rebuilds the upstream request from an explicit header allow-list rather than forwarding the caller's own `Authorization`.

Upload is one independent `XMLHttpRequest` per selected file (`FileUploader`, a Client Component) rather than a Server Action — Server Actions give no upload progress, and a batch has to fail, cancel and retry per row rather than as a unit. A file over the 500 MB limit is caught by `file.size` before any request is sent; every other refusal (unsupported type, the 20-file cap, the 20 GB quota) is shown on the offending row exactly as `apps/api` worded it, since the proxy passes the upstream status and JSON body through unchanged. A successful upload calls `useRouter().refresh()` so the server-rendered list picks it up with no navigation.

Preview is collapsed by default on each video/audio/image/PDF row, so N rows don't all start fetching media at once; PDFs go to the browser's own viewer in an `<iframe>`. Delete and Restore, by contrast, **are** Server Actions — tiny progressless mutations that call `refresh()` and re-render in the same round trip, which is exactly what the upload path couldn't use.

The 500 MB ceiling (`lib/file-limits.ts`) and the previewable-type split (`lib/file-preview.ts`) are hand-duplicated from `apps/api`'s own values, since there's no shared types package. They have to be kept in sync by hand.

---

## 2026-07

### 2026-07-31 — Home page became an auth-gated dashboard

There is no signed-out state at `/` at all: `getSession()` is checked first thing in the Server Component and `redirect('/login')` runs before any JSX is produced, including when a present-but-invalid session is rejected by the first `apps/api` call that verifies it. Signed-in visitors see their email, sign-out, and their meetings split into upcoming and the three most recent past ones. Any future protected page follows the same shape rather than rendering a client-side "redirecting…" state.

### 2026-07-31 — Auth moved off `localStorage` onto an `httpOnly` session cookie

The JWT lived in `localStorage` and was read client-side after mount, which produces a visible flicker as the UI flips from signed-out to signed-in once JS runs. It now lives in an `httpOnly` cookie set by a Server Action, read server-side before the page renders; `/register` and `/login` submit through `useActionState`-bound Server Actions instead of a client-side `fetch`. This is the origin of the app's no-flash rule: anything affecting the initial render must be readable by the server.

A side effect worth noting: auth stopped being a browser-to-API call, so `apps/api`'s CORS config is no longer on the critical path — it stays configured for any future browser-side call.

### 2026-07-30 — First feature module: `/register` and `/login`

Registration and login against `apps/api`'s email/password auth, with e2e coverage the same day against a real API + Postgres: successful register/login, password mismatch, backend-driven errors (duplicate email, wrong password), sign-out and the cross-links. Fixtures for the login and duplicate-email cases register through a direct API call rather than driving the register form twice.

### 2026-07-30 — HeroUI v3 + Tailwind CSS v4

Replaced the `create-next-app` scaffold. v3 needs no provider; its compound components (`Card.Header`, `Card.Title`, …) are used rather than flattened to props, and `onPress` rather than `onClick`. Theme is fixed to light, with no switching wired up.

### 2026-07-30 — Playwright e2e testing

Started as a single smoke test against the home page. Playwright's system dependencies were never installed — `playwright install --with-deps` needs sudo, unavailable in this environment — so only the Chromium binary itself is present, which is enough for local runs.

### 2026-07-28 — Scaffolded

`create-next-app` (App Router, TypeScript, ESLint), with the `@/*` → `src/*` path alias. Its own ESLint config, kept separate from `apps/api`'s because `eslint-config-next` and the NestJS rule sets don't compose.
