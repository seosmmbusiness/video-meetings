---
name: research
description: 'Settles the technical decisions a plan leaves open — built-in or library, storage, schema, limits, access rules, and on a refactor plan the measured optimisation path — into docs/<slug>/<slug>-RESEARCH.md. Use when a plan is ready and implementation would otherwise pick its mechanisms at random, or when another skill needs the research that milestone consumes.'
---

# Research

One pass covers a whole plan, not one task. It closes the plan's **one-way doors** — the choices that are expensive to undo once code exists — so implementation reads a decision instead of inventing one mid-task.

Research decides; it does not build. Feature code, `npm install`, `package.json`, the plan, the PRD and the GitHub issues stay as they are: this run writes the RESEARCH file, its link in root `CLAUDE.md`, and `sources.research` in the MS file.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `issues` → **`research`** → `milestone`.

## Argument

Path to a plan (`/research docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` and ask which one to research, rather than picking one.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../REFACTOR-TRACK.md`](../REFACTOR-TRACK.md) before step 1**: its `research` section adds the measurement pass and the optimisation order every decision below is then judged against.
- A `-RESEARCH.md` already sits next to that plan → ask whether to update it in place or start a new iteration. Never overwrite silently.

## Steps

### 1. Read the plan and its PRD

Every phase — **Goal**, **Touches**, **Tasks**, **Done when** — then the sibling `-PRD.md`: goal, In scope, **Out of scope**, technical constraints. Out of scope fences this run too.

Done when you can say, for every task in the plan, whether it hides a technical choice or follows straight from project convention.

### 2. Take the stack from the repo, not from memory

Read root `CLAUDE.md` and `README.md`, the `CLAUDE.md` of each app the plan touches, `.claude/modules/INDEX.md`, then the docs of the modules this feature extends or that already solve a close problem. Then the facts:

- `package.json` at the root and in each app touched — real framework versions and what is already installed; `npm ls <package>` for a transitive dependency you could use without installing anything.
- `.nvmrc` — the Node version, which decides which built-ins are available.
- `docker-compose.yml` and `.env.example` — the infrastructure that already runs and the env var names already taken.
- The code that already solves a nearby problem: how this repo does validation, config, errors, guards, tests. The decision should read as a continuation of that code.

Done when every version, module and env var you are about to put in the report came from a file you just read.

### 3. List the decision points

Walk the plan's tasks and keep only the places where a genuine choice exists and the wrong one is expensive to undo: built-in or library, where and in what format data is stored, schema, exchange protocol, module boundary, limits and validation, error strategy, test approach. A task whose answer follows from convention is not a decision point — the report is not a retelling of the plan.

Tag each decision point with the plan phases and tasks it serves.

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

Choices the repo cannot answer: which library when the trade-off is a product call, where data lives, what the limits are, anything paid or external, anything that would move the PRD's scope. One `AskUserQuestion` block, each option carrying a recommendation and the consequence of picking it. This is the cheap moment — the same question during implementation costs a rewrite.

Skip whatever the PRD, the plan or project convention already answers.

Done when no decision in the draft rests on a preference you invented, and every user answer is recorded in the report as agreed.

### 6. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-RESEARCH.md`, reusing the plan's slug exactly.
- **Date**: read from `date +%F` — the real date, not a remembered one.
- **Language**: English.
- **Shape**: the template below, one block per decision.

Done when every decision point from step 3 has a block, every number implementation needs sits in Parameters, and nothing in the file paraphrases the plan.

### 7. Wire the report into the pipeline

- Root `CLAUDE.md`, section `## Research reports` (create it above `## Status` when missing) — one line, feature name first:

  ```markdown
  - **Meeting file upload** — [docs/meeting-file-upload/meeting-file-upload-RESEARCH.md](docs/meeting-file-upload/meeting-file-upload-RESEARCH.md) — storage, limits and validation of uploaded files.
  ```

- `docs/<slug>/<slug>-MS.json`, when it exists — `sources.research` gets the report path, so `milestone` finds the decisions. Nothing else in that file changes.

Done when both pointers resolve to the file you just wrote and neither one repeats its content.

### 8. Report

The path, each decision as one line, the new dependencies (or "none"), what the user decided, what stays open, and the next command: `/milestone 1`.

## Template

```markdown
# Research: <Feature name>

**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Plan**: [<slug>-PLAN.md](./<slug>-PLAN.md)
**Milestones**: [<slug>-MS.json](./<slug>-MS.json)
**Date**: <YYYY-MM-DD>

## 1. TL;DR

<5–10 lines: what was chosen, what gets installed and what does not. Enough on its own to start Phase 1.>

## 2. Stack as found

<Actual versions, the existing modules and conventions being reused, and which plan tasks they already cover without new code.>

## 3. Decisions

### Decision 1. <The choice, written as a question>

- **Plan tasks**: <phase and tasks this serves>
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
```

## Rules

- One research pass per plan, not per task.
- Decisions, not implementation: code appears only as an illustrative fragment — an interface signature, an `.env` line, a response shape — never a finished module.
- Every decision names its plan tasks, and whatever the PRD put Out of scope stays out: research settles the plan, it does not grow the feature or rewrite it.
- The order is fixed: what the repo already has → what the platform ships → a new dependency.
- Concrete over qualitative — versions, paths, numbers, env var names. "Use a suitable library" is not a decision.
- Every fact is verified against a source and cited; whatever could not be checked is marked "not verified".
- The repo stays as it is: no feature code, no installs, no edits to `package.json`, the plan, the PRD or the issues.
- A gap in the plan or PRD that blocks a decision is a question for the user, asked before the report file exists.
