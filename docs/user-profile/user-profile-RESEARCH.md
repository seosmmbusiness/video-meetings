# Research: User profile

**Key**: UP
**PRD**: [user-profile-PRD.md](./user-profile-PRD.md)
**Plan**: [user-profile-PLAN.md](./user-profile-PLAN.md)
**Date**: 2026-08-17

## 1. TL;DR

**No new dependencies.** Everything this feature needs is already installed: `multer@2.2.0` and
`file-type@21.3.4` (which detects `image/png`, `image/jpeg` and `image/webp`) come in with the
meeting-files feature, and `@heroui/react@3.2.4` ships an `Avatar` with `Avatar.Image`/
`Avatar.Fallback`.

The HTTP surface is a new `src/profile` module in `apps/api`, orchestrating `users`, `credentials`
and storage over CQRS the way `src/auth` already does (D-1); persistence stays behind the users
module's command/query surface (D-3). `User` gains `name`, four avatar columns and `tokenVersion`
in one migration (D-2, D-5, D-9). The byte primitives `src/files` owns today —`FileStorage`,
`LocalDiskFileStorage`, `storage-root.ts` and a generalised `FileTypeService` — move into a new
`src/storage` module both features import (D-4).

Session revocation is a `tokenVersion` column, a `ver` claim, and a lookup in `JwtStrategy.validate`
on every guarded request (D-9) — the only shape that satisfies AC-13 as written. The password route
answers **403**, never 401, for a wrong current password, because `apps/web` treats 401 as
signed-out (D-11).

On the web, avatar bytes move through a same-origin proxy Route Handler, not a Server Action:
Next 16.3.1 caps a Server Action's request body at 1 MB by default, well under the PRD's 5 MB
avatar (D-12). The image renders through HeroUI's `Avatar`, a plain `<img>` — `next/image` fetches
its source server-side without the session cookie and would 401 against the private proxy (D-13).

## 2. Decision map

| Phase | Tasks                        | Decisions                         |
| ----- | ---------------------------- | --------------------------------- |
| 1     | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | D-1, D-2, D-3                     |
| 2     | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | D-5, D-12, D-13                   |
| 3     | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 | D-1, D-3, D-4, D-5, D-6, D-7, D-8 |
| 4     | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | D-8, D-12, D-13                   |
| 5     | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 | D-1, D-3, D-9, D-10, D-11         |
| 6     | 6.1, 6.2, 6.3, 6.4, 6.5      | D-9, D-11, D-12                   |

## 3. Stack as found

Read this run, not remembered:

