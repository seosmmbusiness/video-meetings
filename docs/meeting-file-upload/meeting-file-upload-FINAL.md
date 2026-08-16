# Final plan: Meeting file upload

**Key**: MFU
**PRD**: [meeting-file-upload-PRD.md](./meeting-file-upload-PRD.md)
**Plan**: [meeting-file-upload-PLAN.md](./meeting-file-upload-PLAN.md)
**Research**: [meeting-file-upload-RESEARCH.md](./meeting-file-upload-RESEARCH.md)
**Threats**: [meeting-file-upload-THREATS.md](./meeting-file-upload-THREATS.md)
**Date**: 2026-08-16
**Status**: ready for /bldprj:issues

## What ships

A meeting gets its own page at `/meetings/<id>`, reachable from the dashboard, where its owner —
and nobody else — uploads recordings and documents, watches each transfer, plays or previews what
landed, downloads it byte-for-byte, and deletes it with thirty days to change their mind. Twelve
file types, 500 MB per file, 20 live files per meeting, 20 GB per account including what is sitting
deleted. Every refusal says which limit it hit, in the API's own words, on that file's own row.

Bytes live on local disk behind an abstract storage class, so an S3 backend later is one more
implementation and nothing else. The browser never talks to the API directly: two same-origin
route handlers in `apps/web` attach the session token server-side, which is what keeps the cookie
`httpOnly` while still giving per-file progress and cancel.

Two limits the user should expect and neither the PRD nor the plan originally stated. A 500 MB
upload has to sustain about 14 Mbit/s, because the web server kills a request at 300 s and Next
exposes no way to raise it — a slower link ends in the failed row with Retry that AC-9 already
promises. And an upload that goes silent for a minute is dropped rather than left holding a
connection, which is what stops one account tying up the machine.

Nothing was cut. Two rulings were made here: the idle-timeout value was taken as written rather
than sent back for another research round (T-1), and the dashboard link finally got the criterion
it never had (T-2 → AC-19).

## Trace

| AC    | Phase | Tasks                   | Decisions | Findings      | Proven by                                                                                   |
| ----- | ----- | ----------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------- |
| AC-1  | 4     | 1.4, 4.1, 4.3           | D-4, D-10 | S-2           | web spec — the meeting's own fields, one row per file with name/size/type/time, empty state |
| AC-2  | 5     | 5.1                     | D-6, D-10 | S-4           | web spec — 3 files selected → 3 rows landing independently, all present after a reload      |
| AC-3  | 5     | 5.2                     | D-6, D-11 | —             | web spec — a generated 100 MB WAV reports ≥3 distinct intermediate percentages              |
| AC-4  | 5     | 2.5, 5.3                | D-3, D-6  | —             | web spec — cancel removes the row in under 2 s, the batch keeps running, reload is clean    |
| AC-5  | 2     | 2.1, 5.5                | D-3       | S-9           | api suite — 413 stating 500 MB and an empty `tmp`; web spec — the row shows that message    |
| AC-6  | 2     | 2.2, 5.5                | D-2       | —             | api suite — 415 on a PNG renamed `.pdf`, nothing stored; web spec — the batch keeps going   |
| AC-7  | 2     | 2.3, 3.1, 5.5           | D-4, D-5  | —             | api suite — the 21st upload → 409, then delete one and the identical upload returns 201     |
| AC-8  | 2     | 2.4, 3.1, 5.5           | D-5       | S-3           | api suite — 507 naming the space left, with deleted-not-purged bytes still counted          |
| AC-9  | 5     | 2.5, 5.4                | D-3, D-6  | —             | web spec — a failed row names the reason; Retry re-sends the whole file and succeeds        |
| AC-10 | 6     | 6.1, 6.2                | D-7       | S-8           | web spec — video and audio play in place, image and PDF render, a `docx` downloads          |
| AC-11 | 1     | 1.5, 4.4                | D-1, D-7  | S-7           | api suite — bytes byte-identical; web spec — the downloaded file matches what went up       |
| AC-12 | 3     | 3.1, 3.2, 6.3           | D-4, D-8  | —             | api suite — gone from the live list, in the deleted list with `purgeAt`, bytes 404          |
| AC-13 | 3     | 3.3, 6.4                | D-5       | —             | api suite — restore serves the bytes again and holds a slot; 409 into a full meeting        |
| AC-14 | 3     | 3.4, 6.4                | D-8       | —             | api suite — backdated `deletedAt` + `purgeExpired()` → row and bytes both gone              |
| AC-15 | 1     | 1.3, 1.4, 1.5, 4.1      | D-4       | S-2           | api suite — 404 parity on every route incl. a foreign `fileId`; web spec — the same page    |
| AC-16 | 1     | 1.3, 1.4, 1.5, 4.1, 4.5 | D-6       | S-4           | api suite — 401 on missing/malformed/expired; web spec — redirect, and the proxy's 401      |
| AC-17 | 1     | 1.2, 1.5, 4.4, 4.5      | D-1, D-7  | S-4, S-5, S-7 | api suite — no route to bytes without a session; unit spec — `0o700`/`0o600` on disk        |
| AC-18 | 1     | 1.2, 1.3, 4.3           | D-1, D-4  | S-6           | api suite — a traversal name stored as its basename; web spec — script markup as text       |
| AC-19 | 4     | 4.2                     | D-10      | —             | web spec — following a dashboard row lands on that meeting's `/meetings/<id>`               |

