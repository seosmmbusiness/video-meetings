---
name: plan-phase
description: 'Splits a PRD — feature or refactor — into ordered implementation phases with goal, layer, tasks and done-when, saved next to it as docs/<slug>/<slug>-PLAN.md. Use when a PRD is ready and the work needs breaking into phases, or when another skill needs the plan that issues, research and milestone consume.'
---

# Plan

A plan turns one PRD into ordered **phases**. Each phase leaves the repo working and verified: stop after any phase and what shipped so far is usable.

Position in the pipeline: `prd` / `refactor-prd` → **`plan-phase`** → `issues` → `research` → `milestone`.

## Argument

Path to a PRD (`/plan-phase docs/meeting-file-upload/meeting-file-upload-PRD.md`).

- No argument → list the PRDs under `docs/*/*-PRD.md` and ask which one to plan, rather than picking one.
- A `-REFACTOR-PRD.md` path → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `plan-phase` section replaces the tracer bullet and the layer rule below, and names the file this run writes.
- A `-PLAN.md` already sits next to that PRD → ask whether to update it in place or start a new iteration. Never overwrite silently.

## Steps

### 1. Read the PRD whole

Goal, every scenario, In scope, Out of scope, technical constraints, every acceptance criterion. The acceptance criteria are the plan's target: the phases exist to make them true, item for item.

Done when you can say, for each acceptance criterion, what has to exist for it to hold.

### 2. Ground the phases in the repo

Read root `CLAUDE.md` and `README.md`, the `CLAUDE.md` of each app the PRD touches, `.claude/modules/INDEX.md`, then the docs of the modules this feature extends. What already exists shortens phases, and the project's workflow shapes them: `apps/api` is written test-first and phases land green, `apps/web` is verified with Playwright e2e.

Done when you can name, for every phase you are about to write, the existing module it extends or the new one it creates.

### 3. Cut the phases

Apply the phasing rules below to the acceptance criteria from step 1, in order, starting from the tracer bullet.

Done when every acceptance criterion in the PRD is covered by at least one phase, no phase carries more than five tasks, and each phase's **Done when** is something a person can run or observe.

### 4. Ask what the PRD leaves open

Only where the gap blocks phasing: an acceptance criterion nothing in the plan can satisfy as written, a scenario whose actor or outcome is missing, two readings of the scope that give different phase orders. One `AskUserQuestion` block, each option carrying a recommendation and its consequence.

A gap in _mechanism_ is not a gap here — the library, schema and storage are `research`'s to decide later.

Done when no phase rests on a requirement you invented.

### 5. Write the file

- **Path**: next to its PRD, `docs/<slug>/<slug>-PLAN.md`, reusing the PRD's slug exactly.
- **Date**: read from `date +%F` — the real date, not a remembered one.
- **Language**: English.
- **Shape**: the template below, one block per phase.

Done when every phase block carries all four fields and every PRD acceptance criterion appears under at least one phase.

### 6. Report

The path, each phase as one line with its layer, whatever the PRD left open, and the next command: `/issues docs/<slug>/<slug>-PLAN.md`.

## Phasing rules

- **Phase 1 is a tracer bullet**: the thinnest slice that proves the path works, one scenario carried through its layer end to end.
- Every phase leaves the repo working and verified — a stop after any phase is a usable stop.
- Five tasks per phase at most; a sixth task is the signal to split the phase in two.
- One layer per phase: `apps/api` phases run first and go green, the `apps/web` phase consuming them comes after.
- Every task traces to a PRD acceptance criterion or scenario, and whatever the PRD put Out of scope stays out of the plan.
- Phases name outcomes, not mechanisms — "store the uploaded file and return its id", not "store it with library X".
- A phase's **Done when** is a command or an observation: `npm run test:api` green, `POST /meetings/:id/files` returning 201, a Playwright spec passing.
- Docs move with the code: the phase that changes a module updates that module's doc, JSDoc and Swagger annotations. There is no trailing documentation phase.
- Tasks are imperative and self-contained — `issues` turns each one into a GitHub issue title, read without its phase heading.

## Template

```markdown
# Plan: <Feature name>

**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Date**: <YYYY-MM-DD>

## Phase 1. <Name — the tracer bullet>

**Goal**: <what works after this phase that did not work before>
**Touches**: <apps/api · apps/web · database>
**Tasks**:

- [ ] <imperative, self-contained task>
- [ ] <five per phase at most>

**Done when**: <the command or observation that proves the phase is finished>

## Phase 2. <Name>

...
```
