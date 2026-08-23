---
name: close-feature
description: "Closes out a shipped feature or refactor once every phase has settled on the base branch — proves the acceptance criteria against the shipped code, marks the PRD done, archives docs/<slug>/ to docs/archive/, collapses the log rows and deletes merged phase branches, through a close-out PR. Use when the last phase's settle commit has merged, or when build-phase's report names this as the next command."
---

# Close feature

Fires once per track, after the last phase settles: the acceptance criteria are proven against the shipped code, the docs move to the archive, the PRD is marked done, and the branches that landed are cleaned up.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → **`close-feature`**.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, path resolution and the question protocol are defined there and are not repeated here.

Close-out changes are commits like any other — they go on `chore/<slug>-closeout` cut from the base branch, never straight into `develop`/`main`.

On the refactor track the names shift as [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) sets them: `<slug>-REFACTOR-PRD.md` and `<slug>-REFACTOR-MS.json`, `refactor/<slug>-phase-<N>` branches, and `docs/Refactor.md` as the log.

## Argument

A slug or an MS file path (`/bldprj:close-feature meeting-file-upload`).

- No argument → list the MS files under `docs/*/*-MS.json` whose phases are all `completed`, and ask which one to close rather than picking one.
- A slug whose folder holds both tracks' MS files → ask which track this run closes.

## Steps

### 1. Start from the merged truth

Close-out reads only what has landed. First `git checkout <base> && git pull --ff-only` (base branch per git flow: `develop` when it exists, otherwise `main`); every file this run reads — the MS file above all — is read from that freshly pulled base, not from a working branch that may hold unmerged settle commits.

Then confirm the work is actually done:

```bash
gh api repos/{owner}/{repo}/milestones --paginate --jq '.[] | select(.state=="open") | "\(.number) \(.title)"'
```

An open milestone belonging to this work, an open issue under a closed one, or a phase whose MS `status` **on base** is not `completed`, means it is not done: report it and stop rather than archiving live work — naming the settle PR still open when that is what the base branch is missing. A phase left `in-review` is settled first: `/bldprj:build-phase <N>`, once its PR is merged.

Done when the base branch is current and every phase of this track is `completed` on it, with no open milestone or issue.

### 2. Prove the acceptance criteria

The phases proved their own **Done when**; nobody has yet held the shipped work against what the PRD promised. Walk `AC-1`, `AC-2`, … in order — FINAL's **Trace** table names what was meant to prove each one — and give each one **evidence**: the test that asserts it by name, the command and its output, or the observation in the running app. Reasoning is not evidence.

Each criterion that holds gets its box ticked in the PRD, `- [ ]` → `- [x]`. A criterion a `T-<n>` amended is proven against its amended wording, and one a ruling retired carries that ruling instead of evidence. A criterion nothing can prove is a stop: show it with what the code actually does, and ask — it is either a phase that never shipped or a promise the PRD should retire.

On the refactor track the same pass runs over the criteria that front the **Behaviour freeze** and the **Internal outcomes**: the baseline commands with today's output beside the PRD's, and the after-number for every outcome, measured the way the before-number was.

**Delegate** — `test-designer`, mode `evidence`, one call for all criteria (**Delegating a step** in [`PIPELINE.md`](../../PIPELINE.md)):

- **Hand it**: every criterion in its current wording, FINAL's **Trace** table, and the project's own commands for running each suite.
- **Expect back**: one row per criterion — the command, its literal output, and `proven` or `unprovable`, with what the code actually does wherever it cannot be proven. An `unprovable` row is the useful one: it is what step 2 stops on.

Done when every criterion is ticked with its evidence named, or the run stopped on the one that could not be.

### 3. Mark the PRD shipped

In `docs/<slug>/<slug>-PRD.md`: `**Status**: draft` → `**Status**: done`, and add `**Completed**: <date>` from `date +%F` beside it.

Done when the PRD states the work shipped and when.

### 4. Audit the docs the work left behind

Against the project's own documentation rules, for the modules this work created or changed:

- Every new module has its doc and its line in the project's module-docs index, where the project keeps module docs.
- Every changed module's doc matches the code that now exists — function list, behaviour, gotchas.
- The project's top-level docs (`CLAUDE.md`, `README.md`, env samples) reflect any scripts, env vars or infrastructure this work added, and its status or architecture record gains a sentence for what now exists, where the project keeps one.

A gap here is fixed in this branch — the work does not get archived over stale docs.

**Delegate** — `docs-writer`, and `code-reviewer` mode `tree` over the modules this work created or changed (**Delegating a step** in [`PIPELINE.md`](../../PIPELINE.md)):

- **Hand it**: those modules, the documents that claim to describe them, and the project's own documentation rules.
- **Expect back**: the doc-mismatch table — what a document claims, what the code does, which of the two is wrong — and the exact lines that close each gap. The fix lands on this branch, written here.

Done when each item above is checked against the file, not from memory.

### 5. Archive the documents

The other track first: `docs/<slug>/` holds both tracks, and the archive moves the folder whole. The other track still has live work — an MS file with phases not `completed`, or a PRD whose `**Status**` is not `done` — → skip the move and the index relink, name what is still live in the report, and leave the archive to that track's own close-out. Everything else in this run still happens.

Otherwise:

```bash
mkdir -p docs/archive
git mv docs/<slug> docs/archive/<slug>
```

The PRD, PLAN, RESEARCH, THREATS, FINAL and MS files link each other relatively (`./<slug>-PRD.md`), so those survive the move. What does not, and gets updated:

- `docs/INDEX.md` — this work's row: every document link gains the `archive/` segment, pointing at `docs/archive/<slug>/...`.
- `docs/archive/<slug>/<slug>-MS.json` — every path under `sources` gains the `archive/` segment.
- Any other reference to `docs/<slug>/`: `grep -rn "docs/<slug>/" --exclude-dir=node_modules --exclude-dir=.git .`

Done when that grep returns nothing outside the archive itself, and the postflight linter (**Writing a document** in `PIPELINE.md`) passes on the moved files.

### 6. Collapse the log rows

In `docs/Features.md` (`docs/Refactor.md` on the refactor track): delete this work's `### <slug>` block from **In progress** and add one row at the top of **Shipped** — the completion date from `date +%F`, the slug, one line on what it now lets a person do, and a link to the archived PRD (`archive/<slug>/<slug>-PRD.md`, the path from step 5).

A refactor's row carries the same fields plus its outcome as a number — `p95 620 ms → 180 ms` — taken from the phase rows being collapsed, not re-estimated.

Done when the work has exactly one row in the log, under **Shipped**, and its link resolves to the archived PRD.

### 7. Delete the branches that landed

Merged branches only — an unmerged branch may be the only copy of a phase's work. The prefix is the track's: `feature/` here, `refactor/` on the refactor track.

```bash
git branch --merged <base> | grep "feature/<slug>-phase-"
git branch -d feature/<slug>-phase-<N>
git push origin --delete feature/<slug>-phase-<N>
```

Unmerged phase branches stay exactly where they are and go into the report by name, each with why it never landed (PR still open, PR closed unmerged).

Done when every merged phase branch of this work is gone locally and on `origin`, and every surviving one is accounted for.

### 8. Commit and open the close-out PR

```bash
git add -A && git commit -m "docs: archive <slug> and mark the PRD done"
git push -u origin chore/<slug>-closeout
gh pr create --base <base> --title "Close out <slug>" --body "<the acceptance-criteria evidence, what was archived, which branches were deleted, which survived>"
```

Done when the PR exists and its URL is in the report.

### 9. Report

- every acceptance criterion with the evidence that proved it, and any that stopped the run;
- PRD status and completion date;
- the archive path and the log row that replaced the phase rows — or the live other-track work that deferred the move;
- branches deleted, and branches kept with the reason;
- doc gaps found in step 4 and how they were closed;
- the close-out PR URL.