## Phase 1. Store a meeting file and serve it back

**Goal**: a file uploaded to a meeting is stored, listed and downloaded byte-for-byte through
`apps/api`, and only ever by the owner of that meeting — the thinnest slice that proves the whole
path, before any limit, lifecycle or screen exists.
**Touches**: api · database
**Covers**: AC-1, AC-11, AC-15, AC-16, AC-17, AC-18
**Decisions**: D-1, D-3, D-4, D-7, D-9, D-11
**Threats**: S-1, S-2, S-5, S-6, S-7
**Tasks**:

- [ ] **1.1** Add the MeetingFile model and its migration — model `MeetingFile` → table
      `meeting_files` (not `File`: that is a global in Node 24). Fields: `id` uuid, `meetingId` +
      relation to `Meeting` with `onDelete: Restrict`, `name` `@db.VarChar(255)`, `size Int`,
      `mimeType` `@db.VarChar(128)`, `storageKey` `@unique`, `createdAt`, `updatedAt`,
      `deletedAt DateTime?`. Indexes `@@index([meetingId, deletedAt])` and `@@index([deletedAt])`;
      `Meeting` gains `files MeetingFile[]` and the missing `@@index([ownerId])` the quota query
      needs. `size` is `Int` because 500 MB fits and `BigInt` breaks `JSON.stringify`. Migration
      checked in; `.claude/modules/module-api-prisma.md` updated. (D-4)
- [ ] **1.2** Keep file bytes behind one storage boundary — abstract class `FileStorage`
      (`apps/api/src/files/storage/file-storage.ts`) with `save(key, tempPath)`,
      `createReadStream(key, range?)`, `delete(key)`, `stat(key)` and `localPathFor(key)`, bound as
      `{ provide: FileStorage, useClass: LocalDiskFileStorage }`. Nothing else in `apps/api` touches
      storage or builds a location. Key: `meetings/<meetingId>/<fileId>`, both server-generated
      UUIDs, so a name carrying `/`, `\` or `..` can neither place nor fetch bytes outside its own
      meeting (AC-18). Root from `STORAGE_ROOT` — dev default `<repo>/.data/uploads`,
      `ConfigService.getOrThrow` outside development, as `DATABASE_URL` and `JWT_SECRET` already
      are; temp dir `<STORAGE_ROOT>/tmp` under the same root so committing is one same-filesystem
      `rename` (a cross-device one fails `EXDEV`). Directory created `{ recursive: true, mode: 0o700 }`,
      files written `0o600`; `/.data/` added to `.gitignore` and `STORAGE_ROOT` to `.env.example`.
      (D-1, S-5)
- [ ] **1.3** Accept an upload onto a meeting the caller owns — `POST /meetings/:meetingId/files`,
      multipart field `file`, `FileInterceptor` over a `diskStorage` writing to
      `<STORAGE_ROOT>/tmp` under a `randomUUID` filename, with
      `limits: { fileSize: 524_288_000, files: 1, fields: 0, parts: 1 }` and
      `defParamCharset: 'utf8'` — without that last one every Cyrillic filename arrives as
      mojibake. A `MeetingOwnerGuard` resolves the meeting through
      `MeetingsService.findOneForOwner(meetingId, userId)` (so `MeetingsModule` exports the service)
      and, being a guard, runs **before** the interceptor, so an upload onto a stranger's meeting is
      404 at zero bytes read (S-1). The name is `path.basename()`-ed, stripped of C0 control
      characters and bounded at 255 before insert (S-6). Answers 201 with
      `{ id, meetingId, name, size, mimeType, createdAt, deletedAt, purgeAt }`. Route throttle
      `@Throttle({ default: { limit: 60, ttl: 60_000 } })`, and `ThrottlerModule.forRoot` in
      `app.module.ts` gains `getTracker` = `sha256(req.headers.authorization)` when present else
      `req.ip` — without it every user shares one 20/60 s bucket behind the web proxy and a 20-file
      batch alone trips it (D-9). Swagger annotations on the route and both DTOs. (D-3, D-4, D-9,
      S-1, S-6)
- [ ] **1.4** List a meeting's files, owner-scoped — `GET /meetings/:meetingId/files` returns each
      live file's `name`, `size`, `mimeType` and `createdAt` for a meeting the caller owns, and the
      same 404 otherwise. Every file query goes through one
      `FilesService.findFileForOwner(fileId, meetingId, ownerId)` /
      `listForOwner(meetingId, ownerId)` keyed on `{ meetingId, meeting: { ownerId } }` and
      `deletedAt: null` — never on a file id alone (S-2). This is the data AC-1's list renders in
      phase 4. (D-4, S-2)
- [ ] **1.5** Serve a file's bytes to its owner only — `GET /meetings/:meetingId/files/:fileId/content`.
      One compound lookup, `findFirst({ where: { id: fileId, meetingId, meeting: { ownerId } } })`,
      so a file id from another meeting answers 404 (S-2). Then set `Content-Type` from the stored
      `mimeType`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` — `send`
      writes `public, max-age=0` if the header is absent (S-7) — and `Content-Disposition` via the
      `content-disposition` encoder: `inline` for `image/*`, `application/pdf`, `video/*` and
      `audio/*`, `attachment` for everything else. Hand off with
      `res.sendFile(localPathFor(key), { acceptRanges: true, dotfiles: 'deny' })`, which answers
      `Range` with 206 so a 500 MB recording seeks; when `localPathFor` returns `null` fall back to
      `createReadStream(key, range)` with a hand-written 206. Throttle
      `@Throttle({ default: { limit: 240, ttl: 60_000 } })`. (D-7, S-2, S-7)

