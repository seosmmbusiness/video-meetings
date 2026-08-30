# Research: Meeting transcription

**Key**: MT
**PRD**: [meeting-transcription-PRD.md](./meeting-transcription-PRD.md)
**Plan**: [meeting-transcription-PLAN.md](./meeting-transcription-PLAN.md)
**Date**: 2026-08-26

## 1. TL;DR

Whisper runs as a fourth `docker-compose.yml` service — `ghcr.io/ggml-org/whisper.cpp:main`, which
carries `whisper-server` and `ffmpeg` — published on `127.0.0.1` only, with `ggml-tiny.bin` mounted
read-only from a gitignored `.data/whisper-models/`. `apps/api` reaches it over plain HTTP at
`POST /inference` with `response_format=verbose_json` and `language=auto`, which answers the text and
the detected language in one call. The GPU is not usable: Docker Desktop is the only Docker on this
machine and its GPU passthrough exists on Windows/WSL2 only, so inference is CPU-bound.

The request is sent with **`node:http`, not `fetch`** — measured on this machine, `fetch` retains the
whole request body (1 GiB file → 1024 MB of `arrayBuffers` still live after two forced GCs), while
`http.request()` + `pipe()` peaks at 105 MB for the same file. Nothing about the transport is
in-process inference, so the API keeps its event loop.

Run state and transcript live in one new `FileTranscription` row per file, `onDelete: Cascade` from
`MeetingFile` — which is what lets `FilesPurgeService`'s existing `meetingFile.delete()` keep working,
where the schema's only precedent (`onDelete: Restrict`) would have blocked it. That row is also the
queue: an in-process `@Interval` scheduler claims one `QUEUED` run per account with a conditional
`updateMany`, and boot-time recovery fails any row left `RUNNING`. No Redis, no job library.

`apps/web` polls a meeting-scoped state route every 2 s through a new same-origin Route Handler,
behind the same `@Throttle({ limit: 240 })` override the download route already carries.

**One new dependency**: `music-metadata` 11.15.0, for the 60-minute duration check — reached through
`load-esm` exactly as `file-type` already is.

## 2. Decision map

| Phase | Tasks                        | Decisions                               |
| ----- | ---------------------------- | --------------------------------------- |
| 1     | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | D-1, D-2, D-3, D-4, D-6, D-8, D-9, D-10 |
| 2     | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | D-7, D-11                               |
| 3     | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 | D-3, D-4                                |
| 4     | 4.1, 4.2, 4.3, 4.4           | —                                       |
| 5     | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 | D-6                                     |
| 6     | 6.1, 6.2, 6.3, 6.4, 6.5      | D-3, D-6                                |

Phase 4 is a parity refactor and carries no decision: nothing it moves has a mechanism to choose.

**D-5 is superseded by D-11** (round 2) and is off the map: its block stays for the citations that
point at it, and phase 2 reads D-11 instead. Everything else on this map is unchanged.

## 3. Stack as found

Everything below was read out of the repository or the machine on 2026-08-26, not recalled.

| Fact       | Value                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Runtime    | `.nvmrc` = `24`; installed `v24.16.0`, npm `11.13.0`                                                              |
| `apps/api` | NestJS 11.2.1, `@nestjs/schedule` 6.1.3 (exports `Cron`, `Interval`, `Timeout`), `@nestjs/throttler` 6.5.0        |
| Prisma     | `prisma`/`@prisma/client` 7.9.1, `@prisma/adapter-pg`; four migrations; **no enum anywhere in the schema yet**    |
| TypeScript | `module: nodenext`, `target: ES2023` — an ESM-only package needs a dynamic import, which is why `load-esm` exists |
| Docker     | `docker-ce-cli` 29.4.1 + **`docker-desktop` 4.81.0**; no `docker-ce` engine package, no host `dockerd`            |
| GPU        | RTX 2060, 6144 MiB, driver 595.84 — **unreachable from a container**, see D-1                                     |
| Machine    | 12 CPU cores, 14 GB RAM (~9 GB free), 192 GB free on the repo's volume, Ubuntu 26.04                              |
| Absent     | `ffmpeg`, `ffprobe`, `whisper`, `nvidia-container-toolkit`/`nvidia-ctk`, `podman`; Docker daemon not running      |

Modules this feature extends, and what they already cover without new code:

- **`src/storage`** — `FileStorage` is already the byte boundary, with `localPathFor(key)` returning a
  real path for the local backend and `null` for a future remote one. D-2 and D-7 both read bytes
  through it and never touch a path directly. `StorageModule` exports `FileStorage` and
  `FileTypeService`, so the transcription module imports it the way `profile` does.
- **`src/files`** — `FilesService.findFileForOwner(fileId, meetingId, ownerId)` is already the exact
  compound owner-scoped lookup AC-14 needs, and already 404s. `FilesModule` **exports nothing** today
  (D-9). `FilesPurgeService.purgeExpired()` is a plain public method a spec can call after backdating
  `deletedAt`, which is how AC-10 gets proven.
- **`src/profile`** — `ProfileResponseDto` is built field by field, never spread from the Prisma row.
  Task 3.5's "explicit key set rather than spread into it" is already the file's own rule.
- **Throttling** — `config/throttler.config.ts` keys buckets on a hash of the bearer token; per-route
  overrides live in code, and `files.controller.ts:196` already carries
  `@Throttle({ default: { limit: 240, ttl: 60_000 } })` on the byte-serving route. D-6 reuses that
  number rather than inventing one.
- **`apps/web`** — `lib/api-proxy.ts` forwards to `apps/api` behind request/response header
  allow-lists with the bearer token attached server-side; three Route Handlers use it. `lib/file-limits.ts`
  is the worked example of the hand-duplication convention D-6's client constants follow.

**Phantom dependency, pre-existing.** `apps/api/src/storage/file-type.service.ts` imports `file-type`
and `load-esm`, and **neither is declared in any `package.json`** — `npm ls` resolves both only as
transitive dependencies of `@nestjs/common@11.2.1` (`file-type@21.3.4`, `load-esm@1.0.3`). This
feature reaches `load-esm` too (D-7), so declaring both is part of task 2.4 rather than a separate
cleanup. See section 8.

## 4. Decisions

### D-1. How does a Whisper engine run on this machine, and how does `apps/api` reach it?

- **Plan tasks**: 1.2, 1.5, 1.6
- **Options**:

  | Option                                                                      | Pros                                                                                                                                                     | Cons                                                                                                                                                                                                                                | Cost to adopt                     | Risk                                     |
  | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------- |
  | **Compose service, `ghcr.io/ggml-org/whisper.cpp:main`**                    | First-party image; ships `whisper-server` **and** `ffmpeg`; no model download at run time; zero npm dependencies; CPU burn isolated from the API process | CPU-only here; the media crosses a localhost HTTP hop                                                                                                                                                                               | one compose service + one env var | image tag drift                          |
  | `onerahmet/openai-whisper-asr-webservice`                                   | Popular, OpenAI-compatible surface, ffmpeg included                                                                                                      | Third-party maintainer; heavier Python image; **downloads model weights on first run**, which fights AC-12 unless the cache is pre-warmed                                                                                           | comparable                        | run-time download breaks the AC-12 proof |
  | Host-native `whisper.cpp` built with CUDA                                   | The only way to actually use the RTX 2060; several times faster                                                                                          | Needs a CUDA toolchain and a manual build outside Docker; no precedent in this repo; provisioning falls on a person instead of `db:up`                                                                                              | high, and not reproducible        | unbuildable on a fresh machine           |
  | In-process (`nodejs-whisper`, `smart-whisper`, `@huggingface/transformers`) | No extra service to run                                                                                                                                  | Inference inside the API process: model RAM and CPU on the event loop; `nodejs-whisper` compiles whisper.cpp at install; `onnxruntime-node` is 296 MB unpacked; makes "an absent engine degrades to a failed run" nearly unstatable | high                              | one bad run degrades every request       |

- **Chosen**: `ghcr.io/ggml-org/whisper.cpp:main` as a compose service running `whisper-server`,
  reached over HTTP at `POST /inference`.
- **Why**: The GPU is not on the table — `docker-ce-cli` is installed without a host engine and
  `docker-desktop` 4.81.0 is what provides the daemon, and Docker's own documentation states "GPU
  support in Docker Desktop is only available on Windows with the WSL2 backend"; there is also no
  `nvidia-container-toolkit` on the machine. With CPU inference fixed, the remaining question is where
  the burn lives, and a separate service is the only answer that keeps the API's event loop and lets
  an absent engine be a failed run rather than a failed startup. It also matches the project's own
  infrastructure convention exactly: Postgres and Redis are already compose services reached over a
  published port. Dependency budget: **unchanged** — `node:http` is a built-in.
- **Rejected**: the third-party webservice image, because its first-run model download is precisely
  what AC-12 forbids; the native CUDA build, because provisioning stops being reproducible; in-process
  inference, because it puts a 60-minute CPU job and a model's RAM inside the process that has to keep
  answering every other route.
- **Exposure**: the engine's `/inference` takes an uploaded file and, with `--convert`, shells out
  through `system("ffmpeg -i …")` (`examples/server/server.cpp:321`) — so untrusted media is parsed by
  ffmpeg, and whisper.cpp's own README warns: _"Do not run the server example with administrative
  privileges and ensure it's operated in a sandbox environment, especially since it involves risky
  operations like accepting user file uploads and using ffmpeg for format conversions."_ The `/load`
  endpoint additionally lets any caller swap the model by path. Controls — and this pass stated the
  first of them in a way that would have broken the service: loopback containment is the **host-side
  publish**, `127.0.0.1:${WHISPER_PORT}:8080`, while the process _inside_ the container must bind
  `--host 0.0.0.0`. `server.cpp:59` defaults `hostname` to `127.0.0.1`, and a container bound to its
  own loopback is unreachable through any published port, so "never `0.0.0.0`" was true of the publish
  and false of the bind. Then: non-root with a read-only model mount, `mem_limit` and `memswap_limit`
  pinned to the same value, and a **compose network of its own** — the default network already holds
  `db` and `redis`, whose passwords fall back to `video_meetings` in this very file, so an engine left
  on it sits one ffmpeg bug away from both. The residual — that the port is reachable by any local
  process — goes to `security-analyse`.
