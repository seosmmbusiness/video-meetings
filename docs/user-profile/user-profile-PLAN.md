# Plan: User profile

**Key**: UP
**PRD**: [user-profile-PRD.md](./user-profile-PRD.md)
**Date**: 2026-08-17
**Status**: preliminary

Six phases, alternating between the layer that owns the data and the layer that consumes it, one
capability at a time: name, then avatar, then password. Each phase leaves both apps green and
usable — stopping after phase 2 leaves a working profile page with a name on it.

## Phase 1. Account name in the API

**Goal**: an account can hold a name, and the signed-in caller can read and change their own — and
only their own.
**Touches**: api · database
**Covers**: AC-2, AC-3, AC-4, AC-15
**Verified by**: Red/Green/Refactor per `apps/api/CLAUDE.md`'s Development workflow — the e2e cases
are written and reviewed with the requester first and land red in their own `test(api): …` commit,
then each unit gets its `*.spec.ts` (or `*.int-spec.ts`, if it needs Postgres) red before the code
that greens it. "Security test cases are mandatory, not optional": authorization boundaries (IDOR),
auth bypass on a protected route, and mass-assignment rejection by `ValidationPipe`'s `whitelist`,
each at the tier that proves it. Suites: `npm run test:api`, `npm run test:int:api`,
`npm run test:e2e:api`.
**Tasks**:

- [ ] **1.1** Cover reading and updating the caller's own name — tests: the e2e cases for AC-2,
      AC-3, AC-4 and AC-15 (another account's name is unreachable, and no path or body field is
      accepted as the subject of the change), plus the trim/length and mass-assignment unit cases;
      red before 1.2 starts.
- [ ] **1.2** Give an account a name it can store — the `User` model gains an optional name via a
      migration that leaves every already-registered row without one (PRD Technical constraints).
      No other model changes in this phase.
- [ ] **1.3** Read the caller's own profile — a query returns the signed-in account's email and
      name, exposed through the users module's CQRS surface exactly as its existing lookups are
      (`.claude/modules/module-api-users.md`); the module keeps exporting no providers.
- [ ] **1.4** Update the caller's own name — a command stores the name with leading and trailing
      whitespace removed, refuses one longer than 80 characters after trimming with the limit
      stated, and treats an empty submission as clearing the name (AC-2, AC-3, AC-4).
- [ ] **1.5** Expose both behind the JWT guard — a guarded route pair resolves the subject from the
      verified token alone, never from a path segment or a body field, so there is nothing for a
      caller to point at another account (AC-15); Swagger-annotated per `apps/api/CLAUDE.md`.
- [ ] **1.6** Update the users module doc — `.claude/modules/module-api-users.md` gains the new
      commands/queries, the route pair and the subject-from-token rule; JSDoc on every function
      added, and the change recorded in `apps/api/HISTORY.md`.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green, and
the e2e run shows a signed-in caller reading their own profile, storing an 80-character name,
being refused an 81-character one with the limit named, clearing it, and getting nothing when
aiming at another account.

## Phase 2. Profile page and the name on the dashboard

**Goal**: the user has a page showing their email and name, can change the name there, and the
dashboard greets them by it instead of by their email address.
**Touches**: web
**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-14, AC-16, AC-17
**Verified by**: "Tests come before the code, at every tier that applies — not e2e alone"
(`apps/web/CLAUDE.md`, Development workflow): Vitest + RTL for `src/lib` and Client Components,
Server Actions called directly as `*.int-spec.ts(x)`, Playwright for the page, its auth gate and
its redirects — an async Server Component cannot be rendered by Vitest/RTL, so its rendering and
its gate are e2e's job. Security cases are mandatory: safe rendering of user-controlled input, the
protected page against a missing/tampered session, and the absence of the token from the page
source and client bundle. After building the UI, review it with `web-design-guidelines` then
`ui-ux-pro-max` and verify visually with the Playwright MCP tools against a running dev server.
Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **2.1** Cover the profile page and the dashboard's name — tests: Playwright cases for AC-1,
      AC-5, AC-14 and AC-16 plus AC-17's "no token in the HTML or the bundle", and Vitest cases for
      the name form's feedback and the server-only profile client; red before 2.2 starts.
