# video-meetings

npm-workspaces monorepo with two independent apps. See @README.md for the full script table and setup instructions — don't duplicate it here.

## Layout

- `apps/web` — Next.js 16 frontend (App Router, TypeScript). See `apps/web/CLAUDE.md`.
- `apps/api` — NestJS 11 backend (TypeScript). See `apps/api/CLAUDE.md`.
- `docker-compose.yml` — local Postgres 18 + Redis 8 (`npm run db:up` / `db:down`). See the README's Database section. **Redis is optional infra** — no service depends on it; any code that uses it must degrade gracefully if it's unavailable.

The two apps are independent (no shared package yet) — each has its own `node_modules`, `tsconfig.json`, and ESLint config, because `eslint-config-next` and the NestJS ESLint setup use different rule sets and can't be merged.

## Conventions

- Node `24.x` (`.nvmrc`), npm `>=10`.
- TypeScript everywhere.
- Formatting is centralized: the root `.prettierrc` / `.prettierignore` applies to both apps (`npm run format` / `format:check` from root). Linting is per-app (`npm run lint:web`, `npm run lint:api`).
- Run app-scoped commands via the root `dev:web` / `dev:api` / `build:web` / `build:api` scripts, or `cd` into the app and use its own scripts directly — both work.
- Every function (exported or not, including React components, Nest providers/controllers/handlers, and utilities) gets a JSDoc comment: a one-line summary, `@param` for each parameter, `@returns` when it returns a value, and `@throws` when it can throw. Skip only trivial one-line arrow functions passed inline (e.g. `.map((x) => x.id)`).

## Module documentation

CLAUDE.md files stay brief on purpose — one line per module, not full architecture write-ups. Detailed per-module docs (architecture + function-by-function reference) live in this repo under `.claude/modules/`, named `module-<app>-<name>.md` (e.g. `module-api-auth.md`), indexed in `.claude/modules/INDEX.md`. These are committed like any other file, so any teammate cloning the repo (or CI) can read them.

Workflow:

- To work on a module: read its one-line pointer in the relevant CLAUDE.md, then read _only that module's_ doc under `.claude/modules/` — don't preload every module's doc into context.
- After changing a module's implementation: update its doc to match, in the same change. Only touch the CLAUDE.md one-liner if the summary itself changed (new module, renamed module, changed one-line purpose).
- New module: create `.claude/modules/module-<app>-<name>.md`, add a line to `.claude/modules/INDEX.md`, and add a one-line pointer in the owning app's CLAUDE.md.

## Documentation maintenance

When a change affects project architecture (new app/package, new shared library, new service/database, changed layout, new CI/deployment pipeline, etc.), update the relevant docs in the same change:

- This root `CLAUDE.md` — layout, conventions, status.
- `apps/web/CLAUDE.md` / `apps/api/CLAUDE.md` — when the change is app-specific.
- `README.md` — when scripts, setup steps, or requirements change.

Don't let docs drift from the code; treat doc updates as part of the task, not a follow-up.

## Status

Scaffolded 2026-07-28 from `create-next-app` and `nest new`. Local Postgres 18 and Redis 8 run via `docker-compose.yml`. `apps/api` now has Prisma wired to Postgres and a first domain module: email/password auth (register/login issuing JWTs) — see `apps/api/CLAUDE.md`. Still no shared libs, CI, or deployment config, and Redis remains unused. Redis is treated as optional/best-effort infra project-wide: no code should hard-depend on it being up. Update this file as real architecture emerges instead of letting it go stale.
