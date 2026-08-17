# Ralph loop — the session contract

Read this file at the start of every Ralph session, before anything else. It is the whole contract:
the loop hands you one stage of one phase, you do exactly that, and you end the session.

The loop does **not** replace `/bldprj:build-phase` — it is the same contract, cut into sessions so
each one starts with a fresh context on one task. Where this file is silent,
`plugins/bldprj/skills/build-phase/SKILL.md` is what you follow.

## What the loop owns, and you do not

Ralph decides which stage runs next, which task is next, when the phase closes, when the PR merges
and when the next phase opens. You never make those calls, and never take a second task "while
you're here":

- **Never close an issue.** The pipeline closes issues through a merged PR's `Closes #<n>` lines.
- **Never merge.** The loop re-runs the whole check set itself and merges only on exit code zero.
- **Never open the PR from a task session** — that is the `close` stage's job.
- **Never take a task from another phase**, however small it looks.
- **Never pick the next task yourself.** End the session; the loop picks it.

## What to read, in this order

1. **The issue body** — `gh issue view <n>`. It already carries **Covers**, **Decisions**,
   **Threats**, **Verified by** and the phase's **Done when**. Everything else is background to it.
2. **This phase's block** in `docs/user-profile/user-profile-FINAL.md` — Goal, Touches, Covers,
   Decisions, Threats, Verified by, Tasks, Done when, plus the Rulings table.
3. **Only the `D-<n>` it cites** in `-RESEARCH.md`, and **only the `S-<n>` it cites** in
   `-THREATS.md`. Limits, versions, env var names and error codes are copied verbatim.
4. **`CLAUDE.md`, the app's `CLAUDE.md`, and the module docs for what you touch** —
   `.claude/modules/INDEX.md` first, then only those modules' docs.

`-PLAN.md` is history; FINAL superseded it. Nothing reads it.

Sources of truth in priority order when they disagree: FINAL, then RESEARCH, then THREATS, then the
PRD, then the repo's own docs. A contradiction that survives is **blocked** (below), never a silent
pick.

## Implementation rules

Test-first, outside in, as the phase's **Verified by** states it — that line is the project's own
rule already hardened by the pipeline, so follow it as written rather than re-deriving it.

- **Write the specs first and see them red** before a line of implementation exists.
- **Which tier a spec belongs to is decided by what it touches**: `*.spec.ts` needs nothing,
  `*.int-spec.ts` needs Postgres, and anything driving real HTTP or a browser is e2e.
- **Run the touched tier after every task**, by name — not just the unit suite:

  | Command                | Runs                                          |
  | ---------------------- | --------------------------------------------- |
  | `npm run test:api`     | apps/api unit                                 |
  | `npm run test:web`     | apps/web unit **and** integration             |
  | `npm run test:int:api` | apps/api integration — needs `npm run db:up`  |
  | `npm run test:e2e:api` | apps/api e2e — needs `npm run db:up`          |
  | `npm run test:e2e:web` | apps/web e2e — needs Postgres and apps/api up |

- **Security cases are mandatory at the tier that proves them**, not bolted onto e2e: authorization
  boundaries, auth bypass on a protected route, and mass-assignment rejection.
- **Docs land with the code**, in the same task: JSDoc on every function, Swagger annotations on new
  routes and DTOs, the module doc under `.claude/modules/` plus its `INDEX.md` row, and the app's
  `HISTORY.md` entry.
- **Tests keep their teeth.** Weakening or rewriting a spec to reach green is **blocked**, never done.
- **`--no-verify` is off the table.** `pre-commit` runs `npm run lint`, `pre-push` runs `npm test`;
  both stay in the loop. A hook that refuses a commit means fixing the cause.

## Commits

One commit per task, never two tasks in one commit:

```
<type>(<scope>): <what was done>

Refs #<issue number>
```

- `type` and `scope` follow the repo's history (`feat(api)`, `test(web)`, `docs`, `build`), per the
  `git-commit` skill's conventional-commit rules.
- **On a test-first layer a task is two commits**: `test(<scope>)` with the failing specs, then
  `feat(<scope>)` that greens them, both carrying the same `Refs`. Keep the red output — the PR body
  quotes it, and it is the only proof the cycle ran in the mandated order.
- `Refs` on task commits; `Closes` only in the PR body.
- The branch tip that gets pushed is green, whatever red the history records on the way there.

## Finishing a task session

1. The task's tier suites are green (or, for a tests-only task, red exactly as intended and committed
   as such).
2. `gh issue edit <n> --add-label ralph:done`.
3. End the session immediately. Do not summarise the next task, do not start it.

The label is how the loop knows the task is done without closing the issue. A session that ends
without it is retried, and retried twice means blocked.

## Blocked — the escape hatch

Use it for: red tests you cannot green, a contradiction between FINAL, RESEARCH, THREATS and the
code, a task that cannot be done as written, a dirty tree you did not create, a decision reserved
for the user, or a test you would have to weaken. Three steps, in order:

```bash
gh issue comment <n> --body "Ralph is blocked: <what happened>

\`\`\`
<the failing command and its real output>
\`\`\`"
gh issue edit <n> --add-label ralph:blocked
printf '%s\n' "blocked on #<n>: <one line>" > .claude/ralph.stop
```

Then end the session. `.claude/ralph.stop` halts the whole chain — the loop will not start another
session until it is removed. Never invent a way past a block, and never silence a failure to get
past it.

## Language

English in every file, commit message, issue comment and PR body. The console report at the end of a
session is Russian.

## Autonomy, and what it costs

This loop merges its own PRs. Two things follow, and they are recorded in `HISTORY.md` rather than
left implicit:

- **The check set is the only gate.** `.claude/ralph/verify.js` re-runs lint, format, every tier the
  phase owns, `npm run build` where relevant and the pipeline's docs linter, and merges only on a
  clean sweep. Nothing merges on a session's own report that it is green.
- **Phase 1's `Verified by` clause "the e2e cases are written and reviewed with the requester first"
  is waived for Ralph runs** — there is no requester in the room. The compensating record is a
  comment: a tests-only task posts its e2e case list on the issue **before** implementation begins,
  so the cases can be read back afterwards even though nothing blocked on them.
