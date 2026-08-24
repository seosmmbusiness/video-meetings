# video-meetings

npm-workspaces monorepo with two independent apps: `apps/web` (Next.js 16, App Router) and `apps/api` (NestJS 11, Prisma on Postgres). Setup, requirements and environment: [`README.md`](README.md) and `.env.example`, read on demand. Scripts: the `scripts` block of `package.json` (cross-app wrappers — `<script>:api`, `<script>:web`, `dev`, `db:up`) and of `apps/*/package.json`; `npm run` prints them, and nothing in these files repeats them.

**The rules in this file outrank the style of the existing code. If you see a contradiction, follow the rules** — in the code you write or touch; bring old code into line only when you are already changing it (see Refactoring), never as a drive-by.

Feature and refactor documents — PRD, plan, research, threats, final plan — are indexed in [`docs/INDEX.md`](docs/INDEX.md).

Why anything is the way it is: [`HISTORY.md`](HISTORY.md), with per-app logs in [`apps/api/HISTORY.md`](apps/api/HISTORY.md) and [`apps/web/HISTORY.md`](apps/web/HISTORY.md). Read the relevant one before undoing something that looks arbitrary.

## Layout

- `apps/web` — Next.js 16 frontend (App Router, TypeScript). See `apps/web/CLAUDE.md`.
- `apps/api` — NestJS 11 backend (TypeScript). See `apps/api/CLAUDE.md`.
- `docker-compose.yml` — local Postgres 18 + Redis 8 (`db:up` / `db:down`).
- `plugins/bldprj` — the feature pipeline, a Claude Code plugin developed in this repo (its own `CLAUDE.md` is for editing it); `.agents/skills/` — practice skills. Both are linked into `.claude/skills/` and `.claude/agents/`, and both are optional — see Optional tooling.

The two apps are independent (no shared package yet) — each has its own `package.json`, `tsconfig.json` and ESLint config, because `eslint-config-next` and the NestJS ESLint setup use different rule sets and can't be merged. Dependencies themselves are hoisted into the root `node_modules` by npm workspaces; `apps/*/node_modules` holds only what couldn't hoist (a version conflict between the two apps), so a package being absent there doesn't mean it isn't installed.

## Working with context

Context is a budget: everything read or printed stays in the session to its end, and every later turn pays for it again.

- **Locate, then read the range.** Glob/Grep for the symbol, then `Read` the lines around it (`offset`/`limit`); a whole file only when it is small or you are about to change most of it. No `cat`, `find` or `ls -R` over trees, no `git log -p`.
- **Never load generated, vendored or runtime content**: `node_modules/`, `apps/api/generated/`, `.next/`, `dist/`, lockfiles, `.claude/ralph-logs/`, `.claude/ralph.state.json`, `screenshots/`. For a library fact, grep the package for the one section you need; a Next.js guide lives under `node_modules/next/dist/docs/` — read the one guide for the API you touch.
- **Docs on demand.** `docs/modules/INDEX.md`, then only the docs of the modules you touch; `HISTORY.md` only before changing something that looks arbitrary; `docs/archive/` only when a task points there.
- **Don't re-read what is already in context**, and don't re-run a command whose output you already have.
- **Delegate wide reads.** A search across many files, a review of a whole module or diff, an audit → a subagent (Explore, or a project agent when one is loaded) that returns conclusions; the file contents never enter this context.
- **Quiet commands.** The narrowest check that proves the change first — one spec file (`npm run test:api -- src/files/files.service.spec.ts`; `npx vitest run src/lib/session.spec.ts` from `apps/web`) — the tier's suite after, e2e only for e2e changes. Pipe long output through `tail -n 40` or `grep` for the failure; `git --no-pager`; no watch modes, no `--verbose`.
- **Edit, don't rewrite.** `Edit` for changes to existing files, `Write` only for new ones. Report with `path:line`, not by quoting code back.
- **Keep instruction files short.** A `CLAUDE.md` states a rule once and points elsewhere for detail — no command lists (`package.json`), no history (`HISTORY.md`), no architecture write-ups (`docs/modules/`). Under 200 lines each, 150 as the target.

## Conventions

- Node `24.x` (`.nvmrc`), npm `>=10`. TypeScript everywhere.
- Formatting is centralized: the root `.prettierrc` / `.prettierignore` applies to both apps (`format` / `format:check`). Linting is per app (`lint:web`, `lint:api`; `lint` runs both).
- Every function (exported or not, including React components, Nest providers/controllers/handlers, and utilities) gets a JSDoc comment: a one-line summary, `@param` for each parameter, `@returns` when it returns a value, and `@throws` when it can throw. Skip only trivial one-line arrow functions passed inline (e.g. `.map((x) => x.id)`).
- **Redis is optional infrastructure, not a dependency.** It is provisioned for future caching/session/pub-sub use; nothing depends on it today, and nothing may hard-depend on it: code written against Redis degrades gracefully when it is absent or unreachable (connection refused, timeout) — fall back to the direct, uncached path and log, never fail the request or block startup. A best-effort accelerator, not a source of truth.

### Naming