| Fact                                                     | Value                                                                                                                                             | Source                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Runtime                                                  | Node `24` pinned, `v24.16.0` installed, npm `11.13.0`                                                                                             | `.nvmrc`, `node -v`                         |
| apps/api                                                 | `@nestjs/*` 11.2.1, `@nestjs/cqrs` ^11.0.3, `@nestjs/jwt` 11.0.2, `@nestjs/passport` 11.0.5, `@nestjs/swagger` 11.4.6, `@nestjs/throttler` ^6.5.0 | `apps/api/package.json`                     |
| Database                                                 | `@prisma/client` 7.9.1 + `@prisma/adapter-pg`, three migrations, `User`/`Meeting`/`MeetingFile`                                                   | `apps/api/prisma/`, `package.json`          |
| Passwords                                                | `bcrypt` 6.0.0, 12 salt rounds, timing-safe dummy-hash verification                                                                               | `.claude/modules/module-api-credentials.md` |
| Validation                                               | global `ValidationPipe({ whitelist: true, transform: true })`, `class-validator` 0.15.1                                                           | `apps/api/src/main.ts`                      |
| apps/web                                                 | `next` 16.3.1, `react` 19.2.8, `@heroui/react` 3.2.4, Tailwind 4, Vitest ^4.1.10, Playwright ^1.62.1                                              | `apps/web/package.json`, `node_modules`     |
| Already installed, unused by this feature's own manifest | `multer@2.2.0`, `file-type@21.3.4`, `load-esm@1.0.3`, `sharp@0.35.3` (Next's own)                                                                 | `npm ls`                                    |
| Env vars                                                 | `STORAGE_ROOT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `API_BASE_URL`, `CORS_ORIGIN`, `REDIS_URL` — **no new one needed**                                | `.env.example`                              |

What the repo already covers, so no plan task needs new code for it:

- **Byte storage** — the abstract `FileStorage` (`save`/`createReadStream`/`delete`/`stat`/
  `localPathFor`) with `LocalDiskFileStorage` writing under `STORAGE_ROOT` at `0o700`/`0o600`,
  committing with `fs.rename`. `FilesModule` declares **no** `exports`, which is why D-4 exists.
- **Content-based type detection** — `FileTypeService.detect(tempPath, declaredName)`, reaching
  ESM-only `file-type` through `loadEsm` (needs `NODE_OPTIONS=--experimental-vm-modules`, already on
  both api test scripts). Its accepted set is hardcoded to the twelve meeting-file types, which do
  **not** include `image/webp`.
- **Pre-stream upload gating** — `UploadSizeGuard` proves the pattern: a guard runs before
  `FileInterceptor`, so a declared `Content-Length` is refused at zero bytes read.
- **Multer wiring** — `buildMulterOptions()` with `diskStorage` into `<STORAGE_ROOT>/tmp`, random
  UUID filenames, `limits: { files: 1, fields: 0, parts: 2 }` (busboy counts the closing boundary as
  a part) and `defParamCharset: 'utf8'`.
- **Same-origin byte proxying** — `proxyToApi(request, token, path)` with its request header
  allow-list (`content-type`, `content-length`, `range`) and response allow-list (adds
  `content-disposition`, `accept-ranges`, `content-range`, `cache-control`), attaching the bearer
  token server-side and dropping the caller's own `Authorization`.
- **Session cookie** — `video-meetings.session`, `httpOnly`, expiry taken from the JWT's `exp`;
  `setSessionCookie` / `clearSessionCookie` / `getSession`.
- **Identity CQRS boundary** — `users` and `credentials` export no providers; `auth` reaches them
  only through `CommandBus`/`QueryBus`, with `CqrsModule.forRoot()` registered once in `AppModule`.

## 4. Decisions

### D-1. Where does the profile's HTTP surface live?

- **Plan tasks**: 1.5, 3.5, 5.2
- **Options**:

| Option                          | Pros                                                                                                         | Cons                                                                                   | Cost | Risk   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---- | ------ |
| New `src/profile` module        | symmetric with `src/auth` (orchestration over `users`/`credentials`); one place for every self-service route | one more module in the graph                                                           | low  | low    |
| A controller inside `src/users` | the `User` model's owner also owns its routes                                                                | breaks the module's stated contract ("no HTTP surface of its own", CQRS-only exposure) | low  | medium |
| Extend `src/auth`               | password change sits next to login                                                                           | name and avatar are not authentication; `auth` would own three unrelated concerns      | low  | medium |

- **Chosen**: a new `src/profile` module — `ProfileController` + `ProfileService`, guarded by
  `JwtAuthGuard`, importing `AuthModule` (guard/strategy) and the new `StorageModule` (D-4), and
  reaching persistence and hashing only through `CommandBus`/`QueryBus`.
- **Why**: it is exactly the shape `src/auth` already has, and it keeps the identity-domain rule in
  `apps/api/CLAUDE.md` intact — `users` and `credentials` stay provider-private and CQRS-only, which
  is what makes them independently testable.
- **Rejected**: a controller in `users` (contradicts its own module doc); folding into `auth`
  (bundles unrelated concerns into the module every route's guard depends on).
- **Exposure**: one new guarded surface. Every route resolves its subject from
  `@CurrentUser()`/`request.user`, never from a path segment or a body field, so there is no
  identifier for a caller to point at another account (AC-15). Mass assignment is held by the global
  `ValidationPipe({ whitelist: true })`.
- **Fits in at**: `apps/api/src/profile/` (`profile.module.ts`, `profile.controller.ts`,
  `profile.service.ts`, `dto/`, `guards/`), documented as
  `.claude/modules/module-api-profile.md`.
- **Sources**: `apps/api/CLAUDE.md` (Conventions, CQRS boundary), `.claude/modules/module-api-auth.md`,
  `.claude/modules/module-api-users.md`, `apps/api/src/auth/auth.module.ts`.

### D-2. How is the name stored and validated?

- **Plan tasks**: 1.2, 1.4
- **Options**:

| Option                                   | Pros                                                   | Cons                                                              | Cost   | Risk   |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------ | ------ |
| `name String? @db.VarChar(80)` on `User` | one nullable column; the limit is also a DB constraint | none for a single optional field                                  | low    | low    |
| Separate `Profile` model (1:1)           | keeps `User` narrow                                    | a join on every read for one column; a second write path          | medium | low    |
| `name String` NOT NULL, default `''`     | no null handling                                       | `''` and "unset" become indistinguishable, and AC-4 needs "unset" | low    | medium |

- **Chosen**: `name String? @db.VarChar(80)`; the DTO trims first (`@Transform`, as
  `dto/transforms.ts` already does for email), then validates `@MaxLength(80)`, and an empty string
  after trimming is stored as `NULL` (AC-4).
- **Why**: the PRD's limit is 80 characters and the database is the last line that enforces it;
  `VarChar(80)` mirrors how `meeting_files.name` mirrors `MAX_FILE_NAME_LENGTH`. Trim-then-validate
  is the existing `normalizeEmail` pattern, so an 80-character name padded with spaces is accepted
  rather than refused.
- **Rejected**: a `Profile` table (a join for one column); a NOT NULL default (loses the "no name"
  state AC-4 requires).
- **Exposure**: a stored name is user-controlled text rendered on two pages — React escapes it by
  default (AC-16), and nothing on the API side ever interpolates it into HTML, SQL (Prisma
  parameterises) or a filesystem path. The length cap bounds the row and the rendered page.
- **Fits in at**: `apps/api/prisma/schema.prisma`; `apps/api/src/profile/dto/update-profile.dto.ts`;
  the constant lives in `apps/api/src/profile/profile.constants.ts` beside the others.
- **Sources**: `apps/api/prisma/schema.prisma`, `apps/api/src/auth/dto/transforms.ts`,
  `apps/api/src/files/files.constants.ts`.

### D-3. Does the profile module touch Prisma directly?

- **Plan tasks**: 1.3, 1.4, 3.3, 5.2, 5.4
- **Options**: profile service injects `PrismaService` · profile goes through new users-module
  commands/queries · users module exports a service.
- **Chosen**: new commands/queries on the **users** module —
  `FindUserByIdQuery(userId)`, `UpdateUserNameCommand(userId, name)`,
  `UpdateUserAvatarCommand(userId, avatar | null)`,
  `UpdateUserPasswordCommand(userId, passwordHash)` (which bumps `tokenVersion` in the same
  `UPDATE`, D-9) — all dispatched from `ProfileService` over `CommandBus`/`QueryBus`.
- **Why**: `users` owns the `User` model, and its module doc states persistence is exposed
  exclusively via CQRS. A second module writing `user` rows through Prisma directly would put the
  model's invariants in two places — including the password/`tokenVersion` pair, which must move
  together.
- **Rejected**: injecting `PrismaService` into `ProfileService` (two owners for one model);
  exporting `UsersService` (the module deliberately exports nothing).
- **Exposure**: every command takes the caller's own `userId` from the verified token, so the
  authorization decision happens before the bus, in the controller layer, and no handler can be
  reached with another account's id from outside.
- **Fits in at**: `apps/api/src/users/commands/`, `apps/api/src/users/queries/`, registered in
  `users.module.ts`; `FindUserByIdQuery` is also what `JwtStrategy` uses in D-9.
- **Sources**: `.claude/modules/module-api-users.md`, `apps/api/src/users/users.module.ts`.

### D-4. How do `files` and `profile` share the byte primitives?

- **Plan tasks**: 3.3, 3.4
- **Options**:

| Option                                                  | Pros                                                                                                | Cons                                                                                               | Cost   | Risk   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ | ------ |
| New `src/storage` module (**chosen**)                   | one owner for disk access and type sniffing; `profile` does not depend on the meeting-files feature | moves four working files of a shipped feature and their specs                                      | medium | medium |
| `FilesModule` exports `FileStorage` + `FileTypeService` | two lines, nothing moves                                                                            | `profile` imports the whole files feature — controller, purge cron, quota service                  | low    | medium |
| Profile does its own disk writes and sniffing           | fully independent                                                                                   | a second path to disk and a second content check — the duplication `FileStorage` exists to prevent | medium | high   |

- **Chosen**: a new `src/storage` module exporting `FileStorage` (bound to `LocalDiskFileStorage`)
  and `FileTypeService`. `storage/file-storage.ts`, `storage/local-disk-file-storage.ts` and
  `storage/storage-root.ts` move out of `src/files` unchanged; `FileTypeService` moves with them and
  gains one parameter — the accepted MIME set — defaulting to nothing and always passed by its
  caller, so `files` keeps its twelve types and `profile` passes its three.
- **Why**: the user chose it (see Asked & assumed). It keeps the boundary that `module-api-files.md`
  calls the point of `FileStorage` ("a future backend is one new class plus one line"), and stops a
  self-service profile route from dragging in a cron job and a quota reservation service it has no
  use for.
- **Rejected**: exporting from `FilesModule` (couples two features through the wrong module);
  duplicating (two disk paths, two sniffers, two sets of hardening to keep in step).
- **Exposure**: the move itself is the risk, not the result — `LocalDiskFileStorage`'s `0o700`/
  `0o600` modes, its `tmp` staging and `multer.config.ts`'s lazy `resolveStorageRoot()` (which must
  stay lazy: it runs at controller-decoration time, before `.env` is loaded) all have to survive the
  extraction byte-for-byte. The files suites are what proves they did.
- **Fits in at**: `apps/api/src/storage/` (`storage.module.ts` + the four moved files);
  `FilesModule` and the new `ProfileModule` both import it. Documented as
  `.claude/modules/module-api-storage.md`, with `module-api-files.md` updated to point at it.
- **Sources**: `apps/api/src/files/files.module.ts` (no `exports`),
  `apps/api/src/files/storage/*.ts`, `apps/api/src/files/file-type.service.ts`,
  `.claude/modules/module-api-files.md` (Gotchas: `STORAGE_ROOT` resolution is duplicated on
  purpose).

### D-5. Where does the avatar's metadata live, and what does the API return?

- **Plan tasks**: 2.2, 3.2, 3.3, 4.5
- **Options**: columns on `User` · a `UserAvatar` model · reuse `MeetingFile` with a null
  `meetingId`.
- **Chosen**: four nullable columns on `User` — `avatarKey String? @unique`,
  `avatarMimeType String? @db.VarChar(64)`, `avatarSize Int?`, `avatarUpdatedAt DateTime?` — set and
  cleared together. The response DTO is
  `ProfileResponseDto { id, email, name, hasAvatar, avatarUpdatedAt }`: **never** the storage key or
  any path, matching `MeetingFileResponseDto`'s rule.
- **Why**: the relationship is 1:1 and the PRD rules out history, so a table would carry one row per
  user forever to express what four nullable columns express. `MeetingFile` is the wrong home — its
  `meetingId` is non-nullable and its soft-delete/purge lifecycle is exactly what an avatar must not
  have.
- **Rejected**: `UserAvatar` model (a join and a lifecycle for a 1:1 with no history); reusing
  `MeetingFile` (would put avatars inside the 20-file-per-meeting and 20 GB-per-owner accounting,
  which the PRD never asked for).
- **Exposure**: `hasAvatar` rather than a URL keeps the storage key server-side, so a leaked
  response body cannot be turned into a byte path; `avatarUpdatedAt` is the cache-busting value the
  web appends (D-8) and reveals nothing beyond "the avatar changed at this time" to its own owner.
- **Fits in at**: `apps/api/prisma/schema.prisma`;
  `apps/api/src/profile/dto/profile-response.dto.ts`.
- **Sources**: `apps/api/prisma/schema.prisma`, `.claude/modules/module-api-files.md` (DTOs).

### D-6. How does the avatar's upload arrive, and where is each limit enforced?

- **Plan tasks**: 3.3, 3.4
- **Options**: `multipart/form-data` via `FileInterceptor` (as meeting files) · base64 in a JSON
  body · a raw binary body.
- **Chosen**: `multipart/form-data` through `FileInterceptor('avatar', buildAvatarMulterOptions())`,
  with the same three-gate order the files module proved, minus the quota (there is no per-owner
  avatar quota in the PRD):
  1. `AvatarSizeGuard` — refuses a declared `Content-Length` over `MAX_AVATAR_BYTES` at zero bytes
     read, and arms the same inactivity timeout; a chunked request that declares nothing is treated
     as the ceiling.
  2. multer's own `limits.fileSize = MAX_AVATAR_BYTES`, with a `MulterExceptionFilter`-shaped
     mapping to the same 413 body, for the chunked case.
  3. `FileTypeService.detect(tempPath, name, ACCEPTED_AVATAR_MIME_TYPES)` — 415 when the **content**
     is not PNG/JPEG/WebP, whatever the name or declared `Content-Type` says (AC-8). The temp file is
     unlinked before the throw.
- **Why**: it is the same shape as the existing upload route, so the ordering that makes the limits
  actually hold — guards run before interceptors — is inherited rather than rediscovered. Base64
  would inflate a 5 MB image to ~6.7 MB, be buffered whole in memory, and need the body parser's
  limit raised; a raw body would give up multer's temp-file staging.
- **Rejected**: base64 JSON (memory + inflation); raw binary body (loses staging and the field
  discipline `parts: 2` gives).
- **Exposure**: an oversized body is the DoS vector, and gates 1–2 close it before bytes land; a
  disguised file is the type vector, and gate 3 closes it after staging but before the row exists.
  No accepted type is a script container — SVG is deliberately absent from the accepted set, so the
  stored bytes cannot be an XSS payload served from our origin.
- **Fits in at**: `apps/api/src/profile/guards/avatar-size.guard.ts`,
  `apps/api/src/profile/avatar-multer.config.ts`, `apps/api/src/profile/profile.constants.ts`.
- **Sources**: `apps/api/src/files/guards/upload-size.guard.ts`,
  `apps/api/src/files/multer.config.ts`, `apps/api/src/files/file-type.service.ts`,
  `node_modules/file-type/supported.js` (`image/png`, `image/jpeg`, `image/webp` all present in
  `file-type@21.3.4`).

### D-7. What is the avatar's storage key, and in what order does a replacement commit?

- **Plan tasks**: 3.3, 3.5
- **Options**: a fixed key per user (`users/<id>/avatar`) · a random key per upload · content-hash
  key.
- **Chosen**: `users/<userId>/avatar/<uuid>` — a fresh `randomUUID()` per upload. Commit order:
  `FileStorage.save(newKey, tempPath)` → `UpdateUserAvatarCommand` writes the new key/type/size/
  timestamp → the **previous** key's bytes are deleted best-effort, failure logged (count only, never
  a key). Removal is the mirror: clear the columns first, then delete the bytes.
- **Why**: with a fixed key, a failed write leaves the row pointing at half-overwritten bytes and
  every cache (browser, proxy) keeps serving the old image under the same URL. A fresh key makes the
  swap atomic from the reader's side: the row points at either the old key or the new one, never at
  a partially written file. Clearing the row before deleting bytes means an interrupted removal
  leaves unreachable bytes rather than a row pointing at nothing — the safe direction, and the same
  reasoning `FilesService.create` uses when it unlinks on failure.
- **Rejected**: fixed key (torn writes, stale caches); content-hash key (deduplication nobody asked
  for, and two users sharing one blob makes "no longer served" untrue for the other).
- **Exposure**: keys are server-generated UUIDs under a per-user prefix and never leave the server
  (D-5), so there is no user-controlled segment to traverse with. Orphaned bytes are unreachable — no
  row references them — and are the one loose end this decision accepts (see Risks); they arise two
  ways, not one: a delete that fails **and** two uploads for the same account that interleave between
  reading the old key and writing the new one, the second of which this line missed until S-5 named
  it (round 2).
- **Fits in at**: `apps/api/src/profile/profile.service.ts`, over `FileStorage` from D-4.
- **Sources**: `apps/api/src/files/files.service.ts` (create/save/unlink ordering),
  `.claude/modules/module-api-files.md`.

### D-8. How are the bytes served, and how does a replaced image stop showing?

- **Plan tasks**: 3.5, 4.2, 4.5
- **Options**: stream via `res.sendFile` with `private, no-store` · serve with a short private
  `max-age` · a signed time-limited URL.
- **Chosen**: `GET /profile/avatar` (guarded) resolves the key from the caller's own row and sends
  the bytes with `Content-Type` from `avatarMimeType`, `Content-Disposition: inline`,
  `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`; `404` when the account
  has no avatar. The page requests it as `/api/profile/avatar?v=<avatarUpdatedAt epoch ms>` so a
  replacement changes the URL even if an intermediary ignores `no-store`.
- **Why**: it is the meeting-file content route's own shape, including the two non-obvious parts —
  `Cache-Control` set explicitly before `sendFile` (`send` writes `public, max-age=0` when the
  header is absent, marking a private image storable by a shared cache) and splitting the resolved
  path into `root` + bare basename so `send`'s `dotfiles` check never sees `STORAGE_ROOT`'s `.data`
  segment. A private `max-age` would let a removed avatar keep rendering from the browser's own cache
  after AC-9 says it is gone; signed URLs would add a signing mechanism for a resource that is
  already behind a guard.
- **Rejected**: short private `max-age` (contradicts AC-6/AC-9's "no longer served" inside the same
  browser); signed URLs (a mechanism, and a second authorization path, for no gain here).
- **Exposure**: the route is the only way to bytes, and it reads the key from the authenticated
  caller's row — there is no id parameter to swap (AC-15). `nosniff` plus a three-format accepted set
  keeps the response from being interpreted as anything but an image. The cost is one API request
  per rendered page that shows an avatar; on a local Postgres/disk that is sub-millisecond.
- **Fits in at**: `apps/api/src/profile/profile.controller.ts`;
  `apps/web/src/app/api/profile/avatar/route.ts` (D-12).
- **Sources**: `apps/api/src/files/files.controller.ts`, `.claude/modules/module-api-files.md`
  (Access control: `Cache-Control` and the `dotfiles`/`root` split),
  `apps/web/src/lib/api-proxy.ts` (`cache-control` is in the forwarded response allow-list).

### D-9. How does a password change end every other session?

- **Plan tasks**: 5.4, 5.5, 6.4
- **Options**:

| Option                                           | Pros                                          | Cons                                                                                                       | Cost   | Risk   |
| ------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ | ------ |
| `tokenVersion` column + `ver` claim (**chosen**) | exact; no ambiguity about which tokens die    | one indexed primary-key lookup on every guarded request                                                    | low    | low    |
| `passwordChangedAt` vs the token's `iat`         | no new claim                                  | `iat` has one-second resolution, so a token minted in the same second as the change survives               | low    | medium |
| Redis denylist                                   | no per-request database read                  | Redis is optional infrastructure project-wide — a revocation list that may be unreachable is not a control | medium | high   |
| Opaque server-side sessions replacing the JWT    | strongest, and a device list becomes possible | rewrites `auth`, every guarded route and the whole web session layer                                       | high   | high   |

- **Chosen**: `tokenVersion Int @default(0)` on `User`; `AuthService` signs
  `{ sub, email, ver }`; `JwtStrategy.validate` dispatches `FindUserByIdQuery(payload.sub)` and
  throws `UnauthorizedException` unless the user exists and `(payload.ver ?? 0) === user.tokenVersion`.
  `UpdateUserPasswordCommand` writes the new hash and `tokenVersion: { increment: 1 }` in one
  `UPDATE`.
- **Why**: AC-13 says the other sessions are refused **on their next request**, and nothing that
  avoids a per-request read can promise that. The user accepted the read explicitly. Treating a
  missing `ver` claim as `0` keeps every token issued before this ships valid until its own `exp` —
  no forced sign-out on deploy — while any password change afterwards invalidates it. The lookup
  also removes today's quieter bug: a deleted user's token currently stays valid until it expires.
- **Rejected**: `passwordChangedAt` vs `iat` (a one-second window in which a just-stolen token
  survives the change meant to kill it); a Redis denylist (the root `CLAUDE.md` forbids anything
  hard-depending on Redis, and a best-effort revocation list is not a security control); opaque
  sessions (the user rejected the scope).
- **Exposure**: the check turns a stolen or leaked token from "valid for up to an hour" into "valid
  until the owner changes their password". It also puts a database read on the authentication path of
  every guarded request, which is a DoS amplifier if it is ever unbounded — the global throttler
  (20 req/60 s per credential) is what bounds it, and the lookup is a primary-key read.
- **Fits in at**: `apps/api/src/auth/strategies/jwt.strategy.ts` (gains `QueryBus`),
  `apps/api/src/auth/auth.service.ts` (the claim), `apps/api/src/users/commands/`,
  `apps/api/prisma/schema.prisma`.
- **Sources**: `apps/api/src/auth/strategies/jwt.strategy.ts`, `apps/api/src/auth/auth.service.ts`,
  root `CLAUDE.md` (Redis is optional infrastructure), user's answer of 2026-08-17.

### D-10. Where does the fresh token for the changing session come from?

- **Plan tasks**: 5.5
- **Options**: export `AuthService` and inject it · a CQRS command in `auth` · re-sign inside
  `profile` with its own `JwtService`.
- **Chosen**: `IssueAccessTokenCommand(userId, email, tokenVersion)` — a command handler in the
  **auth** module that owns the claim set and the signing; `AuthService.register`/`login` use it
  too, so `{ sub, email, ver }` is written in exactly one place. The password route returns
  `{ accessToken }`, the same `AuthResponseDto` shape login already returns.
- **Why**: every other cross-module call in this domain is a command or a query, and a second
  `JwtService` consumer inside `profile` would be a second place where the claim set could drift
  from what `JwtStrategy` checks — the precise failure that would silently break D-9.
- **Rejected**: exporting `AuthService` (it is an orchestration service, not a shared one);
  signing inside `profile` (duplicates the claim set).
- **Exposure**: token minting stays behind one handler, so there is one place to audit for what ends
  up in a token — and `ver` cannot be omitted by accident on one path.
- **Fits in at**: `apps/api/src/auth/commands/issue-access-token.{command,handler}.ts`, registered
  in `auth.module.ts`.
- **Sources**: `apps/api/src/auth/auth.service.ts`, `.claude/modules/module-api-auth.md`.

### D-11. What does the password route look like, and what does a wrong current password answer?

- **Plan tasks**: 5.2, 5.3, 6.2, 6.4
- **Options**: `401` · `403` · `400` for a wrong current password.
- **Chosen**: `PATCH /profile/password`, body
  `{ currentPassword, newPassword }`, verified with `VerifyPasswordQuery` (the timing-safe path) and
  hashed with `HashPasswordCommand`; `newPassword` reuses `RegisterDto`'s bounds and
  `PASSWORD_COMPLEXITY_REGEX`. A wrong current password answers **403 Forbidden**, not 401.
- **Why**: `apps/web` treats a `401` from `apps/api` as "the session is gone" and redirects to
  `/login` — that is how the home page handles an expired token today, and D-9 makes 401 the
  revoked-token answer too. If a mistyped current password also answered 401, the user would be
  signed out for a typo, and phase 6's "revoked → `/login`" rule could not tell the two apart. 403
  says "you are authenticated, this is refused", which is exactly the state. The confirmation field
  is a web-side concern (AC-12) and is not part of the API body, matching how `RegisterDto` has no
  `confirmPassword`.
- **Rejected**: `401` (would sign the user out on a typo and collide with D-9's revocation answer);
  `400` (reads as malformed input, and the field is well-formed — it is simply wrong).
- **Exposure**: this route is a credential oracle by construction — it says whether a supplied
  password is the account's. The controls are the timing-safe verification it inherits, a stricter
  throttle than the global one (Parameters), and the fact that reaching it already requires a valid
  session for that same account.
- **Fits in at**: `apps/api/src/profile/dto/change-password.dto.ts`,
  `apps/api/src/profile/profile.controller.ts`; on the web, `apps/web/src/lib/profile-api.ts`
  distinguishes 403 (form error) from 401 (signed out).
- **Sources**: `apps/api/src/auth/dto/register.dto.ts`, `.claude/modules/module-api-credentials.md`,
  `.claude/modules/module-web-auth.md` (a 401 from `listMeetings` redirects to `/login`).

### D-12. How does the browser send an avatar, and how does it send the name and password?

- **Plan tasks**: 2.4, 4.2, 4.3, 4.4, 6.2
- **Options**: everything through Server Actions · bytes through a Route Handler proxy, fields
  through Server Actions · everything through Route Handlers.
- **Chosen**: **bytes** (`POST`/`GET`/`DELETE` avatar) go through a same-origin proxy Route Handler
  at `apps/web/src/app/api/profile/avatar/route.ts` built on `proxyToApi`; **fields** (name, password)
  go through Server Actions, as `/register` and `/login` already do.
- **Why**: Next 16.3.1 caps a Server Action's request body at **1 MB by default** — the PRD's avatar
  limit is 5 MB, so an avatar through a Server Action would fail on most real uploads unless
  `serverActions.bodySizeLimit` were raised, which would raise the ceiling for _every_ action in the
  app, not just this one. The proxy is also the project's existing answer for bytes: it attaches the
  bearer token server-side, drops the caller's `Authorization`, and is the tier `apps/web/CLAUDE.md`
  says integration specs must pin. Fields are small, benefit from progressive enhancement, and
  `revalidatePath` after the action is what refreshes the dashboard.
- **Rejected**: everything through Server Actions (raises a global body limit to solve one route,
  and gives up the proxy's header allow-list); everything through Route Handlers (loses no-JS form
  submission for the name and password forms).
- **Exposure**: the proxy is **one** of two seams where a session token could leak; `proxyToApi`
  already refuses before any upstream call when there is no session, forwards only three request
  headers, and never echoes the caller's own `Authorization`. Nothing about the avatar changes that
  contract — the route passes `/profile/avatar` with no caller-controlled path segment at all. The
  second seam, which this line missed until S-6 named it (round 2), is the **return value** of a
  Server Action: it is serialised into the page payload, so an action that returns the API's
  response object — the password route's `{ accessToken }` above all — publishes a live token to the
  browser, where `httpOnly` protects nothing. Actions return `{ ok }` / `{ error }`, never upstream
  bodies. Reachability of the actions themselves is S-3's control, not this line's.
- **Fits in at**: `apps/web/src/app/api/profile/avatar/route.ts`,
  `apps/web/src/app/actions/profile.ts`, `apps/web/src/lib/profile-api.ts`.
- **Sources**: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`
  ("By default, the maximum size of the request body sent to a Server Action is 1MB"),
  `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
  `apps/web/src/lib/api-proxy.ts`, `apps/web/src/app/api/meetings/[meetingId]/files/route.ts`.

### D-13. What renders the avatar and its placeholder?

- **Plan tasks**: 2.3, 4.5
- **Options**: HeroUI `Avatar` (plain `<img>`) · `next/image` · `next/image` with `unoptimized`.
- **Chosen**: HeroUI's `Avatar` compound component — `Avatar.Image` with the proxy URL when
  `hasAvatar`, `Avatar.Fallback` (initials from the name, else the email's first letter) when not —
  at a fixed rendered size so no layout shift occurs.
- **Why**: `next/image` routes the source through `/_next/image`, which fetches it **server-side
  without the browser's cookies** — the same-origin proxy would answer `401` and no image would ever
  render; the optimizer would also write derivatives of a private image into the build cache. HeroUI
  is already this app's component library (`apps/web/CLAUDE.md`), 3.2.4 ships `Avatar` with
  `Avatar.Image`/`Avatar.Fallback`, and using it keeps the placeholder consistent with the rest of
  the UI instead of hand-rolling one.
- **Rejected**: `next/image` (breaks on a cookie-authenticated source); `next/image unoptimized`
  (all of the constraint, none of the benefit).
- **Exposure**: an `<img>` cannot execute its payload, and the accepted formats exclude SVG (D-6),
  so a hostile file cannot become script. The fallback derives from the name — already escaped as
  text (AC-16).
- **Fits in at**: `apps/web/src/components/profile/user-avatar.tsx`, used by
  `app/profile/page.tsx` and `app/page.tsx`.
- **Sources**: `node_modules/@heroui/react/dist/components/avatar/index.d.ts` (v3.2.4),
  `apps/web/CLAUDE.md` (Conventions: HeroUI v3 compound components), `apps/web/src/app/icon.tsx`.

## 5. Parameters and limits

Values implementation copies verbatim.

| Name                                 | Value                                                                                                                                                                                   | Where                                                               | Source                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `MAX_NAME_LENGTH`                    | `80`                                                                                                                                                                                    | `profile.constants.ts`, `@db.VarChar(80)`                           | PRD AC-2/AC-3                                                                              |
| Name normalisation (order matters)   | strip `U+0000`–`U+001F` and `U+007F`, then the bidi overrides/embeddings/isolates `U+202A`–`U+202E` and `U+2066`–`U+2069`; **keep** `U+200E`/`U+200F`; then trim; then `@MaxLength(80)` | `update-profile.dto.ts` `@Transform`, beside `normalizeEmail`       | S-4's sibling S-2 needs it (round 2); C0 rule from `FilesService`'s filename normalisation |
| `MAX_AVATAR_BYTES`                   | `5_242_880` (5 MiB)                                                                                                                                                                     | `profile.constants.ts`, multer `limits.fileSize`, `AvatarSizeGuard` | PRD "5 MB"; binary reading matches `MAX_FILE_BYTES = 524_288_000`                          |
| `ACCEPTED_AVATAR_MIME_TYPES`         | `png → image/png`, `jpg → image/jpeg`, `webp → image/webp`                                                                                                                              | `profile.constants.ts`, passed to `FileTypeService.detect`          | PRD AC-8; all three detectable by `file-type@21.3.4`                                       |
| `AVATAR_UPLOAD_IDLE_TIMEOUT_MS`      | `60_000`                                                                                                                                                                                | `AvatarSizeGuard` via `request.setTimeout`                          | mirrors `UPLOAD_IDLE_TIMEOUT_MS`                                                           |
| Avatar storage key                   | `users/<userId>/avatar/<randomUUID()>`                                                                                                                                                  | `profile.service.ts`                                                | D-7                                                                                        |
| 413 message                          | `Avatar exceeds the 5 MB limit.`                                                                                                                                                        | `profile.constants.ts`                                              | shape of `FILE_SIZE_LIMIT_MESSAGE`                                                         |
| 415 message                          | `Unsupported image type. Accepted types: png, jpg, webp.`                                                                                                                               | `profile.constants.ts`                                              | shape of `UNSUPPORTED_TYPE_MESSAGE`                                                        |
| 400 name message                     | `Name must be 80 characters or fewer.`                                                                                                                                                  | `update-profile.dto.ts`                                             | AC-3                                                                                       |
| 403 message                          | `Current password is incorrect.`                                                                                                                                                        | `profile.service.ts`                                                | AC-11, D-11                                                                                |
| New-password rules                   | 8–72 chars, `PASSWORD_COMPLEXITY_REGEX` (≥1 lower, ≥1 upper, ≥1 digit)                                                                                                                  | `change-password.dto.ts`                                            | reused from `RegisterDto`                                                                  |
| Throttle — `PATCH /profile/password` | `{ limit: 10, ttl: 60_000 }`                                                                                                                                                            | route `@Throttle`                                                   | mirrors `/auth/login`; **ratified** by S-4 and promised as AC-20, round 2                  |
| Throttle — avatar `POST`/`DELETE`    | `{ limit: 30, ttl: 60_000 }`                                                                                                                                                            | route `@Throttle`                                                   | between login and file upload (60/60 s); **ratified** — S-5 is held partly on it, round 2  |
| Throttle — avatar `GET`              | `{ limit: 240, ttl: 60_000 }`                                                                                                                                                           | route `@Throttle`                                                   | matches the file content route — it is fetched on every page render                        |
| Schema — `User`                      | `name String? @db.VarChar(80)`, `avatarKey String? @unique`, `avatarMimeType String? @db.VarChar(64)`, `avatarSize Int?`, `avatarUpdatedAt DateTime?`, `tokenVersion Int @default(0)`   | one migration, `add_user_profile`                                   | D-2, D-5, D-9                                                                              |
| JWT payload                          | `{ sub, email, ver }`; a missing `ver` reads as `0`                                                                                                                                     | `issue-access-token.handler.ts`, `jwt.strategy.ts`                  | D-9, D-10                                                                                  |
| API routes                           | `GET /profile`, `PATCH /profile`, `PATCH /profile/password`, `POST /profile/avatar`, `GET /profile/avatar`, `DELETE /profile/avatar`                                                    | `profile.controller.ts`                                             | D-1                                                                                        |
| Web routes                           | page `/profile`; proxy `/api/profile/avatar` (`GET`/`POST`/`DELETE`)                                                                                                                    | `apps/web/src/app/`                                                 | D-12                                                                                       |
| Avatar cache headers                 | `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`                                                                                    | `profile.controller.ts`                                             | D-8                                                                                        |
| Avatar URL cache-buster              | `?v=<avatarUpdatedAt epoch ms>`                                                                                                                                                         | `user-avatar.tsx`                                                   | D-8                                                                                        |
| New env vars                         | **none** — `STORAGE_ROOT`, `JWT_SECRET`, `API_BASE_URL` all reused                                                                                                                      | —                                                                   | `.env.example`                                                                             |

## 6. Dependencies

**No new dependencies required.** Every mechanism above is built from what is already installed:

| Need                          | Covered by                                                                                                                                                 | Already present because                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Multipart upload              | `multer@2.2.0` + `@nestjs/platform-express`                                                                                                                | meeting-file-upload                                 |
| Content-based type sniffing   | `file-type@21.3.4` via `load-esm@1.0.3`                                                                                                                    | meeting-file-upload; detects all three avatar types |
| Byte storage                  | `FileStorage`/`LocalDiskFileStorage` (moving, D-4)                                                                                                         | meeting-file-upload                                 |
| Password hashing/verification | `bcrypt@6.0.0` behind the credentials module                                                                                                               | auth                                                |
| Token signing/verifying       | `@nestjs/jwt@11.0.2`, `passport-jwt@4.0.1`                                                                                                                 | auth                                                |
| Random keys                   | `node:crypto`'s `randomUUID`                                                                                                                               | Node 24                                             |
| Avatar + fallback UI          | `@heroui/react@3.2.4`'s `Avatar`                                                                                                                           | apps/web's component library                        |
| Image resizing                | **not needed** — the PRD puts cropping/resizing out of scope; `sharp@0.35.3` is present only as Next's own transitive dependency and is not to be imported | —                                                   |

## 7. Architecture impact

**New modules**

- `apps/api/src/storage` — `StorageModule` exporting `FileStorage` (bound to `LocalDiskFileStorage`)
  and `FileTypeService`. Owns every path to disk and every content-type judgement in the app
  (D-4). New doc: `.claude/modules/module-api-storage.md`.
- `apps/api/src/profile` — `ProfileModule`/`ProfileController`/`ProfileService` plus DTOs, the
  avatar guard and multer config (D-1, D-6). New doc:
  `.claude/modules/module-api-profile.md`.
- `apps/web/src/app/profile` + `app/api/profile/avatar` + `components/profile/` +
  `lib/profile-api.ts` + `app/actions/profile.ts` (D-12, D-13). New doc:
  `.claude/modules/module-web-profile.md`.

**Existing modules touched**

- `src/files` — loses `storage/` and `file-type.service.ts` to `StorageModule`, imports it instead;
  passes its own accepted-MIME map into `detect`. No behaviour change, and its three suites are the
  proof (D-4).
- `src/users` — four new commands/queries, no new exports (D-3).
- `src/auth` — `IssueAccessTokenCommand` handler, the `ver` claim, and `JwtStrategy` gaining a
  `QueryBus` lookup (D-9, D-10). This is the one change that touches **every guarded route** in the
  app.
- `apps/web` — `app/page.tsx` gains the name and avatar; `lib/session.ts` is unchanged (the cookie
  is rewritten by the password action through the existing `setSessionCookie`).

**Docs to update in the same change**: `.claude/modules/INDEX.md` (three new rows),
`module-api-files.md`, `module-api-users.md`, `module-api-auth.md`, `module-web-auth.md`,
`apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` (Structure + Status), both app `HISTORY.md` files and
the root one. `README.md` and `.env.example` need **no** change — no new script, service or env var.

## 8. Risks and open questions

- **The `src/storage` extraction touches a shipped feature.** Three subtleties must survive it
  verbatim: `resolveStorageRoot()` staying a lazy `process.env` read (it runs before `.env` loads),
  the `0o700`/`0o600` modes, and `--experimental-vm-modules` on both api test scripts for
  `load-esm`. Fallback if the move turns out worse than expected: `FilesModule` exporting both
  providers (D-4's rejected option) is a two-line retreat that leaves every other decision intact.
- **D-9 puts a database read on every guarded request.** If it ever shows up in latency, the
  documented next step is a short-TTL cache keyed by user id — but only behind a Redis-optional
  fallback, and it would weaken AC-13 from "next request" to "within the TTL", which is a PRD
  change, not a research one.
- **Orphaned avatar bytes.** A failed delete after a successful row update — or two uploads for the
  same account interleaving between the read of the old key and the write of the new one (S-5,
  round 2) — leaves unreachable bytes
  on disk. No user-visible effect and no quota to breach (avatars are outside the meeting-file
  accounting, D-5); a sweep could later be added to the existing `FilesPurgeService`, which already
  sweeps `<STORAGE_ROOT>/tmp`. Not planned in this iteration.
- **`no-store` costs one API round trip per rendered avatar** (D-8). Acceptable locally; if it
  becomes visible in production it is a caching decision to revisit with real numbers, not now.
- **Tokens issued before this ships carry no `ver`.** They are read as version `0` and stay valid to
  their own `exp`, so nobody is signed out by the deploy — and the first password change after it
  still revokes them. The e2e suites that mint tokens through the API get the claim automatically.

## 9. Plan impact

Revised, in place, every task number preserved. Six changes, all inside existing phases:

- Every phase gained its `**Decisions**:` line.
- **3.3** now names the `src/storage` extraction as the way the `FileStorage` boundary becomes
  reachable from `profile` (D-4), and **3.4** names `FileTypeService`'s accepted-set parameter
  (D-4, D-6). Phase 3's **Done when** gained the files suites staying green after the move.
- **1.2** names the exact columns and the migration (D-2, D-5); **1.3** notes that
  `FindUserByIdQuery` is what phase 5's guard reuses (D-3, D-9).
- **5.4** names `tokenVersion` + the `ver` claim + the `JwtStrategy` lookup (D-9); **5.5** names
  `IssueAccessTokenCommand` and the returned token (D-10).
- **6.2** and **6.4** name the 403-vs-401 split the web layer has to respect (D-11).
- **4.2** names the proxy route as the reason a Server Action cannot carry the bytes (D-12);
  **2.3**/**4.5** name HeroUI's `Avatar` and its fallback (D-13).

