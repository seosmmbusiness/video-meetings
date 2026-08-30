# PRD: Meeting transcription

**Key**: MT
**Date**: 2026-08-24
**Status**: draft

## 1. Goal

A meeting owner needs the words spoken in an uploaded recording as text they can read, copy and keep
next to that recording. Today a recording can only be played or downloaded, so reading back an hour
of meeting means listening to an hour of meeting — and because the words are computed on the
project's own machine, the audio never has to be handed to anyone else to get them.

## 2. User scenarios

The only account holder in this product is the **meeting owner**; participants are unauthenticated
email strings, not users. The negative scenarios below are what everyone else gets.

**Starting a transcription**

- Meeting owner → opens a meeting holding a recording → each audio or video file in the list carries
  a Transcribe control; files that carry no speech (`pdf`, `docx`, `txt`, `md`, `png`, `jpg`) carry
  none.
- Meeting owner → presses Transcribe on a recording → that row moves to its waiting or running state
  straight away, without a page reload, and the control cannot start a second run for that file
  until the first one ends.
- Meeting owner → presses Transcribe while another of their transcriptions is already running → the
  second file waits its turn and starts by itself once the first one ends; the two never run at
  once.
- Meeting owner → presses Transcribe on a recording longer than 60 minutes → it is refused with the
  60-minute limit stated, and no run starts.

**Waiting and reading**

- Meeting owner → leaves the file row on screen while the run proceeds → the row reaches its
  finished state on its own and the text appears under the file, without the owner reloading
  anything.
- Meeting owner → reloads the meeting page mid-run → the row still shows the run in flight, and the
  run keeps going.
- Meeting owner → comes back to the meeting later → the finished text is still under its file.
- Meeting owner → reads a finished transcript → copies the whole text with one control, or downloads
  it as a `.txt` file.
- Meeting owner → transcribes a recording spoken in a language other than English → gets the text in
  the language that was spoken, without having been asked which one it is.

**When it goes wrong**

- Meeting owner → a run fails (the engine is unavailable, or the file carries no usable audio) → the
  row shows a failed state naming the reason in readable words and offering Retry; no half-finished
  text is presented as a transcript.
- Meeting owner → presses Retry once the cause is gone → a fresh run starts for that file and
  produces text.
- Meeting owner → a run fails while another file of theirs is waiting → the waiting file starts
  anyway; a failed run does not block the queue behind it.
- Meeting owner → transcribes a file that already has a transcript → the new text replaces the old
  one once the run succeeds; if the new run fails, the previous text is still there.

**The rest of the file's life**

- Meeting owner → deletes a transcribed file → its transcript goes with it: not shown, not
  downloadable, and gone for good once the file is purged.
- Meeting owner → restores a deleted file → its transcript is back with it, unchanged.

**Knowing what will run**

- Meeting owner → opens `/profile` → sees a Transcription section stating that transcription runs
  locally, which model, effort level and language mode it uses, and that the audio does not leave
  the server; there is nothing to fill in.

**Everyone else**

- Another signed-in user → starts a transcription on, reads, or downloads the transcript of a file
  they do not own → gets the same not-found answer as for a file that does not exist; no text, no
  run state and no filename is revealed.
- Signed-out visitor → opens the meeting page → is redirected to `/login`, and no transcript text or
  run state is served to any request they make.

## 3. Scope

**In scope**

- A Transcribe control on each audio or video file's row on the meeting page at `/meetings/<id>` —
  the six accepted speech-carrying types (`mp4`, `webm`, `mov`, `mp3`, `wav`, `m4a`) and no other.
- Transcription performed by a Whisper engine running on the project's own machine: the audio, the
  file name and the resulting text never leave it.
- Fixed engine settings, shown but never chosen: the cheapest model, effort `low`, and the spoken
  language detected automatically.
- Run state on the file row — none, waiting, running, done, or failed with its reason — reaching its
  final value without the owner reloading the page.
- A transcript stored with its file, shown under that file on the meeting page, copyable in one
  action and downloadable as a `.txt` file.
- A transcript that follows its file through soft delete, restore and purge, exactly as the file's
  own bytes do.
