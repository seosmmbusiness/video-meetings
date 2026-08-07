---
name: research
description: 'Settles the technical decisions a plan leaves open — built-in or library, storage, schema, limits, access rules, and on a refactor plan the measured optimisation path — into docs/<slug>/<slug>-RESEARCH.md, revising the plan when a decision changes the work. Use when a plan is ready and implementation would otherwise pick its mechanisms at random, or when another skill needs the research that security-analyse, pre-issues and build-phase consume.'
---

# Research

One pass covers a whole plan, not one task. It closes the plan's **one-way doors** — the choices that are expensive to undo once code exists — so implementation reads a decision instead of inventing one mid-task.

Research decides; it does not build. Feature code, `npm install` and `package.json` stay as they are: this run writes the RESEARCH file, its link in `docs/INDEX.md`, and — only where a decision genuinely changes the work — a revision of the plan.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → **`research`** → `security-analyse` → `pre-issues` → `issues` → `build-phase`. It runs while the plan is still **preliminary**, so a decision that reshapes a task costs an edit to that plan rather than a round of edits to published issues.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

## Argument

Path to a plan (`/research docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN*.md` and ask which one to research, rather than picking one.
- Several versions of the same plan → take the current one and say which file you took.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `research` section adds the measurement pass and the optimisation order every decision below is then judged against.

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

- **Exposure** — what this mechanism hands an attacker: injection, path traversal, authorization bypass, leaking other people's data or the fact it exists, DoS by size, count or time, secrets in logs and API responses. One option is rejected over another here; the feature-wide pass belongs to `security-analyse`, which reads these blocks.
- **Replaceability** — an interface plus configuration, so swapping the implementation later leaves calling code untouched.
- **Testability** — how it is proven in this repo's style: test-first for `apps/api`, Playwright e2e for `apps/web`.

Done when every decision point from step 3 has a named winner, its rejected alternatives, and a source behind every version and limit claimed.

### 5. Ask what only the user can decide

This skill's class in `PIPELINE.md`: which library when the trade-off is a product call, where data lives, what the limits are, anything paid or external, anything that would move the PRD's scope. **Every new dependency is a question** — the budget is the user's, not yours. This is the cheap moment: the same question during implementation costs a rewrite.

Done when no decision in the draft rests on a preference you invented, and every user answer is recorded in the report as agreed.

### 6. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-RESEARCH.md`, reusing the plan's slug exactly.
- **Shape**: the template below, one block per decision.

Section 2 is the **decision map** — phase, its tasks, and the decisions those tasks carry. It is written on every run, whether or not the plan is revised: `issues` renders it into issue bodies and `build-phase` reads it to load a phase's decisions, so a decision that reaches neither is a decision implementation will not see.

Done when every decision point from step 3 has a block, every phase appears in the decision map, every number implementation needs sits in Parameters, and nothing in the file paraphrases the plan.

### 7. Revise the plan, only where a decision changed the work

Most decisions leave the plan exactly as it is — that is the expected outcome, and section 9 of the report says so in one line. A revision is warranted only when a decision makes the plan **wrong**, in one of three ways:

- work the plan is missing (a migration, an env var, a characterization test the chosen mechanism needs);
- a task the decision makes unnecessary (an existing module already does it);
- a task that has to split, because one line now covers two mechanisms.

Those three are yours to write, inside the existing phases, following **Versions** in `PIPELINE.md`. Each affected phase also gains `**Decisions**: D-2, D-4`, so implementation reads the phase and the decision together, and each `## Revisions` line names the decision that caused it.

Anything larger is **not yours to write**: a change of phase order, a new phase, a phase that swaps layers, or work that crosses the PRD's scope fence. Show it to the user with the decision behind it and ask — it is often a PRD change wearing a plan's clothes.

Done when either the plan is untouched and the report says why, or it carries the revision with every task number preserved and every change traced to a decision.

### 8. Add the report to the index

`docs/INDEX.md` — this feature's row already exists, opened by its PRD. Replace its `Research —` placeholder with a link to the file this run wrote.

Done when the row's links all resolve and the feature still has exactly one row.

### 9. Report

The path, each decision as one line with its id, the new dependencies (or "none"), what the user decided, whether the plan was revised and what moved in it, what stays open, and the next command: `/security-analyse docs/<slug>/<slug>-PLAN.md`.

## Template

```markdown
# Research: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Plan**: [<slug>-PLAN.md](./<slug>-PLAN.md)
**Date**: <YYYY-MM-DD>

## 1. TL;DR

<5–10 lines: what was chosen, what gets installed and what does not. Enough on its own to start Phase 1.>

## 2. Decision map

| Phase | Tasks         | Decisions |
| ----- | ------------- | --------- |
| 1     | 1.1, 1.2, 1.3 | D-1, D-3  |
| 2     | 2.1, 2.2      | D-2       |
| 3     | 3.1           | —         |

## 3. Stack as found

<Actual versions, the existing modules and conventions being reused, and which plan tasks they already cover without new code.>

## 4. Decisions

### D-1. <The choice, written as a question>

- **Plan tasks**: <1.2, 3.1>
- **Options**: <table — option · pros · cons · cost to adopt · risk>
- **Chosen**: <the option, with package version when it is a library>
- **Why**: <stack, project convention, security, dependency budget>
- **Rejected**: <one line per alternative>
- **Exposure**: <what this mechanism hands an attacker, and what holds it>
- **Fits in at**: <repo path, the interface it hides behind, what can be swapped later>
- **Sources**: <links>

## 5. Parameters and limits

<Table of values implementation copies verbatim: sizes, counts, timeouts, allowed formats and MIME types, env var names and defaults, schema changes, error codes.>

## 6. Dependencies

<Table — package · version · purpose · weight and license · why nothing already present does the job. None → "No new dependencies required.">

## 7. Architecture impact

<New modules and their boundaries, existing modules touched, and the docs implementation will update: `.claude/modules/`, CLAUDE.md, README.md, .env.example.>

## 8. Risks and open questions

<What could fail and the fallback for it. Only questions that leave the start unblocked — blocking ones were answered in step 5.>

## 9. Plan impact

<"None — the plan stands as written." Or one line per change made to it with the decision behind it, and anything sent back to the user instead of being revised.>

## Asked & assumed

- **Asked** — <the question> → <what the user chose>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.
```

## Rules

- One research pass per plan, not per task.
- Decisions, not implementation: code appears only as an illustrative fragment — an interface signature, an `.env` line, a response shape — never a finished module.
- Every decision names its plan tasks and reaches implementation through the decision map; whatever the PRD put Out of scope stays out.
- The order is fixed: what the repo already has → what the platform ships → a new dependency.
- Concrete over qualitative — versions, paths, numbers, env var names. "Use a suitable library" is not a decision.
- Every fact is verified against a source and cited; whatever could not be checked is marked "not verified".
- The code stays as it is: no feature code, no installs, no edits to `package.json` or the PRD.
- The plan is revised only under step 7, in place, and never by renumbering an existing task.
- A gap in the plan or PRD that blocks a decision is a question for the user, asked before the report file exists.