**Done when**: `npm run test:e2e --workspace apps/api` is green with new cases in `apps/api/test`
covering upload → list → download of byte-identical content; `POST` to another owner's meeting
answering 404 **and** leaving `<STORAGE_ROOT>/tmp` empty (S-1); a `fileId` from another owner's
meeting under a meeting the caller does own answering 404 on both the metadata and the byte route,
in a test where the caller's own file in that meeting still reads back (S-2); a missing, malformed
and expired token each answering 401 on every new route; a name of `../../etc/passwd` stored under
its own meeting's key as a basename (S-6, AC-18); the byte route's `cache-control` containing
`private` and never `public` (S-7); plus a unit spec asserting the storage directory is `0o700`,
its files `0o600`, and that `LocalDiskFileStorage` throws at construction when `STORAGE_ROOT` is
absent with `NODE_ENV=production` (S-5). Swagger at `/api` shows the new routes and DTOs.

## Phase 2. Enforce the upload limits

**Goal**: every limit in the PRD holds at `apps/api` itself, so a request sent straight to the API —
bypassing any page — is refused on the same terms, and a refused or broken upload leaves nothing
behind.
**Touches**: api
**Covers**: AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
**Decisions**: D-2, D-3, D-5, D-11
**Threats**: S-3, S-9
**Tasks**:

- [ ] **2.1** Reject a file over 500 MB before storing bytes — two gates. A guard refuses a declared
      `Content-Length` above `524_288_000` at zero bytes read; multer's `limits.fileSize` aborts the
      stream the moment the counter crosses it and calls `removeUploadedFiles` on what it wrote, so
      at most the ceiling plus one busboy chunk ever touches disk. A `MulterExceptionFilter` maps
      `LIMIT_FILE_SIZE` to **413** with `File exceeds the 500 MB per-file limit.` and unlinks any
      temp file still present. How far a transfer may run is now stated, not left open: in
      `main.ts`, before `app.listen()`, `app.getHttpServer().requestTimeout = 1_800_000` (Node's
      default is 300 000 ms, which caps a 500 MB body at ~14 Mbit/s), with `headersTimeout` left at
      its 60 s default; and the upload route sets `req.setTimeout(60_000)`, an **inactivity**
      timeout, so a slow but steady transfer runs its full window while one that goes silent is
      dropped rather than held open (S-9, T-1). (D-3, S-9)
