---
name: prd
description: 'Writes a feature PRD — goal, user scenarios, scope fence, falsifiable acceptance criteria — to docs/<feature>/<feature>-PRD.md. Use when a feature needs its requirements pinned down before planning or implementation, or when another skill needs the PRD that plan-phase consumes.'
---

# PRD

A PRD fixes **what** the user gets and **how you will know it is done**. The mechanism — libraries, schema, endpoints, file layout — is chosen later by `research`; a mechanism named here freezes a decision nobody has investigated yet.

Position in the pipeline: **`prd`** → `plan-phase` → `issues` → `research` → `milestone`.

## Argument

A feature name or description (`/prd meeting file upload`).

- No argument → ask which feature to write up, rather than inferring one from the repo state.
- `docs/<feature>/<feature>-PRD.md` already exists → ask whether to update it in place or start a new iteration. Never overwrite silently.

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

Product decisions only: who the actors are, what the user sees when the action fails, which limits are the user's (sizes, counts, retention), what stays out of this iteration. Put them in a single `AskUserQuestion` block, each option carrying a recommendation and the consequence of picking it.

Technical choices belong to `research`. Record one under Technical constraints only when the user states it as already fixed.

Skip whatever the repo, the argument, or project convention already answers.

Done when no requirement in the draft rests on an assumption you invented, and every user answer is reflected in the document.

### 4. Write the file

- **Slug**: the feature name in English kebab-case (`Загрузка файлов встречи` → `meeting-file-upload`). It names the folder, this file, and later the PLAN, RESEARCH and MS files — choose it once and reuse it.
- **Path**: `docs/<slug>/<slug>-PRD.md`, creating `docs/<slug>/` if it does not exist.
- **Date**: read from `date +%F` — the real date, not a remembered one.
- **Language**: English, whatever language the request came in.
- **Shape**: the template below, section for section.

Done when every section is filled, every scenario is covered by at least one acceptance criterion, and every criterion is falsifiable.

### 5. Report

The path, the goal in one line, the Out of scope list, every decision that came from a user answer, and the next command: `/plan-phase docs/<slug>/<slug>-PRD.md`.

## Template

```markdown
# PRD: <Feature name>

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

- [ ] <criterion>
- [ ] <criterion>
```

## Rules

- The PRD is the only input `plan-phase` gets — write it for someone who never saw this conversation.
- Numbers over adjectives: "up to 25 MB", "within 3 seconds", never "reasonably large" or "fast".
- Short and falsifiable beats long and aspirational: a sentence that cannot be proven wrong is not a requirement.
