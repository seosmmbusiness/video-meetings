---
name: security-analyse
description: 'Maps the attack surface a plan is about to build — entry points, who can reach them, and the control that closes each reachable finding — into docs/<slug>/<slug>-THREATS.md, revising the plan where a finding becomes work. Use when a plan and its research are ready, when a feature touches authentication, authorization, user input, files, personal data, payment or an external service, or when another skill needs the threats file that pre-issues and build-phase consume.'
---

# Security analysis

Every other stage reads the feature as its author. This one reads it as **whoever else can reach it**: the signed-out stranger, the signed-in stranger, and the user who owns the neighbouring row.

It runs on a plan whose mechanisms are already settled, so a finding lands as a task in a phase that has not been built yet — the cheapest place a control can be added. Findings are `S-1`, `S-2`, …, and each one names a **control**: the specific guard, validator, limit or scope that closes it, in the idiom this repo already uses.

Position in the pipeline: `prd` / `refactor-prd` → `plan-phase` → `research` → **`security-analyse`** → `pre-issues` → `issues` → `build-phase` → `close-feature`.

**Read [`../../PIPELINE.md`](../../PIPELINE.md) before step 1** — identity, versions, the question protocol and the document rules are defined there and are not repeated here.

This is the design-level pass. `/security-review` is the diff-level one that `build-phase` runs before a push; it reads the findings this run wrote and checks the code against them.

## Argument

