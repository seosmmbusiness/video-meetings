# video-meetings

Monorepo (npm workspaces) with two independent apps:

- **apps/web** — [Next.js 16.3.1](https://nextjs.org/docs/app/getting-started/installation) (App Router, TypeScript, ESLint)
- **apps/api** — [NestJS 11.2.1](https://docs.nestjs.com/) (TypeScript, ESLint, Prettier via eslint-plugin-prettier, Jest)

How the code is written — conventions, testing tiers, documentation rules — is in [`CLAUDE.md`](CLAUDE.md), with `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` for each app. Why the project is built the way it is — decisions, constraints and what was tried and rejected — is recorded in [`HISTORY.md`](HISTORY.md), with per-app logs in [`apps/api/HISTORY.md`](apps/api/HISTORY.md) and [`apps/web/HISTORY.md`](apps/web/HISTORY.md).

## Requirements

- Node.js `24.x` (see `.nvmrc`)
- npm `>=10`
- Docker + Docker Compose, **running** — it carries the local Postgres and Redis containers and the Whisper transcription engine `apps/api` posts recordings to; with the daemon stopped, transcription runs simply end as failed

## Getting started

```bash
npm install
cp .env.example .env
npm run whisper:models       # once, downloads the Whisper weights (~75 MB for `tiny`)
npm run db:up
npm run prisma:migrate:dev   # once, to create the schema
npm run dev
```

`npm run whisper:models` comes **before** the first `db:up`: `db:up` starts every compose service, and the `whisper` one mounts `.data/whisper-models/ggml-${WHISPER_MODEL}.bin` read-only — with the weights absent it restarts in a loop instead of serving. The download runs once and is skipped on later runs.

## Scripts

Every script lives in `package.json` — the root one holds the cross-app wrappers (`dev`, `build`, `lint`, `test`, `db:up`, and `<script>:api` / `<script>:web` to run one app's script) — and in `apps/api/package.json` / `apps/web/package.json`; `npm run` prints them with their commands. Which test script runs which tier, and what each needs running first, is in `CLAUDE.md`'s Testing section.

`npm run dev` runs both apps concurrently (apps/api first, apps/web right after) in one terminal, prefixing output with `[api]`/`[web]`; if either process exits the other is killed too. apps/api listens on port `3001` by default (`PORT`), apps/web on `3000`, so they don't collide.

## Database

`docker-compose.yml` at the repo root runs **Postgres 18**, **Redis 8** and the **Whisper transcription engine** for local development (`npm run db:up` / `npm run db:down`). Data persists in the `postgres_data` / `redis_data` named Docker volumes across restarts.

- Every environment variable — database and Redis credentials, `JWT_SECRET`, `CORS_ORIGIN`, `API_BASE_URL`, `STORAGE_ROOT`, the throttle baseline — is documented in `.env.example`; `cp .env.example .env` gives working defaults (everything resolves to `video_meetings`). Redis requires auth (`--requirepass`) — connect via `REDIS_URL`, not a bare `redis-cli` with no password.
- `apps/api` connects through **Prisma** (`DATABASE_URL`); after the first `db:up`, run `npm run prisma:migrate:dev` once to create the schema. Prisma-specific notes (generator choice, driver adapter, config file) are in `docs/modules/module-api-prisma.md`.
- `apps/web` has no `.env` of its own — it loads this root `.env` via `@next/env` in `next.config.ts` and reaches `apps/api` server-to-server at `API_BASE_URL`.
- `apps/api` rate-limits every route at a shared baseline of 20 requests per 60 s, tracked per caller. `npm run test:e2e:web` needs more headroom: start the API with `npm run dev:api:e2e`, which widens the baseline for the run — the reason is in `CLAUDE.md`'s Testing section.
- Uploaded meeting files live on local disk under `STORAGE_ROOT` (default `<repo>/.data/uploads`, gitignored) — **required**, with no default, when `NODE_ENV=production`.
- The `whisper` service transcribes recordings for `apps/api` (`WHISPER_URL`, `WHISPER_PORT`, `WHISPER_MODEL`, `WHISPER_TIMEOUT_MS`). Its weights come from `npm run whisper:models` into the gitignored `.data/whisper-models/` and are mounted read-only, so nothing is downloaded during a run. It is published on `127.0.0.1` only and sits on its own compose network — how long a run takes, and what a stopped engine does to one, is in `docs/modules/module-api-transcription.md`.

**Redis is optional infrastructure, not a hard dependency** — provisioned for future caching/session/pub-sub use, unused today, and any code written against it must degrade gracefully when Redis is absent or unreachable. The rule for code is in `CLAUDE.md`'s Conventions.

## Conventions

- TypeScript everywhere; a single root `.prettierrc` / `.prettierignore` is shared by both apps; each app keeps its own ESLint config; the Node version is pinned via `.nvmrc`.
- Both apps are developed test-first across three tiers — unit, integration, e2e — outside in. The tiers, the order and what each needs running are in `CLAUDE.md`'s Testing section.
- Two Husky hooks: `pre-commit` runs `npm run lint`, `pre-push` runs `npm test` (both apps' unit suites) — a red spec may be committed on a branch, the branch tip must be green to push. Integration and e2e need Postgres up and are run by hand before opening a PR.
- `apps/api` documents its HTTP surface with `@nestjs/swagger` — see `apps/api/CLAUDE.md`.

## Autonomous builds

`node .claude/ralph-start.js` works a planned feature's backlog unattended — one session per task, following the same `/bldprj:build-phase` contract a hand-driven build does, merging a phase only after re-running its whole check set itself, and carrying on through `/bldprj:close-feature` to the close-out PR. It needs the `bldprj` plugin, the pipeline's documents and the GitHub backlog to exist first.

Full guide — commands, configuration, watching a run, and what to do when it stops: [`docs/ralph-loop.md`](docs/ralph-loop.md). Turn and dollar ceilings — what they mean, what happens when a session hits one, how to recover it, and recommended settings from a small feature to a heavy one: [`Ralph-Instruction.md`](Ralph-Instruction.md).
