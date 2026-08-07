---
name: plan-phase
description: 'Splits a PRD — feature or refactor — into ordered implementation phases with goal, layer, numbered tasks and done-when, saved next to it as the preliminary docs/<slug>/<slug>-PLAN.md. Use when a PRD is ready and the work needs breaking into phases, or when another skill needs the plan that research, security-analyse and pre-issues consume.'
---

# Plan

A plan turns one PRD into ordered **phases**. Each phase leaves the repo working and verified: stop after any phase and what shipped so far is usable.

This plan is **preliminary**, and deliberately so: it is cut before any mechanism is known, so a task names the outcome and leaves the library, the schema and the limits to `research`. `research` and `security-analyse` then revise it in place, and `pre-issues` consolidates all four documents into the buildable `docs/<slug>/<slug>-FINAL.md`. Nothing is published to GitHub from this file.

Position in the pipeline: `prd` / `refactor-prd` → **`plan-phase`** → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature`.

The plan is where the work gets its **identity**. Phase `1`, task `1.2` — those numbers become the issue title, the commit's issue reference, the phase branch and the row in the log. They are assigned here, once, and nothing downstream renumbers them.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

## Argument

Path to a PRD (`/bldprj:plan-phase docs/meeting-file-upload/meeting-file-upload-PRD.md`).

- No argument → list the PRDs under `docs/*/*-PRD.md` and ask which one to plan, rather than picking one.
- A `-REFACTOR-PRD.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `plan-phase` section replaces the tracer bullet and the layer rule below, and names the file this run writes.
- A plan already sits next to that PRD → **Versions** in `PIPELINE.md` decides whether this run edits it or a re-cut belongs to the user; a plan already marked superseded by a FINAL is a re-plan, so ask before replacing a cut the later stages have already built on.

## Steps

### 1. Read the PRD whole

Key, goal, every scenario, In scope, Out of scope, technical constraints, every acceptance criterion with its `AC-<n>`. The acceptance criteria are the plan's target: the phases exist to make them true, item for item.

Done when you can say, for each acceptance criterion, what has to exist for it to hold.

### 2. Ground the phases in the repo

Read root `CLAUDE.md` and `README.md`, the `CLAUDE.md` of each app the PRD touches, `.claude/modules/INDEX.md`, then the docs of the modules this feature extends. What already exists shortens phases, and the project's workflow shapes them: `apps/api` is written test-first and phases land green, `apps/web` is verified with Playwright e2e.

Done when you can name, for every phase you are about to write, the existing module it extends or the new one it creates.

### 3. Cut the phases

Apply the phasing rules below to the acceptance criteria from step 1, in order, starting from the tracer bullet.

Done when every acceptance criterion in the PRD is covered by at least one phase, no phase carries more than five tasks, and each phase's **Done when** is something a person can run or observe.

### 4. Put the cut to the user

The cut is this skill's class in `PIPELINE.md`, and more than one cut is usually defensible: a vertical slice first against a backend-first order, three fat phases against six thin ones, a phase that ships the UI unstyled against one that waits for it. Show the split you chose against at least one real alternative, each option carrying its recommendation and what it costs — `AskUserQuestion`'s `preview` field renders the competing phase lists side by side, which is what makes the choice readable.

Ask in the same round about anything that blocks phasing: an acceptance criterion nothing in the plan can satisfy as written, a scenario whose actor or outcome is missing, two readings of the scope that give different phase orders.

A gap in _mechanism_ is not a gap here — the library, schema and storage are `research`'s to decide later.

Done when the phase order is the user's, and no phase rests on a requirement you invented.

### 5. Write the file

- **Path**: next to its PRD, `docs/<slug>/<slug>-PLAN.md`, reusing the PRD's slug exactly.
- **Shape**: the template below, one block per phase.

Done when every phase block carries all five fields, every task has its number and its label, and every PRD acceptance criterion appears in at least one phase's **Covers**.

### 6. Add the plan to the index

`docs/INDEX.md` — this work's row, opened by its PRD: replace its `Plan —` placeholder with a link to the file this run wrote.

Done when the row's links all resolve and the work still has exactly one row.

### 7. Report

The path, each phase as one line with its layer and covered criteria, whatever the PRD left open, which parts of the cut are provisional until `research` settles their mechanism, and the next command: `/bldprj:research docs/<slug>/<slug>-PLAN.md`.

## Phasing rules

- **Phase 1 is a tracer bullet**: the thinnest slice that proves the path works, taken through the layer that owns it. The layer that consumes it follows in its own phase.
- Every phase leaves the repo working and verified — a stop after any phase is a usable stop.
- Five tasks per phase at most; a sixth task is the signal to split the phase in two.
- One layer per phase: `apps/api` phases run first and go green, the `apps/web` phase consuming them comes after.
- Every task traces to a PRD acceptance criterion, and whatever the PRD put Out of scope stays out of the plan. A phase's **Covers** lists the criteria its tasks serve.
- Phases name outcomes, not mechanisms — "store the uploaded file and return its id", not "store it with library X".
- A phase's name is short enough to read inside a milestone title: **50 characters at most**, the same discipline as a task's 60-character label — `issues` renders it as `<KEY> <phase> · <phase name>`.
- A phase's **Done when** is a command or an observation: `npm run test:api` green, `POST /meetings/:id/files` returning 201, a Playwright spec passing. Where the mechanism that would name it exactly is still `research`'s to choose, write the observation and leave the exact route, command or number to `pre-issues`, which hardens it in FINAL.
- Docs move with the code: the phase that changes a module updates that module's doc, JSDoc and Swagger annotations. There is no trailing documentation phase.

## Task lines

A task is three things in one line — **number**, **label**, **description**:

```markdown
- [ ] **1.2** Store uploads behind StorageService — a StorageService owns writing and reading
      file bytes; the meetings module calls it and never touches the filesystem itself.
```

- **Number** is `<phase>.<n>`, counted from 1 inside its phase. It is the task's identity for the rest of the pipeline.
- **Label** is what a person reads in a list: imperative, **60 characters at most**, no trailing period. `issues` renders it as the issue title — `MFU 1.2 — Store uploads behind StorageService` — so a label that needs its phase heading to make sense is too short, and a label that carries the whole acceptance criterion is too long.
- **Description** is everything the label had to drop: what has to be true when the task is done, the constraint it must respect, the file it touches. It becomes the issue body.

## Template

```markdown
# Plan: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Date**: <YYYY-MM-DD>
**Status**: preliminary

## Phase 1. <Name, 50 chars at most — the tracer bullet>

**Goal**: <what works after this phase that did not work before>
**Touches**: <apps/api · apps/web · database>
**Covers**: <AC-1, AC-3>
**Tasks**:

- [ ] **1.1** <label, imperative, 60 chars at most> — <what has to be true when it is done>
- [ ] **1.2** <five per phase at most>

**Done when**: <the command or observation that proves the phase is finished>

## Phase 2. <Name>

...

## Asked & assumed

- **Asked** — <the cut the user chose, and what it was chosen over>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.

## Revisions

<Written by the later stages — one line per change: what moved, and what caused it.>

- 2026-08-02 — added 1.6 (File model migration), dropped 2.3 (MIME sniffer) — research D-3.
```

A phase block gains two more fields once the later stages run: **Decisions** (`D-2, D-4`) when `research` revises the plan, and **Threats** (`S-1`) when `security-analyse` does. Both are written by their own skill, never invented here, and `pre-issues` carries them into FINAL.
