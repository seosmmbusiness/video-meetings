# Pipeline

Eight stages, nine skills, one chain. Each stage owns one artifact and one class of decision, and reads the artifact the stage before it wrote. A tenth skill, `status`, sits outside the chain and only reports on it:

```
prd | refactor-prd  →  plan-phase  →  research  →  security-analyse  →  pre-issues  →  issues  →  build-phase  →  close-feature
```

| Stage              | Reads                        | Writes                        | Owns                                                    |
| ------------------ | ---------------------------- | ----------------------------- | ------------------------------------------------------- |
| `prd`              | the request, the repo        | `-PRD.md`, `docs/INDEX.md`    | what the user gets, and how it is proven done           |
| `refactor-prd`     | the code, the suite          | `-REFACTOR-PRD.md`, the index | what stays identical, and what improves behind it       |
| `plan-phase`       | the PRD                      | `-PLAN.md`                    | the preliminary cut into phases, and every task number  |
| `research`         | plan, PRD, repo              | `-RESEARCH.md`                | the mechanism: library, storage, schema, limits         |
| `security-analyse` | plan, PRD, research, code    | `-THREATS.md`                 | the reachable risk and the control that closes it       |
| `pre-issues`       | PRD, plan, research, threats | `-FINAL.md`                   | drift against the PRD, and the ruling on every conflict |
| `issues`           | `-FINAL.md`                  | GitHub, `-MS.json`            | the mirror of the final plan on GitHub                  |
| `build-phase`      | `-MS.json` and its sources   | code, PR, progress            | one phase, from branch to green PR to closed milestone  |
| `close-feature`    | the merged base, `-MS.json`  | archive, logs, PRD status     | the proof of every criterion, and the archive           |

A stage never reopens the stage before it: a contradiction goes back to its owner as a question, and the answer arrives as a revision, not as a silent local fix. `pre-issues` is where the contradictions the earlier stages each settled in their own favour are collected and put to the user.

The plan is **preliminary** until `pre-issues` consolidates it: `plan-phase` cuts the phases before any mechanism is known, `research` and `security-analyse` revise them, and `-FINAL.md` is the buildable document `issues` publishes and `build-phase` builds from.

Two tracks run through the same skills. **Feature** adds behaviour; **refactor** keeps behaviour identical and improves what sits behind it — [`REFACTOR-TRACK.md`](REFACTOR-TRACK.md) holds everything the refactor track does differently, and every skill reads its track off the file name.

## Identity

Seven identifiers carry work through the chain. Each is minted once by the stage that owns it, and every later mention is a reference to it:

| Id                | Minted by              | Shape                                               |
| ----------------- | ---------------------- | --------------------------------------------------- |
| **slug**          | `prd`                  | English kebab-case, names the folder and every file |
| **Key**           | `prd`                  | 2–6 uppercase letters, the slug's initials — `MFU`  |
| **`AC-<n>`**      | `prd` / `refactor-prd` | one acceptance criterion                            |
| **`<phase>.<n>`** | `plan-phase`           | one task, counted from 1 inside its phase           |
| **`D-<n>`**       | `research`             | one technical decision                              |
| **`S-<n>`**       | `security-analyse`     | one security finding                                |
| **`T-<n>`**       | `pre-issues`           | one trade-off ruled on by the user                  |

- Numbers are **never reused and never renumbered**. A dropped item keeps its number, retired, so the issue, commit or log row that cites it still resolves.
- A **Key** is unique across the repo, both tracks and the archive included. Mint it against what already exists, and lengthen it on a collision, up to six letters (`MFU` taken → `MFUP`) — it prefixes every milestone and issue title, so the shortest one that is still free is the right one:

  ```bash
  grep -h '^\*\*Key\*\*' docs/*/*-PRD.md docs/*/*-REFACTOR-PRD.md docs/archive/*/*-PRD.md docs/archive/*/*-REFACTOR-PRD.md 2>/dev/null | sort -u
  ```

- A refactor reusing a feature's `docs/<slug>/` folder reuses that feature's Key; the `R` prefix on its phase numbers keeps the two tracks apart.

## Artifacts

One folder per slug, holding both tracks. The `-REFACTOR-` infix says which one a file belongs to:

| Feature track                       | Refactor track                       |
| ----------------------------------- | ------------------------------------ |
| `docs/<slug>/<slug>-PRD.md`         | `docs/<slug>/<slug>-REFACTOR-PRD.md` |
| `<slug>-PLAN.md`                    | `<slug>-REFACTOR-PLAN.md`            |
| `<slug>-RESEARCH.md`                | `<slug>-REFACTOR-RESEARCH.md`        |
| `<slug>-THREATS.md`                 | `<slug>-REFACTOR-THREATS.md`         |
| `<slug>-FINAL.md`                   | `<slug>-REFACTOR-FINAL.md`           |
| `<slug>-MS.json`                    | `<slug>-REFACTOR-MS.json`            |
| branch `feature/<slug>-phase-<N>`   | branch `refactor/<slug>-phase-<N>`   |
| `docs/Features.md`                  | `docs/Refactor.md`                   |
| milestone/issue title `<KEY> <N> …` | `<KEY> R<N> …`                       |