- Re-running a transcription on a file that already has one, replacing the stored text on success
  and keeping it on failure.
- Limits: at most 60 minutes of audio per file, at most one transcription running at a time per
  account with the rest waiting their turn, and at most 10 transcriptions waiting per account.
- A read-only Transcription section on `/profile` naming the engine, the model, the effort level and
  the language mode in force.
- Owner-only access to starting a run and to reading, copying or downloading a transcript, answering
  exactly as for a file that does not exist.

**Out of scope**

- A remote or hosted Whisper-compatible API, the user's own API key, and the model and effort
  selectors those need — deferred to the next iteration, so this one gets one engine working end to
  end rather than two half-built; the read-only `/profile` section is where they will land.
- Timestamps, per-segment output and subtitle files (`.srt`, `.vtt`) — plain running text is the
  whole promise here.
- Speaker diarisation ("who said what") — a separate model on top of the transcript.
- Summaries, action items or any other language-model step over the text — a second integration with
  its own model, key and cost.
- Editing or correcting a transcript by hand — a wrong transcript is fixed by transcribing again.
- Searching across transcripts, or across meetings — a meeting holds at most 20 files.
- Transcribing automatically on upload — the owner presses the button, so nothing is computed that
  nobody asked for.
- Translating the transcript into another language — transcription only, in the language spoken.
- Recordings longer than 60 minutes, and splitting a long recording into parts automatically — the
  owner shortens the file before uploading it.
- Transcribing anything but audio and video — `pdf`, `docx`, `txt`, `md`, `png` and `jpg` carry no
  speech.
- Sharing a transcript with the meeting's participants — participants are unauthenticated email
  strings, not accounts, so there is nobody to share with.
- A percentage or an estimated time while a run proceeds — states only.
- Being notified when a run finishes — this project has no outbound email or push mechanism.
- Cancelling a run once it has started — it runs to its end or it fails.
- Keeping earlier transcripts of the same file — a re-run replaces, with no history and no undo.
- Running transcriptions across more than one machine, or scaling the engine horizontally — one
  machine, one run at a time.
- Accepting media formats the upload list does not already carry (`ogg`, `flac`, `aac`, `mkv`,
  `audio/webm`) — the accepted upload list is unchanged by this feature.
- Changing anything about how files are uploaded, listed, played, downloaded, deleted or purged.

## 4. Technical constraints

- **Whisper, run locally, is fixed by the requester** — not a choice this feature makes. Which
  Whisper build, how it is packaged and how `apps/api` reaches it are `research`'s to settle; that
  it is Whisper and that it runs on this machine are not.
- **The speech-carrying types already accepted are exactly six**: `mp4`, `webm`, `mov` (video) and
  `mp3`, `wav`, `m4a` (audio), out of the twelve `apps/api/src/files/files.constants.ts` accepts.
  Type is decided by content sniffing, never by the declared type or the extension. `webm` maps to
  `video/webm` only, so a browser's `audio/webm` recording is not an accepted upload today.
- **Nothing of a local Whisper exists on the machine yet**: no `whisper` binary, no `ffmpeg`, no
  model weights, no local inference server. Docker 29 and Compose v5 are available, and
  `docker-compose.yml` already provisions Postgres 18 and Redis 8. The development machine carries
  one NVIDIA RTX 2060 with 6 GB of memory.
- **`apps/api` has no outbound integration of any kind** — no `fetch`, no HTTP client dependency, no
  timeout, retry or third-party-secret convention. Reaching an engine over a socket would be its
  first.
- **There is no queue, worker or job infrastructure.** The only background work in the repo is
  `FilesPurgeService`'s hourly `@Cron` on `@nestjs/schedule`; `QuotaReservationService` is the only
  serialising primitive and is explicitly in-process and single-instance. Redis is provisioned but
  unused, and the project rule is that nothing may hard-depend on it or fail when it is unreachable
  — so a durable Redis-backed queue contradicts a standing rule and is a decision `research` has to
  take deliberately.
