# History — apps/api

How this app reached its current shape, newest first. `CLAUDE.md`'s Status section says only where things stand **now**; this file says how they got there and why.

Repo-wide changes (tooling, conventions, cross-app features) live in the root [`HISTORY.md`](../../HISTORY.md); per-module architecture and function references live in `docs/modules/`. This file records the decisions behind this app's shape — keep it to what a future reader would ask "why is it like this?" about.

**How to keep it:** one `### YYYY-MM-DD — <short title>` entry per change, newest first, grouped under its `## YYYY-MM` heading; say what changed and why; date by when it landed on the base branch; never rewrite older entries. See the root `HISTORY.md` for the full convention.

---

## 2026-08

### 2026-08-23 — A password change that ends every other session (`user-profile` phase 5)

`PATCH /profile/password` takes `{ currentPassword, newPassword }`, and changing a password now revokes every other token the account holds. Four decisions are worth the space.

**A counter on the row, not a timestamp and not Redis** (D-9). `User.tokenVersion` becomes a `ver` claim on every token, and `JwtStrategy.validate` looks the subject's row up on every guarded request and refuses unless the row exists and `(payload.ver ?? 0) === user.tokenVersion`. The alternative of comparing `passwordChangedAt` against the token's `iat` was rejected on resolution: `iat` counts whole seconds, so a token minted in the same second as the change survives the change meant to kill it. A Redis denylist was rejected on a project rule — Redis is optional infrastructure here, and a revocation list that may be unreachable is not a security control. Opaque server-side sessions were out of scope. What this buys is exactly what AC-13 promises: the other sessions are refused **on their next request**, which nothing that avoids a per-request read can promise. What it costs is one primary-key read on the authentication path of every guarded route, accepted explicitly. A missing `ver` reads as `0` so tokens issued before this shipped stay valid until their own `exp` rather than signing everyone out on deploy, and the same lookup closes a quieter old hole: a deleted account's token used to stay valid for up to an hour.

**One place mints tokens** (D-10). `IssueAccessTokenCommand(userId, email, tokenVersion)` in `src/auth` owns the claim set, and register, login and the password route all go through it. Migrating the two existing flows was not optional housekeeping: had they kept signing without `ver`, every fresh login for an account that had ever changed its password would be refused, because the missing claim reads as `0` against a `tokenVersion` of `1`. A second `JwtService` consumer inside `profile` was rejected for the same reason — it is a second place the claim set could drift from what the strategy checks.

**A wrong current password answers `403`, not `401`** (D-11). `apps/web` reads a `401` from this API as "the session is gone" and redirects to `/login`, and D-9 has just made `401` the revoked-token answer as well. A typo answering `401` would sign the user out for a typo, and phase 6 could not tell the two states apart. `400` was rejected too — the field is well-formed, it is simply wrong. The refusal happens before anything is hashed or written, so a refused attempt changes nothing and ends no session.

**The route carries `/auth/login`'s throttle, 10 per 60 s** (S-4). It answers whether a supplied password is the account's, which makes it a password oracle behind one stolen session — and each guess costs a 12-round bcrypt comparison. The global 20/60 s is not a control for that. Alongside it, the password rules moved out of `RegisterDto` into `dto/password-rules.ts` so the change route holds the new password to _exactly_ what registration enforces; a rule enforced in one place and not the other is a way in, and two copies drift (AC-12). The refusal message stays with each DTO, because it names the field it refused.

The write itself is one `UPDATE`: `UpdateUserPasswordCommand` sets the hash and `tokenVersion: { increment: 1 }` together, with Prisma's atomic increment rather than a read-modify-write, so two concurrent changes both count. A committed hash with an uncommitted increment would leave every other session alive against a password its holder no longer knows. The fresh token is signed **after** that write, from the counter the write returned, and it is the only thing the response carries — the row it was built from holds the new hash and the counter, and neither has any business on the wire (S-1, AC-18).

### 2026-08-21 — A shared storage module, and one avatar per account (`user-profile` phase 3)

