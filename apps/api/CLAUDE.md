# apps/api

NestJS 11.1.28 backend, TypeScript.

## Structure

- `src/main.ts` — entry point (Nest bootstrap).
- `src/app.module.ts` / `app.controller.ts` / `app.service.ts` — default root module/controller/service, not yet split into feature modules.
- `test/` — e2e tests (Jest, config in `test/jest-e2e.json`); unit specs live next to their source as `*.spec.ts` (see `src/app.controller.spec.ts`).
- Own ESLint config, using `eslint-plugin-prettier` — kept separate from `apps/web`'s because the rule sets don't compose.

## Commands

Run from this directory, or via the root's `npm run dev:api` / `build:api` / `lint:api` / `test:api`:

- `npm run start:dev` — watch mode
- `npm run build`
- `npm run test` — unit tests (Jest)
- `npm run test:e2e` — e2e tests
- `npm run test:cov` — coverage
- `npm run lint`

## Status

Default `nest new` scaffold (2026-07-28) — single root module, no real domain modules, no database/ORM, no auth yet. Update this file once feature modules exist.