**Handed back rather than written**: D-4's extraction is folded into tasks 3.3 and 3.4 instead of
becoming task 3.7, because phase 3 already carries five building tasks and a sixth would break the
plan's own ceiling — splitting the phase is the user's call, not this stage's. If the extraction
should be its own phase (a "3. Lift the byte primitives out of `src/files`" before the avatar work),
say so and `plan-phase` can re-cut; nothing else in this document changes.

## Asked & assumed

- **Asked** — AC-13 requires refusing another session on its very next request, which no mechanism
  can promise without a per-request check → the user chose the database read on every guarded
  request (`tokenVersion` + `ver` claim), over a 10-second cache (weakens AC-13) and over opaque
  server-side sessions (rewrites auth).
- **Asked** — How `files` and `profile` should share `FileStorage` and `FileTypeService`, neither of
  which `FilesModule` exports → the user chose extracting them into a new `src/storage` module, over
  exporting them from `FilesModule` and over duplicating them.
- **Assumed** — "5 MB" in the PRD means 5 MiB (`5_242_880`), the same binary reading the shipped
  `MAX_FILE_BYTES = 524_288_000` uses · if it means 5 000 000 bytes, it is one constant and three
  message strings.
- **Assumed** — The avatar sits outside the meeting-file quota accounting (20 GB per owner) · if it
  should count, `FilesService.ownerTotal` gains the avatar column and D-5's schema stays as it is.