- **Work that outlives its request has no precedent in `apps/web`**: no polling, no SSE, no
  WebSocket, no job id, no status route. Upload progress works only because it lives inside a single
  request (`XMLHttpRequest.upload.onprogress` through a streaming proxy), which a run outliving its
  request cannot reuse.
- **The Prisma schema has no enums at all today**, and `MeetingFile` has no processing-state column.
  A persisted set of states must be a Prisma `enum` per the project's conventions, so this feature
  introduces the first one.
- **There is no settings, preferences or secrets store, and no encryption utility anywhere in the
  repo.** `/profile` answers exactly `{ id, email, name, hasAvatar, avatarUpdatedAt }`.
- **`apps/web/src/app/meetings/[id]/page.tsx` is 317 lines**, already past the project's 200-line
  ceiling, so it is decomposed in its own commit before anything is added to it.
- **Bytes live behind the `FileStorage` abstraction** under `STORAGE_ROOT`, keyed
  `meetings/<meetingId>/<fileId>`; `localPathFor(key)` returns a real path for the local backend and
  `null` for a future remote one.
- **Files are owner-scoped by compound lookup and answer 404, never 403**, so a response never
  reveals whether an id exists. Transcription must not weaken that.
- **Auth is a stateless JWT** issued by `apps/api`, held by `apps/web` in an `httpOnly` cookie and
  never exposed to the browser; byte traffic goes through same-origin proxy Route Handlers that
  attach the token server-side.
- **A file's row and bytes vanish on soft delete, return on restore, and are purged 30 days after
  deletion** by the hourly cron. Whatever a transcript is stored as has to follow that lifecycle.
- **Development is test-first at three tiers** (unit, integration, e2e) with mandatory security
  cases at each, and the API is rate-limited globally at 20 requests per 60 seconds per credential
  (`THROTTLE_LIMIT` / `THROTTLE_TTL_MS`).
- **The two apps share no package**, so every request and response shape and every limit is
  hand-duplicated between them and changed in the same commit.
- **The numbers fixed by the requester**: 60 minutes of audio per file, one running transcription
  per account.

## 5. Acceptance criteria

- [ ] **AC-1** On a meeting the signed-in owner owns, every listed file whose detected type is video
      (`mp4`, `webm`, `mov`) or audio (`mp3`, `wav`, `m4a`) carries a Transcribe control — a
      recording longer than 60 minutes included, whose refusal AC-6 owns — while a file of any other
      accepted type (`pdf`, `docx`, `txt`, `md`, `png`, `jpg`) carries none and is refused a run
      even when the request is sent straight to `apps/api`; a file that has never been transcribed
      shows no transcript and no run state at all.
- [ ] **AC-2** Pressing Transcribe on an audio or video file that has no run in flight moves that
      row into its waiting or running state within 2 seconds and without a page reload; a second
      request for the same file while that run is waiting or running starts no second run, including
      when sent straight to `apps/api`, bypassing the page.
- [ ] **AC-3** The row reaches its finished state and the transcript appears under the file within 5
      seconds of the run being recorded as finished, with no reload, refresh or navigation by the
      owner; reloading the page mid-run shows the same in-flight state rather than an idle one.
- [ ] **AC-4** A finished transcription of a fixture recording whose spoken words are known shows
      text under its file containing those words — a run that stores a fixed string, an empty
      transcript or the file's own name falsifies this — and that text is still there after a page
      reload and after signing out and back in.
- [ ] **AC-5** A finished transcript can be copied to the clipboard with one control, and downloaded
      as a `.txt` file whose contents are exactly the text shown.
- [ ] **AC-6** A request to transcribe a file whose audio runs longer than 60 minutes is refused with
      a message stating the 60-minute limit, and a request to transcribe a file whose audio length
      cannot be read is refused with a message saying so; in neither case does a run start or a
      transcript get stored — including when the request is sent straight to `apps/api`, bypassing
      the page.
- [ ] **AC-7** Two transcriptions of one account never overlap in time: with one run in flight, a
      second file requested by that account waits and starts only once the first has ended — whether
      it ended by finishing or by failing — provable from the recorded start and end times of the
      two runs.
