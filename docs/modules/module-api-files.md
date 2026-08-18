# apps/api/src/files

Architecture and function reference for the meeting files module: store a meeting file and serve
it back, scoped to the meeting's owner and behind an abstract, backend-agnostic storage boundary,
with every PRD limit (size, detected type, live-file count, owner byte quota) enforced at the API
itself, plus soft delete, restore and a scheduled purge of the 30-day-expired ones. Part of the
`meeting-file-upload` feature — see `docs/archive/meeting-file-upload/` for the PRD, research and
threat model this module implements (phases 1–3:
`docs/archive/meeting-file-upload/meeting-file-upload-FINAL.md`).

Changes here follow the Red/Green/Refactor TDD workflow in `apps/api/CLAUDE.md`: confirm
`test/files.e2e-spec.ts` (and unit specs) are green before refactoring, then re-run after each step.

## Architecture

- `FilesModule` (`files.module.ts`) imports `AuthModule` (for `JwtAuthGuard`) and `MeetingsModule`
  (for `MeetingsService.findOneForOwner`, which `MeetingsModule` now exports), declares
  `FilesController` and `FilesService`, and binds the abstract `FileStorage` class as its own DI
  token to `LocalDiskFileStorage`: `{ provide: FileStorage, useClass: LocalDiskFileStorage }`.
