# apps/api

NestJS 11.1.28 backend, TypeScript.

## Structure

- `src/main.ts` — entry point (Nest bootstrap); mounts a global `ValidationPipe` (`whitelist`, `transform`) so DTO validation (`class-validator`) is enforced on every route.
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — root module/controller/service; `AppModule` wires up `ConfigModule` (global), a global `ThrottlerGuard` (`@nestjs/throttler`, default 20 req/60s per IP), `PrismaModule`, and feature modules.
- `src/prisma/` — injectable Prisma client wrapper (`PrismaService`/`PrismaModule`) over Postgres. Architecture + function reference: memory `module-api-prisma` (see root `CLAUDE.md`'s Module documentation section).
- `src/auth/` — email/password auth (register/login, JWT issuance, rate limiting). Architecture + function reference: memory `module-api-auth` (see root `CLAUDE.md`'s Module documentation section).
- `prisma/schema.prisma` — Prisma schema (`User` model), output to `generated/prisma` (gitignored, run `npm run prisma:generate` to produce it locally). Generator/adapter rationale: memory `module-api-prisma`.
- `prisma.config.ts` — Prisma CLI config; loads the monorepo-root `.env` (two levels up, since CLI commands run with cwd=`apps/api`) and points `datasource.url` at `DATABASE_URL`. Build-exclusion gotcha: memory `module-api-prisma`.
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

Postgres is accessed via **Prisma** (`prisma/schema.prisma`, `PrismaService`). Generator choice, the required driver adapter, CLI config, and a build gotcha around `prisma.config.ts` are documented in memory `module-api-prisma` — read it before touching anything Prisma-related.

**Redis is optional, not a hard dependency.** It's provisioned for future caching/session/pub-sub use, but nothing in this app depends on it today. Any future Redis-backed code (cache modules, session store, rate limiter, etc.) must handle Redis being absent or unreachable without failing the request — e.g. catch connection errors and fall back to the non-cached path, don't let a Redis outage take down the API.

## Status

Postgres-backed email/password auth is implemented (`POST /auth/register`, `POST /auth/login` — see memory `module-api-auth` for hardening details) on top of Prisma (`User` model — see memory `module-api-prisma`). Redis is still unused. Update this file as more domain modules land, and add a corresponding `module-api-<name>` memory entry per the root `CLAUDE.md`'s Module documentation section.
