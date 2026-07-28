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

| Script                 | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run dev:web`      | Start Next.js dev server (apps/web)         |
| `npm run dev:api`      | Start NestJS in watch mode (apps/api)       |
| `npm run build`        | Build both apps                             |
| `npm run build:web`    | Build apps/web only                         |
| `npm run build:api`    | Build apps/api only                         |
| `npm run lint`         | Lint both apps                              |
| `npm run lint:web`     | Lint apps/web only                          |
| `npm run lint:api`     | Lint apps/api only                          |
| `npm run format`       | Format apps/** with Prettier                |
| `npm run format:check` | Check formatting without writing            |
| `npm run test:api`     | Run NestJS unit tests                       |
| `npm run db:up`        | Start the local Postgres + Redis containers |
| `npm run db:down`      | Stop the local Postgres + Redis containers  |

## Database

`docker-compose.yml` at the repo root runs **Postgres 18** and **Redis 8** containers for local development:

```bash
cp .env.example .env   # once, to get default credentials
npm run db:up           # start
npm run db:down         # stop
```

- Connection details (user/password/db/port, Redis port) are set via `.env` (see `.env.example`); Postgres defaults all resolve to `video_meetings`.
- Data persists in the `postgres_data` / `redis_data` named Docker volumes across restarts.
- No ORM/driver is wired into `apps/api` yet — `DATABASE_URL` in `.env.example` is ready for whenever that's added.

**Redis is optional infrastructure, not a hard dependency.** It's present in `docker-compose.yml` (`REDIS_URL` in `.env.example`) for future caching/session/pub-sub use, but no service in this repo depends on it yet. When code is written against Redis, it must be written to **degrade gracefully if Redis is absent or unreachable** (connection refused, timeout, etc.) — treat it as a best-effort cache/accelerator, not a source of truth. Don't let a missing or down Redis take down `apps/api` or block a request path; fall back to the non-cached/direct behavior and log, rather than throwing.

## Conventions

- TypeScript everywhere.
- A single root `.prettierrc` / `.prettierignore` is shared by both apps for consistent formatting.
- Each app keeps its own ESLint config, since `eslint-config-next` and the NestJS ESLint setup use different rule sets and plugins.
- Node version is pinned via `.nvmrc`.
