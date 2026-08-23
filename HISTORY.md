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

### 2026-08-23 — `user-profile`: an account page, and a session model that can be ended

The feature that landed across six phases gave an account a page of its own — email, display name, avatar, password — but the part that changed the repo rather than adding to it is the **session model**.

Until now a JWT was valid until its own `exp` and nothing could shorten that: not a password change, not deleting the user. `User` gained a `tokenVersion` column, `apps/api` signs it into the token as `ver`, and `JwtStrategy.validate` reads the user on every guarded request and refuses anything whose `ver` has fallen behind. That is a primary-key read added to the authentication path of every request — accepted deliberately, because AC-13's promise is that the other sessions are refused **on their next request**, and nothing that avoids a per-request read can make that promise. A `passwordChangedAt`-vs-`iat` comparison was rejected for its one-second window; a Redis denylist was rejected because the repo treats Redis as optional infrastructure and a revocation list that may be unreachable is not a control. A missing `ver` reads as `0`, so nothing minted before this shipped was forcibly signed out.

Two consequences reach across both apps. **Token minting moved behind one command** (`IssueAccessTokenCommand`), used by register, login and the password route alike, so the claim set cannot drift from what the guard checks — the precise failure that would silently break revocation. And **`403`, not `401`, answers a wrong current password**: `apps/web` reads a `401` as "the session is gone" and redirects to `/login`, which is now also how a revoked token surfaces, so reusing `401` for a typo would sign a user out for mistyping. That split had to be carried all the way through the web client, the Server Action and every page that calls `apps/api` with the session token.

The rest of the feature is per-app and recorded there: the profile module, the avatar's storage and limits and the password route in [`apps/api/HISTORY.md`](apps/api/HISTORY.md); the profile page, the byte proxy, the avatar mark and the password form in [`apps/web/HISTORY.md`](apps/web/HISTORY.md). The one repo-wide caveat worth repeating is that there is still no shared package between the apps, so every DTO the web app talks to — profile fields, avatar limits and their refusal wording, the password response — is a hand-copy kept in sync by hand.

### 2026-08-20 — The loop can be stopped at a boundary, and a resume grants its ceilings again

Pause and Stop have always acted at the **next link boundary** — the right behaviour when something
is wrong, and the wrong place to stop when nothing is. Halting between `merge` and `settle` leaves a
phase merged but not settled; halting between two of a phase's tasks leaves a person reading the MS
file to work out where the chain got to. Both are recoverable, and both cost the time it takes to
work out what state the run is in — which is exactly the time an unattended build was meant to save.

A **standing hold** arms the same two actions for a boundary further off: the end of the task in
flight (its commits pushed, its issue labelled `ralph:done`) or the end of the phase (merged **and**
settled, everything it produced on the base branch). It is a file, `.claude/ralph.hold.json`, that
`decide()` consults at exactly those two points; a hold armed for a task also fires at the phase
boundary, since one set while a `close`, `merge` or `settle` link is in flight has no task boundary
left ahead of it and would otherwise stop somewhere in the middle of the next phase. Holds are one at
a time — two would only ever mean the earlier boundary — and one that fires clears itself first, so
a resume carries on instead of stopping again where it was just released.

Making "stop tonight, carry on tomorrow" a button exposed the other half of the problem: the ceilings
were counted from `startedAt`, so a run resumed the next morning was refused on
`wall-clock ceiling reached` before it spawned anything, and `docs/ralph-loop.md` had been promising
that `--resume` grants another budget. The hours a run spends waiting for a person are not hours it
spent working. `--resume` now opens a ceiling **window** (`state.budget`) that `maxRunHours` and
`maxSessionsPerRun` are measured over; `startedAt` still says how long the whole run has been going,
and a view shows the session ceiling as the number the chain will actually stop at. It also clears
`.claude/ralph.pause` on the way in, which a fired pause hold would otherwise leave behind for the
guard to refuse the resume on, and it carries the run's `checkpoints` across rather than composing a
state without them — a rollback after a resume had nothing to rewind to.

### 2026-08-20 — The browser suite gets its own API command, and the merge gate uses it

`npm run dev:api:e2e` starts `apps/api` with `THROTTLE_LIMIT` raised, and `.claude/ralph/verify.js` starts it that way too rather than with plain `dev:api`. Both exist for one reason: every Playwright fixture registers through the unauthenticated `POST /auth/register`, so the throttler tracks it by IP, the whole suite shares a single bucket, and the suite runs inside one 60-second window — against the production baseline of 20 req/60 s there is no headroom for a new spec, and whichever cases tip over answer `429` regardless of which file added them. Details of the API-side change are in [`apps/api/HISTORY.md`](apps/api/HISTORY.md).

