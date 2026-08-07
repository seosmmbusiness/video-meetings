---
name: refactor-prd
description: 'Writes a refactor PRD — behaviour frozen at parity, measurable internal outcomes, the green baseline that proves both — to docs/<slug>/<slug>-REFACTOR-PRD.md. Use when existing code should get faster, safer, cleaner or brought back in line with its docs while behaving exactly as it does today, or when another skill needs the refactor PRD that plan-phase consumes.'
---

# Refactor PRD

A refactor PRD fixes **what stays identical** and **what gets better behind it**. Its subject is code that already works: the user is handed the same product afterwards, and the win lands in speed, security, structure or doc accuracy.

**Parity** is the whole discipline, and it is what makes this document different from a PRD: same inputs, same outputs, same errors, same screens, same public surface. Improvements that a user could notice belong to `/bldprj:prd` — this run finds them, and asks rather than absorbing them.

Position in the pipeline: **`refactor-prd`** → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature`.

**Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) and [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — parity and the test contract come from the first, identity and the question protocol from the second. Neither is repeated here.

## Argument

The refactor wish: what to work on and what it should buy (`/bldprj:refactor-prd speed up the meetings dashboard`, `/bldprj:refactor-prd harden apps/api auth`, `/bldprj:refactor-prd check apps/web auth against its module doc`).

- No argument → ask which code and which driver, rather than picking a target out of the repo state.
- A driver with no target ("optimise speed", "improve security") → ask which module, route or page, since a repo-wide refactor has no baseline anyone can hold green.

## Steps

### 1. Read the code that will change

A refactor PRD describes behaviour that already exists, so the source is the implementation and the docs are a second opinion:

1. Root `CLAUDE.md` — the Status section, for what this code is part of.
2. `CLAUDE.md` of each app the target sits in, then `.claude/modules/INDEX.md` and the doc of the target module only.
3. The implementation itself — every file the argument points at, plus its callers: what it exposes, what it returns, what it throws, what it stores.

Where doc and code disagree, that gap is a finding: a driver when the argument asks for doc compliance, a proposal for step 5 otherwise.

Done when you can state, file by file, what the target does today from the code you read, and can name every caller that would notice if it changed.

### 2. Take the green baseline

The suite that covers the target, run now, before any document exists:

```bash
npm run test:api          # apps/api
npm run test:e2e:web      # apps/web
npm run lint && npm run format:check
npm run build             # when the target is built output or config
```

Record the exact commands and their real output. Red before anything changed → report it and ask, rather than writing a plan on top of a broken baseline.

Then map the suite onto the target: which behaviour a test would catch a change in, and which behaviour nothing protects. The unprotected list is what `plan-phase` turns into characterization tests.

Done when the commands, their result today, and the behaviour they leave unprotected are all written down from output you actually saw.

### 3. Freeze the behaviour

The observable contract, one line each, phrased as what stays: endpoints with their status codes and response shapes, pages and their copy, error messages, env vars, database schema and stored data, exported functions and their signatures.

Done when every behaviour named in step 1 appears either in the freeze or among the drivers in step 4 — nothing observable is left unclassified.

### 4. Turn the wish into measurable outcomes

Per driver in the argument: the symptom in the code today, with the file and line, and an outcome with a number a person can take twice — response time, query count, bundle bytes, duplicated blocks, doc mismatches, findings closed.

A driver that resists numbers gets an observable instead: "no handler builds SQL by concatenation", "no route file over 200 lines". A driver that resists both is a wish, not an outcome — take it back to the user.

Done when every driver has its symptom in the code and an outcome that a measurement could prove false.

### 5. Ask before promoting anything into the work

Reading the target surfaces improvements — a missing validation, a clearer error, an index that changes result order, an endpoint that is obviously absent. Each one is a **proposal**, and its home is the user's call.

Ask, at minimum:

- Each proposal that would change behaviour → defer it to its own feature PRD (recommended: parity holds, and this refactor stays bisectable), or take it now knowing it needs its own tests and stops being a refactor.
- Behaviour left unprotected in step 2 → cover it with characterization tests in phase 1 (recommended), or accept the gap in writing and name what could break unnoticed.
- Any outcome number the code cannot supply — an acceptable latency, a size budget, how long the refactor may take the API offline if at all.

Done when every improvement you found sits in exactly one list — a driver, or Out of scope with its destination — and nothing moved into scope without the user saying so.

### 6. Write the file

- **Slug**: target plus driver, in English kebab-case (`ускорить дашборд встреч` → `meetings-dashboard-speed`). A target that already has a `docs/<slug>/` folder → reuse that folder; the `-REFACTOR-` infix keeps the two tracks apart.
- **Key**: reusing an existing `docs/<slug>/` folder → reuse the `**Key**` already on its `-PRD.md` or `-REFACTOR-PRD.md`, since it is the same feature. A brand-new slug mints one per `PIPELINE.md`'s Identity section.
- **Path**: `docs/<slug>/<slug>-REFACTOR-PRD.md`, creating `docs/<slug>/` if it does not exist.
- **Shape**: the template below, section for section.

Done when every section is filled, the key is fixed and either freshly unique or correctly reused, every freeze line and every outcome is covered by a numbered `AC-<n>`, and every criterion is falsifiable.

### 7. Open the refactor's row in the index

`docs/INDEX.md`, per the template in [`../prd/SKILL.md`](../prd/SKILL.md). A refactor of a feature that already has a row adds its documents to that row rather than opening a second one; a brand-new slug opens a row of its own. Root `CLAUDE.md`'s one-line pointer is added only when it is missing.

Done when this work has exactly one row in `docs/INDEX.md` and its link resolves.

### 8. Report

The path, the key, the target, one line per driver with its outcome, the baseline commands and their result today, the proposals the user deferred and where they went, and the next command: `/bldprj:plan-phase docs/<slug>/<slug>-REFACTOR-PRD.md`.

## Template

```markdown
# Refactor PRD: <Name>

