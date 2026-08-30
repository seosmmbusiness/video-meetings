# apps/api/src/transcription

Turns a stored recording into text on this machine: a route starts a run for one of the caller's own
files, the engine works in the background, and a later read answers the run's state and — once it
has one — its transcript. Nothing leaves the machine at any point.

The module owns three things and deliberately no more: the `TranscriptionEngine` boundary and its
only implementation, the run row that is both the state and the transcript, and the three routes
that start and read a run. It reaches an owner's file only through the files module's public surface
(D-9) and its bytes only through `FileStorage`, so it knows neither where a recording lives nor how
ownership is expressed.

**What is not here yet.** Phase 1 starts a run inline, one per request, with no queue, no per-account
serialisation and no refusals beyond ownership. The scheduler, the `409`/`415`/`422` gates, the
duration probe and boot-time recovery arrive in phase 2; the download route in phase 3; the web page
in phases 5–6.

## Architecture

- `TranscriptionModule` (`transcription.module.ts`) — binds
  `{ provide: TranscriptionEngine, useClass: WhisperCppEngine }` and **exports the boundary**, the
  shape `StorageModule` gives `FileStorage`. Imports `AuthModule` (the JWT guard), `FilesModule`
  (`FilesService` and `MeetingOwnerGuard`, which that module gained an `exports` array for),
  `MeetingsModule` (the meeting-scoped list route) and `StorageModule` (the recording's bytes).
  Nothing imports this module back, so none of those is a cycle.
- `transcription-engine.ts` — the abstract `TranscriptionEngine` class (`transcribe`, `settings`),
  used as its own Nest injection token, plus `TranscriptionResult`, `EngineSettings` and
  `TranscriptionEngineError`. Every way the engine can disappoint arrives as that one error class.
- `whisper-cpp.engine.ts` — the only implementation: `POST ${WHISPER_URL}/inference` against the
  compose service, `response_format=verbose_json` and `language=auto`, the recording streamed in as
  a hand-written multipart body.
- `engine-response.ts` — the two ceilings and the shape check, as free functions so they are unit
  testable without a socket: `exceedsResponseCeiling`, `readBoundedBody`, `parseTranscriptionResult`.
- `transcription.service.ts` — `startForOwner`, `getForOwner`, `listForOwner`, and the private
  `execute`/`recordFailure` pair that runs a transcription to its end and records how it went.
- `transcription.controller.ts` — `@Controller('meetings/:meetingId')` behind
  `@UseGuards(JwtAuthGuard, MeetingOwnerGuard)`, three routes (below).
- `transcription-view.ts` — `RUN_VIEW_COLUMNS` (the four columns a read selects), the field-by-field
  `toTranscriptionResponse`, and `failureReasonOf`.
- `dto/` — `TranscriptionResponseDto` (per file: `fileId`, `state`, `text`, `detectedLanguage`,
  `failureReason`), `TranscriptionStateResponseDto` and `TranscriptionStateListResponseDto`.
- `transcription.constants.ts` — every limit and literal this module uses; no numbers at call sites.

## Routes

| Route                                                   | Answers                                                      | Throttle            |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `POST /meetings/:meetingId/files/:fileId/transcription` | `202` with the queued run — the transcript is never in it    | none (the baseline) |
| `GET /meetings/:meetingId/files/:fileId/transcription`  | that file's state and, once `SUCCEEDED`, its text            | 240 / 60 s          |
| `GET /meetings/:meetingId/transcriptions`               | every live file of the meeting with its state, no text (D-6) | 240 / 60 s          |

All three answer `404` for a file or meeting that is not the caller's, exactly as for one that never
existed (AC-14). A file nobody has transcribed is **not** a `404`: it answers `state: null`.

The start route carrying **no** `@Throttle` override is deliberate and load-bearing — AC-17 is a
statement about the global 20 / 60 s baseline, so an override here would quietly void it. The read
routes carry the same 240 / 60 s the file-download route does (`files.controller.ts:196`), because
the meeting page polls the list route every two seconds and must not throttle its own owner out.

## The run row

`FileTranscription` (`file_transcriptions`) is one row per recording, `fileId @unique` — the state
and the transcript in the same row, because no history of earlier transcripts is kept (D-4). The
relation is **`onDelete: Cascade`**, against the schema's only other precedent of `onDelete:
Restrict`: `FilesPurgeService.purgeExpired()` calls `meetingFile.delete()`, which `Restrict` would
have made throw the first time an expired file had ever been transcribed.

`text` is written **once**, in the same update that sets `SUCCEEDED`, so a row can never be read or
swept carrying half a transcript. A re-start of an existing run is an `upsert` that clears `text`,
`failureReason`, `detectedLanguage`, `startedAt` and `endedAt` and re-stamps `queuedAt` — a second
attempt reads as a fresh run, not as the old one with new text appended.

Each row records the settings it ran under (`engine`, `model`, `effort`, `languageMode`,
`detectedLanguage`), so a stored transcript explains itself: raising `WHISPER_MODEL` later does not
retroactively claim the old text came from the new model.

## Bounds, and why there are two of them

The engine's response is the one input to this feature that arrives with no size contract, so it is
bounded twice, in two different units, and neither ceiling subsumes the other (S-3, research §5):

- **`MAX_ENGINE_RESPONSE_BYTES` = 8 MiB**, counted **while the body is read**, abandoning the stream
  the moment it is crossed. It is a memory bound and nothing else — below it an engine may still
  answer 8 MiB of anything. It is 8 MiB rather than 1 because `verbose_json` carries the transcript
  roughly ten times over (`segments`, `words` and their probabilities), so a legitimate non-English
  hour lands near 1.6 MiB of body — exactly where AC-13 tests it.
- **`MAX_TRANSCRIPT_CHARS` = 1 MiB**, in **characters**, on the parsed `text`. A 5 MiB body carrying
  1.5 M ASCII characters passes the byte ceiling and is caught only here.

Crossing either **fails the run** rather than truncating: partial text presented as a transcript is
what AC-8 forbids. `Content-Length` is a fast path only — an oversized declared length lets the
request be destroyed before a body byte is read, but `WHISPER_URL` is configuration, so an absent,
unparseable or under-reported header means "proceed and let the counter decide".

`detectedLanguage` is validated against `MAX_DETECTED_LANGUAGE_LENGTH` (64) and **rejected** rather
than truncated when it does not fit, and a missing or non-string `language` is a clean failure. The
real engine cannot overflow that column — its longest language name is `haitian creole` — but the
value is attacker-influenced through a substituted endpoint.

## Failure is a state, never an exception to the caller

`WhisperCppEngine` and `TranscriptionService.execute` between them make every way the engine can
disappoint — absent, unreachable, wedged, killed under its memory limit, a non-2xx status, an
oversized body, a shape that is not a transcript, an unreadable recording — end as one `FAILED` row.
Never a failed startup, never a failed request: the same rule the root `CLAUDE.md` states for Redis
applies here, and it is what lets the API answer every other route normally with the engine stopped.

The stored `failureReason` is either one of the engine's own fixed literals or the generic
`RUN_FAILED_MESSAGE`. An arbitrary error's message is never stored — it can name a path, a storage
key or a line of whatever a crafted container pointed at (S-8).

## Gotchas (non-obvious, worth preserving)

- **`node:http`, not `fetch`.** Measured on this machine, `fetch` retains the whole request body
  (1 GiB file → ~1152 MB peak RSS) where `http.request()` + `pipe()` peaks at 105 MB, and this
  feature's files reach 500 MB (D-2). The multipart envelope is therefore written by hand; the pipe
  uses `{ end: false }` so the closing boundary can follow the recording's last byte.
- **Nothing caller-influenced is interpolated into a multipart header.** The boundary is a
  `randomUUID()` and the part's `filename` is the fixed literal `recording`, so the owner's own file
  name never travels to the engine.
- **The engine's field is `language`, not `detected_language`** (`server.cpp:1070`). Reading the
  other name would fail every legitimate run as "not a transcript".
- **Ownership is resolved twice, on purpose** (S-1). `MeetingOwnerGuard` resolves `:meetingId`
  before any handler runs — which is the list route's _only_ cover, since it has no `:fileId` for
  `findFileForOwner` to resolve — and the service resolves the file or the meeting again through
  `FilesService`/`MeetingsService`. The list query additionally filters `meeting: { ownerId }`.
- **The list route carries no transcript text.** Twenty hour-long transcripts is roughly a megabyte
  per poll tick; the text is the per-file route's to answer (D-6).
- **A unit spec overrides the `TranscriptionEngine` token**, which is why `pre-push` never needs an
  engine running. That stubbability is a constraint on the boundary, not an accident of it — an
  implementation that reached the network from the service instead would break the push gate.

## The engine service (`docker-compose.yml`)

`ghcr.io/ggml-org/whisper.cpp:main`, which carries both `whisper-server` and the `ffmpeg` that
`--convert` needs. The GPU is not usable here — Docker Desktop's passthrough is Windows/WSL2 only —
so inference is CPU-bound at `-t 4` against `cpus: 4.0`, and the two must move together.

Three of its settings are the difference between working and _silently_ not working:

1. **`--tmp-dir /tmp`** — `whisper-server` defaults its scratch directory to `.`, and the image's
   working directory is the root-owned `/app`, which `read_only: true` forbids writing anyway.
2. **An argv-list `command:` with `entrypoint` overridden** — the image is `ENTRYPOINT ["bash","-c"]`
   and Compose word-splits a string `command:`, so every flag would be discarded while the container
   still appeared to start.
3. **`--host 0.0.0.0` inside the container** — its default is `127.0.0.1`, which no published port
   can reach. The loopback containment comes from the host-side publish, not from this flag.

The hardening is AC-19's, because the ffmpeg inside this container parses whatever an owner uploads:
`user: "1000:1000"`, `read_only: true`, a sized `tmpfs` for `/tmp` (unset, it defaults to half the
**host's** RAM and could OOM the container on its own), `cap_drop: [ALL]`,
`no-new-privileges:true`, `mem_limit`/`memswap_limit` pinned equal at `2560m` (which disables swap —
an unset `memswap_limit` grants swap equal to memory and trades a clean OOM for thrashing),
`pids_limit: 128`, the model mounted `:ro`, **no mount of `STORAGE_ROOT`**, and its own
`whisper_net` network rather than the default one `db` and `redis` share.

**Accepted residual (S-9)**: the published port answers any local process without authentication,
including its `/load` model swap. Loopback publishing is the containment, the same level Postgres and
Redis sit at in this compose file. To be revisited if this ever runs anywhere but one machine.

## Configuration

| Variable             | Default                  | Read by                                            |
| -------------------- | ------------------------ | -------------------------------------------------- |
| `WHISPER_URL`        | `http://127.0.0.1:9000`  | `apps/api` — must be `http:`, or the run fails     |
| `WHISPER_PORT`       | `9000`                   | compose, which publishes `127.0.0.1:<port>:8080`   |
| `WHISPER_MODEL`      | `tiny`                   | compose **and** `apps/api` — one source of truth   |
| `WHISPER_TIMEOUT_MS` | `1_800_000` (30 min)     | `apps/api`; unusable values keep the shipped bound |
| `WHISPER_MODELS_DIR` | `./.data/whisper-models` | compose **and** `scripts/whisper-models.js`        |
| `WHISPER_MODEL_SHA1` | the model's pinned SHA1  | `scripts/whisper-models.js`                        |

The weights come from `npm run whisper:models` into the gitignored `.data/whisper-models/`, verified
against the SHA1 whisper.cpp publishes and mounted read-only, so nothing is fetched during a run
(D-10). Raising the model is one env var and a re-pull — no code, no migration — and each row keeps
recording which model produced its text; a model with no SHA1 pinned in the script is provisioned by
supplying `WHISPER_MODEL_SHA1`, so raising it never means skipping the check. The download writes a
`.part` file and renames it only after it passes the gate, so an interrupted download can never be
mistaken for a provisioned model, and a file already on disk is re-verified rather than trusted.

`WHISPER_MODELS_DIR` exists for one failure that looks like nothing: Docker Desktop bind-mounts only
the directories listed in its settings and mounts anything outside them as an **empty** directory
rather than refusing, which the engine reports as `failed to open '/models/ggml-<model>.bin'`. A
checkout on a drive Docker does not share needs the weights somewhere it does; the variable moves the
mount and the provisioning script together, and its default is the path the plan fixes.

## The offline profile (`docker-compose.offline.yml`)

AC-12's half A, and the one place this feature's proof leaves the three Jest suites. `npm run
whisper:offline` overlays `docker-compose.offline.yml` on the base file, which declares `whisper_net`
`internal: true` and posts `apps/api/test/fixtures/english-speech.wav` to
`http://whisper:8080/inference` from a one-shot `curl` container on that same network, failing unless
real text comes back. `npm run whisper:offline:down` puts the machine back.

The overlay drops the published port (`ports: !reset null`) because it has to: a published port does
**not** work on an internal network (moby#36174), so the topology that denies the engine egress is
the same one that makes it unreachable from the host. That is why this cannot be the topology
`apps/api` runs against, and why the denial is driven from inside the network rather than asserted
from outside it. Half B — that `apps/api` itself attempts no lookup during a run — is the integration
spec below; neither half closes AC-12 alone (D-8). The check needs the speech fixtures provisioned
first (`apps/api/test/fixtures/README.md`).

## Testing

- **Unit** (`*.spec.ts`) — `engine-response.spec.ts` (both ceilings, the `Content-Length` fast path,
  the shape check), `whisper-cpp.engine.spec.ts` (the multipart envelope, the timeout, every failure
  mapping), `transcription.service.spec.ts` and `transcription.controller.spec.ts`. No engine, no
  Postgres, no socket.
- **Integration** (`*.int-spec.ts`) — `file-transcription.int-spec.ts` for the row, its cascade and
  its constraints; `transcription.int-spec.ts` for the module wired against a real database,
  including AC-12's half B: `dns.lookup`, `dns.resolve*`, their `dns.promises` twins,
  `net.Socket.prototype.connect` and `tls.connect` are recorded around a real run and every
  destination asserted loopback, the hooks installed and removed around that run so they cannot leak
  into other specs.
- **E2E** (`test/transcription.e2e-spec.ts`) — the start/read round trip against a fixture whose
  spoken words are known, the `404` for another owner's file on **both** start and read, auth bypass,
  and mass-assignment rejection.
- **Outside the suites, and stated here so it is not mistaken for missing coverage**: AC-12's other
  half is a scripted `docker compose -f docker-compose.yml -f docker-compose.offline.yml` run, because
  published ports do not work on a network declared `internal: true` (moby#36174), so the denial has
  to be driven from inside it; and the engine's real throughput is measured once on this machine,
  which is what `WHISPER_TIMEOUT_MS` and the README are set from.
