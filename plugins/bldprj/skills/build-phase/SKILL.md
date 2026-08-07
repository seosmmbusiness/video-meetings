---
name: build-phase
description: 'Builds one plan phase end to end — branch, tasks test-first, full checks, PR — then settles the merged phase: closes its issues and milestone, logs it in docs/Features.md or docs/Refactor.md, and records progress in docs/<slug>/<slug>-MS.json. Use when the backlog exists and a phase is ready to be implemented, or when a phase or milestone is named to be built or finalised.'
---

# Build phase

One run carries exactly one phase from a fresh branch to a **green** pushed PR, and settles the phase before it now that its PR has merged. Tasks from other phases stay untouched however small they look: the phase split is the contract, and a phase that spreads loses the independent verifiability it was cut for.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → **`build-phase`** → `close-feature`, run by hand, one phase at a time.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, path resolution and the question protocol are defined there and are not repeated here.

Sources of truth, in priority order when they disagree:

1. **FINAL** — the phase's tasks with the parameters and controls already folded in, and its **Done when**, which is the definition of done rather than a wish. `pre-issues` ruled on every contradiction the other documents held, so FINAL wins over all of them.
2. **RESEARCH** — the reasoning behind a `D-<n>` FINAL cites: why this library, this storage, this interface. Implementation does not reopen them.
3. **THREATS** — the reasoning behind an `S-<n>` FINAL cites, and the proof each control needs.
4. **PRD** — goal and scope, Out of scope first.
5. **`CLAUDE.md` and the module docs** — how this repo writes things.

The preliminary `-PLAN.md` is history: FINAL superseded it, and nothing in this run reads it.

A contradiction that survives — FINAL against the research it cites, or against the PRD — is a question for the user and a `/pre-issues` re-run, never a silent pick.

## Argument

A phase number or milestone title (`/build-phase 2`, `/build-phase R1`, `/build-phase "Phase 2. Upload and list meeting files"`), optionally followed by the MS file path (`/build-phase 2 docs/meeting-file-upload/meeting-file-upload-MS.json`).

- No argument → list the open phases from `docs/*/*-MS.json` with their status and ask which one to build, rather than picking one.
- A `-REFACTOR-MS.json` map file, or one carrying `"track": "refactor"` → the refactor track. Its phases are addressed `R<N>`. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `build-phase` section opens the phase with a green baseline instead of a failing test, and closes it on parity evidence.
- Several MS files and no path given → ask which feature, since phase numbers repeat across features.
- Titles match case-insensitively on substring; more than one candidate → show them and ask.
- The named phase is already `"in-review"` → this run is a **settle run**: skip to step 9 and finish it off.
- The named phase is `"completed"`, or its milestone is already closed → say so and offer the next phase whose status is `pending`.

## Steps

### 1. Load the phase

Read, before any code:

1. `docs/<slug>/<slug>-MS.json` — this phase's block: `status`, milestone number and URL, and its issues with numbers, titles and labels. That is the task → issue map every later step closes work against, and its `sources` block names every other file this run reads.
2. The final plan named in `sources.final` — this phase's block whole: **Goal**, **Touches**, **Covers**, **Decisions**, **Threats**, **Tasks**, **Done when** — plus its **Rulings** table, since a ruling is why a limit or a control reads the way it does.
3. `sources.research` — the `D-<n>` blocks this phase's tasks cite, plus Parameters and Dependencies. Limits, package versions, env var names and error codes are copied **verbatim**, and FINAL is where the copy already sits.
4. `sources.threats` — each `S-<n>` this phase carries, with the control that closes it and the proof it needs.
5. `sources.prd` — the goal and Out of scope.
6. Root `CLAUDE.md` plus the `CLAUDE.md` of each app the phase touches.
7. `.claude/modules/INDEX.md`, then the docs of only the modules this phase touches or that already solve a close problem — extending one beats creating a duplicate.

No `sources.final` in the MS file, or a task that hides a technical choice (library, storage format, limits) → say so and offer `/pre-issues` or `/research` first, rather than picking a library on the spot.

Done when you can name, for every issue in the phase, the FINAL task it implements and the decisions and findings that constrain it, or that there are none.

### 2. Settle what came before

From the MS file, for every earlier phase not yet `completed`:

```bash
gh pr view <the phase's pr url> --json state,mergedAt,mergeCommit
```