The avatar routes needed bytes, and the bytes lived inside the meeting-files feature. Rather than have `FilesModule` export `FileStorage` and `FileTypeService` — which would make a self-service profile route import that feature's controller, its hourly purge cron and its quota reservation service — the four byte primitives moved into a new `src/storage` module: `FileStorage`, `LocalDiskFileStorage`, `resolveStorageRoot()` and `FileTypeService` (D-4). The third option, a second disk path and a second sniffer inside `profile`, is exactly the duplication the `FileStorage` boundary exists to prevent. `FileTypeService` gained one parameter in the move — the accepted MIME set — so `files` passes its twelve types and `profile` its three, one detector with two policies instead of two detectors to keep in step. The stated risk was the move itself, not the result: the files suites passed unchanged, which is what proves the `0o700`/`0o600` modes, the `tmp` staging and the lazy `resolveStorageRoot()` survived the extraction byte-for-byte.

On top of it, `POST`/`GET`/`DELETE /profile/avatar`. Three things are worth the space:

**Four nullable columns on `User`, not a `UserAvatar` table** (D-5). The relationship is 1:1 and the PRD rules out history, so a table would carry one row per user forever to express what four columns express; `MeetingFile` was the wrong home too, since its soft-delete/purge lifecycle and the 20-file/20 GB accounting are precisely what an avatar must not have. The columns are written and cleared as one group, and the response DTO exposes `hasAvatar` — derived from the key's _presence_ — rather than the key, so `STORAGE_ROOT`'s layout never reaches the wire (S-1).

**A fresh `randomUUID()` key per upload, committed in a fixed order** (D-7): `save` the bytes → write the columns → delete the _previous_ key's bytes, best-effort, logged as a count and never as a key. A fixed key per user was rejected because a failed write leaves the row pointing at half-overwritten bytes and every cache keeps serving the old image under an unchanged URL; a fresh key makes a replacement atomic from the reader's side. Removal is the mirror — columns first, bytes after — so an interruption leaves unreachable bytes rather than a row pointing at nothing. The accepted residual is an orphaned object when a delete fails (S-5, low: it is bounded by the same 5 MB the upload was, and no route resolves to it).

**`Cache-Control: private, max-age=60`, not the research's `no-store`.** That is T-1's ruling in the final plan, and it is the one place the implementation deliberately departs from `-RESEARCH.md`: 60 seconds spares a re-fetch per rendered page while still being short enough that a removed avatar stops rendering. The header is set explicitly before `res.sendFile` for the same reason the meeting-file route does it — `send` writes `public, max-age=0` when it is absent, marking one owner's private image storable by a shared cache — and the path is split into `root` + bare basename so `send`'s `dotfiles` check never sees `STORAGE_ROOT`'s own `.data` segment.

The three refusal gates are the files module's shape minus the quota (an avatar sits outside the per-owner byte ledger, so there is nothing to reserve): declared `Content-Length` at zero bytes read, multer's own `limits.fileSize` for a chunked body that declared nothing, then content detection — which is what makes a PDF renamed `.png` a `415` rather than a stored avatar. SVG is deliberately not in the accepted set: none of PNG, JPEG or WebP is a script container, so the stored bytes cannot become an XSS payload served from our own origin.

### 2026-08-20 — The throttler's baseline reads the environment (`user-profile` phase 2)

The app-wide ceiling of 20 requests per 60 s is no longer a literal in `AppModule`: it reads `THROTTLE_LIMIT`/`THROTTLE_TTL_MS` through `src/config/throttler.config.ts`, defaulting to exactly what it was.

The constraint that forced it came from closing phase 2. Every Playwright fixture registers through `POST /auth/register`, which is unauthenticated — so `getTracker` falls back to the IP, the whole browser suite shares one bucket, and the suite finishes inside one 60-second window. On `main` that was already 20 registrations against a ceiling of 20; the four the phase added made 24, and three cases answered `429` regardless of which spec owned them. The alternative — rewriting the earlier phases' specs to share fixture accounts — was rejected: it buys headroom once, costs a rewrite of tests that are not what changed, and phases 4 and 6 would spend it again.

