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

A contradiction that survives — FINAL against the research it cites, or against the PRD — is a question for the user and a `/bldprj:pre-issues` re-run, never a silent pick.

## Argument

A phase number or milestone title (`/bldprj:build-phase 2`, `/bldprj:build-phase R1`, `/bldprj:build-phase "Phase 2. Upload and list meeting files"`), optionally followed by the MS file path (`/bldprj:build-phase 2 docs/meeting-file-upload/meeting-file-upload-MS.json`).

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
2. The final plan named in `sources.final` — this phase's block whole: **Goal**, **Touches**, **Covers**, **Decisions**, **Threats**, **Verified by**, **Tasks**, **Done when** — plus its **Rulings** table, since a ruling is why a limit or a control reads the way it does. **Verified by** is how this phase's code gets written, not a note about it: step 5 works to it.
3. `sources.research` — the `D-<n>` blocks this phase's tasks cite, plus Parameters and Dependencies. Limits, package versions, env var names and error codes are copied **verbatim**, and FINAL is where the copy already sits.
4. `sources.threats` — each `S-<n>` this phase carries, with the control that closes it and the proof it needs.
5. `sources.prd` — the goal and Out of scope.
6. The project's root docs plus the docs of each part the phase touches.
7. The project's module-docs index, where it keeps one, then the docs of only the modules this phase touches or that already solve a close problem — extending one beats creating a duplicate.

No `sources.final` in the MS file, or a task that hides a technical choice (library, storage format, limits) → say so and offer `/bldprj:pre-issues` or `/bldprj:research` first, rather than picking a library on the spot.

Done when you can name, for every issue in the phase, the FINAL task it implements and the decisions and findings that constrain it, or that there are none.

### 2. Settle what came before

From the MS file, for every earlier phase not yet `completed`:

```bash
gh pr view <the phase's pr url> --json state,mergedAt,mergeCommit
```

- **`in-review` and merged** → settle it now, per step 9, on this run's branch once step 4 cuts it. That is the normal path: a phase's completion record rides the next phase's PR.

  It also means that record only lands if **this** PR lands. A phase whose PR is closed unmerged takes the settle commit of the phase before it with the branch, leaving that phase `in-review` in the MS file with its issues and milestone still open. Nothing is lost: `/bldprj:build-phase <N-1>` sees the status and runs as a settle run, cutting `chore/<slug>-phase-<N-1>-done` for it. Say so in the report whenever this run is carrying somebody else's settle commit, so the recovery is known before it is needed.

- **`in-review` and open** → show it and ask which base to take: the base branch anyway, or `feature/<slug>-phase-<N-1>` so this phase can see that code. Running a phase out of turn silently is not an option.
- **`in-progress`** → an earlier run stopped mid-phase. Show its branch and ask whether to finish it first.
- **`pending`** — there is no PR to check — → an earlier phase nobody has built. Building out of turn is the user's call: show the phase order and ask whether to build that phase first.

Done when you can state the branch this phase starts from, why, and which earlier phase this run will settle.

### 3. Prepare the tree

- `git status` — the tree must be clean. Uncommitted changes → show them and ask what to do with them; nothing is reset or stashed on your own initiative.
- Base branch by git flow: `develop` when it exists, otherwise `main`. Bring it current: `git checkout <base> && git pull --ff-only`.
- Infrastructure the phase's tasks need, as the project README names it: dependency install when the lock file moved (e.g. `npm install`), local services and migrations when the phase touches the database or its tests need one (e.g. `npm run db:up`, the migrate script).

Done when the tree is clean, the starting branch from step 2 is current, and the commands this phase's tests run under actually work.

### 4. Branch the phase and claim it

```bash
git checkout -b feature/meeting-file-upload-phase-2 <starting branch from step 2>
```

- The name is `feature/<slug>-phase-<N>` — `refactor/<slug>-phase-<N>` on the refactor track, per the MS file's `"track"` field — and the slug comes from the PRD/PLAN/MS filenames; inventing a new one scatters a feature's branches.
- The branch already exists → switch to it and continue the phase; commits on it you cannot account for → show `git log` and ask.
- Every commit of this run lands here. `main` and `develop` receive none.

Then claim the phase in the MS file before writing any code — `"status": "in-progress"`, `"branch"`, and `progress.currentPhase` — and commit it as `docs: start phase <N>`. A run that dies after this leaves the next one able to see exactly where it stopped.

Done when `git branch --show-current` prints the phase branch and the MS file says this phase is in progress on it.

### 5. Work the tasks in plan order

Plan order encodes the dependencies: tests before implementation, model before routes, backend before frontend. On the refactor track, the track file's `build-phase` section sets this step's rhythm instead — green baseline first, then code that keeps the suite as it is. Per task:

1. Match it against its research decision, the findings it has to close, and the app's conventions.
2. Write it in the surrounding code's style and in the workflow the phase's **Verified by** names — that line is the project's own rule, already read out of its docs and hardened, so it is followed as written rather than re-derived here. Where it names a test-first cycle, the specs go in first and are **seen red** before a line of implementation exists; where it names an e2e spec over a user scenario, that spec is what the task is finished against. Tests keep their teeth: rewriting or weakening one to reach green is agreed with the user first.
3. Honour the repo's standing conventions as its docs state them (e.g. doc comments on every function, API annotations on new routes and DTOs), and no secrets, storage paths or other users' data in responses or markup.
4. Run that task's tests immediately — the touched layer's own suite, as the project scripts name it — rather than saving them for the end of the phase.
5. Commit the task on its own, in the format below, and tick it off only once those tests are green.

**A red state that was never committed cannot be shown to have happened.** On a test-first layer the specs land in their own `test(...)` commit, failing, before the `feat(...)` commit that makes them pass — one task, two commits, the second naming the first. Keep the failing output: step 7's evidence and the PR body both quote it, and it is the only proof the cycle ran in the order the project mandates. A phase whose specs and implementation arrive together leaves nobody able to tell test-first from test-after, which is the same as not having the rule.

A task that cannot be done as written, or that contradicts the research → stop and ask, rather than substituting your own reading of it. **Verified by** contradicting the project's current docs is the same kind of stop: it goes to the user and back to `/bldprj:pre-issues`, never quietly replaced with what the docs say today.

Anything beyond the phase's tasks stays out of this branch: drive-by refactors, "while I'm here" fixes to neighbouring modules, and improvements the PRD put out of scope.

Done when every issue in the phase has its code and green tests, or is named explicitly as not done and why.

### 6. Move the docs with the code

Part of the phase, not a follow-up — the project's own doc rules require it:

- The project's module docs, where it keeps them: a new module gets its doc plus its index line; a changed module gets only the functions and gotchas that actually changed.
- The pointer lines the project's doc conventions require — only for a new module or a changed one-line purpose.
- `README.md`, the root docs, env samples — when scripts, env vars, infrastructure or architecture moved.

Done when a teammate reading only the docs would find every function, endpoint and env var this phase added.

### 7. Prove the phase green

Run the project's full check set, as its docs name it, and show the user the actual output — for an npm monorepo that reads like:

```bash
npm run lint
npm run format:check
npm run test           # every suite the phase's layers own
npm run build          # when configs, dependencies or a public API moved
```

plus the pipeline's docs linter (**Writing a document** in `PIPELINE.md`) when this run settled an earlier phase or touched a doc under `docs/`.

Then walk the phase's **Done when** from FINAL point by point, each backed by a fact — a test name, command output, a response you actually saw — not by reasoning. A refactor phase adds its parity evidence here: the baseline output and this run's output, side by side, plus the after-number for the phase's outcome.

**Verified by** is evidenced the same way: on a test-first layer, `git log --oneline` for this branch showing each task's `test(...)` commit ahead of its `feat(...)` one, with the red output the first was committed at. A phase that cannot show it says so outright here rather than in the PR body.

**Red does not get pushed as the branch's tip.** A `test(...)` commit inside the history is meant to be red — that is the record step 5 exists to leave — but the commit the PR is opened on is green. Fix the cause; a stubborn failure goes to the user with its output instead of a silenced test.

A phase carrying an `S-<n>` finding, or touching user input, other users' data, files or authorization, gets a review before the push: the security pass (e.g. `/security-review`), or the project's code-review habit otherwise. Each `S-<n>` this phase carries is checked against its control, with the test that proves it.

Done when every command above is green, every clause of **Done when** has its evidence, and every finding this phase carries has its control in place.

### 8. Push and open the PR

```bash
git push -u origin feature/<slug>-phase-<N>
gh pr create --base <base> --head feature/<slug>-phase-<N> \
  --title "<KEY> <N>. <phase title>" --milestone "<the phase's milestone title from the MS file>" --body "<body>"
```

PR body: the phase **Goal**, one line per task with its issue number and its commits, the **Done when** evidence from step 7, the phase's **Verified by** with the evidence that it was followed, a link to the RESEARCH and THREATS files, and one `Closes #<issue number>` line per implemented issue — the merge is what closes them, so an unmerged PR never leaves a closed issue behind.

Then record the review state and commit it on this branch, so the PR carries it: MS phase `"status": "in-review"` with its `"pr"` block, and FINAL's tasks for this phase ticked `- [x]` with `**Status**: in review — PR <url>` on the block. Commit as `docs: phase <N> in review`, push, and the open PR updates.

Merging is the user's. This run opens the PR and stops there.

Done when the PR exists on the phase's milestone, its `Closes` lines cover every implemented issue, and the MS file says the phase is in review.

### 9. Settle a merged phase

For this run's phase once its PR is merged, and for the earlier phase step 2 found merged. **A phase is settled only against a merged PR** — `gh pr view <url> --json state,mergedAt` is what says so.

1. The merge closed the issues through the PR's `Closes` lines. Any that stayed open — a task settled outside the PR — closes here with its reason:

   ```bash
   gh issue close <number> --comment "Done in <the phase branch>, commit <sha>, PR <url>."
   ```