- Files: `<feature>.<type>.ts` in `apps/api` — `meetings.service.ts`, `create-meeting.dto.ts`, `jwt-auth.guard.ts`, `files.constants.ts`. `apps/web` keeps kebab-case with the role as the last token (`file-uploader.tsx`, `meetings-api.ts`, `avatar-limits.ts`); Next.js's reserved names (`page.tsx`, `layout.tsx`, `route.ts`, `icon.tsx`) are the framework's. Tests: `*.spec.ts`, `*.int-spec.ts`, `*.e2e-spec.ts` (see Testing).
- Methods name the action: `createMeetingWithFiles`, `findFileForOwner` — not `process`, `handle`, `run`.
- Variables name the meaning: `meetingId`, `deletedFiles` — not `id`, `x`, `data`, `tmp`, `res`.
- A set of states is an enum: `MeetingStatus.PENDING`, never `'pnd'` — a Prisma `enum` for persisted states, a TS `enum` or `as const` object in memory.
- A limit is a named constant: `MAX_FILE_SIZE_MB`, in the feature's `*.constants.ts` (`apps/api`) or `src/lib/*-limits.ts` (`apps/web`), never a literal at the call site.

### Size

- A source file over 200 lines is decomposed before code is added to it.
- A function or method over 30 lines is split into private methods or helpers whose names read as steps.
- Nesting deeper than 3 levels is refactored — early returns, extracted helpers.
- Spec files (`*.spec.ts`, `*.int-spec.ts`, `*.e2e-spec.ts`, `e2e/`) are exempt from the file ceiling; split them by scenario when that helps a reader.

### Dependencies

- A feature reaches another only through its public surface. `apps/api`: the Nest module — `imports: [ThatModule]` and what it `exports` — or its CQRS command/query classes where `apps/api/CLAUDE.md` makes that the boundary; never a provider imported from another feature's folder and listed as your own. `apps/web`: through the `@/` alias, not `../../` chains.
- No circular dependencies. Before committing, follow the imports of every module you touched and make sure none lead back to it; in Nest a `forwardRef` is a cycle to remove, not to paper over.
- Types shared by both apps come from `@app/shared/types` once that package exists. Until it does, the browser-side copy is JSDoc-marked `hand-duplicated from apps/api's <symbol>` (as `apps/web/src/lib/file-limits.ts` is) and changed in the same commit as the original.

### Refactoring

- Decompose a file that is over the ceiling before adding to it, in its own commit ahead of the change that needed it; an existing over-limit file is decomposed the first time it is changed.
- Only from a green baseline, in small steps, the touched tier re-run after every step; a red step is fixed before the next.
- No speculative refactors — only what a rule above or an explicit request demands. `apps/web` adds a visual baseline: see its CLAUDE.md.

## Testing

Both apps are developed test-first, and **e2e coverage alone is not enough**: every change is covered at each tier that applies to it, and the tests are written before the code that makes them pass. Three tiers, same names and same meaning in both apps:

| Tier            | Filename                                                | What it covers                                                                                                           | Needs                |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **Unit**        | `*.spec.ts` / `.tsx`                                    | One unit's own logic, with its collaborators stubbed. No database, no network, no filesystem, no real HTTP.              | Nothing              |
| **Integration** | `*.int-spec.ts` / `.tsx`                                | Several real units across one real boundary — module wiring, the database, the filesystem, a route handler. No full app. | Postgres (`db:up`)   |
| **E2E**         | `apps/api/test/*.e2e-spec.ts`, `apps/web/e2e/*.spec.ts` | The whole system through its public surface: HTTP for the API, a real browser for the web app.                           | Both apps + Postgres |

**Order — outside in, one commit per red state.** The outer loop is e2e: before implementing, write or extend the e2e spec covering the scenario end to end, review its cases with the requester, and commit it red on its own (`test(<app>): …`). The inner loop is unit/integration: for each unit the scenario needs, write its `*.spec.ts` (or `*.int-spec.ts`) red first, then implement the minimum that turns it green, and repeat until the outer e2e spec goes green too. Refactoring only ever starts from a fully green baseline and re-runs the suites after every step. An existing test that has to change because requirements changed is flagged and confirmed with the requester first — never edited silently.

**Which tier a test belongs to is decided by what it touches, not by what it's about.** A spec that needs Postgres is `*.int-spec.ts`, not a unit test; a spec that drives real HTTP or a browser is e2e. Keeping that line sharp is the point of the split: the unit suites stay fast enough to gate every push, and a failure names its own layer.

**Security cases are mandatory at every tier**, not an afterthought bolted onto e2e — each app's CLAUDE.md lists its own.

Scripts: `test*` in the root `package.json` — the name says the tier and the app; `test:api` / `test:web` forward extra arguments after `--`. Integration and e2e need `db:up`; the web e2e also needs the API started with `dev:api:e2e`, which widens the throttle baseline: the whole Playwright suite registers its fixtures unauthenticated (one shared bucket) inside a single 60 s window, and the production baseline of 20 requests per 60 s leaves no headroom. Don't work around a `429` by trimming assertions — raise the baseline for the run.

