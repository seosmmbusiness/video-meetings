# Threats: Meeting transcription

**Key**: MT
**PRD**: [meeting-transcription-PRD.md](./meeting-transcription-PRD.md)
**Plan**: [meeting-transcription-PLAN.md](./meeting-transcription-PLAN.md)
**Research**: [meeting-transcription-RESEARCH.md](./meeting-transcription-RESEARCH.md)
**Date**: 2026-08-26

## 1. Verdict

This feature adds the most sensitive text the product holds — the words spoken in a meeting — and a
new trust boundary the repository has never had: a second process, reached over localhost HTTP, which
is handed untrusted media and hands back a string that ends up in the database and in the owner's
browser. Nine findings, and the shape of them is that the existing controls hold the **old** surface
well and reach the new one unevenly.

Three are the new boundary's own: the engine's response is parsed before it is bounded (S-3), its
container is hardened by no task while ffmpeg inside it parses whatever an owner uploads (S-8), and
its port answers any local process without authentication (S-9, accepted). Two come from the queue
being per-account while the engine is one (S-4, S-5). Two are the web surface's: the polling Route
Handler the research added has no tier assigned to its pre-upstream `401` (S-2), and the Transcribe
control's HTTP method is unstated, which is the difference between CSRF-able and not (S-7). One is a
gap in an existing shared control — `api-proxy.ts`'s response allow-list drops
`X-Content-Type-Options`, so a transcript served as a download can be sniffed into markup on the app's
own origin (S-6). And one is the ownership guard the plan leans on being a provider no module
exports (S-1).

None of them is exotic. All nine are closed by controls this repository already knows how to write.

**Round 2 (2026-08-27)** — four triggers fired, and the surface did not move: no entry point was added,
removed or relocated, and every finding above keeps its reach and its disposition. What changed is
underneath them. D-5 was superseded by D-11, so S-4's control now names the mechanism that can actually
express a machine-wide cap — and that mechanism brings a reach of its own, the only new finding this
round: an in-process gate that holds the machine's single slot can be **wedged** by one owner's run, or
lost with the process, where a database claim could not (S-10). Four controls gained the numbers they
had been written without — S-3's byte ceiling, S-5's waiting-run ceiling, S-8's container limits — and
S-9's control was corrected where its own wording, taken literally, would have made the engine
unreachable.

## 2. Threat map

| Phase | Tasks                | Findings       |
| ----- | -------------------- | -------------- |
| 1     | 1.2, 1.4, 1.6        | S-1, S-3, S-8  |
| 2     | 2.3, 2.6             | S-4, S-5, S-10 |
| 3     | 3.4                  | S-6            |
| 4     | —                    | —              |
| 5     | 5.2, 5.4             | S-2, S-7       |
| 6     | 6.3                  | S-6            |
| —     | not built (accepted) | S-9            |

## 3. Surface

**Assets**

- **The transcript text** — the meeting's spoken words, belonging to the meeting's owner. The
  highest-value asset this feature creates; nothing in the product held anything like it before.
- **Run state, failure reason, detected language and timings** — the owner's, and revealing on their
  own: that a file exists, that it carries speech, roughly how long it is.
- **The stored file's bytes** — the owner's, already an asset, newly handed to a second process.
- **The existence of a meeting or a file** — AC-14 makes non-disclosure explicit, so this is an asset
  in its own right.
- **The engine process** — one shared CPU-bound service for the whole machine; its availability is
  every account's availability.
- **The account's transcription slot** and the queue behind it.
- **The session JWT** — never to reach the browser; the existing `httpOnly` cookie and the proxy
  Route Handlers are what keep it server-side.

**Entry points**

