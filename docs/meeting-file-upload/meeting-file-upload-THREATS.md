# Threats: Meeting file upload

**Key**: MFU
**PRD**: [meeting-file-upload-PRD.md](./meeting-file-upload-PRD.md)
**Plan**: [meeting-file-upload-PLAN.md](./meeting-file-upload-PLAN.md)
**Research**: [meeting-file-upload-RESEARCH.md](./meeting-file-upload-RESEARCH.md)
**Date**: 2026-08-16

## 1. Verdict

This feature is the first in the repo where a request carries **bytes** and where a URL, not a JSON
body, is the thing worth stealing. It adds six API routes, two same-origin proxy routes on the web
app, a page, two Server Actions and a directory on disk — and it does all of that behind controls
that already exist: `JwtAuthGuard` on every route, `MeetingsService.findOneForOwner`'s 404 parity,
the global `ValidationPipe` whitelist, the throttler, and an `httpOnly`/`lax` session cookie.

Seven findings are reachable, and none of them come from a missing framework control — they come
from the three places bytes change the arithmetic. **Ordering**: the plan checks ownership in the
handler, but multipart is consumed by an interceptor that runs first, so a signed-in stranger's 500
MB is on disk before the 404 is decided (S-1). **Composite identity**: a file id is only safe when
it is looked up together with its meeting and that meeting's owner — a two-step check is the
classic nested-resource IDOR, and it is the one finding here that hands over another person's data
(S-2). **Accounting**: the 20 GB ceiling is checked when a file is committed, while the disk is
spent while it streams, and that disk is shared with Postgres (S-3). The rest are a proxy that must
refuse an anonymous caller before it opens an upstream request (S-4), file permissions and a
storage root that must not default into the checkout in production (S-5), a filename that must be
bounded before it reaches the database (S-6), and `res.sendFile`'s default `Cache-Control: public`
on bytes that are anything but (S-7). One residual risk — PDFs rendered `inline` from the app's own
origin, which AC-10 requires — the user accepted on 2026-08-16 (S-8).

All seven controls are implementable with the mechanisms the research already chose: a guard, a
compound `where`, an in-process reservation, a session check, two file modes, a validator and one
header. Nothing here reopens a decision, so nothing goes back to `research`.

**Round 2** adds an eighth, S-9, and it comes from the round itself: raising the request timeout to
thirty minutes so a slow link can finish a 500 MB upload also lets one credential hold six times as
many requests open, and nothing in the application bounds concurrency. Its control is an inactivity
timeout — one line beside the one that raised the total — but its threshold is the single value in
this file that the research **Parameters** table does not carry.

## 2. Threat map

| Phase | Tasks              | Findings                |
| ----- | ------------------ | ----------------------- |
| 1     | 1.2, 1.3, 1.4, 1.5 | S-1, S-2, S-5, S-6, S-7 |
| 2     | 2.1, 2.4           | S-3, S-9                |
| 3     | 3.1, 3.2, 3.3      | S-2                     |
| 4     | 4.4, 4.5           | S-4, S-7                |
| 5     | 5.1                | S-4                     |
| 6     | 6.2                | S-8                     |

## 3. Surface

**Assets**

- **File bytes** under `STORAGE_ROOT` — one owner's recordings and documents, the only asset here
  that exists outside the database.
- **`meeting_files` rows** — name, size, type, times; the name is user-supplied text.
- **The existence signal** — that a meeting or a file exists at all, which AC-15 makes an asset in
  its own right.
- **The session JWT** — in an `httpOnly` cookie on the web app, in an `Authorization` header on the
  API.
- **The machine** — disk shared with Postgres, write bandwidth, and the process itself.
- **`STORAGE_ROOT`** — a path read from the environment at boot.

**Entry points**

