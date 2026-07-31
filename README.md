# video-meetings

Monorepo (npm workspaces) with two independent apps:

- **apps/web** — [Next.js 16.2.12](https://nextjs.org/docs/app/getting-started/installation) (App Router, TypeScript, ESLint)
- **apps/api** — [NestJS 11.1.28](https://docs.nestjs.com/) (TypeScript, ESLint, Prettier via eslint-plugin-prettier, Jest)

## Requirements

- Node.js `24.x` (see `.nvmrc`)
- npm `>=10`
- Docker + Docker Compose (for the local Postgres database)

## Getting started

```bash
npm install
cp .env.example .env
npm run db:up
```

## Scripts

| Script                       | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `npm run dev`                | Start apps/api then apps/web together (dev) |
| `npm run dev:web`            | Start Next.js dev server (apps/web)         |
| `npm run dev:api`            | Start NestJS in watch mode (apps/api)       |
| `npm run build`              | Build both apps                             |
| `npm run build:web`          | Build apps/web only                         |
| `npm run build:api`          | Build apps/api only                         |
| `npm run lint`               | Lint both apps                              |
| `npm run lint:web`           | Lint apps/web only                          |
| `npm run lint:api`           | Lint apps/api only                          |
| `npm run format`             | Format apps/** with Prettier                |
| `npm run format:check`       | Check formatting without writing            |
| `npm run test:api`           | Run NestJS unit tests                       |
| `npm run test:e2e:web`       | Run Playwright e2e tests (apps/web)         |
| `npm run prisma:generate`    | Regenerate the Prisma client (apps/api)     |
| `npm run prisma:migrate:dev` | Create/apply a Prisma migration (apps/api)  |
| `npm run db:up`              | Start the local Postgres + Redis containers |
| `npm run db:down`            | Stop the local Postgres + Redis containers  |

`npm run dev` runs both apps concurrently via `concurrently` (apps/api first, apps/web right after) in one terminal, prefixing output with `[api]`/`[web]`; if either process exits the other is killed too (`--kill-others`). apps/api listens on port `3001` by default (`PORT` env var), apps/web (Next.js) on `3000`, so they don't collide when run together.

## Database

`docker-compose.yml` at the repo root runs **Postgres 18** and **Redis 8** containers for local development:

```bash
cp .env.example .env   # once, to get default credentials
npm run db:up           # start
npm run db:down         # stop
```

- Connection details (user/password/db/port, Redis port/password) are set via `.env` (see `.env.example`); defaults all resolve to `video_meetings`. Redis requires auth (`--requirepass`) — connect via `REDIS_URL`, not a bare `redis-cli` with no password.
- Data persists in the `postgres_data` / `redis_data` named Docker volumes across restarts.
- `apps/api` connects to Postgres via **Prisma** (`DATABASE_URL`). After `npm run db:up`, run `npm run prisma:migrate:dev` once to create the schema. See `apps/api/CLAUDE.md` for Prisma-specific setup notes (generator choice, driver adapter, config file).
- Auth also needs `JWT_SECRET` (and optionally `JWT_EXPIRES_IN`, default `1h`) set in `.env` — used by `apps/api`'s email/password auth (`POST /auth/register`, `POST /auth/login`) to sign JWTs.
- `apps/api` enables CORS for `apps/web`'s origin via `CORS_ORIGIN` (default `http://localhost:3000`), since the browser calls the API cross-origin in dev (`apps/web` on `3000`, `apps/api` on `3001`).
- `apps/web` reaches `apps/api` server-to-server (from Server Actions) via `API_BASE_URL` (default `http://localhost:3001`) — `apps/web` has no `.env` of its own, so it loads this root `.env` itself via `@next/env` in `next.config.ts`.

**Redis is optional infrastructure, not a hard dependency.** It's present in `docker-compose.yml` (`REDIS_URL` in `.env.example`) for future caching/session/pub-sub use, but no service in this repo depends on it yet. When code is written against Redis, it must be written to **degrade gracefully if Redis is absent or unreachable** (connection refused, timeout, etc.) — treat it as a best-effort cache/accelerator, not a source of truth. Don't let a missing or down Redis take down `apps/api` or block a request path; fall back to the non-cached/direct behavior and log, rather than throwing.

## Conventions

- TypeScript everywhere.
- A single root `.prettierrc` / `.prettierignore` is shared by both apps for consistent formatting.
- Each app keeps its own ESLint config, since `eslint-config-next` and the NestJS ESLint setup use different rule sets and plugins.
- Node version is pinned via `.nvmrc`.
- **apps/api** is developed test-first (TDD), following Red/Green/Refactor: end-to-end tests are written/extended and their cases reviewed before implementation (red), functional changes are checked against the test suite afterward (green), refactors start only from a green baseline and re-run the suite after each step, and any test rewrite is confirmed with the requester first rather than done silently. See `apps/api/CLAUDE.md`.
- **apps/api** documents its HTTP surface with `@nestjs/swagger` (Swagger UI); every controller/route/DTO is annotated, and the generated docs are checked after adding or changing endpoints. See `apps/api/CLAUDE.md`.