Path to a plan (`/security-analyse docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` and ask which one to analyse, rather than picking one.
- No `-RESEARCH.md` next to the plan → say so and offer `/research` first: a control can only be named in the idiom of a mechanism that has been chosen.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `security-analyse` section decides the disposition of every finding against parity.

## Steps

### 1. Learn the controls this repo already has

Read the PRD (scenarios, Out of scope, the criteria — the one naming who may **not** reach the data above all), the plan (every phase and task), and the research (each `D-<n>` with its **Exposure** line). Then the code those controls live in — the JWT guard, the DTO validation and its global pipe, the session cookie, the rate limiter, how Prisma is called, how errors are shaped: `.claude/modules/INDEX.md` first, then `module-api-auth`, `module-web-auth` and the module this feature extends.

A control named in the abstract cannot be implemented; a control named as "the guard in `apps/api/src/auth/jwt-auth.guard.ts`, applied to the new controller" can.

Done when you can name, file by file, every existing control this feature will sit behind, and every place the research chose a mechanism that has one.

### 2. Map the surface

Three lists, taken from the plan rather than from imagination:

- **Assets** — what is worth reaching: stored rows and whose they are, file bytes, credentials and tokens, secrets, and the ability to spend disk, CPU, quota or money.
- **Entry points** — every place this plan adds or touches where something from outside arrives: HTTP routes and their DTOs, Server Actions, form fields, uploaded bytes and their filenames, query and path parameters, cookies and headers, callbacks from a third party, config read from env.
- **Trust boundaries** — where data crosses authorities: browser → `apps/web`, `apps/web` → `apps/api`, `apps/api` → Postgres, Redis or disk, `apps/api` → anything external.

Every entry point carries **who may reach it** — anonymous, any signed-in user, or the owner of the thing — and the assets it can touch, and the plan task that builds it.

Done when every plan task that accepts input or returns data sits under an entry point, and every entry point names its caller. Nothing on either list — the plan adds no input path and touches no user-owned data — → write the verdict form of the file in step 7 and stop there.

### 3. Walk every entry point through the checklist

Take each entry point through each class in the **Checklist** below. The outcome is recorded either way: a class that is already closed names the control that closes it, so the file shows what was examined rather than only what failed.

Done when every entry point has been through every class, with a named outcome for each.

### 4. Keep the reachable ones

**Reach is the filter.** A finding names three things: the **caller** who has it, the **input** that carries it, and the **asset** it ends at. Written that way it is a finding; written any other way it is a category, and categories belong to the checklist, not to the report.

Number what survives `S-1`, `S-2`, …, and tag each with the plan tasks it lands on, the `D-<n>` whose mechanism it concerns, and the `AC-<n>` it protects. Severity is what the caller ends up with — another user's data, an account, the disk, the process — weighed against how easily they get there.

Done when every finding states its caller, its input and its asset, and carries its number and its tags.

### 5. Give every finding a disposition

Exactly one of four, and the fourth is the user's:

- **Held** — an existing control or a task already in the plan closes it. Name the file or the task number; no new work.
- **Work** — the plan is missing the control. It becomes a task in the phase that owns the entry point, written into the plan in step 8.
- **Promise** — the control is something the user was never promised, so there is nothing for a test to hold. It needs an `AC-<n>` in the PRD.
- **Accepted** — the user takes the risk knowingly, with the date and their words recorded.

Done when no finding is left without a disposition, and every **Held** names the file or task that holds it.

### 6. Ask about the two that are the user's

This skill's class in `PIPELINE.md`: **Promise** and **Accepted**. Raising a control into an acceptance criterion is the recommended option wherever the asset is another person's data — it is what gives `build-phase` a test to write and close-out something to prove.

An approved **Promise** is appended to the PRD as the next free `AC-<n>`, leaving every existing criterion untouched, and noted in the PRD's **Asked & assumed**.

Done when every **Promise** and **Accepted** finding carries the user's answer, and the PRD holds the criteria they approved.

### 7. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-THREATS.md`, reusing the plan's slug exactly.
- **Shape**: the template below.

Section 2 is the **threat map** — phase, its tasks, the findings they carry. Like the research decision map, it is written on every run: `issues` renders it into issue bodies and applies the `security` label from it, and `build-phase` reads it to load a phase's findings.

A surface that came out empty in step 2 gets the verdict form: header, one paragraph naming what was examined and why nothing was reachable, and nothing else. The file still exists, because `issues` checks for it.

Done when every finding has a block with its control and the test that proves it, and every phase appears in the threat map.

### 8. Revise the plan, where a finding became work

Every **Work** finding is a task the plan is missing, and it is written the way `research` writes its own, following **Versions** in `PIPELINE.md`:

- Edit the plan in place, keeping every phase and task number intact. A new task takes the next free number in the phase that owns its entry point — controls land with the code they guard, never in a phase of their own at the end.
- Each affected phase gains `**Threats**: S-1, S-3`, so implementation reads the phase and the finding together.
- The `## Revisions` section gets one line per change, naming the finding that caused it: `2026-08-05 — added 2.4 (ownership check on GET /files/:id) — threats S-1.`

Anything larger belongs to the user: a new phase, a change of phase order, or a control that crosses the PRD's scope fence. Show it with the finding behind it and ask.

Done when either no finding became work and the report says so, or the plan carries every new task traced to an `S-<n>`, with every existing number preserved.

### 9. Report

`docs/INDEX.md` — replace this feature's `Threats —` placeholder with a link to the file.

Then: the path, one line per finding with its severity and disposition, what the user accepted or promised, whether the plan was revised and what moved in it, what stays open, and the next command: `/pre-issues docs/<slug>/<slug>-PLAN.md`.

## Checklist

Ten classes, each with what already holds it in this repo. An entry point is taken through all ten.

1. **Ownership** — a route that takes an id answers "whose is it?" before anything else. `apps/api`'s meetings module scopes every query to the caller; a new route that drops the scope hands one user another's row. The answer to a request for someone else's object is the same as for one that does not exist.
2. **Authentication** — which routes the JWT guard covers and which are deliberately public. A new controller is public until it says otherwise, and that is worth stating per route.
3. **Input** — every field arrives through a DTO with class-validator, bounded in size and count, unknown properties stripped. A value read straight off the request body is the finding.
4. **Injection and traversal** — Prisma parameterises what it builds; `$queryRaw` does not. A filename or id from the user never becomes a path — the server picks the stored name, `node:path` resolves it, and the result is checked to still sit under the storage root. A URL from the user that the server fetches is the same class.
5. **Spend** — what one caller can consume before anything stops them: body and file size, upload count, page size, an unbounded loop, a query without a limit. `apps/api` already rate-limits auth, and the same treatment fits any expensive route.
6. **Exposure** — the fields that leave: password hashes, tokens, internal ids, storage paths, another user's email. In `apps/web`, everything a Server Component hands to a client component ships to the browser as markup, whether it is rendered or not.
7. **Secrets** — env vars stay server-side (`NEXT_PUBLIC_` is publication), and tokens, passwords and connection strings stay out of logs, error messages and API responses.
8. **Session and browser** — the `httpOnly` session cookie's flags and lifetime, what a Server Action accepts and from whom, the `CORS_ORIGIN` the API allows, and any redirect target taken from input.
9. **Storage and dependencies** — where bytes land and with what permissions, Redis holding nothing that must be true (it is best-effort infra by project rule, so a control that depends on it is not a control), and `npm audit` on anything the research added.
10. **Errors and timing** — the same failure looks the same from outside: a wrong email and a wrong password answer identically, and an object the caller may not see is missing rather than forbidden.

## Template

```markdown
# Threats: <Feature name>

**Key**: <MFU>
**PRD**: [<slug>-PRD.md](./<slug>-PRD.md)
**Plan**: [<slug>-PLAN.md](./<slug>-PLAN.md)
**Research**: [<slug>-RESEARCH.md](./<slug>-RESEARCH.md)
**Date**: <YYYY-MM-DD>

## 1. Verdict

<What the surface is, and what the findings amount to. An empty surface ends the file here: what was examined, and why nothing outside can reach it.>

## 2. Threat map

| Phase | Tasks    | Findings |
| ----- | -------- | -------- |
| 1     | 1.1, 1.2 | S-1, S-2 |
| 2     | 2.1      | —        |

## 3. Surface

**Assets**: <one line each — what it is, whose it is>

| Entry point                | Who may reach it     | Assets it touches   | Task |
| -------------------------- | -------------------- | ------------------- | ---- |
| `POST /meetings/:id/files` | any signed-in caller | the meeting's files | 1.3  |

**Trust boundaries**: <browser → apps/web → apps/api → Postgres · disk>

## 4. Findings

### S-1. <caller → input → asset, in one line>

- **Reach**: <who has it, what they send, where it ends>
- **Plan tasks**: <1.3> · **Decisions**: <D-2> · **Criteria**: <AC-4>
- **Impact**: <what the caller ends up with>
- **Severity**: <high · medium · low, and what makes it that>
- **Control**: <the guard, validator, limit or scope that closes it, and the file it lives in>
- **Proven by**: <the test that fails without the control>
- **Disposition**: <held by … · work: task 2.4 · promise: AC-7 · accepted 2026-08-05 by the user>

## 5. Plan impact

<"None — no finding became work." Or one line per new task written into the plan, with the finding behind it.>

## Asked & assumed

- **Asked** — <the question> → <what the user chose>.
- **Assumed** — <what was taken as given> · <what changes if it is wrong>.
```

## Rules

- **Reach is the filter**: caller, input, asset. A class with no reachable path is recorded as examined and held, not raised as a finding.
- Controls are named where they will live — a file, a guard, a decorator, a limit from the research Parameters table — so a task can be written from one.
- Findings land in the phase that builds their entry point, so the control ships with the code it guards.
- This run writes documents. Feature code, installs and `package.json` stay as they are, and the only edit outside its own file is the plan revision in step 8 and an acceptance criterion the user approved.
- Whatever the PRD put Out of scope stays out: a finding in code this plan does not touch is recorded and handed to `/refactor-prd` as a security driver.
- An accepted risk is written down with its date and the user's words — an accepted finding stays visible in the file rather than disappearing from it.
- `S-<n>` numbers are permanent: `pre-issues` rules on them, `issues` labels from them, `build-phase` checks the code against them, and `/security-review` reads them.
- A finding the user later trades away is not deleted: `pre-issues` writes the accepted disposition onto it, with the ruling that bought it.