- [ ] **2.2** Read the caller's profile server-side — a server-only client for phase 1's routes,
      sitting beside `lib/meetings-api.ts` and throwing `ApiError` on a non-2xx exactly as it does
      (`.claude/modules/module-web-auth.md`).
- [ ] **2.3** Ship the profile page — a Server Component route rendering email, name and the
      default avatar placeholder in the server's first response, redirecting to `/login` before any
      JSX when there is no session or the API refuses the one there is (AC-1, AC-14); reachable
      from the dashboard.
- [ ] **2.4** Change the name from the page — a Server Action submits the name, re-renders the page
      with the stored value on success and shows the API's refusal message verbatim on failure;
      any client-side feedback mirrors the API's rules rather than replacing them (AC-2, AC-3,
      AC-4).
- [ ] **2.5** Greet the user by name on the dashboard — `/` shows the name when one is set and the
      email when not, in the server-rendered HTML, with no client-side read after mount (AC-5).
- [ ] **2.6** Document the profile module — a new `.claude/modules/module-web-profile.md` per the
      root `CLAUDE.md`'s Module documentation section, its row in `.claude/modules/INDEX.md`, the
      one-line pointer plus Status line in `apps/web/CLAUDE.md`, and the entry in
      `apps/web/HISTORY.md`.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a signed-in user sets a name
on the profile page and sees it on `/` after a hard refresh with no flash of the email first; a
signed-out visitor asking for the profile page lands on `/login` with no profile data in the
response; a name containing markup renders as text.

## Phase 3. Avatar upload and serving in the API