A `docs/*/*-PRD.md` listing matches both tracks — the infix in the path says which one you picked up.

## Resolving paths

- **Before the backlog exists**: siblings of the document in the argument, by slug. The plan is exactly one file, revised in place; the **current** FINAL is the highest-numbered `-FINAL-v<N>.md` present, and the unsuffixed file is version 1.
- **Once `-MS.json` exists**: its `sources` block is authoritative. `sources.final` records the exact FINAL file the backlog was published from, version and all, and `sources.plan` the preliminary plan behind it — `build-phase` and every later run take their phases and tasks from `sources.final`, and the PRD, research and threats from those fields, rather than looking for the newest file on disk.

## Versions

Two documents carry phases and tasks. The plan is the **preliminary** one and is revised in place; FINAL is the **published** one and is versioned, because `issues` has turned it into a GitHub backlog and `build-phase` closes work against it.

- **The plan** — `research` and `security-analyse` revise it where a decision or a finding changes the work: edit it in place, keeping every phase and task number intact, and log the change in its `## Revisions` section, citing the `D-<n>` or `S-<n>` behind it. New tasks take the next free number in their phase; a dropped task stays as `- [~] **2.3** <label> — dropped: <reason>`. Once `pre-issues` has consolidated it, it carries `**Status**: superseded by [<slug>-FINAL.md](./<slug>-FINAL.md)` and no later stage reads it again.
- **FINAL** — no `-MS.json` beside it → a re-run of `/bldprj:pre-issues` rewrites it in place. An `-MS.json` exists → write the next version, `docs/<slug>/<slug>-FINAL-v<N>.md`, carrying every phase and task forward with its number intact, and the version it replaces gains `**Status**: superseded by [<slug>-FINAL-v<N>.md](./<slug>-FINAL-v<N>.md)`.

**Anything larger belongs to the user**: a change of phase order, a new phase, a phase that swaps layers, or work that crosses the PRD's scope fence — show it with the reason and ask, since it is usually a PRD change wearing a plan's clothes.

**After a revision the backlog is stale.** Re-run `/bldprj:pre-issues`, then `/bldprj:issues` on the FINAL it wrote: `issues` reconciles by task number, tops up what is missing, and reports the issues whose task no longer exists rather than closing them.

## The project's workflow

How a layer is written and verified belongs to the **host project's docs**, not to this pipeline: one project develops its API test-first, another proves a screen with an e2e spec, a third does neither. What the pipeline owns is carrying that rule from the project's docs to the commit, so it is still legible where the work is done rather than only where the plan was read.

Every phase block therefore carries a **Verified by** line, next to **Done when**:

```markdown
**Verified by**: Red/Green/Refactor per apps/api/CLAUDE.md — e2e cases, security cases
included, written and reviewed before the implementation.
```

| Stage         | What it does with the line                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `plan-phase`  | reads the project's docs for the layers in **Touches** and writes the line, in the project's own words        |
| `research`    | leaves it alone unless a decision changes how a layer can be proven, and then revises it citing its `D-<n>`   |
| `pre-issues`  | carries it into FINAL and hardens it, the way it hardens **Done when** — the actual suite, spec file, command |
| `issues`      | renders it into every issue body, so it reaches whoever opens the issue                                       |
| `build-phase` | follows it as step 5's testing idiom, and shows its evidence in the PR body                                   |

**Done when** says what proves the phase finished; **Verified by** says how the work gets written on the way there. A phase carrying neither an observation nor an idiom is what lets a workflow the project mandates go missing between the plan and the commit — the linter warns on a phase with no **Verified by**.

### When the workflow is its own task

Where a project writes its tests first, a phase's specs are a unit of work in their own right, and folding them into the task that also writes the implementation is exactly what makes the red state unprovable afterwards. That task is written with `tests:` opening its description:

```markdown
- [ ] **1.1** Cover upload, list and download with failing specs — tests: the e2e cases for
      AC-1 and AC-11, security cases included, red before 1.2 starts.
```

The marker is read rather than guessed: `issues` takes the `test` label from it, and the five-tasks-per-phase ceiling counts only the tasks that **build** — a phase never has to choose between splitting itself and writing its specs down. Such a task still traces to the `AC-<n>` its specs prove; it is exempt from the ceiling, not from the fence.

## Re-running a stage

The chain runs forward once, and that single pass is complete on its own: nothing in this section is needed for a feature to reach `issues`.

A stage run again on a document it already wrote is a **revision pass**, not a rewrite. It is detected rather than asked for — its own artifact exists, and the artifact of a stage after it is newer — and `research` and `security-analyse` each carry the closed list of triggers that says what it may touch.

