# apps/api/src/files

Architecture and function reference for the meeting files module: store a meeting file and serve
it back, scoped to the meeting's owner and behind an abstract, backend-agnostic storage boundary.
Part of the `meeting-file-upload` feature — see `docs/meeting-file-upload/` for the PRD, research
and threat model this module implements (phase 1: `docs/meeting-file-upload/meeting-file-upload-FINAL.md`).

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
  `@ApiBody` for its multipart schema. Routes:
  - `POST /meetings/:meetingId/files` — `@Throttle({ default: { limit: 60, ttl: 60_000 } })`,
    `FileInterceptor('file', buildMulterOptions())`, answers `201` with the file's DTO.
  - `GET /meetings/:meetingId/files` — lists the meeting's live files.
  - `GET /meetings/:meetingId/files/:fileId/content` —
    `@Throttle({ default: { limit: 240, ttl: 60_000 } })`, streams the bytes via `res.sendFile`
    (`@Res()`, so this route bypasses Nest's normal response pipeline).
- `FilesService` (`files.service.ts`) does the Prisma reads/writes and the `FileStorage.save` call;
  `UploadedDiskFile` is the shape multer's `diskStorage` hands the controller.
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
  though nothing sets `deletedAt` until phase 3), `MAX_FILE_NAME_LENGTH` (255).
- `dto/meeting-file-response.dto.ts` — `MeetingFileResponseDto`, the one shape returned by every
  route (create, list, and — once phase 3 lands — delete/restore); never carries `storageKey` or a
  filesystem path.
- `content-disposition.d.ts` — a minimal ambient module declaration; the `content-disposition`
  package ships no types and has no `@types` package.
- Prisma `MeetingFile` model (`prisma/schema.prisma`): `meetingId` (FK to `Meeting`,
  `onDelete: Restrict`), `name` (`@db.VarChar(255)`), `size Int` (not `BigInt` — 500 MB fits, and
  `BigInt` breaks `JSON.stringify`), `mimeType` (`@db.VarChar(128)`), `storageKey` (`@unique`),
  `deletedAt DateTime?` (unused until phase 3). Indexed `@@index([meetingId, deletedAt])` and
  `@@index([deletedAt])`. `Meeting` gained `@@index([ownerId])` in the same migration — see
  `.claude/modules/module-api-meetings.md`.

## Access control (non-obvious, worth preserving)

- **Guard order matters**: `MeetingOwnerGuard` runs after `JwtAuthGuard` but before the upload
  route's `FileInterceptor`, because Nest runs every guard before every interceptor regardless of
  declaration order — an interceptor is not a guard. Putting the ownership check anywhere else (a
  handler-level check, or relying on the interceptor to fail first) would let a signed-in stranger's
  upload body land on disk before the 404 is decided.
- **Every file lookup is a single compound query**, never a plain `findUnique({ where: { id } })`
  after a separate meeting check: `FilesService.findFileForOwner` filters on
  `{ id: fileId, meetingId, meeting: { ownerId }, deletedAt: null }` in one `findFirst`. A file id
  from another owner's meeting, presented under a meeting the caller does own, must 404 — a
  check-then-fetch split reintroduces that hole even though `MeetingOwnerGuard` already confirmed
  `:meetingId` itself belongs to the caller.
- **The file name is normalized, not rejected**: `path.basename()` strips any directory component,
  C0 control bytes are removed, and the result is truncated (not validated-and-400'd) to
  `MAX_FILE_NAME_LENGTH`. A traversal-shaped name (`../../etc/passwd`) is stored as its basename
  (`passwd`), never as an error.
- **`mimeType` is currently the client's declared `Content-Type`** (multer's `file.mimetype`), not a
  sniffed value — real type detection is phase 2's `file-type`-based `FileTypeService`, not yet
  wired in. Nothing in phase 1 trusts `mimeType` for a security decision.
- **The byte route never passes an absolute path straight to `res.sendFile`**: `send`'s `dotfiles`
  check inspects every segment of whatever path it is given, and `STORAGE_ROOT`'s own `.data`
  segment would trip `dotfiles: 'deny'` on every single download. The route instead splits the
  resolved path into `root: dirname(localPath)` and a bare `basename(localPath)`, so only the
  storage key's own segments (always server-generated UUIDs) are checked.
- **`Cache-Control: private, no-store` is set explicitly** before `res.sendFile` runs — `send`
  writes `public, max-age=0` whenever the header is absent, which would mark one owner's private
  bytes storable by a shared cache.

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

## Function reference

- `FilesController.upload(meetingId, file): Promise<MeetingFileResponseDto>` — `400` if no `file`
  part was sent; otherwise delegates to `filesService.create`.
- `FilesController.list(meetingId, user): Promise<MeetingFileResponseDto[]>` — delegates to
  `filesService.listForOwner(meetingId, user.userId)`.
- `FilesController.content(meetingId, fileId, user, res): Promise<void>` — resolves the file via
  `filesService.findFileForOwner`, sets `Content-Type`/`X-Content-Type-Options`/`Cache-Control`/
  `Content-Disposition` (`inline` for `image/*`, `video/*`, `audio/*` and `application/pdf`;
  `attachment` otherwise), then `res.sendFile`.
- `FilesService.create(meetingId, file): Promise<MeetingFileResponseDto>` — generates the file's own
  id and `storageKey` (`meetings/<meetingId>/<fileId>`), inserts the `MeetingFile` row, then commits
  the bytes via `FileStorage.save`; deletes the row and rethrows if `save` throws, so a bytes-commit
  failure never leaves an orphaned row.
- `FilesService.listForOwner(meetingId, ownerId): Promise<MeetingFileResponseDto[]>` — live files
  only (`deletedAt: null`), newest first.
- `FilesService.findFileForOwner(fileId, meetingId, ownerId): Promise<MeetingFile>` — the one
  compound lookup every file-id route uses; throws `NotFoundException('File not found')`. Returns
  the full Prisma row (including `storageKey`), unlike the DTO-returning methods above — the content
  route is this method's only caller that needs it.
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
  `deletedAt`/`purgeAt` are always `null` until phase 3 sets `deletedAt`; `purgeAt` is then computed
  as `deletedAt + PURGE_AFTER_MS`, an absolute timestamp rather than a countdown so a cached response
  can't drift.
