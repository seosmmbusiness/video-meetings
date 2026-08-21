# apps/api/src/profile

Owns the signed-in caller's **own** self-service routes: `GET /profile`, `PATCH /profile` and the three avatar routes (`POST`, `GET` and `DELETE /profile/avatar`).

It is a module of its own rather than a controller inside `src/users` or `src/auth` (D-1). `src/users` states it has no HTTP surface and exposes persistence only over CQRS, and a display name is not authentication — folding these routes into `src/auth` would give the module every guard depends on a third, unrelated concern.

Its shape is the one `src/auth` already uses: a controller plus a service over the CQRS buses, and **no Prisma of its own**. It reaches the `User` row through three users-module handlers — `FindUserByIdQuery`, `UpdateUserNameCommand` and `UpdateUserAvatarCommand` (D-3, see `module-api-users.md`) — and reaches the avatar's bytes through `StorageModule`'s `FileStorage`, never through the meeting-files feature (D-4, see `module-api-storage.md`).

Two invariants hold everywhere in this module:

- **The subject is the token, never the payload.** No route takes a path segment or a body field naming an account, so there is nothing to point at somebody else's row — including the avatar's bytes, whose storage key is read off the caller's own row (AC-15). There is deliberately no `GET /profile/:id` and no `GET /profile/avatar/:id`.
- **The response is built field by field, never spread from the entity.** `passwordHash`, `tokenVersion`, `avatarKey`, `avatarMimeType` and `avatarSize` stay off the wire because `toResponse` names the five fields it copies (S-1, AC-18). Every route that changes an avatar answers that same DTO, so the caller learns the account's state without ever seeing a key.

## Architecture

- `ProfileModule` (`profile.module.ts`) — imports `AuthModule` for `JwtAuthGuard` and `StorageModule` for `FileStorage` and `FileTypeService` (D-4); declares `ProfileController`, `ProfileService`, `AvatarSizeGuard` and `AvatarFilePipe`. Registered in `AppModule`, which also provides the app-wide `CqrsModule.forRoot()` the service dispatches on.
- `profile.controller.ts` — `@UseGuards(JwtAuthGuard)` on the whole controller; every route takes its subject from `@CurrentUser()` and delegates to the service. Fully annotated for Swagger (`@ApiTags('profile')`, `@ApiBearerAuth()`, 200/201/400/401/404 plus `@ApiConsumes('multipart/form-data')`, an `@ApiBody` multipart schema and one `@Api*Response` per refusal status — `413` and `415` — on the upload route). Per-route throttles: `{ limit: 240, ttl: 60_000 }` on the byte read, `{ limit: 30, ttl: 60_000 }` on the avatar write and delete (S-5).
- `profile.service.ts` — the read/update logic over `QueryBus`/`CommandBus`, plus the avatar's commit, removal and byte resolution over `FileStorage`.
- `guards/avatar-size.guard.ts` — `AvatarSizeGuard`, D-6's first gate (see Avatar upload below).
- `avatar-multer.config.ts` — `buildAvatarMulterOptions()`, D-6's second gate: `limits.fileSize = MAX_AVATAR_BYTES`, `files: 1`, staging into `<STORAGE_ROOT>/tmp` under a random filename, `defParamCharset: 'utf8'`.
- `filters/avatar-multer-exception.filter.ts` — `AvatarMulterExceptionFilter`, which turns multer's own size abort into the same `413` the guard answers.
- `pipes/avatar-file.pipe.ts` — `AvatarFilePipe`, D-6's third gate: content detection, `415`, temp file unlinked before the throw. Also the `400` for a request carrying no `avatar` part.
- `dto/profile-response.dto.ts` — `ProfileResponseDto`, the five keys a profile answer carries.
- `dto/update-profile.dto.ts` — `UpdateProfileDto` plus the exported `normalizeName` transform.
- `profile.constants.ts` — `MAX_NAME_LENGTH` (80) and `MAX_NAME_LENGTH_MESSAGE`, plus the avatar's `MAX_AVATAR_BYTES` (5 MB binary), `AVATAR_IDLE_TIMEOUT_MS` (60 s), `ACCEPTED_AVATAR_MIME_TYPES` (`png`/`jpg`/`webp`), `ACCEPTED_AVATAR_EXTENSIONS_LABEL` and the verbatim `413`/`415`/`400` messages — each stated once, shared by the code and its specs.
- Prisma `User` columns (`prisma/schema.prisma`): `avatarKey String? @unique`, `avatarMimeType String? @db.VarChar(64)`, `avatarSize Int?`, `avatarUpdatedAt DateTime?` — four nullable columns rather than a `UserAvatar` table, because the relationship is 1:1 and the PRD rules out history (D-5). They are written and cleared **as one group**, by `UpdateUserAvatarCommand` (see `module-api-users.md`).

