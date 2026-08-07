---
name: prd
description: 'Writes a feature PRD — goal, user scenarios, scope fence, falsifiable acceptance criteria — to docs/<feature>/<feature>-PRD.md. Use when a feature needs its requirements pinned down before planning or implementation, or when another skill needs the PRD that plan-phase consumes.'
---

# PRD

A PRD fixes **what** the user gets and **how you will know it is done**. The mechanism — libraries, schema, endpoints, file layout — is chosen later by `research`; a mechanism named here freezes a decision nobody has investigated yet.

Position in the pipeline: **`prd`** → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature`.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, the question protocol and the document rules are defined there and are not repeated here.

## Argument

A feature name or description (`/bldprj:prd meeting file upload`).

- No argument → ask which feature to write up, rather than inferring one from the repo state.

## Steps

### 1. Ground the feature in the repo

Read, before drafting a line:

1. Root `CLAUDE.md` — the Status section above all: what already exists, so the PRD asks for the delta instead of for what is already built.
2. `README.md` — scripts, setup, available infrastructure.
3. `CLAUDE.md` of each app the feature touches (`apps/web`, `apps/api`).
4. `.claude/modules/INDEX.md`, then the docs of only those modules the feature extends.

Done when every statement you are about to make about current behaviour traces to a file you just read, and you can name the existing modules this feature builds on.

### 2. Cut the iteration

Slice the feature down to the smallest version that delivers its goal end to end for a real user. Everything else that came up — from the argument, from step 1, from your own ideas about the feature — goes into **Out of scope** in writing. That list is a fence: an exclusion left unwritten is scope creep with a head start.

Done when every capability raised sits in exactly one list, In scope or Out of scope.

### 3. Ask what the document cannot invent

Product decisions only — this skill's class in `PIPELINE.md`: who the actors are and what each may reach, what the user sees when the action fails, which limits are the user's (sizes, counts, retention), what stays out of this iteration.

Technical choices belong to `research`. Record one under Technical constraints only when the user states it as already fixed.

Done when no requirement in the draft rests on an assumption you invented, and every user answer is reflected in the document.

### 4. Name the feature

Mint the **slug** and the **Key** per `PIPELINE.md`'s Identity section — the slug in English kebab-case (`Загрузка файлов встречи` → `meeting-file-upload`), the Key checked against every PRD in `docs/` and `docs/archive/` on both tracks.

Done when the slug and the key are fixed, and the uniqueness check came back clean.

### 5. Write the file

- **Path**: `docs/<slug>/<slug>-PRD.md`, creating `docs/<slug>/` if it does not exist.
- **Shape**: the template below, section for section.

Acceptance criteria are numbered `AC-1`, `AC-2`, … and those numbers are permanent: `plan-phase` cites them per phase, `research` and `security-analyse` cite them per decision and finding, and close-out proves the shipped feature against them one by one.

Where the feature stores or shows one user's data, one criterion states who may **not** reach it — the negative case is what `security-analyse` and the authorization tests are held against.

Done when every section is filled, every scenario is covered by at least one acceptance criterion, and every criterion is falsifiable.

### 6. Open the feature's row in the index

`docs/INDEX.md` — the docs table of contents, created from the template below when missing. One row per feature: key, name, one line on what it is, and its documents. This run fills the PRD link and leaves the rest as `—`; `plan-phase`, `research`, `security-analyse` and `pre-issues` fill theirs when they run, and close-out moves them all into `docs/archive/`.

Root `CLAUDE.md` gets a single static pointer, added only when it is missing and never extended afterwards:

```markdown
Feature and refactor documents — PRD, plan, research, threats, final plan — are indexed in [`docs/INDEX.md`](docs/INDEX.md).
```

Done when `docs/INDEX.md` has exactly one row for this feature, its PRD link resolves, and root `CLAUDE.md` carries that one line and no per-feature links.

### 7. Report

The path, the key, the goal in one line, the Out of scope list, every decision that came from a user answer, and the next command: `/bldprj:plan-phase docs/<slug>/<slug>-PRD.md`.

## Template

```markdown
# PRD: <Feature name>

**Key**: <MFU>
**Date**: <YYYY-MM-DD>
**Status**: draft

## 1. Goal

<1–2 sentences: what the user needs and why — the value they end up with, not the mechanism that delivers it.>

## 2. User scenarios

<One line per scenario, **actor** → action → outcome. Cover the main path, plus every failure the user is shown.>

- Meeting owner → uploads a file on the meeting page → the file appears in that meeting's file list.
- Meeting owner → uploads a file of an unsupported type → the upload is rejected with a stated reason and the file list is unchanged.

## 3. Scope

**In scope**

- <capability shipping in this iteration>

**Out of scope**

- <capability deferred, with its reason in the same line — e.g. "no storage service of our own: files live on the server disk">

## 4. Technical constraints

<Fixed facts the implementation must live with: what the existing stack dictates, deployment limits, numbers the user gave. Facts, not decisions.>

## 5. Acceptance criteria

<Falsifiable statements — each names an observation that would prove it wrong. "Uploading a 30 MB file returns an error and stores nothing" is falsifiable; "upload works reliably" is not.>

- [ ] **AC-1** <criterion>
- [ ] **AC-2** <who may not reach this data, and what they get instead>

## Asked & assumed

- **Asked** — <the question> → <what the user chose>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.
```

`docs/INDEX.md`, created with the first PRD:

```markdown
# Docs index

Feature and refactor documents, newest first. A feature keeps one row from its PRD until close-out moves its links into `docs/archive/`.

| Key | Feature             | What it is                                       | Documents                                                                                         |
| --- | ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| MFU | meeting-file-upload | Files uploaded, listed and deleted on a meeting. | [PRD](meeting-file-upload/meeting-file-upload-PRD.md) · Plan — · Research — · Threats — · Final — |
```

## Rules

- The PRD is the only input `plan-phase` gets — write it for someone who never saw this conversation.
- Numbers over adjectives: "up to 25 MB", "within 3 seconds", never "reasonably large" or "fast".
- Short and falsifiable beats long and aspirational: a sentence that cannot be proven wrong is not a requirement.
- Access rules are requirements, not implementation: who may read, change and delete each thing belongs in the scenarios and the criteria.