- [ ] **AC-8** A run that fails leaves its row in a failed state naming the reason in words the
      owner can read, offers Retry, and presents no partial text as a transcript; with the cause
      removed, Retry starts a fresh run for that file which produces text.
- [ ] **AC-9** Re-running a transcription on a file that already has one replaces the stored text
      when the new run succeeds and leaves the previous text untouched when the new run fails; no
      earlier transcript of that file stays reachable afterwards.
- [ ] **AC-10** A transcript follows its file: after the file is soft-deleted the transcript is
      neither shown nor downloadable, after the file is restored it is shown again unchanged, and
      after the file is purged the transcript no longer exists in storage — provable by backdating a
      deleted file's deletion time.
- [ ] **AC-11** `/profile` shows a read-only Transcription section naming the engine as local and
      stating the model, the effort level and the language mode — the same values a run records for
      itself, so changing the engine's configured settings changes what the section shows, and the
      configured defaults when the account has no finished run yet — together with a statement that
      the audio does not leave the server; the section carries no editable field, no selector and no
      API-key input in this iteration.
- [ ] **AC-12** A transcription of an accepted file completes and produces text while every
      connection and DNS lookup to an address outside the machine is denied for the whole run, and
      no such connection or lookup is attempted — a run that reaches past the machine, or that
      completes only because outbound access was left open, falsifies this.
- [ ] **AC-13** The spoken language is detected without the owner being asked: a recording spoken in
      a language other than English comes back as text in the language that was spoken, and no
      language control appears anywhere in this feature.
- [ ] **AC-14** A signed-in user who does not own the meeting gets the same not-found answer for
      starting a transcription on, reading, or downloading the transcript of one of its files as for
      a file id that does not exist: no text, no run state, no filename and no length is disclosed,
      and nothing in the response distinguishes "no such file" from "not yours".
- [ ] **AC-15** No transcript text and no run state reaches a request that does not carry a valid
      session for the file's owner: a missing, malformed or expired token is refused, and a
      signed-out visitor sees no transcript on any page.
- [ ] **AC-16** A transcript containing HTML or script markup is shown as literal text on the meeting
      page and in the downloaded `.txt`, never rendered or executed as markup.
- [ ] **AC-17** The 21st transcription request from one caller inside a 60-second window is refused
      with `429` and starts no run, matching the API's global throttle baseline of 20 requests per
      60 seconds per credential.
- [ ] **AC-18** At most one transcription runs on the machine at any moment, whatever the number of
      accounts: with a run in flight for one account, a run requested by a **different** account
      waits and starts only once the first has ended — whether it ended by finishing or by failing —
      provable from the recorded start and end times of the two runs, exactly as AC-7 proves it
      within a single account.
- [ ] **AC-19** The engine runs contained: its container starts as a non-root user with no added
      capabilities and a read-only root filesystem, no part of the file storage root is mounted into
      it, and its port is published on the loopback address only — so a recording crafted to make its
      media parser read a file or open a connection reaches neither another meeting's bytes nor
      anything of the host; provable by inspecting the running service's configuration and by such a
      recording producing a failed run and no transcript.
- [ ] **AC-20** An account holds at most 10 transcriptions waiting at once: with 10 already waiting,
      a further request to transcribe is refused with a message stating that limit, no run is
      created and nothing is stored — including when the request is sent straight to `apps/api`,
      bypassing the page.

## Asked & assumed

- **Asked** — Local Whisper, a remote Whisper-compatible API, or both in this iteration, given that
  neither exists in the repo today? → Local only. The remote provider, the user's own API key and
  the model and effort selectors move to Out of scope and to the next iteration.
- **Asked** — Where does the user set the provider, the API key, the model and the effort level? → A
  Transcription section on `/profile`.
- **Asked** — With the remote provider deferred, what is actually left in that section? → Only what
  genuinely works: the section states the engine, the model, the effort level and the language mode,
  and carries no editable field and no API-key input in this iteration.
- **Asked** — What is the result and where is it shown? → Plain text under its file on the meeting
  page: readable there, copyable in one action, downloadable as `.txt`.