The gate matters as much as the command. `verify.js` is what re-runs a phase's checks before the loop merges it, so a gate starting the API differently from the documented way would fail the browser suite on a machine where a person's run passes — the least debuggable kind of disagreement. Two hooks also went wrong the same week and are worth naming together: `.claude/settings.json` registered `stop.js` and `guard-bash.js` by **relative** path, so any session whose cwd had moved into `apps/api` failed to load them — silently stalling the chain (the Stop hook is what advances it) and, worse, letting the bash guard fail open. They take `$CLAUDE_PROJECT_DIR` now.

### 2026-08-18 — Module docs moved out of `.claude/` into `docs/modules/`

The per-module architecture references lived in `.claude/modules/` so they would be committed
alongside the CLAUDE.md files that point at them. That worked for hand-driven sessions and broke
every unattended one: Claude Code treats anything under `.claude/` as a **sensitive path**, refuses
to write it without an interactive confirmation, and that check sits above `permissions.allow` — so
`Write(.claude/modules/**)` in `.claude/settings.local.json` did not help. A Ralph session runs
`claude -p ... --permission-mode acceptEdits`, where there is nobody to confirm, so it simply could
not write a module doc. `user-profile` phase 1 lost three sessions and the whole close stage to
exactly that: task 1.6 retried to exhaustion, was labelled `ralph:blocked`, and the phase never
reached in-review even though the code was green.

The fix is to stop keeping working documentation inside the harness's own directory. `docs/modules/`
is where the rest of the project's documentation already lives, it is nobody's config, and it is
writable by an unattended session. Everything else about the convention is unchanged — same
`module-<app>-<name>.md` names, same `INDEX.md`, same one-line pointers from each CLAUDE.md.

`.claude/` keeps only what is genuinely harness configuration: hooks, the Ralph chain and its
contract, settings. The pointers in the older entries and in `docs/archive/` were rewritten to the
new path as well — an exception to "don't rewrite older entries", made deliberately: those lines are
navigation, not history, and left alone they would send a reader to a directory that no longer
exists.

### 2026-08-18 — An operator's reference for Ralph's ceilings

`docs/ralph-loop.md` lists the config keys but not what they cost. Two questions kept coming back
that a key table cannot answer: what a _turn_ actually is (one assistant move, so one tool call — a
test run, an edit, a commit), and what to do with a session that was cut off halfway. Neither is
guessable from `maxTurnsPerTask: 200`, and getting them wrong is expensive: the natural reaction to a
session that ran out of turns is to raise the ceiling, which is usually the wrong fix — a 300-turn
session drags a context large enough to hit the dollar ceiling first, and the real problem was a task
that should have been split in the plan.

So `Ralph-Instruction.md` was written beside the operator's guide rather than folded into it: what a
turn and a dollar budget bound, the full path a cut-off session takes (`SessionEnd` → `advance()` →
`verifyPreviousStage` → `attempts` → `halt`), why a retry gets a clean context but a dirty working
tree, the three ways back, and four presets from a small feature to a cross-cutting one. The presets
carry a worst-case `maxSessionsPerRun × maxBudgetUsdPerSession` column on purpose — the loop has no
run-level dollar ceiling, and the blast radius of an overnight run should be a number somebody read
rather than one they discover.

### 2026-08-18 — Watching a Ralph run: two views over one monitor core

The loop as first written was unwatchable. Sessions were spawned with `--output-format text`, which
writes nothing to the log until the session has already ended, so a run in progress showed an empty
file and `--status` showed one line of state — for a chain that spends hours and real money, that is
not enough to decide anything. Sessions now write `stream-json`, which costs nothing and puts every
tool call, turn, thinking estimate and the final cost into the log as it happens; a session log is
`NNN-<stage>.jsonl`, a `node` step's is still `NNN-<stage>.log`, and `.claude/ralph/monitor.js`
folds either into one snapshot.

**Two views, one core, no decisions in either.** `--watch` draws a terminal panel and `--ui` serves a
loopback dashboard; both render `monitor.snapshot()` and call the same commands, so neither can
drift from the other or from the chain. A snapshot reads local files only — it is taken twice a
second by every view — and GitHub is touched once, when a rollback needs the commit a merge landed
as. Views attach to and detach from a running chain freely, because the chain is detached processes
and never depended on a terminal.

