# Plan: Meeting file upload

**Key**: MFU
**PRD**: [meeting-file-upload-PRD.md](./meeting-file-upload-PRD.md)
**Date**: 2026-08-16
**Status**: superseded by [meeting-file-upload-FINAL.md](./meeting-file-upload-FINAL.md)

Six phases: `apps/api` goes fully green — store and serve, limits, delete lifecycle — before
`apps/web` builds on any of it, so no frontend phase ever runs against a half-finished API.
Every `apps/api` phase follows the Red/Green/Refactor workflow in `apps/api/CLAUDE.md`, with
its mandatory security cases written before the implementation; every `apps/web` phase is
proven by a Playwright spec carrying its own mandatory security cases. Docs move with the
code: the phase that changes a module updates that module's doc under `docs/modules/`, the
JSDoc on the functions it touched, and — in `apps/api` — the Swagger annotations on the routes
and DTOs it touched. There is no trailing documentation phase.

## Phase 1. Store a meeting file and serve it back

**Goal**: a file uploaded to a meeting is stored, listed and downloaded byte-for-byte through
`apps/api`, and only ever by the owner of that meeting — the thinnest slice that proves the
whole path, before any limit, lifecycle or screen exists.
**Touches**: api · database
**Covers**: AC-1, AC-11, AC-15, AC-16, AC-17, AC-18
**Decisions**: D-1, D-3, D-4, D-7, D-9, D-11
**Threats**: S-1, S-2, S-5, S-6, S-7
**Tasks**:

- [ ] **1.1** Add the File model and its migration — one record per uploaded file, belonging
      to a meeting (and so, transitively, to its owner), holding the original name, size, type,
      upload time and wherever the bytes live. The migration is checked in and the Prisma
      module doc updated. Whether the bytes' location is a path, a key or something else is
      research's to settle.