- **Assumed** — The profile's three sections live on one route, `/profile`, as the plan assumes ·
  splitting them changes only D-12's action/route inventory.
- **Assumed** — The throttle numbers in Parameters are proposals inheriting from comparable existing
  routes; `security-analyse` owns the final values, as the PRD already deferred. **Settled in
  round 2**: 10/60 s ratified by S-4 and promised as AC-20, 30/60 s ratified by S-5.
- **Assumed** (round 2) — Name normalisation strips the bidi **overrides, embeddings and isolates**
  (`U+202A`–`U+202E`, `U+2066`–`U+2069`) but keeps the plain marks `U+200E`/`U+200F`, because those
  two are how a legitimate Hebrew or Arabic display name sets its direction · if the marks should go
  too, it is one character class in the transform and one more unit case; if nothing but C0 should
  be stripped, S-2's "a bidi override in, clean text out" case in task 1.1 has to go with it.

## Revisions

<!-- One line per revision round: what moved and the S-<n> behind it, or that nothing did. -->

- 2026-08-17 — round 2: read S-1…S-6 against D-1…D-13. **No decision superseded and no new one
  taken** — trigger 1 (mechanism cannot carry the control) and trigger 3 (control needs a mechanism
  nobody chose) fired on nothing: every one of the six controls is implementable on what D-1…D-13
  already chose, and S-1's own parameter — the response DTO's field set — is already in D-5.
- 2026-08-17 — round 2: trigger 2 — added the **Name normalisation** row to Parameters; S-2's
  control strips control characters before the length check and this file named no set to strip.
  The C0 half follows `FilesService`'s filename rule; the bidi half keeps `U+200E`/`U+200F` so an
  RTL name survives (see Asked & assumed).
- 2026-08-17 — round 2: trigger 2 — the password (10/60 s) and avatar write (30/60 s) throttle rows
  shipped marked "proposed, `security-analyse` owns the final number". It does now: S-4 ratified the
  first and AC-20 promises it, S-5 is held partly on the second. Values unchanged, sourcing fixed.
- 2026-08-17 — round 2: trigger 5 — D-7's **Exposure** named only a failed delete as the way bytes
  are orphaned; S-5 found the second, a concurrent-upload interleave. Line corrected, choice
  untouched; §8's risk bullet follows it.
- 2026-08-17 — round 2: trigger 5 — D-12's **Exposure** treated the proxy as the only seam a token
  could leak through; S-6 found the second, a Server Action's return value being serialised into the
  page payload. Line corrected, choice untouched.
