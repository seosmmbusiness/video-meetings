---
name: issues
description: 'Creates the GitHub backlog from a final plan — feature or refactor — one milestone per phase, one issue per numbered task, and records the task → issue map in docs/<slug>/<slug>-MS.json. Use when a plan has been consolidated by pre-issues and the work needs tracking on GitHub, or when another skill needs the MS file that build-phase consumes.'
---

# Issues

The final plan is the source; GitHub is the mirror. One milestone per phase, one issue per task, and an MS file that maps task → issue so `build-phase` can find its work later.

This skill invents nothing. Phase numbers, task numbers and labels all come from `docs/<slug>/<slug>-FINAL.md` — "the plan" below means that file — and the only thing it adds is the rendering: a title short enough to read in a list and prefixed so the reading order is obvious.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → `security-analyse` → `pre-issues` → **`issues`** → `build-phase`.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

## Argument

Path to a final plan (`/issues docs/meeting-file-upload/meeting-file-upload-FINAL.md`).

- No argument → list the final plans under `docs/*/*-FINAL*.md` and ask which one to publish, rather than picking one.
- Several versions of the same final plan → take the current one and name the file you took in step 3's confirmation.
- A `-PLAN.md` path, or no `-FINAL.md` beside it → say so and offer `/pre-issues` first: a preliminary plan is one whose contradictions with the PRD, the research and the threats nobody has ruled on yet, and publishing it is what the FINAL stage exists to avoid.
- A `-REFACTOR-FINAL.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `issues` section sets the key, milestone titles, labels, issue body and map file this run writes.
- An `-MS.json` already sits next to it → read it and treat this run as a **reconciliation**, per step 2.

## Steps

### 1. Read the final plan

The key from its header, then every phase block: number, title, **Goal**, **Touches**, **Covers**, **Decisions**, **Threats**, **Tasks** with their numbers, labels and descriptions, **Done when**. Note the `-PRD.md`, `-PLAN.md`, `-RESEARCH.md` and `-THREATS.md` paths from its header and the FINAL's own version — they go into the MS file's `sources`.

FINAL already carries each phase's `D-<n>` and `S-<n>`, so those lines are copied from it, not re-derived; a phase carrying an `S-<n>` takes the `security` label. Read the research **decision map** and the threats **threat map** only to check that FINAL agrees with them, and report a mismatch instead of publishing over it — the ids belong to `pre-issues` to reconcile.

A task marked `- [~]` is dropped: it gets no new issue, and step 2 decides what happens to the one it may already have.

Done when you hold the full list — every phase with its ordered, numbered tasks, its decisions and its findings — and the counts to expect on GitHub.

### 2. Check the ground before writing anything

```bash
gh auth status
gh repo view --json nameWithOwner
gh label list
gh api repos/{owner}/{repo}/milestones --paginate --jq '.[] | "\(.number) \(.title)"'
```

Then reconcile, **by number, never by wording** — the task key `MFU 1.2` is the identity, the label after it is free to change:

- Milestone for phase `N` → an existing milestone whose title starts with `<KEY> <N> ` (`gh api …/milestones`). Present → reuse it, and update its description when the phase's Goal or Done when moved.
- Issue for task `<N>.<n>` → an existing issue whose title starts with `<KEY> <N>.<n> ` (`gh issue list --search "<KEY> <N>.<n> in:title" --state all --json number,title,state,milestone`). Present with the same label → leave it. Present with a different label → the title gets edited, the body refreshed. Absent → it is created.
- An issue whose key no longer appears in the plan, or appears as `- [~]` → **report it and ask**. It may have shipped already. Nothing is closed or deleted on your own initiative.

Done when you can name, for every phase and every task, whether it exists on GitHub already, needs its title updated, or has to be created — and what to do with every orphan.

### 3. Confirm the write

Show the user what this run will create and change: repo, the FINAL file and version it came from, the new milestones and issues with their exact titles, the titles being edited, the orphans found, and the labels each issue will carry. Then ask for a go-ahead once, and write only after it.

Done when the user has approved the list, or has adjusted it and approved the adjusted one.

### 4. Create the milestones

One per phase, in plan order, titled `<KEY> <phase number> · <phase title>` (`gh` has no `milestone` subcommand — go through the API):

```bash
gh api repos/{owner}/{repo}/milestones -f title="MFU 1 · Storage service and upload endpoint" \
  -f description="<phase Goal>. Covers: AC-1, AC-3. Done when: <phase Done when>"
```

The key makes the title unique across the repo, so two features can both have a phase 1 and matching stays exact.

Done when every phase in the plan has exactly one milestone, and you have its number and URL.

### 5. Create the issues

One per task, in plan order, attached to its phase's milestone:

```bash
gh issue create --title "MFU 1.2 — Store uploads behind StorageService" \
  --milestone "MFU 1 · Storage service and upload endpoint" \
  --label backend --label test --body "<body below>"
