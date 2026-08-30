# Plan: Meeting transcription

**Key**: MT
**PRD**: [meeting-transcription-PRD.md](./meeting-transcription-PRD.md)
**Date**: 2026-08-24
**Status**: superseded by [meeting-transcription-FINAL.md](./meeting-transcription-FINAL.md)

Six phases: `apps/api` goes fully green — one transcription end to end, then the queue and every
refusal, then the transcript's lifecycle and its download — before `apps/web` touches any of it, so
no frontend phase ever runs against a half-finished API. Phase 1 is the tracer bullet: it proves in
one slice the three things nothing in this repository has ever done — reach an engine that lives
outside the Node process, keep work alive past the request that started it, and store what came
back. Phase 4 is a parity refactor with no feature in it, because `apps/web/src/app/meetings/[id]/page.tsx`
is 317 lines against a 200-line ceiling and the project's rules require it decomposed in its own
commit before anything is added to it. Docs move with the code: the phase that changes a module
updates that module's doc under `docs/modules/`, the JSDoc on the functions it touched, and — in
`apps/api` — the Swagger annotations on the routes and DTOs it touched. There is no trailing
documentation phase.

## Phase 1. Transcribe one recording end to end in the API

**Goal**: a request starts a transcription of a stored recording and a later request answers with
its finished text — one file at a time, no queue and no limits yet.
**Touches**: api · database · infrastructure
**Covers**: AC-4, AC-12, AC-13, AC-14, AC-19
**Decisions**: D-1, D-2, D-3, D-4, D-6, D-8, D-9, D-10
**Threats**: S-1, S-3, S-8
**Verified by**: Red/Green/Refactor, outside in, per the root `CLAUDE.md`'s Testing section —
"before implementing, write or extend the e2e spec covering the scenario end to end, review its
cases with the requester, and commit it red on its own (`test(<app>): …`)", then each unit's
`*.spec.ts` (or `*.int-spec.ts`, if it needs Postgres) red before the code that greens it.
"Security test cases are mandatory, not optional" (`apps/api/CLAUDE.md`, Testing): authorization
boundaries (IDOR), auth bypass on a protected route, and mass-assignment rejection by
`ValidationPipe`'s `whitelist`, each at the tier that proves it. Every route and DTO carries its
`@nestjs/swagger` annotations, checked in the Swagger UI before the work is called done. Suites:
`npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api`. Two checks in this phase sit
outside those suites, and D-8 and D-3 say why: half of AC-12 is a scripted `docker compose` run
against the isolated profile task 1.6 adds, because published ports do not work on a network declared
`internal: true` (moby#36174) and the denial therefore has to be driven from inside it; and the
engine's real throughput has to be measured once, on this machine, before `WHISPER_TIMEOUT_MS` is
worth anything. Both are evidenced in **Done when**.
**Tasks**:

- [ ] **1.1** Cover one transcription end to end with failing specs — tests: the e2e cases for AC-4
      (a fixture recording whose spoken words are known, asserted against the stored text — a fixed
      string, an empty transcript or the file's own name must fail) and AC-14 (another owner's file
      answers the same 404 as one that does not exist), the int cases for AC-13 (a non-English
      fixture comes back in the language spoken), and AC-12's case asserting no connection or DNS
      lookup leaves the machine for the whole run. AC-12's harness is `research`'s to choose; red
      before 1.2 starts.
- [ ] **1.2** Turn a stored recording into text on this machine — an engine boundary that takes a
      storage key and answers with the text plus the detected language. Two constraints the rest of
      the plan rests on: it is stubbable at the unit tier, so `pre-push` never needs the engine
      running, and an absent or unreachable engine degrades to a failed run — never a failed
      startup and never a failed request — the same way the root `CLAUDE.md` requires of Redis.
      The engine's answer is the one input to this feature that arrives with no size contract, so it
      is bounded while it is read rather than after it is parsed: past `MAX_ENGINE_RESPONSE_BYTES`
      the stream is abandoned and the run fails, `Content-Length` serving only as a fast path and
      never as the control. The parsed shape is then validated before it is stored — `text` a string
      within `MAX_TRANSCRIPT_CHARS` **characters**, `language` (**not** `detected_language`) a string
      within `MAX_DETECTED_LANGUAGE_LENGTH`, everything else discarded (S-3). The two ceilings are in
      different units and neither replaces the other; research §5 says why, and a legitimate
      non-English hour is the case that proves it. "Degrades to a failed run" also has to cover the
      engine dying under the memory limit 1.6 sets: a transport error and a non-2xx answer are
      treated identically, both ending the run as failed.
- [ ] **1.3** Store a run and its transcript — one migration carrying the run-state enum (the
      schema's first), the transcript text, the run's start and end times, its failure reason
      (AC-8) and the engine settings it used (AC-11), so the schema moves once rather than being
      caught up by later phases. Its relation to `MeetingFile` is chosen so that
      `FilesPurgeService`'s hourly delete still removes a file — today's only precedent in the
      schema is `onDelete: Restrict`, which would block it.
- [ ] **1.4** Start a run and read it back — a route that starts a transcription for one file, and
      the two read shapes D-6 needs rather than one: a **meeting-scoped** state list carrying every
      file's run state and no transcript text, which is what the page polls, and a **per-file** read
      answering that file's state and its text. All three are scoped to the caller's own meeting
      through the files module's public surface rather than a copied `where` clause (`FilesModule`
      exports nothing today, D-9), and all three answer the same 404 as a file that does not exist.
      That surface is two things, not one: `FilesModule` exports `MeetingOwnerGuard` as well as
      `FilesService`, the controller carries `@UseGuards(JwtAuthGuard, MeetingOwnerGuard)` as
      `files.controller.ts:74` does, and the list route — which has no `:fileId` and so no cover from
      `findFileForOwner` — filters `meeting: { ownerId }` too (S-1). Both read routes carry their own
      rate limit, looser than the global baseline, so the page watching a run cannot throttle its
      owner out (the plan's Asked & assumed records why).
- [ ] **1.5** Document the transcription module — a new `docs/modules/module-api-transcription.md`
      per the root `CLAUDE.md`'s Module documentation section, its row in `docs/modules/INDEX.md`,
      the Status line in `apps/api/CLAUDE.md`, the entry in `apps/api/HISTORY.md`, and whatever the
      engine adds to `docker-compose.yml`, `.env.example` and `README.md`.
- [ ] **1.6** Provision the engine's weights and the offline profile — a provisioning script that
      downloads `ggml-${WHISPER_MODEL}.bin` once into a gitignored
      `.data/whisper-models/`, verified against the SHA1 whisper.cpp publishes and mounted `:ro`, so
      nothing is fetched during a run (D-10); plus the `docker-compose.offline.yml` profile that puts
      the engine on an `internal: true` network with a one-shot client container on it, which is how
      half of AC-12 is driven (D-8). The service is also hardened here, because this is where it is
      defined and because ffmpeg inside it parses whatever an owner uploads (S-8, AC-19): non-root,
      `read_only` root filesystem with a sized `tmpfs` work directory, `cap_drop: [ALL]`,
      `no-new-privileges`, `mem_limit` with `memswap_limit` pinned equal to it, `cpus`, `pids_limit`,
      the model mounted `:ro`, no mount of `STORAGE_ROOT`, a compose network of its own rather than
      the default one that already holds `db` and `redis`, and the port published on `127.0.0.1` only
      (S-9's accepted residual rests on that last one). Every value is in research §5, and three of
      them are not tuning but the difference between working and silently not: `--tmp-dir /tmp`,
      because the engine's default work directory is the image's root-owned `/app`; an argv-list
      `command:` with `entrypoint` overridden, because the image is `ENTRYPOINT ["bash","-c"]` and a
      string `command:` would discard every flag while still appearing to start; and `--host 0.0.0.0`
      **inside** the container, whose default is `127.0.0.1` and would be unreachable through any
      published port. Ordering: this has to run before 1.2 can go green. This task's first
      `docker compose up` is also what settles the two figures research could not measure — the real
      memory peak behind `mem_limit`, and whether uid 1000 can run the stock image at all.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green; a
fixture recording posted to the start route comes back from the read route as text containing the
words known to be spoken in it; stopping the engine turns a run into a failed one and leaves the API
answering every other route as before. AC-12 is closed by both halves and by neither alone: the
offline compose profile transcribes the fixture with the engine on a network that has no route off
the machine, and the integration spec records no non-loopback connection or DNS lookup out of
`apps/api` for the whole of a real run. One full-length run is timed on this machine, and its number
— not D-3's estimate — is what `WHISPER_TIMEOUT_MS` and the README are set from. `docker inspect` on
the running engine shows a non-root user, a read-only root filesystem, dropped capabilities, no mount
of `STORAGE_ROOT` and a loopback-only published port (AC-19).

## Phase 2. One run at a time, and every refusal

**Goal**: an account's transcriptions never overlap, a waiting run starts by itself once the one
before it ends, and every refusal the PRD names is enforced at the route.
**Touches**: api
**Covers**: AC-1, AC-2, AC-6, AC-7, AC-8, AC-17, AC-18
**Decisions**: D-7, D-11
**Threats**: S-4, S-5, S-10
**Verified by**: Red/Green/Refactor, outside in, per the root `CLAUDE.md`'s Testing section — the
e2e cases first and red in their own `test(api): …` commit, then each unit's spec red before the
code that greens it. "Security test cases are mandatory, not optional" (`apps/api/CLAUDE.md`,
Testing): authorization boundaries (IDOR), auth bypass, mass assignment, and
"rate-limiting/brute-force protection on sensitive endpoints" — AC-17 belongs to this phase and is
proven at the tier that actually proves it. Swagger annotations updated for every refusal a route
gains. Suites: `npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **2.1** Cover the queue and every refusal with failing specs — tests: the e2e cases for AC-1
      and AC-2 (a file that is not one of the six speech-carrying types, and a second request for a
      file already in flight, both refused at the API), AC-6 (a recording over 60 minutes), AC-8
      (the failure reason is stored and answered) and AC-17 (the 21st start request inside 60
      seconds is refused with `429` and starts no run), plus the int cases for AC-7 driving the
      scheduler directly, as `quota-reservation.service.spec.ts` already drives its own; red before
      2.2 starts.
- [ ] **2.2** Let only one of an account's runs work at a time — at most one running, the next
      waiting run starting when the one before it ends, whether it ended by finishing or by
      failing, and the recorded start and end times showing that two runs of one account never
      overlap. The conditional row claim alone never carried this — it is atomic per row, and two
      overlapping ticks can each claim a _different_ row of the same account — so this criterion
      rests on the same gate 2.6 builds, not on the claim (D-11).
- [ ] **2.3** Refuse a run that may not start — a second run for a file already waiting or running,
      a run for a file outside the six speech-carrying types, and a run that would push the account
      past its ceiling of waiting runs (S-5), each refused at the route with nothing stored and no
      run created. The waiting ceiling is a named constant with its own message, in the idiom
      `MAX_LIVE_FILES_PER_MEETING` and `LIVE_FILE_CAP_MESSAGE` already set.
- [ ] **2.4** Refuse a recording longer than 60 minutes — the audio's duration decides, not the
      file's byte size, and the refusal states the limit. It is measured inside the API process by
      `music-metadata` reached through `load-esm`, not by the engine, whose ffmpeg lives in the
      container and is unreachable from `apps/api` (D-7). The same task declares the three packages
      this repository imports but resolves only transitively — `load-esm`, `file-type` and
      `content-disposition` — each pinned at the version already resolved rather than the registry's
      newest, since a bump would silently move code that works today (D-7 makes this feature depend
      on the first, S-6's download headers on the third).
- [ ] **2.5** Recover a run that a restart interrupted — a run left in flight by a stopped API comes
      back as failed with a reason its owner can read, not as one that runs forever, so the account's
      single slot is never lost. The sweep runs at `onModuleInit`, before any interval is mounted:
      Nest orders every `onModuleInit` ahead of all `onApplicationBootstrap` hooks but promises
      nothing between two modules' `onApplicationBootstrap`, which is where the scheduler mounts its
      interval — so a tick could otherwise fire before the sweep (D-11).
- [ ] **2.6** Hold the machine to one run at a time — the scheduler claims at most one `RUNNING` run
      **across all accounts**, not one per account, so N accounts cannot put N concurrent requests
      into the single engine (AC-18, S-4). What holds it is an in-process single-slot gate read and
      set with no `await` between, because `@Interval` is a bare `setInterval` that never awaits its
      callback and re-enters; ticks are **dropped** while the slot is held, never queued. The next
      run is simply the oldest `QUEUED` row by `queuedAt` across all accounts — global FIFO, which is
      all the PRD promises, and which needs no owner join and no new index (D-11). Holding the slot
      is now the only way to stop the whole machine, so three lines are part of this task rather than
      of whoever writes it (S-10): the `finally` that clears the slot is **unconditional**, with no
      branch and no early return past it; the hold is bounded by the same hard `WHISPER_TIMEOUT_MS`
      that bounds the engine call, so no hold outlives it; and the tick catches and logs its own
      errors and never rethrows, because an unhandled rejection terminates the process on this
      runtime. Each has its own spec: after a run that throws, one that times out and a claim that
      throws, the next tick claims the next `QUEUED` run rather than finding the slot still held.
      Inference inside the engine is already serialised by a mutex, but its
      handler takes that mutex only after the whole upload has been buffered, so concurrency there
      costs memory rather than time. `mem_limit` and `cpus` on the service (1.6) are the backstop for
      a scheduler that is ever wrong.

**Done when**: the three api suites are green with a case per refusal; two files started back to
back for one account show non-overlapping recorded runs, and so do two runs belonging to two
**different** accounts; killing the API mid-run and restarting it leaves that run failed and the
next one able to start.

## Phase 3. Transcript lifecycle, download and settings

**Goal**: a transcript follows its file through delete, restore and purge, can be fetched as a
`.txt`, and the settings a run used are readable from the profile.
**Touches**: api · database
**Covers**: AC-5, AC-9, AC-10, AC-11, AC-15, AC-16
**Decisions**: D-3, D-4
**Threats**: S-6
**Verified by**: Red/Green/Refactor, outside in, per the root `CLAUDE.md`'s Testing section. The
purge case belongs to the integration tier, not e2e — `apps/api/CLAUDE.md` says an "e2e spec that
reaches into a provider to set up or assert something (as `files.e2e-spec.ts` does with
`FilesPurgeService`) wants to be an `*.int-spec.ts` instead" — and it backdates a deleted file's
`deletedAt` and calls `purgeExpired()` directly. "Security test cases are mandatory, not optional":
authorization boundaries on every new route, auth bypass, and the download answering nothing without
a valid session. Swagger annotations updated for the profile response and the download route.
Suites: `npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **3.1** Cover the lifecycle, download and settings with specs — tests: the int
      cases for AC-10 (a deleted file's transcript is unreachable, a restored file's is back
      unchanged, and a backdated deletion driven through `purgeExpired()` removes both the file and
      its transcript, with every existing files spec still green) and AC-9 (replace on success, keep
      on failure), and the e2e cases for AC-5, AC-11, AC-15 and AC-16; red before 3.2 starts.
- [ ] **3.2** Carry a transcript through delete, restore and purge — unreachable while its file is
      soft-deleted, back unchanged when the file is restored, and gone when the hourly purge removes
      the file, which must keep deleting files exactly as it does today.
- [ ] **3.3** Replace a transcript only when the new run succeeds — a successful re-run overwrites
      the stored text, a failed one leaves it untouched, and no earlier transcript of that file
      stays reachable by any request.
- [ ] **3.4** Serve a transcript as a `.txt` download — the bytes carry the text literally, markup
      included and never interpreted, and the route answers nothing without a valid session for the
      file's owner. Literal is a property of the headers, not only of the bytes: `text/plain;
charset=utf-8`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` and a
      `Content-Disposition: attachment` built with the `content-disposition` package the file route
      already uses, so a transcript carrying markup cannot be sniffed into it (S-6).
- [ ] **3.5** Answer the transcription settings on the profile route — the model, effort level and
      language mode a run records for itself, and the configured defaults when the account has no
      finished run yet, added to the profile response's explicit key set rather than spread into it.
- [ ] **3.6** Update the module docs — `module-api-transcription.md`, `module-api-files.md` and
      `module-api-profile.md` for what each gained, plus the `apps/api/HISTORY.md` entry.

**Done when**: the three api suites are green — including every existing files and profile spec,
unchanged; a deleted file's transcript is unreachable and a restored one's is back; a backdated
purge removes file and transcript together; `GET /profile` answers the engine settings.

## Phase 4. Decompose the meeting page

**Goal**: the meeting page sits under the project's file ceiling and its file row is a Client
Component, with every page rendering and behaving exactly as it does today.
**Touches**: web
**Covers**: AC-1, AC-2, AC-3 — as the prerequisite the project's own rules put in front of them
**Decisions**: none — a parity refactor moves no mechanism
**Threats**: none — it adds no entry point
**Verified by**: the root `CLAUDE.md`'s Refactoring rules — "Only from a green baseline, in small
steps, the touched tier re-run after every step; a red step is fixed before the next" — plus
`apps/web/CLAUDE.md`'s visual baseline: "run the full check (`lint`, `test`, `test:e2e`) and confirm
it is green, then capture the current visual state of every affected page (screenshots under
`screenshots/`) as a baseline. Refactor in small steps; after each, re-run lint/tests and
re-screenshot the same pages to confirm nothing moved before taking the next." Behaviour does not
change, so no new spec is written for it and the existing suites are the gate; the one spec this
phase adds covers the row that becomes a unit for the first time. Suites: `npm run lint`,
`npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **4.1** Take the green baseline before moving anything — `lint`, `test:web` and `test:e2e:web`
      green, and screenshots of the meeting page in every state it has today (files, no files,
      deleted files) captured under `screenshots/` as the baseline every later step is compared to.
- [ ] **4.2** Split the meeting page under the 200-line ceiling — its date, size and time-left
      helpers and its section components move out of `page.tsx`, which stays an async Server
      Component fetching and composing exactly what it fetches and composes today.
- [ ] **4.3** Make the file row a Client Component — the row moves to `src/components/files/` with
      `'use client'`, keeping delete and restore on the Server Actions they already use, and gains
      the Vitest unit spec it could never have while it lived inside an async Server Component.
- [ ] **4.4** Update the meeting-files module doc — `docs/modules/module-web-meeting-files.md` for
      the new shape, and the entry in `apps/web/HISTORY.md` saying why the split happened when it
      did.

**Done when**: `npm run lint`, `npm run test:web` and `npm run test:e2e:web` are green with no spec
changed for behaviour; every file under `apps/web/src/app/meetings/[id]/` is within the 200-line
ceiling; the fresh screenshots match the baseline captured in 4.1.

## Phase 5. Start, watch and read a transcription

**Goal**: the owner starts a transcription from the file's row, watches it reach its final state
without touching the page, and reads the text under the file.
**Touches**: web
**Covers**: AC-1, AC-2, AC-3, AC-4, AC-8, AC-13, AC-16
**Decisions**: D-6
**Threats**: S-2, S-7
**Verified by**: "Tests come before the code, at every tier that applies — not e2e alone"
(`apps/web/CLAUDE.md`, Testing): Vitest + RTL for `src/lib` and Client Components, Route Handlers
and Server Actions called directly as `*.int-spec.ts(x)`, Playwright for the page, its auth gate and
its redirects — an async Server Component cannot be rendered by Vitest/RTL, so its rendering and its
gate are e2e's job. "Security test cases are mandatory, not optional": safe rendering of
user-controlled input (no XSS), the protected page against a missing or tampered session, and the
absence of the token from the page source and client bundle. After building the UI, review it with
`web-design-guidelines` then `ui-ux-pro-max` and verify visually against a running dev server.
Suites: `npm run test:web`, `npm run test:e2e:web`. D-6 puts a same-origin proxy Route Handler in
this phase, and `apps/web/CLAUDE.md` fixes the tier that proves one: "Route Handlers and Server
Actions called directly" as `*.int-spec.ts`, "the tier that pins the security-critical seams the
browser can't see into — the proxy's request/response header allow-list, the bearer token attached
server-side while the caller's own `Authorization` is dropped, the pre-upstream `401`" (S-2).
**Tasks**:

- [ ] **5.1** Cover starting, watching and reading with failing specs — tests: the Playwright cases
      for AC-1 (the control on the six speech-carrying types and on nothing else), AC-2, AC-3 (the
      row reaches its final state with no action by the owner), AC-4 (the fixture's words appear
      under its file and survive a reload and a fresh sign-in), AC-8, AC-13 (no language control
      anywhere) and AC-16 (a transcript carrying markup renders as literal text), plus the Vitest
      cases for the row's state machine; red before 5.2 starts.
- [ ] **5.2** Put a Transcribe control on speech-carrying rows — present on the six audio and video
      types, absent on every other accepted type, and unable to start a second run for a file whose
      run is already waiting or running. Starting and retrying are a Server Action or a `POST`, never
      a `GET` Route Handler: the session cookie is `sameSite: 'lax'`, which sends it on a cross-site
      top-level `GET` navigation and withholds it from a cross-site `POST` (S-7).
- [ ] **5.3** Show the run's state on the row — waiting, running, done, and failed with the reason
      the API stored, and nothing at all on a file that has never been transcribed.
- [ ] **5.4** Reach the final state without the owner acting — the row arrives at done or failed
      within 5 seconds of the run being recorded as finished, with no reload, refresh or navigation,
      and a page reloaded mid-run shows the run still in flight. The transport is D-6's: polling a
      new same-origin proxy Route Handler, which is the fourth of them and follows the three that
      exist exactly — `getSession()` first, `401` with no body before any upstream call, ids
      `encodeURIComponent`-escaped, and only `lib/api-proxy.ts`'s allow-listed headers in either
      direction (S-2).
- [ ] **5.5** Show the finished text and offer Retry — the transcript renders under its file as
      literal text, never as markup, and a failed run offers a Retry that starts a fresh run.
- [ ] **5.6** Update the meeting-files module doc — `docs/modules/module-web-meeting-files.md` for
      the transcription surface it gained, and the `apps/web/HISTORY.md` entry.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; an owner presses Transcribe
on a fixture recording and, without touching the page again, sees the row reach done and the text
appear under the file; a transcript containing `<script>` is visible as text.

## Phase 6. Copy, download and the profile section

**Goal**: the transcript can be taken out of the page, and the profile states what will run.
**Touches**: web
**Covers**: AC-5, AC-11, AC-15
**Decisions**: D-3, D-6
**Threats**: S-6
**Verified by**: "Tests come before the code, at every tier that applies — not e2e alone"
(`apps/web/CLAUDE.md`, Testing). This phase adds the fifth same-origin proxy Route Handler, and
that tier is fixed by the same doc: "Route Handlers and Server Actions called directly" as
`*.int-spec.ts`, which "is the tier that pins the security-critical seams the browser can't see into
— the proxy's request/response header allow-list, the bearer token attached server-side while the
caller's own `Authorization` is dropped, the pre-upstream `401`". Playwright covers the download and
the profile section. After building the UI, review it with `web-design-guidelines` then
`ui-ux-pro-max` and verify visually against a running dev server. Suites: `npm run test:web`,
`npm run test:e2e:web`.
**Tasks**:

- [ ] **6.1** Cover copy, download and the profile section with specs — tests: the
      integration cases for the new proxy route's header allow-list, its server-side bearer token
      and its pre-upstream `401` (AC-15), and the Playwright cases for AC-5 (copy puts the text on
      the clipboard, the download's contents equal the text shown) and AC-11; red before 6.2 starts.
- [ ] **6.2** Copy the transcript in one action — one control puts the whole text on the clipboard
      and tells the owner it did.
- [ ] **6.3** Download the transcript through a same-origin proxy — the fifth Route Handler, not the
      fourth: D-6 puts the run-state poller in phase 5, so three exist before this feature and four
      before this task. It forwards through `lib/api-proxy.ts`'s allow-lists with the token attached
      server-side, refusing with `401` before any upstream call when there is no session — and
      `x-content-type-options` joins that response allow-list, which today drops the `nosniff` 3.4
      sets and would let a transcript be sniffed into markup on this app's own origin (S-6).
- [ ] **6.4** Render the Transcription section on `/profile` — engine, model, effort level and
      language mode, with the statement that the audio does not leave the server, server-rendered in
      the first response and carrying no editable field, no selector and no API-key input.
- [ ] **6.5** Update the profile and meeting-files module docs — `module-web-profile.md` and
      `module-web-meeting-files.md`, the Status lines in `apps/web/CLAUDE.md`, and the
      `apps/web/HISTORY.md` entry closing the feature's web side.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a finished transcript copies
and downloads with contents identical to what the page shows, the download carrying `text/plain`,
`nosniff` and `attachment` all the way to the browser; `/profile` states the engine, model, effort
and language mode with nothing to fill in.

## Asked & assumed

- **Asked** — Which cut: `apps/api` fully green before `apps/web`, the page decomposition first, or
  api and web alternating one capability at a time? → Backend first, decomposition as its own phase
  immediately before the web work. Chosen over alternating, which would have put a working button in
  the browser after phase 2 at the cost of building the file row twice — once without the queue and
  the refusals, then again with them.
- **Asked** — AC-3 (a final state within 5 seconds, unattended) and AC-17 (the 21st request refused)
  collide: watching a run at that cadence costs about 30 requests a minute against a global ceiling
  of 20 per account, so the feature would throttle its own owner. → The route that answers a run's
  state carries its own, looser rate limit, following the per-route overrides already in the code;
  AC-17 stays a statement about starting a transcription, not about reading its state.
- **Asked** — AC-12 promises a run completes with outbound access denied, and no tier in this
  project can deny it today. → The criterion stays as written; which harness imposes the denial is
  `research`'s to settle, and if no tier can impose it the criterion is re-cut at
  `security-analyse` rather than quietly dropped.
- **Assumed** — Phase 1 may create the run-state enum, the transcript store and both routes in one
  phase · a phase that shipped the schema without a path that writes to it would have no observation
  to close on, only specs calling providers directly.
- **Assumed** — The engine's provisioning belongs to phase 1 and the duration probe to phase 2 ·
  they are independent consumers of the same media, and only `research` can say whether one
  provisioning serves both; if it does, the probe moves to phase 1 and phase 2 keeps AC-6.
- **Assumed** — Phase 4 changes no behaviour, so it writes no new spec for behaviour and is proven
  by the existing suites plus the screenshot baseline · if the decomposition turns out to need a
  behavioural change, it stops being a parity refactor and the phase has to be re-cut.
- **Assumed** — The file row must become a Client Component in phase 4 rather than phase 5 · leaving
  it a server-rendered `<li>` would make phase 5 rewrite what phase 4 had just written, and the
  project requires a decomposition to land in its own commit.
- **Assumed** — `FilesModule` gains a public surface for the owner-scoped file lookup rather than
  the transcription module copying its `where` clause · a copied ownership filter is exactly how
  AC-10 and AC-14 drift apart later.

## Revisions

- 2026-08-26 — research, round 1: phase 1 gains task **1.6**, the engine's weights provisioning and
  the isolated compose profile — D-10 (nothing may be fetched during a run, so the weights have to be
  placed before it) and D-8 (half of AC-12 has to be driven from inside an `internal: true` network,
  because published ports do not work on one).
- 2026-08-26 — research, round 1: task **1.4** reworded to carry two read shapes rather than one — a
  meeting-scoped state list with no transcript text, and a per-file read with it — D-6, because one
  route per file at the poll cadence AC-3 needs overruns even a widened throttle.
- 2026-08-26 — research, round 1: phase 1's **Verified by** and **Done when** name the two checks that
  sit outside the three suites, and the timed run that sets `WHISPER_TIMEOUT_MS` — D-8 and D-3.
- 2026-08-26 — research, round 1: task **6.3** corrected from the fourth Route Handler to the fifth —
  D-6 adds the fourth in phase 5.
- 2026-08-26 — research, round 1: every phase gains its `**Decisions**` line; phase 4 carries none,
  being a parity refactor. The plan's own question — whether the engine's provisioning also serves the
  duration probe — is answered **no** by D-7, so the probe stays in phase 2 and phase 2 keeps AC-6.
- 2026-08-26 — security-analyse, round 1: phase 2 gains task **2.6**, the machine-wide one-run-at-a-time
  cap, and AC-18 on its `**Covers**` — threats S-4, the finding the user raised into a criterion.
- 2026-08-26 — security-analyse, round 1: phase 1 gains AC-19 on its `**Covers**`, and task **1.6**
  gains the engine container's hardening — threats S-8, the second finding raised into a criterion, with
  S-9's accepted residual resting on its loopback-only published port.
- 2026-08-26 — security-analyse, round 1: task **1.4** gains the export and the guard its scoping
  actually needs (`MeetingOwnerGuard` is a `FilesModule` provider that nothing exports) — threats S-1.
- 2026-08-26 — security-analyse, round 1: task **1.2** bounds the engine's response while reading it
  rather than after parsing — threats S-3.
- 2026-08-26 — security-analyse, round 1: task **2.3** gains the ceiling on an account's waiting runs —
  threats S-5.
- 2026-08-26 — security-analyse, round 1: task **3.4** gains the download's response headers and task
  **6.3** adds `x-content-type-options` to `lib/api-proxy.ts`'s response allow-list, which strips it
  today — threats S-6.
- 2026-08-26 — security-analyse, round 1: task **5.2** fixes starting and retrying as a Server Action or
  a `POST`, never a `GET` — threats S-7; task **5.4** names the proxy seam, and phase 5's
  `**Verified by**` gains the Route-Handler integration tier that proves it — threats S-2.
- 2026-08-26 — security-analyse, round 1: every phase gains its `**Threats**` line. Controls were folded
  into the task that builds their entry point rather than each taking a task of its own, because phases
  1, 3 and 5 already stand at the five-building-task ceiling; the threats file's section 5 records what
  that costs and what splitting phase 1 would buy back.
- 2026-08-27 — research, round 2: **D-5 superseded by D-11**; phase 2's `**Decisions**` reads
  `D-7, D-11`, and tasks **2.2**, **2.5** and **2.6** name the in-process single-slot gate, global
  FIFO on `queuedAt` and the `onModuleInit` sweep — threats S-4. The conditional `updateMany` D-5
  chose is atomic per row and cannot express a machine-wide cap; re-checking it showed it never
  carried the per-account one either, so AC-7 was resting on it too.
- 2026-08-27 — research, round 2: task **1.2** bounds the engine's response by
  `MAX_ENGINE_RESPONSE_BYTES` rather than by `MAX_TRANSCRIPT_CHARS` — threats S-3. The two are
  different units, and a byte counter set at the character ceiling would fail a legitimate
  non-English hour, which is AC-13's own test.
- 2026-08-27 — research, round 2: task **1.6** gains `memswap_limit`, `pids_limit`, a sized `tmpfs`,
  a compose network of its own, and the three settings that decide whether the stock image runs at
  all — `--tmp-dir`, an argv-list `command:` with `entrypoint` overridden, and `--host 0.0.0.0`
  inside the container — threats S-8, whose control named `mem_limit` and `cpus` without values.
- 2026-08-27 — research, round 2: task **2.4** names where the duration probe lives (D-7, answering
  the question the task left open) and adds the three packages this repository imports but resolves
  only transitively — D-7 and threats S-6.
- 2026-08-27 — security-analyse, round 2: task **2.6** gains the three lines that keep the machine's
  single slot from being wedged or lost — an unconditional `finally`, a timeout-bounded hold and a
  tick that swallows its own errors — and phase 2's `**Threats**` reads `S-4, S-5, S-10` — threats
  **S-10**, the reach D-11 creates by moving the cap from the database into the process. No new
  criterion: AC-7 and AC-18 already promise that a waiting run starts once the one before it ended.
- 2026-08-27 — research, round 2: phase 6's `**Verified by**` corrected from the "fourth" to the
  "fifth" same-origin proxy Route Handler, agreeing with task 6.3 — D-6. An error left behind by
  round 1's own revision, not a new decision.