Two things are deliberately not configurable. The **route-level** overrides (login's `limit: 10`, the upload and download caps) stay in the code, because those model the controls the threat analysis leans on, and only the shared baseline is what test ergonomics collide with. And every unusable value — blank, non-numeric, zero, negative, fractional, `20req` — lands on the default rather than on something permissive, so a typo in a deployed environment cannot silently widen or disable the guard. `ThrottlerModule` is registered with `forRootAsync` for a mundane reason worth writing down: `ConfigModule.forRoot()` is what loads the root `.env`, and it has not run while `AppModule`'s metadata is being built, so an eager registration reads the default and ignores the environment entirely — which is what the integration spec pins.

### 2026-08-18 — A profile module for the caller's own account name (`user-profile` phase 1)

`GET /profile` and `PATCH /profile` live in a new `src/profile` module rather than in `src/users` or `src/auth` (D-1). `users` states it has no HTTP surface of its own and exposes persistence only over CQRS, so a controller there would break its own contract; and a display name is not authentication, so folding it into `auth` would give the module every route's guard depends on a third unrelated concern. The new module has the same shape `auth` already has: a controller and a service over the CQRS buses, no Prisma of its own — reaching `User` through two new users-module handlers, `FindUserByIdQuery` and `UpdateUserNameCommand` (D-3).

Both routes resolve their subject from `@CurrentUser()` alone. There is deliberately no path segment and no body field naming an account, so there is no identifier to point at another row — the authorization decision happens before the bus, and no handler is reachable with someone else's id.

Two things are less obvious and worth keeping. First, `FindUserByIdQuery` returns the **whole** Prisma row, because `JwtStrategy` will read `tokenVersion` off the same query later — which makes `ProfileResponseDto` the only thing between the row and the wire, and is why the service builds it field by field and the specs assert an exact key set instead of the absence of `passwordHash`. Second, the name is **normalised, not rejected**: a `@Transform` strips C0 controls, `U+007F` and the bidi overrides (keeping the plain `U+200E`/`U+200F` marks that legitimate Hebrew and Arabic names need) and trims, all before `@MaxLength(80)` runs. Postgres cannot store a NUL in a text column, so without that the route would answer `500` with a driver-shaped message instead of the stated refusal; running it before the length check also means stripped bytes don't count against the limit. It is the same rule `FilesService` already applies to an uploaded file's name.

A third, found in review: an access token stays valid for an hour after the row it names is gone, so `PATCH /profile` could reach a deleted account. Prisma's `P2025` is translated into the same `404` the read path answers, in `UpdateUserNameHandler` — the handler that owns the write, exactly where `CreateUserHandler` already translates `P2002` into a `409`. Doing it there rather than in an exception filter keeps the translation next to the query whose failure modes it knows, and the case is only reachable against a real database, so it is pinned in `users.int-spec.ts` rather than a unit spec.

One migration, `add_user_profile`, adds every column the whole feature needs at once — `name`, the four avatar columns phase 3 fills, and `tokenVersion` for phase 5 — so the schema moves once rather than in five steps. For the same reason the response carries `hasAvatar` and `avatarUpdatedAt` from day one: they answer "no avatar" for every row until phase 3, and `apps/web` gets to render against the final shape.

### 2026-08-16 — Integration tier added between the unit and e2e suites

`test/jest-int.json` + `npm run test:int` run `src/**/*.int-spec.ts`: real Nest modules composed against the dev Postgres, with no HTTP layer. It exists because the two existing tiers left a gap that e2e kept absorbing — anything only a real database proves (Prisma filters, unique and foreign-key constraints, transactions, `@Cron` jobs driven directly, module wiring) had to be reached through supertest or not at all, which is why `files.e2e-spec.ts` reaches into `FilesPurgeService` and `FileStorage` directly.

The three Jest configs stay mutually exclusive by filename: the unit config's `.*\.spec\.ts$` matches neither `*.int-spec.ts` nor `*.e2e-spec.ts`, since both end in `-spec.ts` rather than `.spec.ts`. Seeded by `src/users/users.int-spec.ts`, covering the CQRS create/find round trip and the `P2002` → 409 translation only a real unique index can reach.

Integration and e2e both run against the same dev Postgres rather than a throwaway database — it's already provisioned and migrated, and e2e already used it. The two rules that follow (unique data per run, delete what you created, never truncate) are in `CLAUDE.md`'s Database section.

### 2026-08-16 — Throttler tracked by credential instead of by socket

The global rate limit hashed the socket IP, which collapses every user into one bucket now that `apps/web` calls this API server-to-server through a single origin. It now tracks a `sha256` of the `Authorization` header. The hash rather than the token itself keeps credentials out of throttler storage and logs, and hashing the raw header avoids decoding the JWT twice — `APP_GUARD` guards run before controller guards, so `req.user` isn't populated yet.

### 2026-08-16 — Files module: storage, limits, soft delete and purge (`meeting-file-upload` phases 1–3)

A files module storing, listing and serving a meeting's files, scoped to the meeting's owner, behind an abstract `FileStorage` boundary with a local-disk implementation (`STORAGE_ROOT`, dev default `<repo>/.data/uploads`, required outside development). Every PRD limit is enforced at the route itself, each refusal leaving nothing stored: 500 MB per file, content-sniffed type validation (12 accepted types via `file-type`, plus a text-content rule for `txt`/`md`, so a renamed extension is caught), 20 live files per meeting, and 20 GB per owner counting soft-deleted-but-not-purged bytes.

Two limits needed more than a check. The owner quota is additionally **reserved in-process for the life of an upload**, serialized per owner, because concurrent uploads each pass a persisted-total check that neither would break alone and together blow past it. And the upload route carries its own **60-second inactivity timeout**, distinct from the app's 30-minute total request timeout (itself raised from Node's 300s default, which a legitimate 500 MB upload can exceed) — a total-only timeout can't tell a slow-but-live upload from a stalled socket held open.

