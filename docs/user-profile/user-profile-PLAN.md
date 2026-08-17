# Plan: User profile

**Key**: UP
**PRD**: [user-profile-PRD.md](./user-profile-PRD.md)
**Date**: 2026-08-17
**Status**: superseded by [user-profile-FINAL.md](./user-profile-FINAL.md)

Six phases, alternating between the layer that owns the data and the layer that consumes it, one
capability at a time: name, then avatar, then password. Each phase leaves both apps green and
usable — stopping after phase 2 leaves a working profile page with a name on it.

## Phase 1. Account name in the API

**Goal**: an account can hold a name, and the signed-in caller can read and change their own — and
only their own.
**Touches**: api · database
**Covers**: AC-2, AC-3, AC-4, AC-15, AC-18
**Decisions**: D-1, D-2, D-3
**Threats**: S-1, S-2
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
      accepted as the subject of the change), plus the trim/length and mass-assignment unit cases.
      AC-18's case asserts the response body's **exact key set**, not merely the absence of one
      field (S-1), and one case posts a NUL-bearing name (S-2); red before 1.2 starts.
- [ ] **1.2** Give an account a name it can store — the `User` model gains
      `name String? @db.VarChar(80)` (D-2). One migration, `add_user_profile`, carries this phase's
      column and the ones phases 3 and 5 need (D-5, D-9) so the schema moves once; every
      already-registered row starts with none of them set (PRD Technical constraints).
- [ ] **1.3** Read the caller's own profile — `FindUserByIdQuery` returns the signed-in account's
      email and name through the users module's CQRS surface exactly as its existing lookups do
      (D-3); the module keeps exporting no providers. Phase 5's revocation check reuses this same
      query (D-9), so its result shape has to carry more than the two display fields.
- [ ] **1.4** Update the caller's own name — a command stores the name with leading and trailing
      whitespace removed, refuses one longer than 80 characters after trimming with the limit
      stated, and treats an empty submission as clearing the name (AC-2, AC-3, AC-4). The DTO's
      transform also strips the control characters listed in the research's **Name normalisation**
      row — C0, DEL and the bidi overrides/isolates, keeping `U+200E`/`U+200F` — before the length
      check, normalising rather than rejecting as `FilesService` does with a file name, so a NUL
      cannot reach Postgres and answer 500 (S-2).
- [ ] **1.5** Expose both behind the JWT guard — a new `src/profile` module (D-1) exposes
      `GET /profile` and `PATCH /profile`, guarded, resolving the subject from the verified token
      alone, never from a path segment or a body field, so there is nothing for a caller to point at
      another account (AC-15); Swagger-annotated per `apps/api/CLAUDE.md`. Both answer through an
      explicit `ProfileResponseDto` built field by field — never the Prisma row and never a spread,
      because that row carries `passwordHash`, `tokenVersion` and `avatarKey` (S-1, AC-18).
- [ ] **1.6** Update the users module doc — `.claude/modules/module-api-users.md` gains the new
      commands/queries, a new `.claude/modules/module-api-profile.md` covers the module from D-1,
      both get their rows in `.claude/modules/INDEX.md` and a pointer in `apps/api/CLAUDE.md`; JSDoc
      on every function added, and the change recorded in `apps/api/HISTORY.md`.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green, and
the e2e run shows a signed-in caller reading their own profile, storing an 80-character name,
being refused an 81-character one with the limit named, clearing it, and getting nothing when
aiming at another account.

## Phase 2. Profile page and the name on the dashboard

**Goal**: the user has a page showing their email and name, can change the name there, and the
dashboard greets them by it instead of by their email address.
**Touches**: web
**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-14, AC-16, AC-17, AC-19
**Decisions**: D-5, D-12, D-13
**Threats**: S-3
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
      the name form's feedback and the server-only profile client. AC-19's case calls the exported
      Server Action directly with `next/headers` mocked to no cookie and asserts no upstream `fetch`
      happened (S-3); red before 2.2 starts.
- [ ] **2.2** Read the caller's profile server-side — a server-only client for phase 1's routes,
      sitting beside `lib/meetings-api.ts` and throwing `ApiError` on a non-2xx exactly as it does
      (`.claude/modules/module-web-auth.md`).
- [ ] **2.3** Ship the profile page — a Server Component route at `/profile` rendering email, name
      and the placeholder half of HeroUI's `Avatar` (`Avatar.Fallback`, D-13) in the server's first
      response, redirecting to `/login` before any JSX when there is no session or the API refuses
      the one there is (AC-1, AC-14); reachable from the dashboard. The DTO carries `hasAvatar`, not
      a URL (D-5).