- `FilesController` (`files.controller.ts`) is guarded at the class level with
  `@UseGuards(JwtAuthGuard, MeetingOwnerGuard)` — Nest runs guards in that order, so an unowned
  `:meetingId` is refused before `JwtAuthGuard`'s output is even needed by the handler, and (for the
  upload route) before `FileInterceptor` — an interceptor, which Nest runs after guards — reads any
  bytes off the request. Swagger-annotated (`@ApiTags('files')`, `@ApiBearerAuth()`, per-route
  `@ApiOperation`/response decorators); the upload route additionally carries `@ApiConsumes` and
  `@ApiBody` for its multipart schema, plus one `@Api*Response` per refusal status (`413`/`415`/
  `409`/`507`). Routes:
  - `POST /meetings/:meetingId/files` — `@Throttle({ default: { limit: 60, ttl: 60_000 } })`, a
    method-level `UploadSizeGuard` (declared-size + owner-quota reservation + idle timeout, all
    before `FileInterceptor` runs), `FileInterceptor('file', buildMulterOptions())`, a
    `MulterExceptionFilter` for the interceptor's own size abort, answers `201` with the file's DTO
    or one of `413`/`415`/`409`/`507` (see `FilesService.create`).
  - `GET /meetings/:meetingId/files` — lists the meeting's live files.
  - `GET /meetings/:meetingId/files/deleted` — lists the meeting's soft-deleted, not-yet-purged
    files, each carrying an absolute `purgeAt`.
  - `GET /meetings/:meetingId/files/:fileId/content` —
    `@Throttle({ default: { limit: 240, ttl: 60_000 } })`, streams the bytes via `res.sendFile`
    (`@Res()`, so this route bypasses Nest's normal response pipeline).
  - `DELETE /meetings/:meetingId/files/:fileId` — soft-deletes a live file, `204` on success (D-4).
  - `POST /meetings/:meetingId/files/:fileId/restore` — restores a soft-deleted, not-yet-purged
    file, `200` with its DTO, or `409` (the same message and check an upload gets) if the meeting
    is already at its 20-file cap (D-5).
- `FilesService` (`files.service.ts`) does the Prisma reads/writes and the `FileStorage.save` call;
  `UploadedDiskFile` is the shape multer's `diskStorage` hands the controller. `create` now sniffs
  the file's real type first (`FileTypeService`), then runs the live-file-count and owner-byte-total
  checks inside the same `$transaction` that creates the row — see Limit enforcement below.
- `FilesPurgeService` (`files-purge.service.ts`) — the scheduled purge (D-8): deletes every
  soft-deleted file past its 30-day retention window (bytes via `FileStorage.delete`, then its row)
  and sweeps `<STORAGE_ROOT>/tmp` of any leftover upload temp file older than 24 hours. Runs hourly
  via `@Cron(CronExpression.EVERY_HOUR)`; also a plain public method, callable directly (e.g. from a
  test, after backdating `deletedAt`) without waiting for a tick.
- `FileTypeService` (`file-type.service.ts`) — content-based type detection (D-2): `file-type`'s
  signature detection first, a text-content rule (`txt`/`md` only) as the fallback for the two
  extensions that carry no signature at all.
- `QuotaReservationService` (`quota-reservation.service.ts`) — the owner-byte-quota reservation
  S-3 needs: holds a declared upload's size against the owner's ceiling for the request's lifetime,
  in-process, serialized per owner so two concurrent uploads for the same owner can never both read
  the same pre-upload total (see Gotchas).
- `UploadSizeGuard` (`guards/upload-size.guard.ts`) — everything that must happen **before**
  `FileInterceptor` reads a byte: the declared-`Content-Length` ceiling check, the quota
  reservation, and arming the upload's inactivity timeout.
- `MulterExceptionFilter` (`filters/multer-exception.filter.ts`) — maps a `MulterError` (the
  streamed-size gate inside multer itself, `LIMIT_FILE_SIZE`) to the route's `413` shape and
  unlinks any temp file still present.
- `quota.ts` — `formatBytes`, `insufficientStorageMessage` and `InsufficientStorageException` (507
  isn't one of Nest's built-in HTTP exceptions), shared by the guard's pre-check and the service's
  in-transaction re-check so both name the remaining space the same way.
- `MeetingOwnerGuard` (`guards/meeting-owner.guard.ts`) resolves `:meetingId` through
  `MeetingsService.findOneForOwner`, reusing the meetings module's ownership rule and 404 parity
  rather than re-implementing it.
- `storage/file-storage.ts` — the abstract `FileStorage` class (`save`, `createReadStream`,
  `delete`, `stat`, `localPathFor`), used as its own Nest injection token so a future backend is one
  new class plus one line in `FilesModule`.
- `storage/local-disk-file-storage.ts` — the only implementation today. Root directory from
  `STORAGE_ROOT` (via `storage-root.ts`'s `resolveStorageRoot()`… except this class reads it through
  `ConfigService` directly, for DI-testability — see Gotchas). Creates the root and `<root>/tmp` at
  `onModuleInit` with mode `0o700`; commits a file with `fs.rename` (same filesystem as the temp
  dir, so this is atomic) followed by `chmod 0o600`.
- `storage/storage-root.ts` — `resolveStorageRoot()`, a plain function (not DI) that duplicates
  `LocalDiskFileStorage`'s `STORAGE_ROOT` defaulting logic against `process.env` directly. Used by
  `multer.config.ts`'s `destination` callback, which cannot receive `ConfigService` — see Gotchas.
- `multer.config.ts` — `buildMulterOptions()`, called once at `FilesController`'s decoration time.
- `files.constants.ts` — `MAX_FILE_BYTES` (500 MB), `PURGE_AFTER_MS` (30 days, used by `purgeAt` even
  though nothing sets `deletedAt` until phase 3), `MAX_FILE_NAME_LENGTH` (255),
  `MAX_LIVE_FILES_PER_MEETING` (20), `MAX_TOTAL_BYTES_PER_OWNER` (20 GB),
  `UPLOAD_IDLE_TIMEOUT_MS` (60 s, S-9 — see Limit enforcement), `TYPE_SNIFF_SAMPLE_BYTES` (4100,
  `file-type`'s own default sample size), `TEXT_FILE_EXTENSIONS` (`txt`/`md`), `ACCEPTED_MIME_TYPES`
  (the twelve accepted extension → MIME pairs) and the verbatim `413`/`415`/`409` message constants.
- `dto/meeting-file-response.dto.ts` — `MeetingFileResponseDto`, the one shape returned by every
  route (create, list, and — once phase 3 lands — delete/restore); never carries `storageKey` or a
  filesystem path.
- `content-disposition.d.ts` — a minimal ambient module declaration; the `content-disposition`
  package ships no types and has no `@types` package.
- Prisma `MeetingFile` model (`prisma/schema.prisma`): `meetingId` (FK to `Meeting`,
  `onDelete: Restrict`), `name` (`@db.VarChar(255)`), `size Int` (not `BigInt` — 500 MB fits, and
  `BigInt` breaks `JSON.stringify`), `mimeType` (`@db.VarChar(128)`), `storageKey` (`@unique`),
  `deletedAt DateTime?` (set by delete, cleared by restore, read by the purge job — phase 3).
  Indexed `@@index([meetingId, deletedAt])` and `@@index([deletedAt])`. `Meeting` gained
  `@@index([ownerId])` in the same migration — see
  `docs/modules/module-api-meetings.md`.

## Access control (non-obvious, worth preserving)

- **Guard order matters**: `MeetingOwnerGuard` runs after `JwtAuthGuard` but before the upload
  route's `FileInterceptor`, because Nest runs every guard before every interceptor regardless of
  declaration order — an interceptor is not a guard. Putting the ownership check anywhere else (a
  handler-level check, or relying on the interceptor to fail first) would let a signed-in stranger's
  upload body land on disk before the 404 is decided.
- **Every file lookup is a single compound query**, never a plain `findUnique({ where: { id } })`
  after a separate meeting check: `FilesService.findFileForOwner` filters on
  `{ id: fileId, meetingId, meeting: { ownerId }, deletedAt: null }` in one `findFirst` (live files —
  used by the content route and delete); `findDeletedFileForOwner` is the same shape with
  `deletedAt: { not: null, gt: purgeHorizon() }` (soft-deleted, not-yet-purged — used by restore),
  so a file id from another owner's meeting, presented under a meeting the caller does own, 404s on
  delete and restore exactly as it does on download (S-2) — a check-then-fetch split reintroduces
  that hole even though `MeetingOwnerGuard` already confirmed `:meetingId` itself belongs to the
  caller.
- **The file name is normalized, not rejected**: `path.basename()` strips any directory component,
  C0 control bytes are removed, and the result is truncated (not validated-and-400'd) to
  `MAX_FILE_NAME_LENGTH`. A traversal-shaped name (`../../etc/passwd`) is stored as its basename
  (`passwd`), never as an error.
- **`mimeType` is the content-sniffed type** (`FileTypeService.detect`), never the client's declared
  `Content-Type` or the file's extension — a PNG renamed `.pdf` is still stored (and served) as
  `image/png`; a file whose _content_ isn't one of the twelve accepted types is refused with `415`
  even under a renamed, accepted-looking extension (AC-6). Two extensions (`txt`, `md`) carry no
  byte signature at all, so they're accepted only via the text-content fallback (D-2): the sample
  must be valid UTF-8 with no NUL and no C0 control byte besides tab/LF/CR.
- **The byte route never passes an absolute path straight to `res.sendFile`**: `send`'s `dotfiles`
  check inspects every segment of whatever path it is given, and `STORAGE_ROOT`'s own `.data`
  segment would trip `dotfiles: 'deny'` on every single download. The route instead splits the
  resolved path into `root: dirname(localPath)` and a bare `basename(localPath)`, so only the
  storage key's own segments (always server-generated UUIDs) are checked.
- **`Cache-Control: private, no-store` is set explicitly** before `res.sendFile` runs — `send`
  writes `public, max-age=0` whenever the header is absent, which would mark one owner's private
  bytes storable by a shared cache.

## Limit enforcement (phase 2)

Every PRD limit is checked at `apps/api` itself — a request straight to the API, bypassing any
page, is refused on the same terms (D-3, D-5). Refusal order, first-to-last:

1. **Declared size** (`UploadSizeGuard`, before `FileInterceptor` runs) — a `Content-Length` over
   `MAX_FILE_BYTES` is `413` at zero bytes read. A chunked request that declares nothing reserves
   (and is checked against) `MAX_FILE_BYTES` as a stand-in, since Node delivers no more than a
   declared `Content-Length` on a non-chunked request.
2. **Owner-quota reservation** (`UploadSizeGuard` → `QuotaReservationService.reserve`, same guard,
   before streaming) — refused `507` if the declared size would cross `MAX_TOTAL_BYTES_PER_OWNER`
   alongside every other still-in-flight reservation for that owner (S-3). Released once the
   response finishes or the connection closes, whichever comes first.
3. **Streamed size** (multer's own `limits.fileSize`, inside `FileInterceptor`) — the defense-in-
   depth gate for gate 1's chunked-request fallback: multer aborts the moment its own counter
   crosses `MAX_FILE_BYTES` and removes what it had written; `MulterExceptionFilter` maps the
   resulting `MulterError('LIMIT_FILE_SIZE')` to the same `413` shape.
4. **Detected type** (`FileTypeService.detect`, in `FilesService.create`, before the transaction) —
   `415` if the sniffed content isn't one of the twelve accepted types.
5. **Live-file count** and **6. owner byte total** (both inside the one `$transaction` that creates
   the row) — `409`/`507` respectively; re-checked here (not just at the guard) so two concurrent
   uploads can't both pass the same pre-upload count/total. The byte total counts soft-deleted-but-
   not-purged files too (AC-8).

A refusal at any stage leaves no row and no bytes: gates 1–3 never reach `FilesService.create` at
all; gates 4–6 `rm` the temp file before throwing. `UPLOAD_IDLE_TIMEOUT_MS` (60 s, armed by
`UploadSizeGuard` via `request.setTimeout`) is a separate control (S-9): an **inactivity** timeout
that resets on every chunk received, closing a body that goes silent while a slow-but-steady
transfer runs to completion untouched — distinct from `main.ts`'s `requestTimeout` (30 min total,
raised from Node's 300 s default so a genuinely slow link isn't refused outright).

## Gotchas (non-obvious, worth preserving)

- **`STORAGE_ROOT` resolution is duplicated on purpose.** `LocalDiskFileStorage`'s constructor reads
  it via injected `ConfigService` (idiomatic, DI-testable — see its unit spec). `multer.config.ts`'s
  `destination` callback cannot use DI at all: `buildMulterOptions()` runs once, synchronously, when
  `FilesController` is decorated — which happens while `AppModule`'s own `imports` array (containing
  `ConfigModule.forRoot(...)`) is still being evaluated, i.e. before the root `.env` has been loaded.
  Reading `process.env.STORAGE_ROOT` at that point would see it unset even when `.env` does set it.
  The fix is deferral, not DI: the `destination` callback itself only runs per-request, long after
  bootstrap has finished, so `storage-root.ts`'s `resolveStorageRoot()` (a plain `process.env` read)
  is safe to call from inside it.
- **busboy's `limits.parts` counts the closing multipart boundary as its own "part".** A request
  carrying exactly one file and no other fields needs `parts: 2`, not the seemingly-obvious `1` —
  `1` makes busboy emit its `partsLimit` event on that single upload and multer answers `400`.
  Measured directly against this repo's busboy version; re-check if multer/busboy are upgraded.
- **The throttler is tracked by credential, not socket** (`app.module.ts`'s
  `ThrottlerModule.forRoot({ getTracker, throttlers: [...] })`): `sha256(Authorization header)` when
  present, else `req.ip`. Without it, every caller behind `apps/web`'s server-to-server proxy shares
  one IP-keyed bucket — a single multi-file upload batch would trip the shared limit for the whole
  installation. `APP_GUARD` guards run before controller guards, so `req.user` isn't set yet at
  throttle time; hashing the raw header also keeps the token itself out of throttler storage/logs.
- **`QuotaReservationService.reserve` serializes per owner, not globally.** A plain
  `await persistedTotal()` then `Map.set()` leaves a TOCTOU window: two concurrent reservations for
  the _same_ owner could both read the persisted total before either records its own declared
  bytes, letting both pass a ceiling only one of them should. `runExclusive` chains each owner's
  calls onto a private promise queue so the read-then-write never interleaves with another
  reservation for that owner; different owners are never serialized against each other.
- **`file-type` is ESM-only.** `FileTypeService` reaches it through `load-esm`'s `loadEsm()`
  (already a transitive dependency of `@nestjs/common`, the same path Nest's own built-in
  `FileTypeValidator` uses internally), which needs `NODE_OPTIONS=--experimental-vm-modules` —
  carried on both of `apps/api`'s `test` and `test:e2e` npm scripts, not just `test:e2e`.
- **`UploadSizeGuard` must run _before_ `FileInterceptor`, not inside the handler.** Nest runs every
  guard before every interceptor regardless of declaration order (same reasoning as
  `MeetingOwnerGuard` above) — this is what lets the declared-size check and the quota reservation
  both happen at zero bytes read, and lets `request.setTimeout` be armed before multer starts
  consuming the body rather than after it has already finished.

## Function reference

- `FilesController.upload(meetingId, file, user): Promise<MeetingFileResponseDto>` — `400` if no
  `file` part was sent; otherwise delegates to `filesService.create(meetingId, file, user.userId)`.
- `FilesController.list(meetingId, user): Promise<MeetingFileResponseDto[]>` — delegates to
  `filesService.listForOwner(meetingId, user.userId)`.
- `FilesController.content(meetingId, fileId, user, res): Promise<void>` — resolves the file via
  `filesService.findFileForOwner`, sets `Content-Type`/`X-Content-Type-Options`/`Cache-Control`/
  `Content-Disposition` (`inline` for `image/*`, `video/*`, `audio/*` and `application/pdf`;
  `attachment` otherwise), then `res.sendFile`.
- `FilesController.listDeleted(meetingId, user): Promise<MeetingFileResponseDto[]>` — delegates to
  `filesService.listDeletedForOwner(meetingId, user.userId)`.
- `FilesController.remove(meetingId, fileId, user): Promise<void>` — `204`; delegates to
  `filesService.delete(fileId, meetingId, user.userId)`.
- `FilesController.restore(meetingId, fileId, user): Promise<MeetingFileResponseDto>` — `200`;
  delegates to `filesService.restore(fileId, meetingId, user.userId)`.
- `FilesService.create(meetingId, file, ownerId): Promise<MeetingFileResponseDto>` — sniffs the
  file's type (`415` if unaccepted, temp file unlinked), then inside one `$transaction`: counts the
  meeting's live files (`409` if at `MAX_LIVE_FILES_PER_MEETING`), sums the owner's total
  (`507` — `InsufficientStorageException` — if this file would cross `MAX_TOTAL_BYTES_PER_OWNER`),
  creates the row. Commits the bytes via `FileStorage.save` after the transaction; any failure past
  the type check — transaction refusal or a `save` throw — unlinks the temp file (and, for a `save`
  failure, deletes the already-created row) so nothing is left behind (2.5).
- `FilesService.ownerTotal(tx, ownerId): Promise<number>` — private; sums stored size (live +
  soft-deleted) for `ownerId` through the caller's own transaction client, so it sees the same
  snapshot the live-file count did.
- `FilesService.listForOwner(meetingId, ownerId): Promise<MeetingFileResponseDto[]>` — live files
  only (`deletedAt: null`), newest first.
- `FilesService.findFileForOwner(fileId, meetingId, ownerId): Promise<MeetingFile>` — the compound
  lookup every live-file route uses (content, delete); throws `NotFoundException('File not found')`.
  Returns the full Prisma row (including `storageKey`), unlike the DTO-returning methods above.
- `FilesService.findDeletedFileForOwner(fileId, meetingId, ownerId): Promise<MeetingFile>` —
  private; the same compound shape as `findFileForOwner`, scoped instead to soft-deleted,
  not-yet-purged files (`deletedAt: { not: null, gt: purgeHorizon() }`); restore's only caller.
- `FilesService.delete(fileId, meetingId, ownerId): Promise<void>` — resolves the live file via
  `findFileForOwner`, then sets `deletedAt: new Date()`.
- `FilesService.restore(fileId, meetingId, ownerId): Promise<MeetingFileResponseDto>` — resolves
  the deleted file via `findDeletedFileForOwner`, then inside one `$transaction`: re-checks the
  meeting's live-file count (`409` — the same `ConflictException` and message an upload gets — if
  at `MAX_LIVE_FILES_PER_MEETING`), clears `deletedAt`.
- `FilesService.listDeletedForOwner(meetingId, ownerId): Promise<MeetingFileResponseDto[]>` —
  soft-deleted, not-yet-purged files (`deletedAt: { not: null, gt: purgeHorizon() }`), newest
  deletion first.
- `purgeHorizon(): Date` (`files.service.ts`, private) — `now - PURGE_AFTER_MS`; every read path
  that must treat an expired-but-not-yet-purged file as already gone computes it the same way
  `FilesPurgeService` computes its own purge cutoff (D-8).
- `FilesPurgeService.purgeExpired(): Promise<void>` — `@Cron`-scheduled hourly, also a plain public
  method: finds every `MeetingFile` with `deletedAt` past the 30-day horizon, deletes each one's
  bytes (`FileStorage.delete`) then its row, then sweeps `<STORAGE_ROOT>/tmp` of stale leftovers.
  Logs a count, never a filename.
- `FilesPurgeService.purgeStaleTempFiles(): Promise<number>` — private; removes any entry directly
  under `<STORAGE_ROOT>/tmp` (skipping `.gitkeep`) whose `mtime` is older than 24 hours; returns the
  count removed.
- `FileTypeService.detect(tempPath, declaredName): Promise<DetectedFileType | null>` — signature
  detection via `file-type`, falling back to the text-content rule (private `looksLikeText`) only
  for a declared `txt`/`md` extension when no signature was found at all.
- `QuotaReservationService.reserve(ownerId, declaredBytes): Promise<() => void>` — reserves
  `declaredBytes` against `ownerId`'s ceiling (persisted total + every other still-reserved amount
  for that owner), serialized per owner via `runExclusive`; throws `InsufficientStorageException` if
  reserving would cross the ceiling. Returns an idempotent `release` — call it exactly once.