- [ ] **2.2** Accept only the twelve listed file types — `mp4`, `webm`, `mov`, `mp3`, `wav`, `m4a`,
      `pdf`, `docx`, `txt`, `md`, `png`, `jpg`, matched on content rather than on the extension or
      the client's `Content-Type`, so a PNG renamed `.pdf` is still refused. `file-type@21.3.4` —
      already a direct dependency of `@nestjs/common@11.1.28`, nothing to install — reached through
      `loadEsm` and called as `fileTypeFromFile(tempPath)`, which reads only the first 4100 bytes.
      It detects ten of the twelve; `txt` and `md` carry no signature and are accepted only when
      file-type detects nothing, the extension is `txt`/`md`, and the first 4100 bytes are valid
      UTF-8 with no NUL and no C0 control byte besides tab/LF/CR. Refusal is **415** with
      `Unsupported file type. Accepted types: mp4, webm, mov, mp3, wav, m4a, pdf, docx, txt, md, png, jpg.`
      The detector is ESM-only, so `apps/api`'s `test` and `test:e2e` scripts must run with
      `NODE_OPTIONS=--experimental-vm-modules` or the suite cannot load it at all. (D-2, D-11)
- [ ] **2.3** Cap a meeting at 20 live files — an upload into a meeting already holding 20 live
      files is refused **409** `This meeting already holds 20 files. Delete one to upload another.`
      Deleted-but-not-purged files hold no slot, so freeing one lets the identical upload through
      immediately afterwards. The count is re-taken inside the same `$transaction` that creates the
      row, so two concurrent uploads cannot both pass it. (D-5)
- [ ] **2.4** Cap an owner's stored bytes at 20 GB — an upload that would take the owner past
      `21_474_836_480` bytes across all their meetings is refused **507**
      `Not enough space: <remaining> of the 20 GB total remains.`, counting deleted-but-not-purged
      files as well as live ones, via
      `aggregate({ _sum: { size: true }, where: { meeting: { ownerId } } })`. The ceiling is
      **reserved for the life of the request**, not only checked at commit: the declared
      `Content-Length` (or `MAX_FILE_BYTES` when the request is chunked and declares nothing) is
      added to the owner's total before the body is streamed and released in a `finally`, so
      concurrent uploads cannot together cross it or fill the disk Postgres shares. Under-declaring
      cannot beat it — Node delivers no more than `Content-Length` bytes on a non-chunked request.
      (D-5, S-3)
- [ ] **2.5** Leave nothing stored when an upload breaks off — a request aborted by the client or
      cut short by a failure leaves no record, no bytes and nothing counted against either limit.
      multer already removes its own temp file on `req.on('aborted')` and on a limit abort; the
      ordering does the rest — the row is created inside the transaction and the bytes are committed
      by `FileStorage.save` after it, with the row deleted and the temp file unlinked if the commit
      throws. So the retry in AC-9 always starts from a clean state. (D-3, D-5)

**Done when**: `npm run test:e2e --workspace apps/api` is green with a case per refusal — a file
over 500 MB → 413 with the message and an empty `tmp`; an unaccepted type → 415 naming the accepted
types; a PNG renamed `.pdf` → 415; the 21st live file → 409; an over-quota upload → 507 naming the
space left; a request aborted mid-body → nothing stored and nothing counted — each asserting both
the stated message and that no row and no bytes survive. Deleting one file then re-sending the
refused upload succeeds. Concurrent uploads whose declared sizes together cross the 20 GB ceiling
are refused after the first (S-3), and an upload that stops sending mid-body is closed inside the
60 s idle window while one sending steadily at a lower rate still completes (S-9). Swagger shows
the new error responses.

## Phase 3. Soft delete, restore and purge

**Goal**: a file can be removed, brought back and finally purged with its bytes, so a wrong upload
is recoverable for 30 days and unrecoverable after them.
**Touches**: api · database
**Covers**: AC-7, AC-8, AC-12, AC-13, AC-14
**Decisions**: D-4, D-5, D-8
**Threats**: S-2
**Tasks**:

- [ ] **3.1** Soft-delete a file and stop serving it — `DELETE /meetings/:meetingId/files/:fileId`
      answers 204, sets `deletedAt`, drops the file out of the live list and the live-file count,
      and makes its bytes answer the same 404 as a file that never existed, while the bytes stay in
      storage and keep counting against the 20 GB total. Resolved through the same compound lookup
      as 1.5, so a foreign `fileId` is 404 rather than someone else's deletion (S-2). (D-4, S-2)
- [ ] **3.2** List a meeting's deleted files with time left — `GET /meetings/:meetingId/files/deleted`
      returns each deleted-but-not-purged file of a meeting the caller owns with `deletedAt` and
      `purgeAt`, an absolute ISO timestamp rather than a countdown, so a cached response cannot
      drift. The query filters on the horizon as well as on `deletedAt`, so a file past its 30 days
      is absent the instant it expires, whatever the cron last did. (D-4, D-8)
