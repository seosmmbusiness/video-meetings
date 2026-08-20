# History — apps/api

How this app reached its current shape, newest first. `CLAUDE.md`'s Status section says only where things stand **now**; this file says how they got there and why.

Repo-wide changes (tooling, conventions, cross-app features) live in the root [`HISTORY.md`](../../HISTORY.md); per-module architecture and function references live in `docs/modules/`. This file records the decisions behind this app's shape — keep it to what a future reader would ask "why is it like this?" about.

**How to keep it:** one `### YYYY-MM-DD — <short title>` entry per change, newest first, grouped under its `## YYYY-MM` heading; say what changed and why; date by when it landed on the base branch; never rewrite older entries. See the root `HISTORY.md` for the full convention.

---

## 2026-08

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