- [ ] **2.4** Change the name from the page — a Server Action submits the name (D-12: fields go
      through actions, only bytes need a route), re-renders the page with the stored value on
      success and shows the API's refusal message verbatim on failure; any client-side feedback
      mirrors the API's rules rather than replacing them (AC-2, AC-3, AC-4). The action reads
      `getSession()` as its first statement and returns the signed-out outcome without calling
      `apps/api` — a Server Action is reachable by direct POST, not only through the form
      (S-3, AC-19), exactly as `actions/files.ts` already guards.
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
**Covers**: AC-6, AC-7, AC-8, AC-9, AC-15, AC-18
**Decisions**: D-1, D-3, D-4, D-5, D-6, D-7, D-8
**Threats**: S-1, S-5
**Verified by**: same as phase 1 — Red/Green/Refactor per `apps/api/CLAUDE.md`'s Development
workflow, e2e cases red and committed first, unit/integration inner loop after, mandatory security
cases (IDOR on the bytes, auth bypass, refusal of a file whose content contradicts its name). D-4
moves working meeting-files code, so this phase is also held to the refactor rule in the same
document — "before starting any refactor, run all three suites first and confirm they're fully
green on the current code", then re-run after each step. Suites: `npm run test:api`,
`npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **3.1** Cover avatar upload, serving and removal — tests: the e2e cases for AC-6, AC-7, AC-8,
      AC-9 and AC-15, including a file over 5 MB, a non-image renamed to `.png`, and another
      account's avatar answering a refusal rather than bytes; AC-18's key-set assertion on the
      avatar routes' JSON (S-1), and an integration case proving a replaced avatar's bytes are gone
      from storage (S-5); red before 3.2 starts.
- [ ] **3.2** Give an account an avatar it can store — the avatar's four columns
      (`avatarKey @unique`, `avatarMimeType`, `avatarSize`, `avatarUpdatedAt`) land on `User` in the
      migration 1.2 created (D-5); every already-registered row starts without one, and the response
      DTO exposes `hasAvatar` and `avatarUpdatedAt`, never the storage key or a path.
- [ ] **3.3** Store and replace one avatar per account — `FileStorage`, `LocalDiskFileStorage` and
      `storage-root.ts` move out of `src/files` into a new `src/storage` module that exports them,
      which is what makes the boundary reachable from `profile` without importing the meeting-files
      feature (D-4); the files suites stay green across the move, with `resolveStorageRoot()` still
      a lazy `process.env` read and the `0o700`/`0o600` modes intact. Bytes commit under
      `users/<userId>/avatar/<uuid>`, the row is updated, then the previous image's bytes are
      deleted best-effort, so a replacement is never half-visible (D-7, AC-6).
- [ ] **3.4** Refuse anything but a 5 MB PNG, JPEG or WebP — `FileTypeService` moves into
      `src/storage` alongside the boundary and takes its accepted-MIME set as a parameter, so
      `files` keeps its twelve types and `profile` passes its three (D-4); the 5 MB ceiling is
      decided in a guard before `FileInterceptor` reads a byte and again inside multer for a chunked
      body, and the type comes from the content, never the name, extension or declared
      `Content-Type` (D-6). Each refusal names its reason and leaves the current avatar and the
      stored bytes untouched (AC-7, AC-8).
- [ ] **3.5** Serve and remove the owner's avatar — guarded routes return the caller's own image
      bytes and remove it back to "no avatar", both resolving the subject from the verified token
      alone (AC-9, AC-15), with `Cache-Control: private, no-store`, `nosniff` and the
      `root`+basename split `send` needs, all as the file content route already does (D-8). Their
      JSON answers go through the same explicit DTO as 1.5 — no storage key, no hash, no revocation
      counter (S-1, AC-18).
- [ ] **3.6** Update the storage, files and profile module docs — a new
      `.claude/modules/module-api-storage.md` for the extracted module, `module-api-files.md`
      pointing at it, `module-api-profile.md` gaining the avatar routes, `.claude/modules/INDEX.md`
      and `apps/api/CLAUDE.md` rows, Swagger annotations for the new routes and DTOs, JSDoc on every
      function added, entry in `apps/api/HISTORY.md`.

**Done when**: the three api suites are green — including every meeting-files spec, unchanged in
behaviour after D-4's move — and the e2e run shows an upload, a replacement, a removal, a
5 MB-plus refusal, a renamed-non-image refusal, and another account's avatar answering a refusal
instead of bytes.

## Phase 4. Avatar in the profile and on the dashboard

**Goal**: the user uploads, replaces and removes their avatar in the browser and sees it on both
pages, without the session token ever reaching the browser.
**Touches**: web
**Covers**: AC-1, AC-5, AC-6, AC-7, AC-8, AC-9, AC-17
**Decisions**: D-8, D-12, D-13
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
- [ ] **4.2** Proxy the avatar bytes same-origin — a Route Handler at `/api/profile/avatar`
      (`GET`/`POST`/`DELETE`) forwards to phase 3's routes with the session token attached
      server-side, on the shape `lib/api-proxy.ts` already implements for meeting files
      (`.claude/modules/module-web-meeting-files.md`), so no token and no cross-origin call appears
      in the browser (AC-17). A Server Action cannot carry these bytes: Next caps an action's
      request body at 1 MB by default, against a 5 MB avatar (D-12).
- [ ] **4.3** Upload and replace the avatar in the browser — a control on the profile page that
      refuses a file over 5 MB or of the wrong type before sending it, surfaces the API's refusal
      verbatim when one gets past that check, and shows the new image without a manual reload
      (AC-6, AC-7, AC-8).
- [ ] **4.4** Remove the avatar from the profile page — a control that returns the page to the
      default placeholder (AC-9).
- [ ] **4.5** Show the avatar next to the user on both pages — the profile page and the dashboard
      render HeroUI's `Avatar.Image` when `hasAvatar` and `Avatar.Fallback` when not, in the first
      server response rather than after mount (AC-1, AC-5). The `src` is the proxy URL with
      `?v=<avatarUpdatedAt>`; `next/image` is not used — `/_next/image` fetches its source without
      the session cookie and would 401 (D-13).
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
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-15, AC-18, AC-20
**Decisions**: D-1, D-3, D-9, D-10, D-11
**Threats**: S-1, S-4
**Verified by**: same as phase 1, with the rate-limiting/brute-force class of `apps/api/CLAUDE.md`'s
mandatory security cases applying here as it does to login — the current-password check is a
credential check on a route a signed-in caller can hammer. E2e proves the revocation through real
HTTP with two tokens; the guard's own decision is a unit spec. Suites: `npm run test:api`,
`npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **5.1** Cover the password change and session revocation — tests: the e2e cases for AC-10,
      AC-11, AC-12, AC-13 (a token minted before the change is refused after it, while the token
      that made the change keeps working) and AC-15, plus unit cases for the new password's rules
      and the guard's revocation decision. AC-20's case fires 11 wrong-current-password attempts
      inside the window and asserts the 11th is `429` (S-4); AC-18's asserts the response body holds
      `accessToken` and nothing else (S-1); red before 5.2 starts.
