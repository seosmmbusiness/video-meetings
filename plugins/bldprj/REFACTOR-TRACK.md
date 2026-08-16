# Refactor track

The pipeline runs two tracks. A **feature** adds behaviour. A **refactor** keeps behaviour exactly as it is and improves what sits behind it — speed, security, structure, or agreement with the docs.

`refactor-prd` → `plan-phase` → `research` → `security-analyse` → `pre-issues` → `issues` → `build-phase` → `close-feature` is the same pipeline as the feature track, run by the same skills. Each reads the track off the file name and applies its section below **on top of** its own steps: this file overrides where it speaks and leaves the rest standing. Everything both tracks share — identity, the artifact names, document versions, the question protocol — lives in [`PIPELINE.md`](PIPELINE.md).

## Parity

Observable behaviour is identical on both sides of the change:

- the same request returns the same status, body and headers;
- the same screen shows the same copy in the same states;
- the same failure produces the same error, in the same shape;
- env vars, database schema, stored data and public exports keep their names and their meanings.

Free to move: internal structure, file layout, private names, algorithms, query plans, dependencies, memory and time.

A change a user could notice is a feature. It leaves through `/bldprj:prd` with its own branch and its own tests; the refactor stays at parity.

## The suite is the contract

The tests that already exist are the only proof that parity held, so they run exactly as they are — same files, same assertions, same names.

- **Green baseline → change → green.** The suite runs and its output is recorded before the first line changes, and the same commands with the same result are what proves the work done. Red at the start is a stop: there is no parity signal to refactor against.
- Behaviour no test covers has no parity signal. Pin it with a **characterization test** — written against the current implementation and passing before that implementation moves — and land it first.
- A test that goes red under a refactor names a behaviour that changed: return the code to parity. Where the test itself looks wrong, that is a conversation with the user before a single assertion is touched.

## `plan-phase` on a refactor

Input `docs/<slug>/<slug>-REFACTOR-PRD.md`, output `docs/<slug>/<slug>-REFACTOR-PLAN.md`. The PRD's **Behaviour freeze**, **Green baseline** and **Internal outcomes** are the plan's target, the way acceptance criteria are on the feature track. These phasing rules replace the tracer bullet and the one-layer-per-phase rule:

- **Phase 1 secures the parity signal**: run the PRD's baseline commands, then add the characterization tests for whatever behaviour the PRD marked unprotected. Production code does not move in this phase.
- **One seam per phase** — one module, one layer of one module, one query path. Two seams in a phase leave you unable to bisect the change that broke parity.
- Every phase lands at **parity**: after it, the same suite run the same way gives the same result and the app behaves as it did before the plan started.
- A phase's **Done when** names the baseline commands and their green result, plus the measured before → after number for the internal outcome it serves.
- Tasks move code; they do not edit tests. A task that could only be done by changing a test is a behaviour change hiding in the plan — split it out and send it to `/bldprj:prd`.

Template delta: the header links `<slug>-REFACTOR-PRD.md`, each phase's **Covers** cites the refactor PRD's `AC-<n>` exactly as on the feature track, and each phase block gains **Parity check** (the commands that must stay green, plus what to observe by hand) and **Measures** (before → target for this phase).

**Verified by** is carried on this track too, and says the track's own idiom rather than the project's test-first cycle: green baseline → change → green, no existing test edited, and the characterization tests this phase's own tasks name. Those tasks carry the `tests:` marker like any test-only task, so they sit outside the five-task ceiling and take the `test` label — the marker says the task's output is test code, not that the project writes tests first.

## `issues` on a refactor

Input `docs/<slug>/<slug>-REFACTOR-FINAL.md`, map file `docs/<slug>/<slug>-REFACTOR-MS.json` — same shape, with `"track": "refactor"` beside `"feature"` so `build-phase` reads the track without parsing paths, and `sources` pointing at the `-REFACTOR-` files.