- **Asked** — Where is the ceiling above which a recording is refused, and how many runs at once? →
  60 minutes of audio per file; one running transcription per account, the rest waiting.
- **Asked** — What does the owner see while a run proceeds and when it fails? → The state on the file
  row, updating without a manual reload, and on failure the reason plus a Retry control.
- **Asked** — Who decides the spoken language? → Whisper's own auto-detection; the owner is not
  asked and nothing is stored.
- **Assumed** — Only the meeting's owner may start a transcription or read a transcript, and there is
  no sharing of any kind · participants are plain email strings rather than accounts; if
  participants ever become accounts, the access scenarios and AC-14 have to be rewritten.
- **Assumed** — A transcript belongs to one file rather than to the meeting, and follows that file
  through soft delete, restore and purge · a transcript outliving its file would leave the meeting
  holding text whose source nobody can play or check.
- **Assumed** — The 60-minute ceiling is measured on the recording's audio duration, not on its byte
  size · a 500 MB WAV of 30 minutes is accepted, and a 40 MB MP3 of 90 minutes is refused.
- **Assumed** — "Effort `low` and the cheapest model" is a fixed property of the local engine rather
  than something the owner may raise · if a heavier local model should ever be selectable, the
  `/profile` section stops being read-only and AC-11 changes.
- **Assumed** — Waiting runs are held per account and start in the order they were requested ·
  nothing in this iteration lets an owner reorder or jump the queue.
- **Assumed** — The engine's own installation and provisioning are part of building this feature,
  not a prerequisite the user supplies · nothing about Whisper exists on the machine today, so a
  phase has to put it there.
- **Assumed** — A run interrupted by an API restart is recovered as a failed run the owner retries,
  not as a resumed one · nothing in this project resumes work across a restart.
- **Assumed** — The 5-second ceiling in AC-3 is this document's, not the requester's, and follows the
  2-second precedent in AC-2 · if a slower refresh is acceptable, AC-3 loosens and the mechanism
  behind it gets cheaper.
- **Assumed** — The `429` threshold in AC-17 is the repository's current global baseline rather than
  a new limit · if transcription warrants a stricter ceiling of its own, AC-17 names that number
  instead.
- **Assumed** — AC-12's denial of outbound access is something a test harness can impose · how it is
  imposed is `research`'s to settle, and if no tier can impose it, AC-12 has to be re-cut rather
  than quietly dropped.
- **Asked** (`security-analyse`, 2026-08-26) — AC-7 serialises runs only within one account, while
  the engine is a single shared process, so N accounts produce N concurrent requests to it; and
  nothing in the plan hardened the container in which ffmpeg parses whatever an owner uploads.
  Should either control become a criterion, given that neither was ever promised and so no test held
  either? → Both. **AC-18** and **AC-19** were added, closing threats S-4 and S-8.
- **Assumed** — AC-18 is a ceiling on the machine, not a promise about scheduling fairness · which
  account's waiting run goes next stays the per-account rule AC-7 describes, and nothing here lets an
  owner reorder or jump the queue.
- **Assumed** — AC-19's containment is stated as configuration because that is what can be observed ·
  it bounds what a media-parser failure can reach, and does not claim the parser is free of such
  failures.
- **Asked** (`pre-issues`, 2026-08-30) — D-7's duration probe fails closed, so a recording whose
  length cannot be read is refused rather than run — an outcome no criterion carried, while AC-1
  promises a Transcribe control on every audio and video file. Keep the control, or run the file
  anyway? → **Keep it**, and amend **AC-6**, which now names that refusal beside the 60-minute one
  (T-3).
- **Asked** (`pre-issues`, 2026-08-30) — `MAX_WAITING_RUNS_PER_ACCOUNT` = 10 refuses an account's
  11th start with `409`, where In scope said "the rest waiting" and no criterion held the cap. Raise
  it into a criterion, or leave it an internal control? → **Raise it**: **AC-20**, and In scope now
  states the cap (T-4).
- **Assumed** — AC-20's ceiling counts waiting runs only · the one run in flight is AC-7's and
  AC-18's business, and nothing here lets an owner reorder or jump the queue.
