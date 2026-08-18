# The Ralph loop — operator's guide

How to run a feature's backlog unattended in this repo, what the loop will and will not do on its
own, and what to do when it stops.

This is the guide for the person starting a run. [`.claude/ralph.md`](../.claude/ralph.md) is a
different document — the contract each session reads — and you do not need it to operate the loop.
[`Ralph-Instruction.md`](../Ralph-Instruction.md) is the companion to this one: what a turn and a
dollar ceiling actually are, what happens when a session hits one, and recommended settings by
feature size.

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
node .claude/ralph-start.js --watch      # start it, then watch it in this terminal
node .claude/ralph-start.js --ui         # start it, and open the dashboard as well
node .claude/ralph-watch.js              # attach a view to a run that is already going
touch .claude/ralph.stop                 # halt the chain; the current session finishes, no next one
tail -f .claude/ralph-logs/<runId>/*     # the raw logs, if you would rather read them yourself
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

A run is a chain of detached processes, so watching one is separate from starting it: a view can be
opened, closed and reopened from any terminal while the build carries on, and closing a view never
touches the run.

```bash
node .claude/ralph-start.js --watch          # start, then watch here
node .claude/ralph-start.js --ui             # start, watch here, and serve the dashboard
node .claude/ralph-watch.js                  # attach to a run already going
node .claude/ralph-watch.js --ui --port 4600 # …with the dashboard on a port of your choosing
node .claude/ralph-watch.js --ui --no-tui    # dashboard only, for a terminal you need back
```

Both views draw the same snapshot and drive the same controls — pick whichever suits the screen:

| The view shows                          | Where it comes from                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| phase _N_ of _M_, task _i_ of _j_       | the MS file and the state file                                                    |
| stage, issue, branch, elapsed           | the state file                                                                    |
| **what the session is doing right now** | the last few tool calls and lines of prose from the live link's `stream-json` log |
| turns, thinking tokens, cost            | the same stream; run cost is every finished session's own `result` line, summed   |
| model, effort, ceilings                 | the config, with any override on top; a pending change shows as `opus → sonnet`   |
| workers `1/1`                           | how many links are in flight. The chain is serial by design — see below           |
| the merge gate's last verdict           | `phase-<N>-*-checks.json`                                                         |

### The controls

| Key                     | Button          | What it does                                                                                                                                                                                                      |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p`                     | Pause/Resume    | Holds the chain at the next link boundary. The link in flight finishes; no successor is spawned. Pressing it again clears the hold — and any halt — and asks the chain for its next link.                         |
| `s`                     | Stop            | Halts the run. `f` lets the link in flight finish first; `k` kills it and its whole process group now. Either way `.claude/ralph.stop` goes down first, so the dying session's own hook cannot spawn a successor. |
| `r`                     | Rollback…       | Three ways back, described below. Every one asks first and names what it will do.                                                                                                                                 |
| `m` `f` `e` `t` `b` `n` | settings fields | model, fallback, effort, turns per task, budget per session, retries.                                                                                                                                             |
| `l`                     | —               | More activity lines.                                                                                                                                                                                              |
| `q`                     | —               | Leaves the view. The run keeps going.                                                                                                                                                                             |

**Settings apply to the next link, never to the session already running** — nothing can change a
running session's model or ceilings. A change is written to `.claude/ralph.overrides.json`
(gitignored) rather than to the committed config, because the config is the run's record of what it
was asked to do, and a model turned down at two in the morning is not that record. Clear an override
by saving an empty value.

**Workers is `1` and is not editable.** The chain runs one link at a time on one working tree, and
that is what makes its guarantees hold: one branch, one commit order, one `red → green` sequence per
task. The field is there to say so honestly, not as a knob.

### Rolling back

| Mode                        | What it does                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restart the current link    | Kills the session, resets the phase branch to the checkpoint taken the instant that link started, and runs the same stage again. A task that got as far as `ralph:done` loses the label along with the commits.                                                          |
| Undo the last finished task | Resets to before that task, takes its `ralph:done` label off, and lets the chain pick it up again. A task that was retried goes back to before its first attempt, and only the phase in flight is ever reachable — checkpoints from a phase that already merged are not. |
| Revert a merged phase PR    | Cuts `revert/<slug>-phase-<N>`, reverts the merge commit there, pushes it and opens a PR. **Nothing is pushed to the base branch**, and the run halts — what follows is yours.                                                                                           |

Two things make this safe enough to be a button. Every rollback is _planned_ first — the exact argv
of each step is built as data, which is what
`node --test .claude/ralph/monitor.test.js` asserts — and anything a reset would discard is kept on a
`ralph-backup/<runId>-<timestamp>` branch first. Untracked files are left alone unless you tick the
box; there is no backup for those.

The chain records a checkpoint (`sha`, branch, stage, issue) immediately before each link, which is
what the first two modes rewind to. A run started before checkpoints existed has none, and the
rollback says so rather than guessing.

A rollback that cannot be done changes nothing: the plan is built before the session is killed, so
"undo the last finished task" on a phase whose first task is still running refuses and leaves the
run exactly as it was. A pause you set yourself is still there afterwards, too — a rollback only
clears the pause it took out itself.

### The files underneath

Everything a run produces lives under `.claude/ralph-logs/<runId>/` (gitignored):

| File                         | What it holds                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `NNN-<stage>.jsonl`          | one session's `stream-json`: every tool call, turn, cost and the closing report               |
| `NNN-<stage>.log`            | a `node` step's plain output — the merge gate's check run                                     |
| `events.jsonl`               | one line per decision: spawn, retry, checks, merge, phase-complete, halt, and what a view did |
| `phase-<N>-full-checks.json` | every check the merge gate ran, with exit codes and output tails                              |
| `phase-<N>-docs-checks.json` | the same for a settle PR                                                                      |
| `spawned-<sessionId>`        | the marker that stops one session being advanced past twice                                   |

Sessions write `stream-json` rather than plain text precisely so a run can be watched: text arrives
in one block after the session has already ended. To read a session log by hand:

```bash
jq -r 'select(.type=="assistant") | .message.content[]
       | select(.type=="tool_use") | "\(.name) \(.input.command // .input.file_path // "")"' \
  .claude/ralph-logs/<runId>/007-task-1-3-i136.jsonl
```

`events.jsonl` is still the fastest way to read a finished run back:

```bash
jq -r '"\(.at) p\(.phase) \(.stage) \(.type) \(.issue // .why // "")"' \
  .claude/ralph-logs/<runId>/events.jsonl
```

### Who may press the buttons

The dashboard binds `127.0.0.1` only, and every request carries a token generated when it starts —
the address printed at startup contains it, so treat that URL as a credential. Cross-origin requests
are refused, and so is a `Host` header that is not the loopback, which is the shape a DNS-rebinding
attack arrives in. `node --test .claude/ralph/web.test.js` covers those three refusals.

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
`.claude/ralph.state.json` and is gitignored, along with the logs, the lock, the stop and pause
files, `.claude/ralph.advance.lock` (held for the second or two a decision takes, so two views
cannot each start one), and `.claude/ralph.overrides.json` — the settings a view changed while the
run was in flight, which are merged over the config every time a link is spawned.

| Key                        | Means                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `feature`, `ms`            | which feature to build, and the MS file that is its work queue                          |
| `baseBranch`               | what phases branch from and merge into                                                  |
| `model`, `fallbackModel`   | the model each session runs on, and what to fall back to when it is loaded              |
| `effort`                   | optional reasoning effort per session (`low`…`max`); absent means the CLI's own default |
| `maxTurnsPerTask`          | turn ceiling for a task session (200)                                                   |
| `maxTurnsPerBookend`       | turn ceiling for an open, close, settle or close-out session (120)                      |
| `maxBudgetUsdPerSession`   | dollar ceiling per session (15)                                                         |
| `taskRetries`              | attempts at one task before it is labelled `ralph:blocked` and the run halts            |
| `maxSessionsPerRun`        | sessions before the run stops on its own (60)                                           |
| `maxRunHours`              | wall-clock hours before the run stops on its own (8)                                    |
| `mergeStrategy`            | `merge`, `squash` or `rebase` — see above for why it is `merge`                         |
| `checks.api`, `checks.web` | the root npm scripts the merge gate runs for that layer                                 |
| `phases[]`                 | per phase: its number, its `layer`, and whether it `needsDb`                            |

**To point the loop at another feature**, change `feature`, `ms` and the `phases` array; the
milestone titles, issue numbers and task order all come from the MS file itself.

**How to choose the ceilings** — what a turn costs, what the dollar budget bounds, and four presets
from a small feature to a cross-cutting one — is in
[`Ralph-Instruction.md`](../Ralph-Instruction.md).

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
| `paused: …`                                              | Somebody held it from a view. Press `p` again there, or delete `.claude/ralph.pause` and `--resume`.                                                  |
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
