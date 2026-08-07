---
name: plan-phase
description: 'Splits a PRD — feature or refactor — into ordered implementation phases with goal, layer, numbered tasks and done-when, saved next to it as docs/<slug>/<slug>-PLAN.md. Use when a PRD is ready and the work needs breaking into phases, or when another skill needs the plan that research, issues and build-phase consume.'
---

# Plan

A plan turns one PRD into ordered **phases**. Each phase leaves the repo working and verified: stop after any phase and what shipped so far is usable.

Position in the pipeline: `prd` / `refactor-prd` → **`plan-phase`** → `research` → `issues` → `build-phase`.

The plan is where the work gets its **identity**. Phase `1`, task `1.2` — those numbers become the issue title, the commit's issue reference, the phase branch and the row in the log. They are assigned here, once, and nothing downstream renumbers them.

## Argument

Path to a PRD (`/plan-phase docs/meeting-file-upload/meeting-file-upload-PRD.md`).

- No argument → list the PRDs under `docs/*/*-PRD.md` and ask which one to plan, rather than picking one.
- A `-REFACTOR-PRD.md` path → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `plan-phase` section replaces the tracer bullet and the layer rule below, and names the file this run writes.
- A plan already sits next to that PRD → **Plan versions** below decides whether this run edits it or writes the next version. Never overwrite a version silently.

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

### 4. Ask what the PRD leaves open

Only where the gap blocks phasing: an acceptance criterion nothing in the plan can satisfy as written, a scenario whose actor or outcome is missing, two readings of the scope that give different phase orders. `AskUserQuestion`, each option carrying a recommendation and its consequence — at most four questions per block, four options each, further blocks for the rest.

A gap in _mechanism_ is not a gap here — the library, schema and storage are `research`'s to decide later.

Done when no phase rests on a requirement you invented.

### 5. Write the file

- **Path**: next to its PRD, `docs/<slug>/<slug>-PLAN.md`, reusing the PRD's slug exactly. A later version goes to `docs/<slug>/<slug>-PLAN-v<N>.md` — see **Plan versions**.
- **Date**: read from `date +%F` — the real date, not a remembered one.
- **Language**: English.
- **Shape**: the template below, one block per phase.

Done when every phase block carries all five fields, every task has its number and its label, and every PRD acceptance criterion appears in at least one phase's **Covers**.

### 6. Report

The path, each phase as one line with its layer and covered criteria, whatever the PRD left open, and the next command: `/research docs/<slug>/<slug>-PLAN.md`.

## Phasing rules

- **Phase 1 is a tracer bullet**: the thinnest slice that proves the path works, one scenario carried through its layer end to end.
- Every phase leaves the repo working and verified — a stop after any phase is a usable stop.
- Five tasks per phase at most; a sixth task is the signal to split the phase in two.
- One layer per phase: `apps/api` phases run first and go green, the `apps/web` phase consuming them comes after.
- Every task traces to a PRD acceptance criterion, and whatever the PRD put Out of scope stays out of the plan. A phase's **Covers** lists the criteria its tasks serve.
- Phases name outcomes, not mechanisms — "store the uploaded file and return its id", not "store it with library X".
- A phase's name is short enough to read inside a milestone title: **50 characters at most**, the same discipline as a task's 60-character label — `issues` renders it as `<KEY> <phase> · <phase name>`.
- A phase's **Done when** is a command or an observation: `npm run test:api` green, `POST /meetings/:id/files` returning 201, a Playwright spec passing.
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

Numbers are never reused and never renumbered. A task added later takes the next free number in its phase, even when it belongs first by logic; a task dropped stays in the file as `- [~] **2.3** <label> — dropped in v<N>: <reason>`, so its published issue still has a line to trace back to.

## Plan versions

The plan is written once and then only ever **superseded**, because `issues` has already turned it into a GitHub backlog and `build-phase` closes work against it.

- **No `-MS.json` next to it** → nothing downstream exists yet: edit the plan in place.
- **An `-MS.json` exists** → the backlog is live. Write the next version, `docs/<slug>/<slug>-PLAN-v<N>.md`, carrying every phase and task forward with its number intact, and add `**Status**: superseded by [<slug>-PLAN-v<N>.md](./<slug>-PLAN-v<N>.md)` to the version it replaces.
- **The current plan** is the highest-numbered version present; the unsuffixed `-PLAN.md` is version 1. `issues` records the exact file it published from in `sources.plan`, and `build-phase` reads that field rather than guessing.

A new version carries a `## Revisions` section — one line per change, with what moved and what caused it. `research` writes version 2 when its decisions change the work (see its own skill); a change of phase order or a new phase is a question for the user first, not a silent revision.

## Template

```markdown
# Plan: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Date**: <YYYY-MM-DD>

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

## Revisions

<Only in version 2 and later — one line per change: what moved, and what caused it.>

- 2026-08-02 — v2: added 1.6 (File model migration), dropped 2.3 (MIME sniffer) — research D-3.
```