**Pause is not halt.** `.claude/ralph.pause` holds the chain at the next link boundary, keeping the
link in flight; `.claude/ralph.stop` is still the halt, which means the loop refusing to go on. Both
are checked in `guards()`, so a paused chain simply declines to spawn instead of needing anything
killed. Stop can kill the link in flight, and when it does the stop file goes down **first** — a
session killed while the chain was still open would have its own `Stop` hook spawn the successor.

**Only one thing decides at a time.** `advance()` was safe by construction while the only caller was
the link that had just ended; a Resume button broke that, because two views — or two clicks a second
apart — each start a decision, and two decisions reconcile the same stage and spawn two sessions onto
one working tree. Deciding now takes `.claude/ralph.advance.lock` first, a file rather than anything
in-process, since the callers are separate processes. Resume also stopped treating a live pid as
proof the chain will move on: a session whose hook fired while the pause was down had its one chance
refused, so the monitor reads the link's own log, and when the log shows the session over it stands
in for it — passing that session's id, so the marker that already makes `Stop` and `SessionEnd`
idempotent covers the stand-in too.

**Rollback is planned before it runs.** Resetting a branch or reverting a merge from a keypress is
exactly the sort of thing that is regretted at 3 a.m., so `planRollback()` returns the argv of every
step as data, the suite asserts them, and the view shows what it is about to do before it does it.
The plan is also built **before** anything is killed: the first cut killed the session first, so a
mode that turned out to be impossible — "undo the last finished task" while the phase's first task is
still running — left a dead session, no successor and a silently stopped build.
Three modes: restart the current link, undo the last finished task, or revert a merged phase PR. The
first two rewind to a checkpoint the chain records immediately before each link — the chain takes it,
not the monitor, because only the chain knows the instant a link begins — and anything discarded is
kept on a `ralph-backup/<runId>-<stamp>` branch. The revert never pushes to the base branch: it opens
a PR and halts the run, which keeps the loop's own rule that nothing reaches `main` except through a
merge.

**Settings change the next link, not the running one.** Model, fallback, effort, turn ceilings,
budget and retries are editable from either view and land in `.claude/ralph.overrides.json`
(gitignored), merged over the committed config at spawn time. The config stays the record of what the
run was asked to do. `effort` is new to the config as well, passed through as `claude --effort`.
Workers is displayed and deliberately fixed at `1`: the chain shares one working tree and one branch,
and its guarantees about commit order and the red-before-green sequence come from being serial.

**The dashboard is a control surface, so it is treated as one.** It binds `127.0.0.1`, every request
carries a token minted at startup, cross-origin requests are refused, and a `Host` header that is not
the loopback is refused too — that last one is what DNS rebinding looks like, and without it a page
in the same browser could halt a build. The terminal view strips control characters out of everything
it prints, because the activity lines come from a log a session wrote and a terminal that renders
escape sequences out of a log is a terminal that log can drive.

One thing the checkpoints exposed on the way: `--dry-run` was not dry. It wrote state, claimed a run
id, bumped the session count and left a lock behind, so the real run that followed refused to start
against a lock nobody held. `writeState`, `writeLock`, `event` and `halt` now return early under
`RALPH_DRY_RUN`, and a dry run decides and prints exactly as before while recording nothing.

`npm run test:tools` runs the tooling suites (`.claude/hooks` and `.claude/ralph`). It is not wired
into `npm test`, which stays what `pre-push` gates on — the two apps' unit suites.

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

Email/password register/login issuing JWTs, hardened the same day against timing-based user enumeration, registration races, oversized-payload DoS and brute force. Detailed per-module architecture references moved out of `CLAUDE.md` — first into assistant memory, then into `docs/modules/`, where they're committed like any other file so a teammate or CI can read them.

### 2026-07-28 — Scaffolded

`create-next-app` + `nest new` into an npm-workspaces monorepo, with Postgres 18 and Redis 8 in `docker-compose.yml` for local development (Redis password-protected from the start). The conventions that still hold were set here: TypeScript everywhere, one shared Prettier config with per-app ESLint, JSDoc on every function, and Swagger annotations on every `apps/api` route.

Redis was provisioned for future caching/session/pub-sub use and remains unused. The project-wide rule dates from here: it is best-effort infrastructure, and nothing may hard-depend on it being up.