## Avatar upload: three gates, in order (D-6)

Same shape as the meeting-files upload route, minus the quota — an avatar sits outside the per-owner byte accounting, since there is at most one per account (D-5).

1. **Declared size** — `AvatarSizeGuard`, before `FileInterceptor` reads a byte (Nest runs every guard before every interceptor): a `Content-Length` over `MAX_AVATAR_BYTES` is `413` at zero bytes read, and a chunked request declaring nothing is weighed as the ceiling rather than as zero. The guard also arms `request.setTimeout(AVATAR_IDLE_TIMEOUT_MS)` — an _inactivity_ timeout that resets on every chunk, so a slow-but-steady transfer completes untouched.
2. **Streamed size** — multer's own `limits.fileSize`, the fallback for the chunked case gate 1 cannot weigh. `AvatarMulterExceptionFilter` maps the resulting `MulterError('LIMIT_FILE_SIZE')` to the same `413` body and unlinks any temp file still referenced (defensively — multer already removes what it wrote on that path); any other `MulterError` becomes a `400`.
3. **Detected type** — `AvatarFilePipe` calls `FileTypeService.detect(path, originalname, ACCEPTED_AVATAR_MIME_TYPES)`: `415` when the **content** is not PNG, JPEG or WebP, whatever the name or the declared `Content-Type` says (AC-8). It runs before the handler, so no row exists yet and the caller's current avatar is untouched; the temp file is unlinked before the throw.

Messages are verbatim and shared as constants: `Avatar exceeds the 5 MB limit.` and `Unsupported image type. Accepted types: png, jpg, webp.` SVG is deliberately absent from the accepted set — none of the three accepted types is a script container, so stored bytes cannot be an XSS payload served from our own origin.

## Commit order (D-7)

A replacement is `save` → `update` → `delete previous`, never a fixed key overwritten in place:

1. `FileStorage.save('users/<userId>/avatar/<uuid>', tempPath)` — a **fresh `randomUUID()` per upload**, which is what makes a replacement atomic from the reader's side: the row points at either the old key or the new one, never at a half-written file (AC-6). A fixed key would also let every cache keep serving the old image under an unchanged URL.
2. `UpdateUserAvatarCommand` writes the four columns as one group. If it throws, the just-saved bytes are deleted — nothing references them (S-5).
3. The **previous** key's bytes are deleted best-effort. A failure is logged as a count and never as a key (S-1) and leaves an unreachable orphan on disk — the accepted residual of this ordering.

Removal is the mirror, and for the same reason: the columns are cleared **first**, the bytes deleted after, so an interrupted removal leaves unreachable bytes rather than a row pointing at nothing.

## Function reference

