# Ralph — turns, budget and recovery

A working guide to the four knobs that decide how far an unattended Ralph session gets before it is
cut off, what happens when it is cut off, and how to pick values for a feature of a given size.

This is the operator's companion to [`docs/ralph-loop.md`](docs/ralph-loop.md), which covers running
and watching a loop. Everything here is about `.claude/ralph.config.json` and its override layer.
A Russian translation lives beside it in
[`Ralph-Instruction-RU.md`](Ralph-Instruction-RU.md); this file is the one to change first.

## Where the settings live

Two files, one on top of the other:

| File                           | Committed?      | What it is                                                                                          |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------------- |
| `.claude/ralph.config.json`    | yes             | The run's record of what it was asked to do.                                                        |
| `.claude/ralph.overrides.json` | no (gitignored) | Temporary corrections — what a dashboard writes when you turn the model down at two in the morning. |

`effectiveConfig()` (`.claude/ralph/lib.js:105`) merges them as `{ ...config, ...overrides }`, and
**every link of the chain is spawned with the result**. An override never touches the session already
running — only the next one. Clear a key by deleting it from the overrides file, or by setting it to
`null` (`writeOverrides` drops null keys).

## What a turn is

Ralph runs each link as a headless session:
`claude -p "<prompt>" --model <model> --max-turns <N> …` (`.claude/ralph/lib.js:489`).

A **turn is one assistant move** — one model response, which in practice means one tool call:

```
think → run Bash               ← turn 1
think → edit a file            ← turn 2
think → run the test suite     ← turn 3
…
think → final message          ← last turn
```

So a turn is not "one exchange with a human". Reading a file is a turn. Running `npm test` is a turn.
Committing is a turn. One test-first task — red spec, run, implement, run, fix, commit, label — costs
roughly 60–150 turns, and more when a suite keeps failing.

`--max-turns` is a **hard cut, not a hint**. The model does not wind down as it approaches the
ceiling; the process simply ends mid-work on turn N+1. That is why `.claude/hooks/stop.js` registers
on `SessionEnd` as well as `Stop`: a session killed by its turn ceiling never reaches a clean stop.

Two ceilings, picked in `lib.js` (`decide`) by `stage === 'task' ? maxTurnsPerTask : maxTurnsPerBookend`:

| Key                  | Links it governs                  | What happens there                                                                                                                 |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `maxTurnsPerTask`    | `task` — one backlog issue        | The whole TDD cycle: red spec, implementation, three test tiers, commits, the `ralph:done` label.                                  |
| `maxTurnsPerBookend` | `open`, `close`, `settle`, `done` | Claim the phase, open the PR, close issues and milestone, update the logs and the MS file, close the feature. Mechanical, shorter. |

## What the budget is

`maxBudgetUsdPerSession` becomes `--max-budget-usd` (`lib.js:505`): a ceiling on the token cost of
**one session** — not the phase, not the run. It counts real API spend, input (including the context,
which grows with every turn) plus output plus thinking tokens, at the chosen model's price. Hitting
it ends the session exactly like the turn ceiling does.

The two ceilings catch different failures, and whichever trips first wins:

- **`--max-turns`** catches "the model is looping over 200 small actions".
- **`--max-budget-usd`** catches "the model made 40 turns, but the context grew to 300k tokens and
  each turn now costs a dollar".

Every finished session writes a `result` line into its `stream-json` log carrying `total_cost_usd`,
`num_turns` and `is_error`; the dashboard reads those fields (`monitor.js:251-254`) for per-link and
per-run cost.

**There is no ceiling on a whole run.** Only `maxSessionsPerRun` and `maxRunHours` bound it, so the
theoretical worst case is `maxSessionsPerRun × maxBudgetUsdPerSession` — per window, since each
`--resume` grants both ceilings again. Real runs land far below that, but if you want a run budget
you have to watch the dashboard's running total yourself; it is the one number no ceiling resets.

`effort` feeds the same two ceilings from the other end: more thinking tokens means both a faster
burn of the dollar budget and, usually, fewer wasted turns.

## What happens when a session hits a limit

Fully automatic, and worth knowing by heart:

1. **The session dies** mid-task — implementation half-written, tests red, possibly nothing
   committed, and the issue's `ralph:done` label not set.
2. **The hook fires**: `SessionEnd` → `.claude/hooks/stop.js` → `lib.advance()`. It never waits on
   the session it spawns, and a per-session marker makes `Stop` and `SessionEnd` idempotent, so the
   pair cannot spawn two successors.
3. **The previous link is verified** by `verifyPreviousStage()` (`lib.js:1085`). For a `task` the
   test is exactly one thing — _does the issue carry `ralph:done`?_ If not:
   `{ ok: false, retry: true, why: 'issue #134 finished without the ralph:done label', key: 'task-134' }`.
4. **The attempt counter** `state.attempts['task-134']` goes up by one. While it is `<= taskRetries`,
   a `retry` event is logged and **a new session is spawned on the same task**.