- Milestone and issue titles carry the same `<KEY> <phase>.<task>` identity as the feature track, with the phase number prefixed `R` so the two tracks never collide when they share a Key (a refactor reusing a feature's `docs/<slug>/` folder reuses its Key too): `MFU R1 · Characterization tests for the meetings query`, `MFU R1.2 — <label>`. `issues` reconciles by that prefix, exactly as it matches `<KEY> <N>` on the feature track.
- Labels: `refactor` on every issue, plus the driver's label (`performance`, `security`, `documentation`) and `backend`/`frontend` from **Touches** — the same priority order and four-label cap as `issues`' own Labels rule.
- The issue body gains one line under the phase line — `**Parity**: <the phase's parity check>` — so whoever closes it knows what proves it done.
- Characterization-test tasks become issues like any other. A task that would rewrite an existing test becomes a question for the user instead of an issue.

## `research` on a refactor

Input `docs/<slug>/<slug>-REFACTOR-PLAN.md`, output `docs/<slug>/<slug>-REFACTOR-RESEARCH.md`. Every option is judged against **parity** before anything else: an option that moves a response, an error or a screen is rejected here however fast it is, and goes into the report as a proposal for `/bldprj:prd`.

### Measure before you choose

A speed refactor starts from a number, not from a suspicion. Reproduce the cost the PRD names and record how you got it: the command, the input and its size, the environment, the value, and the spread over repeated runs. An optimisation with no before-number cannot be shown to have worked — and that is the usual way a refactor ships a regression believing it shipped a win.

Where the number typically comes from — mapped to the project's own stack:

- **Database** — the ORM's query logging (e.g. Prisma `log: ['query']`) for the statements one request actually emits, their count, and `EXPLAIN ANALYZE` on the slow one. The recurring finds are N+1 loops, a missing index on a filtered or sorted column, and a full row fetch where a narrower select would do.
- **API** — request duration end to end, split into database time and handler time; payload size; and work repeated per request that could be done once at startup (config parsing, key derivation, client construction).
- **Web** — server render time, the number and waterfall depth of the server-to-server calls a page makes, per-route bundle bytes, and, in a server-rendered stack, what a client component costs that a server component would not.
- **Process** — build and suite duration (e.g. `npm run build`), when the driver is developer speed.

### Optimisation order

Cheapest and most reversible first; stop at the first level that reaches the PRD's target.

1. **Do less work** — a narrower query, a dropped round trip, work hoisted out of a loop or a request, `Promise.all` where sequential `await`s were serialising independent calls.
2. **Do it at the right layer** — the database filtering, sorting and paginating instead of the process; the server rendering what the client was assembling.
3. **Do it once** — memoise per request, then per process. An external cache only as best-effort the code still works without (honouring the project's own infra rules), never as a source of truth.
4. **Do it differently** — another algorithm, another data structure, a schema change. The highest cost and the one that needs the strongest before-number.

A dependency added for speed carries the **dependency budget** like any other, plus its own measured win.

### Security and doc-compliance drivers

- **Security** — the finding-by-finding pass belongs to `security-analyse`; research settles the mechanism each control is built from — which guard, which validator, which limit — and judges it against parity like any other option.
- **Doc compliance** — a mismatch table, one row per gap: doc claim · what the code does · which one is wrong. Where the code is right, the doc is fixed. Where the doc is right, aligning the code is behaviour change unless the doc describes internals only.

Template delta: section 4 carries a **Baseline** table — metric · how it was measured · value today · target — and every decision block gains **Parity**: what proves this option leaves behaviour identical.

## `security-analyse` on a refactor

Input `docs/<slug>/<slug>-REFACTOR-PLAN.md`, output `docs/<slug>/<slug>-REFACTOR-THREATS.md`. The surface it maps is the one that exists today, and **parity decides the disposition of every finding**:

- A control the code already has, weakened or bypassed by the planned change → a finding for this plan, closed inside it.
- A finding in behaviour the refactor keeps → hardening that starts rejecting requests the API accepts today is a behaviour change. It leaves as a `/bldprj:prd` proposal, and its `S-<n>` records where it went.
- A driver the refactor PRD already named as security → the findings are its outcomes, and each carries the measurement that proves it closed.

## `pre-issues` on a refactor

Input `docs/<slug>/<slug>-REFACTOR-PLAN.md`, output `docs/<slug>/<slug>-REFACTOR-FINAL.md`, phases addressed `R<N>`. Every freeze line and every internal outcome already fronts an `AC-<n>` in the refactor PRD, so the Trace table reads exactly as on the feature track — one row per criterion — and its **Proven by** column is the baseline command that would catch the freeze breaking, or the measurement that produces the after-number.

Parity is an eleventh conflict class, and it outranks the rest:

- A task that could only be finished by editing an existing test, a control that starts rejecting requests the API accepts today, a decision whose option moves a response, an error or a screen — each is a behaviour change hiding in the plan. It leaves for `/bldprj:prd` as a proposal, and the `T-<n>` records where it went.
- Every internal outcome has a before-number from the research **Baseline** table and a named command that produces the after-number the same way. An outcome with no before-number is the silence class: it cannot be shown to have worked.
- Every freeze line is covered either by a baseline command or by a characterization-test task in phase `R1`. A freeze line with neither is a promise nothing would catch breaking.

A phase's **Done when** in FINAL names the baseline commands with the result they must give, plus the before → after number for the outcome that phase serves.

Sources are the `-REFACTOR-` files, phases are addressed `R<N>` (`/bldprj:build-phase R2`), the branch is `refactor/<slug>-phase-<N>`, and the log is `docs/Refactor.md`.

- **Green baseline first.** On the freshly cut branch, before the first line changes, run the PRD's baseline commands and show the output. Red at the start stops the run and goes to the user: a failure inherited from the base branch is not this phase's to absorb.
- **Parity, not TDD.** The feature track opens with a failing test; a refactor phase starts green and stays green. The only tests it writes are the characterization tests its own tasks name — against the current code, passing before that code moves. So `build-phase`'s red-then-green commit pair has nothing to record here: a characterization task commits once, green, and the one-commit-per-task floor stands as it does on the feature track.
- **Prove parity in step 7**: the same commands as the baseline, the same result, shown next to the baseline output. Plus the after-number for every internal outcome the phase serves, measured the way the before-number was.
- The PR body carries the baseline → after table and the evidence that the contract held: a diff over the project's test files (e.g. `git diff --stat <base>...HEAD -- '**/*.spec.ts'`) showing only added characterization tests.
- Behaviour that has to change for a task to finish is a stop-and-ask. It leaves the refactor and becomes a `/bldprj:prd` item.
- `close-feature` on this track reads `<slug>-REFACTOR-PRD.md`, deletes merged `refactor/<slug>-phase-*` branches, and collapses the log rows in `docs/Refactor.md`.
