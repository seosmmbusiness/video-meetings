# video-meetings

Monorepo (npm workspaces) with two independent apps:

- **apps/web** — [Next.js 16.3.1](https://nextjs.org/docs/app/getting-started/installation) (App Router, TypeScript, ESLint)
- **apps/api** — [NestJS 11.2.1](https://docs.nestjs.com/) (TypeScript, ESLint, Prettier via eslint-plugin-prettier, Jest)

Why the project is built the way it is — decisions, constraints and what was tried and rejected — is recorded in [`HISTORY.md`](HISTORY.md), with per-app logs in [`apps/api/HISTORY.md`](apps/api/HISTORY.md) and [`apps/web/HISTORY.md`](apps/web/HISTORY.md).

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

| Script                       | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `npm run dev`                | Start apps/api then apps/web together (dev)                     |
| `npm run dev:web`            | Start Next.js dev server (apps/web)                             |
| `npm run dev:api`            | Start NestJS in watch mode (apps/api)                           |
| `npm run dev:api:e2e`        | Same, with the rate-limit headroom `test:e2e:web` needs         |
| `npm run build`              | Build both apps                                                 |
| `npm run build:web`          | Build apps/web only                                             |
| `npm run build:api`          | Build apps/api only                                             |
| `npm run start`              | Start apps/api then apps/web together (prod, from build output) |
| `npm run start:web`          | Serve the apps/web production build                             |
| `npm run start:api`          | Start apps/api from its production build                        |
| `npm run lint`               | Lint both apps                                                  |
| `npm run lint:web`           | Lint apps/web only                                              |
| `npm run lint:api`           | Lint apps/api only                                              |
| `npm run format`             | Format apps/** with Prettier                                    |
| `npm run format:check`       | Check formatting without writing                                |
| `npm test`                   | Run both apps' unit suites (what `pre-push` gates on)           |
| `npm run test:tools`         | Run the tooling suites (`.claude/hooks`, `.claude/ralph`)       |
| `npm run test:api`           | Run apps/api unit tests (Jest)                                  |
| `npm run test:web`           | Run apps/web unit + integration tests (Vitest)                  |
| `npm run test:int:api`       | Run apps/api integration tests (Jest, needs Postgres)           |
| `npm run test:e2e:api`       | Run apps/api e2e tests (Jest + supertest, needs Postgres)       |
| `npm run test:e2e:web`       | Run Playwright e2e tests (apps/web, API via `dev:api:e2e`)      |
| `npm run prisma:generate`    | Regenerate the Prisma client (apps/api)                         |
| `npm run prisma:migrate:dev` | Create/apply a Prisma migration (apps/api)                      |
| `npm run db:up`              | Start the local Postgres + Redis containers                     |
| `npm run db:down`            | Stop the local Postgres + Redis containers                      |

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
- `apps/api` rate-limits every route at a shared baseline of 20 requests per 60 s, tracked per caller. `THROTTLE_LIMIT` / `THROTTLE_TTL_MS` widen that baseline; unset — as in production — keeps 20/60 s, and any unusable value falls back to it rather than widening the control. Only the baseline is configurable: the stricter per-route overrides (login, upload, download) stay in the code. **`npm run test:e2e:web` needs the headroom** — the whole Playwright suite registers its fixtures unauthenticated, so they share one bucket by IP; start the API with `npm run dev:api:e2e`.
- Uploaded meeting files live on local disk under `STORAGE_ROOT` (default `<repo>/.data/uploads`, gitignored) — **required**, with no default, when `NODE_ENV=production`. See `docs/modules/module-api-files.md`.

**Redis is optional infrastructure, not a hard dependency.** It's present in `docker-compose.yml` (`REDIS_URL` in `.env.example`) for future caching/session/pub-sub use, but no service in this repo depends on it yet. When code is written against Redis, it must be written to **degrade gracefully if Redis is absent or unreachable** (connection refused, timeout, etc.) — treat it as a best-effort cache/accelerator, not a source of truth. Don't let a missing or down Redis take down `apps/api` or block a request path; fall back to the non-cached/direct behavior and log, rather than throwing.

## Conventions

- TypeScript everywhere.
- A single root `.prettierrc` / `.prettierignore` is shared by both apps for consistent formatting.
- Each app keeps its own ESLint config, since `eslint-config-next` and the NestJS ESLint setup use different rule sets and plugins.
- Node version is pinned via `.nvmrc`.
- **Both apps are developed test-first (TDD)** across three tiers — unit (`*.spec.ts`), integration (`*.int-spec.ts`) and e2e — following Red/Green/Refactor outside in: the e2e spec for a scenario is written and its cases reviewed before implementation (red), then each unit it needs gets its own red unit/integration spec before the code that turns it green, refactors start only from a green baseline and re-run the suites after each step, and any test rewrite is confirmed with the requester first rather than done silently. E2e coverage on its own is not enough. `apps/api` runs Jest (three configs, split by filename); `apps/web` runs Vitest + React Testing Library for the two lower tiers and Playwright for e2e. See the root `CLAUDE.md`'s Testing section, then `apps/api/CLAUDE.md` / `apps/web/CLAUDE.md`.
- Two Husky hooks, split so the red half of that cycle can be committed: `pre-commit` runs `npm run lint`, `pre-push` runs `npm test` (both apps' unit suites). A failing spec may be committed on a branch; the branch tip has to be green before it can be pushed. Neither gate runs the integration or e2e suites — those need Postgres up (`npm run db:up && npm run test:int:api && npm run test:e2e:api`), so run them yourself before opening a PR.
- **apps/api** documents its HTTP surface with `@nestjs/swagger` (Swagger UI); every controller/route/DTO is annotated, and the generated docs are checked after adding or changing endpoints. See `apps/api/CLAUDE.md`.

## Autonomous builds

`node .claude/ralph-start.js` works a planned feature's backlog unattended — one session per task, following the same `/bldprj:build-phase` contract a hand-driven build does, and merging a phase only after re-running its whole check set itself. It needs the pipeline's documents and the GitHub backlog to exist first.

```bash
node .claude/ralph-start.js --dry-run    # decide and print every step, spawn nothing
node .claude/ralph-start.js              # start
node .claude/ralph-start.js --watch      # start, and watch it in this terminal
node .claude/ralph-start.js --ui         # start, and open the dashboard on 127.0.0.1:4599
node .claude/ralph-watch.js              # attach a view to a run already going
node .claude/ralph-start.js --status     # where a run got to
touch .claude/ralph.stop                 # halt it
```

A view shows which phase and task the run is on, what the running session is doing right now, the
model, effort and ceilings the next session will get, and offers pause, stop and rollback. Closing a
view leaves the run going.

Full guide — configuration, watching a run, and what to do when it stops: [`docs/ralph-loop.md`](docs/ralph-loop.md).

Turn and dollar ceilings — what they mean, what happens when a session hits one, how to recover it, and
recommended settings from a small feature to a heavy one: [`Ralph-Instruction.md`](Ralph-Instruction.md).