5. **When the retries run out** (`attempts > taskRetries`, i.e. after the third failure), `halt()`
   writes `.claude/ralph.stop` with
   `… — retry budget (N) exhausted`, and the chain stops. The rest is yours.

The non-obvious part of a retry: **the new session has a clean context** and remembers nothing of the
one before it — but **the working tree and the branch are untouched**, half-written code and all. A
retry is therefore "a fresh session reads the contract, looks at the repository, and finishes the
job", not "carry on from memory". It usually works, because the task prompt is deterministic and the
state is visible in git. When a session leaves the tree in a contradictory state, all three attempts
tend to hit the same wall — that is a rollback, not a retry.

The other stages verify the same way: `open` must leave the phase `in-progress`, `close` must reach
`in-review`, `settle` must reach `completed`. A `ralph:blocked` label is `retry: false` — an immediate
halt, because the session itself said it could not proceed.

## Recovering a halted run

### 1. See where it stopped

```bash
node .claude/ralph-start.js --status
```

Prints the run id, `active`, phase N/M, stage, current issue, session count, every phase's status and
the halt reason from `.claude/ralph.stop`. It writes nothing.

### 2. See what cut the session off

```bash
ls .claude/ralph-logs/<runId>/
tail -n 40 .claude/ralph-logs/<runId>/task-1-1-i134-*.jsonl | jq -r '.'
```

Find the last `"type":"result"` line: `num_turns`, `total_cost_usd`, `is_error` and `subtype` say
whether it was the turn ceiling, the budget, or a plain failure. `events.jsonl` in the same directory
is the machine-readable record of the whole chain (`spawn`, `retry`, `halt`).

### 3. The tree the session left

A killed session usually leaves uncommitted work. `--resume` no longer refuses it: the preflight
stashes it as `ralph/<runId> <stage> #<issue> <time>` — untracked files included — and the next
session is told the stash exists, which files it touched, and to decide whether it belongs to the
task it is about to do before applying or ignoring it. Nothing drops a stash; `git stash list` still
has it afterwards either way.

A run started **without** `--resume` still refuses a dirty tree, because that work belongs to
whoever left it there. Commit it onto the phase branch, stash it yourself, or roll it back first.

### 4. Pick a way back

**A — carry on.** For a clean cut-off (work committed, suites green, it just ran out of turns before
the last steps):

```bash
node .claude/ralph-start.js --resume
```

`--resume` keeps `runId`, `phaseIndex`, `stage` **and `attempts`** — and the `link`, `closeout`,
`stash` and `selection` records with them (`lib.js`, `startState`) — so spent retries stay spent and
the chain still knows what was in flight, and it clears the halt and any pause by deleting `.claude/ralph.stop` and
`.claude/ralph.pause` (`ralph-start.js`, just before the state is written). This is also the command for "I raised the ceilings in
the overrides, give the task another go".

**It opens a fresh ceiling window too** (`ralph-start.js:240`): `maxRunHours` and
`maxSessionsPerRun` are counted from the resume, not from `startedAt`. Without that, a run stopped
at a phase boundary last night is refused this morning on the very ceiling you resumed it to clear —
and stopping at a boundary is now a button, so that is the ordinary case rather than the odd one.
`startedAt` still records how long the whole run has been going.

To start the retry count over, either zero `attempts` in `.claude/ralph-state.json` by hand before
resuming, or start without `--resume` (which also resets `sessions` and `startedAt` — a new run).

**B — start somewhere specific.**

```bash
node .claude/ralph-start.js --resume --phase 1     # from the top of that phase
node .claude/ralph-start.js --resume --stage task  # force the stage
```

`reconcile()` (`lib.js`) still checks the claimed stage against the MS file and the PR state on
GitHub, and **the MS file wins any disagreement** — you can point the chain at a stage, but you
cannot lie to it about what is already done.

**C — roll back.** When the session left a mess. Three modes, all on `r` in the dashboard
(`node .claude/ralph-watch.js --ui`):

| Mode                        | What it does                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restart the current link    | Kills the session, resets the phase branch to the checkpoint taken as that link started, and runs the same stage again. A task that reached `ralph:done` loses the label with the commits. |
| Undo the last finished task | Resets to before that task, removes `ralph:done`, and lets the chain pick it up again. A retried task goes back to before its _first_ attempt. Only the phase in flight is reachable.      |
| Revert a merged phase PR    | Cuts `revert/<slug>-phase-<N>`, reverts the merge commit there, pushes it and opens a PR. **Nothing is pushed to the base branch**, and the run halts.                                     |

Two things make these safe: every rollback is _planned_ first — the argv of each step is built as
data and asserted in `node --test .claude/ralph/monitor.test.js` — and anything a reset would discard
is saved to a `ralph-backup/<runId>-<timestamp>` branch first. Untracked files are left alone unless
you tick the box, and they have no backup. A rollback that cannot be done changes nothing: the plan
is built before the session is killed. A run started before checkpoints existed has none, and the
rollback says so instead of guessing.

## Recommended settings by feature size

Four presets, from a one-afternoon change to a feature that reshapes a schema and both apps. Sizes
are measured in what a phase actually contains, not in how important the feature feels.

