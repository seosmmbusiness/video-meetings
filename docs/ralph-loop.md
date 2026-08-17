# The Ralph loop — operator's guide

How to run a feature's backlog unattended in this repo, what the loop will and will not do on its
own, and what to do when it stops.

This is the guide for the person starting a run. [`.claude/ralph.md`](../.claude/ralph.md) is a
different document — the contract each session reads — and you do not need it to operate the loop.

## What it is

One `claude -p` session per task, chained. A session opens the phase, six sessions each implement one
task, a session closes the phase into a PR, the loop re-runs every check itself and merges, and a
session settles the phase through `/bldprj:build-phase`. Then the next phase.

**It does not replace the pipeline.** Work follows `plugins/bldprj/skills/build-phase/SKILL.md`
exactly as a hand-driven build would, and the settle step calls that skill rather than reimplementing
it. What the loop adds is the chaining, the ceilings and a merge gate that is an exit code instead of
a person.

The point of one session per task is a fresh context each time: a task starts with its issue body and
this phase's plan, not with the residue of five earlier tasks.

## Before the first run

The loop consumes what the pipeline produced, so all of this has to exist already:

| Needs                                                                           | Check                                 |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| A final plan and a milestone map — `docs/<slug>/<slug>-FINAL.md` and `-MS.json` | `/bldprj:status`                      |
| Milestones and issues on GitHub, one issue per task                             | `gh issue list --milestone "<title>"` |
| The `ralph:done` and `ralph:blocked` labels                                     | `gh label list --search ralph`        |
| `gh` authenticated                                                              | `gh auth status`                      |
| Docker available, for any phase whose suites need Postgres                      | `docker compose version`              |
| A clean working tree                                                            | `git status`                          |
| `.claude/ralph.config.json` pointing at the right feature                       | see [Configuration](#configuration)   |

`node .claude/ralph-start.js` refuses to start unless every one of these is true, and names the ones
that are not. Nothing is fixed for you: a dirty tree is your call to commit or stash, never the
loop's to discard.

## Commands

```bash
node .claude/ralph-start.js              # start from the first phase that is not completed
node .claude/ralph-start.js --dry-run    # decide and print every link, spawn nothing
node .claude/ralph-start.js --status     # where the run got to; changes nothing
node .claude/ralph-start.js --resume     # continue after a halt, clearing the stop file
node .claude/ralph-start.js --phase 3    # start or resume at a specific phase number
touch .claude/ralph.stop                 # halt the chain; the current session finishes, no next one
tail -f .claude/ralph-logs/<runId>/*.log # watch
```

`--dry-run` is the one to reach for first. It runs the whole preflight and prints the exact `claude`
argv it would spawn, so a misconfigured feature or a queue in the wrong order shows up before a
single token is spent.

`--stage <name>` also exists, and does less than it looks like: it sets what the loop believes the
_previous_ link was, which only affects the after-the-fact check on that link. The stage that runs
next is always derived from the MS file and GitHub, never from what you typed.

## What one run does

The loop re-derives its position on every firing, from `docs/<slug>/<slug>-MS.json` and GitHub, so a
run picked up days later resumes correctly rather than repeating work.

| Stage          | Entered when                      | What happens                                                                                                       |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `open`         | the phase is `pending`            | clean tree, base pulled, `db:up`, migrations, `feature/<slug>-phase-<N>` cut, phase claimed, `docs: start phase N` |
| `task`         | the phase has an unfinished issue | one task, test-first, red `test(...)` then `feat(...)`, both `Refs #<n>`, issue labelled `ralph:done`              |
| `close`        | no unfinished issue left          | docs with the code, full check set, code review, push, PR with `Closes #` lines, `docs: phase N in review`         |
| `merge`        | the phase PR is open              | **no session** — the loop re-runs the checks itself and merges                                                     |
| `settle`       | the phase PR is merged            | `/bldprj:build-phase <N>` as a settle run: issues, milestone, MS file, FINAL status, `docs/Features.md`            |
| `settle-merge` | the settle PR is open             | **no session** — lint, format and docs-lint, then merge                                                            |
| `next`         | the phase is `completed`          | **no session** — on to the next phase                                                                              |
| `done`         | every phase has settled           | `/bldprj:close-feature <slug>`, and the run ends                                                                   |

Task order comes from the `issues` array in the MS file, which is plan order — 1.1 before 1.6. It is
never taken from `gh issue list`, which returns newest first.

An issue is **labelled** `ralph:done`, not closed. Issues close when the PR that carries their
`Closes #` lines merges, which is the pipeline's rule and the only one that keeps GitHub honest about
what has actually shipped.

## Watching a run

Everything a run produces lives under `.claude/ralph-logs/<runId>/` (gitignored):

| File                         | What it holds                                                            |
| ---------------------------- | ------------------------------------------------------------------------ |
| `NNN-<stage>.log`            | one session's or step's whole output, in order                           |
| `events.jsonl`               | one line per decision: spawn, retry, checks, merge, phase-complete, halt |
| `phase-<N>-full-checks.json` | every check the merge gate ran, with exit codes and output tails         |
| `phase-<N>-docs-checks.json` | the same for a settle PR                                                 |
| `spawned-<sessionId>`        | the marker that stops one session being advanced past twice              |

`events.jsonl` is the fastest way to read a finished run back:

```bash
jq -r '"\(.at) p\(.phase) \(.stage) \(.type) \(.issue // .why // "")"' \
  .claude/ralph-logs/<runId>/events.jsonl
```

## What merges, and what guards it

The loop merges its own PRs, so the gate is mechanical:

- `.claude/ralph/verify.js` re-runs `lint`, `format:check`, every tier the phase owns and
  `docs-lint` **itself**, writes the receipt, and merges only when every exit code is zero. A
  session's own report that it is green counts for nothing.
- A failing check comments the failure on the PR, halts the chain, and leaves the PR open.
- A conflicting PR halts rather than guessing.
- `mergeStrategy` is `merge`, not `squash`, so the red `test(...)` commit ahead of its `feat(...)`
  survives on `main`. That history is the only evidence the mandated cycle actually ran.

`.claude/hooks/guard-bash.js` refuses, in any session, force pushes, pushes to `main`,
`reset --hard`, `git clean`, `git branch -D`, commits and pushes that skip the git hooks,
`migrate reset`, `sudo`, and recursive deletes of anything but an explicit relative subpath.
Two more — merging and rebasing — are refused **only inside a Ralph link**, since both are things a
person does deliberately. Its suite is `node --test .claude/hooks/guard-bash.test.js`.

One ergonomic cost of that guard, worth knowing before it bites: a commit message or PR body that
quotes one of those commands has to arrive by file — `git commit -F <path>`,
`gh pr create --body-file <path>` — because a heredoc body cannot be told apart from a script.

## Configuration

`.claude/ralph.config.json` is committed and read-only during a run. Runtime state lives beside it in
`.claude/ralph.state.json` and is gitignored, along with the logs, the lock and the stop file.

| Key                        | Means                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `feature`, `ms`            | which feature to build, and the MS file that is its work queue               |
| `baseBranch`               | what phases branch from and merge into                                       |
| `model`, `fallbackModel`   | the model each session runs on, and what to fall back to when it is loaded   |
| `maxTurnsPerTask`          | turn ceiling for a task session (200)                                        |
| `maxTurnsPerBookend`       | turn ceiling for an open, close, settle or close-out session (120)           |
| `maxBudgetUsdPerSession`   | dollar ceiling per session (15)                                              |
| `taskRetries`              | attempts at one task before it is labelled `ralph:blocked` and the run halts |
| `maxSessionsPerRun`        | sessions before the run stops on its own (60)                                |
| `maxRunHours`              | wall-clock hours before the run stops on its own (8)                         |
| `mergeStrategy`            | `merge`, `squash` or `rebase` — see above for why it is `merge`              |
| `checks.api`, `checks.web` | the root npm scripts the merge gate runs for that layer                      |
| `phases[]`                 | per phase: its number, its `layer`, and whether it `needsDb`                 |

**To point the loop at another feature**, change `feature`, `ms` and the `phases` array; the
milestone titles, issue numbers and task order all come from the MS file itself.

## When it stops

A run ends by finishing, by hitting a ceiling, or by halting. `--status` says which, and
`.claude/ralph.stop` holds the reason.

| It says                                                  | What happened, and what to do                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `the working tree is dirty`                              | Preflight. Commit or stash your own changes; the loop will not touch them.                                                                            |
| `the ralph:done label does not exist`                    | `gh label create ralph:done` (and `ralph:blocked`).                                                                                                   |
| `run <id> still holds the lock`                          | A chain is already running, or died holding the lock. `--resume`, or delete `.claude/ralph.lock` if nothing runs.                                     |
| `issue #<n> is labelled ralph:blocked`                   | A session gave up. Read its comment on the issue, fix the cause, remove the label, `--resume`.                                                        |
| `<script> exited <code>`                                 | The merge gate refused. Read `phase-<N>-full-checks.json`, fix on the phase branch, `--resume`.                                                       |
| `retry budget exhausted`                                 | A task finished `taskRetries` times without labelling its issue. Read that task's logs; it usually means the session ran out of turns.                |
| `phase is in-review with no PR recorded`                 | The close session died between pushing and recording. `gh pr list --head feature/<slug>-phase-<N>`, then put the `pr` block into the MS file by hand. |
| `PR <url> is CLOSED`                                     | Somebody closed it unmerged. Deliberately a stop: reopening or rebuilding is your decision.                                                           |
| `PR <url> has conflicts`                                 | Resolve them on the branch, then `--resume`.                                                                                                          |
| `session ceiling reached` / `wall-clock ceiling reached` | Working as intended. `--resume` to grant another budget.                                                                                              |
| `this session is not a link of the run`                  | Normal. Your own interactive session ended and the loop correctly ignored it.                                                                         |
| Nothing at all, chain just stopped                       | A session died without either hook firing. `--status`, then `--resume`.                                                                               |

`--resume` always re-derives the stage from the MS file and GitHub, so it cannot repeat a task that
already landed.

## The first run

Rehearse before letting it off the leash:

1. `node .claude/ralph-start.js --dry-run` — confirm the queue starts at task **1.1**, not the last
   task of the milestone, and that the branch and milestone names are right.
2. `touch .claude/ralph.stop`, then run the `open` link and the first `task` link by hand from the
   argv the dry run printed. Pick a phase whose first task is tests-only, so the cost is bounded and
   nothing gets implemented against unreviewed specs.
3. Check the result by hand: `git log --oneline` shows one `test(...)` commit with one `Refs`, the
   suite is red exactly where it should be, and the issue carries `ralph:done`.
4. Remove `.claude/ralph.stop` and `node .claude/ralph-start.js --resume`.

## What it will not do

Worth knowing before leaving it running:

- It will not close an issue, merge without a clean check sweep, or merge a conflicting PR.
- It will not weaken a test to reach green, or skip the git hooks — both are `ralph:blocked`.
- It will not implement a task from another phase, or anything the PRD put out of scope.
- It will not resolve a contradiction between FINAL, RESEARCH and THREATS; that halts the run.
- It will not act on your interactive sessions ending, only on its own links.

One thing it _does_ do that a hand-driven build does not: it proceeds without the requester's
sign-off on a phase's e2e cases, because there is nobody in the room to give it. A tests-only task
posts its case list on the issue before implementing, so the cases can still be read back. See
[`HISTORY.md`](../HISTORY.md) for why that trade was made and what it costs.