- `UploadSizeGuard.canActivate(context): Promise<boolean>` — the declared-size check
  (`PayloadTooLargeException`), the quota reservation (released on the response's `finish`/`close`,
  whichever fires first), and arming `request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () =>
request.destroy())`.
- `MulterExceptionFilter.catch(exception, host): Promise<void>` — maps `MulterError('LIMIT_FILE_SIZE')`
  to `413` with the same message the guard uses; any other `MulterError` maps to `400`. Unlinks a
  temp file still referenced on the request, defensively (multer already removes what it wrote on
  this abort path).
- `MeetingOwnerGuard.canActivate(context): Promise<boolean>` — resolves `:meetingId` through
  `meetingsService.findOneForOwner`; throws (propagating `NotFoundException`) rather than returning
  `false` for an unowned or nonexistent meeting.
- `LocalDiskFileStorage.save(key, tempPath): Promise<void>` — `mkdir` the destination's parent
  (`0o700`), `rename` the temp file into place, `chmod 0o600`.
- `LocalDiskFileStorage.createReadStream(key, range?): Readable` / `.delete(key)` / `.stat(key)` /
  `.localPathFor(key): string` — thin wrappers over `fs`/`fs/promises`, all keyed through the same
  `pathFor(key)`.
- `resolveStorageRoot(): string` (`storage/storage-root.ts`) — see Gotchas.
- `buildMulterOptions(): MulterOptions` (`multer.config.ts`) — see Gotchas.

## DTOs

- `MeetingFileResponseDto` — `{ id, meetingId, name, size, mimeType, createdAt, deletedAt, purgeAt }`.
  `mimeType` is the content-sniffed type (`FileTypeService`), never the client's declared
  `Content-Type`. `deletedAt`/`purgeAt` are `null` for a live file; delete sets `deletedAt` and
  restore clears it again. `purgeAt` is computed as `deletedAt + PURGE_AFTER_MS`, an absolute
  timestamp rather than a countdown so a cached response can't drift.