|                          | **Small**                                       | **Medium**                                     | **Large**                                   | **Heavy**                                                |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Typical shape            | 1 phase, 2–4 tasks, one layer, no schema change | 2–3 phases, 4–8 tasks per phase, one migration | 4–6 phases, both layers, several migrations | 6+ phases, cross-cutting refactor, new external boundary |
| `model`                  | `sonnet`                                        | `opus`                                         | `opus`                                      | `opus`                                                   |
| `fallbackModel`          | `sonnet`                                        | `sonnet`                                       | `sonnet`                                    | `sonnet`                                                 |
| `effort`                 | `low`                                           | `medium`                                       | `medium`                                    | `high`                                                   |
| `maxTurnsPerTask`        | `80`                                            | `150`                                          | `200`                                       | `300`                                                    |
| `maxTurnsPerBookend`     | `60`                                            | `100`                                          | `120`                                       | `150`                                                    |
| `maxBudgetUsdPerSession` | `8`                                             | `20`                                           | `45`                                        | `80`                                                     |
| `taskRetries`            | `1`                                             | `2`                                            | `2`                                         | `2`                                                      |
| `maxSessionsPerRun`      | `15`                                            | `35`                                           | `60`                                        | `100`                                                    |
| `maxRunHours`            | `2`                                             | `5`                                            | `8`                                         | `12`                                                     |
| Worst-case run spend     | ~$120                                           | ~$700                                          | ~$2700                                      | ~$8000                                                   |

The worst-case column is `maxSessionsPerRun × maxBudgetUsdPerSession` — the number the ceilings
permit, not the number to expect. Real runs come in far lower because most links finish well under
their budget; treat it as the blast radius of a loop that goes wrong overnight.

As JSON, ready to drop into `.claude/ralph.overrides.json`:

```jsonc
// Small — one phase, no schema change
{ "model": "sonnet", "fallbackModel": "sonnet", "effort": "low",
  "maxTurnsPerTask": 80, "maxTurnsPerBookend": 60,
  "maxBudgetUsdPerSession": 8, "taskRetries": 1 }

// Medium — a couple of phases, one migration
{ "model": "opus", "fallbackModel": "sonnet", "effort": "medium",
  "maxTurnsPerTask": 150, "maxTurnsPerBookend": 100,
  "maxBudgetUsdPerSession": 20, "taskRetries": 2 }

// Large — both apps, several phases
{ "model": "opus", "fallbackModel": "sonnet", "effort": "medium",
  "maxTurnsPerTask": 200, "maxTurnsPerBookend": 120,
  "maxBudgetUsdPerSession": 45, "taskRetries": 2 }

// Heavy — cross-cutting, new boundary
{ "model": "opus", "fallbackModel": "sonnet", "effort": "high",
  "maxTurnsPerTask": 300, "maxTurnsPerBookend": 150,
  "maxBudgetUsdPerSession": 80, "taskRetries": 2 }
```

`maxSessionsPerRun` and `maxRunHours` are worth putting in the committed config rather than the
overrides — they describe the shape of the feature, not a correction made mid-run.

### Reading the presets

- **`model` / `fallbackModel`.** The fallback is what the CLI switches to when the primary is
  unavailable or overloaded; without one, the session simply dies and burns a retry. Keeping
  `sonnet` as the fallback everywhere is the point — a degraded session is better than a halted run.
- **`effort`.** Absent from the committed config, so setting it in the overrides _adds_ a flag the
  sessions did not have. `low` on mechanical work, `high` only where the design decisions are real.
- **Turn ceilings.** Raising `maxTurnsPerTask` past ~250 is usually the wrong fix. A 300-turn session
  drags an enormous context, every turn costs more than the last, and you hit the dollar ceiling
  before the turn ceiling. The symptom that says _split the task instead_ is visible in the log: a
  large `num_turns` together with a cycle of "edit → test → same failure".
- **`taskRetries`.** Three attempts total at `2`. More rarely helps: if two clean-context retries did
  not manage it, the problem is the tree or the task, not the number of tries. Halt and roll back.

### Calibrating from a real run

After the first phase, read the numbers back out of the logs instead of guessing:

```bash
grep -h '"type":"result"' .claude/ralph-logs/<runId>/*.jsonl \
  | jq -r '[.num_turns, .total_cost_usd, .is_error] | @tsv'
```

- Sessions clustering near the turn ceiling → the tasks are too big; split them in the plan.
- Sessions clustering near the dollar ceiling at _low_ turn counts → the context is bloated; look at
  what the prompt drags in, or drop `effort`.
- Sessions finishing at a fraction of both → the ceilings are pure insurance, and the cheaper preset
  would have done the same work.

## See also

- [`Ralph-Instruction-RU.md`](Ralph-Instruction-RU.md) — the same document in Russian.
- [`docs/ralph-loop.md`](docs/ralph-loop.md) — running, watching and steering a loop.
- [`.claude/ralph.md`](.claude/ralph.md) — the contract every session reads.
- [`HISTORY.md`](HISTORY.md) — why the loop is built this way.
