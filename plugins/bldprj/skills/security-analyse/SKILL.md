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

Path to a plan (`/bldprj:security-analyse docs/meeting-file-upload/meeting-file-upload-PLAN.md`).

- No argument → list the plans under `docs/*/*-PLAN.md` and ask which one to analyse, rather than picking one.
- No `-RESEARCH.md` next to the plan → say so and offer `/bldprj:research` first: a control can only be named in the idiom of a mechanism that has been chosen.
- A `-THREATS.md` already sits beside the plan and the `-RESEARCH.md` beside it is newer → this is a **revision pass**, per **Re-running a stage** in `PIPELINE.md`. It is detected, not asked for, and it changes only what the **Revision triggers** below fire on.
- A `-REFACTOR-PLAN.md` path → the refactor track. **Read [`../../REFACTOR-TRACK.md`](../../REFACTOR-TRACK.md) before step 1**: its `security-analyse` section decides the disposition of every finding against parity.

## Steps

### 1. Learn the controls this repo already has

Read the PRD (scenarios, Out of scope, the criteria — the one naming who may **not** reach the data above all), the plan (every phase and task), and the research (each `D-<n>` with its **Exposure** line). Then the code those controls live in — the auth guard, the input validation and where it is enforced, the session mechanism, the rate limiter, how the database layer is called, how errors are shaped: the project's module docs first (auth and the module this feature extends above all), then the code itself.

A control named in the abstract cannot be implemented; a control named as "the guard in `src/auth/jwt-auth.guard.ts`, applied to the new controller" can.

**On a revision pass**, read backwards first: this file's own previous version — every `S-<n>` with its control and its disposition — then the research's `## Revisions` and every `D-<n>` it superseded or added this round, then the plan's `## Revisions`. The surface you mapped last round is the baseline; you are looking only for where the mechanism moved under it.

Done when you can name, file by file, every existing control this feature will sit behind, and every place the research chose a mechanism that has one — and on a revision pass, for every change in the research's `## Revisions`, whether it moves the surface or leaves it exactly where it was.

### 2. Map the surface

Three lists, taken from the plan rather than from imagination:

- **Assets** — what is worth reaching: stored rows and whose they are, file bytes, credentials and tokens, secrets, and the ability to spend disk, CPU, quota or money.
- **Entry points** — every place this plan adds or touches where something from outside arrives: HTTP routes and their DTOs, Server Actions, form fields, uploaded bytes and their filenames, query and path parameters, cookies and headers, callbacks from a third party, config read from env.
- **Trust boundaries** — where data crosses authorities (e.g. browser → web app, web app → API, API → database, cache or disk, API → anything external).

Every entry point carries **who may reach it** — anonymous, any signed-in user, or the owner of the thing — and the assets it can touch, and the plan task that builds it.

**On a revision pass this step is the trigger list, not the plan.** Walk the **Revision triggers** below against the research's `## Revisions`: what fires is the surface this round re-examines, and an entry point nothing fired on keeps the findings and dispositions it already has — they are not re-derived, re-worded or re-raised under a new number. No trigger fires at all → skip to step 7 and write the converged form.

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
- **Promise** — the control is something the user was never promised, so there is nothing for a test to hold. It needs an `AC-<n>` in the PRD, and — once the user approves it — the work that keeps it, exactly as a **Work** finding gets it.
- **Accepted** — the user takes the risk knowingly, with the date and their words recorded.

Done when no finding is left without a disposition, and every **Held** names the file or task that holds it.

### 6. Ask about the two that are the user's

This skill's class in `PIPELINE.md`: **Promise** and **Accepted**. Raising a control into an acceptance criterion is the recommended option wherever the asset is another person's data — it is what gives `build-phase` a test to write and close-out something to prove.

An approved **Promise** lands in three places, and a promise missing any of them is a promise nothing keeps:

1. **The PRD** — appended as the next free `AC-<n>`, every existing criterion untouched, and noted in the PRD's **Asked & assumed**.
2. **The phase that owns its entry point** — that criterion is added to the phase's `**Covers**` line in step 8. A criterion in the PRD that no phase covers is what the docs linter fails on, and it fails on it in this run's own postflight.
3. **A task in that phase** — the control is written into the plan in step 8 the way a **Work** finding is, so `build-phase` has something to implement and close-out something to prove.

Done when every **Promise** and **Accepted** finding carries the user's answer, the PRD holds the criteria they approved, and every approved criterion has both a phase covering it and a task producing it.

### 7. Write the file

- **Path**: next to its plan, `docs/<slug>/<slug>-THREATS.md`, reusing the plan's slug exactly.
- **Shape**: the template below.

