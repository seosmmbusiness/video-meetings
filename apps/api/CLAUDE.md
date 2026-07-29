# apps/api

NestJS 11.1.28 backend, TypeScript.

## Structure

- `src/main.ts` — entry point (Nest bootstrap); mounts a global `ValidationPipe` (`whitelist`, `transform`) so DTO validation (`class-validator`) is enforced on every route.
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — root module/controller/service; `AppModule` wires up `ConfigModule` (global), a global `ThrottlerGuard` (`@nestjs/throttler`, default 20 req/60s per IP), `PrismaModule`, and feature modules.
- `src/prisma/` — `PrismaService` (injectable, connects/disconnects with the Nest lifecycle, uses the `@prisma/adapter-pg` driver adapter over `DATABASE_URL`) and `PrismaModule` (`@Global`, exports `PrismaService`).
- `src/auth/` — email/password auth: `AuthController` (`POST /auth/register`, `POST /auth/login`; login has a stricter `@Throttle` override, 10 req/60s per IP, to blunt brute-forcing), `AuthService` (bcrypt hashing/verification with a fixed-time-shaped login check, JWT issuance via `@nestjs/jwt`), `dto/` (`RegisterDto`, `LoginDto`, `AuthResponseDto`, `transforms.ts` for the shared email-normalizing `@Transform`).
- `prisma/schema.prisma` — Prisma schema (`User` model); generator is the legacy `prisma-client-js` (not the new `prisma-client` ESM generator — see Database section below for why), output to `generated/prisma` (gitignored, run `npm run prisma:generate` to produce it locally).
- `prisma.config.ts` — Prisma CLI config; loads the monorepo-root `.env` (two levels up, since CLI commands run with cwd=`apps/api`) and points `datasource.url` at `DATABASE_URL`.
- `test/` — e2e tests (Jest, config in `test/jest-e2e.json`), including `test/auth.e2e-spec.ts`; unit specs live next to their source as `*.spec.ts` (see `src/app.controller.spec.ts`).
- Own ESLint config, using `eslint-plugin-prettier` — kept separate from `apps/web`'s because the rule sets don't compose.

## Conventions

- JSDoc required for all functions — see root `CLAUDE.md`.
- API documentation is generated with `@nestjs/swagger`, served at `/api` (or the configured docs path) via `SwaggerModule`. Every controller/route must be annotated (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, etc.) and every DTO must have `@ApiProperty`/`@ApiPropertyOptional` on its fields so the generated schema stays accurate. After adding or changing a module, controller, route, or DTO, run the app and check the Swagger UI to confirm the docs reflect the new/changed behavior before considering the work done — don't let the generated docs drift from the actual API surface.

## Development workflow (TDD)

This app is developed test-first (design → test → develop):

1. Before implementing a feature or change, write/extend the end-to-end tests (`test/*.e2e-spec.ts`) first, covering the intended behavior.
2. Review and refine the test cases with the user — clarify edge cases, add missing scenarios — before writing implementation code. Tests should fail cleanly (red phase) at this point.
3. Only then implement the functionality to make the tests pass.
4. After any functional change, re-run the e2e/unit suite and confirm it still matches the intended behavior.
5. If existing tests need to change because requirements changed, don't just edit them silently — flag it and confirm the new/updated cases with the user first.

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

Postgres is accessed via **Prisma** (`prisma/schema.prisma`, `PrismaService`). Notes specific to this setup:

- **Generator**: the schema pins `generator client { provider = "prisma-client-js" }` — the legacy, CommonJS-friendly generator. Prisma 7's new default generator (`prisma-client`) emits ESM-only TypeScript (unconditional `import.meta.url`) that isn't runnable under this app's CommonJS/`ts-jest`/Nest setup; don't switch generators without re-validating `npm run test:e2e` and a real build/start.
- **Driver adapter required**: Prisma 7 requires an explicit driver adapter — `PrismaService` constructs `PrismaClient` with `new PrismaPg({ connectionString: ... })` from `@prisma/adapter-pg` rather than relying on an implicit `DATABASE_URL` connection.
- **Config**: `prisma.config.ts` (not the schema's `datasource.url`) supplies `DATABASE_URL` to the Prisma CLI, loaded from the root `.env`.
- **Commands** (run from `apps/api`, or via root `npm run prisma:generate` / `prisma:migrate` if added there): `npm run prisma:generate` (regenerate the client into `generated/prisma`, gitignored), `npm run prisma:migrate:dev` (create/apply a migration). Both need `npm run db:up` first.
- **Build gotcha**: `prisma.config.ts` lives at the `apps/api` root (outside `src/`) and must stay excluded in `tsconfig.build.json` (along with `generated/`) — including it pulls the TypeScript build's inferred `rootDir` up from `src/` to `apps/api`, which breaks `PrismaService`'s relative import of the generated client at runtime.

**Redis is optional, not a hard dependency.** It's provisioned for future caching/session/pub-sub use, but nothing in this app depends on it today. Any future Redis-backed code (cache modules, session store, rate limiter, etc.) must handle Redis being absent or unreachable without failing the request — e.g. catch connection errors and fall back to the non-cached path, don't let a Redis outage take down the API.

## Status

Postgres-backed email/password auth is implemented: `POST /auth/register` and `POST /auth/login`, both returning `{ accessToken }` (JWT via `@nestjs/jwt`, secret from `JWT_SECRET`/`JWT_EXPIRES_IN` in the root `.env`). Passwords are hashed with bcrypt (72-char max, matching bcrypt's own input limit); email format and password complexity (≥8 chars, upper+lower+digit) are enforced via `class-validator`; emails are trimmed/lowercased before lookup or storage; registration requires `consentToTerms: true`. Hardening: login always runs `bcrypt.compare` (against a fixed dummy hash when the email is unknown) so an unregistered email can't be told apart from a wrong password by response time; concurrent registrations for the same email are resolved via the DB's unique constraint (caught and turned into a 409, not a raw 500); both endpoints sit behind rate limiting (`@nestjs/throttler`, stricter on login — see Structure above). Prisma (`User` model) is wired to Postgres — see the Database section above for generator/driver-adapter specifics. Redis is still unused. Update this file as more domain modules land.