**Key**: <MFU>
**Date**: <YYYY-MM-DD>
**Status**: draft
**Track**: refactor

## 1. Goal

<1–2 sentences: what improves inside, and for whom — the developer, the operator, the user's clock. The product on the other side is the same product.>

## 2. Target

<The code in scope, by path and module. One line each, with what it does today.>

- `apps/api/src/meetings/meetings.service.ts` — lists a caller's meetings, one query per meeting owner lookup.

## 3. Behaviour freeze

<The observable contract, phrased as what stays identical. Each line is something a test or a person could catch changing.>

- `GET /meetings` returns the same array, in the same order, with the same fields and the same 401 for a missing token.
- The dashboard shows the same upcoming/recent split, with the same empty-state copy.

## 4. Green baseline

| Command            | Covers                       | Result today    |
| ------------------ | ---------------------------- | --------------- |
| `npm run test:api` | <what it pins in the target> | <pass, N tests> |

**Unprotected**: <behaviour in the freeze that no test would catch changing — the characterization tests phase 1 has to add.>

## 5. Drivers and internal outcomes

| Driver | Symptom today (file:line)  | Outcome         | How it is measured |
| ------ | -------------------------- | --------------- | ------------------ |
| Speed  | <the measured cost, where> | <target number> | <the command>      |

## 6. Scope

**In scope**

- <the change this iteration makes>

**Out of scope**

- <deferred, with its reason and destination — e.g. "reject files over 25 MB: behaviour change, goes to its own feature PRD">

## 7. Acceptance criteria

<Falsifiable statements, numbered **AC-1**, **AC-2**, … exactly as in a feature PRD — the numbers are permanent: phases cite them in **Covers**, the linter holds the plan to them, and close-out proves them one by one. At least one per freeze line and one per outcome; each names the observation that would prove it wrong.>

- [ ] **AC-1** The full test suite passes with the same test count and no test file changed.
- [ ] **AC-2** The listing endpoint emits 2 queries per request, down from 1 + N, measured by query logging.

## Asked & assumed

- **Asked** — <the question> → <what the user chose>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.
```

## Rules

- The refactor PRD is the only input `plan-phase` gets — write it for someone who never saw this conversation.
- Parity is stated, not assumed: a behaviour absent from the freeze is a behaviour nobody promised to keep.
- Numbers over adjectives — "620 ms → under 200 ms at p95", never "noticeably faster".
- Every outcome is measured the same way twice: the method is written down in the PRD, so the after-number is comparable to the before-number.
- An improvement that changes behaviour is recorded and asked about, never folded in quietly.
- Mechanism stays with `research`: this document says the query count must drop, not which index or library drops it.
