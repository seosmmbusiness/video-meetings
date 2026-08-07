---
name: pre-issues
description: 'Consolidates a preliminary plan, its research and its threat analysis into the buildable final plan — every acceptance criterion traced to the tasks that keep it, every contradiction ruled on by the user — at docs/<slug>/<slug>-FINAL.md. Use when a plan has been researched and threat-analysed and the backlog is next, when the work should be checked for drift from the PRD before implementation starts, or when another skill needs the final plan that issues and build-phase consume.'
---

# Pre-issues

Four documents now describe the same work — the PRD's promise, the plan's cut, the research's mechanisms, the threats file's controls — and nothing has yet held them against each other. This run does, and writes the one document implementation reads: `docs/<slug>/<slug>-FINAL.md`.

Two failures it exists to catch:

- **Drift** — the plan, two revisions later, no longer builds what the PRD promised: a criterion nothing produces, a limit quietly lowered by a research parameter, a task nobody asked for.
- **Conflict** — the earlier stages each resolved a collision in their own favour and moved on: a control that closes `S-2` by rejecting what `AC-4` promises, a decision whose mechanism cannot produce the observable a criterion names.

A conflict is not a bug to fix quietly. It is a **ruling**, and the ruling is the user's: sacrificing a control, a promise or a mechanism to ship the business requirement is a trade they own, and this is the stage that puts it to them — while it still costs a paragraph.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → `security-analyse` → **`pre-issues`** → `issues` → `build-phase` → `close-feature`. The last stage before implementation: after it, `issues` mirrors FINAL onto GitHub and `build-phase` builds from it.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

## Argument