**Goal**: an account can hold one avatar image — its owner uploads, replaces, fetches and removes
it, and nobody else can fetch it.
**Touches**: api · database · storage
**Covers**: AC-6, AC-7, AC-8, AC-9, AC-15
**Verified by**: same as phase 1 — Red/Green/Refactor per `apps/api/CLAUDE.md`'s Development
workflow, e2e cases red and committed first, unit/integration inner loop after, mandatory security
cases (IDOR on the bytes, auth bypass, refusal of a file whose content contradicts its name).
Suites: `npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **3.1** Cover avatar upload, serving and removal — tests: the e2e cases for AC-6, AC-7, AC-8,
      AC-9 and AC-15, including a file over 5 MB, a non-image renamed to `.png`, and another
      account's avatar answering a refusal rather than bytes; red before 3.2 starts.
- [ ] **3.2** Give an account an avatar it can store — the `User` model gains what one avatar needs
      via a migration; every already-registered row starts without one.
- [ ] **3.3** Store and replace one avatar per account — the bytes go through the existing abstract
      `FileStorage` boundary (`.claude/modules/module-api-files.md`) rather than a second storage
      path, and replacing an avatar leaves the previous image unserved and its bytes gone (AC-6).
- [ ] **3.4** Refuse anything but a 5 MB PNG, JPEG or WebP — the size ceiling is decided before the
      body is read, and the type from the file's content rather than its name, extension or
      declared `Content-Type`; each refusal names its reason and leaves the current avatar and the
      stored bytes untouched (AC-7, AC-8).
- [ ] **3.5** Serve and remove the owner's avatar — guarded routes return the caller's own image
      bytes and remove it back to "no avatar", both resolving the subject from the verified token
      alone (AC-9, AC-15), with the response headers keeping one owner's private bytes out of a
      shared cache.
- [ ] **3.6** Update the files and users module docs — `.claude/modules/module-api-files.md` and
      `module-api-users.md` for whichever gains the avatar's behaviour, Swagger annotations for the
      new routes and DTOs, JSDoc on every function added, entry in `apps/api/HISTORY.md`.

**Done when**: the three api suites are green, and the e2e run shows an upload, a replacement, a
removal, a 5 MB-plus refusal, a renamed-non-image refusal, and another account's avatar answering
a refusal instead of bytes.

## Phase 4. Avatar in the profile and on the dashboard

**Goal**: the user uploads, replaces and removes their avatar in the browser and sees it on both
pages, without the session token ever reaching the browser.
**Touches**: web
**Covers**: AC-1, AC-5, AC-6, AC-7, AC-8, AC-9, AC-17
**Verified by**: same as phase 2 — tests before the code at every tier: the byte proxy as a Route
Handler `*.int-spec.ts` called directly (the tier `apps/web/CLAUDE.md` names for "the proxy's
request/response header allow-list, the bearer token being attached server-side while the caller's
own `Authorization` is dropped, the pre-upstream `401`"), the upload control through Vitest + RTL,
the two pages through Playwright. UI reviewed with `web-design-guidelines` then `ui-ux-pro-max` and
verified visually with the Playwright MCP tools. Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **4.1** Cover the avatar UI and its byte proxy — tests: integration cases for the proxy's
      header allow-list, its server-side token attachment and its pre-upstream refusal, Playwright
      cases for AC-6, AC-7, AC-8, AC-9 and AC-17 through the page; red before 4.2 starts.
- [ ] **4.2** Proxy the avatar bytes same-origin — a Route Handler forwards to phase 3's routes with
      the session token attached server-side, on the shape `lib/api-proxy.ts` already implements
      for meeting files (`.claude/modules/module-web-meeting-files.md`), so no token and no
      cross-origin call appears in the browser (AC-17).
- [ ] **4.3** Upload and replace the avatar in the browser — a control on the profile page that
      refuses a file over 5 MB or of the wrong type before sending it, surfaces the API's refusal
      verbatim when one gets past that check, and shows the new image without a manual reload
      (AC-6, AC-7, AC-8).
- [ ] **4.4** Remove the avatar from the profile page — a control that returns the page to the
      default placeholder (AC-9).
- [ ] **4.5** Show the avatar next to the user on both pages — the profile page and the dashboard
      render the image when there is one and the placeholder when there is not, in the first server
      response rather than after mount (AC-1, AC-5).
- [ ] **4.6** Update the profile module doc — `.claude/modules/module-web-profile.md` gains the
      avatar UI and the proxy route, `apps/web/CLAUDE.md`'s Structure/Status lines follow, JSDoc on
      every function added, entry in `apps/web/HISTORY.md`.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a user uploads an avatar and
sees it on the profile page and on `/`, is refused an oversized and a wrong-type file with the
reason on screen, removes it back to the placeholder; and the UI review pass has run.

## Phase 5. Password change and session revocation

**Goal**: the owner changes their password by proving the current one, and every other session of
that account stops working the moment they do.
**Touches**: api · database
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-15
**Verified by**: same as phase 1, with the rate-limiting/brute-force class of `apps/api/CLAUDE.md`'s
mandatory security cases applying here as it does to login — the current-password check is a
credential check on a route a signed-in caller can hammer. E2e proves the revocation through real
HTTP with two tokens; the guard's own decision is a unit spec. Suites: `npm run test:api`,
`npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **5.1** Cover the password change and session revocation — tests: the e2e cases for AC-10,
      AC-11, AC-12, AC-13 (a token minted before the change is refused after it, while the token
      that made the change keeps working) and AC-15, plus unit cases for the new password's rules
      and the guard's revocation decision; red before 5.2 starts.
- [ ] **5.2** Change the password behind the current one — a guarded route verifies the current
      password through the credentials module's existing timing-safe verification
      (`.claude/modules/module-api-credentials.md`) and stores the new hash; a wrong current
      password is refused saying so, changes nothing and ends no session (AC-10, AC-11).
- [ ] **5.3** Hold the new password to the registration rules — the same length and complexity
      bounds `RegisterDto` enforces, with the failed rule named in the refusal (AC-12).
- [ ] **5.4** Make a session revocable per account — an account carries something every guarded
      request checks the presented token against, so tokens issued before a password change stop
      being accepted; the mechanism is `research`'s to choose, the observable behaviour is that a
      pre-change token is refused (AC-13).
- [ ] **5.5** Keep the changing session alive — the caller that changed the password continues
      without signing in again, while every other token for that account is refused on its next
      request (AC-13).
