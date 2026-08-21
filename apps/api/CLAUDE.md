# apps/api

NestJS 11.2.1 backend, TypeScript.

Why anything here is the way it is: [`HISTORY.md`](HISTORY.md) (repo-wide changes: [root `HISTORY.md`](../../HISTORY.md)).

## Structure

- `src/main.ts` — entry point (Nest bootstrap); mounts a global `ValidationPipe` (`whitelist`, `transform`) so DTO validation (`class-validator`) is enforced on every route, and enables CORS (`app.enableCors`) for `apps/web`'s origin (`CORS_ORIGIN` env var, default `http://localhost:3000`) since the browser calls this API cross-origin in dev.
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — root module/controller/service; `AppModule` wires up `ConfigModule` (global, reading the monorepo-root `.env`), a global `ThrottlerGuard` (`@nestjs/throttler`, 20 requests/60s by default, tracked per caller by hashed `Authorization` header rather than by socket; the baseline — and only the baseline — is configurable via `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`, see `src/config/throttler.config.ts`), `CqrsModule.forRoot()` (once, app-wide), `ScheduleModule.forRoot()` (backing the files purge cron), `PrismaModule`, and the feature modules.
- `src/prisma/` — injectable Prisma client wrapper (`PrismaService`/`PrismaModule`) over Postgres. Architecture + function reference: `docs/modules/module-api-prisma.md` (see root `CLAUDE.md`'s Module documentation section).
- `src/auth/` — authentication orchestration only: register/login flow, JWT issuance/verification, rate limiting. Delegates user persistence to `src/users` and password hashing/verification to `src/credentials`, via CQRS (see Conventions below). Architecture + function reference: `docs/modules/module-api-auth.md` (see root `CLAUDE.md`'s Module documentation section); the JWT verification guard/strategy used to protect routes is documented in `docs/modules/module-api-meetings.md` (added alongside that module, as its first consumer).
- `src/users/` — user persistence (Prisma `User` model): creation, lookup by email or id, the display-name update and the avatar-columns update, exposed only via CQRS commands/queries. Architecture + function reference: `docs/modules/module-api-users.md`.
- `src/credentials/` — password hashing/verification (bcrypt), exposed only via CQRS commands/queries. Architecture + function reference: `docs/modules/module-api-credentials.md`.
- `src/profile/` — the signed-in caller's own self-service routes (`GET`/`PATCH /profile`, and `POST`/`GET`/`DELETE /profile/avatar`), guarded and resolving their subject from the token alone, answering an explicit response DTO that never carries the avatar's storage key. Architecture + function reference: `docs/modules/module-api-profile.md`.
- `src/meetings/` — create/list/get meetings, scoped to the authenticated owner. Architecture + function reference: `docs/modules/module-api-meetings.md`.
- `src/files/` — store, list and serve a meeting's files (upload, download, byte-serving), scoped to the meeting's owner, behind the `FileStorage` boundary `src/storage` owns; enforces every upload limit (size/type/count/quota) and handles soft delete, restore and a scheduled purge. Architecture + function reference: `docs/modules/module-api-files.md`.
- `src/storage/` — the app-wide byte boundary: the abstract `FileStorage` (local-disk backend today), `STORAGE_ROOT` resolution and the content-based `FileTypeService`, imported by `src/files` and `src/profile` alike so neither feature depends on the other. Architecture + function reference: `docs/modules/module-api-storage.md`.
- `prisma/schema.prisma` — Prisma schema (`User`, `Meeting`, `MeetingFile` models), output to `generated/prisma` (gitignored, run `npm run prisma:generate` to produce it locally). Generator/adapter rationale: `docs/modules/module-api-prisma.md`.
- `prisma.config.ts` — Prisma CLI config; loads the monorepo-root `.env` (two levels up, since CLI commands run with cwd=`apps/api`) and points `datasource.url` at `DATABASE_URL`. Build-exclusion gotcha: `docs/modules/module-api-prisma.md`.
- `test/` — e2e tests (Jest, config in `test/jest-e2e.json`), including `test/auth.e2e-spec.ts` and `test/meetings.e2e-spec.ts`, plus the integration tier's config (`test/jest-int.json`). Unit specs live next to their source as `*.spec.ts` (see `src/app.controller.spec.ts`) and integration specs next to theirs as `*.int-spec.ts` (see `src/users/users.int-spec.ts`) — see the Development workflow section for what belongs where.
- Own ESLint config, using `eslint-plugin-prettier` — kept separate from `apps/web`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- API documentation is generated with `@nestjs/swagger`, served at `/api` (or the configured docs path) via `SwaggerModule`. Every controller/route must be annotated (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, etc.) and every DTO must have `@ApiProperty`/`@ApiPropertyOptional` on its fields so the generated schema stays accurate. After adding or changing a module, controller, route, or DTO, run the app and check the Swagger UI to confirm the docs reflect the new/changed behavior before considering the work done — don't let the generated docs drift from the actual API surface.
- `src/auth`, `src/users`, and `src/credentials` talk to each other via CQRS (`@nestjs/cqrs`: `CommandBus`/`QueryBus`) rather than direct service injection — each module exposes only command/query classes, never its providers, to keep them independently testable/replaceable. `CqrsModule.forRoot()` is registered once, globally, in `AppModule`. This is a deliberate choice for this identity-domain boundary, not this project's blanket default for every module pair — elsewhere, prefer the plain constructor-injection composition documented in the `nestjs-best-practices` skill (`arch-single-responsibility`) unless there's a similar reason (independent domains that should stay decoupled) to reach for CQRS again.

## Development workflow (TDD)

This app is developed test-first (design → test → develop), following **Red/Green/Refactor** across the three tiers the root `CLAUDE.md`'s Testing section defines. E2e is the outer loop; unit and integration are the inner one, and both are mandatory — an endpoint whose only coverage is its e2e spec is not finished:

1. Before implementing a feature or change, write/extend the end-to-end tests (`test/*.e2e-spec.ts`) first, covering the intended behavior through real HTTP.
2. Review and refine the test cases with the user — clarify edge cases, add missing scenarios — before writing implementation code. Tests should fail cleanly (**red**) at this point.
3. Work inwards, one unit at a time: for each service, handler, guard, pipe, filter or adapter the scenario needs, write its `*.spec.ts` (or `*.int-spec.ts`, if it needs the database) **red first**, then implement the minimum that turns it **green**. Repeat until the e2e spec from step 1 is green too.
4. **Refactor**: before starting any refactor, run all three suites first and confirm they're fully green on the current code — never refactor against a red baseline. Then refactor in small steps, re-running them after each step to confirm it's still green before moving to the next; stop and fix immediately if a step turns a test red.
5. After any functional change, re-run the unit, integration and e2e suites and confirm they still match the intended behavior.
6. If existing tests need to change because requirements changed, don't just edit them silently — flag it and confirm the new/updated cases with the user first.

**Which tier gets what.** The dividing line is what a spec touches, not what it is about:

- **Unit** (`src/**/*.spec.ts`, `npm run test`) — one provider's own logic with its collaborators stubbed. Construct it directly (`new QuotaReservationService(stubPrisma)`, as `src/files/quota-reservation.service.spec.ts` does) or use `Test.createTestingModule` with the collaborators overridden. No Postgres, no filesystem outside a temp dir, no HTTP. This is where branch-by-branch coverage belongs: error paths, boundary values, message wording, guard decisions.
- **Integration** (`src/**/*.int-spec.ts`, `npm run test:int`) — real modules composed against a real boundary, without the HTTP layer. Build the module under test with `Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), CqrsModule.forRoot(), PrismaModule, TheModule] })` and call `moduleRef.init()`, which is what runs `PrismaService`'s `onModuleInit` and registers the CQRS handlers. This tier owns everything only a real database proves: Prisma queries and their filters, unique/foreign-key constraints (`src/users/users.int-spec.ts` covers the `P2002` → 409 translation), transactions, `@Cron` jobs driven directly, and module wiring. See the Database note below for the shared-database rules it has to follow.
- **E2E** (`test/*.e2e-spec.ts`, `npm run test:e2e`) — the full `AppModule` behind supertest: status codes, response bodies, validation, guards, throttling, and the security cases below. Reserve it for what genuinely needs the whole stack; if an e2e spec is reaching into a provider to set up or assert something (as `files.e2e-spec.ts` does with `FilesPurgeService`), that assertion wants to be an `*.int-spec.ts` instead.

**Security test cases are mandatory, not optional.** Alongside functional behavior, a feature/endpoint must cover: authorization boundaries (a caller can't read/modify another user's resources — IDOR); auth bypass (missing, malformed, or expired JWT against a protected route); injection/mass-assignment edge cases (extra/unexpected fields are rejected by `ValidationPipe`'s `whitelist`, not silently accepted); and rate-limiting/brute-force protection on sensitive endpoints (login, register, etc.). These belong at the tier that actually proves them — the reachability cases through e2e, the decision logic of a guard or validator as a unit spec, an ownership filter that a `where` clause enforces as an integration spec — and they're written before implementation like any other case, not bolted on after. See `apps/web/CLAUDE.md`'s Testing section for the frontend-side equivalent.

**The red state gets committed, not just passed through.** Step 1's specs land in their own `test(api): …` commit, failing, before the `feat(api): …` commit that makes them pass — one task, two commits. A cycle whose specs and implementation arrive together is indistinguishable afterwards from tests written last, and `git log` is the only place that distinction survives.

That is what the git hooks are split for: **`.husky/pre-commit` runs `npm run lint` only**, so a deliberately red spec commits, and **`.husky/pre-push` runs `npm test`** (both apps' unit suites), so nothing red leaves the machine. Red is allowed inside a branch's history; the branch tip is green.

Note which suite each gate sees. The three configs are mutually exclusive by filename: the unit config (`rootDir: src`, `testRegex: .*\.spec\.ts$`) matches neither `*.int-spec.ts` nor `*.e2e-spec.ts`, because both end in `-spec.ts` rather than `.spec.ts`; `test/jest-int.json` matches only `*.int-spec.ts`, `test/jest-e2e.json` only `*.e2e-spec.ts`. Only the unit config is gated, so the red commit of step 1 — an e2e spec, or an integration one — passes `pre-push` untouched, while a **unit** spec left red blocks the push. That is the boundary working as intended: the tiers that need Postgres can't be a push gate, so they're yours to run before opening a PR (`npm run db:up && npm run test:int && npm run test:e2e`).

## Commands

Run from this directory, or via the root's `npm run dev:api` / `build:api` / `lint:api` / `test:api`:

- `npm run start:dev` — watch mode
- `npm run build`
- `npm run test` — unit tests (Jest, `src/**/*.spec.ts`)
- `npm run test:int` — integration tests (`src/**/*.int-spec.ts`) — needs Postgres up
- `npm run test:e2e` — e2e tests — needs Postgres up
- `npm run test:cov` — coverage
- `npm run lint`

## Database

A local Postgres 18 instance and a Redis 8 instance are available via the root `docker-compose.yml` (`npm run db:up` from repo root). Connection details live in the root `.env` / `.env.example` (`DATABASE_URL`, `REDIS_URL`, etc.). Redis requires a password (`--requirepass`, set via `REDIS_PASSWORD`) — always connect using `REDIS_URL`, which embeds it. No Redis client is wired up in this app yet.

Postgres is accessed via **Prisma** (`prisma/schema.prisma`, `PrismaService`). Generator choice, the required driver adapter, CLI config, and a build gotcha around `prisma.config.ts` are documented in `docs/modules/module-api-prisma.md` — read it before touching anything Prisma-related.

**Integration and e2e tests run against that same local database**, not a separate or throwaway one — deliberately, since it's already provisioned, already migrated and already what e2e uses. Two rules follow from sharing it, and both are non-negotiable: generate the data a spec depends on per run (`` `users-int-${randomUUID()}@example.com` ``, as the existing specs do) so nothing collides with a previous run or with dev data, and delete the rows a spec created in `afterAll`. Never truncate a table or reset the schema — that's someone's dev data.

**Redis is optional, not a hard dependency.** It's provisioned for future caching/session/pub-sub use, but nothing in this app depends on it today. Any future Redis-backed code (cache modules, session store, rate limiter, etc.) must handle Redis being absent or unreachable without failing the request — e.g. catch connection errors and fall back to the non-cached path, don't let a Redis outage take down the API.

## Status

Where things stand now. **How it got here — and why — is in [`HISTORY.md`](HISTORY.md)**; per-module architecture and function references are in `docs/modules/`.

- **auth** — `POST /auth/register`, `POST /auth/login` issuing JWTs, composed over CQRS with `users` (persistence) and `credentials` (bcrypt hashing/verification); `JwtAuthGuard`/`JwtStrategy` protect everything else.
- **meetings** — `POST /meetings`, `GET /meetings`, `GET /meetings/:id`, guarded and scoped to the caller.
- **storage** — the app-wide byte boundary `files` and `profile` share: `FileStorage` (local disk today, `0o700`/`0o600`, stage-then-rename), `STORAGE_ROOT` resolution, and content-based type detection whose accepted set each caller passes in.
- **files** — upload, list and byte-serving under `/meetings/:meetingId/files`, owner-scoped, over the `storage` module's `FileStorage`. Every limit is enforced at the route: 500 MB per file, content-sniffed type, 20 live files per meeting, 20 GB per owner (reserved in-process for the life of an upload), plus a 60-second inactivity timeout distinct from the app's 30-minute total. Soft delete, restore and a `FilesPurgeService` cron that purges 30 days after deletion.
- **profile** — `GET`/`PATCH /profile` plus `POST`/`GET`/`DELETE /profile/avatar`, guarded, resolving the subject from the caller's token alone and answering exactly `{ id, email, name, hasAvatar, avatarUpdatedAt }`. The name is capped at 80 characters, normalised rather than rejected, and cleared by submitting an empty value. One avatar per account, at most 5 MB, PNG/JPEG/WebP by content rather than by name, stored under a fresh key per upload and served only to its owner.
- The global throttler tracks callers by hashed credential rather than by socket, and its baseline (20/60 s unset, as in production) reads `THROTTLE_LIMIT`/`THROTTLE_TTL_MS` so a browser e2e run can widen it; unusable values fall back to the default instead of widening it.
- Three test tiers — unit, integration, e2e — per the Development workflow section. Redis is still unused.

Update this section when the current state changes, record the change itself in `HISTORY.md`, and add a `docs/modules/module-api-<name>.md` doc for each new module per the root `CLAUDE.md`'s Module documentation section.