| Entry point                                                     | Who may reach it      | Assets it touches                         | Task     |
| --------------------------------------------------------------- | --------------------- | ----------------------------------------- | -------- |
| `POST /meetings/:meetingId/files/:fileId/transcription`         | any signed-in caller  | the file, the slot, the engine, the queue | 1.4      |
| `GET /meetings/:meetingId/transcriptions` (polled state list)   | any signed-in caller  | run state for every file of a meeting     | 1.4      |
| `GET /meetings/:meetingId/files/:fileId/transcription`          | any signed-in caller  | the transcript text                       | 1.4      |
| `GET …/transcription/download` (`.txt`)                         | any signed-in caller  | the transcript text                       | 3.4      |
| `GET /profile` (engine settings added)                          | any signed-in caller  | the configured engine settings            | 3.5      |
| The engine's `verbose_json` response                            | the engine            | the API process, the DB, the owner's page | 1.2      |
| The stored bytes read by the duration probe                     | the owner, indirectly | the API process (a media parser)          | 2.4      |
| The stored bytes posted to the engine                           | the owner, indirectly | ffmpeg inside the container               | 1.2      |
| `WHISPER_URL` / `WHISPER_MODEL` / `WHISPER_TIMEOUT_MS` from env | the operator          | which engine is called, for how long      | 1.5, 1.6 |
| `GET /api/meetings/[meetingId]/transcriptions` (web proxy)      | anyone with the URL   | run state, and the session token seam     | 5.4      |
| `GET /api/…/transcription/download` (web proxy)                 | anyone with the URL   | the transcript text, and the token seam   | 6.3      |
| The Transcribe / Retry control                                  | anyone with the URL   | the slot, the engine                      | 5.2, 5.5 |
| The transcript rendered on the page and on `/profile`           | the owner's browser   | the app's own origin                      | 5.5, 6.4 |
| The engine's published port, `127.0.0.1:9000`                   | any local process     | the model in use, the machine's CPU       | 1.6      |