- [ ] **3.3** Restore a deleted file — `POST /meetings/:meetingId/files/:fileId/restore` clears
      `deletedAt`, returning the file to the live list, serving its bytes again and holding a slot
      against the 20-file cap again. Restoring into a meeting already holding 20 live files is
      refused with the same 409 message an upload gets — the user's ruling on the AC-7 / AC-13
      tension. (D-5)
- [ ] **3.4** Purge files deleted more than 30 days ago — `FilesPurgeService.purgeExpired()` selects
      rows with `deletedAt < now − 2_592_000_000 ms`, deletes the bytes then the row per file, and
      also removes anything older than `86_400_000 ms` left in `<STORAGE_ROOT>/tmp`. It is triggered
      by `@Cron(CronExpression.EVERY_HOUR)` from `@nestjs/schedule@6.1.3`, installed for this and
      registered as `ScheduleModule.forRoot()` in `app.module.ts`. It is a plain public method, so
      the e2e spec calls it directly after backdating `deletedAt` through `app.get(PrismaService)` —
      no waiting for a tick. Logs a count, never a filename. (D-8)

**Done when**: `npm run test:e2e --workspace apps/api` is green with cases for delete → absent from
the live list, present in the deleted list with `purgeAt`, and its bytes answering 404 while still
counted against the 20 GB total; restore → served again and holding a slot; restore into a full
meeting → 409 with the same message an upload gets; a backdated `deletedAt` plus `purgeExpired()` →
row and bytes both gone, not listed, not served, not counted; and a foreign `fileId` answering 404
on delete and on restore (S-2). Swagger shows the delete, restore and deleted-list routes.

## Phase 4. Meeting page with its file list

**Goal**: an owner can open a meeting from the dashboard, read it, see its files and download one —
the first phase anything is visible in a browser.
**Touches**: web
**Covers**: AC-1, AC-11, AC-15, AC-16, AC-17, AC-18, AC-19
**Decisions**: D-6, D-7, D-10
**Threats**: S-4, S-7
**Tasks**:

- [ ] **4.1** Add the meeting page at /meetings/:id — a Server Component at
      `apps/web/src/app/meetings/[id]/page.tsx` showing the meeting's title, description, date and
      participants, read-only. `getSession()` is checked first and `redirect('/login')` runs before
      any JSX when there is no session, per `apps/web/CLAUDE.md`'s auth-gated rule; a meeting the
      caller does not own renders exactly what a nonexistent id renders. Data comes from a new
      server-only `apps/web/src/lib/files-api.ts`, shaped like `meetings-api.ts`. (D-10)
- [ ] **4.2** Link the dashboard's meeting rows to the page — every meeting row on `/` becomes a
      link to that meeting's own page, so it is reachable without typing a URL (AC-19). (D-10)
- [ ] **4.3** Show the meeting's files, or an empty state — one row per file with its name, size,
      type and upload time, or copy saying nothing has been uploaded yet. Names render as React
      children, never through `dangerouslySetInnerHTML`, so a name of HTML or script markup is
      literal text (AC-18). (D-10)
- [ ] **4.4** Download a listed file from the page — a control on each row hands back exactly the
      bytes that were uploaded, and only to the owner's own session; no URL the page exposes yields
      bytes to anyone else. The proxy returns the upstream `status`, `content-type`,
      `content-length`, `content-disposition`, `accept-ranges`, `content-range` and — unchanged —
      `cache-control`, so the `private, no-store` phase 1 set survives the hop (S-7). (D-7, S-7)
- [ ] **4.5** Refuse an unauthenticated request at the proxy — the byte route at
      `apps/web/src/app/api/meetings/[meetingId]/files/[fileId]/content/route.ts` (Next 16 hands
      `params` as a Promise) calls `getSession()` first and returns 401 without opening an upstream
      request at all. The upstream request is built from an allow-list — method, body,
      `content-type`, `content-length`, `range` — with the token attached server-side; the caller's
      own `Authorization` is never forwarded, and ids go into the path through `encodeURIComponent`,
      never into the host (S-4). (D-6, S-4)

**Done when**: `npm run test:e2e:web` is green with a new spec covering the meeting's own fields,
the file list, the empty state, a download whose bytes match what was uploaded, the signed-out
redirect to `/login`, a direct request to the byte route with the session cookie cleared answering
401 with no body and one carrying its own `Authorization` header changing nothing (S-4), the
not-found parity for another owner's meeting, a file name of script markup rendered as text, a
`cache-control` of `private` on the proxied response (S-7), and a click on a dashboard row landing
on that meeting's page (AC-19). Files are seeded through `apps/api` directly, as `e2e/home.spec.ts`
already seeds meetings.

