---
name: build-phase
description: 'Builds one plan phase end to end — branch, tasks test-first, full checks, PR — then closes its issues and milestone, logs the phase in docs/Features.md or docs/Refactor.md, and records progress in docs/<slug>/<slug>-MS.json. Use when the backlog exists and a phase is ready to be implemented, or when a phase or milestone is named to be built.'
---

# Build phase

One run carries exactly one phase from a fresh branch to a **green** pushed PR with its issues closed. Tasks from other phases stay untouched however small they look: the phase split is the contract, and a phase that spreads loses the independent verifiability it was cut for.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → `issues` → **`build-phase`**, run by hand, one phase at a time.

Sources of truth, in priority order when they disagree:

1. **RESEARCH** — the decisions already made: library, storage, limits, interfaces. Implementation does not reopen them.
2. **PLAN** — the phase's tasks and its **Done when**, which is the definition of done rather than a wish.
3. **PRD** — goal and scope, Out of scope first.
4. **`CLAUDE.md` and the module docs** — how this repo writes things.

A contradiction between them is a question for the user, never a silent pick.

## Argument

A phase number or milestone title (`/build-phase 2`, `/build-phase "Phase 2. Upload and list meeting files"`), optionally followed by the MS file path (`/build-phase 2 docs/meeting-file-upload/meeting-file-upload-MS.json`).

- No argument → list the open phases from `docs/*/*-MS.json` with their status and ask which one to build, rather than picking one.
- A `-REFACTOR-MS.json` map file, or one carrying `"track": "refactor"` → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `build-phase` section opens the phase with a green baseline instead of a failing test, and closes it on parity evidence.
- Several MS files and no path given → ask which feature, since phase numbers repeat across features.
- Titles match case-insensitively on substring; more than one candidate → show them and ask.
- The milestone is already closed, or all its issues are → say so and ask whether to finish it off (a phase can be partly done) or take the next open phase.

## Steps

### 1. Load the phase

Read, before any code:

1. `docs/<slug>/<slug>-MS.json` — this phase's block: milestone number and URL, and its issues with numbers, titles and labels. That is the task → issue map every later step closes work against.
2. `docs/<slug>/<slug>-PLAN.md` — this phase's block whole: **Goal**, **Touches**, **Tasks**, **Done when**.
3. `docs/<slug>/<slug>-RESEARCH.md` when `sources.research` names one — the Decisions, Parameters and Dependencies entries tagged with this phase's tasks. Limits, package versions, env var names and error codes are copied **verbatim** from there.
4. `docs/<slug>/<slug>-PRD.md` — the goal and Out of scope.
5. Root `CLAUDE.md` plus the `CLAUDE.md` of each app the phase touches.
6. `.claude/modules/INDEX.md`, then the docs of only the modules this phase touches or that already solve a close problem — extending one beats creating a duplicate.

No research file and a task hides a technical choice (library, storage format, limits) → say so and offer `/research` first, rather than picking a library on the spot.

Done when you can name, for every issue in the phase, the plan task it implements and the research decision that constrains it, or that there is none.

### 2. Check the phase order

From the MS file: are the previous phases' milestones closed, and is the previous phase's PR merged into the base branch (`gh pr list --state merged --head feature/<slug>-phase-<N-1>`)?

An unmerged previous phase that this one builds on (typically a frontend phase over its backend) → show that and ask which base to take: the base branch anyway, or `feature/<slug>-phase-<N-1>` so this phase can see that code. Running a phase out of turn silently is not an option.

Done when you can state the branch this phase starts from and why.

### 3. Prepare the tree

- `git status` — the tree must be clean. Uncommitted changes → show them and ask what to do with them; nothing is reset or stashed on your own initiative.
- Base branch by git flow: `develop` when it exists, otherwise `main`. Bring it current: `git checkout <base> && git pull --ff-only`.
- Infrastructure the phase's tasks need: `npm install` when the lock file moved, `npm run db:up` and `npm run prisma:migrate:dev` when the phase touches the database or its tests need Postgres.

Done when the tree is clean, the starting branch from step 2 is current, and the commands this phase's tests run under actually work.

### 4. Branch the phase

```bash
git checkout -b feature/meeting-file-upload-phase-2 <starting branch from step 2>
```

