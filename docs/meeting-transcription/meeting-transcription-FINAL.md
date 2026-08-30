# Final plan: Meeting transcription

**Key**: MT
**PRD**: [meeting-transcription-PRD.md](./meeting-transcription-PRD.md)
**Plan**: [meeting-transcription-PLAN.md](./meeting-transcription-PLAN.md)
**Research**: [meeting-transcription-RESEARCH.md](./meeting-transcription-RESEARCH.md)
**Threats**: [meeting-transcription-THREATS.md](./meeting-transcription-THREATS.md)
**Date**: 2026-08-30
**Status**: ready for /bldprj:issues

## What ships

The owner of a meeting presses Transcribe on any of the six speech-carrying files in it (`mp4`,
`webm`, `mov`, `mp3`, `wav`, `m4a`) and gets the spoken words back as plain text under that file,
copyable in one action and downloadable as a `.txt`. The words are computed on this machine by
whisper.cpp in a compose service — the audio, the file name and the text never leave it. The limits
the owner will meet: 60 minutes of audio per file, at most 10 transcriptions waiting per account,
one run at a time per account and **one run at a time on the whole machine**, and the API's standard
20 starts per 60 seconds. A recording whose length cannot be read inside 1.5 seconds is refused
rather than run. `/profile` states the engine, model (`tiny`), effort (`low`) and language mode
(`auto`) and has nothing to fill in. Deferred to the next iteration: a remote Whisper-compatible
API and the model/effort selectors, timestamps and subtitles, diarisation, summaries and search.
Four rulings changed the documents behind this plan: the phase cut stands as planned (T-1), the
duration probe's timeout drops from 10 s to 1.5 s so the 2-second promise in AC-2 stays keepable
(T-2), AC-6 now also carries the unreadable-length refusal (T-3), and the waiting-run ceiling became
**AC-20** (T-4).

## Trace

| AC    | Phase                                      | Tasks                                                               | Decisions          | Findings  | Proven by                                                                                                                                                                                 |
| ----- | ------------------------------------------ | ------------------------------------------------------------------- | ------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | 2 api · 5 web                              | 2.3, 5.2, 5.3                                                       | D-7                | —         | `transcription.e2e-spec.ts` — a `pdf` answers 415; `e2e/meeting-transcription.spec.ts` — the control on the six types and on nothing else, present on a >60-minute recording              |
| AC-2  | 2 api · 5 web                              | 2.3, 5.2                                                            | D-11               | S-7       | `transcription.e2e-spec.ts` — a second start for a file already `QUEUED`/`RUNNING` answers 409; `e2e/meeting-transcription.spec.ts` — the row shows waiting/running within 2 s, no reload |
| AC-3  | 5                                          | 1.4, 5.4                                                            | D-6                | S-2       | `e2e/meeting-transcription.spec.ts` — the row reaches its final state ≤5 s after the run is recorded finished, unattended; a reload mid-run still shows it in flight                      |
| AC-4  | 1 api · 5 web                              | 1.2, 1.3, 1.4, 1.6, 5.5                                             | D-1, D-2, D-3, D-4 | S-3       | `transcription.e2e-spec.ts` — the fixture's known words in the stored text; a fixed string, an empty transcript or the file's own name fails                                              |
| AC-5  | 3 api · 6 web                              | 3.4, 6.2, 6.3                                                       | D-6                | S-6       | `transcription.e2e-spec.ts` — the `.txt` body equals the stored text; `e2e/meeting-transcription.spec.ts` — copy and download                                                             |
| AC-6  | 2                                          | 2.4                                                                 | D-7                | —         | `transcription.e2e-spec.ts` — a 61-minute recording answers 422 with `AUDIO_DURATION_LIMIT_MESSAGE`, an unreadable one 422 with `DURATION_UNREADABLE_MESSAGE`, neither creating a row     |
| AC-7  | 2                                          | 2.2, 2.5, 2.6                                                       | D-11               | S-4, S-10 | `transcription.int-spec.ts` — two runs of one account, non-overlapping `startedAt`/`endedAt`                                                                                              |
| AC-8  | 2 api · 5 web                              | 1.2, 1.3, 2.5, 5.3, 5.5                                             | D-4                | S-3, S-10 | `transcription.e2e-spec.ts` — the stored reason is answered and no partial text is stored; `e2e/meeting-transcription.spec.ts` — failed state plus Retry                                  |
| AC-9  | 3                                          | 3.3                                                                 | D-4                | —         | `transcription.int-spec.ts` — a successful re-run replaces `text`, a failed one leaves it                                                                                                 |
| AC-10 | 3                                          | 1.3, 3.2                                                            | D-4                | —         | `transcription.int-spec.ts` — backdated `deletedAt` then `purgeExpired()` removes file and transcript together                                                                            |
| AC-11 | 3 api · 6 web                              | 1.3, 3.5, 6.4                                                       | D-3                | —         | `transcription.e2e-spec.ts` — `GET /profile` answers the four settings and follows `WHISPER_MODEL`; `e2e/profile.spec.ts` — the read-only section                                         |
| AC-12 | 1                                          | 1.1, 1.2, 1.6                                                       | D-8, D-10          | —         | `transcription.int-spec.ts` recorder (half B) plus the scripted `docker compose -f docker-compose.offline.yml` run in phase 1's **Done when** (half A)                                    |
| AC-13 | 1 api · 5 web                              | 1.2, 1.3                                                            | D-3                | S-3       | `transcription.int-spec.ts` — a non-English fixture comes back in the language spoken; `e2e/meeting-transcription.spec.ts` — no language control anywhere                                 |
| AC-14 | 1 start/read · 3 download                  | 1.4, 3.4                                                            | D-9                | S-1       | `transcription.e2e-spec.ts` — a second account gets the same 404 on start, read **and download** as for ids that never existed                                                            |
| AC-15 | 1/3 api · 5 state proxy · 6 download proxy | 1.4, 3.4, 5.4, 6.3                                                  | D-6                | S-2       | `route.int-spec.ts` beside each handler — no session → 401 with `fetch` never called; `transcription.e2e-spec.ts` — no token → 401                                                        |
| AC-16 | 3 bytes · 5 page · 6 proxy                 | 3.4, 5.5, 6.3                                                       | D-6                | S-6       | `e2e/meeting-transcription.spec.ts` — `<script>` shown as literal text, and the download reaches the browser with `text/plain`, `nosniff`, `attachment`                                   |
| AC-17 | 2                                          | 2.1 proves it; 1.4 and 2.3 keep the start route free of an override | —                  | —         | `transcription.e2e-spec.ts` — the 21st start inside 60 s answers 429 and creates no row                                                                                                   |
| AC-18 | 2                                          | 2.5, 2.6                                                            | D-11               | S-4, S-10 | `transcription.int-spec.ts` — runs of two **different** accounts never overlap, from the recorded times                                                                                   |
| AC-19 | 1                                          | 1.6                                                                 | D-1, D-8           | S-8, S-9  | `docker inspect` in phase 1's **Done when**, plus `transcription.int-spec.ts` — a fixture whose container carries an external reference ends `FAILED` with no transcript                  |
| AC-20 | 2                                          | 2.3                                                                 | —                  | S-5       | `transcription.e2e-spec.ts` — with 10 waiting, the next start answers 409 with `WAITING_RUN_CAP_MESSAGE` and creates no row                                                               |