- [ ] **1.2** Keep file bytes behind one storage boundary — a single seam owns writing,
      reading and deleting bytes; nothing else in `apps/api` touches storage or builds a
      location itself. The stored location is derived by the server and never taken from the
      upload, so a name carrying `/`, `\` or `..` can neither place nor fetch bytes outside its
      own meeting's location (AC-18). The root comes from `STORAGE_ROOT` and startup fails
      outside development when it is missing; the directory is created `0o700` and files
      written `0o600`, so no other account on the host can read them, and the development
      default is gitignored (S-5).
- [ ] **1.3** Accept an upload onto a meeting the caller owns — a guarded route takes one file
      for one meeting, stores its bytes, records it and answers with the new file's id and
      metadata. A meeting owned by someone else returns the same 404 as one that does not
      exist, matching `MeetingsService.findOneForOwner`'s existing behaviour — proven in a
      guard, before any byte of the body is read, so an upload onto a stranger's meeting costs
      nothing (S-1). The original name is reduced to its basename, stripped of control
      characters and bounded before it reaches the database (S-6).
- [ ] **1.4** List a meeting's files, owner-scoped — a guarded read returns each file's name,
      size, type and upload time for a meeting the caller owns, and the same 404 otherwise.
      This is the data AC-1's file list renders in phase 4. Every file query is keyed on the
      meeting and its owner together, never on the file id alone (S-2).
- [ ] **1.5** Serve a file's bytes to its owner only — a guarded read returns the stored bytes
      unchanged. No unauthenticated request, and no request from a signed-in non-owner, gets
      any part of a file or learns that it exists, and there is no route to the bytes that
      skips the ownership check. A file id is resolved in one compound lookup together with
      its meeting and that meeting's owner, so an id from another meeting answers 404 (S-2),
      and the response is marked `Cache-Control: private, no-store` instead of the `public`
      default the file sender would otherwise write (S-7).

**Done when**: `npm run test:e2e --workspace apps/api` is green with new cases in
`apps/api/test` covering upload →
list → download of byte-identical content, plus 404 parity for another owner's meeting and
file, a missing/malformed/expired token against every new route, and a name containing
traversal sequences storing and serving inside its own meeting only; Swagger at `/api` shows
the new routes and DTOs.

## Phase 2. Enforce the upload limits

**Goal**: every limit in the PRD holds at `apps/api` itself, so a request sent straight to the
API — bypassing any page — is refused on the same terms, and a refused or broken upload leaves
nothing behind.
**Touches**: api
**Covers**: AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
**Decisions**: D-2, D-3, D-5, D-11
**Threats**: S-3, S-9
**Tasks**:

- [ ] **2.1** Reject a file over 500 MB before storing bytes — the ceiling is enforced by
      `apps/api`, the response states the 500 MB limit, and neither bytes nor a record survive
      the refusal. Refusing before the whole body has been taken in is the point; how far the
      transfer is allowed to run first is set by the server's own request timeout, raised above
      Node's 300 s default so a 500 MB body is not cut off mid-transfer — paired with an
      inactivity timeout on the route, so a slow but steady transfer runs to the end while one
      that goes silent is dropped instead of holding a connection for the whole window (S-9).
- [ ] **2.2** Accept only the twelve listed file types — `mp4`, `webm`, `mov`, `mp3`, `wav`,
      `m4a`, `pdf`, `docx`, `txt`, `md`, `png`, `jpg` and nothing else, and the check trusts
      neither the extension nor the client's declared type, so a file renamed to an accepted
      extension is still refused. The response names the accepted types. `txt` and `md` are told
      apart from arbitrary bytes by D-2's text rule. The detector is ESM-only, so `apps/api`'s
      jest scripts run with `NODE_OPTIONS=--experimental-vm-modules` or the suite cannot load it.
- [ ] **2.3** Cap a meeting at 20 live files — an upload into a meeting already holding 20 live
      files is refused with the 20-file limit stated. Files sitting deleted-but-not-purged hold
      no slot, so freeing one lets the identical upload through immediately afterwards.
- [ ] **2.4** Cap an owner's stored bytes at 20 GB — an upload that would take the owner past
      20 GB across all their meetings is refused with the space remaining stated. The total
      counts deleted-but-not-purged files as well as live ones. The ceiling is reserved for
      the life of the request rather than only checked at commit, so concurrent uploads cannot
      together cross it or fill the disk Postgres shares (S-3).
- [ ] **2.5** Leave nothing stored when an upload breaks off — a request aborted by the client
      or cut short by a failure leaves no record, no bytes and nothing counted against either
      limit, so the retry in AC-9 always starts from a clean state.

**Done when**: `npm run test:e2e --workspace apps/api` is green with a case per refusal —
oversize, unaccepted type,
accepted extension on unaccepted content, the 21st live file, an over-quota upload, and a
request aborted mid-body — each asserting both the stated message and that nothing was stored;
deleting one file then re-sending the refused upload succeeds; Swagger shows the new error
responses.

## Phase 3. Soft delete, restore and purge

**Goal**: a file can be removed, brought back and finally purged with its bytes, so a wrong
upload is recoverable for 30 days and unrecoverable after them.
**Touches**: api · database
**Covers**: AC-7, AC-8, AC-12, AC-13, AC-14
**Decisions**: D-4, D-5, D-8
**Threats**: S-2
**Tasks**:

- [ ] **3.1** Soft-delete a file and stop serving it — a guarded delete marks the file deleted
      with a timestamp, drops it out of the meeting's live list and its live-file count, and
      makes its bytes unreachable — the same answer as a file that never existed — while the
      bytes themselves stay in storage and keep counting against the 20 GB total.
- [ ] **3.2** List a meeting's deleted files with time left — a guarded read returns each
      deleted-but-not-purged file of a meeting the caller owns, with when it was deleted and
      how long remains before it is purged.
- [ ] **3.3** Restore a deleted file — a guarded restore returns the file to the live list,
      serving its bytes again and holding a slot against the 20-file cap again. Restoring into
      a meeting already holding 20 live files is refused with the same 20-file message an
      upload gets (the user's ruling on the AC-7 / AC-13 tension — see Asked & assumed).
- [ ] **3.4** Purge files deleted more than 30 days ago — record and stored bytes both go, so
      nothing is left to list, serve or count against the 20 GB total, and a purged file is
      unrecoverable. It is provable by backdating a deleted file's deletion time. What triggers
      the purge on a single machine with no scheduler and only optional Redis is research's.

**Done when**: `npm run test:e2e --workspace apps/api` is green with cases for delete → absent
from the live list,
present in the deleted list with time remaining, and its bytes unreachable; restore → served
again and holding a slot; restore into a full meeting → refused with the limit stated; a
backdated deletion → record and bytes both gone and no longer counted; Swagger shows the
delete, restore and deleted-list routes.

## Phase 4. Meeting page with its file list

**Goal**: an owner can open a meeting from the dashboard, read it, see its files and download
one — the first phase anything is visible in a browser.
**Touches**: web
**Covers**: AC-1, AC-11, AC-15, AC-16, AC-17, AC-18
**Decisions**: D-6, D-7, D-10
**Threats**: S-4, S-7
**Tasks**:

- [ ] **4.1** Add the meeting page at /meetings/:id — a server-rendered, auth-gated page
      showing the meeting's title, description, date and participants, read-only. A signed-out
      visitor is redirected to `/login` before render, per `apps/web/CLAUDE.md`'s auth-gated
      rule, and a meeting the caller does not own renders exactly what a nonexistent id
      renders.
- [ ] **4.2** Link the dashboard's meeting rows to the page — every meeting row on `/` links to
      that meeting's own page, so it is reachable without typing a URL.
- [ ] **4.3** Show the meeting's files, or an empty state — one row per file with its name,
      size, type and upload time, or copy saying nothing has been uploaded yet. A file name
      containing HTML or script markup renders as literal text.
- [ ] **4.4** Download a listed file from the page — a control on each row hands back exactly
      the bytes that were uploaded, and only to the owner's own session; no URL the page
      exposes yields bytes to anyone else. The caching headers the API sets travel back
      unchanged (S-7).
- [ ] **4.5** Refuse an unauthenticated request at the proxy — the route that carries bytes
      between the browser and `apps/api` resolves the session first and answers 401 without
      opening an upstream request at all, and builds that request from an allow-list of
      headers, never forwarding the caller's own `Authorization` (S-4).

**Done when**: `npm run test:e2e:web` is green with a new spec covering the meeting's own
fields, the file list, the empty state, a download whose bytes match what was uploaded, the
signed-out redirect to `/login`, a direct request to the byte route with the session cookie
cleared answering 401 with no body, the not-found parity for another owner's meeting, and a
file name of script markup rendered as text. Files are seeded through `apps/api` directly, as
`e2e/home.spec.ts` already seeds meetings.

## Phase 5. Upload files from the meeting page

**Goal**: the owner can put files into a meeting from its own page, several at once, watching
each one and stopping or retrying any of them — the phase after which the feature is usable.
**Touches**: web
**Covers**: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
**Decisions**: D-5, D-6, D-10, D-11
**Threats**: S-4
**Tasks**:

- [ ] **5.1** Upload several selected files at once — selecting N files starts N independent
      transfers from the browser itself, each joining the file list as its own transfer
      finishes, with no page reload and still there after one. The browser has to prove the
      caller owns the meeting even though the session cookie is `httpOnly` and unreadable by
      page scripts, and a Server Action cannot report progress — the channel that resolves both
      is research's to choose, and may split this task. The upload route follows task 4.5's
      proxy rule: the session is resolved before anything is forwarded (S-4).
- [ ] **5.2** Show each file's own advancing progress — every row reports its own transfer as
      it runs, not only at the end: a 100 MB file shows at least three distinct intermediate
      percentages before completing.
- [ ] **5.3** Cancel one upload without disturbing the batch — a per-row cancel removes that
      row within two seconds and stops its transfer; the other rows of the same batch keep
      going, and nothing of the cancelled file is listed or retrievable after a reload.
- [ ] **5.4** Fail a broken upload with Retry and Dismiss — a connection or server failure
      leaves the row in a failed state naming the reason and offering Retry, which re-sends the
      whole file from the first byte and can succeed, and Dismiss. Nothing partial is listed,
      downloadable or counted in between.
- [ ] **5.5** State the limit when the API refuses a file — a refusal is shown on that file's
      own row in the API's own words — the 500 MB ceiling, the accepted types, the 20-file cap
      or the space remaining — and the other files of the batch keep uploading. A file over
      500 MB is caught before the transfer starts as well.

**Done when**: `npm run test:e2e:web` is green with a spec covering a multi-file selection whose
rows land independently and survive a reload, at least three distinct intermediate percentages
on a generated 100 MB file, a cancel that leaves the batch running and stores nothing, a failed
row whose Retry succeeds, and each of the four refusal messages.

## Phase 6. Play, preview and remove files in place

**Goal**: an uploaded file can be used and removed without leaving the meeting page — playback,
preview, delete into "Deleted files" and restore back out of it.
**Touches**: web
**Covers**: AC-10, AC-12, AC-13, AC-14
**Decisions**: D-7, D-8, D-10
**Threats**: S-8
**Tasks**:

- [ ] **6.1** Play video and audio inside the meeting page — an uploaded recording plays in
      place, without navigating away, and only for the owner's own session.
- [ ] **6.2** Render images and PDFs inside the page — an image or a PDF is shown in place;
      every other accepted type downloads instead of previewing.
- [ ] **6.3** Delete a file into "Deleted files" — a per-row delete moves the file out of the
      main list into a "Deleted files" area showing the time left before purge, frees a slot
      against the 20-file cap straight away, and leaves the file neither playable nor
      downloadable while it sits there.
- [ ] **6.4** Restore a file from "Deleted files" — a Restore control returns the file to the
      main list, playable and downloadable again and holding a slot again; a file whose 30 days
      have run out is not in the area at all.

**Done when**: `npm run test:e2e:web` is green with a spec covering in-page playback of video
and audio, in-page rendering of an image and a PDF, a non-previewable accepted type
downloading, delete → "Deleted files" with time remaining and a freed slot, restore → back in
the main list and downloadable, and a deletion backdated past 30 days absent from the area
entirely.

## Asked & assumed

- **Asked** — Which phase cut? → Backend complete, then frontend: six phases, `apps/api` fully
  green through phase 3 before `apps/web` starts. Chosen over interleaving the delete
  lifecycle after the upload UI (which would make the feature usable one phase sooner, at the
  cost of a stopping point where a wrong upload cannot be undone and the 20-file cap has no
  escape hatch) and over eight thinner phases (smaller PRs, but eight milestones and two
  stopping points shipping visibly half-finished UI).
- **Asked** — How does phase 5 prove AC-3's three intermediate percentages on a ≥100 MB file? →
  With a real 100 MB file generated by the Playwright spec and uploaded for real. Chosen over
  a small-file spec plus a manual 100 MB check, and over deferring the fixture to `research`.
- **Asked** — AC-7 caps a meeting at 20 live files and AC-13 restores a file into that count;
  what happens when the meeting already holds 20? → Refuse the restore with the same 20-file
  message an upload gets (task 3.3). Chosen over letting a restore exceed the cap, and over
  sending the tension back to `/bldprj:prd`.
- **Assumed** — Phase 4's specs seed files through `apps/api` directly, since the upload UI
  does not exist until phase 5 · this mirrors `e2e/home.spec.ts`'s existing `signInAs` +
  API-seeding pattern, so no new test machinery is implied.
- **Assumed** — No phase adds an update endpoint to `apps/api`'s meetings module · the PRD puts
  editing a meeting's own fields out of scope, so phase 4's page is read-only for them.
- **Assumed** — The existing `Meeting` → `User` ownership chain is the only ownership a file
  needs, so a file has no owner column of its own · if `research` finds the 20 GB per-user
  total (task 2.4) too costly to compute across that join, the model in task 1.1 gains a
  denormalised owner reference and 2.4's mechanism changes, not the phase order.
- **Assumed** — Phase 1's tracer takes one file per request · multi-file selection in task 5.1
  is N independent transfers, not one multi-file request, so nothing in phase 1 has to change
  for it.
- **Assumed** — "Deleted files" is a section of the meeting page, not a route of its own · the
  PRD puts a trash spanning all meetings out of scope, and task 6.3 renders it inline.

## Revisions

<!-- Written by the later stages — one line per change: what moved, and what caused it. -->

- 2026-08-16 — research: task **2.2** now also requires `NODE_OPTIONS=--experimental-vm-modules` on
  `apps/api`'s jest scripts — D-2, because the chosen type detector is ESM-only and cannot load
  under ts-jest without it; its open question about `txt`/`md` is answered by the same decision.
- 2026-08-16 — research: the "Done when" of phases 1–3 now names
  `npm run test:e2e --workspace apps/api` instead of `npm run test:api`, which runs the unit config
  (`rootDir: src`) and never sees `apps/api/test/*.e2e-spec.ts` — D-11. No task renumbered.
- 2026-08-16 — research: every phase gains its `**Decisions**` line — D-1 … D-11.
- 2026-08-16 — threats: added **4.5** (the byte proxy resolves the session before forwarding and
  builds the upstream request from a header allow-list) — S-4; task 5.1 carries the same rule for
  the upload route, and phase 4's "Done when" gains the signed-out 401 case.
- 2026-08-16 — threats: **1.2** gains `STORAGE_ROOT` failing startup outside development and
  `0o700`/`0o600` modes — S-5; **1.3** gains ownership proven in a guard before the body is read
  and a normalised, bounded filename — S-1, S-6; **1.4** and **1.5** gain the compound
  file-and-owner lookup — S-2; **1.5** also gains `Cache-Control: private, no-store` and **4.4**
  passes it through — S-7; **2.4** gains the reservation held for the life of the request — S-3.
  Written into the existing tasks rather than as new ones: phases 1, 2 and 5 already carry the
  five tasks a phase allows.
- 2026-08-16 — research round 2: **2.1** now names the raised request timeout, the answer to the
  question that task delegated to research — D-3, opened while pricing S-3's control.
- 2026-08-16 — threats round 2: **2.1** also carries an inactivity timeout, since the raised total
  timeout lets one credential hold six times as many requests open — S-9.