**Trust boundaries**: browser → `apps/web` (Route Handlers, Server Actions) → `apps/api` (bearer
token) → Postgres · `STORAGE_ROOT` on disk · **the whisper container over localhost HTTP (new)**.
Plus a one-off provisioning boundary: the model weights, fetched from Hugging Face at setup time.
Round 2 narrowed one side of that new boundary rather than moving it: the engine sits on a compose
network of its own, so what it can reach outward no longer includes `db` and `redis` (S-8's control).

**Classes examined and already held** — recorded so the file shows what was looked at, not only what
failed:

- **Authentication on the API routes** — `JwtAuthGuard` (`src/auth/guards/jwt-auth.guard.ts`) with
  `JwtStrategy` re-reading the subject's row on every request and refusing a token whose `ver` is
  behind the account's `tokenVersion`, so a password change ends these sessions too.
- **Injection** — Prisma everywhere, no `$queryRaw` in any decision. The one hand-built protocol is
  D-2's multipart envelope, whose boundary is a `randomUUID()` and whose part filename is a fixed
  literal, so nothing caller-controlled reaches a header.
- **Traversal** — the transcription module never builds a path: bytes move through `FileStorage`, and
  `storageKey` is `meetings/<uuid>/<uuid>`, server-generated at upload.
- **Refusal ordering as an oracle** — ownership resolves before type (415) and duration (422), per
  D-9, so a caller never learns that someone else's file exists by being told what type it is.
- **Meeting-id enumeration** — the polled route's looser throttle (240/60 s) widens guessing, but
  `Meeting.id` is `@default(uuid())`, i.e. 122 random bits, so enumeration is infeasible and the 404
  is uniform. Held.
- **Secrets** — `WHISPER_*` are server-side only; `apps/web` never learns the engine exists, and no
  `NEXT_PUBLIC_` variable is introduced.
- **Logs** — `FilesPurgeService` sets the precedent ("Logs only a count, never a filename"); the
  scheduler follows it and logs neither transcript text nor file names.
- **Exposure through DTOs** — `storageKey`, `text` on the list route, and every internal column stay
  off the wire by building responses field by field, the rule `ProfileResponseDto` already states.
- **Session and cookie** — `httpOnly`, `sameSite: 'lax'`, `secure` in production, expiry mirroring the
  token's `exp` (`apps/web/src/lib/session.ts`); unchanged by this feature.
- **CORS** — unchanged: the browser never calls `apps/api` directly.

## 4. Findings

### S-1. A signed-in stranger → another owner's `meetingId` on the new transcription routes → their transcripts, and the fact their meeting exists

- **Reach**: any signed-in caller sends someone else's `meetingId` (and `fileId`) to a transcription
  route. What stops that on the existing file routes is `MeetingOwnerGuard`, applied at the controller
  and resolving `:meetingId` against the caller before any interceptor runs. That guard is a
  **provider of `FilesModule` and is exported by nothing** — and D-9 adds `exports: [FilesService]`
  and nothing else, so the transcription module cannot apply it. `findFileForOwner` covers the two
  per-file routes, but the polled list route has no `:fileId` at all and therefore no cover.
- **Plan tasks**: 1.4 · **Decisions**: D-9 · **Criteria**: AC-14, AC-15
- **Impact**: another account's transcripts, run states and the existence of their meetings.
- **Severity**: **high** — one missing decorator on one controller, and every criterion about
  non-disclosure fails at once.
- **Control**: `FilesModule` exports `MeetingOwnerGuard` alongside `FilesService`, and the
  transcription controller carries `@UseGuards(JwtAuthGuard, MeetingOwnerGuard)` exactly as
  `files.controller.ts:74` does. The list query filters `meeting: { ownerId }` as well, mirroring
  `FilesService.listForOwner` — the guard and the filter, not one of them.
- **Proven by**: an e2e case per route where a second account presents the first's `meetingId` and
  `fileId` and gets the same `404` as for ids that never existed; and, for the list route, an
  integration case asserting the query is owner-filtered even with the guard stubbed out.
- **Disposition**: **work** — folded into task 1.4, which already promises this scoping but leans on
  a surface that does not exist.

### S-2. A signed-out visitor → the polled proxy Route Handler → run state, with no tier assigned to the refusal

- **Reach**: `GET /api/meetings/[meetingId]/transcriptions` is the fourth same-origin proxy, added by
  D-6 in phase 5. Every existing proxy refuses with `401` **before** opening any upstream request and
  forwards only allow-listed headers, and `apps/web/CLAUDE.md` fixes the tier that proves it: "Route
  Handlers and Server Actions called directly" as `*.int-spec.ts` — "the tier that pins the
  security-critical seams the browser can't see into — the proxy's request/response header
  allow-list, the bearer token attached server-side while the caller's own `Authorization` is
  dropped, the pre-upstream `401`". Phase 5's **Verified by** predates D-6 and names only Vitest/RTL
  and Playwright. Phase 6 names the integration tier for its own proxy; phase 5 does not for this one.
- **Plan tasks**: 5.4 · **Decisions**: D-6 · **Criteria**: AC-15
- **Impact**: a proxy that forwards a caller's own `Authorization`, or calls upstream before checking
  the session, leaks run state to a signed-out visitor and puts the session token on a path the
  browser can influence.
- **Severity**: **high** — this is the exact seam the app's own docs single out, on a route with no
  test tier assigned to it.
- **Control**: the handler mirrors
  `src/app/api/meetings/[meetingId]/files/[fileId]/content/route.ts` — `getSession()` first,
  `new Response(null, { status: 401 })` before any upstream call, then `proxyToApi` with
  `encodeURIComponent`-escaped ids — and phase 5's **Verified by** names the `*.int-spec.ts` tier for
  it.
- **Proven by**: `route.int-spec.ts` beside the handler: no session → `401` and `fetch` never called;
  a caller-supplied `Authorization` header never reaches the upstream; only allow-listed headers pass
  in either direction.
- **Disposition**: **work** — folded into task 5.4, plus the **Verified by** revision on phase 5.

### S-3. An owner → a recording that drives the engine into a repetition loop → the API process's memory

- **Reach**: `whisper-server` answers `verbose_json`, and D-2's client reads that response and parses
  it. Whisper's well-known failure mode on unusual audio is a decoding loop that emits the same
  segment thousands of times, and `verbose_json` carries every segment as well as the text. The
  research's `MAX_TRANSCRIPT_CHARS` guard is applied to the parsed string — that is, **after** the
  whole body has been buffered and `JSON.parse`d. The engine is not an attacker, but its output is
  attacker-influenced, and it is the only input to this feature that arrives with no size contract.
- **Plan tasks**: 1.2 · **Decisions**: D-2, D-4 · **Criteria**: AC-8
- **Impact**: the API process's memory, in a process that must keep answering every other route; and
  a Prisma write that throws mid-run when `detectedLanguage` exceeds `@db.VarChar(64)`, leaving a row
  stuck `RUNNING` until the boot sweep.
- **Severity**: **medium** — an owner reaches it with a file rather than a request, and the ceiling is
  the engine's output rather than anything they choose directly.
- **Control**: count bytes while reading the engine's response and abort the stream past
  `MAX_ENGINE_RESPONSE_BYTES` (`8_388_608`), failing the run rather than parsing what arrived; then
  validate the parsed shape before it is written — `text` a string within `MAX_TRANSCRIPT_CHARS`
  **characters**, `language` (the field the engine actually emits, not `detected_language`) a string
  within `MAX_DETECTED_LANGUAGE_LENGTH`, everything else discarded. The stream is already being read
  incrementally by `node:http`, so the check costs a counter. `Content-Length` is a fast path that
  lets the request be destroyed before a body byte is read, never the control: `WHISPER_URL` is
  configuration, and a substituted endpoint can omit it or under-report it. Round 2 corrected the
  quantity and the unit: this pass asked for a **character** ceiling to be applied to a **byte** count
  of the whole `verbose_json` envelope, which carries the text roughly ten times over — a byte counter
  set at 1 MiB would have failed a legitimate Russian hour, which is where AC-13 tests it. Research §5
  holds both numbers and the arithmetic behind them.
- **Proven by**: a unit spec with a stubbed engine returning a body over `MAX_ENGINE_RESPONSE_BYTES`
  — the run ends `FAILED` with a readable reason, no transcript is stored, and the previous transcript
  (if any) survives; a case where the body is under the byte ceiling but its `text` is over
  `MAX_TRANSCRIPT_CHARS`, caught by the second ceiling; a case where `language` is over-long, missing
  or not a string and the run still fails cleanly rather than throwing; and a case where
  `Content-Length` is absent or lies low, where the counter is what stops it.
- **Disposition**: **work** — folded into task 1.2, which owns the engine boundary.

### S-4. Any set of signed-in users → one start request each → the single engine's memory, and every other account's transcriptions

- **Reach**: D-5's scheduler claims "one `QUEUED` run **per account**", so ten accounts with work
  queued produce ten concurrent `RUNNING` rows and ten concurrent requests to the one engine. Inside
  the engine, the model mutex is taken as the **first statement of the handler**
  (`examples/server/server.cpp:826–828`) — but httplib has already parsed and buffered the entire
  multipart body by the time the handler runs, and `set_payload_max_length` is never called. So
  inference serialises while **memory does not**: N concurrent uploads hold N bodies at once, up to
  the 500 MB per-file ceiling each. AC-7 bounds one account; nothing bounds the machine, even though
  the PRD's Out of scope says "one machine, one run at a time".
- **Plan tasks**: 2.2, 2.6 · **Decisions**: D-11 (supersedes D-5), D-1 · **Criteria**: AC-7, **AC-18**
- **Impact**: the engine container is killed by its own memory use or the host starts swapping; every
  account's transcriptions fail together, and the failure is triggered by ordinary use rather than by
  an attack.
- **Severity**: **high** — no privilege needed, no crafted input, and it takes the whole feature down
  for everyone at once.
- **Control**: the scheduler claims at most **one `RUNNING` run across all accounts**, not one per
  account. Round 2 replaced what holds that: D-5's conditional `updateMany` is atomic **per row** and
  cannot express a cap across rows — and re-checking it showed it never carried the per-account rule
  either, so AC-7 was resting on it too. D-11 puts an **in-process single-slot gate** in front of the
  claim, read and set with no `await` between the two, with the row claim kept underneath as the
  per-row guard; ticks are dropped while the slot is held, never queued, and the next run is the
  oldest `QUEUED` row by `queuedAt` across all accounts. Backed by `mem_limit`/`memswap_limit`
  (`2560m`) and `cpus` (`4.0`) on the compose service so the container is bounded even if the
  scheduler is ever wrong. The gate is honest only under the single-instance assumption this plan
  already records — see S-10 for what it costs.
- **Proven by**: an integration case driving the scheduler directly with `QUEUED` runs for **two
  different accounts** and asserting from the recorded `startedAt`/`endedAt` that the two never
  overlap — the same shape AC-7's case uses within one account.
- **Disposition**: **promise → AC-18**, approved by the user on 2026-08-26, and **work** as new task
  2.6.

### S-5. An owner → repeated start requests → an unbounded queue of `QUEUED` runs

- **Reach**: nothing caps how many runs an account may have waiting. AC-17's throttle bounds starting
  to 20 a minute, which over an hour is 1 200 queued rows; a meeting holds 20 files and an account may
  hold any number of meetings. With S-4's global cap in place, a deep queue also decides how long
  every other account waits.
- **Plan tasks**: 2.3 · **Decisions**: D-5 · **Criteria**: AC-7, AC-17
- **Impact**: table growth, a scheduler scan that lengthens, and one account monopolising the shared
  engine for as long as its queue lasts.
- **Severity**: **medium** — bounded by the throttle in the short run, unbounded over time.
- **Control**: a named ceiling on an account's waiting runs, refused at the route with the message
  stating it, in the idiom `MAX_LIVE_FILES_PER_MEETING` and `LIVE_FILE_CAP_MESSAGE` already set — a
  `409` from the same family as the live-file cap. Round 2 gave it its number:
  `MAX_WAITING_RUNS_PER_ACCOUNT` = `10`, the user's ruling, paired with `WAITING_RUN_CAP_MESSAGE` and
  raised on `>=` (research §5). D-11 raises what this ceiling is worth without changing its reach:
  with one run at a time on the machine, an account's queue depth is now what every *other* account
  waits.
- **Proven by**: an e2e case queueing up to the ceiling and getting `409` on the next start, with no
  row created and no run started.
- **Disposition**: **work** — folded into task 2.3, the phase's refusals task.

### S-6. Anyone whose words reach a transcript → the `.txt` download → script execution on `apps/web`'s origin

- **Reach**: the transcript is text this product did not author — it is whatever was said, or whatever
  a crafted recording makes the engine emit, and it can contain `<script>` (AC-16 exists precisely
  because it can). It is served from `apps/web`'s **own origin** at
  `/api/meetings/…/transcription/download`. If the response reaches the browser without
  `X-Content-Type-Options: nosniff` and with a content type the browser will sniff, it can be
  interpreted as markup on the app's origin. `api-proxy.ts`'s `FORWARDED_RESPONSE_HEADERS` is
  `['content-type', 'content-length', 'content-disposition', 'accept-ranges', 'content-range',
'cache-control']` — **`x-content-type-options` is not on it**, so the `nosniff` that
  `files.controller.ts:216` sets is stripped on the way back to the browser today.
- **Plan tasks**: 3.4, 6.3 · **Decisions**: D-6 · **Criteria**: AC-15, AC-16
- **Impact**: stored XSS on the application's origin. The session cookie is `httpOnly`, so the token
  itself is not readable, but everything the signed-in user can do, the script can do.
- **Severity**: **high** — the payload arrives through ordinary use of the feature and lands on the
  origin that holds the session.
- **Control**: two halves, and both are needed. `apps/api`'s download route answers
  `Content-Type: text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: private, no-store` and a `Content-Disposition: attachment` built with the
  `content-disposition` package the file route already uses. `api-proxy.ts` adds
  `x-content-type-options` to `FORWARDED_RESPONSE_HEADERS`, so the header survives the hop. Round 2
  found that package is a **phantom dependency** — imported by `files.controller.ts`, declared
  nowhere, resolving only under `@nestjs/platform-express` → `express@5.2.1` — so task 2.4 declares it
  at `1.1.0`, the version already resolved rather than the registry's `3.0.0`, which would move the
  existing download route onto a different major as a side effect of this feature. Nothing new enters
  the dependency tree: the declaration writes down a resolution that is already there.
- **Proven by**: an integration case on the proxy asserting `x-content-type-options` is forwarded; an
  e2e case downloading a transcript containing `<script>alert(1)</script>` and asserting the response
  carries `nosniff`, `text/plain` and `attachment`, and that the bytes equal the text shown.
- **Disposition**: **work** — folded into task 3.4 (the API half) and task 6.3 (the proxy half).
- **Handed on**: the same allow-list gap strips `nosniff` from the **existing** file-download path.
  The one-line fix here closes both, but the pre-existing instance sits in code the PRD fences off
  ("Changing anything about how files are uploaded, listed, played, downloaded, deleted or purged"),
  so it is recorded here and handed to `/bldprj:refactor-prd` as a security driver rather than being
  claimed as this feature's work.

### S-7. A cross-site page → a top-level navigation → a transcription started on the victim's account

- **Reach**: the session cookie is `sameSite: 'lax'`, which withholds the cookie from cross-site
  subresource requests but **sends it on a top-level `GET` navigation**. If the Transcribe or Retry
  control is built as a `GET` Route Handler, `window.location = 'https://app/api/…/transcribe'` from
  any page starts a run on the visitor's account. A `POST` Route Handler or a Server Action is not
  reachable that way — `lax` withholds the cookie from cross-site `POST`, and Next checks the origin
  of a Server Action. The plan does not say which of the three tasks 5.2 and 5.5 use.
- **Plan tasks**: 5.2, 5.5 · **Decisions**: D-6 · **Criteria**: AC-2, AC-15
- **Impact**: the victim's transcription slot and a share of the shared engine, spent without their
  action. No data is read.
- **Severity**: **low** — spend, not disclosure, and self-limiting once the slot is busy.
- **Control**: starting and retrying a run is a Server Action or a `POST`, never a `GET` Route
  Handler; state-changing transcription requests are stated as such in the plan rather than left to
  whoever writes the component.
- **Proven by**: an integration case asserting the route module exports no `GET` (or that the action
  is a Server Action), alongside the existing pattern's specs.
- **Disposition**: **work** — folded into task 5.2, which builds the control.

### S-8. An owner → a crafted recording → ffmpeg inside the engine container

- **Reach**: with `--convert`, `whisper-server` shells the uploaded file through
  `system("ffmpeg -i \"<temp>\" …")` (`examples/server/server.cpp:318–337`), and its own README warns:
  "Do not run the server example with administrative privileges and ensure it's operated in a sandbox
  environment, especially since it involves risky operations like accepting user file uploads and
  using ffmpeg for format conversions." The temp path is server-generated, so the command line itself
  is not injectable — but ffmpeg parses the file's _contents_, and container formats can carry
  external references, which is a documented ffmpeg local-file-read and SSRF class. The engine has
  ordinary egress in normal operation, because D-8 established that an `internal: true` network cannot
  publish the port the API reaches it on. No task in the plan hardens the container; task 1.5 says only
  "whatever the engine adds to `docker-compose.yml`".
- **Plan tasks**: 1.6 · **Decisions**: D-1, D-8 · **Criteria**: AC-12, **AC-19**
- **Impact**: reading files inside the container and opening connections from it. What limits the blast
  radius today is a choice D-1 already made for other reasons: the media arrives **over HTTP**, so
  `STORAGE_ROOT` is not mounted into the container and no other meeting's bytes are inside it. What is
  reachable without hardening is the container's own filesystem and the host network.
- **Severity**: **high** — untrusted media into a C parser is the classic case, and nothing currently
  bounds what the parser can reach when it goes wrong.
- **Control**: the compose service runs `user: "1000:1000"`, `read_only: true` with
  `tmpfs: /tmp:size=768m,mode=1777,noexec,nosuid,nodev` for its work directory, `cap_drop: [ALL]`,
  `security_opt: [no-new-privileges:true]`, `mem_limit: 2560m` with `memswap_limit` pinned equal to it
  (an unset value grants swap equal to memory, trading a clean OOM for thrashing past
  `WHISPER_TIMEOUT_MS`), `cpus: 4.0` moving together with the engine's `-t 4`, `pids_limit: 128`, the
  model mounted `:ro`, the port published on `127.0.0.1` only, and no bind mount of `STORAGE_ROOT`.
  Round 2 gave every one of those its value and added the last piece of the containment: a **compose
  network of its own**, because the default network holds `db` and `redis`, whose passwords fall back
  to `video_meetings` in that same file — an engine that reaches the host network from inside the
  default network reaches them. Three further settings are not hardening but the difference between
  running and silently not running, and the hardening is what makes them load-bearing:
  `--tmp-dir /tmp` (the engine's default work directory is the image's root-owned `/app`, which
  `read_only: true` forbids and uid 1000 could not write), an argv-list `command:` with `entrypoint`
  overridden (the image is `ENTRYPOINT ["bash","-c"]`, and a string `command:` would discard every
  flag while appearing to start — including `--convert` and the model), and `--host 0.0.0.0` **inside**
  the container. Research §5 holds all of it.
- **Proven by**: the offline profile check task 1.6 already builds, extended to assert the running
  service's configuration (`docker inspect`: non-root user, read-only rootfs, dropped capabilities, no
  `STORAGE_ROOT` mount, a network that is not the default one); plus a fixture whose container format
  carries an external reference producing a failed or empty run and no trace of a read file in the
  transcript.