Phase 4 produces no criterion. It carries `AC-1, AC-2, AC-3` as the prerequisite the project's own
200-line rule puts in front of them; all three first become true in phase 5.

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
`@nestjs/swagger` annotations, checked in the Swagger UI before the work is called done. The cases
go in `apps/api/test/transcription.e2e-spec.ts` (new), `apps/api/src/transcription/transcription.int-spec.ts`
(new, the shape `profile.int-spec.ts` sets) and colocated `*.spec.ts` beside each unit. Suites:
`npm run test:api`, `npm run test:int:api`, `npm run test:e2e:api`. Two checks in this phase sit
outside those suites, and D-8 and D-3 say why: half of AC-12 is a scripted `docker compose` run
against the isolated profile task 1.6 adds, because published ports do not work on a network declared
`internal: true` (moby#36174) and the denial therefore has to be driven from inside it; and the
engine's real throughput has to be measured once, on this machine, before `WHISPER_TIMEOUT_MS` is
worth anything. Both are evidenced in **Done when**.
**Status**: in review — PR https://github.com/seosmmbusiness/video-meetings/pull/229
**Tasks**:

- [x] **1.1** Cover one transcription end to end with failing specs — tests: the e2e cases for AC-4
      (a fixture recording whose spoken words are known, asserted against the stored text — a fixed
      string, an empty transcript or the file's own name must fail) and AC-14 (another owner's file
      answers the same 404 as one that does not exist, on **start and read**), the int cases for
      AC-13 (a non-English fixture comes back in the language spoken), AC-12's case asserting no
      connection or DNS lookup leaves the machine for the whole run — recording `dns.lookup`,
      `dns.resolve*` and their `dns.promises` twins, `net.Socket.prototype.connect` and `tls.connect`
      around the run and asserting every destination is loopback (D-8 half B, installed and removed
      around the run so it cannot leak into other specs) — and **AC-19's second half**: a fixture
      whose container format carries an external reference ends the run `FAILED` with no transcript
      and no trace of a read file (S-8's **Proven by**, which no task carried). Red before 1.2 starts.
- [x] **1.2** Turn a stored recording into text on this machine — an engine boundary that takes a
      storage key and answers with the text plus the detected language. It is `TranscriptionEngine`,
      an abstract class bound as its own Nest injection token exactly as `FileStorage` is, with
      `WhisperCppEngine` in `apps/api/src/transcription/whisper-cpp.engine.ts` the only
      implementation (D-1). The wire call is `POST ${WHISPER_URL}/inference` with
      `response_format=verbose_json` and `language=auto`, sent with **`node:http`'s `request()`**,
      not `fetch` — the multipart preamble written by hand, `FileStorage.createReadStream(key)`
      piped in, the boundary a `randomUUID()` and the part's `filename` a fixed literal so the
      owner's file name never travels (D-2). Two constraints the rest of the plan rests on: it is
      stubbable at the unit tier, so `pre-push` never needs the engine running, and an absent or
      unreachable engine degrades to a failed run — never a failed startup and never a failed
      request — the same way the root `CLAUDE.md` requires of Redis. The engine's answer is the one
      input to this feature that arrives with no size contract, so it is bounded while it is read
      rather than after it is parsed: past `MAX_ENGINE_RESPONSE_BYTES` (`8_388_608`, 8 MiB) the
      stream is abandoned and the run fails, `Content-Length` serving only as a fast path and never
      as the control. The parsed shape is then validated before it is stored — `text` a string
      within `MAX_TRANSCRIPT_CHARS` (`1_048_576`) **characters**, `language` (**not**
      `detected_language`) a string within `MAX_DETECTED_LANGUAGE_LENGTH` (`64`), everything else
      discarded; a missing or non-string `language` is a clean failure (S-3). The two ceilings are in
      different units and neither replaces the other; research §5 says why, and a legitimate
      non-English hour is the case that proves it. "Degrades to a failed run" also has to cover the
      engine dying under the memory limit 1.6 sets: a transport error and a non-2xx answer are
      treated identically, both ending the run as failed. The call is bounded by an `AbortSignal` at
      `WHISPER_TIMEOUT_MS` (`1_800_000`), the same bound 2.6's slot hold uses.
- [x] **1.3** Store a run and its transcript — one migration carrying `enum TranscriptionState
{ QUEUED RUNNING SUCCEEDED FAILED }` (the schema's first enum) and `model FileTranscription`
      with `fileId @unique`, `text String?`, `failureReason String? @db.VarChar(200)`, `engine`,
      `model`, `effort`, `languageMode` (`@db.VarChar(32/32/16/16)`), `detectedLanguage String?
@db.VarChar(64)`, `queuedAt @default(now())`, `startedAt`, `endedAt`, `createdAt`, `updatedAt`
      and `@@index([state, queuedAt])`, mapped `@@map("file_transcriptions")` (D-4). The relation to
      `MeetingFile` is **`onDelete: Cascade`** — the schema's only precedent is `onDelete: Restrict`,
      which would make `FilesPurgeService.purgeExpired()`'s `meetingFile.delete()` throw. The schema
      moves once here rather than being caught up by later phases; `text` is written once, at the
      end, in the same update that sets `SUCCEEDED`, so a swept row can never carry half a
      transcript (AC-8, AC-9, AC-10, AC-11).
- [x] **1.4** Start a run and read it back — a route that starts a transcription for one file
      (`POST /meetings/:meetingId/files/:fileId/transcription`), and the two read shapes D-6 needs
      rather than one: a **meeting-scoped** state list (`GET /meetings/:meetingId/transcriptions`)
      carrying every file's run state and no transcript text, which is what the page polls, and a
      **per-file** read (`GET /meetings/:meetingId/files/:fileId/transcription`) answering that
      file's state and its text. All three are scoped to the caller's own meeting through the files
      module's public surface rather than a copied `where` clause, and all three answer the same 404
      as a file that does not exist. That surface is two things, not one: `FilesModule` gains
      `exports: [FilesService, MeetingOwnerGuard]` — it has no `exports` array at all today — the
      controller carries `@UseGuards(JwtAuthGuard, MeetingOwnerGuard)` as `files.controller.ts:74`
      does, and the list route — which has no `:fileId` and so no cover from `findFileForOwner` —
      filters `meeting: { ownerId }` too (S-1, D-9). Both **read** routes carry
      `@Throttle({ default: { limit: 240, ttl: 60_000 } })`, matching `files.controller.ts:196`, so
      the page watching a run cannot throttle its owner out; the **start** route carries no
      `@Throttle` override at all, because AC-17 is a statement about the global 20 / 60 s baseline.
      Responses are built field by field — `storageKey`, `text` on the list route and every internal
      column stay off the wire.
- [x] **1.5** Document the transcription module — a new `docs/modules/module-api-transcription.md`
      per the root `CLAUDE.md`'s Module documentation section, its row in `docs/modules/INDEX.md`,
      the Status line in `apps/api/CLAUDE.md`, the entry in `apps/api/HISTORY.md`, and what the
      engine adds to `docker-compose.yml` (the `whisper` service itself), `.env.example`
      (`WHISPER_URL=http://127.0.0.1:9000`, `WHISPER_PORT=9000`, `WHISPER_MODEL=tiny`,
      `WHISPER_TIMEOUT_MS=1800000`) and `README.md` (the setup step that runs 1.6's provisioning
      script, and the requirement that Docker be running).
- [x] **1.6** Provision the engine's weights and the offline profile — a provisioning script wired
      as an npm script beside `db:up` that downloads `ggml-${WHISPER_MODEL}.bin` once into a
      gitignored `.data/whisper-models/`, verified against the SHA1 whisper.cpp publishes
      (`tiny` = `bd577a113a864445d4c299885e0cb97d4ba92b5f`, 75 MiB) and mounted `:ro`, so nothing is
      fetched during a run (D-10); plus the `docker-compose.offline.yml` profile that puts the engine
      on an `internal: true` network with a one-shot client container on it, which is how half of
      AC-12 is driven (D-8). The service is also hardened here, because this is where it is defined
      and because ffmpeg inside it parses whatever an owner uploads (S-8, AC-19). Every value,
      verbatim from research §5: image `ghcr.io/ggml-org/whisper.cpp:main`; `entrypoint:
["whisper-server"]` overriding the image's `ENTRYPOINT ["bash","-c"]`; an **argv-list**
      `command:` of `--host 0.0.0.0 --port 8080 -m /models/ggml-${WHISPER_MODEL}.bin --tmp-dir /tmp
--convert -t 4 -l auto -nt -bo 1 -bs -1 -nf`; `user: "1000:1000"`; `read_only: true`;
      `tmpfs: /tmp:size=768m,mode=1777,noexec,nosuid,nodev`; `cap_drop: [ALL]`;
      `security_opt: ["no-new-privileges:true"]`; `mem_limit: 2560m` with `memswap_limit: 2560m`
      (equal, which disables swap); `cpus: 4.0` moving together with `-t 4`; `pids_limit: 128`;
      volume `./.data/whisper-models:/models:ro`; port `127.0.0.1:${WHISPER_PORT}:8080` (S-9's
      accepted residual rests on that); network `whisper_net`, **its own**, not the default one that
      already holds `db` and `redis`; and no mount of `STORAGE_ROOT`. Three of those are not tuning
      but the difference between working and silently not: `--tmp-dir /tmp`, because the engine's
      default work directory is the image's root-owned `/app`; the argv-list `command:` with
      `entrypoint` overridden, because a string `command:` would discard every flag while still
      appearing to start; and `--host 0.0.0.0` **inside** the container, whose default is
      `127.0.0.1` and would be unreachable through any published port. Ordering: this has to run
      before 1.2 can go green. This task's first `docker compose up` is also what settles the two
      figures research could not measure — the real memory peak behind `mem_limit`, and whether uid
      1000 can run the stock image at all (research §8: if it cannot, `user:` fails outright and
      AC-19 needs a locally-built image with a `USER` line — stop and raise it, do not drop the
      hardening).

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green; a
fixture recording posted to `POST /meetings/:meetingId/files/:fileId/transcription` comes back from
`GET /meetings/:meetingId/files/:fileId/transcription` as text containing the words known to be
spoken in it; stopping the engine turns a run into a failed one and leaves the API answering every
other route as before. AC-12 is closed by both halves and by neither alone: `docker compose -f
docker-compose.yml -f docker-compose.offline.yml` transcribes the fixture with the engine on a
network that has no route off the machine, and the integration spec records no non-loopback
connection or DNS lookup out of `apps/api` for the whole of a real run. One full-length run is timed
on this machine, and its number — not D-3's estimate — is what `WHISPER_TIMEOUT_MS` and the README
are set from; if `tiny` cannot carry AC-4 or AC-13 on that run, `WHISPER_MODEL` is raised to `base`
and the weights re-pulled (research §8: one env var, no code, no migration). `docker inspect` on the
running engine shows a non-root user, a read-only root filesystem, dropped capabilities, no mount of
`STORAGE_ROOT`, a network that is not the default one, and a loopback-only published port; and the
crafted-container fixture from 1.1 ends `FAILED` with no transcript (AC-19).

## Phase 2. One run at a time, and every refusal

**Goal**: an account's transcriptions never overlap, a waiting run starts by itself once the one
before it ends, and every refusal the PRD names is enforced at the route.
**Touches**: api
**Covers**: AC-1, AC-2, AC-6, AC-7, AC-8, AC-17, AC-18, AC-20
**Decisions**: D-7, D-11
**Threats**: S-4, S-5, S-10
**Verified by**: Red/Green/Refactor, outside in, per the root `CLAUDE.md`'s Testing section — the
e2e cases first and red in their own `test(api): …` commit, then each unit's spec red before the
code that greens it. "Security test cases are mandatory, not optional" (`apps/api/CLAUDE.md`,
Testing): authorization boundaries (IDOR), auth bypass, mass assignment, and
"rate-limiting/brute-force protection on sensitive endpoints" — AC-17 belongs to this phase and is
proven at the tier that actually proves it. Swagger annotations updated for every refusal a route
gains. The cases go in `apps/api/test/transcription.e2e-spec.ts`,
`apps/api/src/transcription/transcription.int-spec.ts` (the scheduler driven directly, as
`quota-reservation.service.spec.ts` drives its own) and
`apps/api/src/transcription/transcription-scheduler.service.spec.ts` /
`audio-duration.service.spec.ts`. Suites: `npm run test:api`, `npm run test:int:api`,
`npm run test:e2e:api`.
**Tasks**:

- [ ] **2.1** Cover the queue and every refusal with failing specs — tests: the e2e cases for AC-1
      and AC-2 (a file that is not one of the six speech-carrying types, and a second request for a
      file already in flight, both refused at the API), AC-6 (a recording over 60 minutes **and** one
      whose length cannot be read), **AC-20** (the 11th waiting run refused with 409 and no row
      created), AC-8 (the failure reason is stored and answered) and AC-17 (the 21st start request
      inside 60 seconds is refused with `429` and starts no run), plus the int cases for AC-7 and
      **AC-18** driving the scheduler directly — two runs of one account and two runs of **two
      different accounts**, both asserted non-overlapping from the recorded `startedAt`/`endedAt` —
      and **S-10's three scheduler cases**: after a run that throws, one that times out and a claim
      that throws, the next tick claims the next `QUEUED` run rather than finding the slot held, and
      a rejecting tick produces a logged error and no unhandled rejection. Red before 2.2 starts.
- [ ] **2.2** Let only one of an account's runs work at a time — at most one running, the next
      waiting run starting when the one before it ends, whether it ended by finishing or by
      failing, and the recorded start and end times showing that two runs of one account never
      overlap. The conditional row claim alone never carried this — it is atomic per row, and two
      overlapping ticks can each claim a _different_ row of the same account — so this criterion
      rests on the same gate 2.6 builds, not on the claim (D-11).
- [ ] **2.3** Refuse a run that may not start — a second run for a file already waiting or running
      (`409 ConflictException`), a run for a file outside the six speech-carrying types
      (`415 UnsupportedMediaTypeException`, against `SPEECH_MIME_TYPES` = `video/mp4`, `video/webm`,
      `video/quicktime`, `audio/mpeg`, `audio/wav`, `audio/mp4` in
      `apps/api/src/transcription/transcription.constants.ts`, a subset of `ACCEPTED_MIME_TYPES`),
      and a run that would push the account past `MAX_WAITING_RUNS_PER_ACCOUNT` = `10` waiting runs
      (`409`, raised on `>=`, with `WAITING_RUN_CAP_MESSAGE` = `You already have 10 transcriptions
waiting. Wait for one to finish before starting another.`) — each refused at the route with
      nothing stored and no run created (S-5, AC-20). The constant and its message follow
      `MAX_LIVE_FILES_PER_MEETING` / `LIVE_FILE_CAP_MESSAGE` (`files.constants.ts:11,64`) exactly,
      and its JSDoc records that 10 is chosen rather than derived (T-4, research §5). Ownership
      resolves **before** type and duration, so a caller never learns another owner's file exists by
      being told what type it is; the route still carries no `@Throttle` override (AC-17).
- [ ] **2.4** Refuse a recording longer than 60 minutes — the audio's duration decides, not the
      file's byte size, and the refusal states the limit: `MAX_AUDIO_DURATION_MS` = `3_600_000` with
      `AUDIO_DURATION_LIMIT_MESSAGE` = `Recording exceeds the 60-minute transcription limit.`,
      answered as `422 UnprocessableEntityException`. It is measured inside the API process in
      `apps/api/src/transcription/audio-duration.service.ts` by `music-metadata` 11.15.0 reached
      through `load-esm` exactly as `file-type` already is, with `{ duration: true }`, reading
      through `FileStorage` and never a caller-supplied path — not by the engine, whose ffmpeg lives
      in the container and is unreachable from `apps/api` (D-7). It **fails closed**: a duration that
      cannot be read inside `DURATION_PROBE_TIMEOUT_MS` = **`1_500`** (lowered from research §5's
      `10_000` by **T-2**, so the whole start request still fits AC-2's 2-second promise) is refused
      with `DURATION_UNREADABLE_MESSAGE` = `Could not read this recording's length.`, also `422`,
      and no run starts (AC-6 as amended by T-3). The same task declares the three packages this
      repository imports but resolves only transitively — `load-esm@1.0.3`, `file-type@21.3.4` and
      `content-disposition@1.1.0` — each pinned at the version already resolved rather than the
      registry's newest, since a bump would silently move code that works today (D-7 makes this
      feature depend on the first, S-6's download headers on the third).
- [ ] **2.5** Recover a run that a restart interrupted — a run left in flight by a stopped API comes
      back as `FAILED` with a reason its owner can read, not as one that runs forever, so the
      account's single slot is never lost. The sweep runs at `onModuleInit`, before any interval is
      mounted: Nest orders every `onModuleInit` ahead of all `onApplicationBootstrap` hooks but
      promises nothing between two modules' `onApplicationBootstrap`, which is where
      `SchedulerOrchestrator` mounts its interval — so a tick could otherwise fire before the sweep
      (D-11).
- [ ] **2.6** Hold the machine to one run at a time — the scheduler in
      `apps/api/src/transcription/transcription-scheduler.service.ts` claims at most one `RUNNING`
      run **across all accounts**, not one per account, so N accounts cannot put N concurrent
      requests into the single engine (AC-18, S-4). What holds it is an in-process single-slot gate
      read and set with **no `await` between**, because `@Interval(SCHEDULER_TICK_MS)`
      (`SCHEDULER_TICK_MS` = `1_000`, a named constant, not a literal) is a bare `setInterval` that
      never awaits its callback and re-enters; ticks are **dropped** while the slot is held, never
      queued. D-5's conditional `updateMany` stays underneath as the per-row guard. The next run is
      simply the oldest `QUEUED` row by `queuedAt` across all accounts — global FIFO, which is all
      the PRD promises, and which needs no owner join and no new index, `@@index([state, queuedAt])`
      already serving both queries (D-11). Holding the slot is now the only way to stop the whole
      machine, so three lines are part of this task rather than of whoever writes it (S-10): the
      `finally` that clears the slot is **unconditional**, with no branch and no early return past
      it; the hold is bounded by the same hard `WHISPER_TIMEOUT_MS` that bounds the engine call, so
      no hold outlives it; and the tick catches and logs its own errors and never rethrows, because
      an unhandled rejection terminates the process on this runtime. Each has its own spec, listed in
      2.1. Inference inside the engine is already serialised by a mutex, but its handler takes that
      mutex only after the whole upload has been buffered, so concurrency there costs memory rather
      than time. `mem_limit` and `cpus` on the service (1.6) are the backstop for a scheduler that is
      ever wrong. The scheduler logs a count, never a filename or transcript text, the precedent
      `FilesPurgeService` sets.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green with a
case per refusal — `409` for a file already in flight and for the 11th waiting run, `415` for a
non-speech type, `422` for over-60-minutes and for an unreadable length, `429` for the 21st start
inside 60 seconds; two files started back to back for one account show non-overlapping recorded
runs, and so do two runs belonging to two **different** accounts; killing the API mid-run and
restarting it leaves that run `FAILED` and the next one able to start.

## Phase 3. Transcript lifecycle, download and settings

**Goal**: a transcript follows its file through delete, restore and purge, can be fetched as a
`.txt`, and the settings a run used are readable from the profile.
**Touches**: api · database
**Covers**: AC-5, AC-9, AC-10, AC-11, AC-14, AC-15, AC-16
**Decisions**: D-3, D-4
**Threats**: S-6
**Verified by**: Red/Green/Refactor, outside in, per the root `CLAUDE.md`'s Testing section. The
purge case belongs to the integration tier, not e2e — `apps/api/CLAUDE.md` says an "e2e spec that
reaches into a provider to set up or assert something (as `files.e2e-spec.ts` does with
`FilesPurgeService`) wants to be an `*.int-spec.ts` instead" — and it backdates a deleted file's
`deletedAt` and calls `purgeExpired()` directly, in
`apps/api/src/transcription/transcription.int-spec.ts`. "Security test cases are mandatory, not
optional": authorization boundaries on every new route — including the download, which is AC-14's
third verb — auth bypass, and the download answering nothing without a valid session. Swagger
annotations updated for the profile response and the download route. Suites: `npm run test:api`,
`npm run test:int:api`, `npm run test:e2e:api`.
**Tasks**:

- [ ] **3.1** Cover the lifecycle, download and settings with specs — tests: the int cases for AC-10
      (a deleted file's transcript is unreachable, a restored file's is back unchanged, and a
      backdated deletion driven through `purgeExpired()` removes both the file and its transcript,
      with every existing files spec still green) and AC-9 (replace on success, keep on failure),
      and the e2e cases for AC-5, AC-11, AC-15, AC-16 and **AC-14 on the download route** (a second
      account gets the same 404 for the `.txt` as for a file id that never existed). Red before 3.2
      starts.
- [ ] **3.2** Carry a transcript through delete, restore and purge — unreachable while its file is
      soft-deleted, back unchanged when the file is restored, and gone when the hourly purge removes
      the file, which must keep deleting files exactly as it does today. No column of its own is
      needed: every read path goes through `findFileForOwner`, which already filters
      `deletedAt: null`, and `onDelete: Cascade` (1.3) is what makes the purge remove the row (D-4).
- [ ] **3.3** Replace a transcript only when the new run succeeds — a re-run resets `state`,
      `queuedAt`, `startedAt`, `endedAt` and `failureReason` while **leaving `text` untouched**, and
      only a success overwrites `text`; a failed re-run therefore shows a failed row with the
      previous text still under it, and no earlier transcript of that file stays reachable by any
      request (D-4, AC-9).
- [ ] **3.4** Serve a transcript as a `.txt` download — the bytes carry the text literally, markup
      included and never interpreted, and the route answers nothing without a valid session for the
      file's owner, and the same 404 as a file that does not exist for anyone else (AC-14). Literal
      is a property of the headers, not only of the bytes: `Content-Type: text/plain; charset=utf-8`,
      `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` and a
      `Content-Disposition: attachment` built with the `content-disposition` package the file route
      already uses (declared at `1.1.0` in 2.4), so a transcript carrying markup cannot be sniffed
      into it (S-6).
- [ ] **3.5** Answer the transcription settings on the profile route — engine `local`, model
      `${WHISPER_MODEL}`, effort `low` and language mode `auto` as `TranscriptionEngine.settings()`
      reports them, the values a run recorded for itself where the account has a finished run and the
      configured defaults where it does not, added to `ProfileResponseDto`'s explicit key set rather
      than spread into it — the rule that file already states (AC-11).
- [ ] **3.6** Update the module docs — `module-api-transcription.md`, `module-api-files.md` and
      `module-api-profile.md` for what each gained, plus the `apps/api/HISTORY.md` entry.

**Done when**: `npm run test:api`, `npm run test:int:api` and `npm run test:e2e:api` are green —
including every existing files and profile spec, unchanged; a deleted file's transcript is
unreachable and a restored one's is back; a backdated purge removes file and transcript together;
`GET …/transcription/download` answers `200` with `text/plain; charset=utf-8`, `nosniff` and
`attachment` for the owner and `404` for anyone else; `GET /profile` answers the engine settings.

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
phase adds is `apps/web/src/components/files/<row>.spec.tsx`, covering the row that becomes a unit
for the first time. Suites: `npm run lint`, `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **4.1** Take the green baseline before moving anything — `lint`, `test:web` and `test:e2e:web`
      green, and screenshots of the meeting page in every state it has today (files, no files,
      deleted files) captured under `screenshots/` as the baseline every later step is compared to.
- [ ] **4.2** Split the meeting page under the 200-line ceiling — its date, size and time-left
      helpers and its section components move out of `page.tsx` (317 lines today), which stays an
      async Server Component fetching and composing exactly what it fetches and composes today.
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
**Covers**: AC-1, AC-2, AC-3, AC-4, AC-8, AC-13, AC-15, AC-16
**Decisions**: D-6
**Threats**: S-2, S-7
**Verified by**: `apps/web/CLAUDE.md`, Testing — "Three tiers, test-first and outside in, per the
root `CLAUDE.md`'s Testing section", where "unit and integration run on Vitest + React Testing
Library and are written first, in the inner loop, against the units the e2e scenario needs":
Vitest + RTL for `src/lib` and Client Components, Route Handlers and Server Actions called directly
as `*.int-spec.ts(x)`, Playwright for the page, its auth gate and its redirects — an async Server
Component cannot be rendered by Vitest/RTL, so its rendering and its gate are e2e's job. "Security
test cases are mandatory, not optional": safe rendering of user-controlled input (no XSS), the
protected page against a missing or tampered session, and the absence of the token from the page
source and client bundle. D-6 puts a same-origin proxy Route Handler in this phase, and the same doc
fixes the tier that proves one: "Route Handlers and Server Actions called directly" as
`*.int-spec.ts`, "the tier that pins the security-critical seams the browser can't see into — the
proxy's request/response header allow-list, the bearer token attached server-side while the caller's
own `Authorization` is dropped, the pre-upstream `401`" (S-2, AC-15) — the cases go in
`apps/web/src/app/api/meetings/[meetingId]/transcriptions/route.int-spec.ts`, mirroring
`…/files/[fileId]/content/route.int-spec.ts`. Playwright cases go in
`apps/web/e2e/meeting-transcription.spec.ts`. After building the UI, review it with
`web-design-guidelines` then `ui-ux-pro-max` and verify visually against a running dev server.
Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **5.1** Cover starting, watching and reading with failing specs — tests: the Playwright cases
      for AC-1 (the control on the six speech-carrying types and on nothing else, **present on a
      recording longer than 60 minutes too**, whose refusal AC-6 owns), AC-2 (**the row shows
      waiting or running within 2 seconds of the press, with no reload**), AC-3 (the row reaches its
      final state with no action by the owner, and a reload mid-run still shows it in flight), AC-4
      (the fixture's words appear under its file and survive a reload and a fresh sign-in), AC-8,
      AC-13 (no language control anywhere) and AC-16 (a transcript carrying markup renders as literal
      text); the **`route.int-spec.ts`** cases for the polled proxy (AC-15, S-2): no session → `401`
      with `fetch` never called, a caller-supplied `Authorization` never reaching upstream, and only
      allow-listed headers passing either way; plus the Vitest cases for the row's state machine.
      Red before 5.2 starts.
- [ ] **5.2** Put a Transcribe control on speech-carrying rows — present on the six audio and video
      types, absent on every other accepted type, and unable to start a second run for a file whose
      run is already waiting or running. Starting and retrying are a Server Action or a `POST`, never
      a `GET` Route Handler: the session cookie is `sameSite: 'lax'`, which sends it on a cross-site
      top-level `GET` navigation and withholds it from a cross-site `POST` (S-7). The client-side
      constants — the poll interval and the state names — live in
      `apps/web/src/lib/transcription-limits.ts`, hand-duplicated and JSDoc-marked per the convention
      `lib/file-limits.ts` sets, and the request shapes in `apps/web/src/lib/transcription-api.ts`.
- [ ] **5.3** Show the run's state on the row — waiting, running, done, and failed with the reason
      the API stored, and nothing at all on a file that has never been transcribed (AC-1, AC-8).
- [ ] **5.4** Reach the final state without the owner acting — the row arrives at done or failed
      within 5 seconds of the run being recorded as finished, with no reload, refresh or navigation,
      and a page reloaded mid-run shows the run still in flight. The transport is D-6's: the Client
      Component polls every `TRANSCRIPTION_POLL_INTERVAL_MS` = `2_000` while any row on the page is
      `QUEUED` or `RUNNING` and stops as soon as none is, against the **meeting-scoped** state route
      through a new same-origin proxy Route Handler at
      `apps/web/src/app/api/meetings/[meetingId]/transcriptions/route.ts` — the fourth of them, and
      it follows the three that exist exactly: `getSession()` first, `new Response(null, { status:
401 })` before any upstream call, ids `encodeURIComponent`-escaped, and only
      `lib/api-proxy.ts`'s allow-listed headers in either direction (S-2, AC-15). When a file turns
      `SUCCEEDED` the client fetches that one file's text once; text never travels in the polled
      payload.
- [ ] **5.5** Show the finished text and offer Retry — the transcript renders under its file as
      literal text, never as markup (AC-16), and a failed run offers a Retry that starts a fresh run
      through the same `POST`-or-Server-Action path 5.2 fixes, never a `GET` (S-7).
- [ ] **5.6** Update the meeting-files module doc — `docs/modules/module-web-meeting-files.md` for
      the transcription surface it gained, and the `apps/web/HISTORY.md` entry.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; an owner presses Transcribe
on a fixture recording, the row shows waiting or running within 2 seconds, and without touching the
page again the row reaches done and the text appears under the file; a transcript containing
`<script>` is visible as text; the polled handler answers `401` with no upstream call when there is
no session.

## Phase 6. Copy, download and the profile section

**Goal**: the transcript can be taken out of the page, and the profile states what will run.
**Touches**: web
**Covers**: AC-5, AC-11, AC-15, AC-16
**Decisions**: D-3, D-6
**Threats**: S-6
**Verified by**: `apps/web/CLAUDE.md`, Testing — "Three tiers, test-first and outside in", unit and
integration on Vitest + RTL "written first, in the inner loop". This phase adds the **fifth**
same-origin proxy Route Handler, and that tier is fixed by the same doc: "Route Handlers and Server
Actions called directly" as `*.int-spec.ts`, which "is the tier that pins the security-critical
seams the browser can't see into — the proxy's request/response header allow-list, the bearer token
attached server-side while the caller's own `Authorization` is dropped, the pre-upstream `401`".
Playwright covers the download and the profile section, in
`apps/web/e2e/meeting-transcription.spec.ts` and `apps/web/e2e/profile.spec.ts`. After building the
UI, review it with `web-design-guidelines` then `ui-ux-pro-max` and verify visually against a running
dev server. Suites: `npm run test:web`, `npm run test:e2e:web`.
**Tasks**:

- [ ] **6.1** Cover copy, download and the profile section with specs — tests: the integration cases
      for the new proxy route's header allow-list — including that **`x-content-type-options` is
      forwarded** (AC-16, S-6) — its server-side bearer token and its pre-upstream `401` (AC-15), and
      the Playwright cases for AC-5 (copy puts the text on the clipboard, the download's contents
      equal the text shown), AC-16 (a transcript containing `<script>alert(1)</script>` downloads
      with `nosniff`, `text/plain` and `attachment` intact at the browser) and AC-11. Red before 6.2
      starts.
- [ ] **6.2** Copy the transcript in one action — one control puts the whole text on the clipboard
      and tells the owner it did (AC-5).
- [ ] **6.3** Download the transcript through a same-origin proxy — the fifth Route Handler, not the
      fourth: D-6 puts the run-state poller in phase 5, so three exist before this feature and four
      before this task. It forwards through `lib/api-proxy.ts`'s allow-lists with the token attached
      server-side, refusing with `401` before any upstream call when there is no session — and
      `x-content-type-options` joins `FORWARDED_RESPONSE_HEADERS` in
      `apps/web/src/lib/api-proxy.ts:17-24`, which today drops the `nosniff` 3.4 sets and would let a
      transcript be sniffed into markup on this app's own origin (S-6, AC-16).
- [ ] **6.4** Render the Transcription section on `/profile` — engine, model, effort level and
      language mode as the API answers them (3.5), with the statement that the audio does not leave
      the server, server-rendered in the first response and carrying no editable field, no selector
      and no API-key input (AC-11).
- [ ] **6.5** Update the profile and meeting-files module docs — `module-web-profile.md` and
      `module-web-meeting-files.md`, the Status lines in `apps/web/CLAUDE.md`, and the
      `apps/web/HISTORY.md` entry closing the feature's web side.

**Done when**: `npm run test:web` and `npm run test:e2e:web` are green; a finished transcript copies
and downloads with contents identical to what the page shows, the download carrying `text/plain`,
`nosniff` and `attachment` all the way to the browser; `/profile` states the engine, model, effort
and language mode with nothing to fill in.

## Checks

- **Numbers** — 60 minutes agrees in AC-6, `MAX_AUDIO_DURATION_MS` (`3_600_000`) and
  `AUDIO_DURATION_LIMIT_MESSAGE`; 20 / 60 s in AC-17, the throttler config
  (`DEFAULT_THROTTLE_LIMIT = 20`, `DEFAULT_THROTTLE_TTL_MS = 60_000`) and the start route's absence
  of an override; 240 / 60 s on the read routes matches `files.controller.ts:196`; 5 s in AC-3
  against a 2 000 ms poll; 10 waiting runs in `MAX_WAITING_RUNS_PER_ACCOUNT` and now in AC-20.
  **T-2**: AC-2's 2 s against `DURATION_PROBE_TIMEOUT_MS` = `10_000` on the synchronous start path.
- **Mechanism against promise** — `verbose_json` carries both `text` and `language`, which is what
  AC-4 and AC-13 need in one call; `onDelete: Cascade` is what lets the existing purge close AC-10;
  one row per file is what makes AC-9's replace-on-success a single update. Consistent, with one
  recorded risk carried rather than ruled: `tiny` may not carry AC-4 or AC-13, settled by phase 1's
  measured run against a one-env-var fallback to `base` (research §8) — now written into phase 1's
  **Done when** rather than left in a risk list.
- **Control against scenario** — **T-3**: D-7's fail-closed duration probe refuses a recording whose
  length cannot be read, an outcome no criterion carried. **T-4**: S-5's waiting-run ceiling refuses
  the 11th start where the PRD's In scope said "the rest waiting". Everything else consistent: every
  refusal the controls add (409, 415, 422, 429) now has a criterion, and ownership resolves before
  type and duration so no refusal leaks another owner's file.
- **Missing work** — the migration (1.3), the four env vars and the compose service (1.5), the
  weights, the offline profile and the hardening (1.6), the three transitively-resolved package
  declarations and `music-metadata` (2.4), `FilesModule`'s new exports (1.4) and the proxy allow-list
  change (6.3) all carry a task. Five test obligations carried no task and now do: AC-19's crafted
  recording and AC-12's recorder (1.1), AC-18's two-account case and S-10's three scheduler cases
  (2.1), AC-14's download 404 (3.1), AC-15's polled-proxy `route.int-spec.ts` and AC-2's 2-second
  observation (5.1), AC-16 through the proxy (6.1). No new building task was needed, so no phase
  moved off the five-task ceiling.
- **Stale citations** — three found, none carried into this file: S-5's `**Decisions**` still reads
  `D-5`, superseded by D-11 in round 2; research §7 still lists the scheduler under `(D-5)`; and
  research §7 still says `files.module.ts` gains "`exports: [FilesService]` and nothing else", which
  D-9's own **Chosen** corrected to `[FilesService, MeetingOwnerGuard]` after S-1. Task 1.4 here
  carries the corrected export list. No task cites a dropped task; every `AC-<n>` is cited by at
  least one phase.
- **Order** — the API goes green (1–3) before the web touches it (5–6), with the parity
  decomposition (4) in between as the project's 200-line rule requires; 6.3's proxy follows 5.4's;
  2.4's `content-disposition` declaration lands a phase before 3.4's header needs it. One
  within-phase ordering constraint is stated rather than implied by the numbering: **1.6 has to run
  before 1.2 can go green**, because the engine has to exist before the boundary that calls it.
- **Phase integrity** — five building tasks in phases 1, 2, 3 and 5, four in 4 and 6; `tests:` tasks
  (1.1, 2.1, 3.1, 5.1, 6.1) are exempt. Each phase is one layer (`api` · `web`) except phase 1, whose
  `infrastructure` half is the engine the same phase's code calls. **T-1** ruled the cut stands.
- **Unproven control** — every finding now has a test in a named task: S-1 (1.1's 404 cases and the
  owner-filtered list), S-2 (5.1's `route.int-spec.ts`), S-3 (1.1's stubbed over-size bodies), S-4
  and S-10 (2.1's two-account and three failure cases), S-5 (2.1's AC-20 case), S-6 (3.1 and 6.1),
  S-7 (5.1's no-`GET` assertion), S-8 (1.1's crafted recording plus `docker inspect`). S-9 is
  accepted and by definition proven by nothing.
- **Silence** — no decision is left open in a task: the engine's transport, flags, container
  configuration, both response ceilings, the claim mechanism and the probe's failure mode are all
  stated with their values here. What stays explicitly unverified is named in Residual risk with the
  observation that settles it and the fallback if it does not.
- **Workflow** — every phase carries **Verified by**, and every phase with implementation opens with
  its `tests:` task, as the root `CLAUDE.md` requires. Two citation corrections: phases 5 and 6
  quoted `apps/web/CLAUDE.md` as "Tests come before the code, at every tier that applies — not e2e
  alone", a sentence that is not in that file; they now quote its actual Testing wording. Phase 6's
  "fifth Route Handler" agrees with task 6.3. Each phase now names the suite command **and** the spec
  file its cases go in.

## Rulings

| Id  | Conflict                                                                                                    | Sides                                | Ruling                                                | Costs                                                                                                              | Recorded in                        |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| T-1 | Phase 1 is at the five-task ceiling with S-1, S-3 and S-8 folded into tasks that build much else besides    | the phase cut vs. review grain       | keep the cut as planned                               | three high-severity controls are reviewed inside large diffs instead of getting an issue and a review of their own | this file; THREATS §5 named it     |
| T-2 | AC-2 promises the row moves within 2 s; the start path runs a probe bounded at 10 s (D-7)                   | AC-2 vs. `DURATION_PROBE_TIMEOUT_MS` | lower the probe's timeout to `1_500` ms               | a recording whose length needs more than 1.5 s of scanning is refused where 10 s would have accepted it            | task 2.4; research §5 is overruled |
| T-3 | D-7 fails closed on an unreadable length; no criterion carried that refusal                                 | the promise vs. the control          | keep the control, amend AC-6 to carry the refusal too | the PRD now states that some accepted recordings can never be transcribed                                          | PRD AC-6 (amended, number kept)    |
| T-4 | `MAX_WAITING_RUNS_PER_ACCOUNT` = 10 refuses the 11th start; In scope said "the rest waiting", no AC held it | the promise vs. the control          | keep the control, raise it into **AC-20**             | one more criterion to prove at close-out, and the In scope line now states the cap                                 | PRD AC-20 (new) and In scope       |

## Deltas from the plan

- `DURATION_PROBE_TIMEOUT_MS` is `1_500`, not research §5's `10_000` (2.4) — T-2.
- 2.4 carries both refusals and both messages, and AC-6 in the PRD now names the second — T-3.
- 2.3 carries `MAX_WAITING_RUNS_PER_ACCOUNT` = `10` and `WAITING_RUN_CAP_MESSAGE` as **AC-20**'s
  work, and phase 2's **Covers** gains AC-20 — T-4.
- 1.1 gains AC-19's crafted-container-reference case, which only S-8's **Proven by** carried, and
  phase 1's **Done when** names it — S-8.
- 2.1 gains AC-18's two-account case and S-10's three scheduler cases, which lived only in phase 2's
  **Done when** and inside building task 2.6 — S-4, S-10.
- Phase 3's **Covers** gains AC-14 and 3.1 gains its download-404 case: AC-14 names downloading, and
  the download route only arrives in 3.4 — S-1.
- Phase 5's **Covers** gains AC-15 and 5.1 gains the polled proxy's `route.int-spec.ts`, the tier
  `apps/web/CLAUDE.md` fixes for exactly that seam — S-2.
- Phase 6's **Covers** gains AC-16: 6.3 carries the half without which the downloaded `.txt` reaches
  the browser sniffable — S-6.
- 5.1 gains AC-2's 2-second observation and AC-1's ">60-minute file still carries the control"
  clause; neither number nor clause was in any task or **Done when** before.
- 1.4 and 2.3 state that the start route carries **no** `@Throttle` override, so a later phase adding
  one cannot break AC-17 without contradicting a task.
- 1.4 exports `[FilesService, MeetingOwnerGuard]`, not research §7's `[FilesService]` alone — D-9's
  corrected **Chosen**, S-1.
- 5.5 carries S-7's never-a-`GET` rule with 5.2, since Retry is state-changing too — S-7's own
  **Plan tasks** names 5.2 and 5.5.
- Every task now carries its parameter values verbatim (the compose service's whole configuration,
  both response ceilings, the six `SPEECH_MIME_TYPES`, the refusal statuses and messages), and every
  **Done when** names the command, route or status with the result it must give.
- Phases 5 and 6 quote `apps/web/CLAUDE.md`'s Testing section as it is actually written.

## Residual risk

- **S-9 accepted** (2026-08-26): the engine's port answers any local process without authentication,
  including its `/load` model swap. Loopback publishing is the containment, the same level Postgres
  and Redis sit at in this compose file. To be revisited if this ever runs anywhere but one machine.
- **T-1's cost**: S-1, S-3 and S-8 ride inside tasks 1.4, 1.2 and 1.6. Each is named in its task text
  and on the phase's **Threats** line, so `build-phase` reads it — but the reviewer sees it inside a
  large diff.
- **T-2/T-3's cost**: a recording whose length cannot be read inside 1.5 s is refused and can never
  be transcribed. AC-6 now says so.
- **AC-12 half A is not a Jest suite** — it is a scripted compose check in phase 1's **Done when**,
  so it will not run on `pre-push` or in CI when CI exists (moby#36174 makes any other topology
  impossible). Confirmed with the user at `research`.
- **Single instance is assumed throughout.** AC-18 is held by a boolean in one process; a second
  instance voids it outright rather than degrading it, and S-10's wedge becomes per-instance. The
  replacement is a partial unique index plus a worker identity and a lease.
- **Three figures are computed or estimated, not measured**, all settled by task 1.6's first
  `docker compose up` and phase 1's timed run: the memory peak behind `mem_limit: 2560m`, the
  throughput behind `WHISPER_TIMEOUT_MS`, and whether uid 1000 can execute the stock image at all. If
  the last is wrong, `user: "1000:1000"` fails outright and AC-19 needs a locally-built image with a
  `USER` line — a stop-and-raise, not a silent drop of the hardening.
- **`tiny` may not carry AC-4 or AC-13.** The fallback is `WHISPER_MODEL=base` and a re-pull — one
  env var, no code, no migration, and AC-11 keeps telling the truth either way.
- **Handed to `/bldprj:refactor-prd`**: `api-proxy.ts`'s response allow-list strips `nosniff` from
  the **existing** file download too. Task 6.3's one-line fix closes both, but the pre-existing
  instance sits behind the PRD's scope fence, so it is recorded rather than claimed here.
- **Deferred capabilities** stay where the PRD put them: a remote Whisper-compatible API with its key
  and selectors, timestamps and subtitles, diarisation, summaries, search, editing, cancelling and
  multi-machine scaling are all out of this iteration and belong to a future `/bldprj:prd`.

## Asked & assumed

- **Asked** — Phase 1 stands at the five-task ceiling with three high-severity controls folded into
  tasks that build much else; split it so each control gets its own issue and review? → **Keep the
  cut as planned** (T-1). Splitting would renumber every phase and task after the first, which the
  pipeline's identity rule forbids.
- **Asked** — AC-2 promises the row moves within 2 seconds, while the start route synchronously runs
  a duration probe bounded at 10 seconds. → **Lower `DURATION_PROBE_TIMEOUT_MS` to `1_500` ms**
  (T-2), so the promise stays keepable; research §5's value is overruled here.
- **Asked** — D-7 refuses a recording whose length cannot be read, an outcome no criterion carried.
  → **Amend AC-6** to name that refusal alongside the 60-minute one (T-3), keeping its number and its
  open box.
- **Asked** — `MAX_WAITING_RUNS_PER_ACCOUNT` = 10 refuses the 11th start where the PRD promised "the
  rest waiting". → **Raise it into AC-20** (T-4), the same move S-4 and S-8 got at
  `security-analyse`.
- **Assumed** — the documentation tasks (1.5, 3.6, 4.4, 5.6, 6.5) and phase 4's refactor tasks serve
  no `AC-<n>` and stay anyway · they are mandated by the root `CLAUDE.md`'s Module documentation and
  Refactoring rules and by the PRD's own Technical constraints, not by a criterion; if a phase is
  ever cut for time, these are the tasks nothing in the AC list would catch.
- **Assumed** — declaring `file-type@21.3.4` in 2.4 rides along with `load-esm` and
  `content-disposition` · it serves no criterion of this feature, but it is the same file's other
  undeclared import, and leaving it would keep a build that breaks silently on a Nest bump.
- **Assumed** — every number in this file comes from the PRD or research §5 verbatim, except
  `DURATION_PROBE_TIMEOUT_MS`, which is T-2's · if research is re-run, that value is the one it must
  not silently restore.
