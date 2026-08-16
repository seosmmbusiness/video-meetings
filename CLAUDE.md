# video-meetings

npm-workspaces monorepo with two independent apps. See @README.md for the full script table and setup instructions — don't duplicate it here.

Feature and refactor documents — PRD, plan, research, threats, final plan — are indexed in [`docs/INDEX.md`](docs/INDEX.md).

Why anything is the way it is: [`HISTORY.md`](HISTORY.md), with per-app logs in [`apps/api/HISTORY.md`](apps/api/HISTORY.md) and [`apps/web/HISTORY.md`](apps/web/HISTORY.md). Read the relevant one before undoing something that looks arbitrary.

## Layout

- `apps/web` — Next.js 16 frontend (App Router, TypeScript). See `apps/web/CLAUDE.md`.
- `apps/api` — NestJS 11 backend (TypeScript). See `apps/api/CLAUDE.md`.
- `docker-compose.yml` — local Postgres 18 + Redis 8 (`npm run db:up` / `db:down`). See the README's Database section. **Redis is optional infra** — no service depends on it; any code that uses it must degrade gracefully if it's unavailable.

The two apps are independent (no shared package yet) — each has its own `package.json`, `tsconfig.json` and ESLint config, because `eslint-config-next` and the NestJS ESLint setup use different rule sets and can't be merged. Dependencies themselves are hoisted into the root `node_modules` by npm workspaces; `apps/*/node_modules` holds only what couldn't hoist (a version conflict between the two apps), so a package being absent there doesn't mean it isn't installed.

## Conventions

- Node `24.x` (`.nvmrc`), npm `>=10`.
- TypeScript everywhere.
- Formatting is centralized: the root `.prettierrc` / `.prettierignore` applies to both apps (`npm run format` / `format:check` from root). Linting is per-app (`npm run lint:web`, `npm run lint:api`).
- Run app-scoped commands via the root `dev:web` / `dev:api` / `build:web` / `build:api` scripts, or `cd` into the app and use its own scripts directly — both work. `npm run dev` runs both apps together (via `concurrently`, apps/api started first): apps/api on port `3001`, apps/web on `3000`.
- Every function (exported or not, including React components, Nest providers/controllers/handlers, and utilities) gets a JSDoc comment: a one-line summary, `@param` for each parameter, `@returns` when it returns a value, and `@throws` when it can throw. Skip only trivial one-line arrow functions passed inline (e.g. `.map((x) => x.id)`).

## Testing

Both apps are developed test-first, and **e2e coverage alone is not enough**: every change is covered at each tier that applies to it, and the tests are written before the code that makes them pass. Three tiers, same names and same meaning in both apps:

| Tier            | Filename                                                | What it covers                                                                                                           | Needs                |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **Unit**        | `*.spec.ts` / `.tsx`                                    | One unit's own logic, with its collaborators stubbed. No database, no network, no filesystem, no real HTTP.              | Nothing              |
| **Integration** | `*.int-spec.ts` / `.tsx`                                | Several real units across one real boundary — module wiring, the database, the filesystem, a route handler. No full app. | Postgres (`db:up`)   |
| **E2E**         | `apps/api/test/*.e2e-spec.ts`, `apps/web/e2e/*.spec.ts` | The whole system through its public surface: HTTP for the API, a real browser for the web app.                           | Both apps + Postgres |

**Order — outside in, one commit per red state.** The outer loop is e2e: before implementing, write or extend the e2e spec covering the scenario end to end, review its cases with the requester, and commit it red on its own (`test(<app>): …`). The inner loop is unit/integration: for each unit the scenario needs, write its `*.spec.ts` (or `*.int-spec.ts`) red first, then implement the minimum that turns it green, and repeat until the outer e2e spec goes green too. Refactoring only ever starts from a fully green baseline and re-runs the suites after every step.

