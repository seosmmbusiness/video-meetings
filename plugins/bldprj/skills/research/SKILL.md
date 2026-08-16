---
name: research
description: 'Settles the technical decisions a plan leaves open — built-in or library, storage, schema, limits, access rules, and on a refactor plan the measured optimisation path — into docs/<slug>/<slug>-RESEARCH.md, revising the plan when a decision changes the work. Use when a plan is ready and implementation would otherwise pick its mechanisms at random, or when another skill needs the research that security-analyse, pre-issues and build-phase consume.'
---

# Research

One pass covers a whole plan, not one task. It closes the plan's **one-way doors** — the choices that are expensive to undo once code exists — so implementation reads a decision instead of inventing one mid-task.

Research decides; it does not build. Feature code, `npm install` and `package.json` stay as they are: this run writes the RESEARCH file, its link in `docs/INDEX.md`, and — only where a decision genuinely changes the work — a revision of the plan.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → **`research`** → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature`. It runs while the plan is still **preliminary**, so a decision that reshapes a task costs an edit to that plan rather than a round of edits to published issues.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

## Argument

Path to a plan (`/bldprj:research docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` and ask which one to research, rather than picking one.
- A `-RESEARCH.md` already sits beside the plan and a `-THREATS.md` beside it is newer → this is a **revision pass**, per **Re-running a stage** in `PIPELINE.md`. It is detected, not asked for, and it changes only what the **Revision triggers** below fire on. A `-RESEARCH.md` with no threats file beside it is an unfinished first pass: finish it as one.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `research` section adds the measurement pass and the optimisation order every decision below is then judged against.

## Steps

### 1. Read the plan and its PRD

Every phase — **Goal**, **Touches**, **Covers**, **Tasks** with their numbers, **Done when** — then the sibling `-PRD.md`: key, goal, In scope, **Out of scope**, technical constraints, the `AC-<n>` criteria. Out of scope fences this run too.

**On a revision pass**, read backwards first, before the plan: this file's own previous version — every `D-<n>` with what it chose and why — then `-THREATS.md` whole, every `S-<n>` with its control, its **Proven by** and its disposition, then the plan's `## Revisions` for what the threat pass already wrote into it. What that pass settled on its own is settled; you are looking only for the places it could not.

Done when you can say, for every task number in the plan, whether it hides a technical choice or follows straight from project convention — and on a revision pass, for every `S-<n>`, whether the mechanism this file already chose can carry its control.

### 2. Take the stack from the repo, not from memory

Read the project's root docs, the docs of each part the plan touches, and its module docs where it keeps them — then the modules this feature extends or that already solve a close problem. Then the facts:

- The manifest and lock file of each part touched (e.g. `package.json`) — real framework versions and what is already installed, including a transitive dependency you could use without installing anything (e.g. `npm ls <package>`).
- The runtime pin (e.g. `.nvmrc`) — which platform version, and so which built-ins, are available.
- The infrastructure that already runs and the env var names already taken (e.g. a compose file, `.env.example`).
- The code that already solves a nearby problem: how this repo does validation, config, errors, guards, tests. The decision should read as a continuation of that code.

Done when every version, module and env var you are about to put in the report came from a file you just read.

### 3. List the decision points

Walk the plan's tasks and keep only the places where a genuine choice exists and the wrong one is expensive to undo: built-in or library, where and in what format data is stored, schema, exchange protocol, module boundary, limits and validation, error strategy, test approach. A task whose answer follows from convention is not a decision point — the report is not a retelling of the plan.

Number them `D-1`, `D-2`, … and tag each with the plan tasks it serves (`1.2`, `3.1`). Those numbers are permanent: the plan cites them per phase and `build-phase` reads them per task.

**On a revision pass this step is the trigger list, not the plan.** Walk the **Revision triggers** below against the threats file instead of re-deriving the decision points: what fires becomes this round's work, and every existing `D-<n>` nothing fires on is finished — it is not re-argued, re-worded or re-taken under a new number. No trigger fires at all → skip to step 6 and write the converged form.

Done when every decision point traces to at least one plan task, and every task a developer could implement two materially different ways is covered by one — or, on a revision pass, when every `S-<n>` has been through every trigger with a named outcome.

### 4. Settle each decision, in this order