- The name is `feature/<slug>-phase-<N>`, and the slug comes from the PRD/PLAN/MS filenames — inventing a new one scatters a feature's branches.
- The branch already exists → switch to it and continue the phase; commits on it you cannot account for → show `git log` and ask.
- Every commit of this run lands here. `main` and `develop` receive none.

Done when `git branch --show-current` prints the phase branch.

### 5. Work the tasks in plan order

Plan order encodes the dependencies: tests before implementation, model before routes, backend before frontend. On the refactor track, the track file's `build-phase` section sets this step's rhythm instead — green baseline first, then code that keeps the suite as it is. Per task:

1. Match it against its research decision and the app's conventions.
2. Write it in the surrounding code's style — `apps/api` goes Red/Green/Refactor (a failing test first, implementation second, refactors only from a green baseline); `apps/web` gets a Playwright e2e over the user scenario. Tests keep their teeth: rewriting or weakening one to reach green is agreed with the user first.
3. Honour the repo's standing conventions: JSDoc on every function, provider and component, Swagger annotations on new `apps/api` routes and DTOs, and no secrets, storage paths or other users' data in responses or markup.
4. Run that task's tests immediately — `npm run test:api` for backend work, `npm run test:e2e:web` for frontend work — rather than saving them for the end of the phase.
5. Commit the task in the format below, and tick it off only once those tests are green.

A task that cannot be done as written, or that contradicts the research → stop and ask, rather than substituting your own reading of it.

Anything beyond the phase's tasks stays out of this branch: drive-by refactors, "while I'm here" fixes to neighbouring modules, and improvements the PRD put out of scope.

Done when every issue in the phase has its code and green tests, or is named explicitly as not done and why.

### 6. Move the docs with the code

Part of the phase, not a follow-up — root `CLAUDE.md` requires it:

- `.claude/modules/module-<app>-<name>.md` — a new module gets its doc plus a line in `.claude/modules/INDEX.md`; a changed module gets only the functions and gotchas that actually changed.
- The one-line pointer in the app's `CLAUDE.md` — only for a new module or a changed one-line purpose.
- `README.md`, root `CLAUDE.md`, `.env.example` — when scripts, env vars, infrastructure or architecture moved.

Done when a teammate reading only the docs would find every function, endpoint and env var this phase added.

### 7. Prove the phase green

Run the full set and show the user the actual output:

```bash
npm run lint
npm run format:check
npm run test:api
npm run test:e2e:web   # when the phase touched apps/web
npm run build          # when configs, dependencies or a public API moved
```

Then walk the phase's **Done when** from the plan point by point, each backed by a fact — a test name, command output, a response you actually saw — not by reasoning. A refactor phase adds its parity evidence here: the baseline output and this run's output, side by side, plus the after-number for the phase's outcome.

**Red does not get pushed.** Fix the cause; a stubborn failure goes to the user with its output instead of a silenced test.

A phase touching user input, other users' data, files or authorization gets a review before the push: `requesting-code-review`, or `/security-review` for the security pass.

Done when every command above is green and every clause of **Done when** has its evidence.

### 8. Push and open the PR

```bash
git push -u origin feature/<slug>-phase-<N>
gh pr create --base <base> --head feature/<slug>-phase-<N> \
  --title "<KEY> <N>. <phase title>" --milestone "<the phase's milestone title from the MS file, e.g. MFU 1 · Storage service and upload endpoint>" --body "<body>"
```

PR body: the phase **Goal**, one line per task with its issue number and commit, the **Done when** evidence from step 7, and a link to the RESEARCH file when one exists. Merging is the user's — this run opens the PR and stops there.

Done when the PR exists on the phase's milestone and its URL is in hand.

### 9. Close the phase on GitHub

Only what is genuinely done and verified gets closed. Issue numbers come from the MS file:

```bash
gh issue close <number> --comment "Done in feature/<slug>-phase-<N>, commit <sha>, PR <url>."
```

The milestone closes **only once all its issues are closed** (`gh` has no `milestone` subcommand — go through the API):

```bash
gh api repos/{owner}/{repo}/milestones/<number> -X PATCH -f state=closed
```

Done when every implemented task's issue is closed, and the milestone is either closed or reported as open with the task that is holding it.

### 10. Record the progress

`docs/<slug>/<slug>-MS.json`, dates from `date +%F`:

- Each closed issue → `"state": "CLOSED"` plus `"closedAt"`.
- The phase's milestone → `"state": "closed"` plus `"completedAt"`, `"branch"` and `"pr"`.
- The phase block → `"status": "completed"`, or `"in-progress"` when it closed only partly.
- The root `progress` block → `updatedAt`, `completedPhases`, `currentPhase`, and `nextPhase` pointing at the first phase whose milestone is still open (`null` once none are).

`docs/<slug>/<slug>-PLAN.md`: tick this phase's tasks `- [ ]` → `- [x]` and append `**Status**: complete — <date>, branch feature/<slug>-phase-<N>, PR <url>` to its block. Other phases stay untouched.

`docs/Features.md` — the shipped-work log described below, created from its template when it does not exist yet. Append one row to this feature's table under `## In progress`, oldest first. The refactor track logs to `docs/Refactor.md` in the same way.

The three files go in one commit — `docs: mark phase <N> complete` — pushed to the phase branch, which updates the open PR.

Done when the MS file describes what GitHub now shows, `nextPhase` names the phase to run next, and the log's new row states what a teammate can now do that they could not before.

### 11. Close the feature, when this was the last phase

No open milestone left for this feature → read [`CLOSEOUT.md`](CLOSEOUT.md) and follow it. Otherwise skip this step.

Done when either the close-out ran, or the next open milestone is named in the report.

### 12. Report

Facts, briefly:

- branch, its base, and the commits;
- task → issue → commit for what was implemented;
- test and check results as they came out, including anything skipped and why;
- the phase's **Done when**, clause by clause, with the evidence;
- what closed on GitHub and what stayed open, plus the PR URL;
- the next phase — number, title, milestone URL — and the command: `/build-phase <N+1>`;
- open questions and anything left out of scope.

## Commit format

One commit per task, so each commit maps to one issue and stays revertable:

```
<type>(<scope>): <what was done>

Refs #<issue number>
```

- `type` and `scope` follow the repo's history (`feat(api)`, `test(web)`, `docs`, `build`).
- Two tasks share a commit only when they physically cannot be split — a Red→Green step where test and code land together — and then `Refs` lists both issues.
- The Husky pre-commit hook runs lint and `test:api`. A commit it rejects means fixing the cause; the hook stays in the loop (`--no-verify` is off the table).

## Shipped-work log

`docs/Features.md` and `docs/Refactor.md` are this repo's changelog for humans: a phase row lands after every milestone, and close-out collapses a finished feature's rows into one **Shipped** line. Descriptions are one line each — in the user's terms for a feature, in numbers for a refactor.

```markdown
# Features

Shipped features, newest first. Phase rows collect under **In progress** while a feature is being built, and collapse into one **Shipped** row when it closes out.

## Shipped

| Date       | Feature             | What it does                                                                 | Docs                                                          |
| ---------- | ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 2026-08-04 | meeting-file-upload | Meeting owners upload, list and delete files on a meeting, up to 25 MB each. | [PRD](archive/meeting-file-upload/meeting-file-upload-PRD.md) |

## In progress

### meeting-file-upload

| Date       | Phase                                  | What landed                                                                        | PR  |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------- | --- |
| 2026-08-01 | 1. Storage service and upload endpoint | Files store on disk behind StorageService; `POST /meetings/:id/files` returns 201. | #41 |
```

`docs/Refactor.md` is the same file with two columns of its own: **Measured** — the before → after number of the outcome that phase served — and **Parity** — the evidence it held (suite green, no test file changed).

## Rules

- One phase per run. Other phases' tasks are not implemented and their issues are not closed.
- Research decisions are not reopened during implementation; a discrepancy is a question, not a silent replay.
- Nothing outside the PRD's scope. A worthwhile improvement spotted in passing becomes its own task, not a commit in this branch.
- Work happens on `feature/<slug>-phase-<N>` cut from `develop`/`main` (or from the previous phase's branch, per step 2). The base branch receives no commits.
- The branch slug matches the slug of the PRD/PLAN/MS files.
- Tests run after every task and in full before the push; red never gets pushed.
- Tests are not rewritten or weakened to reach green; any test rewrite is agreed with the user first.
- An issue closes only after its task is implemented and verified; a milestone only once all its issues are closed.
- Docs — module docs, JSDoc, Swagger, `CLAUDE.md`, `README.md`, `.env.example` — land in the same phase as the code.
- Report honestly: failing tests and skipped steps are named outright, with the command output.
