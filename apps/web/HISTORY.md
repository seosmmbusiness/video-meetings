# History — apps/web

How this app reached its current shape, newest first. `CLAUDE.md`'s Status section says only where things stand **now**; this file says how they got there and why.

Repo-wide changes (tooling, conventions, cross-app features) live in the root [`HISTORY.md`](../../HISTORY.md); per-module architecture and function references live in `docs/modules/`. This file records the decisions behind this app's shape — keep it to what a future reader would ask "why is it like this?" about.

**How to keep it:** one `### YYYY-MM-DD — <short title>` entry per change, newest first, grouped under its `## YYYY-MM` heading; say what changed and why; date by when it landed on the base branch; never rewrite older entries. See the root `HISTORY.md` for the full convention.

---

## 2026-08

### 2026-08-23 — Password change on `/profile`, and what a `401` now means (`user-profile` phase 6)

`/profile` grew a password form — current, new, confirmation — behind `changePasswordAction`. The three things worth remembering are all about what happens to _sessions_ when it succeeds.

**The change kills the caller's own token, so the action re-writes the cookie.** `PATCH /profile/password` increments the account's `tokenVersion`, and the JWT guard refuses anything carrying an older `ver` on its next request — that is how AC-13 revokes the other devices. It revokes the token that made the request too, which is why the API answers with a freshly signed one. `changePasswordAction` passes it straight to `setSessionCookie`; without that line the change would look successful and then sign the user out on their very next navigation.

**The token is written, never returned.** An action's return value is serialised into the page payload, where `httpOnly` protects nothing, so `ChangePasswordState` is `{ ok, error? }` and nothing else. Spreading the API's response into the state — the natural way to write it — would have published an hour-long credential to the browser. That is also why the e2e case reads every text/JS/JSON response the browser is handed during a change and asserts no JWT-shaped string and neither password appears in any of them.

**`401` and `403` had to stay apart, and that reached beyond this page.** A wrong current password answers `403` precisely so it cannot be read as a dead session; `profile-api.ts` preserves the upstream status, the form shows the `403` in place, and nobody is signed out for a typo. The other half is that a `401` mid-session went from rare to ordinary — a revocation hits every open page at once — so `/profile` and `/meetings/[id]` gained the `redirect('/login')` that `/` already had. The stale cookie is left where it is: a Server Component cannot delete one, and the next real login overwrites it. Any page added later that calls `apps/api` with the session token needs the same branch.

Two smaller decisions. The **confirmation match runs in the action**, not in the browser, so the gate still holds with JavaScript disabled and the form posting straight to it; and for the same reason the new-password field carries no `pattern` and no `maxLength` — a client-side rule would swallow the value before `apps/api` could name the rule it broke. The fields are controlled, as `NameForm`'s is, and are emptied on success so neither password lingers in the DOM.

Architecture and the full function reference: `docs/modules/module-web-profile.md`.

### 2026-08-21 — Avatar upload in the browser, behind a byte proxy (`user-profile` phase 4)

The avatar can now be uploaded, replaced and removed on `/profile`, and the resulting image renders beside the greeting on `/` as well. Its bytes take a different path from the name, which is the decision worth remembering: a **Route Handler proxy** at `app/api/profile/avatar/route.ts`, not a Server Action, because Next caps an action's request body at 1 MB by default and the avatar limit is 5 MB. Raising `serverActions.bodySizeLimit` would have lifted the ceiling for every action in the app to fix one route. The proxy is the shape both meeting-file proxies already use — `getSession()` first, `401` with no body before any upstream call, then `proxyToApi` with an upstream path that is a module constant, so nothing the caller appends to the URL can steer where the request goes.

`revalidatePath` isn't reachable from a Route Handler, so the upload calls `router.refresh()` instead; both pages read the avatar server-side, and without that refresh a successful upload would show nothing until a manual reload.

**Cache-busting is done by the URL, not by headers.** The API answers `Cache-Control: private, max-age=60` — T-1's window, not `no-store` — but what "the old avatar is gone" is actually about is the copy the browser already painted for a URL — so the image is requested as `/api/profile/avatar?v=<avatarUpdatedAt epoch ms>` and a replacement is simply a different URL. A missing or unparsable timestamp degrades to `v=0` rather than to no URL: an avatar that never loads is the worse failure.

Two smaller things cost real debugging. HeroUI's `Avatar` **remembers that an image loaded** and keeps its fallback hidden afterwards, so removing an avatar under a mounted mark left an empty circle instead of the initials; the mark is now keyed on its source, making each state a fresh component. And the file input clears its own value on every change — picking the identical file twice fires no `change` event, so after a refusal the same corrected pick would have been silently swallowed.

The browser-side size and declared-type checks in `lib/avatar-limits.ts` are a convenience, not the boundary: only `apps/api` reads the bytes. Their refusal strings are therefore copied verbatim from the API's own `413`/`415` bodies, so the page reads identically whichever side caught the file, and anything the filter lets through is refused upstream and shown word for word rather than reworded.

Architecture and the full function reference: `docs/modules/module-web-profile.md`.

### 2026-08-20 — Profile page, and the dashboard greets by name (`user-profile` phase 2)

`/profile` is auth-gated exactly as `/` is — `getSession()` first, `redirect('/login')` before any JSX, including when `apps/api` answers `401` for a cookie that is present — so there is no signed-out state to leak. The dashboard now greets by the stored name, falling back to the email; both are server-rendered, so neither is ever swapped for the other after mount, and both are rendered as text, which is what keeps a name of markup a name.

The name goes through a **Server Action**, not a Route Handler: fields are small, benefit from progressive enhancement, and `revalidatePath` is what refreshes the two pages showing them. Bytes will be the opposite case in phase 4 — Next caps a Server Action's request body at 1 MB by default, well under the 5 MB avatar limit, so those go through a proxy route instead. The action checks `getSession()` as its first statement and returns the signed-out outcome without touching `apps/api`: a Server Action is reachable by direct POST, so the form not being rendered is not a boundary. It also returns `{ ok, name }` only — an action's return value is serialised into the page payload, so upstream bodies stay out of it.

Two things about the form are non-obvious enough to be worth the note. Its field is **controlled**, because React 19 resets an uncontrolled field once a form action settles and that would discard what was typed every time the API refused it. And the refusal is withdrawn as soon as the field is edited: left in place, the field stays `isInvalid`, the browser's own constraint check blocks every further submission, and a corrected name can never be saved.

The avatar mark is HeroUI's `Avatar.Fallback` over initials, at the size the real image will use, so phase 4 costs no layout shift. `next/image` was ruled out for it up front — it fetches through `/_next/image` server-side without the browser's cookies, so a cookie-authenticated avatar would never render, and the optimizer would cache derivatives of a private image.

Architecture and the full function reference: `docs/modules/module-web-profile.md`.

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