Section 2 is the **threat map** — phase, its tasks, the findings they carry. Like the research decision map, it is written on every run: `issues` renders it into issue bodies and applies the `security` label from it, and `build-phase` reads it to load a phase's findings.

A surface that came out empty in step 2 gets the verdict form: header, one paragraph naming what was examined and why nothing was reachable, and nothing else. The file still exists, because `issues` checks for it.

**On a revision pass the file is edited, not rewritten.** Only the findings a trigger fired on move; every other byte stays as it was, dispositions included. A finding this round retires — its entry point gone, its mechanism replaced by one that cannot carry the risk — keeps its `### S-2.` heading and gains `**Superseded by**: S-6 — <reason>, round <N>`, or `**Retired**: <reason>, round <N>` where nothing replaces it; new findings take the next free number. Each change gets a line in `## Revisions` citing the `D-<n>` behind it, and the threat map is updated only where those findings moved. Nothing fired → the whole edit is one `## Revisions` line: `<date> — round <N>: no change; re-read D-6, D-7 against the surface in section 3.`

Done when every finding has a block with its control and the test that proves it, and every phase appears in the threat map — or, on a revision pass, when the diff against the previous version contains only what a trigger produced.

### 8. Revise the plan, where a finding became work

Every **Work** finding, and every **Promise** the user approved in step 6, is a task the plan is missing, and it is written the way `research` writes its own, following **Versions** in `PIPELINE.md`:

- Edit the plan in place, keeping every phase and task number intact. A new task takes the next free number in the phase that owns its entry point — controls land with the code they guard, never in a phase of their own at the end.
- Each affected phase gains `**Threats**: S-1, S-3`, so implementation reads the phase and the finding together.
- A phase that took an approved **Promise** also gains that criterion on its `**Covers**` line — the criterion, the phase and the task arrive together or the postflight linter fails on the one that is missing.
- The `## Revisions` section gets one line per change, naming the finding that caused it: `2026-08-05 — added 2.4 (ownership check on GET /files/:id) — threats S-1.`

Anything larger belongs to the user: a new phase, a change of phase order, or a control that crosses the PRD's scope fence. Show it with the finding behind it and ask.

Done when either no finding became work and the report says so, or the plan carries every new task traced to an `S-<n>`, with every existing number preserved and every approved criterion covered by the phase that keeps it.

### 9. Report

`docs/INDEX.md` — replace this feature's `Threats —` placeholder with a link to the file.

Then: the path, one line per finding with its severity and disposition, what the user accepted or promised, whether the plan was revised and what moved in it, what stays open, and the next command: `/bldprj:pre-issues docs/<slug>/<slug>-PLAN.md`.

A run that produced a finding firing one of `research`'s **Revision triggers** names `/bldprj:research docs/<slug>/<slug>-PLAN.md` instead, listing the findings that force it and which trigger each fires — a control the chosen mechanism cannot carry, a threshold with no parameter behind it, a control needing a mechanism nobody chose, or an acceptance that changed what a decision was weighed against. Nothing firing → `pre-issues`, unchanged.

A revision pass reports its round instead: which triggers fired and which `D-<n>` fired them, every finding superseded, retired or newly raised, and then the next command by outcome —

- **Converged** — nothing fired: say exactly that. The mechanisms the research settled leave the surface where it was, the round changed nothing, and the work is ready for `/bldprj:pre-issues docs/<slug>/<slug>-PLAN.md`.
- **Revised** — a finding moved and its control needs a mechanism or a parameter this plan has not chosen: `/bldprj:research docs/<slug>/<slug>-PLAN.md`, naming the trigger. A finding whose control fits what is already chosen is written into the plan here and goes on to `pre-issues`.
- **Past the budget** — round 3 or later, run by hand: report it as any other revision pass, then say the budget is past and name the conflict `/bldprj:pre-issues` would settle more cheaply, and why.

## Checklist

Ten classes, each read against the controls the project already has. An entry point is taken through all ten.

