# History — video-meetings

How the repo reached its current shape, newest first. `CLAUDE.md`'s Status section says only where things stand **now**; this file says how they got there and why, so a decision can be understood months later without reading the whole git log.

Per-app detail lives next to the app it belongs to: [`apps/api/HISTORY.md`](apps/api/HISTORY.md), [`apps/web/HISTORY.md`](apps/web/HISTORY.md). This file keeps what is repo-wide — layout, shared tooling, conventions, cross-app features — and points at the app histories rather than repeating them.

**How to keep it.** When a change lands that would once have been appended to a Status paragraph, add an entry at the top of the log instead:

- One `###` heading per change: `### YYYY-MM-DD — <short title>`, grouped under the `## YYYY-MM` heading it belongs to (add the month heading when the first entry of a new month lands).
- Say what changed and, more importantly, **why** — the constraint, the alternative rejected, the thing that broke. A line that only restates the diff isn't worth writing.
- Dates are the date the change landed on the base branch (`git log --date=short`).
- Don't rewrite or tidy older entries. They describe what was true then; a later entry supersedes them.
- Then update `CLAUDE.md`'s Status only if the _current state_ changed — history goes here, not there.

---

## 2026-08

### 2026-08-18 — The Ralph loop: unattended builds, one session per task

`node .claude/ralph-start.js` now works a feature's backlog without a person driving each step. The first cut of it drove the loop from a `Stop` hook that called `execSync('claude -p …')`, and that shape cannot work: hooks are killed at their timeout — 60 s by default — while the session inside was given 500 turns, and because the child inherits the same `settings.json`, its own `Stop` hook launched a grandchild _inside_ the child, nesting the chain instead of advancing it. The rewrite keeps the hook as the driver but makes it a tail call: it reads its stdin, decides, spawns one **detached** successor with `spawn(..., { detached: true })` and exits in ~20 ms. `SessionEnd` runs the same script as a backstop for a session that dies on its turn ceiling without `Stop` firing, and a per-session marker file makes the pair idempotent so the two events cannot spawn two successors.

**The loop owns the chain; `/bldprj:build-phase` still owns the work.** Reimplementing the phase contract inside the loop was tried and abandoned — it drifted from the pipeline on all four things that matter. Tasks are now taken from `docs/<slug>/<slug>-MS.json` in the order `issues` wrote them (1.1 first), **never** from `gh issue list`, which returns newest first and had the loop working each milestone backwards, inverting the test-first order the task numbers encode. An issue is marked `ralph:done` rather than closed, because the pipeline closes issues only through a merged PR's `Closes` lines and closing them early leaves a closed issue behind an unmerged PR. Each phase is opened, worked task by task, closed into a PR, merged and settled through `build-phase`'s own settle run, and the last phase hands off to `close-feature`.

**Full auto means the gate had to stop being a person.** The loop merges its own PRs, so `.claude/ralph/verify.js` re-runs lint, format, every tier the phase owns and the pipeline's docs linter itself and merges only on a clean sweep — a session's own report that it is green buys nothing. It runs as its own detached step for the same reason the hook cannot block: a full check set takes minutes. Two further consequences are deliberate rather than overlooked. `mergeStrategy` is `merge`, not `squash`: every phase PR of `meeting-file-upload` landed as a merge commit, and squashing would erase the red `test(...)`-before-`feat(...)` history that is the only evidence the mandated cycle actually ran. And phase 1's **Verified by** clause "the e2e cases are written and reviewed with the requester first" is **waived for Ralph runs** — there is no requester in the room; the compensating record is that a tests-only task posts its case list on the issue before implementing, so the cases can still be read back.

**What guards the tree.** `.claude/settings.json` gained a `deny` list, which it never had while granting `Bash(git *)` and `Bash(gh *)` — that pair alone allowed `reset --hard`, force pushes and `gh pr merge`. Pattern matching cannot catch a flag in an unexpected position (`git commit -m x --no-verify` slips a `Bash(git commit --no-verify*)` rule), so `.claude/hooks/guard-bash.js` reads the whole command line on `PreToolUse` instead; it covers both this loop and a person's session. Ceilings replaced the unexplained `maxIterations: 10`: turns and dollars per session, sessions and wall-clock hours per run, and a retry budget per task after which the task is labelled `ralph:blocked` and the chain halts — the first cut would have re-picked a failing issue until its budget burned out. `touch .claude/ralph.stop` halts a run from outside at any point.

Config is committed and read-only at run time; state, logs, the lock and the stop file are per-run and gitignored. The `active` flag lived in the config before, where nothing ever set it — the loop as first written ran exactly one session and then stopped.

### 2026-08-16 — Dependencies updated within their supported majors

Everything movable was moved: NestJS 11.1.28 → 11.2.1, Next.js and `eslint-config-next` 16.2.12 → 16.3.1, React 19.2.4 → 19.2.8, HeroUI 3.2.2 → 3.2.4, postcss 8.4.31 → 8.5.26, pg, dotenv, typescript-eslint and the `@types` packages. `apps/web` had been on `@types/node@^20` while `.nvmrc` pinned Node 24 and `apps/api` was on `^24`; aligned to `^24`. `npm audit` went from 7 high findings to one with no non-downgrade fix (`js-yaml`, reached through `@nestjs/swagger@11.4.6` — `audit fix --force` "fixes" it by downgrading swagger).

Three majors were **held back, each blocked upstream rather than by preference**, and are worth re-checking when the blockers publish support:

- **ESLint 10** — attempted and reverted. `apps/api` lints clean on it, but `apps/web` crashes with `TypeError: contextOrFilename.getFilename is not a function` from `eslint-plugin-react@7.37.5`, which arrives through `eslint-config-next`, is the latest published version, and declares `eslint: … || ^9.7`. There is no v10-compatible release to move to.
- **TypeScript 7** — `ts-jest` peers at `typescript >=4.3 <7` and `typescript-eslint` at `<6.1.0`; taking it would break `apps/api`'s Jest transform and both apps' linting.
- **`@types/node` 26** — tracks Node 26. This repo pins Node 24, so `^24` is the correct version rather than a stale one.

### 2026-08-16 — Testing widened from e2e-first to three tiers

E2e was the only tier with a real workflow behind it: `apps/api` had a handful of unit specs and no way to exercise a module against Postgres without going through HTTP, and `apps/web` had no non-browser runner at all, so its pure logic and its proxy routes were only reachable through Playwright.

Both apps now require unit and integration coverage alongside e2e, written before the code, outside in (see the root Testing section). `apps/api` gained a third Jest config (`test/jest-int.json`, `npm run test:int`) for `*.int-spec.ts`; `apps/web` gained Vitest 4 + React Testing Library. `pre-push` moved from `npm run test:api` to `npm test` — both apps' unit suites — since `apps/web` finally has one to gate. The tiers needing Postgres stay out of the hooks deliberately.

### 2026-08-16 — Test gate split from the commit gate

`pre-commit` runs `npm run lint` only and `pre-push` runs the unit suites, so a deliberately failing spec can be committed while nothing red leaves the machine. This is what makes the red half of Red/Green/Refactor survive in `git log` instead of being squashed out of existence: a cycle whose specs and implementation land together is indistinguishable afterwards from tests written last.

### 2026-08-16 — `meeting-file-upload` shipped and closed out

The repo's first feature to run the full docs pipeline (PRD → plan → research → threats → final plan → phased build; archived under `docs/archive/meeting-file-upload/`). Six phases: a files module on local disk behind an abstract `FileStorage` boundary; every PRD limit enforced at the API itself (500 MB per file, content-sniffed types, 20 live files per meeting, 20 GB per owner); soft delete, restore and a scheduled 30-day purge; then the web UI — a meeting page with its file list and download, multi-file upload with per-file progress, and in-page playback/preview with delete/restore.

Two constraints shaped it beyond the PRD: a file's bytes never travel through a browser-visible credential (both directions go through same-origin proxy Route Handlers that attach the session token server-side), and the owner quota is reserved in-process for the life of an upload, so concurrent uploads can't together outrun a limit neither would break alone. Per-app detail in the two app histories.

---

## 2026-07

### 2026-07-31 — Security test cases made mandatory

Both apps' test-writing rules gained a required list — authorization boundaries, auth bypass, mass assignment, rate limiting on the API side; session/cookie handling, tampered sessions, XSS and token leakage on the web side — written before implementation like any other case rather than bolted on after.

### 2026-07-31 — `apps/web` moved onto a server-read session and became auth-gated

Auth was refactored off a client-side `localStorage` JWT onto an `httpOnly` cookie set by Server Actions, because any session state read after mount produces a visible flip from signed-out to signed-in. The home page then stopped being a public landing page altogether: it redirects server-side before render without a valid session, and otherwise shows the caller's meetings. See [`apps/web/HISTORY.md`](apps/web/HISTORY.md).

### 2026-07-30 — Both apps runnable together, and `apps/api` moved off port 3000

A root `npm run dev` starts `apps/api` then `apps/web` in one terminal via `concurrently`, and `apps/api`'s default port moved from `3000` to `3001` so the two stop colliding. Because they now sit on different origins in dev, `apps/api` enables CORS for `apps/web`'s origin (`CORS_ORIGIN`) — kept in place even though auth itself later moved to server-to-server calls.

### 2026-07-30 — `apps/web` got its UI stack and its first feature

Playwright e2e testing, then HeroUI v3 + Tailwind CSS v4 replacing the `create-next-app` scaffold, then `/register` and `/login` against `apps/api`'s auth. See [`apps/web/HISTORY.md`](apps/web/HISTORY.md).

### 2026-07-30 — `apps/api` gained meetings, and auth was split into three modules

The meetings module (create/list/get, guarded and scoped to the caller) became the first consumer of the JWT guard. Auth itself was split into `auth` / `users` / `credentials`, composed over CQRS so token orchestration, user persistence and password hashing stay independently replaceable. See [`apps/api/HISTORY.md`](apps/api/HISTORY.md).

### 2026-07-30 — TDD made explicit rather than assumed

`apps/api`'s workflow was written down as Red/Green/Refactor and e2e-first, with the rule that a refactor never starts from a red baseline and that test rewrites are confirmed with the requester rather than done silently. A Husky hook landed the same day; it was split into the commit/push pair later (see 2026-08-16).

### 2026-07-29 — Auth on Prisma-backed Postgres, and per-module docs moved into the repo

Email/password register/login issuing JWTs, hardened the same day against timing-based user enumeration, registration races, oversized-payload DoS and brute force. Detailed per-module architecture references moved out of `CLAUDE.md` — first into assistant memory, then into `.claude/modules/`, where they're committed like any other file so a teammate or CI can read them.

### 2026-07-28 — Scaffolded

`create-next-app` + `nest new` into an npm-workspaces monorepo, with Postgres 18 and Redis 8 in `docker-compose.yml` for local development (Redis password-protected from the start). The conventions that still hold were set here: TypeScript everywhere, one shared Prettier config with per-app ESLint, JSDoc on every function, and Swagger annotations on every `apps/api` route.

Redis was provisioned for future caching/session/pub-sub use and remains unused. The project-wide rule dates from here: it is best-effort infrastructure, and nothing may hard-depend on it being up.