| Entry point                                             | Who may reach it        | Assets it touches                | Task     |
| ------------------------------------------------------- | ----------------------- | -------------------------------- | -------- |
| `POST /meetings/:meetingId/files` (multipart)           | any signed-in caller    | bytes, rows, disk, bandwidth     | 1.3      |
| `GET /meetings/:meetingId/files`                        | any signed-in caller    | rows, existence signal           | 1.4      |
| `GET /meetings/:meetingId/files/:fileId/content`        | any signed-in caller    | bytes, existence signal          | 1.5      |
| `GET /meetings/:meetingId/files/deleted`                | any signed-in caller    | rows, existence signal           | 3.2      |
| `DELETE /meetings/:meetingId/files/:fileId`             | any signed-in caller    | bytes, rows                      | 3.1      |
| `POST /meetings/:meetingId/files/:fileId/restore`       | any signed-in caller    | bytes, rows                      | 3.3      |
| `POST /api/meetings/[meetingId]/files` (web proxy)      | **anyone, anonymous**   | the API itself, throttle budget  | 5.1      |
| `GET /api/meetings/[id]/files/[fileId]/content` (proxy) | **anyone, anonymous**   | the API itself, bytes            | 4.4      |
| `/meetings/[id]` page                                   | **anyone, anonymous**   | rows, existence signal           | 4.1      |
| Delete / restore Server Actions                         | any signed-in caller    | bytes, rows                      | 6.3, 6.4 |
| The uploaded filename (a field, not a route)            | any signed-in caller    | rows, the page, response headers | 1.3, 4.3 |
| `STORAGE_ROOT` read at boot                             | whoever deploys         | where every byte lands           | 1.2      |
| The hourly purge job                                    | nobody — internal timer | bytes, rows                      | 3.4      |

**Trust boundaries**: browser → `apps/web` (Next server, holds the cookie) → `apps/api` (Nest,
holds the token) → Postgres; and `apps/api` → the local filesystem. The proxy routes are the new
boundary: they are the only place where a request from the public internet is turned into an
authenticated request against the API.

**Examined and held** — the ten classes, with what already closes them:

1. **Ownership** — `MeetingsService.findOneForOwner` (`findFirst({ id, ownerId })`, 404 never 403)
   is reused by every new route rather than reinvented. Gaps: S-1 (when it runs), S-2 (what it is
   keyed on).
2. **Authentication** — `@UseGuards(JwtAuthGuard)` at class level, the `MeetingsController` idiom;
   `JwtStrategy` verifies against `getOrThrow('JWT_SECRET')` with `ignoreExpiration: false`. The
   page redirects via `getSession()` before render (task 4.1). Gap: S-4 (the proxy routes).
3. **Input** — the global `ValidationPipe({ whitelist: true, transform: true })` in `main.ts` strips
   unknown fields, and D-3's `fields: 0, parts: 1` is its multipart equivalent. Gap: S-6 (filename).
4. **Injection and traversal** — Prisma parameterises everything and neither app contains
   `$queryRaw`, `$executeRaw` or `queryRawUnsafe` (grepped). The storage key is two server-generated
   UUIDs (D-1), and `send` additionally refuses a path containing `..`. Held.
5. **Spend** — the global 20 req/60 s throttler, D-9's per-credential tracker, and the 500 MB / 20
   files / 20 GB ceilings. Gaps: S-3 (in-flight bytes are outside all of them) and, re-read in round
   2 against the raised request timeout, S-9 (nothing bounds how many requests one caller holds
   open, only how many they start per minute).
6. **Exposure** — the file DTO carries no `storageKey` and no filesystem path (D-5); the page is a
   Server Component, so the token never reaches the markup, and `e2e/home.spec.ts`'s "does not leak
   the session token" case is the pattern phases 4–6 copy. Gap: S-7 (cache headers).
7. **Secrets** — no `NEXT_PUBLIC_` variable exists anywhere (grepped); `STORAGE_ROOT` is read
   server-side only; the purge logs counts, not names (D-8). Gap: S-5 (missing `getOrThrow`).
8. **Session and browser** — the cookie is `httpOnly`, `sameSite: 'lax'`, `secure` in production, so
   a cross-site `<img>`/`<video>` load and a cross-site POST both travel without it; Next
   origin-checks Server Actions; `redirect('/login')` is a constant, never taken from input; and the
   proxy means the browser no longer calls the API cross-origin at all, leaving `CORS_ORIGIN` as it
   is. Held.
9. **Storage and dependencies** — `npm audit` over the two additions in an isolated tree reports **0
   vulnerabilities**, and no package in that closure declares an install script; the runtime closure
   is `@nestjs/schedule@6.1.3` → `cron@4.4.0` → `luxon ~3.7.0` (research's table named `cron` but
   not `luxon`). Redis still holds nothing that must be true. Gap: S-5 (file permissions).
10. **Errors and timing** — `NotFoundException('Meeting not found')` answers identically for absent
    and not-yours, matching the auth module's deliberate parity; the 409 and 507 messages are only
    reachable after ownership is proven, so no limit message is an existence oracle. Gap: S-6 (an
    unvalidated name reaching Prisma turns a 400 into a 500).

## 4. Findings