- **Fits in at**: `apps/api/src/transcription/`, behind an abstract `TranscriptionEngine` bound as its
  own Nest injection token exactly as `FileStorage` is, with `WhisperCppEngine` the only implementation:

  ```ts
  export abstract class TranscriptionEngine {
    abstract transcribe(
      storageKey: string,
      signal: AbortSignal,
    ): Promise<TranscriptionResult>;
    abstract settings(): EngineSettings;
  }
  ```

  A unit spec overrides the token, so `pre-push` never needs the engine running; a future remote
  provider is a second implementation and nothing else moves.

- **Sources**: [Docker Desktop GPU support](https://docs.docker.com/desktop/features/gpu/) ·
  [ghcr.io/ggml-org/whisper.cpp package](https://github.com/ggml-org/whisper.cpp/pkgs/container/whisper.cpp)
  (tags `main`, `main-cuda`, `main-vulkan`, …; last published within a day of this pass) ·
  [whisper.cpp server README](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md) ·
  `examples/server/server.cpp` read at lines 285–337, 482–622, 831–880, 1017–1175.

### D-2. What carries a recording of up to 500 MB from `apps/api` to the engine?

- **Plan tasks**: 1.2
- **Options**:

  | Option                                        | Peak RSS, 1 GiB body | Notes                                                            |
  | --------------------------------------------- | -------------------- | ---------------------------------------------------------------- |
  | `fetch` + `FormData` + `fs.openAsBlob`        | **1173 MB**          | Shortest code; `openAsBlob` is also Stability 1 – Experimental   |
  | `fetch` + `ReadableStream` + `duplex: 'half'` | **1152 MB**          | The pattern `api-proxy.ts` uses; still retains the whole body    |
  | **`node:http` `request()` + `pipe()`**        | **105 MB**           | Hand-built multipart envelope, ~25 lines; classic Node streaming |

- **Chosen**: `node:http`'s `request()`, writing the multipart preamble, piping
  `FileStorage.createReadStream(key)` into the request, and ending it with the closing boundary.
- **Why**: measured on this machine, not assumed. Sending a 1 GiB body to a local HTTP server with a
  deliberately slow consumer, `fetch` peaked at `rss=1152 heapUsed=10 external=1043 arrayBuffers=1024`
  and **still reported `arrayBuffers=1024` after two forced `global.gc()` calls** — that is retained
  memory, not allocator lag. The same body through `http.request()` + `pipe()` peaked at
  `rss=105 heapUsed=7 external=8 arrayBuffers=4`, settling to `arrayBuffers=0`. With a 500 MB
  per-file ceiling already in force, `fetch` would add roughly the file's size to the API's live heap
  on every run; `node:http` adds a socket buffer. Both are built-ins, so the dependency budget is
  untouched either way — this is purely about which built-in.
- **Rejected**: `fetch`, on the measurement above, despite being the more modern surface and the one
  `api-proxy.ts` already uses for the (much smaller) proxy hops; `fs.openAsBlob`, which is _Added in
  v18.13.0_ and _Stability: 1 – Experimental_ and did not avoid the retention anyway.
- **Exposure**: a hand-built multipart envelope must never interpolate anything caller-controlled into
  a header — the boundary is generated with `randomUUID()`, the part's `filename` is a fixed literal
  (the engine only needs _a_ name), and the stored file name never travels. That also keeps the
  owner's file name off the engine entirely, which is what the PRD's "the file name … never leaves it"
  promises. `AbortSignal` bounds the request so a wedged engine cannot hold the account's single slot
  for ever.
- **Fits in at**: `apps/api/src/transcription/whisper-cpp.engine.ts`, the only place that knows the
  wire format. Swapping in `fetch` later, or a different engine protocol, is a change inside this one
  file.
- **Sources**: measured locally on `node v24.16.0` (three runs, reproduced with a slow consumer and
  `--expose-gc`) · [`fs.openAsBlob`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsopenasblobpath-options)

### D-3. Which model, and what do "effort `low`" and "language detected automatically" mean concretely?

- **Plan tasks**: 1.2, 1.5, 3.5, 6.4
- **Options**:

  | Model   | Disk    | Rough CPU throughput | 60 min of audio | AC-4 / AC-13 outlook                             |
  | ------- | ------- | -------------------- | --------------- | ------------------------------------------------ |
  | `tiny`  | 75 MiB  | ~10× realtime        | ~6 min          | Highest word-error rate; weakest non-English     |
  | `base`  | 142 MiB | ~7× realtime         | ~9 min          | The cheapest that reliably carries both criteria |
  | `small` | 466 MiB | ~2–3× realtime       | ~20–30 min      | Accurate, but too slow under one-run-per-account |

- **Chosen**: **`ggml-tiny.bin`** — the user's ruling, taking the PRD's "the cheapest model" literally.
  Effort `low` maps to greedy decoding: `-bo 1 -bs -1 -nf` (one candidate, no beam search, no
  temperature fallback). Language mode `auto` is `-l auto`, and `-nt` drops timestamps, which the PRD
  puts out of scope. Per-request, `apps/api` sends `response_format=verbose_json` and `language=auto`.
- **Why**: `verbose_json` is the only response format whose payload carries **both** the text and the
  detected language — `server.cpp:1070` emits `"language"` from `whisper_full_lang_id(ctx)` alongside
  `"text"` at 1072, where the default `json` format answers `{"text": …}` alone (1166). That is exactly
  what task 1.2's engine boundary is specified to return, in one call. whisper.cpp's models README
  states "Models are multilingual unless the model name includes `.en`", so the `.en` variants are
  excluded outright by AC-13. The throughput column is an estimate and is **not verified** — the Docker
  daemon was not running during this pass, so nothing was benchmarked; phase 1 measures it (see §8).
- **Rejected**: `base`, which was this pass's recommendation and is the cheapest model that comfortably
  carries AC-4 and AC-13 — overruled in favour of the PRD's literal wording; `small`, whose runtime
  contradicts "the cheapest model" outright; every `.en` variant, which cannot satisfy AC-13.
- **Exposure**: none of its own — the model is a local file, mounted read-only, and `whisper-server`
  opens no outbound socket. The exposure that does exist belongs to `/load` and to ffmpeg, and is
  D-1's.
- **Fits in at**: one env var, `WHISPER_MODEL`, read by **both** sides so they cannot drift — compose
  interpolates it into `-m /models/ggml-${WHISPER_MODEL}.bin`, and `apps/api` reports the same string
  through `TranscriptionEngine.settings()`. Every run stores the settings it actually used on its own
  row (D-4), which is what makes AC-11's "the same values a run records for itself" true rather than
  merely consistent. Raising the model to `base` later is one env var and a re-pull of the weights —
  no code, no migration.
- **Sources**: [whisper.cpp models README](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
  (sizes and SHA1s) · `examples/server/server.cpp:502–622, 1065–1080, 1166` · server README's option list.

### D-4. Where do the run and its transcript live, and how do they follow the file?

- **Plan tasks**: 1.3, 3.2, 3.3
- **Options**: columns added to `MeetingFile`; **one `FileTranscription` row per file**; separate
  `Transcript` and `TranscriptionRun` models.
- **Chosen**: a new `FileTranscription` model, one row per file (`fileId @unique`), related to
  `MeetingFile` with **`onDelete: Cascade`**, plus the schema's first enum:

  ```prisma
  enum TranscriptionState { QUEUED RUNNING SUCCEEDED FAILED }

  model FileTranscription {
    id               String             @id @default(uuid())
    fileId           String             @unique
    file             MeetingFile        @relation(fields: [fileId], references: [id], onDelete: Cascade)
    state            TranscriptionState
    text             String?
    failureReason    String?            @db.VarChar(200)
    engine           String             @db.VarChar(32)
    model            String             @db.VarChar(32)
    effort           String             @db.VarChar(16)
    languageMode     String             @db.VarChar(16)
    detectedLanguage String?            @db.VarChar(64)
    queuedAt         DateTime           @default(now())
    startedAt        DateTime?
    endedAt          DateTime?
    createdAt        DateTime           @default(now())
    updatedAt        DateTime           @updatedAt

    @@index([state, queuedAt])
    @@map("file_transcriptions")
  }
  ```

- **Why**: `Cascade` is the whole point of the task-1.3 warning. `FilesPurgeService.purgeExpired()`
  calls `prisma.meetingFile.delete({ where: { id } })` per expired file; the schema's only existing
  relation precedent is `MeetingFile.meeting … onDelete: Restrict`, and copying it would make that
  delete throw and break the purge that AC-10 depends on. `Cascade` makes AC-10's "the transcript no
  longer exists in storage" a property of the delete the purge already does, with no new purge code at
  all. One row rather than two matches the PRD's Out of scope — "Keeping earlier transcripts of the
  same file … no history and no undo" — and makes AC-9 a single update: a re-run resets `state`,
  `queuedAt`, `startedAt`, `endedAt` and `failureReason` while **leaving `text` untouched**, and only a
  success overwrites `text`. A failed re-run therefore shows a failed row with the previous text still
  under it, which is exactly what AC-9 and the PRD's scenario ask for. Separate models were rejected as
  schema for a history nobody is allowed to keep; columns on `MeetingFile` were rejected because eleven
  of them would ride along on every file list query.
- **Rejected**: columns on `MeetingFile` (bloats the hot list query, and mixes two lifecycles in one
  row); two models (`Transcript` + `TranscriptionRun`) — correct if history were kept, but it is
  explicitly out of scope, and the second table would need its own cascade and its own cleanup.
- **Exposure**: the transcript is the most sensitive text this product holds — it is the meeting.
  `text` is never in a list response (D-6), never logged, and reachable only through
  `FilesService.findFileForOwner` (D-9). `failureReason` is capped at 200 characters and stores a
  message from a fixed set, never the engine's raw output, so an engine error string cannot smuggle a
  path or a stack trace to the owner's screen. `detectedLanguage` is stored because AC-13 is about it;
  no other engine output is kept.
- **Fits in at**: one migration in phase 1, carrying the enum and the whole column set at once, so
  phases 2 and 3 add behaviour and not schema. Soft delete needs no column of its own: every read path
  goes through `findFileForOwner`, which already filters `deletedAt: null`, so a soft-deleted file's
  transcript stops being reachable and comes back on restore without either being written anywhere.
- **Sources**: `apps/api/prisma/schema.prisma` · `apps/api/src/files/files-purge.service.ts:44–56` ·
  `apps/api/src/files/files.service.ts:213–229`

### D-5. What keeps one account's runs from overlapping, and what happens to a run a restart interrupted?

- **Superseded by**: D-11 — the conditional `updateMany` is atomic for one _row_ and cannot carry a
  machine-wide invariant. Re-checking it against S-4 showed it never carried the per-account one
  either, so AC-7 was resting on it too. What survives — the row as the queue, an in-process
  scheduler, no Redis and no job library — D-11 carries forward unchanged. Round 2.
- **Plan tasks**: 2.2, 2.5
- **Options**: an in-process promise chain like `QuotaReservationService`; **the database row as the
  queue, drained by an in-process scheduler**; a Redis-backed durable queue (BullMQ or similar).
- **Chosen**: the `FileTranscription` row _is_ the queue. A `@Interval(1_000)` scheduler
  (`@nestjs/schedule` 6.1.3, already installed) looks for accounts with no `RUNNING` row and claims
  that account's oldest `QUEUED` row atomically:

  ```ts
  const claimed = await this.prisma.fileTranscription.updateMany({
    where: { id: candidate.id, state: 'QUEUED' },
    data: { state: 'RUNNING', startedAt: new Date() },
  });
  if (claimed.count !== 1) return; // someone else took it
  ```

  On `onApplicationBootstrap`, every row still `RUNNING` is swept to `FAILED` with a readable reason —
  no worker can own it, because the process that did is gone.

- **Why**: a durable Redis queue is ruled out by a standing project rule, not by taste — the root
  `CLAUDE.md` says nothing may hard-depend on Redis and that code written against it must "fall back to
  the direct, uncached path … never fail the request", which a queue holding the only record of pending
  work cannot honour. A pure in-process chain (the `QuotaReservationService` shape) is ruled out by
  AC-7 and task 2.5 together: the queue has to survive the request that filled it _and_ a restart, and
  an in-memory `Map` survives neither. The database already survives both, already has the row, and
  already records `startedAt`/`endedAt` — which is literally how AC-7 says it wants to be proven
  ("provable from the recorded start and end times of the two runs"). The conditional `updateMany`
  makes the claim atomic without a transaction, so two overlapping ticks cannot both win. Dependency
  budget: **unchanged**.
- **Rejected**: BullMQ/`bull`/`agenda` — a new dependency plus a hard Redis dependency, against an
  explicit rule; an in-process chain — cannot satisfy AC-7 across a restart, and loses the account's
  slot exactly as task 2.5 warns; a `SELECT … FOR UPDATE SKIP LOCKED` claim — correct, and the right
  answer the day this runs on more than one instance, but heavier than a conditional update while the
  PRD keeps "one machine, one run at a time" out of scope.
- **Exposure**: the queue is a resource an owner can fill — 20 files per meeting, unbounded meetings.
  With one run per account and a 60-minute ceiling per file, a single account can occupy its own slot
  indefinitely, which is by design, but it also pins one engine process for the whole machine, since
  the engine is single and shared. The bound that exists is AC-17's throttle on _starting_ a run;
  whether a per-account queue-depth cap is also wanted is `security-analyse`'s to raise. Recovery must
  fail closed: a swept row must never come back as `SUCCEEDED` with a half-written `text`, so `text` is
  written once, at the end, in the same update that sets `SUCCEEDED`.
- **Fits in at**: `apps/api/src/transcription/transcription-scheduler.service.ts`, beside
  `FilesPurgeService` as the second `@nestjs/schedule` consumer and driven directly by an
  `*.int-spec.ts` the way `purgeExpired()` already is. Single-instance is an assumption it shares with
  `QuotaReservationService`, and it is recorded in §"Asked & assumed".
- **Sources**: root `CLAUDE.md`, Conventions (Redis rule) · `apps/api/src/files/quota-reservation.service.ts` ·
  `node_modules/@nestjs/schedule/dist/decorators/` (6.1.3: `Cron`, `Interval`, `Timeout`)

### D-6. How does the owner's page reach its final state within 5 seconds without a reload?

- **Plan tasks**: 1.4, 5.4, 6.3
- **Options**: **polling a state route**; Server-Sent Events from `apps/api` through the proxy;
  WebSocket; `router.refresh()` on a timer.
- **Chosen**: the Client Component polls every **2 000 ms** while any row on the page is `QUEUED` or
  `RUNNING`, and stops as soon as none is. It polls **one meeting-scoped route**, which answers compact
  state for every file and **no transcript text**; when a file turns `SUCCEEDED`, the client fetches
  that one file's text once. Both routes carry `@Throttle({ default: { limit: 240, ttl: 60_000 } })`.
- **Why**: the plan already ruled that the state route gets a looser limit than AC-17's baseline; what
  research adds is that it must be **meeting-scoped**, because a per-file route at 2 s across a full
  20-file meeting is 600 requests a minute, which overruns even the 240 override. One request per tick
  is 30/min, comfortably inside it. Text is kept out of the polled payload for the same reason — twenty
  transcripts of an hour each is roughly a megabyte per tick. SSE is the tempting alternative and was
  rejected on this repo's terms rather than on merit: it has no precedent here, it needs a long-lived
  stream through `api-proxy.ts`'s `fetch` hop, it interacts badly with the 30-minute `requestTimeout`
  in `main.ts`, and `apps/web/CLAUDE.md` fixes the integration tier as "Route Handlers … called
  directly", which a streaming handler makes materially harder to assert on. Polling is ~30 lines and
  provably meets a 5-second ceiling. `router.refresh()` on a timer was rejected outright: it re-runs
  the page's three server fetches per tick, roughly 90 requests a minute.
- **Rejected**: SSE (no precedent, hard to prove at the tier this project fixes for it, and a
  long-lived connection per open page); WebSocket (a whole transport for one integer); `router.refresh()`
  (three upstream calls per tick).
- **Exposure**: a polled route is a repeated authorization decision, so it must resolve ownership on
  **every** call through `findFileForOwner` rather than trusting anything the client sends back, and it
  must answer the same 404 for another owner's meeting as for one that does not exist (AC-14). Because
  it is polled, it is also the cheapest oracle in the feature for probing which meeting ids exist — the
  compound owner-scoped lookup is what closes that, and the looser throttle is what makes the probe
  cheaper, which is a trade `security-analyse` should weigh explicitly.
- **Fits in at**: `apps/web/src/app/api/meetings/[meetingId]/transcriptions/route.ts` — a **fourth**
  same-origin Route Handler through `lib/api-proxy.ts`, added in phase 5, which makes phase 6's
  transcript download the fifth (see §9). The interval and the client-side state names live in
  `apps/web/src/lib/transcription-limits.ts`, hand-duplicated and JSDoc-marked per the convention
  `lib/file-limits.ts` sets.
- **Sources**: `apps/api/src/files/files.controller.ts:195–201` (the 240/60 s precedent) ·
  `apps/web/src/lib/api-proxy.ts` · `apps/web/CLAUDE.md`, Testing · `apps/api/src/main.ts:36`

### D-7. How is the 60-minute ceiling measured, before a run starts?

- **Plan tasks**: 2.4
- **Options**: **`music-metadata`**; `ffprobe` via `ffmpeg-static`/`ffprobe-static`; hand-rolled header
  parsing for the six container formats; asking the engine (there is no probe endpoint).
- **Chosen**: `music-metadata` **11.15.0**, reached through `load-esm` exactly as `file-type` already
  is, with `{ duration: true }`, bounded by a 10-second probe timeout and failing closed.
- **Why**: all six accepted speech-carrying types are covered, checked against the package's own loader
  declarations rather than its README table — the README lists "MPEG 4 — mp4, m4a, m4v" and no
  QuickTime row, but `lib/mp4/Mp4Loader.ts` declares
  `extensions: ['.mp4', '.m4a', …, '.mov', '.movie', '.qt']` and
  `mimeTypes: [… 'video/mp4', 'video/quicktime']`, so `.mov` is covered; `WaveLoader` declares
  `audio/wav`, `MpegLoader` `audio/mpeg`, `MatroskaLoader` `video/webm`. It is pure JavaScript with no
  native binary, MIT, 558 KB unpacked, and was last published 2026-08-18. Crucially it does not move
  untrusted-media parsing into a child process of the API host, which the `ffprobe` route would — and
  which is the exact thing whisper.cpp's README warns to keep sandboxed. `ffmpeg-static` is also
  GPL-3.0-or-later and ~80 MB. `{ duration: true }` is the accurate setting the PRD's assumption
  demands ("measured on the recording's audio duration, not on its byte size"); the documented cost is
  that "the parser will read the entire media file _if necessary_", which for a large VBR MP3 without a
  Xing header means a full scan — hence the timeout, and hence failing closed: **a recording whose
  duration cannot be read is refused, not run**.
- **Rejected**: `ffprobe` via `ffmpeg-static` (GPL-3.0-or-later, ~80 MB binary, and it relocates
  untrusted-media parsing from the sandboxed container into the API's own child process);
  `ffprobe-static` (351 MB unpacked, last published 2022); hand-rolled parsing of ISO-BMFF, QuickTime,
  MPEG frames, RIFF and EBML — that is re-writing `music-metadata`, and every parser bug becomes a hole
  in the AC-6 control.
- **Exposure**: this is a parser fed untrusted bytes, so it is an attack surface in its own right — a
  malformed container aimed at a decompression or allocation bug. Controls: it reads through
  `FileStorage`, never a caller-supplied path; the probe is bounded by a timeout so a pathological file
  cannot pin the request; failure is a refusal, so a file that defeats the parser never reaches the
  engine either. It runs **at transcribe time, not at upload time**, which keeps the PRD's fence intact
  — nothing about how files are uploaded changes.
- **Fits in at**: `apps/api/src/transcription/audio-duration.service.ts`, in the transcription module
  rather than in `storage`, because only this feature needs it. It answers duration in milliseconds or
  `null`; the route turns `null` into the same refusal an over-long file gets.
- **Sources**: `npm view music-metadata version time.modified license dist.unpackedSize` →
  `11.15.0`, `2026-08-18`, `MIT`, `558174` · `lib/mp4/Mp4Loader.ts`, `lib/wav/WaveLoader.ts`,
  `lib/mpeg/MpegLoader.ts`, `lib/matroska/MatroskaLoader.ts` in
  [borewit/music-metadata](https://github.com/borewit/music-metadata) · its README's `duration` option note

### D-8. What harness imposes AC-12's denial, and what proves nothing was attempted?

- **Plan tasks**: 1.1, 1.6
- **Options**: an `internal: true` compose network for the engine with its port published; a
  process-level recorder inside `apps/api` alone; **both, each proving the half it can**; a per-run
  `docker run --network none` container.
- **Chosen**: two halves.
  - **Half A — the engine, structurally.** A separate compose profile puts the whisper service on a
    network declared `internal: true` and drives it from a one-shot client container on that same
    network, which posts the fixture to `http://whisper:8080/inference` and must come back with text.
    Docker's own reference for `--internal` is the guarantee: _"Containers on an internal network may
    communicate between each other, but not with any other network, as no default route is configured
    and firewall rules are set up to drop all traffic to or from other networks."_
  - **Half B — `apps/api`, by instrumentation.** An `*.int-spec.ts` records `dns.lookup`,
    `dns.resolve*` and their `dns.promises` twins, `net.Socket.prototype.connect` and `tls.connect`
    for the whole of a real run, and asserts every destination recorded is loopback.
- **Why**: the obvious single-tier answer does not work, and this was checked rather than assumed —
  published ports do **not** work on an `internal` network (moby#36174, "--internal bridge networked
  containers cannot expose ports"; also #27441), so the topology that denies the engine egress is the
  same topology that makes it unreachable from the host. Since normal operation needs the published
  port, egress denial cannot be the production topology, and the proof has to be driven from _inside_
  the isolated network. Half B is what no compose profile can give: AC-12 asks that no lookup be
  _attempted_, and only instrumentation inside the process can witness an attempt that was going to be
  refused anyway. `net.Socket.prototype.connect` is the right seam because everything — `node:http`,
  `fetch`, `pg` — funnels through it, so the assertion cannot be bypassed by changing client library.
  A per-run `docker run --network none` container would make AC-12 trivially true and was seriously
  considered, but it requires handing the API process the Docker socket, which is root-equivalent on
  the host — a far worse exposure than the one it closes.
- **Rejected**: `internal: true` plus published ports (does not work — moby#36174); `apps/api`
  instrumentation alone (leaves the engine half unproven, which is the half the PRD's goal is actually
  about); the Docker-socket-per-run design (root-equivalent privilege for the API process).
- **Exposure**: half A is also the standing argument that the engine _needs_ no network — the weights
  are on disk before the run (D-10) and `whisper-server` opens no client socket. Half B's recorder must
  be installed and removed around the run so it cannot leak into other specs.
- **Fits in at**: half B beside the other transcription integration specs; half A as
  `docker-compose.offline.yml` plus a documented command, evidenced in phase 1's **Done when** rather
  than in a Jest suite — which is the one place this feature's proof leaves the three suites, and is
  called out as such in §9.
- **Sources**: [`docker network create --internal`](https://docs.docker.com/reference/cli/docker/network/create/) ·
  [moby#36174](https://github.com/moby/moby/issues/36174) · [moby#27441](https://github.com/moby/moby/issues/27441) ·
  [Compose `internal`](https://docs.docker.com/reference/compose-file/networks/)

### D-9. How does the transcription module reach an owner-scoped file without copying the `where` clause?

- **Plan tasks**: 1.4
- **Options**: `FilesModule` exports `FilesService`; a CQRS query class; the transcription module
  queries Prisma itself.
- **Chosen**: `FilesModule` gains `exports: [FilesService, MeetingOwnerGuard]` — it has no `exports`
  array at all today — and the transcription module imports `FilesModule`, applies the guard at the
  controller and calls `findFileForOwner(fileId, meetingId, ownerId)`.
- **Why**: the method already exists and is already the exact shape AC-14 needs — a single compound
  lookup on `{ id, meetingId, meeting: { ownerId }, deletedAt: null }` that throws `NotFoundException`,
  never `Forbidden`, so a response cannot distinguish "not yours" from "no such file". Nothing needs
  writing; only the module's public surface changes. CQRS was rejected on the app's own rule:
  `apps/api/CLAUDE.md` fixes CQRS as the identity domain's boundary and says "elsewhere, prefer plain
  constructor injection … unless there is a similar reason", and this is a plain read, not an
  independent domain. Querying Prisma directly is what the plan's own Asked & assumed forbids: "a
  copied ownership filter is exactly how AC-10 and AC-14 drift apart later".
- **Rejected**: a CQRS query (against the app's stated default); a local `where` clause (duplicates the
  ownership rule); exporting `PrismaService` for the purpose (same problem, one layer down).
- **Exposure**: exporting from `FilesModule` widens its surface, so the list stays as narrow as the
  routes actually require — `FilesService` **and `MeetingOwnerGuard`**, never `QuotaReservationService`
  and never `FilesPurgeService`. This pass had that list one name too short, which S-1 proved:
  `findFileForOwner` covers only a route carrying a `:fileId`, and D-6's meeting-scoped state list
  carries none, so without the guard the polled route has no ownership cover at all. Every
  transcription route resolves the file through it _before_ anything else, so type checks, duration
  checks and state reads all sit behind the ownership gate rather than beside it.
- **Fits in at**: `apps/api/src/files/files.module.ts`, one line; `TranscriptionModule` imports
  `FilesModule`, `StorageModule` and `AuthModule`, and nothing imports it back — no cycle.
- **Sources**: `apps/api/src/files/files.service.ts:198–212` · `apps/api/src/files/files.module.ts` ·
  `apps/api/CLAUDE.md`, Conventions

### D-10. How do the model weights get onto the machine without a download during a run?

- **Plan tasks**: 1.5, 1.6
- **Options**: **a provisioning step writing to a gitignored volume**; baking the weights into a
  locally-built image; letting the engine fetch on first use.
- **Chosen**: a documented setup step downloads `ggml-tiny.bin` once into `.data/whisper-models/`
  (gitignored, beside the existing `.data/uploads` default for `STORAGE_ROOT`), verified against the
  SHA1 whisper.cpp publishes, and mounted `:ro` into the container.
- **Why**: fetching on first use is what disqualified the alternative engine image in D-1 and would
  disqualify this one too — AC-12 forbids a lookup during a run, so the weights must already be there.
  A locally-built image that bakes them in also works but adds a Dockerfile and a build step to a repo
  that currently pulls every image; a read-only bind mount keeps the stock image and makes changing the
  model (D-3) a re-download rather than a rebuild. The SHA1 check matters because this is the one
  artifact the feature pulls from a general-purpose host: whisper.cpp publishes a SHA1 per model
  (`tiny` = `bd577a113a864445d4c299885e0cb97d4ba92b5f`), so a wrong or tampered file is caught at
  provisioning rather than becoming a silently worse transcript.
- **Rejected**: first-use download (breaks AC-12); a custom image (a Dockerfile and a build for what a
  mount does); committing the weights (75 MiB of binary in git).
- **Exposure**: the download is the feature's only external fetch, and it is a provisioning step, not a
  request path. Controls: pinned file name, published SHA1 verified before use, mount read-only so a
  compromised engine cannot rewrite its own model, and `.gitignore` so weights never enter the
  repository.
- **Fits in at**: a `scripts/` entry wired as an npm script beside `db:up`, `.gitignore`,
  `.env.example` and the README's setup section.
- **Sources**: [whisper.cpp models README](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
  (`download-ggml-model.sh`, the SHA1 table, and https://huggingface.co/ggerganov/whisper.cpp/tree/main)

### D-11. What makes "one transcription at a time on this machine" true, when scheduler ticks overlap?

- **Supersedes**: D-5, on trigger 1 — S-4 turned AC-18 into a machine-wide invariant, and the
  mechanism D-5 chose cannot express one.
- **Plan tasks**: 2.2, 2.5, 2.6
- **The race, concretely** — this is the whole decision, so it is written out rather than asserted.
  `@nestjs/schedule` 6.1.3 mounts `@Interval` as a bare `setInterval(options.target, options.timeout)`
  (`node_modules/@nestjs/schedule/dist/scheduler.orchestrator.js:38`): the callback is never awaited
  and there is no re-entrancy guard, so a tick slower than its period re-enters. D-5's claim is then a
  read (`is anything RUNNING?`) followed by a separate write (`updateMany … where { id, state:
'QUEUED' }`). Tick B's read can land before tick A's write commits while B's `findFirst` lands
  after it — so B picks a **different** row, its `updateMany` matches, and `count === 1` for both.
  Two `RUNNING` rows. The conditional update is atomic **per row**; nothing in it is atomic across
  rows, which is what a global cap needs. The same interleaving beats the per-account rule, so
  **AC-7 was resting on this too** — one fix repairs both criteria.
- **Options**:

  | Option                                          | Pros                                                                              | Cons                                                                                                                                                                                          | Cost to adopt         | Risk                        |
  | ----------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------- |
  | **In-process single-slot gate + the row claim** | Expresses the global cap outright; no SQL, no schema, no migration, no dependency | The invariant lives in the process, not the database — unprovable from a dump, and void the day a second instance exists                                                                      | ~15 lines             | a lost `finally` wedges it  |
  | Partial unique index `WHERE state = 'RUNNING'`  | A durable invariant no code path can violate; the multi-instance answer           | Turns on `previewFeatures = ["partialIndexes"]` for the **whole** generated client (the generator block has none today); converts a lost race into `P2002` that must be read as "not my turn" | migration + preview   | preview churn               |
  | One `updateMany` carrying the global predicate  | No separate read to race against                                                  | **Not expressible** — Prisma's `updateMany.where` has no `NOT EXISTS` over the same model                                                                                                     | —                     | —                           |
  | `pg_try_advisory_lock`                          | A real machine-wide mutex                                                         | Session locks pin to a connection and `@prisma/adapter-pg` hands out a pooled one; the transaction-scoped variant releases at commit, while the run outlives it by up to `WHISPER_TIMEOUT_MS` | raw SQL, a repo first | lifetimes cannot be matched |
  | `SELECT … FOR UPDATE SKIP LOCKED`               | Atomic claim in one statement                                                     | **Gives no global cap at all** — it locks a candidate row, and with nothing running there is no row to lock, so "is anything RUNNING?" stays a separate read                                  | raw SQL               | does not close AC-18        |
  | Serializable isolation on the claim             | The read-then-write conflict becomes detectable                                   | An interactive transaction every second plus `P2034` retry handling, and it still protects only the claim, not the run                                                                        | most machinery        | least coverage              |

- **Chosen**: the **in-process single-slot gate**, the user's ruling — a private boolean set before the
  first `await`, wrapping find → claim → run, with D-5's conditional `updateMany` kept underneath it as
  the per-row guard. Next run is **global FIFO on `queuedAt`**, also the user's ruling.

  ```ts
  @Interval(SCHEDULER_TICK_MS)
  async tick(): Promise<void> {
    if (this.slotBusy) return; // dropped, never queued
    this.slotBusy = true; //     ← no `await` between the read and the set
    try {
      const claimed = await this.claimNextRun();
      if (claimed) await this.runToCompletion(claimed);
    } catch (error) {
      this.logger.error(/* … */); // must never rethrow — see Exposure
    } finally {
      this.slotBusy = false; //      must never be conditional
    }
  }
  ```

- **Why**: Node is single-threaded and there is no `await` between the read of `slotBusy` and its set,
  so no tick can interleave there — the gate is honest under the single-instance assumption this
  document already records, and it is the same bet `QuotaReservationService` places and documents
  (`apps/api/src/files/quota-reservation.service.ts:13–17`). Its **shape**, though, does not transfer:
  `runExclusive` chains promises so every caller eventually runs, which here would park one dropped
  tick per second behind a 30-minute run — roughly 1 800 pending closures, each firing a claim on
  release. This cap wants ticks **dropped**, not deferred. Global FIFO is exactly what the PRD
  promises — "AC-18 is a ceiling on the machine, not a promise about scheduling fairness" — and it
  needs no owner join: D-4's `@@index([state, queuedAt])` already serves both queries, so **phase 2
  still adds no migration**. Dependency budget: **unchanged**.
- **Rejected**: the partial unique index, on the user's ruling — genuinely cheap in mechanism (Prisma
  7.9.1 supports it, PostgreSQL included) but not in commitment, since it switches on a preview feature
  for the entire client to hold an invariant the PRD keeps single-instance; `SKIP LOCKED` and the
  advisory lock, which D-5 named as its multi-instance fallbacks and **neither of which actually
  supplies a global cap** — that note in D-5 was wrong and is corrected here; serializable isolation,
  the most machinery for the least coverage; round-robin across accounts, which would bound each
  account's wait to one competing run but adds a fairness promise the PRD does not make.
- **Exposure**: no new entry point, no dependency, no bytes on disk — the mechanism is one private
  field. An owner can **occupy** the slot, which is what AC-18 knowingly accepts, but must not be able
  to **wedge** it, and exactly two lines decide that: `runToCompletion` bounded by a hard
  `WHISPER_TIMEOUT_MS` so no hold outlives it, and an **unconditional** `finally`. Break either and one
  request disables transcription for every account until a restart, silently. A third line matters as
  much: the tick must swallow its own errors, because `setInterval` never awaits the callback and an
  unhandled rejection **terminates the process** on the pinned runtime — reproduced here on
  `v24.16.0`. And a consequence worth naming: before AC-18 an account's queue depth cost only that
  account; now it is the only bound on cross-account latency, which raises S-5's practical severity
  without changing a word of its text.
- **Fits in at**: `apps/api/src/transcription/transcription-scheduler.service.ts`, with
  `SCHEDULER_TICK_MS` a named constant rather than D-5's inline `1_000`. The boot sweep moves from
  `onApplicationBootstrap` to **`onModuleInit`**: `SchedulerOrchestrator` mounts every interval in its
  own `onApplicationBootstrap` (`scheduler.orchestrator.js:24`), and Nest orders `onModuleInit` before
  all of those but guarantees nothing _between_ two modules' `onApplicationBootstrap` hooks — so a
  tick could otherwise fire before the sweep. Schema unchanged. The day a second instance exists this
  is void, and the replacement is the partial unique index plus a worker identity and a lease
  timestamp, not a swapped claim — D-5's §8 wording understated that.
- **Sources**: `node_modules/@nestjs/schedule/dist/scheduler.orchestrator.js:24,30–33,38` ·
  `apps/api/src/files/quota-reservation.service.ts:13–17,36–47` ·
  `apps/api/src/files/files-purge.service.ts:41` · `apps/api/prisma/schema.prisma:4–11` (the generator
  block carries no `previewFeatures`) · `node -e "Promise.reject(new Error('boom'))"` on `v24.16.0`,
  fatal · [Prisma 7.4.0 release notes](https://github.com/prisma/prisma/releases/tag/7.4.0) (partial
  indexes, preview) · [PostgreSQL 18 partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html)

## 5. Parameters and limits

Values implementation copies verbatim.

| Name                             | Value                                                                                                                                   | Where it lives                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `MAX_AUDIO_DURATION_MS`          | `3_600_000` (60 minutes)                                                                                                                | `transcription.constants.ts`                                    |
| `AUDIO_DURATION_LIMIT_MESSAGE`   | `Recording exceeds the 60-minute transcription limit.`                                                                                  | `transcription.constants.ts`, and hand-duplicated web-side      |
| `DURATION_PROBE_TIMEOUT_MS`      | `10_000`                                                                                                                                | `transcription.constants.ts`                                    |
| `DURATION_UNREADABLE_MESSAGE`    | `Could not read this recording's length.`                                                                                               | `transcription.constants.ts`                                    |
| `MAX_TRANSCRIPT_CHARS`           | `1_048_576` — **characters**, on the parsed `text`                                                                                      | `transcription.constants.ts`                                    |
| `MAX_ENGINE_RESPONSE_BYTES`      | `8_388_608` (8 MiB) — **bytes**, on the engine's response body while it is read                                                         | `transcription.constants.ts`                                    |
| `MAX_DETECTED_LANGUAGE_LENGTH`   | `64`, matching `detectedLanguage @db.VarChar(64)`                                                                                       | `transcription.constants.ts`                                    |
| `MAX_FAILURE_REASON_LENGTH`      | `200`, matching `failureReason @db.VarChar(200)`                                                                                        | `transcription.constants.ts`                                    |
| `MAX_WAITING_RUNS_PER_ACCOUNT`   | `10` — the user's ruling (S-5)                                                                                                          | `transcription.constants.ts`                                    |
| `WAITING_RUN_CAP_MESSAGE`        | `You already have 10 transcriptions waiting. Wait for one to finish before starting another.`                                           | `transcription.constants.ts`                                    |
| `TRANSCRIPTION_POLL_INTERVAL_MS` | `2_000`                                                                                                                                 | `apps/web/src/lib/transcription-limits.ts`                      |
| `SCHEDULER_TICK_MS`              | `1_000`, used as `@Interval(SCHEDULER_TICK_MS)` — a named constant, not a literal (D-11)                                                | `transcription.constants.ts`                                    |
| State/read route throttle        | `@Throttle({ default: { limit: 240, ttl: 60_000 } })`                                                                                   | the controller, matching `files.controller.ts:196`              |
| Start route throttle             | the global baseline (20 / 60 s) — AC-17 is a statement about it                                                                         | no override                                                     |
| `SPEECH_MIME_TYPES`              | `video/mp4`, `video/webm`, `video/quicktime`, `audio/mpeg`, `audio/wav`, `audio/mp4`                                                    | `transcription.constants.ts`, a subset of `ACCEPTED_MIME_TYPES` |
| `WHISPER_URL`                    | `http://127.0.0.1:9000`                                                                                                                 | `.env.example`                                                  |
| `WHISPER_PORT`                   | `9000` (compose publishes `127.0.0.1:${WHISPER_PORT}:8080`)                                                                             | `.env.example`, `docker-compose.yml`                            |
| `WHISPER_MODEL`                  | `tiny` — read by compose **and** by `apps/api`, one source of truth                                                                     | `.env.example`, `docker-compose.yml`                            |
| `WHISPER_TIMEOUT_MS`             | `1_800_000` (30 minutes)                                                                                                                | `.env.example`                                                  |
| Engine settings reported         | engine `local`, model `${WHISPER_MODEL}`, effort `low`, language mode `auto`                                                            | `TranscriptionEngine.settings()`                                |
| Engine `entrypoint`              | `["whisper-server"]` — overriding the image's `ENTRYPOINT ["bash","-c"]`                                                                | `docker-compose.yml`                                            |
| Engine command flags             | argv list: `--host 0.0.0.0 --port 8080 -m /models/ggml-${WHISPER_MODEL}.bin --tmp-dir /tmp --convert -t 4 -l auto -nt -bo 1 -bs -1 -nf` | `docker-compose.yml`                                            |
| Per-request engine fields        | `response_format=verbose_json`, `language=auto`                                                                                         | `whisper-cpp.engine.ts`                                         |
| Engine response field read       | `language` — **not** `detected_language`                                                                                                | `whisper-cpp.engine.ts`                                         |
| `user`                           | `"1000:1000"` (the host account's uid:gid, so the `:ro` model mount reads)                                                              | `docker-compose.yml`                                            |
| `read_only`                      | `true`                                                                                                                                  | `docker-compose.yml`                                            |
| `tmpfs`                          | `/tmp:size=768m,mode=1777,noexec,nosuid,nodev`                                                                                          | `docker-compose.yml`                                            |
| `cap_drop` / `security_opt`      | `[ALL]` / `["no-new-privileges:true"]`                                                                                                  | `docker-compose.yml`                                            |
| `mem_limit` / `memswap_limit`    | `2560m` / `2560m` — equal, which disables swap                                                                                          | `docker-compose.yml`                                            |
| `cpus` / engine threads          | `4.0` / `-t 4` — the two must move together                                                                                             | `docker-compose.yml`                                            |
| `pids_limit`                     | `128`                                                                                                                                   | `docker-compose.yml`                                            |
| Engine network                   | `whisper_net` (name `video-meetings_whisper`) — **not** the default network                                                             | `docker-compose.yml`                                            |
| Model mount / port publish       | `./.data/whisper-models:/models:ro` · `127.0.0.1:${WHISPER_PORT}:8080`                                                                  | `docker-compose.yml`                                            |
| Model file / SHA1                | `ggml-tiny.bin`, 75 MiB, `bd577a113a864445d4c299885e0cb97d4ba92b5f`                                                                     | the provisioning script                                         |

**Two ceilings, in two different units, and neither subsumes the other.** This pass had one, and S-3's
control inherited the mistake by asking that the response stream be cut at `MAX_TRANSCRIPT_CHARS` — a
**character** ceiling on the transcript applied to a **byte** count of the whole JSON envelope. The
envelope is not thin: `verbose_json` emits `{"segments": …}` unconditionally
(`examples/server/server.cpp:1073`), and `-nt` only removes `start`/`end` per segment (`:1097`) and per
word (`:1139`) — `word["probability"]` is pushed outside that guard (`:1144`), and the `words` array is
about two thirds of the body. The transcript text is therefore carried roughly ten times over. A
typical **Russian** hour lands near 1.6 MiB of body for ~176 KB of text, so a byte counter set at
1 MiB would fail a legitimate run — and it would fail it exactly where AC-13 tests it. Hence:

- **`MAX_ENGINE_RESPONSE_BYTES` = 8 MiB**, counted while reading, aborting the stream and failing the
  run when crossed. Derived from a conservative worst case of ~3.6 MiB (448 tokens per 30-second
  window × 120 windows, full envelope, non-Latin script at 2–3 bytes per character) with a ~2.3×
  margin. Being generous costs nothing: `whisper-server` serialises all inference on one mutex
  (`server.cpp:828`), so at most one body is ever in flight.
- **`MAX_TRANSCRIPT_CHARS` = 1 MiB is unchanged in value and in meaning** — characters, applied to the
  parsed `text`. Against ~156 K characters of legitimate worst-case text it keeps ~6.7× headroom.

They bite in disjoint places, which is why both earn their keep: a 5 MiB body carrying 1.5 M ASCII
characters passes the byte ceiling and is caught only by the character one; a legitimate 3.4 MiB
Cyrillic body carries ~156 K characters and is bounded only by the byte one. Crossing either **fails
the run** rather than truncating, because AC-8 forbids presenting partial text as a transcript. Note
what the byte ceiling is not: once it sits on bytes it is a memory bound and nothing more — it is not a
repetition detector, and below it an engine may still return 8 MiB of anything.

**`Content-Length` is a fast path, never the control.** cpp-httplib sets it from `body.size()` on every
`set_content` response, never chunks it, and the server links no compression library — so when it is
present and over the ceiling the request can be destroyed before a single body byte is read. But
`WHISPER_URL` is configuration: a substituted endpoint can omit it or lie, so an absent, unparseable or
under-reported length means "proceed and let the counter decide".

**`detectedLanguage` cannot overflow its column, and the check stays anyway.** `whisper_lang_str_full`
resolves a fixed 100-entry table to a full lowercase English name — `english`, `russian`, `cantonese` —
whose longest entry is `haitian creole` at 14 characters, against `@db.VarChar(64)`. The value is still
attacker-influenced through a substituted engine, so validate and **reject** rather than truncate, and
treat a missing or non-string `language` as a clean failure: the function returns `nullptr` on an
unknown id.

**Three things about the compose service would each have failed on the first run**, and none is
tuning — they are why the flags row above is longer than it was:

1. **`--tmp-dir /tmp` is mandatory.** `server.cpp:63` sets `tmp_dir = "."`, and the image's
   `WorkingDir` is `/app`, which is root-owned — so `--convert` writes its upload and its converted
   WAV into a directory that `read_only: true` forbids and uid 1000 could not write anyway.
2. **`command:` must be an argv list, with `entrypoint` overridden.** The image is
   `ENTRYPOINT ["bash","-c"]`; Compose word-splits a string `command:`, so `bash -c whisper-server …`
   would run with `$0=--host` and **silently discard every flag** — no model, no `--convert`, and the
   default `tmp_dir`. It would look like it started.
3. **`--host 0.0.0.0` is required _inside_ the container.** `server.cpp:59` defaults to `127.0.0.1`,
   and a container bound to its own loopback is unreachable through a published port. The loopback
   containment S-9 accepts comes from the host-side publish, not from this flag.

**The limits are sized against Docker Desktop's VM, not the host.** `~/.docker/desktop/settings-store.json`
gives it **8 CPUs and 3840 MiB** (3.573 GiB usable, 512 MiB swap) where the machine has 12 cores and
14 GB, and `db` and `redis` live in that same VM (measured at ~46 MiB and ~41 MiB). The peak the
`2560m` limit is drawn against is ~1950 MB, and the dominant term is not inference: the upload is
resident **three times** at peak, because httplib buffers the multipart part, `get_file_value` returns
it **by value** (`httplib.h:5898`), and the copy is then written to the tmpfs. `memswap_limit` is
pinned equal to `mem_limit` because an unset value grants swap equal to memory, and against 512 MiB of
VM swap that trades a clean OOM for thrashing past `WHISPER_TIMEOUT_MS`. The tmpfs needs its explicit
`size=` for the same class of reason: unset, it defaults to half the **host's** RAM, which would let
the tmpfs alone OOM the container. At its full 768 MiB it still cannot (537 + 524 + 768 + 150 + 100 =
2079 MB < 2684 MB), so it is a real second backstop rather than a new hazard.

**Refusals, and the status each answers** — the existing files routes set every precedent but one:

| Condition                                      | Status | Exception                              |
| ---------------------------------------------- | ------ | -------------------------------------- |
| Not the caller's file, or no such file         | `404`  | `NotFoundException` (AC-14)            |
| A run for this file already `QUEUED`/`RUNNING` | `409`  | `ConflictException` (AC-2)             |
| Account already holding 10 waiting runs        | `409`  | `ConflictException` (S-5)              |
| Not one of the six speech-carrying types       | `415`  | `UnsupportedMediaTypeException` (AC-1) |
| Audio longer than 60 minutes, or unreadable    | `422`  | `UnprocessableEntityException` (AC-6)  |
| 21st start request inside 60 s                 | `429`  | the global `ThrottlerGuard` (AC-17)    |

`422` is the only new status: the file itself is acceptable, its duration is not, so neither `413`
(size) nor `415` (type) states the reason honestly.

**`MAX_WAITING_RUNS_PER_ACCOUNT` is chosen, not derived, and its JSDoc should say so.** The two numbers
it could have been anchored to are both 20 — `MAX_LIVE_FILES_PER_MEETING`, a meeting's worth of files,
and `DEFAULT_THROTTLE_LIMIT` over `DEFAULT_THROTTLE_TTL_MS`, the most starts one credential can even
make in a window (`apps/api/src/config/throttler.config.ts:4,7`). The user ruled 10, half a meeting:
under AC-18 the machine runs one transcription at a time, so queue depth is what every _other_ account
waits, and 10 hour-long recordings is already a long enough tail. The pairing with
`WAITING_RUN_CAP_MESSAGE` follows `MAX_LIVE_FILES_PER_MEETING` / `LIVE_FILE_CAP_MESSAGE`
(`apps/api/src/files/files.constants.ts:11,64`) exactly: the constant, a message that states the number
and what to do about it, and a `ConflictException` raised on `>=`.

## 6. Dependencies

| Package               | Version   | Purpose                                          | Weight / license      | Why nothing present does the job                                                                                                                          |
| --------------------- | --------- | ------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `music-metadata`      | `11.15.0` | Audio duration for AC-6 (D-7)                    | 558 KB unpacked · MIT | Nothing in the repo reads media duration; `file-type` detects type only, and no ffmpeg exists on the machine                                              |
| `load-esm`            | `1.0.3`   | **Declaring** what `src/storage` already imports | 5 KB · MIT            | Already imported and already installed, but only as a transitive of `@nestjs/common` — see §8                                                             |
| `file-type`           | `21.3.4`  | **Declaring** what `src/storage` already imports | — · MIT               | Same: imported by `file-type.service.ts`, declared nowhere                                                                                                |
| `content-disposition` | `1.1.0`   | **Declaring** what `src/files` already imports   | — · MIT               | Imported by `files.controller.ts` for the download's `Content-Disposition`, declared nowhere; S-6 makes the transcript's `.txt` download depend on it too |

One genuinely new package. The other three rows add no code and no download — they write down three
imports the repository already relies on, and they belong to this change because D-7 makes the feature
depend on `load-esm` too and S-6's control makes it depend on `content-disposition`.

**Declare the version already resolved, not the registry's newest.** These three rows exist to write
down an existing resolution, not to change it: `content-disposition` is `1.1.0` under
`@nestjs/platform-express` → `express@5.2.1`, while the registry's current release is `3.0.0` — two
majors apart, on the header builder the **existing** file-download route already calls. Declaring
`^3.0.0` would either duplicate the package or move `files.controller.ts` onto a different major as a
side effect of this feature. The same rule holds for `file-type@21.3.4` and `load-esm@1.0.3`.

**Not a package**: `ghcr.io/ggml-org/whisper.cpp:main` is a container image alongside `postgres:18` and
`redis:8`, pinned in `docker-compose.yml`. The transport (`node:http`), multipart assembly, hashing and
scheduling are all Node or Nest built-ins.

## 7. Architecture impact

**New module** — `apps/api/src/transcription/`:

- `transcription.module.ts` — imports `AuthModule`, `FilesModule` (D-9) and `StorageModule`; exports
  nothing.
- `transcription.controller.ts` — start, per-file read, meeting-scoped state list, `.txt` download; all
  under the existing `JwtAuthGuard` + `MeetingOwnerGuard` pair `files.controller.ts` already uses.
- `transcription-engine.ts` — the abstract boundary and its injection token (D-1).
- `whisper-cpp.engine.ts` — the only implementation; owns the wire format (D-2).
- `transcription-scheduler.service.ts` — the queue drain and the boot-time sweep (D-5).
- `audio-duration.service.ts` — the `music-metadata` probe (D-7).
- `transcription.constants.ts` — every value in §5.

**Existing modules touched**: `files.module.ts` gains `exports: [FilesService]` and nothing else;
`profile.service.ts` gains the engine-settings keys on its explicit response DTO (3.5); `schema.prisma`
gains one enum, one model and a back-relation on `MeetingFile`.

**`apps/web`**: `src/components/files/` gains the row's transcription surface; `src/lib/transcription-api.ts`
and `src/lib/transcription-limits.ts` are new; `src/app/api/meetings/[meetingId]/transcriptions/route.ts`
(phase 5) and the transcript download handler (phase 6) are the fourth and fifth proxy Route Handlers.

**Docs this change owes**: `docs/modules/module-api-transcription.md` (new) and its row in
`docs/modules/INDEX.md`; `module-api-files.md` (the new export), `module-api-profile.md` (the new
response keys), `module-web-meeting-files.md` and `module-web-profile.md`; Status lines in
`apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`; entries in both apps' `HISTORY.md`; `docker-compose.yml`,
`.env.example`, `.gitignore` and the README's setup and requirements sections.

## 8. Risks and open questions

- **Throughput is not verified.** The Docker daemon was not running during this pass, so nothing was
  benchmarked; every figure in D-3's table is an estimate. If `tiny` on this Docker Desktop VM turns out
  slower than ~4× realtime, `WHISPER_TIMEOUT_MS` (30 min) is too tight for a 60-minute recording.
  **Fallback**: phase 1 measures one real run and pins both the timeout and the documented expectation
  to what it saw; both are env vars, so neither costs code.
- **`tiny` may not carry AC-4 and AC-13.** This pass recommended `base`; `tiny` was chosen for the
  PRD's literal "cheapest model". `tiny` has the highest word-error rate of the family and is weakest
  exactly where AC-13 tests it — a non-English fixture. **Fallback**: `WHISPER_MODEL` is one env var
  read by both compose and the API, and every run records the model it used, so moving to `base` is a
  re-download and a restart — no code, no migration, and AC-11 keeps telling the truth either way.
  Phase 1's AC-13 case is where this gets settled.
- **The engine buffers the upload.** `whisper-server` holds the posted file in memory
  (`server.cpp:880`), so a 500 MB video costs the container roughly that, plus ~230 MB for 60 minutes of
  16 kHz float samples. **Fallback**: `mem_limit` on the service, sized against the existing 500 MB
  per-file ceiling, and — if it bites — extracting audio before sending, which is a change inside
  `whisper-cpp.engine.ts` alone.
- **Three imports are undeclared, not two.** `src/storage/file-type.service.ts` imports `file-type` and
  `load-esm`, which `npm ls` shows only under `@nestjs/common@11.2.1`; `src/files/files.controller.ts`
  imports `content-disposition`, which resolves only under `@nestjs/platform-express` →
  `express@5.2.1`. A bump to either Nest package that drops or moves any of them breaks the build with
  no warning, and on `content-disposition` it would break the file-download route's
  `Content-Disposition` header specifically. Declaring them is one line each (§6, at the resolved
  version rather than the newest) and is folded into task 2.4, because D-7 makes this feature depend on
  `load-esm` and S-6's control makes it depend on `content-disposition`.
- **Half A of AC-12 is not a Jest suite.** It is a scripted compose check in phase 1's **Done when**, so
  it will not run on `pre-push` and will not run in CI when CI exists. That is a deliberate consequence
  of moby#36174 and was confirmed with the user; if it should also be enforced automatically, that is a
  CI question, not a tier question.
- **Single instance is assumed throughout, and D-11 raises the stake.** AC-18 is now held by a flag in
  one process, so a second instance breaks it outright rather than degrading it; the boot sweep assumes
  one process too. `QuotaReservationService` already carries the same assumption. A second instance is
  out of the PRD's scope, and the day it arrives the answer is the **partial unique index** plus a
  worker identity and a lease timestamp — not, as D-5 claimed, a swap to `SELECT … FOR UPDATE SKIP
LOCKED`, which locks a candidate row and supplies no global cap at all.
- **AC-19's single load-bearing assumption is the image's mode bits.** That uid 1000 can execute
  `/app/build/bin/whisper-server` and read the tree is inferred from `COPY --from=build /app /app`
  under a root build with a default umask — the registry config carries no `User` key, so the image
  runs as root today. It was **not verified**, because doing so needs the image on disk. If it is
  wrong, `user: "1000:1000"` fails outright and AC-19 needs a locally-built image with a `USER` line,
  which D-10 rejected for other reasons. **Fallback**: task 1.6's first `docker compose up` settles it
  in one command, before any code depends on it.
- **The memory numbers are computed, not measured.** Nothing was run: no image pulled, no container
  started. The three-copy upload term is read from source and is exact; ffmpeg's RSS (~100 MB) and the
  `tiny` context (~150 MB) are estimates. **Fallback**: one worst-case run (500 MB, 60 minutes) watched
  with `docker stats` during phase 1 settles `mem_limit`, and it is the same run that D-3 already
  defers there for `WHISPER_TIMEOUT_MS`.
- **The response-size arithmetic is derived from the emitting source, not from a real response.** The
  structure is verified line by line in this repo's own checkout of `server.cpp`; the segment counts
  and token-per-word ratios behind the 3.6 MiB worst case are estimates. **Fallback**: capture one real
  `verbose_json` body during phase 1's measured run and compare — the 2.3× margin on
  `MAX_ENGINE_RESPONSE_BYTES` exists to absorb exactly this.
- **Docker Desktop's VM is small, and nothing here can raise it.** 3840 MiB and 8 CPUs against a
  14 GB / 12-core machine; whisper would hold 73 % of that VM during a run. `2560m` is sized for the VM
  as it stands, so nothing is blocked — but raising it to 6–8 GiB in Settings → Resources costs a
  Docker restart and restores real margin for everything else in the file. A machine setting, outside
  the repo, and therefore named here rather than written anywhere.
- **`no_language_probabilities` is left at its default, deliberately.** It defaults to `false`
  (`server.cpp:110`), so every request runs an extra `whisper_lang_auto_detect` pass the engine's own
  comment calls "expensive". Sending `no_language_probabilities=true` per request would skip it and
  shrink the body, and it needs no rebuild — but no finding asks for it, so it is not folded into a
  revision pass. It belongs with phase 1's throughput measurement, where its benefit is observable.

## 9. Plan impact

The plan is revised in five places, all inside existing phases, no task renumbered.

- **Phase 1 — new task 1.6**, because D-1, D-8 and D-10 need work no task covers: the model weights are
  not on the machine, and half A of AC-12 needs its own compose profile. Task 1.5 already owns the
  compose service, the env vars and the README, so 1.6 is the provisioning script and the offline
  profile only.
- **Phase 1 — task 1.4 reworded**, because D-6 splits "a route that answers that file's run state and
  text" into two shapes: a meeting-scoped state list that carries no text, and a per-file read that
  does. One line was covering two mechanisms.
- **Phase 1 — Verified by and Done when**, because D-8's half A is proven by a scripted compose command
  rather than by one of the three suites, and because D-3's throughput has to be measured before
  `WHISPER_TIMEOUT_MS` can be trusted. This is the "**Verified by** the decision has outdated" case: the
  workflow is still the project's, only what it takes to run it moved.
- **Phase 6 — task 6.3 corrected**, from "a Route Handler beside the three that exist" to the fifth,
  since D-6 adds the fourth in phase 5.
- **Every phase gains a `**Decisions**:` line**, so implementation reads the phase and its decisions
  together.

**Answered without a revision**: the plan's Asked & assumed asked whether the engine's provisioning also
serves the duration probe — "if it does, the probe moves to phase 1". It does not. The engine's ffmpeg
lives inside the container and is unreachable from `apps/api`; the probe is `music-metadata` in the API
process (D-7). The two are independent, so **the probe stays in phase 2 and phase 2 keeps AC-6**, as the
plan already has it.

**Nothing was sent back to the user as a plan change wearing a plan's clothes**: no phase was reordered,
added, or moved between layers, and nothing here crosses the PRD's scope fence.

### Round 2 (2026-08-27)

Five more edits, all inside existing phases, no task renumbered and no task dropped.

- **Task 1.2** — the ceiling it cites was the wrong quantity in the wrong unit (S-3). Corrected to
  `MAX_ENGINE_RESPONSE_BYTES`, with the shape validation naming `language` rather than
  `detected_language`, and with a container OOM added to what "degrades to a failed run" has to cover.
- **Task 1.6** — the control S-8 wrote named `mem_limit` and `cpus` with no values, and the three
  settings that decide whether the stock image runs at all were in nobody's text. Both fixed; every
  value is in §5.
- **Tasks 2.2, 2.5, 2.6 and phase 2's `**Decisions**`** — D-5's claim cannot carry AC-18 and never
  carried AC-7 either, so all three tasks now name D-11's gate, the global FIFO order and the
  `onModuleInit` sweep.
- **Task 2.4** — gained the question it had left open (D-7 answers where the probe lives) and the
  three transitively-resolved packages this feature depends on.
- **Phase 6's `**Verified by**`** — "fourth" corrected to "fifth" Route Handler, which round 1's own
  revision should have caught when it corrected task 6.3.

**Handed back rather than written here.** Three things belong to other stages and are named rather
than folded in: S-3's control text still says `MAX_TRANSCRIPT_CHARS`, and only `security-analyse` may
correct it; S-8's control list does not mention the dedicated compose network, which this pass adopted
after finding that the default network holds `db` and `redis` with fallback passwords in the same
file; and the 500 MB per-file ceiling — the single largest term in the engine's memory arithmetic — is
`MAX_FILE_BYTES`, shared with the upload feature and behind the PRD's scope fence, so a
transcription-specific cap would be a PRD change.

## Asked & assumed

- **Asked** — How is the Whisper engine packaged, given that Docker Desktop is the only Docker here and
  its GPU passthrough is Windows/WSL2-only? → `ghcr.io/ggml-org/whisper.cpp:main` as a compose service,
  CPU inference, published on `127.0.0.1` only.
- **Asked** — Which model, given that AC-11 shows it on `/profile` and AC-4/AC-13 have to pass on it?
  → `tiny`, the PRD's literal "cheapest". Recorded against this pass's recommendation of `base`; the
  risk and its one-env-var fallback are in §8.
- **Asked** — What measures audio duration for AC-6, with no ffmpeg or ffprobe on the machine?
  → `music-metadata`, as a new dependency.
- **Asked** — How is AC-12 proven, once published ports turn out not to work on an `internal` network?
  → The two-half proof: an isolated compose profile for the engine, process instrumentation for
  `apps/api`. Accepting that half A lives in a phase's **Done when** rather than in a Jest suite.
- **Assumed** — `apps/api` runs as a single instance · D-5's queue claim is atomic per row, but
  "one run at a time per account" and the boot-time sweep both rely on there being one process; this is
  the same assumption `QuotaReservationService` already makes.
- **Assumed** — A transcript is small enough to live in a Postgres `text` column · 60 minutes bounds a
  legitimate transcript near 215 KB; if transcripts ever needed to be megabytes, `FileStorage` would be
  the better home and AC-10's purge story would change with it.
- **Assumed** — `MAX_TRANSCRIPT_CHARS`, `DURATION_PROBE_TIMEOUT_MS`, `WHISPER_TIMEOUT_MS` and the
  2-second poll interval are research's to set, since the PRD names none of them · each is a constant or
  an env var, so each is cheap to move once phase 1 has measured a real run.
- **Assumed** — The polled state route may be meeting-scoped rather than per-file · the PRD fixes what
  the owner sees, not how many routes serve it, and a per-file route at this cadence cannot fit any
  throttle the repo would accept.
- **Assumed** — `422` is the right status for a recording that is too long or whose length cannot be
  read · the file is acceptable and its type is acceptable, so `413` and `415` would both misstate the
  refusal; if the requester prefers `409` for consistency with the file-count refusal, only a constant
  and a spec change.
- **Assumed** — Declaring `file-type` and `load-esm` belongs to this feature · D-7 makes the feature
  depend on `load-esm`, so the one-line declaration is not a drive-by fix of unrelated code.

- **Asked** (round 2) — S-5 needs a ceiling on an account's waiting runs, and the PRD names no number.
  → **10**, half a meeting's worth of files. The two numbers it could have been anchored to are both
  20 (`MAX_LIVE_FILES_PER_MEETING`, and the throttle's 20 per 60 s); under AC-18 the machine runs one
  transcription at a time, so queue depth is what every other account waits.
- **Asked** (round 2) — AC-18 held by an in-process flag, or also by a partial unique index in
  Postgres? → **The flag alone.** The index is the only thing that would make AC-18 true independently
  of the code being correct, but it switches `previewFeatures = ["partialIndexes"]` on for the whole
  generated client to hold an invariant the PRD keeps single-instance, and it turns a lost race into a
  `P2002` that must be classified as "not my turn" rather than as a failed run.
- **Asked** (round 2) — global FIFO on `queuedAt`, or round-robin across accounts? → **Global FIFO**,
  which is exactly what the PRD promises and needs neither an owner join nor a new index. Round-robin
  would bound each account's wait to one competing run, but that is a fairness promise the PRD does
  not make.
- **Assumed** (round 2) — the whisper service may take a compose network of its own, which S-8's
  control list does not mention · the default network holds `db` and `redis`, whose passwords fall
  back to `video_meetings` in this same file, and `apps/api` reaches the engine over the host's
  loopback rather than over a shared network — so nothing needs them adjacent. If `security-analyse`
  disagrees, the two lines come back out.
- **Assumed** (round 2) — 8 MiB is research's to set for `MAX_ENGINE_RESPONSE_BYTES`, as
  `MAX_TRANSCRIPT_CHARS` and `WHISPER_TIMEOUT_MS` were in round 1 · it is a defensive memory bound
  rather than a product limit, and phase 1's first real response settles whether the 2.3× margin was
  generous or thin.

## Revisions

- 2026-08-27 — round 2: **D-5 superseded by D-11** — the conditional `updateMany` is atomic per row
  and cannot express a machine-wide cap, and re-checking it showed it never carried the per-account
  one either — S-4. D-5 keeps its heading and its block; phase 2 reads D-11.
- 2026-08-27 — round 2: D-9's **Exposure** corrected — the export list is `FilesService` **and**
  `MeetingOwnerGuard`, because `findFileForOwner` covers only a route carrying a `:fileId` and D-6's
  meeting-scoped state list carries none — S-1. The choice itself stands; the same one-name-short
  enumeration in **Chosen** was corrected with it.
- 2026-08-27 — round 2: D-1's **Exposure** corrected — loopback containment is the host-side publish,
  while the process inside the container must bind `--host 0.0.0.0`; "never `0.0.0.0`" was true of the
  publish and false of the bind, and taking it literally would have made the engine unreachable —
  S-8, S-9.
- 2026-08-27 — round 2: §5 gains `MAX_ENGINE_RESPONSE_BYTES` and `MAX_DETECTED_LANGUAGE_LENGTH`, and
  the `MAX_TRANSCRIPT_CHARS` note is corrected — it described a character ceiling as though it bounded
  bytes, and `verbose_json` carries the text about ten times over — S-3.
- 2026-08-27 — round 2: §5 gains `MAX_WAITING_RUNS_PER_ACCOUNT` (`10`, the user's ruling),
  `WAITING_RUN_CAP_MESSAGE` and the `409` row that answers them — S-5.
- 2026-08-27 — round 2: §5 gains the engine container's whole configuration — `user`, `read_only`,
  `tmpfs`, `cap_drop`, `security_opt`, `mem_limit`, `memswap_limit`, `cpus`, `pids_limit`, the
  dedicated network — and the command-flags row is completed with `--host`, `--port`, `-m`,
  `--tmp-dir` and `-t`, three of which decide whether the stock image runs at all — S-8.
- 2026-08-27 — round 2: §5 gains `SCHEDULER_TICK_MS` as a named constant in place of D-5's inline
  `@Interval(1_000)` — D-11.
- 2026-08-27 — round 2: §6 gains `content-disposition@1.1.0`, a third undeclared import, with the rule
  that all three are declared at the version already resolved rather than the registry's newest; §8's
  phantom-dependency risk corrected from two packages to three — S-6.
- 2026-08-27 — round 2: §8 gains the image's mode bits as AC-19's one load-bearing unverified
  assumption, the computed-not-measured memory peak, the derived-not-observed response arithmetic,
  Docker Desktop's VM allocation, and `no_language_probabilities` as a measurement-time question — and
  its single-instance bullet is corrected, since D-5's stated multi-instance fallback supplies no
  global cap.