- **Read backwards first**: its own previous output, then what the later stage wrote against it, then the plan's `## Revisions`.
- **Change only what a trigger fires on.** Everything else is left byte-identical. A block rewritten in different words, or a decision re-taken the same way under a new number, is the failure this contract exists to prevent — a revision pass that touches nothing is the expected outcome.
- **Record the round** in the document's own `## Revisions`, one line per change, citing the identifier from the other stage behind it: `2026-08-07 — round 2: D-3 superseded by D-7 (chosen storage cannot scope by owner) — S-1.`
- **Converged is a result, not a failure.** No trigger fired → the file gains one `## Revisions` line naming the round and what was re-read, nothing else moves, and the report says so plainly and names the next command in the chain.
- **Numbers survive a reversal.** A superseded decision or a retired finding keeps its `### D-3.` / `### S-2.` heading, so every citation and the linter still resolve, and gains `**Superseded by**: D-7 — <reason>, round <N>` as the block's first line. It is never deleted and never renumbered; replacement work takes the next free number.
- **The plan is revised exactly as on the first pass** — in place, every task number intact, each `## Revisions` line naming the `D-<n>` or `S-<n>` behind it.

**Two rounds is the budget** — `research` → `security-analyse` → `research` → `security-analyse`. What survives that is a trade-off rather than a technical gap, and a trade-off is `pre-issues`' to rule on: at the end of round 2 each skill recommends `/bldprj:pre-issues` and names what stays open. A further round asked for by hand still runs, and still runs as a revision pass — the skill does the work, says the budget is past, and names the conflict it believes arbitration would settle more cheaply.

## Asking

Every skill asks. Each asks inside **its own class**, and hands a question outside that class to the stage that owns it — named in the report, so it is asked at the stage that can answer it cheaply:

| Skill              | Its class                                                                                                                           | Floor                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `prd`              | product: actors and their rights, what the user sees when it fails, the limits that are the user's, the fence around this iteration | asks the limits and the failure the user sees, whenever the request left them open |
| `refactor-prd`     | the fate of each improvement found, behaviour no test protects, the numbers the code cannot supply                                  | one block                                                                          |
| `plan-phase`       | the cut: which phase split to take, an `AC-<n>` no phase can satisfy as written, a scope reading that reorders phases               | offers its chosen split against at least one alternative                           |
| `research`         | trade-offs the repo cannot settle: each new dependency, a limit absent from the PRD, anything paid, external or scope-moving        | one question per new dependency                                                    |
| `security-analyse` | risk the user owns: accept a finding, or raise it into an acceptance criterion                                                      | one per finding it cannot dispose of on its own                                    |
| `pre-issues`       | arbitration: which of a promise, a control, a mechanism or the scope gives way, and which reading of a requirement to build         | one per conflict the four documents cannot settle between them                     |
| `issues`           | the write itself, orphaned issues, a label the repo lacks                                                                           | the go-ahead, before anything is written to GitHub                                 |
| `build-phase`      | contradictions between its sources, and the stop points its own steps name                                                          | asks only when it stops                                                            |
| `close-feature`    | a criterion that cannot be proven against the shipped code, live work blocking the archive                                          | asks only when it stops                                                            |

- **Front-load.** The same question costs a paragraph here and a rewrite two stages later.
- **Every option carries a recommendation and a consequence.** The recommended one comes first, marked `(Recommended)`, and each option says what picking it costs. Where deferring is real, "leave it to `research`" is one of the options.
- **Shape**: at most four questions per block, four options each; more decisions → further blocks, the one whose answer reshapes the others first. At most two blocks per run — past that the answers get rubber-stamped.
- **Skip whatever the repo, the argument or project convention already answers**, and say so.
- **Silence is recorded.** A run that asked nothing says why in its report, and whatever it took as given goes into the document's **Asked & assumed** section.

## Writing a document

- **Date**: `date +%F` — the real date, not a remembered one.
- **Language**: English, whatever language the request came in.
- **An existing file is never overwritten**: ask whether to update it in place or start a new iteration.
- Every document ends with the section below, so a reader can tell a requirement that was agreed from one that was inferred:

  ```markdown
  ## Asked & assumed

  - **Asked** — <the question> → <what the user chose>.
  - **Assumed** — <what was taken as given> · <what changes if it is wrong>.
  ```

- **Postflight**: run the docs linter before reporting. The project's own entry point comes first where its docs name one, in whatever form the project runs commands (an npm `docs:lint` script, a make target, a task runner recipe); otherwise the copy shipping with this plugin, which needs Node on the machine: `node ${CLAUDE_PLUGIN_ROOT}/scripts/docs-lint.mjs <project root>`. It checks what this file makes mechanical — key uniqueness, task numbering, label and title lengths, acceptance-criteria coverage, citation integrity both ways, plan ↔ backlog agreement, resolvable links. A finding is fixed before the report, or named in it; a linter that could not run at all is named too, with what stopped it, and never passed off as clean.

## Reporting

Close every run with the path it wrote, the identifiers it minted, what the user decided, what stays open, and the **next command** in the chain — on the refactor track its argument is the `-REFACTOR-` file. Facts as they came out: a check that did not run and a step that was skipped are named outright, with the output.