- [ ] **5.2** Change the password behind the current one — `PATCH /profile/password` verifies the
      current password through the credentials module's existing timing-safe verification
      (`.claude/modules/module-api-credentials.md`) and stores the new hash; a wrong current password
      is refused with **403**, not 401 — `apps/web` reads 401 as "signed out" and would sign the user
      out on a typo, and D-9 makes 401 the revoked-token answer (D-11) — changing nothing and ending
      no session (AC-10, AC-11). The route carries
      `@Throttle({ default: { limit: 10, ttl: 60_000 } })`, the same override `/auth/login` has:
      it answers whether a supplied password is the account's, so it is a password oracle behind one
      stolen session (S-4, AC-20).
- [ ] **5.3** Hold the new password to the registration rules — the same length and complexity
      bounds `RegisterDto` enforces, with the failed rule named in the refusal (AC-12).
- [ ] **5.4** Make a session revocable per account — `User.tokenVersion` (migration from 1.2), a
      `ver` claim on every issued token, and a `FindUserByIdQuery` lookup in `JwtStrategy.validate`
      that refuses any token whose `ver` no longer matches; a missing `ver` reads as `0`, so tokens
      issued before this ships stay valid until their own `exp` rather than signing everyone out on
      deploy. `UpdateUserPasswordCommand` writes the hash and increments `tokenVersion` in one
      `UPDATE` (D-9). This touches the authentication path of **every** guarded route.
- [ ] **5.5** Keep the changing session alive — the route answers with a freshly signed token
      carrying the new `ver`, minted through auth's `IssueAccessTokenCommand` so the claim set lives
      in one place (D-10), and the response body is `{ accessToken }` alone — the user row it was
      built from never reaches the wire (S-1, AC-18). The token is signed **after** the increment,
      so the caller continues without signing in again while every other token for that account is
      refused on its next request (AC-13).
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
**Covers**: AC-10, AC-11, AC-12, AC-13, AC-14, AC-17, AC-19
**Decisions**: D-9, D-11, D-12
**Threats**: S-3, S-6
**Verified by**: same as phase 2 — tests first at every tier: the Server Action and the session
write as `*.int-spec.ts`, the form's confirmation feedback through Vitest + RTL, and the two-session
behaviour through Playwright with a second browser context. Mandatory security cases: no password
and no token in the page source, the client bundle or any browser-visible response, and the
protected page against a revoked session. UI reviewed with `web-design-guidelines` then
`ui-ux-pro-max`. Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **6.1** Cover the password form and the revoked session — tests: Playwright cases for AC-10,
      AC-11, AC-12 and AC-13 (a second browser context is refused after the first changes the
      password) plus AC-17, and Vitest cases for the confirmation mismatch and the Server Action.
      AC-19's case invokes the action with no cookie and asserts nothing was called (S-3); a further
      case serialises the action's returned state and asserts it holds no JWT-shaped string (S-6);
      red before 6.2 starts.
