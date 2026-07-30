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
- Before writing a new module: scan `.claude/modules/INDEX.md` for existing modules that already cover, or partially cover, the needed functionality. Prefer extending/reusing a close match over writing a duplicate — only start a new module when nothing existing fits.
- After changing a module's implementation (new functions, changed behavior, new gotchas): update its doc under `.claude/modules/` to match, in the same change — don't let it drift out of sync with the code. Keep it synced together with the other doc sources that cover the same code: JSDoc on the changed functions (root Conventions) and, for `apps/api`, Swagger annotations on any changed controller/route/DTO (`apps/api/CLAUDE.md`'s Swagger convention). Only touch the CLAUDE.md one-liner if the summary itself changed (new module, renamed module, changed one-line purpose).
- Scope doc updates to what actually changed: update the `.claude/modules/` doc, JSDoc, and Swagger annotations only for the functions/endpoints/DTOs you touched. Don't rewrite documentation for other, untouched parts of the module just because the file changed — that's wasted work and noise in the diff.
- New module: create `.claude/modules/module-<app>-<name>.md`, add a line to `.claude/modules/INDEX.md`, and add a one-line pointer in the owning app's CLAUDE.md.

## Documentation maintenance

When a change affects project architecture (new app/package, new shared library, new service/database, changed layout, new CI/deployment pipeline, etc.), update the relevant docs in the same change:

- This root `CLAUDE.md` — layout, conventions, status.
- `apps/web/CLAUDE.md` / `apps/api/CLAUDE.md` — when the change is app-specific.
- `README.md` — when scripts, setup steps, or requirements change.

Don't let docs drift from the code; treat doc updates as part of the task, not a follow-up.

## Status

Scaffolded 2026-07-28 from `create-next-app` and `nest new`. Local Postgres 18 and Redis 8 run via `docker-compose.yml`. `apps/api` now has Prisma wired to Postgres, email/password auth (register/login issuing JWTs, now also verified via a JWT guard), and a meetings module (create/list/get, protected and scoped to the caller) — see `apps/api/CLAUDE.md`. Still no shared libs, CI, or deployment config, and Redis remains unused. Redis is treated as optional/best-effort infra project-wide: no code should hard-depend on it being up. Update this file as real architecture emerges instead of letting it go stale.