- **`in-review` and merged** → settle it now, per step 9, on this run's branch once step 4 cuts it. That is the normal path: a phase's completion record rides the next phase's PR.
- **`in-review` and open** → show it and ask which base to take: the base branch anyway, or `feature/<slug>-phase-<N-1>` so this phase can see that code. Running a phase out of turn silently is not an option.
- **`in-progress`** → an earlier run stopped mid-phase. Show its branch and ask whether to finish it first.

Done when you can state the branch this phase starts from, why, and which earlier phase this run will settle.

### 3. Prepare the tree

- `git status` — the tree must be clean. Uncommitted changes → show them and ask what to do with them; nothing is reset or stashed on your own initiative.
- Base branch by git flow: `develop` when it exists, otherwise `main`. Bring it current: `git checkout <base> && git pull --ff-only`.
- Infrastructure the phase's tasks need: `npm install` when the lock file moved, `npm run db:up` and `npm run prisma:migrate:dev` when the phase touches the database or its tests need Postgres.

Done when the tree is clean, the starting branch from step 2 is current, and the commands this phase's tests run under actually work.

### 4. Branch the phase and claim it

```bash
git checkout -b feature/meeting-file-upload-phase-2 <starting branch from step 2>
```

- The name is `feature/<slug>-phase-<N>`, and the slug comes from the PRD/PLAN/MS filenames — inventing a new one scatters a feature's branches.
- The branch already exists → switch to it and continue the phase; commits on it you cannot account for → show `git log` and ask.
- Every commit of this run lands here. `main` and `develop` receive none.

Then claim the phase in the MS file before writing any code — `"status": "in-progress"`, `"branch"`, and `progress.currentPhase` — and commit it as `docs: start phase <N>`. A run that dies after this leaves the next one able to see exactly where it stopped.

Done when `git branch --show-current` prints the phase branch and the MS file says this phase is in progress on it.

### 5. Work the tasks in plan order

Plan order encodes the dependencies: tests before implementation, model before routes, backend before frontend. On the refactor track, the track file's `build-phase` section sets this step's rhythm instead — green baseline first, then code that keeps the suite as it is. Per task:

1. Match it against its research decision, the findings it has to close, and the app's conventions.
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
npm run docs:lint      # when this run settled an earlier phase or touched a doc under docs/
```

Then walk the phase's **Done when** from FINAL point by point, each backed by a fact — a test name, command output, a response you actually saw — not by reasoning. A refactor phase adds its parity evidence here: the baseline output and this run's output, side by side, plus the after-number for the phase's outcome.

**Red does not get pushed.** Fix the cause; a stubborn failure goes to the user with its output instead of a silenced test.

A phase carrying an `S-<n>` finding, or touching user input, other users' data, files or authorization, gets a review before the push: `/security-review` for the security pass, `requesting-code-review` otherwise. Each `S-<n>` this phase carries is checked against its control, with the test that proves it.

Done when every command above is green, every clause of **Done when** has its evidence, and every finding this phase carries has its control in place.

### 8. Push and open the PR

```bash
git push -u origin feature/<slug>-phase-<N>
gh pr create --base <base> --head feature/<slug>-phase-<N> \
  --title "<KEY> <N>. <phase title>" --milestone "<the phase's milestone title from the MS file>" --body "<body>"
```

PR body: the phase **Goal**, one line per task with its issue number and commit, the **Done when** evidence from step 7, a link to the RESEARCH and THREATS files, and one `Closes #<issue number>` line per implemented issue — the merge is what closes them, so an unmerged PR never leaves a closed issue behind.

Then record the review state and commit it on this branch, so the PR carries it: MS phase `"status": "in-review"` with its `"pr"` block, and FINAL's tasks for this phase ticked `- [x]` with `**Status**: in review — PR <url>` on the block. Commit as `docs: phase <N> in review`, push, and the open PR updates.

Merging is the user's. This run opens the PR and stops there.

Done when the PR exists on the phase's milestone, its `Closes` lines cover every implemented issue, and the MS file says the phase is in review.

### 9. Settle a merged phase

For this run's phase once its PR is merged, and for the earlier phase step 2 found merged. **A phase is settled only against a merged PR** — `gh pr view <url> --json state,mergedAt` is what says so.

1. The merge closed the issues through the PR's `Closes` lines. Any that stayed open — a task settled outside the PR — closes here with its reason:

   ```bash
   gh issue close <number> --comment "Done in feature/<slug>-phase-<N>, commit <sha>, PR <url>."
   ```