## Phase 5. Upload files from the meeting page

**Goal**: the owner can put files into a meeting from its own page, several at once, watching each
one and stopping or retrying any of them — the phase after which the feature is usable.
**Touches**: web
**Covers**: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
**Decisions**: D-5, D-6, D-10, D-11
**Threats**: S-4
**Tasks**:

- [ ] **5.1** Upload several selected files at once — selecting N files starts N independent
      `XMLHttpRequest` transfers, one file per request, against a same-origin route handler at
      `apps/web/src/app/api/meetings/[meetingId]/files/route.ts`, which resolves the session first
      (401 without forwarding, task 4.5's rule — S-4), attaches the bearer token server-side and
      streams the body onward with `fetch(url, { body: request.body, duplex: 'half' })`, forwarding
      the browser's own `content-length`. A Server Action cannot do this: its body is capped at 1 MB
      and it cannot report progress. Each row joins the list as its own transfer finishes, via
      `useRouter().refresh()` — `refresh()` from `next/cache` is Server-Action-only in Next 16 — so
      the server-rendered list is re-read with no page reload, and the files are still there after
      one. (D-6, D-10, S-4)
- [ ] **5.2** Show each file's own advancing progress — every row reports its own transfer from
      `xhr.upload.onprogress`, the only browser API that reports upload progress, not only at the
      end: a 100 MB file shows at least three distinct intermediate percentages before completing.
      The spec's fixture must be a **valid** file of an accepted type — a 100 MB block of zeros is
      refused by phase 2 before any progress can be seen — so it generates a 100 MB WAV (44-byte
      RIFF/WAVE header plus silence) into the OS temp directory, uploads it with
      `setInputFiles(path)`, and removes it afterwards. (D-6, D-11)
- [ ] **5.3** Cancel one upload without disturbing the batch — a per-row cancel calls `xhr.abort()`,
      removes that row within two seconds and stops its transfer; the other rows of the same batch
      keep going, and nothing of the cancelled file is listed or retrievable after a reload — the
      broken body stream tears down the upstream request, and multer removes what it had written.
      (D-6)
- [ ] **5.4** Fail a broken upload with Retry and Dismiss — a connection or server failure leaves
      the row in a failed state naming the reason and offering Retry, which re-sends the whole file
      from the first byte and can succeed, and Dismiss. Nothing partial is listed, downloadable or
      counted in between. (D-6)
- [ ] **5.5** State the limit when the API refuses a file — the proxy passes the upstream status and
      JSON body through unchanged, and the row shows the API's own words — the 500 MB message
      (413), the accepted-type list (415), the 20-file message (409) or the remaining-space message
      (507), each verbatim as tasks 2.1 to 2.4 define them. The other files of the batch keep
      uploading. A file over 500 MB is caught in the browser before the transfer starts as well.
      (D-5, D-6)

**Done when**: `npm run test:e2e:web` is green with a spec covering a multi-file selection whose
rows land independently and survive a reload, at least three distinct intermediate percentages on
the generated 100 MB WAV, a cancel that removes its row within 2 s while the batch keeps running
and stores nothing, a failed row whose Retry succeeds, and each of the four refusal messages shown
verbatim on the offending row while the rest of the batch continues.

## Phase 6. Play, preview and remove files in place

**Goal**: an uploaded file can be used and removed without leaving the meeting page — playback,
preview, delete into "Deleted files" and restore back out of it.
**Touches**: web
**Covers**: AC-10, AC-12, AC-13, AC-14
**Decisions**: D-7, D-8, D-10
**Threats**: S-8
**Tasks**:

- [ ] **6.1** Play video and audio inside the meeting page — a `<video>`/`<audio>` element pointed at
      the same-origin byte route, which the browser reaches with the session cookie it cannot read;
      `Range` and 206 come from phase 1, so a long recording seeks. Plays in place, without
      navigating away, and only for the owner's own session. (D-7, D-10)
- [ ] **6.2** Render images and PDFs inside the page — an image or a PDF is shown in place, both
      served `inline`; every other accepted type downloads instead, because `inline` is granted only
      to `image/*`, `application/pdf`, `video/*` and `audio/*`. A PDF still runs its own JavaScript
      in the browser's viewer — accepted by the user on 2026-08-16 (S-8), not closed here. (D-7, S-8)
- [ ] **6.3** Delete a file into "Deleted files" — a per-row delete calls a Server Action against
      phase 3's route (small payload, no progress, so `refresh()` from `next/cache` applies), moving
      the file out of the main list into a "Deleted files" section of the same page showing the time
      left computed from `purgeAt`, freeing a slot against the 20-file cap straight away and leaving
      the file neither playable nor downloadable while it sits there. (D-8, D-10)
- [ ] **6.4** Restore a file from "Deleted files" — a Restore control returns the file to the main
      list, playable and downloadable again and holding a slot again; a file whose 30 days have run
      out is not in the section at all, because phase 3's list filters on the horizon rather than on
      when the cron last ran. (D-8, D-10)

**Done when**: `npm run test:e2e:web` is green with a spec covering in-page playback of video and
audio, in-page rendering of an image and a PDF, a non-previewable accepted type downloading instead,
delete → "Deleted files" with the time remaining and a freed slot and the file no longer
downloadable, restore → back in the main list and downloadable, and a deletion backdated past 30
days absent from the section entirely.

## Checks

- **Numbers** — consistent: 500 MB / 20 files / 20 GB / 30 days read the same in the PRD, in the
  research Parameters table and inside every control, on the binary reading the research recorded
  (`524_288_000`, `21_474_836_480`, `2_592_000_000`). One value had no Parameters row —
  `UPLOAD_IDLE_TIMEOUT_MS` — and became **T-1**.
- **Mechanism against promise** — consistent: `XMLHttpRequest` produces AC-3's intermediate
  percentages where `fetch` cannot; `res.sendFile` produces AC-10's seekable playback where
  `StreamableFile` cannot; `file-type` produces AC-6's renamed-extension refusal; the cron plus the
  horizon predicate produces AC-14 at any instant, not only after a tick.
- **Control against scenario** — consistent, with two notes recorded rather than ruled: S-6's
  255-character bound is unreachable from a real file picker, since every common filesystem caps a
  path component at 255 itself, so the extra 400 it can produce is only reachable from a crafted
  request; and S-9's idle timeout ends a stalled upload in AC-9's failed row with Retry, which is
  the behaviour the PRD already promises for an interrupted transfer.
- **Missing work** — three gaps closed in FINAL rather than by a ruling: D-9's throttler tracker had
  no task and is now in 1.3 (without it a 20-file batch trips the 20/60 s bucket and AC-2 fails);
  `@nestjs/schedule`'s install and `ScheduleModule.forRoot()` had no task and are now in 3.4;
  `MeetingsModule` exporting `MeetingsService`, `.env.example` and `.gitignore` are named in 1.2 and
  1.3. D-11's `test/fixtures/` docx is named in 2.2.
- **Stale citations** — consistent after cleanup: no block in either RESEARCH or THREATS carries
  `**Superseded by**`, no task is `- [~]`, and every `D-1…D-11` and `S-1…S-9` is cited by a phase
  here. Three tasks still delegated a settled question to research (1.1 "whether the location is a
  path or a key", 3.4 "what triggers the purge", 5.1 "the channel is research's to choose") and now
  state the answer instead.
- **Order** — consistent: the API is complete through phase 3 before any web phase; `STORAGE_ROOT`
  lands in 1.2 before anything reads it; the throttler tracker lands in 1.3, before phase 5's batch
  needs it; 4.5's proxy rule lands before 5.1 reuses it; phase 6 consumes phase 3's routes.
- **Phase integrity** — consistent: 5 / 5 / 4 / 5 / 5 / 4 live tasks, none over the five a phase
  allows; one layer per phase; every phase leaves the repo working.
- **Unproven control** — was the weakest class and is now closed: S-1, S-2, S-5, S-6, S-7 gained
  explicit cases in phase 1's **Done when**, S-3 and S-9 in phase 2's, S-2's delete/restore case in
  phase 3's, S-4's two cases in phase 4's. S-8 is accepted, so it has no test by design.
- **Silence** — consistent: every "not verified" in the research (the 100 MB Playwright fixture,
  Prisma's `_sum` typing) carries a fallback, every risk has one, every finding has a disposition,
  and no task now leaves its mechanism open.

## Rulings

| Id  | Conflict                                                                             | Sides               | Ruling                                                   | Costs                                                                                 | Recorded in                       |
| --- | ------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| T-1 | S-9's control needs `UPLOAD_IDLE_TIMEOUT_MS`, which no research Parameters row holds | S-9 vs the research | Take `60_000` as written here rather than open a round 3 | The value ships without a research source line; `research` should adopt the row later | This file, task 2.1 · THREATS S-9 |
| T-2 | Task 4.2 was promised by the PRD's scope and an assumption, but by no `AC-<n>`       | the plan vs the PRD | Add **AC-19** for the dashboard link                     | One line in the PRD; phase 4 covers it and 4.2 already builds it                      | PRD AC-19 and its Asked & assumed |

## Deltas from the plan

- 1.1 — names the model `MeetingFile`, its columns, indexes and the `Meeting` index the quota needs;
  drops "research's to settle" — D-4.
- 1.2 — carries the `FileStorage` signature, the key layout, `STORAGE_ROOT`'s dev default and
  production `getOrThrow`, the `0o700`/`0o600` modes, `.gitignore` and `.env.example` — D-1, S-5.
- 1.3 — adds the multer options, the `MeetingOwnerGuard`, the response DTO, the route throttle and
  **D-9's `getTracker`, which no task carried** — D-3, D-9, S-1, S-6.
- 1.4, 1.5 — name the compound lookup, the byte-serving headers and `res.sendFile`'s options — D-7,
  S-2, S-7.
- 2.1 — adds the status code, the message, `requestTimeout = 1_800_000` and
  `req.setTimeout(60_000)` — D-3, S-9, **T-1**.
- 2.2 — names `file-type@21.3.4`, the text rule, the 415 message and the Jest flag — D-2, D-11.
- 2.3, 2.4 — add the 409 and 507 messages, the aggregate, and the reservation held for the life of
  the request — D-5, S-3.
- 2.5 — names the ordering that makes "nothing survives" true — D-3, D-5.
- 3.1–3.4 — add the routes, `purgeAt`, the horizon predicate, `@nestjs/schedule` and its
  registration; 3.4 drops "research's" — D-4, D-5, D-8.
- 4.1–4.5 — name the files, the proxy's header allow-list and Next 16's async `params`; phase 4
  gains **AC-19** on its **Covers** — D-6, D-7, D-10, S-4, S-7, **T-2**.
- 5.1–5.5 — name `XMLHttpRequest`, `duplex: 'half'`, `useRouter().refresh()`, the valid-WAV fixture
  and the four refusal messages verbatim; 5.1 drops "may split this task" — D-5, D-6, D-10, D-11.
- 6.1–6.4 — name the elements, the inline allow-list, the Server Action path and the horizon — D-7,
  D-8, D-10, S-8.
- Every phase's **Done when** now names the command and the result it must give, including a case
  per security finding.

## Residual risk

- **A 500 MB upload needs ~14 Mbit/s.** Node's `requestTimeout` is 300 s and Next 16.2.12 neither
  sets it nor exposes it, so the proxy leg cannot be raised the way `apps/api` can. Accepted by the
  user on 2026-08-16; a slower link ends in AC-9's failed row. Lifting it means a custom Next server
  or a reverse proxy — both change how the app is run, and both are out of this iteration.
- **A PDF runs its own JavaScript in the browser's viewer** when previewed inline, which AC-10
  requires. Accepted 2026-08-16 (S-8). Held down by `inline` being limited to four media families,
  `nosniff`, and the type coming from the detected signature.
- **`UPLOAD_IDLE_TIMEOUT_MS = 60_000` ships without a research source line** (T-1). If a real client
  can legitimately pause longer than a minute mid-transfer, the value rises and the user sees AC-9's
  failed row instead.
- **The reservation and the purge timer are in-process**, which is sound only on the single machine
  the PRD describes. A second instance makes both per-instance, and Redis — optional by project rule
  — cannot be the shared counter.
- **The per-credential throttle is escapable by logging in again**, so it bounds convenience rather
  than a determined caller; what actually bounds spend is the quota, the reservation and the idle
  timeout.
- Nothing was handed to `/bldprj:prd` or `/bldprj:refactor-prd`: no capability left this iteration.

## Asked & assumed

- **Asked** — S-9's control needs a number the research Parameters table does not hold; take it here,
  send it back for a third research round, or drop the control? → Take `60_000` as written, as a
  ruling (T-1).
- **Asked** — task 4.2 was promised by scope and by an assumption but by no criterion, so close-out
  could not prove it; add one? → Yes, **AC-19** (T-2).
- **Assumed** — the binary reading of "500 MB" and "20 GB" the research recorded is what the PRD
  meant · if they are decimal, three values in phase 2 change and nothing else does.
- **Assumed** — a 20-file batch is 20 requests, so AC-2 needs the throttler tracker in 1.3 to land
  before phase 5 · without it the batch trips the shared bucket and AC-2 fails for reasons that look
  like a frontend bug.
- **Assumed** — `apps/api`'s e2e suite is the API's proof and Playwright the web's, per each app's
  CLAUDE.md · every **Done when** above names one of the two commands, and nothing is proven by
  inspection.