- **Disposition**: **promise → AC-19**, approved by the user on 2026-08-26, and **work** — folded into
  task 1.6, which owns the engine's provisioning.

### S-9. Any local process → the engine's unauthenticated port → the model in use, and free CPU

- **Reach**: `whisper-server` has no authentication of any kind. Published on `127.0.0.1:9000` it
  answers any process on the machine: `POST /inference` spends CPU and transcribes arbitrary audio,
  and `POST /load` (`examples/server/server.cpp:1172`) swaps the model the application is using by
  path. On a multi-user host, "any local process" includes other users.
- **Plan tasks**: 1.6 · **Decisions**: D-1 · **Criteria**: —
- **Impact**: a local attacker changes which model the app's transcripts are produced by, or uses the
  machine's CPU. It does not by itself reach any stored transcript — those live in Postgres behind
  `apps/api` — and it requires code execution on the machine already.
- **Severity**: **medium** — high impact on the feature's integrity, but the precondition is
  substantial.
- **Control**: publish on the loopback address only — `127.0.0.1:${WHISPER_PORT}:8080` (already
  D-1's control, and now also AC-19's). Round 2 corrected how this pass stated it: the containment is
  the **host-side publish**, while the process *inside* the container must bind `--host 0.0.0.0`,
  since `server.cpp:59` defaults its hostname to `127.0.0.1` and a container bound to its own loopback
  is unreachable through any published port. "Never `0.0.0.0`" was true of the publish and false of
  the bind, and taken literally it would have made the engine unreachable rather than contained.
  Closing the port fully would need an authenticating reverse proxy in front of the engine, which the
  stock image cannot do.
