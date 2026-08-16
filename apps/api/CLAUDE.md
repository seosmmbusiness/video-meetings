# apps/api

NestJS 11.1.28 backend, TypeScript.

## Structure

- `src/main.ts` — entry point (Nest bootstrap); mounts a global `ValidationPipe` (`whitelist`, `transform`) so DTO validation (`class-validator`) is enforced on every route, and enables CORS (`app.enableCors`) for `apps/web`'s origin (`CORS_ORIGIN` env var, default `http://localhost:3000`) since the browser calls this API cross-origin in dev.
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — root module/controller/service; `AppModule` wires up `ConfigModule` (global), a global `ThrottlerGuard` (`@nestjs/throttler`, default 20 req/60s per IP), `PrismaModule`, and feature modules.
- `src/prisma/` — injectable Prisma client wrapper (`PrismaService`/`PrismaModule`) over Postgres. Architecture + function reference: `.claude/modules/module-api-prisma.md` (see root `CLAUDE.md`'s Module documentation section).
- `src/auth/` — authentication orchestration only: register/login flow, JWT issuance/verification, rate limiting. Delegates user persistence to `src/users` and password hashing/verification to `src/credentials`, via CQRS (see Architecture below). Architecture + function reference: `.claude/modules/module-api-auth.md` (see root `CLAUDE.md`'s Module documentation section); the JWT verification guard/strategy used to protect routes is documented in `.claude/modules/module-api-meetings.md` (added alongside that module, as its first consumer).
- `src/users/` — user persistence (Prisma `User` model): creation and lookup, exposed only via CQRS commands/queries. Architecture + function reference: `.claude/modules/module-api-users.md`.
- `src/credentials/` — password hashing/verification (bcrypt), exposed only via CQRS commands/queries. Architecture + function reference: `.claude/modules/module-api-credentials.md`.
- `src/meetings/` — create/list/get meetings, scoped to the authenticated owner. Architecture + function reference: `.claude/modules/module-api-meetings.md`.
- `src/files/` — store, list and serve a meeting's files (upload, download, byte-serving), scoped to the meeting's owner, behind an abstract `FileStorage` boundary (local disk today). Architecture + function reference: `.claude/modules/module-api-files.md`.
- `prisma/schema.prisma` — Prisma schema (`User`, `Meeting` models), output to `generated/prisma` (gitignored, run `npm run prisma:generate` to produce it locally). Generator/adapter rationale: `.claude/modules/module-api-prisma.md`.
- `prisma.config.ts` — Prisma CLI config; loads the monorepo-root `.env` (two levels up, since CLI commands run with cwd=`apps/api`) and points `datasource.url` at `DATABASE_URL`. Build-exclusion gotcha: `.claude/modules/module-api-prisma.md`.
- `test/` — e2e tests (Jest, config in `test/jest-e2e.json`), including `test/auth.e2e-spec.ts` and `test/meetings.e2e-spec.ts`; unit specs live next to their source as `*.spec.ts` (see `src/app.controller.spec.ts`).
- Own ESLint config, using `eslint-plugin-prettier` — kept separate from `apps/web`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- API documentation is generated with `@nestjs/swagger`, served at `/api` (or the configured docs path) via `SwaggerModule`. Every controller/route must be annotated (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, etc.) and every DTO must have `@ApiProperty`/`@ApiPropertyOptional` on its fields so the generated schema stays accurate. After adding or changing a module, controller, route, or DTO, run the app and check the Swagger UI to confirm the docs reflect the new/changed behavior before considering the work done — don't let the generated docs drift from the actual API surface.
- `src/auth`, `src/users`, and `src/credentials` talk to each other via CQRS (`@nestjs/cqrs`: `CommandBus`/`QueryBus`) rather than direct service injection — each module exposes only command/query classes, never its providers, to keep them independently testable/replaceable. `CqrsModule.forRoot()` is registered once, globally, in `AppModule`. This is a deliberate choice for this identity-domain boundary, not this project's blanket default for every module pair — elsewhere, prefer the plain constructor-injection composition documented in the `nestjs-best-practices` skill (`arch-single-responsibility`) unless there's a similar reason (independent domains that should stay decoupled) to reach for CQRS again.

## Development workflow (TDD)

This app is developed test-first (design → test → develop), following **Red/Green/Refactor**:

1. Before implementing a feature or change, write/extend the end-to-end tests (`test/*.e2e-spec.ts`) first, covering the intended behavior.
2. Review and refine the test cases with the user — clarify edge cases, add missing scenarios — before writing implementation code. Tests should fail cleanly (**red**) at this point.
3. Implement the minimum needed to make the tests pass (**green**).
4. **Refactor**: before starting any refactor, run the suite first and confirm it's fully green on the current code — never refactor against a red baseline. Then refactor in small steps, re-running the suite after each step to confirm it's still green before moving to the next; stop and fix immediately if a step turns a test red.
5. After any functional change, re-run the e2e/unit suite and confirm it still matches the intended behavior.
6. If existing tests need to change because requirements changed, don't just edit them silently — flag it and confirm the new/updated cases with the user first.

**Security test cases are mandatory, not optional.** Alongside functional behavior, step 1's e2e specs for a feature/endpoint must also cover: authorization boundaries (a caller can't read/modify another user's resources — IDOR); auth bypass (missing, malformed, or expired JWT against a protected route); injection/mass-assignment edge cases (extra/unexpected fields are rejected by `ValidationPipe`'s `whitelist`, not silently accepted); and rate-limiting/brute-force protection on sensitive endpoints (login, register, etc.). These are required cases in the Red/Green/Refactor cycle above, written before implementation like any other — not bolted on after. See `apps/web/CLAUDE.md`'s Development workflow section for the frontend-side equivalent.

## Commands

Run from this directory, or via the root's `npm run dev:api` / `build:api` / `lint:api` / `test:api`:

- `npm run start:dev` — watch mode
- `npm run build`
- `npm run test` — unit tests (Jest)
- `npm run test:e2e` — e2e tests
- `npm run test:cov` — coverage
- `npm run lint`

## Database

A local Postgres 18 instance and a Redis 8 instance are available via the root `docker-compose.yml` (`npm run db:up` from repo root). Connection details live in the root `.env` / `.env.example` (`DATABASE_URL`, `REDIS_URL`, etc.). Redis requires a password (`--requirepass`, set via `REDIS_PASSWORD`) — always connect using `REDIS_URL`, which embeds it. No Redis client is wired up in this app yet.

Postgres is accessed via **Prisma** (`prisma/schema.prisma`, `PrismaService`). Generator choice, the required driver adapter, CLI config, and a build gotcha around `prisma.config.ts` are documented in `.claude/modules/module-api-prisma.md` — read it before touching anything Prisma-related.

**Redis is optional, not a hard dependency.** It's provisioned for future caching/session/pub-sub use, but nothing in this app depends on it today. Any future Redis-backed code (cache modules, session store, rate limiter, etc.) must handle Redis being absent or unreachable without failing the request — e.g. catch connection errors and fall back to the non-cached path, don't let a Redis outage take down the API.

## Status

Postgres-backed email/password auth is implemented (`POST /auth/register`, `POST /auth/login`). `src/auth` was split into three CQRS-composed modules: `src/auth` (JWT issuance/verification, register/login orchestration — see `.claude/modules/module-api-auth.md`), `src/users` (user persistence — `.claude/modules/module-api-users.md`), and `src/credentials` (password hashing/verification — `.claude/modules/module-api-credentials.md`), all on top of Prisma (`User` model — see `.claude/modules/module-api-prisma.md`). A JWT verification guard (`JwtAuthGuard`/`JwtStrategy`, passport-jwt) protects routes. The meetings module (`POST /meetings`, `GET /meetings`, `GET /meetings/:id`, all guarded and scoped to the caller — see `.claude/modules/module-api-meetings.md`) is the first consumer of that guard. A files module now stores, lists and serves a meeting's files (`POST /meetings/:meetingId/files`, `GET /meetings/:meetingId/files`, `GET /meetings/:meetingId/files/:fileId/content`), scoped to the meeting's owner and backed by local disk behind an abstract `FileStorage` boundary, and enforces every upload limit at the route itself — 500 MB per file, content-sniffed type (12 accepted types), 20 live files per meeting, 20 GB per owner (counting soft-deleted-but-not-purged files, reserved in-process for the life of an upload so concurrent uploads can't outrun it), and a 60-second inactivity timeout distinct from the app's 30-minute total request timeout — see `.claude/modules/module-api-files.md`; the meeting-file-upload feature's first two phases, with soft delete and the web UI still to come. The global throttler is now tracked by credential (`sha256` of the `Authorization` header) rather than by socket, since `apps/web` calls this API server-to-server. Redis is still unused. Update this file as more domain modules land, and add a corresponding `.claude/modules/module-api-<name>.md` doc per the root `CLAUDE.md`'s Module documentation section.