### S-1. A signed-in stranger's 500 MB lands on disk before the 404 that refuses it

- **Reach**: any signed-in caller → `POST /meetings/:meetingId/files` with a meeting id they do not
  own, or one that does not exist, and a 500 MB body → temp storage and write bandwidth on the host.
- **Plan tasks**: 1.3 · **Decisions**: D-3 · **Criteria**: AC-15, AC-5
- **Impact**: no data crosses — the answer is still the correct 404 — but the body has already been
  streamed to `<STORAGE_ROOT>/tmp` by the time the handler decides, because `FileInterceptor` is an
  interceptor and the ownership check lives in the handler behind it. A stranger with any account
  can spend the disk of meetings that are not theirs, repeatedly.
- **Severity**: medium — the cost is availability, not confidentiality, but the disk is shared with
  Postgres and the barrier to entry is one registration.
- **Control**: a `MeetingOwnerGuard` in `apps/api/src/files/guards/meeting-owner.guard.ts` that
  resolves the meeting through `MeetingsService.findOneForOwner(meetingId, user.userId)` and is
  applied on `FilesController` — Nest runs guards before interceptors, so the 404 is answered at
  zero bytes read. The guard attaches the resolved meeting to the request so the handler does not
  query twice.
- **Proven by**: an e2e case that posts a body to another user's meeting id and asserts both the 404
  and that nothing was written — `<STORAGE_ROOT>/tmp` is empty afterwards.
- **Disposition**: work — written into task 1.3.

### S-2. A file id from someone else's meeting, presented under a meeting the caller owns

- **Reach**: a signed-in owner → `GET /meetings/<a meeting they own>/files/<a fileId from another
owner's meeting>/content`, and the same shape on the metadata, delete and restore routes → another
  owner's bytes and metadata.
- **Plan tasks**: 1.4, 1.5, 3.1, 3.2, 3.3 · **Decisions**: D-4 · **Criteria**: AC-15, AC-17
- **Impact**: a full read of another user's file, and — through the delete route — the ability to
  remove it. This is the one finding here where the asset is another person's data.
- **Severity**: high — it needs only one file id, the routes are the ones AC-15 and AC-17 exist to
  protect, and the natural implementation (check the meeting, then `findUnique` the file) has the
  bug built in.
- **Control**: one `FilesService.findFileForOwner(fileId, meetingId, ownerId)` used by every route
  that takes a file id, doing a single compound lookup —
  `findFirst({ where: { id: fileId, meetingId, meeting: { ownerId } } })` — and never a separate
  `findUnique({ where: { id } })` after the meeting check. The `@@index([meetingId, deletedAt])`
  from D-4 already serves it.
- **Proven by**: an e2e case where A owns meeting M and B owns a meeting holding file F, asserting
  404 for `GET /meetings/M/files/F/content`, for `DELETE /meetings/M/files/F` and for the restore
  route — with A's own file in M still readable in the same test, so a blanket 404 cannot pass it.
- **Disposition**: work — written into tasks 1.4 and 1.5, and inherited by 3.1–3.3 through the same
  helper.

### S-3. In-flight bytes are outside every limit, and the disk is Postgres's too

- **Reach**: any signed-in caller → many concurrent `POST /meetings/:id/files` against their own
  meeting → the filesystem the database sits on.
- **Plan tasks**: 2.4 · **Decisions**: D-3, D-5, D-9 · **Criteria**: AC-8
- **Impact**: the 20 GB ceiling is evaluated inside the transaction that commits a row, so N
  concurrent uploads each see the same pre-upload total and each write up to 500 MB to temp storage
  first. Peak temp usage is bounded by nothing the plan names. When the disk fills, Postgres stops
  writing and the whole application goes down with it — a self-service outage.
  D-9's throttle is not the bound either: it keys on the credential, and a caller mints a fresh one
  by logging in again.
- **Severity**: high — trivially reachable by any account holder, and it takes down more than this
  feature.
- **Control**: reserve the bytes for the life of the request, not at commit. In `FilesService`, an
  in-process reservation per owner — add the request's declared `Content-Length` to the owner's
  used-bytes figure before the interceptor is allowed to stream, refuse with the same 507 message
  when the sum crosses `MAX_TOTAL_BYTES_PER_OWNER`, and release it in a `finally`. Where the request
  is chunked and declares nothing, reserve `MAX_FILE_BYTES`. Under-declaring cannot beat it: Node's
  HTTP parser delivers no more than `Content-Length` bytes on a non-chunked request, and D-6 has the
  web proxy forward the browser's own `Content-Length` rather than re-chunking.