- **Proven by**: AC-19's configuration check covers the loopback binding; the residual is not proven
  by a test, by definition of being accepted.
- **Disposition**: **accepted 2026-08-26 by the user** — "Принять риск": loopback binding is the right
  level for a single-user development machine, and it is the same level Postgres and Redis already sit
  at in this same compose file. To be revisited if this ever runs anywhere but one machine.

### S-10. An owner → one run that ends in the wrong way → the machine's single slot, and every account's transcriptions

- **Reach**: D-11 moves the machine-wide cap from the database into the API process — a private
  boolean held across `find → claim → run`. That is what makes AC-18 expressible, and it is also the
  first time a single account's run holds a resource whose loss is silent and total. Three paths lead
  there, and an owner reaches all of them with an ordinary start request: a run whose `finally` does
  not fire, or fires conditionally, leaves `slotBusy` set forever; a run that outlives any bound holds
  it for as long as it runs; and an error escaping the tick is an **unhandled rejection**, which
  terminates the process on the pinned runtime — `@Interval` mounts a bare `setInterval` that never
  awaits its callback (`@nestjs/schedule/dist/scheduler.orchestrator.js:38`), so nothing upstream
  catches it. D-5's database claim had none of this: a lost claim was a stale `RUNNING` row, and
  2.5's boot sweep already answers that.