Phase 3 added soft delete, restore (refused into an already-full meeting with the same 409 an upload gets) and a deleted-files listing carrying each file's `purgeAt`, with `FilesPurgeService` (`@nestjs/schedule`, hourly `@Cron`) deleting bytes and rows 30 days after deletion and sweeping stale upload temp files.

`file-type` is ESM-only, which is why the `test` and `test:e2e` scripts carry `NODE_OPTIONS=--experimental-vm-modules`.

---

## 2026-07

### 2026-07-30 — Auth split into `auth` / `users` / `credentials` over CQRS

One module was doing token issuance, user persistence and password hashing at once. It became three, talking through `CommandBus`/`QueryBus` rather than direct service injection, each exposing only command/query classes so none of them can reach into another's providers.

This is deliberately **not** the blanket default for every module pair in this app — it's the identity domain, where the three concerns should stay independently replaceable. Elsewhere, plain constructor injection is preferred.

### 2026-07-30 — Meetings module, and the JWT guard it first consumed

`POST /meetings`, `GET /meetings`, `GET /meetings/:id`, all guarded and scoped to the caller. The `JwtAuthGuard`/`JwtStrategy` pair (passport-jwt) was added alongside it in `src/auth` — meetings was the first route set that needed protection, and remains where that guard is documented.

### 2026-07-29 — Email/password auth on Prisma-backed Postgres, hardened the same day

Register and login issuing JWTs, on top of Prisma's `User` model. Hardened immediately against timing-based user enumeration (a dummy hash comparison so a missing user costs the same as a wrong password), concurrent-registration races (the database's unique index is the real guard, its violation translated into the same 409), oversized payloads, and brute force via a stricter throttle on the auth routes.

### 2026-07-28 — Scaffolded, with Swagger and validation from the start

`nest new`, then Prisma against the local Postgres. Two conventions were set here and still hold: a global `ValidationPipe` with `whitelist` and `transform`, so unexpected fields are rejected rather than silently accepted on every route, and `@nestjs/swagger` annotations on every controller, route and DTO, checked against the generated UI after each change.