- `ProfileController.getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto>` — `GET /profile`; passes `user.userId` to the service.
- `ProfileController.updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<ProfileResponseDto>` — `PATCH /profile`; the body is already validated and normalised by the global `ValidationPipe` (`whitelist` strips unknown fields, so an update cannot mass-assign).
- `ProfileService.getProfile(userId: string): Promise<ProfileResponseDto>` — dispatches `FindUserByIdQuery`; throws `NotFoundException('Profile not found')` when the row is gone, then maps through `toResponse`.
- `ProfileService.updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileResponseDto>` — a payload with **no** `name` key at all changes nothing and falls through to `getProfile`; an explicitly submitted value (including `''`) is written via `UpdateUserNameCommand`.
- `ProfileController.setAvatar(user, file, res): Promise<ProfileResponseDto>` — `POST /profile/avatar`; reads whether the account already had an avatar, commits the new one, and downgrades the default `201` to `200` when it was a replacement (AC-6) — which is why it reaches for `@Res({ passthrough: true })`: what happened to the account is not something the returned DTO can say.
- `ProfileController.getAvatar(user, res): Promise<void>` — `GET /profile/avatar`; sets `Content-Type` (the stored, detected type), `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, max-age=60`, then `res.sendFile` with the `root` + basename split (see Gotchas). `@Res()` without passthrough, so this route bypasses Nest's normal response pipeline.
- `ProfileController.removeAvatar(user): Promise<ProfileResponseDto>` — `DELETE /profile/avatar`; answers `200` with the profile, not `204`, so the caller sees `hasAvatar: false` without a second request.
- `ProfileService.setAvatar(userId, file): Promise<ProfileResponseDto>` — the D-7 commit order above, over `FileStorage` and `UpdateUserAvatarCommand`.
- `ProfileService.removeAvatar(userId): Promise<ProfileResponseDto>` — clears the four columns, then deletes the bytes. An account with no avatar is left exactly as it is and answers the same profile, so a repeated removal writes nothing.
- `ProfileService.getAvatarFile(userId): Promise<{ path: string; mimeType: string }>` — resolves the caller's own key to a local path via `FileStorage.localPathFor`; `404` (`'Avatar not found'`) when the row holds no key, `500` when the bound backend has no local path at all (every backend today does — a remote one would need a streamed fallback rather than a guessed path).
- `ProfileService.deleteBytes(key): Promise<void>` (private) — best-effort delete of bytes nothing references any more; a failure is warned as a count, never as a key (S-1).
- `ProfileService.findUser(userId): Promise<User>` (private) — the `FindUserByIdQuery` dispatch behind every method, throwing `NotFoundException('Profile not found')`.
- `ProfileService.toResponse(user: User): ProfileResponseDto` (private) — the field-by-field mapping. `hasAvatar` is **derived** (`user.avatarKey !== null`), not stored — derived from the key's _presence_ rather than the key itself, which is what keeps `STORAGE_ROOT`'s layout off the wire while still telling the caller they have one (D-5, S-1).
- `AvatarSizeGuard.canActivate(context): boolean` — the declared-size check (`PayloadTooLargeException`) and arming `request.setTimeout(AVATAR_IDLE_TIMEOUT_MS, () => request.destroy())`.
- `AvatarFilePipe.transform(file): Promise<CheckedAvatarUpload>` — `400` when no `avatar` part was sent, `415` when detection refuses the content (temp file unlinked first), otherwise the upload carrying its **detected** type.
- `AvatarMulterExceptionFilter.catch(exception, host): Promise<void>` — `LIMIT_FILE_SIZE` → the route's `413` shape, any other `MulterError` → `400`; unlinks a temp file still referenced on the request.
- `buildAvatarMulterOptions(): MulterOptions` (`avatar-multer.config.ts`) — see Gotchas.
- `normalizeName({ value }): unknown` (`dto/update-profile.dto.ts`) — the `@Transform` callback: strips C0 control characters and DEL, strips the bidirectional overrides/embeddings/isolates (`U+202A`–`U+202E`, `U+2066`–`U+2069`), then trims. Non-string values pass through untouched so `@IsString` still owns the type error.

## DTO reference

- `ProfileResponseDto` — `id`, `email`, `name: string | null`, `hasAvatar: boolean`, `avatarUpdatedAt: Date | null`. The field set was final from phase 1 on; phase 3 filled the two avatar fields without changing the shape. It never carries the storage key, a path, `avatarMimeType`, `avatarSize`, the hash or `tokenVersion` (S-1, AC-18). `avatarUpdatedAt` doubles as the cache-busting value the web page appends to the byte URL (D-8).
- `StagedAvatarUpload` / `CheckedAvatarUpload` (`pipes/avatar-file.pipe.ts`) — the upload before and after detection. The distinction is the point: `mimetype` on the checked shape is the **detected** type, so nothing downstream can reach the declared one by accident.
- `UpdateProfileDto` — one optional field, `name`, in this order: `@Transform(normalizeName)` → `@IsOptional()` → `@IsString()` → `@MaxLength(80)`.

## Gotchas

