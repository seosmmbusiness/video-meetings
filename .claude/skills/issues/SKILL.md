---
name: issues
description: 'Creates the GitHub backlog from a phase plan — feature or refactor — one milestone per phase, one issue per task, and records the task → issue map in docs/<slug>/<slug>-MS.json. Use when a plan is ready and the work needs tracking on GitHub, or when another skill needs the MS file that milestone consumes.'
---

# Issues

The plan is the source; GitHub is the mirror. One milestone per phase, one issue per task, and an MS file that maps plan task → issue so `milestone` can find its work later.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → **`issues`** → `research` → `milestone`.

## Argument

Path to a plan (`/issues docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` and ask which one to publish, rather than picking one.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `issues` section sets the milestone titles, labels, issue body and map file this run writes.
- An `-MS.json` already sits next to that plan → read it and treat this run as a top-up: it names what already exists on GitHub.

## Steps

### 1. Read the plan

Every phase block: number, title, **Goal**, **Touches**, **Tasks**, **Done when**. Note the sibling `-PRD.md` and `-RESEARCH.md` paths in the same folder — they go into the MS file's `sources`.

Done when you hold the full list — every phase with its ordered tasks — and the counts to expect on GitHub.

### 2. Check the ground before writing anything

```bash
gh auth status
gh repo view --json nameWithOwner
gh label list
gh api repos/{owner}/{repo}/milestones --paginate --jq '.[] | "\(.number) \(.title)"'
```

Match each phase against the existing milestones by title, and each task against the issues already in that milestone (`gh issue list --milestone "<title>" --json number,title,state`). Anything already there is reused, never created twice — that is what makes a re-run after a failure safe.

Done when you can name, for every phase and every task, whether it exists on GitHub already or has to be created.

### 3. Confirm the write

Show the user what this run will create: repo, count of new milestones and issues with their titles, and the labels each issue will carry. Then ask for a go-ahead once, and create only after it.

Done when the user has approved the list, or has adjusted it and approved the adjusted one.

### 4. Create the milestones

One per phase, in plan order (`gh` has no `milestone` subcommand — go through the API):

```bash
gh api repos/{owner}/{repo}/milestones -f title="Phase 1. Storage service and upload endpoint" \
  -f description="<phase Goal>. Done when: <phase Done when>"
```

Done when every phase in the plan has exactly one milestone, and you have its number and URL.

### 5. Create the issues

One per task, in plan order, attached to its phase's milestone:

```bash
gh issue create --title "<task text, list marker stripped>" --milestone "<phase title>" \
  --label backend --label test --body "<body below>"
```

Issue body:

```markdown
**Phase**: <number and title> · **Plan**: <path to the PLAN file>

<what has to be true when this task is done, from the task and the phase Goal>

**Phase done when**: <the phase's Done when>
```

Labels: at most three, and only labels `gh label list` already returned — `backend` and `frontend` from the phase's **Touches**, `test` for a test-writing task, `security` for access control, validation or hardening, `documentation` for a doc task. A label the plan needs and the repo lacks → ask before creating it.

Done when every task in the plan has exactly one issue under the right milestone, with its number and URL captured.

### 6. Write the MS file

`docs/<slug>/<slug>-MS.json`, next to the plan, reusing the plan's slug. The shape below is what `milestone` reads, so the field names are fixed. Dates come from `date +%F`.

Done when every milestone and issue created in this run appears in the file, and `progress.nextPhase` points at the first phase whose milestone is open.

### 7. Report

Repo, milestone count and issue count, what was reused rather than created, any label question left open, the MS file path, and the next command: `/research docs/<slug>/<slug>-PLAN.md`, then `/milestone 1`.

## MS file

```json
{
  "feature": "meeting-file-upload",
  "repo": "seosmmbusiness/video-meetings",
  "createdAt": "2026-07-31",
  "sources": {
    "prd": "docs/meeting-file-upload/meeting-file-upload-PRD.md",
    "plan": "docs/meeting-file-upload/meeting-file-upload-PLAN.md",
    "research": null
  },
  "phases": [
    {
      "phase": 1,
      "title": "Phase 1. Storage service and upload endpoint",
      "status": "pending",
      "milestone": {
        "number": 1,
        "title": "Phase 1. Storage service and upload endpoint",
        "url": "https://github.com/seosmmbusiness/video-meetings/milestone/1",
        "state": "open"
      },
      "issues": [
        {
          "number": 12,
          "title": "Write e2e tests for POST /meetings/:id/files",
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
      "title": "Phase 1. Storage service and upload endpoint",
      "url": "https://github.com/seosmmbusiness/video-meetings/milestone/1"
    }
  }
}
```

Vocabulary `milestone` writes back into this file: phase `status` is `pending` → `in-progress` → `completed`, issue `state` is `OPEN`/`CLOSED`, milestone `state` is `open`/`closed`.

## Rules

- The plan is the source: issue titles are its task lines verbatim, minus the list marker, and phases and tasks arrive on GitHub in plan order. Work that is not in the plan does not become an issue here.
- Every issue belongs to a milestone; a stray issue has no phase to be closed with.
- Reuse what already exists on GitHub, matching by title — a second run tops up the backlog instead of doubling it.
- A failed run stops at the failure and writes the MS file with everything created so far, so the next run picks up from there.
- Issues describe the task and its phase; the technical choices behind it belong to `research` and land in the RESEARCH file, not in issue bodies.
- Creating, closing and editing happens only on this feature's milestones and issues. Existing GitHub items outside this plan stay untouched.