2. The milestone closes **only once all its issues are closed** (`gh` has no `milestone` subcommand — go through the API):

   ```bash
   gh api repos/{owner}/{repo}/milestones/<number> -X PATCH -f state=closed
   ```

3. `docs/<slug>/<slug>-MS.json`, dates from `date +%F`: each closed issue `"state": "CLOSED"` plus `closedAt`; the milestone `"state": "closed"` plus `completedAt`; the phase `"status": "completed"` with its `pr.state` now `merged`; and `progress` — `updatedAt`, `completedPhases`, `currentPhase`, and `nextPhase` pointing at the first phase still `pending` (`null` once none are).
4. FINAL's phase block: `**Status**: complete — <date>, branch feature/<slug>-phase-<N>, PR <url>`, replacing the in-review line. Other phases stay untouched.
5. `docs/Features.md` — the shipped-work log described below, created from its template when it does not exist yet. One row per settled phase under `## In progress`, oldest first. The refactor track logs to `docs/Refactor.md`.

Those file changes ride the branch this run already owns, in one commit — `docs: settle phase <N>`. A settle run holding no branch of its own cuts `chore/<slug>-phase-<N>-done` from the current base and opens a small PR for it.

**The PR is still open** → nothing is closed and nothing is settled. The run ends with the phase `in-review`, and the report names the command that finishes it: `/build-phase <N>` again, once the PR is merged.

Done when every settled phase's issues and milestone are closed, its files say `completed`, and any phase still in review is named as such with its PR.

### 10. Hand off close-out, when the last phase has settled

Every phase `completed` and no open milestone left for this feature → the report names `/bldprj:close-feature <slug>` as the next command. This run does not start it: close-out reads the MS file from the freshly pulled base branch, so it waits for this run's settle commit to merge first. Otherwise skip this step.

Done when the report names either the close-out command or the next open phase.

### 11. Report

Facts, briefly:

- branch, its base, and the commits;
- task → issue → commit for what was implemented;
- test and check results as they came out, including anything skipped and why;
- the phase's **Done when**, clause by clause, with the evidence;
- the PR URL and its state — merged and settled, or open and awaiting the merge;
- what closed on GitHub and what stayed open;
- the next command — `/build-phase <N+1>` when this phase settled, `/build-phase <N>` when it is waiting on the merge;
- open questions and anything left out of scope.

## Commit format

One commit per task, so each commit maps to one issue and stays revertable:

```
<type>(<scope>): <what was done>

Refs #<issue number>
```

- `type` and `scope` follow the repo's history (`feat(api)`, `test(web)`, `docs`, `build`).
- Two tasks share a commit only when they physically cannot be split — a Red→Green step where test and code land together — and then `Refs` lists both issues.
- `Refs` on task commits, `Closes` in the PR body: the issue closes when the code lands on the base branch, not when a commit is written.
- The Husky pre-commit hook runs lint and `test:api`. A commit it rejects means fixing the cause; the hook stays in the loop (`--no-verify` is off the table).

## Shipped-work log

`docs/Features.md` and `docs/Refactor.md` are this repo's changelog for humans: a phase row lands once its PR is merged, and close-out collapses a finished feature's rows into one **Shipped** line. Descriptions are one line each — in the user's terms for a feature, in numbers for a refactor.

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

- One phase per run. Other phases' tasks are not implemented, and the only other phase this run touches is one it settles after a merge.
- Research decisions and the rulings in FINAL are not reopened during implementation; a discrepancy is a question, not a silent replay.
- Nothing outside the PRD's scope. A worthwhile improvement spotted in passing becomes its own task, not a commit in this branch.
- Work happens on `feature/<slug>-phase-<N>` cut from `develop`/`main` (or from the previous phase's branch, per step 2). The base branch receives no commits.
- The branch slug matches the slug of the PRD/PLAN/MS files.
- Tests run after every task and in full before the push; red never gets pushed.
- Tests are not rewritten or weakened to reach green; any test rewrite is agreed with the user first.
- Done means merged: issues, milestones and the log row wait for the PR to land on the base branch.
- Docs — module docs, JSDoc, Swagger, `CLAUDE.md`, `README.md`, `.env.example` — land in the same phase as the code.
- Report honestly: failing tests and skipped steps are named outright, with the command output.