1. **Already in the repo** — an existing module, service, utility or convention to extend. Best outcome, and the project's module-docs index is where you look first.
2. **Already on the platform** — what the runtime and the project's frameworks ship (e.g. Node built-ins such as `node:crypto`, `node:fs/promises`, `node:stream`; what the API or web framework bundles), or an installed transitive dependency.
3. **A new dependency** — only where 1 and 2 leave the task unsolved. Per candidate: current version and last release date, compatibility with the runtime and framework versions from step 2, license, dependency weight, type definitions where the language needs them, maintenance, and the cost of dropping it later.

The **dependency budget** is flat: the count of third-party libraries should not visibly grow. Each new one carries its justification and an answer to "what happens without it" — and when a reasonable amount of our own code replaces it, that is the answer.

Versions, APIs and limits are **verified, not remembered**: the package registry (e.g. `npm view <package> version time.modified`), the official docs, the repository. Cite the source; write "not verified" for anything you could not check.

Each decision also gets:

- **Exposure** — what this mechanism hands an attacker: injection, path traversal, authorization bypass, leaking other people's data or the fact it exists, DoS by size, count or time, secrets in logs and API responses. One option is rejected over another here; the feature-wide pass belongs to `security-analyse`, which reads these blocks.
- **Replaceability** — an interface plus configuration, so swapping the implementation later leaves calling code untouched.
- **Testability** — how it is proven in this repo's style, as its docs prescribe per layer (e.g. test-first on the API, e2e specs on the web app).

Done when every decision point from step 3 has a named winner, its rejected alternatives, and a source behind every version and limit claimed.

### 5. Ask what only the user can decide

This skill's class in `PIPELINE.md`: which library when the trade-off is a product call, where data lives, what the limits are, anything paid or external, anything that would move the PRD's scope. **Every new dependency is a question** — the budget is the user's, not yours. This is the cheap moment: the same question during implementation costs a rewrite.

**On a revision pass, ask only what this round opened**: the security finding is what changed, so the question is what it costs to close — a new dependency the control needs, a limit the control puts below what the PRD promised, a mechanism swap that moves the scope. A question the first pass already answered is not re-asked; its answer is in **Asked & assumed**.

Done when no decision in the draft rests on a preference you invented, and every user answer is recorded in the report as agreed.

### 6. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-RESEARCH.md`, reusing the plan's slug exactly.
- **Shape**: the template below, one block per decision.

Section 2 is the **decision map** — phase, its tasks, and the decisions those tasks carry. It is written on every run, whether or not the plan is revised: `issues` renders it into issue bodies and `build-phase` reads it to load a phase's decisions, so a decision that reaches neither is a decision implementation will not see.

**On a revision pass the file is edited, not rewritten.** Only the blocks a trigger fired on move; every other byte stays as it was. A decision this round reverses keeps its `### D-3.` heading and gains `**Superseded by**: D-7 — <reason>, round <N>` as the block's first line, and the replacement takes the next free number. Each change gets a line in `## Revisions` citing the `S-<n>` behind it, and the decision map and Parameters are updated only where those blocks moved. Nothing fired → the whole edit is one `## Revisions` line: `<date> — round <N>: no change; re-read S-1…S-4 against D-1…D-5.`

Done when every decision point from step 3 has a block, every phase appears in the decision map, every number implementation needs sits in Parameters, and nothing in the file paraphrases the plan — or, on a revision pass, when the diff against the previous version contains only what a trigger produced.

### 7. Revise the plan, only where a decision changed the work

Most decisions leave the plan exactly as it is — that is the expected outcome, and section 9 of the report says so in one line. A revision is warranted only when a decision makes the plan **wrong**, in one of four ways:

- work the plan is missing (a migration, an env var, a characterization test the chosen mechanism needs);
- a task the decision makes unnecessary (an existing module already does it);
- a task that has to split, because one line now covers two mechanisms;
- a phase's **Verified by** the decision has outdated — the chosen mechanism needs a different command, config or spec file to be proven than the plan assumed. The workflow itself is still the project's, quoted from its docs; only what it takes to run it moves here.

Those four are yours to write, inside the existing phases, following **Versions** in `PIPELINE.md`. Each affected phase also gains `**Decisions**: D-2, D-4`, so implementation reads the phase and the decision together, and each `## Revisions` line names the decision that caused it.