- **Proven by**: an e2e case opening several concurrent uploads whose declared sizes together cross
  the ceiling, asserting the later ones are refused with the 507 message while the first still
  succeeds, and that temp storage never held more than the ceiling.
- **Disposition**: work — written into task 2.4.

### S-4. The web proxy is reachable anonymously and must refuse before it opens an upstream request

- **Reach**: anyone on the internet, with no cookie → `POST /api/meetings/[meetingId]/files` or
  `GET /api/meetings/[id]/files/[fileId]/content` on the web origin → the API's throttle budget and
  an unauthenticated pass-through into a service that is otherwise not exposed.
- **Plan tasks**: 4.4, 4.5, 5.1 · **Decisions**: D-6 · **Criteria**: AC-16, AC-17
- **Impact**: no bytes — the API refuses a request with no token — but a proxy that forwards first
  and checks later is an open relay: it spends the shared rate-limit budget, it lets an outsider
  probe the internal API's responses, and any header it forwards blindly is attacker-controlled.
- **Severity**: medium — bounded by the API still holding the line, which is exactly why this must
  not be the only line.
- **Control**: the route handler calls `getSession()` first and returns 401 without opening an
  upstream request at all. The upstream request is then built from an allow-list — method, body,
  `content-type`, `content-length`, `range` — with the token attached server-side; the caller's own
  `Authorization` header is never forwarded, and the ids go into the path through
  `encodeURIComponent`, never into the host.
- **Proven by**: a Playwright case that clears the session cookie and hits both proxy routes
  directly, asserting 401 and an empty body, plus one that sends its own `Authorization` header and
  asserts it changes nothing.
- **Disposition**: work — new task 4.5 for the byte route, and written into task 5.1 for the upload
  route.

### S-5. The storage root defaults into the checkout, and files are world-readable

- **Reach**: any other process or user account on the host, plus anyone who reads the repository or
  a backup of it → `STORAGE_ROOT` → every user's file bytes, with no HTTP request involved.
- **Plan tasks**: 1.2 · **Decisions**: D-1 · **Criteria**: AC-17
- **Impact**: a complete bypass of every ownership control, at the filesystem layer rather than the
  application one. Two ways in: `STORAGE_ROOT` unset in production silently falls back to
  `<repo>/.data/uploads`, putting user files inside the deployed source tree; and Node's default
  file mode (0o666 & ~umask, usually 0644) leaves every uploaded file readable by every account on
  the machine.
- **Severity**: medium — it needs local access or a deployment mistake, but the payoff is every
  file of every user at once.
- **Control**: `ConfigService.getOrThrow('STORAGE_ROOT')` outside development, so a missing path
  fails startup loudly exactly as `DATABASE_URL` and `JWT_SECRET` already do; the root created with
  `{ recursive: true, mode: 0o700 }` and files written with mode `0o600`; `/.data/` added to
  `.gitignore` so the dev default can never be committed; and a boot-time assertion that the
  resolved root is not inside `apps/web/public`.
- **Proven by**: a unit spec asserting the created directory's and the written file's modes, and
  that `LocalDiskFileStorage` throws at construction when `STORAGE_ROOT` is absent and
  `NODE_ENV=production`.
- **Disposition**: work — written into task 1.2.

### S-6. An unbounded filename reaches the database, the headers and the page

- **Reach**: any signed-in owner → a filename of 10 000 characters, or one carrying NUL/CR/LF, or
  `../../etc/passwd` → a Prisma error surfaced as a 500, a malformed `Content-Disposition`, and a
  name on the page that is not the name that was sent.
- **Plan tasks**: 1.3 · **Decisions**: D-4, D-7 · **Criteria**: AC-18
- **Impact**: not a breach — the stored path is server-derived (D-1) and React escapes the rendering
  — but an unvalidated string hitting `@db.VarChar(255)` turns a 400 into a 500 carrying a Prisma
  error shape, which is the one place this API leaks its internals.
- **Severity**: low.
- **Control**: normalise before insert — `path.basename()` so a path-shaped name loses its
  directories, C0 control characters stripped, then `MAX_FILE_NAME_LENGTH` (255, from the research
  Parameters table) enforced through the project's `class-validator` idiom so the answer is a 400 in
  the same shape every other DTO produces.
- **Proven by**: e2e cases for an over-long name, a name containing CR/LF, and one containing
  traversal sequences — each asserting a 400 or a stored basename, and never a 500.