- **Plan tasks**: 2.6 · **Decisions**: D-11 · **Criteria**: AC-7, AC-18
- **Impact**: transcription stops for **every** account until someone restarts the API, with no error
  anyone can see — every subsequent run simply stays `QUEUED`. In the third path the whole API process
  dies, taking every other route with it.
- **Severity**: **medium** — no privilege and no crafted input, and the blast radius is the whole
  feature (the whole process, in the crash path); but each path needs the implementation to get one
  line wrong, rather than being reachable against a correct implementation.
- **Control**: three lines, and this finding exists so that they are written down rather than
  remembered. The `finally` that clears the slot is **unconditional** — no branch, no early return
  past it; the hold is bounded by the same hard `WHISPER_TIMEOUT_MS` that bounds the engine call, so
  no hold can outlive it; and the tick catches and logs its own errors and never rethrows. Behind
  them, 2.5's `onModuleInit` sweep is what recovers the crash path, and it must run before any
  interval is mounted.
- **Proven by**: a unit spec on the scheduler driving three cases against a stubbed engine — the run
  throws, the run times out, the claim itself throws — and asserting after each that a following tick
  claims the next `QUEUED` run rather than being dropped; plus a case asserting a rejecting tick
  produces a logged error and no unhandled rejection.
- **Disposition**: **work** — folded into task 2.6, which builds the gate. No new criterion: AC-7 and
  AC-18 both promise that a waiting run starts once the one before it has ended, so a wedged slot
  fails a criterion the PRD already carries.