- **Normalise, never reject.** A name carrying a NUL byte or a bidi override is cleaned and accepted, matching what `FilesService` already does to an uploaded filename (S-2). Postgres cannot store a NUL in a text column, so rejecting late would have answered 500 instead of the stated behaviour.
- **Stripping runs before the length check.** Removed bytes never count against the 80-character limit, which is why the `@Transform` has to sit above the validators.
- **`U+200E`/`U+200F` survive on purpose.** The plain left-to-right/right-to-left marks are how a legitimate Hebrew or Arabic name sets its direction; only the _overriding_ controls go.
- **Missing `name` ≠ empty `name`.** Absent leaves the stored value alone; `''` clears it to `NULL` (AC-4). Both answer 200 with the current profile.
- **An access token outlives its row** — it stays valid for up to an hour after the account goes. Both paths answer the same 404: the read because the query resolves to `null`, the write because `UpdateUserNameHandler` translates Prisma's `P2025`.
- **80 is the column, not just the DTO.** `User.name` is `@db.VarChar(80)` (D-2); the DTO's limit mirrors it rather than replacing it.
- **`Cache-Control` is set explicitly before `res.sendFile`.** `send` writes `public, max-age=0` whenever the header is absent, which would mark one owner's private image storable by a shared cache. The value is `private, max-age=60` — **T-1's ruling, not the research's `no-store`**: long enough to spare a re-fetch per rendered page, short enough that a removed avatar stops rendering while the browser still holds it. Changing it back to `no-store` is a decision, not a cleanup.
- **The byte route never passes an absolute path straight to `res.sendFile`.** `send`'s `dotfiles` check inspects every segment of whatever path it is given, and `STORAGE_ROOT`'s own `.data` segment would trip `dotfiles: 'deny'` on every single read. The route splits the resolved path into `root: dirname(path)` and a bare `basename(path)`, so only the key's last segment — a server-generated UUID — is checked (D-8).
- **The served type is the detected one, never the declared one.** It was written to `avatarMimeType` at upload time by `AvatarFilePipe`; a caller cannot label a PNG `image/svg+xml` and have that travel back out as the response's `Content-Type`.
- **`buildAvatarMulterOptions()` resolves `STORAGE_ROOT` lazily, inside the `destination` callback.** It runs once, synchronously, at `ProfileController`'s decoration time — before `ConfigModule.forRoot()` has loaded the root `.env` — so hoisting the `resolveStorageRoot()` call out of the callback would read an unset variable. Full reasoning in `docs/modules/module-api-storage.md`'s Gotchas.
- **A stray non-file part is ignored, not refused.** An upload naming another account in an extra field changes nothing, because the route takes its subject from the token alone (AC-15) — and the global `ValidationPipe`'s `whitelist` is what stops it being assigned anywhere.
- **Avatars sit outside the 20 GB-per-owner accounting** (D-5), so nothing counts them and there is no quota gate on the upload route. The bound on stored bytes is one 5 MB object per account, plus whatever a failed best-effort delete orphaned (S-5, accepted residual).

## Tests

| Tier        | File                                                                                                                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `profile.controller.spec.ts`, `profile.service.spec.ts`, `dto/update-profile.dto.spec.ts`, `guards/avatar-size.guard.spec.ts`, `pipes/avatar-file.pipe.spec.ts`, `filters/avatar-multer-exception.filter.spec.ts`, `avatar-multer.config.spec.ts` | Delegation from the token's subject, the absent-vs-empty `name` split, the 404 paths, every normalisation/limit case on the DTO, the `201`/`200` split on a replacement, the commit order and its best-effort delete, and each gate in isolation (declared size + idle timeout, detection's `415`/`400` and its unlink, the multer abort's `413`, the lazy `STORAGE_ROOT` read).            |
| Integration | `profile.int-spec.ts`                                                                                                                                                                                                                             | The real buses against Postgres, plus the real `FileStorage`: the five-key mapping, the write-then-read round trip, `''` → `NULL`, the four columns written as one group under a `users/<id>/avatar/<uuid>` key, a replacement leaving the previous key's bytes gone (S-5), removal clearing the columns and the bytes, and neither the key nor the hash reaching a response.               |
| E2E         | `../../test/profile.e2e-spec.ts`                                                                                                                                                                                                                  | Every route over HTTP: missing/invalid/expired token on each, the exact five keys, the name cases (80 trimmed, 81 refused, cleared, NUL sanitised, unknown field not assigned), upload `201` and replacement `200`, `413` at zero bytes read and on a 5 MB + 1 byte body, `415` for a renamed PDF, removal then `404`, and B's token answering its own state rather than A's bytes (AC-15). |