Anything larger is **not yours to write**: a change of phase order, a new phase, a phase that swaps layers, or work that crosses the PRD's scope fence. Show it to the user with the decision behind it and ask — it is often a PRD change wearing a plan's clothes.

**A task a `S-<n>` put there is not yours to drop.** On a revision pass the plan already carries tasks `security-analyse` wrote, and a control is retired only by the finding's owner: where a decision makes one unnecessary, say so in section 9 and hand it back — the next `/bldprj:security-analyse` round retires it against its finding.

Done when either the plan is untouched and the report says why, or it carries the revision with every task number preserved and every change traced to a decision.

### 8. Add the report to the index

`docs/INDEX.md` — this feature's row already exists, opened by its PRD. Replace its `Research —` placeholder with a link to the file this run wrote.

Done when the row's links all resolve and the feature still has exactly one row.

### 9. Report

The path, each decision as one line with its id, the new dependencies (or "none"), what the user decided, whether the plan was revised and what moved in it, what stays open, and the next command: `/bldprj:security-analyse docs/<slug>/<slug>-PLAN.md`.

A revision pass reports its round instead: which triggers fired and which `S-<n>` fired them, every decision superseded with its replacement, every finding handed back for its own stage to retire, and then the next command by outcome —

- **Converged** — nothing fired: say exactly that. The mechanisms hold every control the threat pass named, the round changed nothing, and the work is ready for `/bldprj:pre-issues docs/<slug>/<slug>-PLAN.md`.
- **Revised** — a decision moved, so the surface may have moved with it: `/bldprj:security-analyse docs/<slug>/<slug>-PLAN.md` for the round that checks it, naming what it should re-check.
- **Past the budget** — round 3 or later, run by hand: report it as any other revision pass, then say the budget is past and name the conflict `/bldprj:pre-issues` would settle more cheaply, and why.

## Revision triggers

What a threat pass can legitimately reopen in this file. Five, and the list is closed: an `S-<n>` that fires none of them is a finding the chosen mechanisms already carry, and it changes nothing here.

1. **The mechanism cannot carry the control.** The finding's control is not implementable on what `D-<n>` chose — storage that cannot scope by owner under a control that must, a format that cannot be validated before it is parsed. The decision reopens, and the alternative it rejected is re-costed against the control rather than re-argued from scratch.
2. **The control needs a parameter this file does not have.** A threshold, a timeout, an allowed-format list, a retention window the control's threshold cites. It is a row in **Parameters**, verified and sourced like any other — no new `D-<n>`, because nothing was chosen.
3. **The control needs a mechanism nobody chose.** A rate limiter, a content sniffer, a signer, a scanner: work with a real build-or-install choice behind it, which no existing `D-<n>` covers. That is a new `D-<n>`, taken through step 4's order and step 5's question like any other.
4. **An accepted risk changed the arithmetic.** The user accepted a finding, and the mechanism was chosen partly to close it — the cheaper rejected alternative is now the better one. The decision reopens, citing the acceptance and its date.
5. **An `Exposure` line turned out wrong.** The threat pass proved a `D-<n>`'s exposure incomplete or mistaken. Correct that line and nothing else: the choice stands, only what it was known to hand an attacker changes.

A finding whose control fits the mechanism as chosen, a finding disposed of as **Held**, and a finding whose task the plan already carries are all **no change** — they are what a converged round is made of.

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

- **Superseded by**: <only on a reversed decision — D-7 — the reason, round 2. The block below stays as it was written.>
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

<New modules and their boundaries, existing modules touched, and the docs implementation will update: the project's module docs, CLAUDE.md, README.md, env samples.>

## 8. Risks and open questions

<What could fail and the fallback for it. Only questions that leave the start unblocked — blocking ones were answered in step 5.>

## 9. Plan impact

<"None — the plan stands as written." Or one line per change made to it with the decision behind it, and anything sent back to the user instead of being revised.>

## Asked & assumed

- **Asked** — <the question> → <what the user chose>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.

## Revisions

<Empty on the first pass. One line per revision round: what moved and the S-<n> behind it, or that nothing did.>

- 2026-08-07 — round 2: no change; re-read S-1…S-4 against D-1…D-5.
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
- A revision pass changes only what a **Revision trigger** fired on. A settled `D-<n>` is not re-argued, re-worded or re-taken under a new number, and a reversed one keeps its heading and gains `**Superseded by**`. Changing nothing is the expected outcome and is reported as one.