## 5. Plan impact

The five-building-task ceiling is at its limit in phases 1, 3 and 5, so most controls are written into
the task that builds their entry point rather than into a task of their own — the finding is cited in
the task text and on the phase's `**Threats**` line, so `issues` still labels it and `build-phase`
still reads it. One finding gets its own task, because it carries an acceptance criterion of its own.

- **Task 2.6** (new) — the scheduler's global one-run-at-a-time cap, S-4, carrying AC-18. Phase 2 had a
  free slot and this control deserves its own issue. Round 2 added what holds the slot open safely to
  the same task — the unconditional `finally`, the timeout-bounded hold and the swallowed tick error,
  S-10 — because they are properties of the gate rather than work of their own.
- **Task 1.2** — bounds the engine's response before parsing it, S-3.
- **Task 1.4** — `FilesModule` exports `MeetingOwnerGuard`, the controller applies it, the list query
  filters by owner, S-1.
- **Task 1.6** — the container hardening AC-19 names, S-8 and S-9's loopback binding.
- **Task 2.3** — the waiting-run ceiling, S-5.
- **Task 3.4** — the download's `text/plain`, `nosniff`, `attachment` and `no-store` headers, S-6.
- **Task 5.2** — starting and retrying are never a `GET`, S-7.
- **Task 5.4** — the polling proxy's pre-upstream `401` and header allow-list, S-2.
- **Task 6.3** — `x-content-type-options` added to `api-proxy.ts`'s response allow-list, S-6.
- **Phase 1 `**Covers**`** gains AC-19; **phase 2 `**Covers**`** gains AC-18; every phase gains its
  `**Threats**` line; **phase 5 `**Verified by**`** gains the Route-Handler integration tier its new
  proxy needs.

**Not claimed as this feature's work**: the same `api-proxy.ts` allow-list gap strips `nosniff` from
the existing file download. The fix here closes both, but the pre-existing instance is behind the
PRD's scope fence and goes to `/bldprj:refactor-prd` as a security driver.