1. **Ownership** — a route that takes an id answers "whose is it?" before anything else. The project's existing modules show the scoping idiom (e.g. every query filtered by the caller's id); a new route that drops the scope hands one user another's row. The answer to a request for someone else's object is the same as for one that does not exist.
2. **Authentication** — which routes the project's auth guard covers and which are deliberately public. A new controller is public until it says otherwise, and that is worth stating per route.
3. **Input** — every field arrives through the project's validation idiom (e.g. a DTO layer behind a global validation pipe, a schema validator), bounded in size and count, unknown properties stripped. A value read straight off the request body is the finding.
4. **Injection and traversal** — the query layer parameterises what it builds; raw-query APIs do not (e.g. Prisma's `$queryRaw`). A filename or id from the user never becomes a path — the server picks the stored name, resolves it, and the result is checked to still sit under the storage root. A URL from the user that the server fetches is the same class.
5. **Spend** — what one caller can consume before anything stops them: body and file size, upload count, page size, an unbounded loop, a query without a limit. A project that already rate-limits its auth routes has set the pattern for any expensive route.
6. **Exposure** — the fields that leave: password hashes, tokens, internal ids, storage paths, another user's email. In a server-rendered frontend, everything the server hands a client component ships to the browser as markup, whether it is rendered or not.
7. **Secrets** — env vars stay server-side (a public-prefix convention such as `NEXT_PUBLIC_` is publication), and tokens, passwords and connection strings stay out of logs, error messages and API responses.
8. **Session and browser** — the session cookie's flags and lifetime, what a server-side action accepts and from whom, the CORS origin the API allows, and any redirect target taken from input.
9. **Storage and dependencies** — where bytes land and with what permissions, best-effort infrastructure holding nothing that must be true (a cache the project's rules let vanish is not a control), and a vulnerability audit (e.g. `npm audit`) on anything the research added.
10. **Errors and timing** — the same failure looks the same from outside: a wrong email and a wrong password answer identically, and an object the caller may not see is missing rather than forbidden.

## Revision triggers

What a research round can legitimately reopen in this file. Five, and the list is closed: a change in the research that fires none of them left the surface exactly where it was, and it changes nothing here.

1. **The surface moved.** A new or superseded `D-<n>` adds, removes or relocates an entry point or a trust boundary — a route that now takes an id, bytes that now land on disk, a call that now leaves for a third party. That entry point goes through all ten checklist classes; the ones that did not move do not.
2. **A threshold lost its parameter.** A control's limit cited a value in the research **Parameters** table and that value changed, or the row it cited is gone. The control's number is updated in place — no new `S-<n>`, because the reach did not change.
3. **A new dependency arrived.** Checklist class 9 only: what it pulls in, what it runs at install time, and its audit. The rest of the surface is untouched by it.
4. **A finding's mechanism was replaced.** An `S-<n>` names a `D-<n>` that this round superseded: re-check that finding's disposition against the replacement — a **Held** whose holder is gone is reachable again, and an **Accepted** may have become cheap to close.
5. **The plan grew an input.** A research revision added a task that accepts input or returns data — a migration reading config, a new endpoint, an env var parsed at boot. It is an entry point like any other.

A decision reworded, re-costed or re-sourced without moving an entry point, a parameter no control cites, and an `Exposure` line corrected to say what this file already said are all **no change** — they are what a converged round is made of.

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

**Trust boundaries**: <browser → web app → API → database · disk>

## 4. Findings

### S-1. <caller → input → asset, in one line>

- **Superseded by**: <only on a finding a round replaced or retired — S-6 — the reason, round 2. The block below stays as it was written.>
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

## Revisions

<Empty on the first pass. One line per revision round: what moved and the D-<n> behind it, or that nothing did.>

- 2026-08-07 — round 2: no change; re-read D-6, D-7 against the surface in section 3.
```

## Rules

- **Reach is the filter**: caller, input, asset. A class with no reachable path is recorded as examined and held, not raised as a finding.
- Controls are named where they will live — a file, a guard, a decorator, a limit from the research Parameters table — so a task can be written from one.
- Findings land in the phase that builds their entry point, so the control ships with the code it guards.
- This run writes documents. Feature code, installs and `package.json` stay as they are, and the only edit outside its own file is the plan revision in step 8 and an acceptance criterion the user approved.
- Whatever the PRD put Out of scope stays out: a finding in code this plan does not touch is recorded and handed to `/bldprj:refactor-prd` as a security driver.
- An accepted risk is written down with its date and the user's words — an accepted finding stays visible in the file rather than disappearing from it.
- `S-<n>` numbers are permanent: `pre-issues` rules on them, `issues` labels from them, `build-phase` checks the code against them, and `/security-review` reads them.
- A finding the user later trades away is not deleted: `pre-issues` writes the accepted disposition onto it, with the ruling that bought it.
- An approved **Promise** arrives complete: the criterion in the PRD, that criterion on the owning phase's **Covers**, and a task in that phase that builds the control. Any one of the three alone is a promise nothing keeps.
- A revision pass changes only what a **Revision trigger** fired on. A settled `S-<n>` is not re-derived, re-worded or re-raised under a new number, and a retired one keeps its heading and gains `**Superseded by**` or `**Retired**`. Changing nothing is the expected outcome and is reported as one.