- **Disposition**: work — written into task 1.3.

### S-7. `res.sendFile` labels private bytes `Cache-Control: public`

- **Reach**: anyone sharing an HTTP cache with the owner — a corporate proxy, a CDN added later, a
  shared browser profile → the byte route's URL → another user's file bytes.
- **Plan tasks**: 1.5, 4.4 · **Decisions**: D-7 · **Criteria**: AC-17
- **Impact**: `send@1.2.1` writes `Cache-Control: public, max-age=0` whenever the header is absent
  (`node_modules/send/index.js:746`), and nothing sets `Vary: Cookie`. The response is therefore
  explicitly marked storable by shared caches, keyed on a URL that is identical for every caller
  while the authorization lives in a cookie the cache never sees.
- **Severity**: low to medium — latent today, since no shared cache is deployed, and wrong from the
  first moment one is.
- **Control**: set `Cache-Control: private, no-store` before handing off to `res.sendFile` — `send`
  only writes its own value when the header is absent — and have the web proxy pass that header
  through unchanged rather than inventing one.
- **Proven by**: an e2e case asserting the byte route's `cache-control` contains `private` and never
  `public`, on both the API route and the web proxy.
- **Disposition**: work — written into task 1.5, and into the proxy in task 4.4.

### S-8. A PDF renders inline from the application's own origin

- **Reach**: the owner → their own uploaded PDF, served `inline` (AC-10) → the browser's PDF viewer.
- **Plan tasks**: 6.2 · **Decisions**: D-7 · **Criteria**: AC-10
- **Impact**: a PDF carrying JavaScript executes it when previewed. Current browsers run PDF script
  inside the viewer rather than in the page's origin, and a caller can only ever open a file they
  own, so the reachable path is an owner opening their own file — which is also how they would open
  it anywhere else.
- **Severity**: low.
- **Control**: none built. A separate preview origin would close it and this deployment has no
  second origin; `Content-Security-Policy: sandbox` would not, because PDF-internal script is the
  viewer's, not the page's. What holds instead: `inline` is granted only to `image/*`,
  `application/pdf`, `video/*` and `audio/*`, `X-Content-Type-Options: nosniff` is set, and the
  served `Content-Type` comes from the detected signature rather than the client's claim (D-2, D-7).
- **Proven by**: nothing — accepted rather than closed.
- **Disposition**: accepted 2026-08-16 by the user — "Принять риск, записав его в файл угроз" —
  taken over adding a sandbox CSP that buys nothing here, and over dropping inline PDFs, which would
  contradict AC-10 and mean a PRD change.

### S-9. One account holds unlimited requests open, now for thirty minutes each

- **Reach**: any signed-in caller → repeated `POST /meetings/:meetingId/files` against a meeting they
  own, each declaring a small `Content-Length` and then trickling the body → sockets, temp file
  handles and memory on the single machine.
- **Plan tasks**: 2.1 · **Decisions**: D-3, D-9 · **Criteria**: AC-8
- **Impact**: nothing bounds **concurrency**. The throttler bounds how many requests a credential
  _starts_ (60/min) and never decrements while one is still open; S-3's reservation bounds the bytes
  a caller _declares_, and a trickler declares a megabyte; `headersTimeout` (60 s) only covers the
  header phase, which the attacker completes promptly; and `http.Server.maxConnections` is
  `undefined` by default, which neither Nest's application, the Express adapter nor Express itself
  changes (grepped). Round 2 raised `requestTimeout` from Node's 300 s to 30 minutes, so the holding
  window went from 300 concurrent requests per credential to about 1800, each with a socket, a
  multer write stream and an open temp file.
- **Severity**: medium — an authenticated caller, one trivial loop, and no bound inside the
  application; the wall itself is host-dependent (this machine's `ulimit -n` is 524288, so it is
  memory and sockets rather than file descriptors), and the raise made an existing gap six times
  wider rather than creating it.
- **Control**: an **inactivity** timeout on the upload route, not a shorter total one —
  `req.setTimeout(UPLOAD_IDLE_TIMEOUT_MS)` in `FilesController.upload` (or on the underlying socket),
  so a body that sends nothing for a minute is destroyed while a slow-but-steady 500 MB transfer runs
  its full 30 minutes untouched. That distinction is the point: the user's round-2 decision protects
  the slow link, and this closes the deliberately idle one. `UPLOAD_IDLE_TIMEOUT_MS = 60_000` is the
  value this control needs; it belongs in the research **Parameters** table, which does not yet carry
  it — see the report's note on the round budget. Ratified on 2026-08-16 by `pre-issues` **T-1**:
  the value ships as written rather than opening a third research round, and task 2.1 in FINAL
  carries it.
