---
name: research
description: 'Settles the technical decisions a plan leaves open — built-in or library, storage, schema, limits, access rules, and on a refactor plan the measured optimisation path — into docs/<slug>/<slug>-RESEARCH.md, revising the plan when a decision changes the work. Use when a plan is ready and implementation would otherwise pick its mechanisms at random, or when another skill needs the research that issues and build-phase consume.'
---

# Research

One pass covers a whole plan, not one task. It closes the plan's **one-way doors** — the choices that are expensive to undo once code exists — so implementation reads a decision instead of inventing one mid-task.

Research decides; it does not build. Feature code, `npm install` and `package.json` stay as they are: this run writes the RESEARCH file, its line in `docs/INDEX.md`, and — only where a decision genuinely changes the work — the next version of the plan.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → **`research`** → `issues` → `build-phase`. It runs **before** the backlog exists, so a decision that reshapes a task costs a plan revision rather than a round of edits to published issues.

## Argument

Path to a plan (`/research docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN*.md` and ask which one to research, rather than picking one.
- Several versions of the same plan → take the current one per **Plan versions** in [`../plan-phase/SKILL.md`](../plan-phase/SKILL.md), and say which file you took.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `research` section adds the measurement pass and the optimisation order every decision below is then judged against.
- A `-RESEARCH.md` already sits next to that plan → ask whether to update it in place or start a new iteration. Never overwrite silently.

## Steps

### 1. Read the plan and its PRD

Every phase — **Goal**, **Touches**, **Covers**, **Tasks** with their numbers, **Done when** — then the sibling `-PRD.md`: key, goal, In scope, **Out of scope**, technical constraints, the `AC-<n>` criteria. Out of scope fences this run too.

Done when you can say, for every task number in the plan, whether it hides a technical choice or follows straight from project convention.

### 2. Take the stack from the repo, not from memory

Read root `CLAUDE.md` and `README.md`, the `CLAUDE.md` of each app the plan touches, `.claude/modules/INDEX.md`, then the docs of the modules this feature extends or that already solve a close problem. Then the facts:

- `package.json` at the root and in each app touched — real framework versions and what is already installed; `npm ls <package>` for a transitive dependency you could use without installing anything.
- `.nvmrc` — the Node version, which decides which built-ins are available.
- `docker-compose.yml` and `.env.example` — the infrastructure that already runs and the env var names already taken.
- The code that already solves a nearby problem: how this repo does validation, config, errors, guards, tests. The decision should read as a continuation of that code.

Done when every version, module and env var you are about to put in the report came from a file you just read.

### 3. List the decision points

Walk the plan's tasks and keep only the places where a genuine choice exists and the wrong one is expensive to undo: built-in or library, where and in what format data is stored, schema, exchange protocol, module boundary, limits and validation, error strategy, test approach. A task whose answer follows from convention is not a decision point — the report is not a retelling of the plan.

Number them `D-1`, `D-2`, … and tag each with the plan tasks it serves (`1.2`, `3.1`). Those numbers are permanent: the plan cites them per phase and `build-phase` reads them per task.

Done when every decision point traces to at least one plan task, and every task a developer could implement two materially different ways is covered by one.

### 4. Settle each decision, in this order

1. **Already in the repo** — an existing module, service, utility or convention to extend. Best outcome, and `.claude/modules/INDEX.md` is where you look first.
2. **Already on the platform** — Node built-ins (`node:crypto`, `node:fs/promises`, `node:stream`, `node:path`, Web Crypto, `AbortSignal`), what NestJS or Next.js ships, an installed transitive dependency.
3. **A new dependency** — only where 1 and 2 leave the task unsolved. Per candidate: current version and last release date, compatibility with the Node and framework versions from step 2, license, dependency weight, TypeScript types, maintenance, and the cost of dropping it later.

The **dependency budget** is flat: the count of third-party libraries should not visibly grow. Each new one carries its justification and an answer to "what happens without it" — and when a reasonable amount of our own code replaces it, that is the answer.

Versions, APIs and limits are **verified, not remembered**: `npm view <package> version time.modified`, the official docs, the repository. Cite the source; write "not verified" for anything you could not check.

Each decision also gets:

- **Security** — what user input does here: injection, path traversal, authorization bypass, leaking other people's data or the fact it exists, DoS by size, count or time, secrets in logs and API responses.
- **Replaceability** — an interface plus configuration, so swapping the implementation later leaves calling code untouched.
- **Testability** — how it is proven in this repo's style: test-first for `apps/api`, Playwright e2e for `apps/web`.

Done when every decision point from step 3 has a named winner, its rejected alternatives, and a source behind every version and limit claimed.

### 5. Ask what only the user can decide

Choices the repo cannot answer: which library when the trade-off is a product call, where data lives, what the limits are, anything paid or external, anything that would move the PRD's scope. `AskUserQuestion`, each option carrying a recommendation and the consequence of picking it — at most four questions per block, four options each, further blocks for the rest, most consequential first. This is the cheap moment — the same question during implementation costs a rewrite.

Skip whatever the PRD, the plan or project convention already answers.

Done when no decision in the draft rests on a preference you invented, and every user answer is recorded in the report as agreed.

### 6. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-RESEARCH.md`, reusing the plan's slug exactly.
- **Date**: read from `date +%F` — the real date, not a remembered one.
- **Language**: English.
- **Shape**: the template below, one block per decision.

Done when every decision point from step 3 has a block, every number implementation needs sits in Parameters, and nothing in the file paraphrases the plan.

### 7. Revise the plan, only where a decision changed the work

Most decisions leave the plan exactly as it is — that is the expected outcome, and section 8 of the report says so in one line. A revision is warranted only when a decision makes the plan **wrong**, in one of three ways:

- work the plan is missing (a migration, an env var, a characterization test the chosen mechanism needs);
- a task the decision makes unnecessary (an existing module already does it);
- a task that has to split, because one line now covers two mechanisms.

Those three are yours to write, inside the existing phases, following **Plan versions** in [`../plan-phase/SKILL.md`](../plan-phase/SKILL.md):

- Write `docs/<slug>/<slug>-PLAN-v<N>.md`, carrying every phase and task forward with its number intact. New tasks take the next free number in their phase; dropped tasks stay as `- [~] **2.3** <label> — dropped in v<N>: <reason>`.
- Each affected phase gains `**Decisions**: D-2, D-4`, so implementation reads the phase and the decision together.
- The `## Revisions` section gets one line per change, naming the decision that caused it.
- The superseded version gains `**Status**: superseded by [<slug>-PLAN-v<N>.md](./<slug>-PLAN-v<N>.md)`, and this report's `**Plan**` header points at the version you just wrote.

Anything larger is **not yours to write**: a change of phase order, a new phase, a phase that swaps layers, or work that crosses the PRD's scope fence. Show it to the user with the decision behind it and ask — it is often a PRD change wearing a plan's clothes.

Done when either the plan is untouched and the report says why, or the new version exists with every task number preserved and every change traced to a decision.

### 8. Wire the report into the pipeline

`docs/INDEX.md` — the docs table of contents, created from the template below when missing. One row per feature: key, name, one line on what it is, and links to its PRD, current plan and this report. A row already there gets its links updated rather than a second row.

Root `CLAUDE.md` gets a single static pointer, added only when it is missing and never extended afterwards:

```markdown
Feature and refactor documents — PRD, plan, research — are indexed in [`docs/INDEX.md`](docs/INDEX.md).
```

Done when `docs/INDEX.md` has exactly one row for this feature, its links resolve, and root `CLAUDE.md` carries that one line and no per-feature links.

### 9. Report

The path, each decision as one line with its id, the new dependencies (or "none"), what the user decided, whether the plan was revised and into which file, what stays open, and the next command: `/issues docs/<slug>/<slug>-PLAN<-vN>.md`.

## Template

```markdown
# Research: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Plan**: [<slug>-PLAN.md](./<slug>-PLAN.md)
**Date**: <YYYY-MM-DD>

## 1. TL;DR

<5–10 lines: what was chosen, what gets installed and what does not. Enough on its own to start Phase 1.>

## 2. Stack as found

<Actual versions, the existing modules and conventions being reused, and which plan tasks they already cover without new code.>

## 3. Decisions

### D-1. <The choice, written as a question>

- **Plan tasks**: <1.2, 3.1>
- **Options**: <table — option · pros · cons · cost to adopt · risk>
- **Chosen**: <the option, with package version when it is a library>
- **Why**: <stack, project convention, security, dependency budget>
- **Rejected**: <one line per alternative>
- **Security**: <what is protected, and by what>
- **Fits in at**: <repo path, the interface it hides behind, what can be swapped later>
- **Sources**: <links>

## 4. Parameters and limits

<Table of values implementation copies verbatim: sizes, counts, timeouts, allowed formats and MIME types, env var names and defaults, schema changes, error codes.>

## 5. Dependencies

<Table — package · version · purpose · weight and license · why nothing already present does the job. None → "No new dependencies required.">

## 6. Architecture impact

<New modules and their boundaries, existing modules touched, and the docs implementation will update: `.claude/modules/`, CLAUDE.md, README.md, .env.example.>

## 7. Risks and open questions

<What could fail and the fallback for it. Only questions that leave the start unblocked — blocking ones were answered in step 5.>

## 8. Plan impact

<"None — the plan stands as written." Or the version written, one line per change with the decision behind it, and anything sent back to the user instead of being revised.>
```

`docs/INDEX.md`, created on the first research report:

```markdown
# Docs index

Feature and refactor documents, newest first. A feature keeps one row from its PRD until close-out moves its links into `docs/archive/`.

| Key | Feature             | What it is                                       | Documents                                                                                                                                                                         |
| --- | ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MFU | meeting-file-upload | Files uploaded, listed and deleted on a meeting. | [PRD](meeting-file-upload/meeting-file-upload-PRD.md) · [Plan](meeting-file-upload/meeting-file-upload-PLAN.md) · [Research](meeting-file-upload/meeting-file-upload-RESEARCH.md) |
```

## Rules

- One research pass per plan, not per task.
- Decisions, not implementation: code appears only as an illustrative fragment — an interface signature, an `.env` line, a response shape — never a finished module.
- Every decision names its plan tasks, and whatever the PRD put Out of scope stays out: research settles the plan, it does not grow the feature or rewrite it.
- The order is fixed: what the repo already has → what the platform ships → a new dependency.
- Concrete over qualitative — versions, paths, numbers, env var names. "Use a suitable library" is not a decision.
- Every fact is verified against a source and cited; whatever could not be checked is marked "not verified".
- The code stays as it is: no feature code, no installs, no edits to `package.json` or the PRD.
- The plan is revised only under step 7, only into a new version, and never by renumbering an existing task.
- A gap in the plan or PRD that blocks a decision is a question for the user, asked before the report file exists.