**Gates.** `pre-commit` runs `lint`; when the `bldprj` agents are linked into `.claude/agents/`, `.claude/settings.json` also runs three review agents (security, correctness, test coverage) before every `git commit`, any of which can block it. `pre-push` runs `test` (both unit suites). A red spec may be committed on a branch; the tip must be green to push. Integration and e2e stay manual — run them before opening a PR.

Per-app mechanics — how each tier is written there, and what genuinely can't be tested below e2e — are in `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`.

## Optional tooling

Everything here may be missing in a session — a plugin not installed, a symlink gone, an MCP server not configured, the Agent tool disallowed. Check what the session lists; when something is absent, do the step yourself inline to the same standard and say so in the report. Never stall on it, never ask to install it, never pretend it ran.

- **bldprj pipeline** (`/bldprj:*`) — linked as `.claude/skills/bldprj` → `plugins/bldprj`, its agents as `.claude/agents/*.md`. Absent: read `plugins/bldprj/skills/<name>/SKILL.md` directly and follow it; without that directory, plain branch → PR work.
- **Project agents** (`.claude/agents/*.md`) — absent: do the reading inline (`plugins/bldprj/PIPELINE.md`, "Delegating a step", level 3).
- **Practice skills** (`nestjs-best-practices`, `vercel-react-best-practices`, `web-design-guidelines`, `ui-ux-pro-max`, `heroui-react`) — absent: read `.agents/skills/<name>/SKILL.md` (tracked); if that is gone too, apply the framework's own docs and say the pass was manual.
- **Playwright MCP** (user-level) — absent: `npx playwright screenshot <url> <file>` or a Playwright spec; if no browser is reachable, say the visual check did not run.

## Autonomous builds — the Ralph loop

`node .claude/ralph-start.js` works a feature's backlog unattended — one fresh session per task under the `/bldprj:build-phase` contract, merging a phase only after re-running its whole check set, and handing the last phase to `/bldprj:close-feature`. It needs the plugin, the pipeline's documents and the GitHub backlog. How to run, watch and recover one: [`docs/ralph-loop.md`](docs/ralph-loop.md); ceilings and their sizing: [`Ralph-Instruction.md`](Ralph-Instruction.md); the contract every session reads: [`.claude/ralph.md`](.claude/ralph.md). Halt a run with `touch .claude/ralph.stop`. Why it is built this way: [`HISTORY.md`](HISTORY.md).

## Module documentation

CLAUDE.md files stay brief on purpose. Detailed per-module docs (architecture + function-by-function reference) live under `docs/modules/`, named `module-<app>-<name>.md` (e.g. `module-api-auth.md`) and indexed in `docs/modules/INDEX.md` — committed like any other file, so a teammate or CI can read them.

- To work on a module: find it in `docs/modules/INDEX.md`, then read _only that module's_ doc — don't preload every module's doc into context.
- Before writing a new module: scan the index for existing modules that already cover, or partially cover, the needed functionality. Prefer extending a close match over writing a duplicate — only start a new module when nothing existing fits.
- After changing a module (new functions, changed behavior, new gotchas): update its doc in the same change, together with the JSDoc on the changed functions and, for `apps/api`, the Swagger annotations on any changed controller/route/DTO — and only for what you touched. Don't rewrite documentation for untouched parts of the module because the file changed.
- New module: create `docs/modules/module-<app>-<name>.md` and add its line to `docs/modules/INDEX.md`.

## Documentation maintenance

When a change affects project architecture (new app/package, new shared library, new service/database, changed layout, new CI/deployment pipeline, …), update the relevant docs in the same change: this file (layout, conventions, status), the app's `CLAUDE.md` when the change is app-specific, `README.md` when scripts, setup steps or requirements change. Doc updates are part of the task, not a follow-up.

**History goes in `HISTORY.md`, not in a Status section.** Every CLAUDE.md has a `HISTORY.md` beside it; a change worth remembering gets an entry at the top of the log that owns it — repo-wide at the root, app-specific in the app's own — recording **why**, not just what. Never the same entry in two logs; link instead. The entry shape is in `HISTORY.md`'s own header. Touch a Status section only if the current state changed, and keep it a description of the present — that split is what keeps these files from turning into changelogs again.

## Status

Where things stand now. **How they got here — and why — is in [`HISTORY.md`](HISTORY.md)**.

- npm-workspaces monorepo, two independent apps, no shared package yet; local Postgres 18 and Redis 8 via `docker-compose.yml`, Redis provisioned but still unused.
- `apps/api` — Prisma on Postgres; email/password auth over CQRS, with every other session revoked on a password change; the caller's own profile; meetings; owner-scoped files with every upload limit enforced at the route. Current state: `apps/api/CLAUDE.md`.
- `apps/web` — auth-gated dashboard, `/register`, `/login`, `/profile` and `/meetings/[id]` on an `httpOnly` session cookie read server-side, byte traffic through same-origin proxies so the token never reaches the browser. Current state: `apps/web/CLAUDE.md`.
- Dependencies are current within their supported majors; ESLint 10, TypeScript 7 and `@types/node` 26 are deliberately held back — reasons and re-check conditions in `HISTORY.md`.
- Still absent: shared libs, CI, and deployment config.