**Worth the user's attention rather than a silent fold**: had the ceiling allowed it, S-1, S-3, S-6 and
S-8 would each have been a task of its own, and each would then have been its own GitHub issue with its
own review. Splitting phase 1 would buy that back. That is a change to the phase cut, which belongs to
the user, so it is named here rather than made.

## Asked & assumed

- **Asked** — S-4 and S-8 name controls the user was never promised, so no test holds them and
  close-out could not prove them. Raise them into acceptance criteria? → **Both.** AC-18 (at most one
  transcription on the machine at any moment, whatever the number of accounts) and AC-19 (the engine
  runs contained) were added to the PRD, and each is covered by the phase that builds it.
- **Asked** — S-9, the engine's unauthenticated loopback port with its `/load` endpoint: accept the
  residual, or put an authenticating control in front of it? → **Accept.** Loopback binding is the
  level Postgres and Redis already sit at in this compose file, and an authenticating proxy is
  disproportionate work against a risk that starts with the attacker already running code on the
  machine.
- **Assumed** — the transcription controller mirrors `files.controller.ts`'s guard pair rather than
  inventing its own scoping · if it resolves ownership some other way, S-1's control has to be
  restated against whatever that is.
- **Assumed** — the engine is trusted to be the engine, and the response validation in S-3 is about
  size and shape rather than about malice · a compromised engine is out of reach of any control in
  this plan, and S-8's containment is what bounds that case.
- **Assumed** — `sameSite: 'lax'` is the session cookie's setting and is not changed by this feature ·
  S-7's severity rests on it; a change to `none` would make the CSRF reach much wider.
- **Assumed** — round 2 asked nothing: every finding it moved was disposed of inside this skill's own
  class, and its one new finding (S-10) is held by AC-7 and AC-18, which the PRD already carries · had
  S-10 needed a criterion of its own it would have been a **Promise** and therefore the user's.
- **Assumed** — `apps/api` runs as a single instance, which is what makes D-11's in-process gate a
  control at all · a second instance voids AC-18 outright rather than degrading it, and S-10's wedge
  becomes a per-instance one; the replacement is a partial unique index with a worker identity and a
  lease, not a swapped claim.
- **Assumed** — no CSP is in force on `apps/web` today, so `nosniff` and the content type are what
  stand between a transcript and script execution · a CSP would be a second layer and is not this
  feature's to add.

## Revisions

- 2026-08-27 — round 2: **S-10 raised** — D-11 supersedes D-5 and moves the machine-wide cap into the
  API process, so one owner's run can now wedge or lose the shared slot silently, a reach the database
  claim did not have. Trigger 4, on D-11. Folded into task 2.6.
- 2026-08-27 — round 2: **S-4's control** restated on D-11 — the in-process single-slot gate over the
  row claim, dropped ticks, global FIFO on `queuedAt`, with the compose limits given their values.
  Trigger 4, on D-11. Reach, severity and disposition unchanged.
- 2026-08-27 — round 2: **S-3's control** corrected — the stream ceiling is
  `MAX_ENGINE_RESPONSE_BYTES` (bytes, 8 MiB), not `MAX_TRANSCRIPT_CHARS` (characters), the two bite in
  disjoint places, and the field read is `language`. Trigger 2, on research §5, handed back by that
  pass for this skill to correct.
- 2026-08-27 — round 2: **S-5's control** gains its number — `MAX_WAITING_RUNS_PER_ACCOUNT` = `10`,
  the user's ruling, with `WAITING_RUN_CAP_MESSAGE`. Trigger 2, on research §5.
- 2026-08-27 — round 2: **S-8's control** gains every value it was written without and the dedicated
  compose network, plus the three settings that decide whether the hardened stock image runs at all.
  Trigger 2, on research §5.
- 2026-08-27 — round 2: **S-9's control** corrected — loopback containment is the host-side publish;
  the process inside the container must bind `--host 0.0.0.0`. Trigger 2, on D-1's corrected
  **Exposure**.
- 2026-08-27 — round 2: **S-6's control** notes `content-disposition` as a phantom dependency declared
  at its resolved `1.1.0` by task 2.4. Trigger 3, checklist class 9 only; nothing enters the tree, so
  no reach changed.
- 2026-08-27 — round 2: **no change** to S-1, S-2 and S-7 — D-9's corrected **Exposure** says what S-1
  already said, and nothing this round touched the web surface. Trigger 1 fired on nothing: no entry
  point was added, removed or relocated, and the only boundary movement is S-8's control narrowing the
  engine's own network.