2. The milestone closes **only once all its issues are closed** (`gh` has no `milestone` subcommand — go through the API):

   ```bash
   gh api repos/{owner}/{repo}/milestones/<number> -X PATCH -f state=closed
   ```

3. `docs/<slug>/<slug>-MS.json`, dates from `date +%F`: each closed issue `"state": "CLOSED"` plus `closedAt`; the milestone `"state": "closed"` plus `completedAt`; the phase `"status": "completed"` with its `pr.state` now `merged`; and `progress` — `updatedAt`, `completedPhases`, `currentPhase`, and `nextPhase` pointing at the first phase still `pending` (`null` once none are).
4. FINAL's phase block: `**Status**: complete — <date>, branch feature/<slug>-phase-<N>, PR <url>`, replacing the in-review line. Other phases stay untouched.
5. `docs/Features.md` — the shipped-work log described below, created from its template when it does not exist yet. One row per settled phase under `## In progress`, oldest first. The refactor track logs to `docs/Refactor.md`.

Those file changes ride the branch this run already owns, in one commit — `docs: settle phase <N>`. A settle run holding no branch of its own cuts `chore/<slug>-phase-<N>-done` from the current base and opens a small PR for it.

**The PR is still open** → nothing is closed and nothing is settled. The run ends with the phase `in-review`, and the report names the command that finishes it: `/bldprj:build-phase <N>` again, once the PR is merged.

Done when every settled phase's issues and milestone are closed, its files say `completed`, and any phase still in review is named as such with its PR.

### 10. Hand off close-out, when the last phase has settled

Every phase `completed` and no open milestone left for this feature → the report names `/bldprj:close-feature <slug>` as the next command. This run does not start it: close-out reads the MS file from the freshly pulled base branch, so it waits for this run's settle commit to merge first. Otherwise skip this step.

Done when the report names either the close-out command or the next open phase.

### 11. Report

Facts, briefly:

- branch, its base, and the commits;
- task → issue → commits for what was implemented;
- test and check results as they came out, including anything skipped and why;
- the phase's **Verified by** and how this run followed it — for a test-first layer, the red commit ahead of the green one, per task;
- the phase's **Done when**, clause by clause, with the evidence;
- the PR URL and its state — merged and settled, or open and awaiting the merge;
- what closed on GitHub and what stayed open;
- the earlier phase this run settled, if any, and that its record rides this PR — with `/bldprj:build-phase <N-1>` as the way back should this PR never merge;
- the next command — `/bldprj:build-phase <N+1>` when this phase settled, `/bldprj:build-phase <N>` when it is waiting on the merge;
- open questions and anything left out of scope.

## Commit format

One commit per task — never fewer — so each commit maps to one issue, stays revertable, and can be read back as the order the work actually happened in:

```
<type>(<scope>): <what was done>

Refs #<issue number>
```

- `type` and `scope` follow the repo's history (`feat(api)`, `test(web)`, `docs`, `build`).
- **A commit never carries two tasks.** One `Refs`, one issue, one task — a commit whose subject names a range (`tasks 2.1-2.5`) is the phase arriving as a single blob, and with it goes every signal about the order its parts were written in. A task too large to commit on its own was mis-cut: say so and ask, rather than merging it into its neighbour.
- **A task may need two commits, and on a test-first layer it does**: `test(<scope>)` with the failing specs, then `feat(<scope>)` making them pass, both carrying the same `Refs`. That pair is what makes Red→Green legible in `git log` months later.
- `Refs` on task commits, `Closes` in the PR body: the issue closes when the code lands on the base branch, not when a commit is written.
- The project's pre-commit hook, when it has one, runs its checks. A commit it rejects means fixing the cause; the hook stays in the loop (`--no-verify` is off the table). A hook that refuses the red `test(...)` commit is a real conflict between two project rules — take it to the user, and never reach for `--no-verify` to settle it.

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
- Work happens on `feature/<slug>-phase-<N>` (`refactor/<slug>-phase-<N>` on the refactor track) cut from `develop`/`main` (or from the previous phase's branch, per step 2). The base branch receives no commits.
- The branch slug matches the slug of the PRD/PLAN/MS files.
- The phase's **Verified by** is the workflow this run writes code in, followed as FINAL states it; a conflict with the project's docs is a stop, not a substitution.
- One commit per task at least, and never one commit for two tasks — a test-first task lands as a red `test(...)` commit and the `feat(...)` commit that greens it.
- Tests run after every task and in full before the push; the branch tip is green, whatever red the history records on the way there.
- Tests are not rewritten or weakened to reach green; any test rewrite is agreed with the user first.
- Done means merged: issues, milestones and the log row wait for the PR to land on the base branch.
- Docs — module docs, JSDoc, Swagger, `CLAUDE.md`, `README.md`, `.env.example` — land in the same phase as the code.
- Report honestly: failing tests and skipped steps are named outright, with the command output.