- [ ] **6.2** Change the password from the profile page — a form taking the current password, the
      new one and its confirmation, submitting through a Server Action (D-12), showing a
      confirmation on success and the API's refusal verbatim on failure; a **403** is a form error
      shown in place, never a sign-out (D-11); the mismatch gate runs server-side so it still holds
      with JavaScript disabled (AC-10, AC-11, AC-12). Like 2.4, it reads `getSession()` first and
      changes nothing without one (S-3, AC-19).
- [ ] **6.3** Keep the caller signed in after the change — the `accessToken` phase 5 returns is
      written to the session cookie by the Server Action through the existing `setSessionCookie`, so
      the user continues without re-login and the token still never reaches the browser (D-10,
      AC-13, AC-17). The action's **returned state** carries `{ ok }` or `{ error }` and never the
      token or the API's response object — an action's return value is serialised into the page
      payload, where `httpOnly` protects nothing (S-6).
- [ ] **6.4** Land a revoked session on `/login` — a `401` caused by a revoked token is treated as
      signed-out on every page that can meet it, the way `.claude/modules/module-web-auth.md`
      already treats a `401` from `listMeetings`; the profile client keeps `401` (signed out) and
      `403` (refused, stay put) apart (D-11, AC-13, AC-14).
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

- 2026-08-17 — every phase gained its **Decisions** line — research D-1…D-13.
- 2026-08-17 — 1.2 now names the columns and folds phases 3 and 5's schema into one migration, 1.3
  names `FindUserByIdQuery` and the shape phase 5 reuses — D-2, D-3, D-5, D-9.
- 2026-08-17 — 1.5 and 1.6 name the new `src/profile` module and its doc — D-1.
- 2026-08-17 — 2.3, 2.4, 4.2, 4.5 name HeroUI's `Avatar`, the `hasAvatar` DTO field, and the split
  between Server Actions (fields) and the byte proxy route (Next caps an action body at 1 MB) —
  D-5, D-12, D-13.
- 2026-08-17 — 3.3 and 3.4 carry the `src/storage` extraction and `FileTypeService`'s accepted-set
  parameter; 3.2 names the avatar columns, 3.5 the cache/serving headers, 3.6 the new storage doc;
  the phase's **Verified by** and **Done when** now hold the meeting-files suites green across the
  move — D-4, D-5, D-6, D-7, D-8.
- 2026-08-17 — 5.2 fixes 403 (not 401) for a wrong current password, 5.4 names
  `tokenVersion`/`ver`/`JwtStrategy`, 5.5 names `IssueAccessTokenCommand` — D-9, D-10, D-11.
- 2026-08-17 — 6.2, 6.3 and 6.4 name the 401-vs-403 split and the cookie rewrite — D-10, D-11, D-12.
- 2026-08-17 — phases 1, 2, 3, 5 and 6 gained their **Threats** line; AC-18 joined phases 1, 3 and
  5's **Covers**, AC-19 phases 2 and 6's, AC-20 phase 5's — threats S-1…S-6, criteria approved by
  the user the same day.
- 2026-08-17 — 1.5, 3.5 and 5.5 now answer through an explicit DTO built field by field, never the
  Prisma row (which carries `passwordHash`, `tokenVersion`, `avatarKey`) — threats S-1.
- 2026-08-17 — 1.4 strips C0 control bytes in the DTO transform before the length check — threats
  S-2.
- 2026-08-17 — 2.4 and 6.2 check `getSession()` as their first statement, since a Server Action is
  reachable by direct POST — threats S-3.
- 2026-08-17 — 5.2 carries `@Throttle({ limit: 10, ttl: 60_000 })`, the `/auth/login` override —
  threats S-4.
- 2026-08-17 — 6.3's action returns `{ ok }`/`{ error }` and never the re-issued token — threats
  S-6.
- 2026-08-17 — 1.1, 2.1, 3.1, 5.1 and 6.1 gained the cases that prove the controls above — threats
  S-1…S-6. No task number was added: every phase but 6 is at the five-building-task ceiling, and the
  user ruled that controls go into the tasks that build their entry points.
- 2026-08-17 — research round 2: 1.4 now points at the **Name normalisation** parameter rather than
  saying "C0 control bytes", since that row also covers DEL and the bidi overrides — research
  round 2, trigger 2, behind threats S-2. Nothing else in the plan moved.