Path to a plan (`/bldprj:pre-issues docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` that have a research and a threats file beside them, and ask which one to finalise.
- No `-RESEARCH.md` or no `-THREATS.md` beside it → say so and offer `/bldprj:research` or `/bldprj:security-analyse` first: with a mechanism or a control still missing there is nothing to consolidate.
- A `-FINAL.md` already sits there → **Versions** in `PIPELINE.md` decides whether this run rewrites it or writes the next version.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `pre-issues` section adds parity to the conflict classes and names the file this run writes.

## Steps

### 1. Load what the four stages left

Read all four, each against the ones before it:

1. **PRD** — goal, every scenario, In scope, **Out of scope**, technical constraints, and every `AC-<n>` in its exact wording, numbers included.
2. **The current plan** — every phase with its **Goal**, **Touches**, **Covers**, **Decisions**, **Threats**, **Done when**, every task with its number and label, the `- [~]` dropped ones, and `## Revisions`.
3. **RESEARCH** — the decision map, every `D-<n>` with its **Chosen**, **Exposure** and **Fits in at**, the Parameters table verbatim, Dependencies, and section 9's plan impact.
4. **THREATS** — the threat map, every `S-<n>` with its control, its proof and its disposition, and section 5's plan impact.

Then the repo the documents make claims about: the project's root docs, the docs of each part they touch, and the module docs of what this work extends — enough to tell a claim that is already true from one that is still work.

Done when you can state, for every task number in the plan, the `AC-<n>` it serves, the `D-<n>` that constrains it and the `S-<n>` it must close — and, in the other direction, the tasks every `AC-<n>`, `D-<n>` and `S-<n>` lands on.

### 2. Trace every promise down to the work that keeps it

`**Covers**: AC-3` is a citation, not proof. For each `AC-<n>`, name the tasks whose output a person could hold the criterion against, and the phase where it first becomes true. What the trace turns up, one row each:

- a criterion no task produces — a citation with nothing behind it;
- a criterion produced but unprovable: no task writes the test or the observation the criterion is checked by, so close-out will have nothing to hold it against;
- a criterion quietly narrowed — a limit, count, format list or retention in the research Parameters table smaller than the number the PRD promised the user;
- a criterion served only by a task the revisions dropped to `- [~]`.

Done when every `AC-<n>` carries either its task list plus what proves it, or a named gap.

### 3. Trace every task back up to the promise it serves

The fence works in both directions. Every live task traces to an `AC-<n>`; a task nothing promises is either work the PRD forgot or work that crept in during a revision, and which one it is goes to the user in step 5.

Then walk the PRD's **Out of scope** list against the tasks, the decisions and the controls: a decision provisioning storage for a deferred capability, a control guarding an entry point this iteration does not build, a task that grew past its label.

Done when every live task names the promise it serves or is named as unattributed, and every Out of scope line has been checked against the plan, the research and the threats.

### 4. Cross-check the four for contradictions

Take each class in **Conflict classes** below across all four documents. Both outcomes are recorded: a class that came out consistent is named as checked, so the file shows what was examined rather than only what failed.

Done when every class has been through all four documents with a named outcome, and every contradiction found names the two documents and the two identifiers that disagree.

### 5. Put every conflict to the user as a ruling

This skill's class in `PIPELINE.md` is **arbitration**. Each conflict is a choice between named sides, never a middle position you invented:

- keep the promise and accept the risk the control was closing;
- keep the control and amend or retire the promise;
- keep both and pay what the research says that costs — a different mechanism, a new dependency, another phase;
- move the capability out of this iteration.

The same block asks about any requirement with two readings that produce different tasks — the reading is the user's, and it is recorded as one.

Every ruling gets a `T-<n>` and exactly one destination:

| The side that gives | Where the ruling lands                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| the promise         | the `AC-<n>` is amended or retired in the PRD in the user's words, keeping its number                       |
| the control         | the `S-<n>`'s disposition in THREATS becomes `accepted <date>`, pointing at the `T-<n>`                     |
| the mechanism       | the work changes in FINAL, and the report names `/bldprj:research` when the change needs a new `D-<n>`      |
| the scope           | the capability leaves for `/bldprj:prd` or `/bldprj:refactor-prd`, named in the report and in Residual risk |

An amended criterion keeps its number and its `- [ ]` box, with the new wording in it. A retired one keeps its number too, in the form the rest of the pipeline reads as retired — `- [~] **AC-2** <the promise as it stood> — retired by T-1: <reason>` — so `docs:lint` stops holding phases to it and close-out shows the ruling instead of hunting for evidence.

More conflicts than two question blocks hold → rule on the ones that reshape the others, and end the run **blocked** with the rest listed. A rubber-stamped ruling is worse than an unanswered one.

Done when every conflict from step 4 carries its `T-<n>`, the user's words and its destination, and each ruling names the side that gave way.

### 6. Write the final plan

- **Path**: `docs/<slug>/<slug>-FINAL.md`, next to the plan, reusing its slug exactly. A re-run that must version (an `-MS.json` exists — **Versions** in `PIPELINE.md`) writes `docs/<slug>/<slug>-FINAL-v<N>.md` instead, and gives the version it replaces `**Status**: superseded by [<slug>-FINAL-v<N>.md](./<slug>-FINAL-v<N>.md)`.
- **Shape**: the template below — the plan's phase blocks, so `issues`, `build-phase` and `docs:lint` read FINAL exactly as they read a plan.

Three things make it the buildable document rather than a summary:

- **Numbers carry over.** Every task keeps the number `plan-phase` gave it. A task a ruling dropped stays as `- [~] **2.3** <label> — dropped in FINAL: <reason, T-<n>>`. New work approved in step 5 takes the next free number in its phase.
- **Startable alone.** Each task carries what a person needs to begin: the parameter values copied verbatim from the research table, the control from its finding, the file it touches — with `D-<n>` and `S-<n>` pointing back at the reasoning. A task that sends the reader to another file to learn what to build is not finished here.
- **Done when is hardened.** `plan-phase` wrote it before any mechanism existed; here it names the actual command, route, status code or spec, with the result it must give.

Done when every live task from the plan appears with its number, every phase carries its **Covers**, **Decisions** and **Threats** lines, every phase's **Done when** names a command or an observation with its expected result, the Trace table has a row per `AC-<n>`, and Checks has a line per conflict class.

### 7. Close the plan and open FINAL's place in the index

- The plan this run consolidated gains `**Status**: superseded by [<slug>-FINAL.md](./<slug>-FINAL.md)`. The preliminary cut stays as history, and nothing downstream reads it again.
- `docs/INDEX.md` — this feature's row: its `Final` segment links the file just written — the `Final —` placeholder on a first run, the previous version's link on a version bump (a row opened before this stage existed gains the segment).
- `npm run docs:lint`.

Done when the plan says what superseded it, every link in the feature's row resolves, and docs:lint is clean or its findings are named in the report.

### 8. Report

The verdict first — **ready** with the FINAL path, or **blocked** and on which conflicts. Then: one line per gap from steps 2–4 with what happened to it, one line per `T-<n>` with the side that gave way and what it costs, what stays unprotected, what was handed back to an earlier stage, and the next command: `/bldprj:issues docs/<slug>/<slug>-FINAL.md`.

## Conflict classes

Nine classes, each taken across all four documents.

1. **Numbers** — every limit, size, count, timeout and retention period in the PRD, in the research Parameters table and inside a control is the same value, or is a ruling. A control rejecting at 25 MB where `AC-2` promises 100 MB is a conflict, not a rounding.
2. **Mechanism against promise** — the chosen mechanism can actually produce the observable a criterion names. Storage that cannot list by owner will not serve a criterion about the owner's list.
3. **Control against scenario** — a control that changes what the user sees: an input the scenario accepts and the validator rejects, an extra step the scenarios do not have, an error where the PRD promised success.
4. **Missing work** — a decision or control that needs a migration, an env var, a characterization test, an install or a config change that no task carries. `research` and `security-analyse` each revised the plan for their own; work neither claimed surfaces here.
5. **Stale citations** — a `Held` disposition naming a task or file the revisions moved, a decision-map row pointing at a task that no longer exists, a `- [~]` task still cited by a `D-<n>` or `S-<n>`, an `AC-<n>` cited by nothing.
6. **Order** — a phase consuming what a later phase builds: a frontend phase before the API it calls, a task using an env var a later task adds, a control landing after the entry point it guards.
7. **Phase integrity** — the revisions left every phase still shippable: five live tasks at most, one layer, and a stop after it leaves the repo working.
8. **Unproven control** — an `S-<n>` whose **Proven by** test no task writes, or whose control lands in a task that never mentions it. `build-phase` checks a finding against the control its task carries; a control with no test is a control nobody notices losing.
9. **Silence** — a decision marked "not verified", a risk with no fallback, a finding with no disposition, a task whose description leaves the mechanism open. Each one reaches implementation as an invention.

## Template

```markdown
# Final plan: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Plan**: [<slug>-PLAN.md](./<slug>-PLAN.md)
**Research**: [<slug>-RESEARCH.md](./<slug>-RESEARCH.md)
**Threats**: [<slug>-THREATS.md](./<slug>-THREATS.md)
**Date**: <YYYY-MM-DD>
**Status**: ready for /bldprj:issues

## What ships

<5–10 lines in the user's terms: what they get, the limits they will meet, what was cut, and what a ruling changed. Enough to brief someone who has read none of the four documents.>

## Trace

| AC   | Phase | Tasks    | Decisions | Findings | Proven by                                |
| ---- | ----- | -------- | --------- | -------- | ---------------------------------------- |
| AC-1 | 1     | 1.2, 1.3 | D-1       | S-2      | `files.e2e-spec.ts` — upload returns 201 |

## Phase 1. <Name, 50 chars at most>

**Goal**: <what works after this phase that did not work before>
**Touches**: <api · web · database>
**Covers**: <AC-1, AC-3>
**Decisions**: <D-1, D-3>
**Threats**: <S-2>
**Tasks**:

- [ ] **1.1** <label, imperative, 60 chars at most> — <what must be true when it is done, the parameters it copies verbatim from the research, and the control it carries>

**Done when**: <the command or observation, with the result it must give — the API suite green, `POST /meetings/:id/files` returning 201>

## Checks

<One line per conflict class: the class, and either "consistent" with what was compared, or the `T-<n>` it produced.>

- Numbers — consistent: 25 MB in AC-2, in Parameters and in the S-3 control.
- Order — T-2: the web phase read an env var phase 3 adds.

## Rulings

| Id  | Conflict                              | Sides       | Ruling                          | Costs                                | Recorded in          |
| --- | ------------------------------------- | ----------- | ------------------------------- | ------------------------------------ | -------------------- |
| T-1 | 100 MB promised, 25 MB control chosen | AC-2 vs S-3 | keep the promise, raise the cap | disk spend per user is now unbounded | THREATS S-3 accepted |

## Deltas from the plan

- one line per change against the plan, with the `D-<n>`, `S-<n>` or `T-<n>` behind it — e.g. `added 2.4 (owner check on GET /files/:id) — S-1 had no task`.

## Residual risk

<What stays knowingly unprotected after the rulings, and every capability handed to /bldprj:prd or /bldprj:refactor-prd.>

## Asked & assumed

- **Asked** — <the conflict> → <the ruling the user made>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.
```

## Rules

- FINAL is what `issues` publishes and `build-phase` builds from; the plan behind it becomes history the moment step 7 marks it superseded.
- Task numbers are inherited, never reissued: `plan-phase` minted them, dropped tasks stay `- [~]`, and new work takes the next free number in its phase.
- Every conflict is ruled on by the user and written down with what it costs — including the ones where the ruling is to ship the requirement and carry the risk.
- This run consolidates; it does not decide the work. A missing mechanism belongs to `/bldprj:research`, a new finding to `/bldprj:security-analyse` — named in the report, not invented here.
- The only edits outside FINAL are the ones a ruling made: an `AC-<n>` the user amended in the PRD, a disposition the user accepted in THREATS, and the plan's superseded line.
- Every number in FINAL is copied verbatim from the PRD or the research Parameters table; a value that appears in neither is either a `T-<n>` or a mistake.
- A task is startable from FINAL alone. The reasoning stays in RESEARCH and THREATS, and the identifiers point at it.