```

**Title**: `<KEY> <phase>.<task> — <the task's label from the plan>`. The label is copied, not rewritten; if the plan's label is over 60 characters, that is a plan bug — say so rather than truncating it here.

**Body**:

```markdown
**Phase**: <number and title> · **Covers**: <AC-1, AC-3> · **Plan**: <path to the FINAL file, with its version>

<the task's description from the plan>

**Decisions**: <the phase's D-2, D-4> · [RESEARCH](path)
**Threats**: <the phase's S-1, with the control the task carries> · [THREATS](path)
**Phase done when**: <the phase's Done when>
```

**Labels**: four at most, taken only from what `gh label list` returned, in this priority order — `refactor` on the refactor track, then `backend` / `frontend` from the phase's **Touches**, then the driver (`security` for a phase carrying an `S-<n>` or a task about access control, validation or hardening, `performance`, `documentation` for a doc task), then `test` for a test-writing task. A label the plan needs and the repo lacks → ask before creating it.

Done when every live task in the plan has exactly one issue under the right milestone, with its number and URL captured.

### 6. Write the MS file

`docs/<slug>/<slug>-MS.json`, next to the plan, reusing the plan's slug. The shape below is what `build-phase` reads, so the field names are fixed. Dates come from `date +%F`.

`sources.final` records the **exact FINAL file** this backlog was published from, version and all — `build-phase` takes its phases and tasks from that field rather than looking for the newest document on disk — and `sources.plan` keeps the preliminary plan behind it, for history.

Done when every milestone and issue in this run appears in the file with its task number, and `progress.nextPhase` points at the first phase whose `status` is `pending`.

### 7. Report

Repo, milestone count and issue count, what was reused, what had its title updated, every orphan and what the user decided about it, any label question left open, the MS file path, and the next command: `/build-phase 1`.

## MS file

```json
{
  "feature": "meeting-file-upload",
  "key": "MFU",
  "track": "feature",
  "repo": "seosmmbusiness/video-meetings",
  "createdAt": "2026-07-31",
  "sources": {
    "prd": "docs/meeting-file-upload/meeting-file-upload-PRD.md",
    "plan": "docs/meeting-file-upload/meeting-file-upload-PLAN.md",
    "research": "docs/meeting-file-upload/meeting-file-upload-RESEARCH.md",
    "threats": "docs/meeting-file-upload/meeting-file-upload-THREATS.md",
    "final": "docs/meeting-file-upload/meeting-file-upload-FINAL.md",
    "finalVersion": 1
  },
  "phases": [
    {
      "phase": 1,
      "title": "Storage service and upload endpoint",
      "covers": ["AC-1", "AC-3"],
      "status": "pending",
      "milestone": {
        "number": 1,
        "title": "MFU 1 · Storage service and upload endpoint",
        "url": "https://github.com/seosmmbusiness/video-meetings/milestone/1",
        "state": "open"
      },
      "issues": [
        {
          "task": "1.1",
          "number": 12,
          "title": "MFU 1.1 — Write e2e tests for the upload endpoint",
          "url": "https://github.com/seosmmbusiness/video-meetings/issues/12",
          "labels": ["backend", "test"],
          "state": "OPEN"
        }
      ]
    }
  ],
  "progress": {
    "updatedAt": "2026-07-31",
    "completedPhases": [],
    "currentPhase": null,
    "nextPhase": {
      "phase": 1,
      "milestone": 1,
      "title": "MFU 1 · Storage service and upload endpoint",
      "url": "https://github.com/seosmmbusiness/video-meetings/milestone/1"
    }
  }
}
```

Vocabulary `build-phase` writes back into this file: phase `status` runs `pending` → `in-progress` (branch cut) → `in-review` (PR open and green) → `completed` (PR merged), issue `state` is `OPEN`/`CLOSED`, milestone `state` is `open`/`closed`, and a phase in review or later carries `"pr": { "number": 41, "url": "…", "state": "open" }`.

## Rules

- FINAL is the source: task numbers and labels come from it verbatim, and phases and tasks arrive on GitHub in its order. Work that is not in FINAL does not become an issue here.
- `<KEY> <phase>.<task>` is the identity of a task everywhere — issue title, MS file, commit trailer, log row. Matching, reuse and reconciliation all go through it, never through the wording after it.
- Every issue belongs to a milestone; a stray issue has no phase to be closed with.
- A re-run tops up and corrects the backlog; it never doubles it and never closes anything.
- A failed run stops at the failure and writes the MS file with everything created so far, so the next run picks up from there.
- Issues describe the task and point at the decisions and findings behind it; those live in the RESEARCH and THREATS files, not in issue bodies.
- Creating, editing and closing happens only on this feature's milestones and issues. Existing GitHub items outside this plan stay untouched.