- **Proven by**: an e2e case that opens an upload, sends a first chunk, then sends nothing, asserting
  the connection is closed inside the idle window and that a second upload sending steadily at a
  slower rate than the idle window still completes.
- **Disposition**: work — written into task 2.1.

## 5. Plan impact

Seven controls became work. One is a new task; the other six are written into the tasks that build
the entry points they guard, because phases 1, 2 and 5 already carry the five tasks a phase allows
and a sixth would have meant a new phase — which is the user's call, not this run's. No task was
renumbered, and no control was parked in a phase of its own at the end.

- **1.2** — `getOrThrow` for `STORAGE_ROOT` outside development, `0o700`/`0o600` modes, `/.data/`
  gitignored — S-5.
- **1.3** — ownership proven in a guard before any byte is read, and the filename normalised and
  bounded before insert — S-1, S-6.
- **1.4** — the file list keyed on meeting **and** owner — S-2.
- **1.5** — one compound lookup for every file id, and `Cache-Control: private, no-store` — S-2, S-7.
- **2.4** — the owner's ceiling reserved for the life of the request, not only at commit — S-3.
- **4.4** — the byte proxy passes the caching headers through — S-7.
- **4.5** (new) — the proxy routes resolve the session before forwarding and build the upstream
  request from an allow-list — S-4.
- **5.1** — the upload proxy follows the same rule — S-4.

No finding needed a mechanism or a threshold the research had not already chosen, so nothing goes
back to `/bldprj:research`.

**Round 2** added one more: **2.1** — an inactivity timeout on the upload route beside the total
request timeout that round wrote there — S-9. Written into 2.1 rather than as a new task, for the
same reason as the rest: phase 2 carries five. Its threshold, `UPLOAD_IDLE_TIMEOUT_MS = 60_000`, is
the one value in this file that the research **Parameters** table does not yet hold.

## Asked & assumed

- **Asked** — AC-10 requires PDFs to render inline from the app's own origin; accept the residual
  risk, add a sandbox CSP, or drop inline PDFs? → Accept it and record it (S-8).
- **Assumed** — the deployment is the single machine the PRD describes, so an in-process reservation
  (S-3) and an in-process purge timer are sound · a second instance makes both per-instance, and
  S-3's control would need a shared counter that Redis, being optional, cannot be.
- **Assumed** — meeting ids and file ids are UUIDv4 and therefore not enumerable, so 404 parity is
  what protects the existence signal rather than unguessability alone · S-2 is written to hold even
  when an id leaks.
- **Assumed** — no CDN or shared cache sits in front of either app today · that is what makes S-7
  latent rather than live; the control is cheap enough that it should not wait for one to appear.
- **Assumed** — participants remain unauthenticated email strings, per the PRD · the moment a
  participant becomes an account, every ownership finding here has to be re-read against a second
  legitimate reader.
- **Assumed** (round 2) — an upload that goes idle is an attack rather than a stalled client worth
  waiting for, so S-9's control destroys it after a minute of silence · if a real client on a mobile
  link can pause longer than that mid-transfer, the value rises and AC-9's failed row with Retry is
  what the user sees instead.
- **Nothing asked in round 2** — S-9 is work with a control the plan can carry, not a risk the user
  is being asked to take; the only thing it needs from anyone is a number, which belongs to
  `research`, not to this skill's class.

## Revisions

<!-- One line per revision round: what moved, and the D-<n> behind it, or that nothing did. -->

- 2026-08-16 — round 2: none of the five triggers fired. No `D-<n>` was added or superseded (trigger
  1, 4), no dependency arrived (3), no value a control cites changed or vanished (2 — the storage
  modes and the byte-response `Cache-Control` this file named in round 1 were adopted into Parameters
  unchanged), and no task grew an input (5). S-1…S-8 keep their controls and dispositions byte for
  byte.
- 2026-08-16 — round 2: **S-9 raised** — D-3's request timeout went from Node's 300 s default to 30
  minutes in task 2.1, which multiplies by six how long one credential can hold requests open, and
  nothing in the application bounds concurrency. Raised outside the trigger list on judgement: the
  list keys on decisions moving, and here a Parameters row moved an entry point's spend profile
  without a decision moving — see the report.
