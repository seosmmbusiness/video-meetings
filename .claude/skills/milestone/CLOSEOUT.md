# Close-out

Fires once, after the feature's last milestone closes: the docs move to the archive, the PRD is marked shipped, and the branches that made it into the base branch are cleaned up.

Close-out changes are commits like any other — they go on `chore/<slug>-closeout` cut from the base branch, never straight into `develop`/`main`.

On the refactor track the names shift as [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) sets them: `<slug>-REFACTOR-PRD.md`, `refactor/<slug>-phase-<N>` branches, and `docs/Refactor.md` as the log.

## 1. Confirm the feature is actually done

```bash
gh api repos/{owner}/{repo}/milestones --paginate --jq '.[] | select(.state=="open") | "\(.number) \(.title)"'
```

An open milestone belonging to this feature, or an open issue under a closed one, means the feature is not done: report it and stop rather than archiving live work.

Done when no milestone or issue of this feature is open.

## 2. Mark the PRD shipped

In `docs/<slug>/<slug>-PRD.md`: `**Status**: draft` → `**Status**: done`, and add `**Completed**: <date>` from `date +%F` beside it.

Done when the PRD states the feature shipped and when.

## 3. Audit the docs the feature left behind

Against root `CLAUDE.md` and the module docs, for the modules this feature created or changed:

- Every new module has `.claude/modules/module-<app>-<name>.md` and a line in `.claude/modules/INDEX.md`.
- Every changed module's doc matches the code that now exists — function list, behaviour, gotchas.
- The owning app's `CLAUDE.md` carries a one-line pointer per module.
- `README.md`, root `CLAUDE.md` and `.env.example` reflect any scripts, env vars or infrastructure the feature added.
- Root `CLAUDE.md`'s **Status** gains a sentence for what now exists, in the voice of the section.

A gap here is fixed in this branch — the feature does not get archived over stale docs.

Done when each item above is checked against the file, not from memory.

## 4. Archive the feature's docs

```bash
mkdir -p docs/archive
git mv docs/<slug> docs/archive/<slug>
```

The PRD, PLAN, RESEARCH and MS files link each other relatively (`./<slug>-PRD.md`), so those survive the move. What does not, and gets updated:

- Root `CLAUDE.md`, section `## Research reports` — the link points at `docs/archive/<slug>/<slug>-RESEARCH.md`.
- `docs/archive/<slug>/<slug>-MS.json` — every path under `sources` gains the `archive/` segment.
- Any other reference to `docs/<slug>/`: `grep -rn "docs/<slug>/" --exclude-dir=node_modules --exclude-dir=.git .`

Done when that grep returns nothing outside the archive itself.

## 5. Collapse the log rows

In `docs/Features.md` (`docs/Refactor.md` on the refactor track): delete this feature's `### <slug>` block from **In progress** and add one row at the top of **Shipped** — the completion date from `date +%F`, the slug, one line on what the feature now lets a person do, and a link to the archived PRD (`archive/<slug>/<slug>-PRD.md`, the path from step 4).

A refactor's row carries the same fields plus its outcome as a number — `p95 620 ms → 180 ms` — taken from the phase rows being collapsed, not re-estimated.

Done when the feature has exactly one row in the log, under **Shipped**, and its link resolves to the archived PRD.

## 6. Delete the branches that landed

Merged branches only — an unmerged branch may be the only copy of a phase's work:

```bash
git branch --merged <base> | grep "feature/<slug>-phase-"
git branch -d feature/<slug>-phase-<N>
git push origin --delete feature/<slug>-phase-<N>
```

Unmerged phase branches stay exactly where they are and go into the report by name, each with why it never landed (PR still open, PR closed unmerged).

Done when every merged phase branch of this feature is gone locally and on `origin`, and every surviving one is accounted for.

## 7. Commit and open the close-out PR

```bash
git add -A && git commit -m "docs: archive <slug> and mark the PRD done"
git push -u origin chore/<slug>-closeout
gh pr create --base <base> --title "Close out <slug>" --body "<what was archived, which branches were deleted, which survived>"
```

Done when the PR exists and its URL is in the report.

## 8. Add to the phase report

- PRD status and completion date;
- the archive path and the log row that replaced the phase rows;
- branches deleted, and branches kept with the reason;
- doc gaps found in step 3 and how they were closed;
- the close-out PR URL.
