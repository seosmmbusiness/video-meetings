# apps/api

NestJS 11.1.28 backend, TypeScript.

## Structure

- `src/main.ts` — entry point (Nest bootstrap).
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — default root module/controller/service, not yet split into feature modules.
- `test/` — e2e tests (Jest, config in `test/jest-e2e.json`); unit specs live next to their source as `*.spec.ts` (see `src/app.controller.spec.ts`).
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

A local Postgres 18 instance and a Redis 8 instance are available via the root `docker-compose.yml` (`npm run db:up` from repo root). Connection details live in the root `.env` / `.env.example` (`DATABASE_URL`, `REDIS_URL`, etc.). Redis requires a password (`--requirepass`, set via `REDIS_PASSWORD`) — always connect using `REDIS_URL`, which embeds it. No ORM/driver and no Redis client is wired up in this app yet — that's the next step once a domain module needs persistence or caching.

**Redis is optional, not a hard dependency.** It's provisioned for future caching/session/pub-sub use, but nothing in this app depends on it today. Any future Redis-backed code (cache modules, session store, rate limiter, etc.) must handle Redis being absent or unreachable without failing the request — e.g. catch connection errors and fall back to the non-cached path, don't let a Redis outage take down the API.

## Status

Default `nest new` scaffold (2026-07-28) — single root module, no real domain modules, no auth yet. Postgres 18 and Redis 8 run via docker-compose but neither is connected from the app yet (no ORM/driver, no Redis client). Update this file once feature modules exist.
