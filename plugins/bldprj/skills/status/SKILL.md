---
name: status
description: 'Reads where every feature and refactor in docs/ has got to — the stage it reached, the state of each phase, what is still open, and the one command that moves it on — without writing anything or calling out to GitHub. Use when picking up work after a break, when it is unclear which pipeline command comes next, or when several work items are in flight and one of them has stalled.'
---

# Status

Nine skills each report where they left off, and those reports scroll away. This one answers the question that survives them: **what is in flight, and what is the next command for each.**

It is not a stage — nothing consumes what it writes, because it writes nothing. It reads `docs/`, prints a picture, and stops. Safe to run at any point, including halfway through a phase.

Position in the pipeline: none. The chain is `prd` / `refactor-prd` → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature`, and this skill reports on it from outside.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — the artifact names, the identifiers and the path-resolution rules are defined there and are not repeated here.

## Argument

None, a slug, or a path (`/bldprj:status`, `/bldprj:status meeting-file-upload`).

- No argument → every work item under `docs/`, active ones first, `docs/archive/` collapsed to one line.
- A slug or a path inside `docs/<slug>/` → that work item alone, in full.
- A slug whose folder holds both tracks → both, one block each: the `-REFACTOR-` infix is what tells them apart.

## Steps

### 1. Find the work

`docs/*/` for the live items and `docs/archive/*/` for the closed ones. Per folder, both tracks: the feature-track files and their `-REFACTOR-` counterparts are two independent work items sharing a folder and a Key.

Done when every folder is accounted for as one or two work items, and you know which are archived.

### 2. Read where each one stopped

Files only. **Nothing here calls `gh`, `git` or the network**, and nothing is written — a stale MS file is reported as what it says, not corrected.

Per work item, cheapest first, and stop reading once the picture is complete:

1. **The PRD** — its `**Key**`, `**Status**` (`draft` / `done`), `**Completed**` where it exists, and its acceptance criteria with their boxes: `- [x]` proven at close-out, `- [~]` retired by a ruling.
2. **`-MS.json` when it exists** — the backlog is published, so this file is the truth about progress: `sources` for the documents behind it, each phase's `status`, its milestone, its issues, and `progress.nextPhase`. `sources.final` is the document its phases came from.
3. **No `-MS.json`** — the stage is whichever artifact exists last along the chain: FINAL → threats → research → plan → PRD. The **current** FINAL is the highest-numbered version present (**Resolving paths** in `PIPELINE.md`).
4. **The current plan or FINAL** — the phase count, and its `## Revisions` where one exists.
5. **`## Revisions` in the research and threats files** — how many revision rounds have run, and whether the last one converged (**Re-running a stage** in `PIPELINE.md`).

Done when every work item has a stage, and every one with a backlog has a per-phase status.

### 3. Name what is blocking each one

The signals worth surfacing, read off the files already in hand — a work item with none of them is simply mid-chain, and says so:

- a phase `in-review`: its PR has to merge before anything settles, and the record of the phase before it may be riding that PR (`build-phase` step 2);
- a phase `in-progress`: an earlier run stopped mid-phase, and its branch holds the work;
- an MS file whose `sources.final` is not the current FINAL: the backlog was published from a superseded document;
- a plan with `## Revisions` but no FINAL beside it, or a FINAL older than the plan's last revision;
- a PRD still `draft` with every phase `completed`: close-out has not run;
- a research or threats file whose last round did not converge.

Done when each work item carries either its blocker or "nothing blocking".

### 4. Report

A table first, one row per work item, then one block per active item. Nothing else — no recommendations beyond the next command, and no work.

```markdown
| Key | Work                | Track    | Stage    | Phases                | Next                                               |
| --- | ------------------- | -------- | -------- | --------------------- | -------------------------------------------------- |
| MFU | meeting-file-upload | feature  | build    | 2/5 done, 3 in review | `/bldprj:build-phase 3` once PR #48 merges         |
| MFU | meeting-file-upload | refactor | research | not cut yet           | `/bldprj:security-analyse docs/…-REFACTOR-PLAN.md` |
```

Per active item, underneath: its documents with the stage each represents, the phases one line each (number, title, status, PR where there is one), the acceptance criteria as a count (`7 of 9 proven`) rather than in full, the revision rounds where any ran, and the blocker from step 3 with the command that clears it.

Archived work is one line: key, slug, the date its PRD says it completed.

Close with the single next command for the item the user asked about — or, with no argument, for the one furthest along, since that is the one whose finishing unblocks the rest.

## Rules

- **Read-only.** No file is created or edited, `docs/INDEX.md` included, and the docs linter is not run — the postflight in `PIPELINE.md` belongs to skills that write.
- **No network.** GitHub state comes from the MS file, and it is reported as what that file claims. A phase the MS file calls `in-review` is reported as in review even if its PR merged an hour ago; `/bldprj:build-phase <N>` is what reconciles that, and naming it is this skill's whole contribution.
- **Facts, not diagnosis.** A missing artifact is named as missing. Whether that is a problem is the owning skill's to say.
- Every work item gets exactly one next command, and it is a real one from the chain.
- A `docs/` with no work items is reported as such, with `/bldprj:prd` as the way to open one.