- [ ] **5.6** Update the auth and credentials module docs — `.claude/modules/module-api-auth.md`
      (the revocation check and what the guard now reads), `module-api-users.md` and
      `module-api-credentials.md` where they change, Swagger for the new route and DTO, JSDoc, and
      the entry in `apps/api/HISTORY.md`.

**Done when**: the three api suites are green, and the e2e run shows the password changing, the old
password refused at `/auth/login`, a wrong current password refused with nothing changed, a
rule-breaking new password refused with the rule named, and a token minted before the change
refused afterwards while the changing caller's own token still works.

## Phase 6. Password change on the profile page

**Goal**: the user changes their password from the profile page and both outcomes land — their own
session carries on, and a session revoked elsewhere ends up on `/login`.
**Touches**: web
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-14, AC-17
**Verified by**: same as phase 2 — tests first at every tier: the Server Action and the session
write as `*.int-spec.ts`, the form's confirmation feedback through Vitest + RTL, and the two-session
behaviour through Playwright with a second browser context. Mandatory security cases: no password
and no token in the page source, the client bundle or any browser-visible response, and the
protected page against a revoked session. UI reviewed with `web-design-guidelines` then
`ui-ux-pro-max`. Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **6.1** Cover the password form and the revoked session — tests: Playwright cases for AC-10,
      AC-11, AC-12 and AC-13 (a second browser context is refused after the first changes the
      password) plus AC-17, and Vitest cases for the confirmation mismatch and the Server Action;
      red before 6.2 starts.
- [ ] **6.2** Change the password from the profile page — a form taking the current password, the
      new one and its confirmation, submitting through a Server Action, showing a confirmation on
      success and the API's refusal verbatim on failure; the mismatch gate runs server-side so it
      still holds with JavaScript disabled (AC-10, AC-11, AC-12).
- [ ] **6.3** Keep the caller signed in after the change — whatever phase 5 hands back is applied to
      the session cookie server-side, so the user continues without re-login and the token still
      never reaches the browser (AC-13, AC-17).
- [ ] **6.4** Land a revoked session on `/login` — a refusal caused by a revoked token is treated as
      signed-out on every page that can meet it, the way `.claude/modules/module-web-auth.md`
      already treats a `401` from `listMeetings` (AC-13, AC-14).
- [ ] **6.5** Update the profile module doc and Status — `.claude/modules/module-web-profile.md`,
      `apps/web/CLAUDE.md`'s Status, JSDoc on every function added, and the entries in
      `apps/web/HISTORY.md` and the root `HISTORY.md` for the feature as a whole.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; two browser contexts signed
in as the same account show that changing the password in one leaves that context working and sends
the other to `/login` on its next action; and the UI review pass has run.

## Asked & assumed

- **Asked** — Which cut to take → six phases alternating api → web per capability (name, avatar,
  password), chosen over a risk-first cut that builds session revocation in phase 1 and over three
  vertical end-to-end phases; the vertical cut was rejected for putting 7–8 building tasks in a
  phase against a ceiling of five, the risk-first cut for leaving two phases with nothing a user
  can see.
- **Asked** — Whether AC-13's session revocation gets its own phase → no, it lives inside phase 5,
  because revocation without a password change has no public surface to prove itself through.
- **Assumed** — The avatar reuses the existing `FileStorage` boundary rather than a new storage path
  · `research` may decide otherwise (D-), which would change 3.3's description but not the phase
  order.
- **Assumed** — The name and avatar routes belong to the users module rather than a new profile
  module · if `research` puts them elsewhere, phases 1 and 3 keep their tasks and only the doc
  targets in 1.6 and 3.6 move.
- **Assumed** — The profile page is one route carrying all three sections, so phases 2, 4 and 6 each
  extend the same page · if the sections split across routes, 4.5 and 6.2 gain a route each and
  nothing else moves.
- **Assumed** — Phase 5's revocation applies to tokens rather than to a stored session list, and
  `research` decides how · the observable in 5.4 and the e2e case in 5.1 hold either way.

## Revisions

<!-- Written by the later stages — one line per change: what moved, and what caused it. -->