**Which tier a test belongs to is decided by what it touches, not by what it's about.** A spec that needs Postgres is not a unit test — it's `*.int-spec.ts`. A spec that drives real HTTP or a browser is e2e. Keeping that line sharp is the point of the split: the unit suites stay fast enough to gate every push, and a failure names its own layer.

**Security cases are mandatory at every tier**, not an afterthought bolted onto e2e — see each app's CLAUDE.md for its own list.

Commands, all from the repo root:

| Command                | Runs                                                      |
| ---------------------- | --------------------------------------------------------- |
| `npm test`             | Both apps' unit suites (what `pre-push` gates on)         |
| `npm run test:api`     | apps/api unit                                             |
| `npm run test:web`     | apps/web unit **and** integration (both are hermetic)     |
| `npm run test:int:api` | apps/api integration — needs `npm run db:up`              |
| `npm run test:e2e:api` | apps/api e2e — needs `npm run db:up`                      |
| `npm run test:e2e:web` | apps/web e2e — needs `npm run db:up` and apps/api running |

The git hooks gate only what runs anywhere with no infrastructure: `pre-commit` runs `npm run lint`, `pre-push` runs `npm test` (both unit suites). Integration and e2e need Postgres and, for the browser suite, both apps up, so they stay manual — run them yourself before opening a PR.

Per-app specifics — how each tier is written, which tools it uses, and what genuinely can't be tested below e2e — live in `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`.

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

**History goes in `HISTORY.md`, not in a Status section.** Every CLAUDE.md has a `HISTORY.md` beside it — [`HISTORY.md`](HISTORY.md), [`apps/api/HISTORY.md`](apps/api/HISTORY.md), [`apps/web/HISTORY.md`](apps/web/HISTORY.md) — and each keeps the same shape: newest first, one `### YYYY-MM-DD — <short title>` entry per change under a `## YYYY-MM` heading. When a change lands that's worth remembering:

- Add an entry at the **top** of the log that owns it — repo-wide tooling, conventions and cross-app features at the root, app-specific decisions in the app's own file. Don't write the same entry in two places; link instead.
- Record **why**, not just what: the constraint that forced it, the alternative rejected, the thing that broke. An entry that only restates the diff is noise — `git log` already has the diff.
- Date the entry by when it landed on the base branch (`git log --date=short`), and leave older entries alone. They describe what was true then; a newer entry supersedes them.
- Then touch the CLAUDE.md `Status` section **only if the current state changed**, and keep it a description of the present. Status sections used to accumulate every change ever made until they were unreadable — that's what this split exists to prevent.

## Status

Where things stand now. **How they got here — and why — is in [`HISTORY.md`](HISTORY.md)**; read it before changing something that looks arbitrary, since most of it isn't.

npm-workspaces monorepo, two independent apps, no shared package yet. Local Postgres 18 and Redis 8 via `docker-compose.yml`. **Redis is provisioned but still unused**, and is treated project-wide as best-effort infrastructure nothing may hard-depend on.

- `apps/api` — Prisma on Postgres; email/password auth split across `auth`/`users`/`credentials` over CQRS; a JWT guard; meetings; and files (owner-scoped storage behind a `FileStorage` boundary, every upload limit enforced at the route, soft delete/restore, scheduled purge). See `apps/api/CLAUDE.md`.
- `apps/web` — auth-gated dashboard plus `/register`, `/login` and `/meetings/[id]` with upload, download, in-page preview and delete/restore, all on an `httpOnly` session cookie read server-side. Byte traffic goes through same-origin proxy Route Handlers so the session token never reaches the browser. See `apps/web/CLAUDE.md`.

Both apps run three test tiers (see the Testing section). Dependencies are current within their supported majors; ESLint 10, TypeScript 7 and `@types/node` 26 are deliberately held back — reasons and re-check conditions in `HISTORY.md`.

`meeting-file-upload` is feature-complete and archived under `docs/archive/`. Still absent: shared libs, CI, and deployment config.

Keep this section to the current state and put the change itself in `HISTORY.md` — that's what stops it growing into a changelog again.
