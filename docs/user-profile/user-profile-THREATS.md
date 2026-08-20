# Threats: User profile

**Key**: UP
**PRD**: [user-profile-PRD.md](./user-profile-PRD.md)
**Plan**: [user-profile-PLAN.md](./user-profile-PLAN.md)
**Research**: [user-profile-RESEARCH.md](./user-profile-RESEARCH.md)
**Date**: 2026-08-17

## 1. Verdict

This feature puts an account's own credential material behind six new API routes and three new web
entry points, and it changes the authentication path of **every** guarded route in `apps/api`
(D-9). The surface is unusually narrow for that: not one route takes an identifier for the thing it
acts on — every subject is read from the verified token — so the classic IDOR shape the meeting
files needed guards for cannot be expressed here at all.

What is left is the material the routes hand back and the paths that reach them. Six findings:
**one high** (S-1 — the users module's own query returns `passwordHash`, `tokenVersion` and
`avatarKey`, and two of the three would leave in a response body if a handler ever returns the row
it got), **three medium** (S-3 direct POST to a Server Action, S-4 brute-forcing the current
password, S-6 the re-issued token leaking into the browser through an action's return value), and
**two low** (S-2 control bytes in the name, S-5 orphaned avatar bytes). None is a design flaw: each
closes with a control this repo already writes elsewhere, and each is now written into the task that
builds its entry point.

Three of them had nothing in the PRD to prove them against, so the user raised them into criteria:
**AC-18** (no credential material in any profile response), **AC-19** (a Server Action without a
session changes nothing), **AC-20** (10 password attempts per minute).

## 2. Threat map

| Phase | Tasks         | Findings |
| ----- | ------------- | -------- |
| 1     | 1.1, 1.4, 1.5 | S-1, S-2 |
| 2     | 2.1, 2.4      | S-3      |
| 3     | 3.1, 3.3, 3.5 | S-1, S-5 |
| 4     | 4.2           | —        |
| 5     | 5.1, 5.2, 5.5 | S-1, S-4 |
| 6     | 6.1, 6.2, 6.3 | S-3, S-6 |

## 3. Surface

**Assets**

- The account's `passwordHash` — bcrypt, 12 rounds; the one asset in this feature whose disclosure
  is unrecoverable.
- `tokenVersion` — the revocation counter; knowing it does not forge a token, but a response
  carrying it publishes an internal auth mechanism.
- The session token — one hour of the account, and the thing every existing control keeps out of the
  browser.
- The account's `name` and `email` — personal data, the owner's own.
- The avatar bytes and their `avatarKey` — the owner's own image, and the path it lives at under
  `STORAGE_ROOT`.
- Spend: disk under `STORAGE_ROOT`, bcrypt CPU (~12 rounds per verification), and one database
  lookup per guarded request once D-9 lands.

**Entry points**

| Entry point                                  | Who may reach it                            | Assets it touches                                        | Task     |
| -------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- | -------- |
| `GET /profile`                               | any caller with a valid token, own row only | name, email, avatar presence                             | 1.5      |
| `PATCH /profile` (name)                      | same                                        | name                                                     | 1.4, 1.5 |
| `POST /profile/avatar` (multipart)           | same                                        | avatar bytes, disk                                       | 3.3, 3.4 |
| `GET /profile/avatar` (bytes)                | same                                        | avatar bytes                                             | 3.5      |
| `DELETE /profile/avatar`                     | same                                        | avatar bytes, disk                                       | 3.5      |
| `PATCH /profile/password`                    | same                                        | passwordHash, tokenVersion, every session of the account | 5.2      |
| `JwtStrategy.validate` (every guarded route) | any caller with a **signature-valid** token | tokenVersion, one DB read per request                    | 5.4      |
| web `/profile` page (Server Component)       | anonymous — gated inside                    | everything the page renders                              | 2.3      |
| web Server Action — update name              | **anonymous, by direct POST**               | name                                                     | 2.4      |
| web Server Action — change password          | **anonymous, by direct POST**               | passwordHash, the session cookie                         | 6.2, 6.3 |
| web Route Handler `/api/profile/avatar`      | anonymous — refused pre-upstream            | avatar bytes                                             | 4.2      |
| web dashboard `/`                            | anonymous — redirects                       | name, avatar                                             | 2.5, 4.5 |

**Trust boundaries**: browser → `apps/web` (session cookie, `httpOnly`, `sameSite: 'lax'`) →
`apps/api` (bearer token, verified signature + `ver` claim) → Postgres (Prisma, parameterised) ·
disk under `STORAGE_ROOT` (`0o700` dirs, `0o600` files). No third party is called, and no new
boundary is introduced.

### Checklist coverage

Every entry point through all ten classes; a class that was already closed names what closes it.

| Class                       | Outcome                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ownership                | **Held by design** — no route accepts an id for its subject (D-1); the storage key is read from the caller's own row (D-7/D-8). The IDOR class cannot be expressed.                                                                                                                                                                                                                                                  |
| 2. Authentication           | **Held** — `JwtAuthGuard` at the class level of `ProfileController`, the idiom `FilesController` uses; the web page and proxy route gate on `getSession()` before rendering or forwarding. Server Actions are the gap → **S-3**.                                                                                                                                                                                     |
| 3. Input                    | Global `ValidationPipe({ whitelist: true, transform: true })` strips unknown fields; DTO bounds from Parameters. Control bytes in `name` are the gap → **S-2**.                                                                                                                                                                                                                                                      |
| 4. Injection and traversal  | **Held** — Prisma parameterises, no `$queryRaw` anywhere in the plan; the storage key is server-generated (`users/<userId>/avatar/<uuid>`, UUIDs only) so no user string ever becomes a path; the byte route keeps `send`'s `root` + basename split (D-8).                                                                                                                                                           |
| 5. Spend                    | Upload size gated twice before the row exists (D-6); bcrypt input capped at 72 bytes. Password brute force → **S-4**; avatar disk → **S-5**. The per-request DB read (D-9) only fires on a **signature-valid** token, so an anonymous flood cannot reach it, and the global 20 req/60 s throttle bounds a valid one.                                                                                                 |
| 6. Exposure                 | `hasAvatar` instead of a URL (D-5); the DTO is the only thing between the Prisma row and the wire → **S-1**. The re-issued token crossing into the browser → **S-6**.                                                                                                                                                                                                                                                |
| 7. Secrets                  | **Held** — the only new env vars are `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`, which carry no secret and default to the production 20 req/60 s baseline when unset or unusable (phase 2; see the note below the table); nothing `NEXT_PUBLIC_`-prefixed; `JWT_SECRET` stays in `apps/api`; D-7 logs counts, never keys; the throttler already hashes the `Authorization` header rather than storing it.                    |
| 8. Session and browser      | **Held** — the cookie keeps `httpOnly` / `sameSite: 'lax'` / `secure` in production and is rewritten, not re-issued client-side (6.3). CSRF: `lax` withholds the cookie from cross-site `POST`, and a cross-origin `DELETE` is preflighted and refused; Next verifies Origin/Host for Server Actions. `CORS_ORIGIN` is unchanged — the browser never calls `apps/api` directly. No redirect target comes from input. |
| 9. Storage and dependencies | **Held** — no new dependency, so nothing new to audit (research §6). Avatar bytes land under the existing `0o700`/`0o600` regime; D-4 moves that code, and phase 3's **Done when** holds the meeting-files suites green across the move, which is what proves the modes and the lazy `resolveStorageRoot()` survived. Redis is untouched and holds nothing.                                                          |
| 10. Errors and timing       | **Held** — the current-password check always runs `bcrypt.compare` through `VerifyPasswordQuery`'s timing-safe path; a wrong current password answers 403 with a fixed message that reveals nothing about any other account; a missing avatar is a 404 on the caller's own row, so there is nothing to enumerate.                                                                                                    |

**The configurable throttle baseline (phase 2).** Closing phase 2 found the browser e2e suite
wedged against the app-wide 20 req/60 s ceiling: every Playwright fixture registers through the
unauthenticated `POST /auth/register`, so the whole suite shares one bucket by IP and spends it
inside a single window. The baseline therefore reads `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`
(`apps/api/src/config/throttler.config.ts`), which changes the control's surface in three bounded
ways, each covered by a spec: unset keeps 20 req/60 s, so **production is unchanged**; anything
unparseable, zero, negative or fractional falls back to that default rather than widening or
disabling the guard, so a typo cannot silently remove the control; and **only the baseline moves** —
the route-level overrides that the rows above lean on (S-4's `limit: 10` on login, the upload and
download caps) stay in the code and are unreachable from the environment. The residual risk is an
operator setting a high ceiling in a deployed environment on purpose; that is a deployment-config
decision of the same kind as `JWT_SECRET`, and `.env.example` labels the widened values as local-only.

Two classes worth recording as **examined and deliberately empty**: an uploaded image is never
decoded server-side (no `sharp`, no thumbnailing — the PRD put resizing out of scope), so a
decompression bomb costs only the uploader's own browser; and SVG is absent from the accepted type
set (D-6), which is what keeps the classic stored-XSS-via-avatar vector off this surface entirely.
EXIF in an uploaded JPEG stays in the file, which is harmless while the avatar is owner-only — it
becomes a finding the day an avatar is shown to anyone else.

## 4. Findings

### S-1. Any signed-in caller → a profile route's response → their own `passwordHash`, `tokenVersion` and `avatarKey`

- **Reach**: the caller sends a normal authenticated `GET /profile` (or the response of `PATCH
/profile`, the avatar routes, the password route). `FindUserByIdQuery` returns the whole Prisma
  `User` row — it has to, because `JwtStrategy` needs `tokenVersion` off the same query (D-3, D-9) —
  so the row that reaches the service carries the bcrypt hash, the revocation counter and the
  storage key. A handler that returns it, spreads it, or builds the DTO with `...user` publishes all
  three.
- **Plan tasks**: 1.5, 3.5, 5.5 (spec cases in 1.1, 3.1, 5.1) · **Decisions**: D-3, D-5, D-9 ·
  **Criteria**: AC-18
- **Impact**: a bcrypt hash in a browser-visible response is offline-crackable at the attacker's
  leisure and survives every later password change the user does not make; the storage key turns
  `STORAGE_ROOT`'s layout into public knowledge; `tokenVersion` publishes the revocation mechanism.
- **Severity**: **high** — one careless `return user` is all it takes, the payload is unrecoverable
  once out, and nothing in the existing suites would notice.
- **Control**: an explicit `ProfileResponseDto` built field by field in `ProfileService` — never a
  spread, never the entity — exposing exactly `{ id, email, name, hasAvatar, avatarUpdatedAt }`, the
  same rule `MeetingFileResponseDto` follows for `storageKey`. The password route returns
  `{ accessToken }` and nothing else.
- **Proven by**: an e2e case asserting the response body's **key set** exactly, not just the absence
  of one field (`expect(Object.keys(body).sort()).toEqual([...])`), on `GET /profile`,
  `PATCH /profile` and the password route; plus a unit spec on the mapper.
- **Disposition**: **promise** — AC-18, approved 2026-08-17 — written into tasks 1.5, 3.5 and 5.5,
  with the assertion cases in 1.1, 3.1 and 5.1.

### S-2. Any signed-in caller → `PATCH /profile` with control bytes in `name` → a 500 instead of a refusal

- **Reach**: the caller submits `{ "name": "a�b" }`, or a name carrying C0 control characters or
  bidirectional overrides. Postgres cannot store a NUL byte in a text column, so Prisma raises and
  the route answers `500` with a driver-shaped message rather than the stated refusal; the rest
  store cleanly and then render as a broken or misleading display string on two pages.
- **Plan tasks**: 1.4 (spec cases in 1.1) · **Decisions**: D-2 · **Criteria**: AC-2, AC-3, AC-16
- **Impact**: a self-inflicted error path with an unshaped message, and a display name that can be
  made to read as something it is not.
- **Severity**: **low** — the caller can only do it to their own row, and nothing crosses an
  authorization boundary.
- **Control**: the DTO's `@Transform` strips C0 control bytes before `@MaxLength(80)` runs — the same
  normalise-don't-reject rule `FilesService` applies to an uploaded file's name
  (`docs/modules/module-api-files.md`, "The file name is normalized, not rejected"), sitting
  beside the existing `normalizeEmail` transform.
- **Proven by**: a unit spec on the transform (NUL, ``, a bidi override in, clean text out) and
  an e2e case posting a NUL-bearing name and asserting a stored, sanitised value rather than a 500.
- **Disposition**: **work** — written into task 1.4 (no new task number: phase 1 is at the plan's
  five-building-task ceiling, per the user's ruling of 2026-08-17).

### S-3. Anonymous internet caller → direct POST to a profile Server Action → a name or password change with no session

- **Reach**: Server Functions are reachable by direct POST, not only through the rendered form — this
  repo already writes that down (`docs/modules/module-web-auth.md`) and `actions/files.ts`
  already guards for it. The new name and password actions perform privileged mutations; a signed-out
  `<form>` simply not being rendered is not a boundary. Without an explicit check the action runs
  with `session` undefined and either throws a stack-shaped 500 or forwards a malformed
  `Authorization` header upstream.
- **Plan tasks**: 2.4, 6.2 (spec cases in 2.1, 6.1) · **Decisions**: D-12 · **Criteria**: AC-19,
  AC-14
- **Impact**: no data changes — `apps/api` refuses a request with no valid bearer token — but the
  refusal happens one boundary too late, and the failure mode is an unhandled error rather than a
  stated outcome. It is the difference between a control and a coincidence.
- **Severity**: **medium** — defense in depth over an API that does hold the line, but the project's
  own documented rule, and the tier below is where it belongs.
- **Control**: `const session = await getSession(); if (!session) …` as the first statement of every
  profile Server Action, returning the signed-out outcome without touching `apps/api` — the exact
  shape of `deleteFileAction`/`restoreFileAction`.
- **Proven by**: an `*.int-spec.ts` importing the exported action, mocking `next/headers` with no
  cookie, and asserting the upstream `fetch` was never called.
- **Disposition**: **promise** — AC-19, approved 2026-08-17 — written into tasks 2.4 and 6.2.

### S-4. A signed-in caller, or anyone holding a stolen session token → `PATCH /profile/password` in a loop → the account's current password

- **Reach**: the route is a password oracle by construction: it answers 403 for a wrong current
  password and 200 for the right one. Anyone holding a session token — including one lifted from a
  shared machine — can run guesses against it, and each guess costs `apps/api` a 12-round bcrypt
  comparison. The global throttler allows 20 requests per 60 s per credential; nothing route-level
  tightens that today.
- **Plan tasks**: 5.2 (spec cases in 5.1) · **Decisions**: D-11 · **Criteria**: AC-20, AC-11
- **Impact**: the plaintext current password, which is worth more than the session that leaked it —
  it survives revocation, and it is the value users reuse elsewhere. Secondary: sustained bcrypt
  burn on the API's event loop.
- **Severity**: **medium** — it needs a valid session to start, but it converts a temporary
  compromise into a permanent one.
- **Control**: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` on the route, the same override
  `/auth/login` carries for the same reason, on top of the global tracker that keys by
  `sha256(Authorization)`; the DTO's 72-byte cap bounds the cost of each attempt.
- **Proven by**: an e2e case firing 11 password changes with a wrong current password inside the
  window and asserting the 11th answers `429`, mirroring the existing login throttle spec.
- **Disposition**: **promise** — AC-20, approved 2026-08-17 — written into task 5.2.

### S-5. Signed-in caller → repeated `POST /profile/avatar` → orphaned bytes under `STORAGE_ROOT`

- **Reach**: each upload writes a fresh key and then deletes the previous one best-effort (D-7). A
  delete that fails, or two uploads for the same account that interleave between reading the old key
  and writing the new one, leave bytes on disk that no row references. Avatars sit outside the
  20 GB-per-owner accounting (D-5), so nothing counts them.
- **Plan tasks**: 3.3 · **Decisions**: D-5, D-7 · **Criteria**: AC-6, AC-9
- **Impact**: disk consumed at up to 5 MB per orphan, unreachable by any request. No data of anyone
  else's is exposed — an orphan has no route that resolves to it.
- **Severity**: **low** — it needs the delete to fail or two uploads to race, and each orphan is
  bounded by the same 5 MB the upload was.
- **Control**: the ordering in D-7 (bytes committed → row updated → previous key deleted), the
  `@Throttle({ limit: 30, ttl: 60_000 })` row on the upload route, and the existing
  `FilesPurgeService` sweep of `<STORAGE_ROOT>/tmp` for anything multer staged and abandoned.
- **Proven by**: an `*.int-spec.ts` that uploads twice and asserts the first key's bytes are gone
  from storage after the second commits.
- **Disposition**: **held** — by task 3.3 as written and the Parameters rows behind it. The residual
  (bytes orphaned by a failed unlink) is recorded in the research's Risks section; a sweep for them
  is a candidate for `FilesPurgeService` in a later iteration, not work this feature carries.

### S-6. The re-issued session token → a Server Action's return value → the browser

- **Reach**: the password route answers with a freshly signed token (D-10), and phase 6's action has
  to put it in the session cookie. An action bound through `useActionState` returns its state to the
  client component, and that state is serialised into the page's payload — so an action that returns
  `{ accessToken }`, or spreads the API's response into its state, ships an hour-long credential into
  the browser, where `httpOnly` no longer protects it.
- **Plan tasks**: 6.3 (spec cases in 6.1) · **Decisions**: D-10, D-12 · **Criteria**: AC-17, AC-13
- **Impact**: the exact thing the whole cookie/proxy architecture exists to prevent — a session token
  readable by any script on the page, and by anything that scrapes the RSC payload.
- **Severity**: **medium** — it requires the implementer to pass the response through rather than
  read one field off it, which is the natural way to write it if nobody says otherwise.
- **Control**: the action calls `setSessionCookie(accessToken)` server-side and returns only
  `{ ok: true }` or `{ error }` — the token never appears in the returned state, the same discipline
  `loginAction`/`registerAction` already keep.
- **Proven by**: an `*.int-spec.ts` asserting the action's returned state, serialised, contains no
  JWT-shaped string, plus the existing e2e class of "the raw session token never appears in the
  rendered HTML" extended to the profile page after a password change.
- **Disposition**: **work** — written into task 6.3.

## 5. Plan impact

No new task numbers: every phase but 6 already carries the plan's five-building-task ceiling, and
the user ruled on 2026-08-17 that controls go into the descriptions of the tasks that build their
entry points rather than into a sixth task (which `docs-lint` refuses) or a re-cut of the phases.

- **1.4** — the DTO transform strips C0 control bytes before length validation — S-2.
- **1.5** — the response is an explicit `ProfileResponseDto`, built field by field, never the Prisma
  row — S-1; **1.1** gains the exact-key-set assertion.
- **2.4** — the name Server Action checks `getSession()` first — S-3.
- **3.5** — the avatar routes answer through the same explicit DTO — S-1.
- **5.2** — `@Throttle({ limit: 10, ttl: 60_000 })` on the password route — S-4.
- **5.5** — the password response carries `{ accessToken }` and nothing else — S-1.
- **6.2** — the password Server Action checks `getSession()` first — S-3.
- **6.3** — the action writes the cookie and returns no token — S-6.
- Phases 1, 2, 3, 5 and 6 gained their **Threats** line; phases 1, 3 and 5 gained AC-18, phases 2
  and 6 gained AC-19, phase 5 gained AC-20 on their **Covers**.

## Asked & assumed

- **Asked** — Which of three unpromised controls to raise into acceptance criteria → the user
  approved **all three**: AC-18 (no `passwordHash`, `tokenVersion` or `avatarKey` in any profile
  response), AC-19 (a profile Server Action without a valid session changes nothing), AC-20 (the
  password route refuses more than 10 attempts per minute from one caller).
- **Asked** — Where control tasks go, given that phases 1–5 are at the five-building-task ceiling →
  into the descriptions of the existing tasks that build each entry point, over a sixth task per
  phase (a `docs-lint` error) and over re-cutting the phases in `plan-phase`.
- **Assumed** — `apps/api` stays reachable only through `apps/web` and localhost in this iteration ·
  if it is ever exposed publicly, S-4's throttle becomes the only barrier in front of a password
  oracle and the number deserves re-reading.
- **Assumed** — The avatar stays owner-only, as the PRD fences it · the moment one user sees
  another's avatar, EXIF stripping and a decode-time guard against decompression bombs become
  findings, and both are out of scope today.
- **Assumed** — `sameSite: 'lax'` on the existing session cookie is the CSRF control for the new
  state-changing web routes, as it is for the meeting-file ones · a future move to `sameSite: 'none'`
  would reopen class 8 for every one of them, not just these.

## Revisions

<!-- One line per revision round: what moved and the D-<n> behind it, or that nothing did. -->
