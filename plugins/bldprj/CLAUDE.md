# bldprj

A Claude Code plugin: the document pipeline a feature or refactor is built through. Eight stages, nine skills, one artifact per stage, from a PRD to a shipped and archived feature — plus `status`, a tenth skill that only reports on the chain.

This file is for working **on the plugin**. What the pipeline _is_ lives in [`PIPELINE.md`](PIPELINE.md) (the contract every skill shares) and [`REFACTOR-TRACK.md`](REFACTOR-TRACK.md) (what the refactor track does differently) — don't restate either here. [`README.md`](README.md) is the user-facing install and validator doc.

## Goal

Turn a one-line feature wish into merged code without the two failures that eat a solo pipeline: **a decision nobody wrote down**, and **a promise nobody proved**. Every stage owns exactly one class of decision, writes exactly one artifact, and reads the artifact the stage before it wrote — so a choice is made once, at the cheapest moment, and is still readable three stages later by its identifier.

Three properties everything else is subordinate to:

- **Traceable** — every task traces up to an `AC-<n>` and down to the `D-<n>` and `S-<n>` that constrain it. Numbers are minted once and never reused.
- **Falsifiable** — a criterion names an observation that would prove it wrong; close-out holds the shipped code against each one.
- **Project-agnostic** — commands, layers and conventions are read from the host project's own docs at run time. Concrete names inside the skills are examples, never requirements.

## Layout

```text
bldprj/
├── .claude-plugin/plugin.json   # manifest — `version` is the update signal for marketplace installs
├── CLAUDE.md                    # this file
├── PIPELINE.md                  # the shared contract: identity, artifacts, versions, asking, reporting
├── REFACTOR-TRACK.md            # the refactor track's overrides, per skill
├── README.md                    # install, validator, what a host project must provide
├── skills/<name>/SKILL.md       # one skill per stage — frontmatter `name` + `description`, then steps
└── scripts/
    ├── docs-lint.mjs            # the validator: enforces what PIPELINE.md makes mechanical
    └── docs-lint.test.mjs       # its node:test suite
```

`PIPELINE.md` and `REFACTOR-TRACK.md` sit at the plugin root because every skill reads them; each `SKILL.md` reaches them as `../../PIPELINE.md`.

| Skill              | Writes                        | Owns                                                    |
| ------------------ | ----------------------------- | ------------------------------------------------------- |
| `prd`              | `-PRD.md`, `docs/INDEX.md`    | what the user gets, and how it is proven done           |
| `refactor-prd`     | `-REFACTOR-PRD.md`, the index | what stays identical, and what improves behind it       |
| `plan-phase`       | `-PLAN.md`                    | the preliminary cut into phases, and every task number  |
| `research`         | `-RESEARCH.md`                | the mechanism: library, storage, schema, limits         |
| `security-analyse` | `-THREATS.md`                 | the reachable risk and the control that closes it       |
| `pre-issues`       | `-FINAL.md`                   | drift against the PRD, and the ruling on every conflict |
| `issues`           | GitHub, `-MS.json`            | the mirror of the final plan on GitHub                  |
| `build-phase`      | code, PR, progress            | one phase, from branch to green PR to closed milestone  |
| `close-feature`    | archive, logs, PRD status     | the proof of every criterion, and the archive           |
| `status`           | nothing                       | where each work item stopped, and its next command      |

`status` is the one skill that is not a stage: it reads `docs/`, writes no file, makes no network call, and runs no postflight. Keep it that way — the moment it corrects something it becomes a stage with no artifact to own.

## Invariants

Break one of these and the chain stops resolving. The linter enforces the mechanical ones; the rest live in prose because only a reader can check them.

- **One owner per identifier.** `slug`/`Key`/`AC-<n>` → `prd`, `<phase>.<n>` → `plan-phase`, `D-<n>` → `research`, `S-<n>` → `security-analyse`, `T-<n>` → `pre-issues`. A skill never mints another's id and never renumbers one.
- **One artifact per stage**, at the path the Artifacts table in `PIPELINE.md` fixes. Filenames are the API: `docs-lint.mjs`, `issues` and `build-phase` all resolve documents by exact name and infix.
- **The plan is revised in place; FINAL is versioned.** A `-PLAN-v<N>.md` is a contract violation the linter reports.
- **A skill writes documents, not code.** Only `build-phase` touches the host project's source, installs anything or edits its manifest.
- **Every skill reads `PIPELINE.md` before its step 1**, and the refactor track's file when the argument carries the `-REFACTOR-` infix. Rules are stated once, there, not copied into skills.
- **Every run ends with the next command in the chain**, so the user never has to remember the order.

## Working on the plugin

- **Frontmatter** is `name` + `description` only, and the description is what routes an invocation: it says what the skill produces, when to use it, and which skill consumes its output. Rewriting one changes routing — treat it as an interface change.
- **A rule belongs in one place.** New shared behaviour goes in `PIPELINE.md`; a track difference in `REFACTOR-TRACK.md`; only the steps themselves in a `SKILL.md`. A rule stated twice will drift.
- **Changing an artifact name, a heading a later stage parses, or an id shape is a breaking change** — grep the whole plugin for it, update `docs-lint.mjs`, and add a case to `docs-lint.test.mjs`.
- **Nothing project-specific.** No stack, script name, framework or repo of a host project in the text except as an explicitly marked example (`e.g. …`). The skills read the host's `CLAUDE.md` / `README.md` / module docs instead.
- **Keep the tables in sync**: the stage table appears in `PIPELINE.md`, `README.md` and this file, and the pipeline chain line appears in every `SKILL.md`. Adding or renaming a stage means touching all of them.

### Before committing a change

```bash
node --test scripts/docs-lint.test.mjs                    # the validator's own suite
node scripts/docs-lint.mjs <a project using the pipeline> # against real documents
claude plugin validate .                                  # manifest + skill frontmatter
npx prettier --check <the files you touched>              # the host repo formats these
```

`claude plugin validate` reports one **expected warning**: "CLAUDE.md at the plugin root is not loaded as project context." That is correct and deliberate — this file is for whoever edits the plugin, in the repo that hosts it, where it loads as ordinary nested project context. It is not meant to reach an installed copy, and the fix the warning suggests (turn it into a skill) would put plugin-maintenance instructions into the user's skill list. Run `--strict` only when you want that warning to fail the command.

Then bump `version` in `.claude-plugin/plugin.json` — for a marketplace install it is the only signal that an update exists. Commit subject: `bldprj: <what changed>`.

### Installed two ways

- **Skills directory** (this repo): `.claude/skills/bldprj` → `../../plugins/bldprj`. Loads in place; edits take effect next session. This is what makes the plugin editable while it is in use.
- **Marketplace**: `.claude-plugin/marketplace.json` at the repo root lists it; installing **copies** it into `~/.claude/plugins/cache`, so edits reach that copy only after `claude plugin marketplace update` + `claude plugin update`.

Never both in one project — the pipeline would load twice.

## Status

Version 2.2.0. Ten skills, both tracks, the validator and its suite are in place, and the plugin is decoupled from the repo that hosts it (no host-project names in the pipeline text). The skills are invoked namespaced: `/bldprj:prd`, `/bldprj:plan-phase`, …

2.2.0 closed the linter and contract gaps 2.1.0 left open. `docs-lint.mjs` now checks citations **both ways** — a cited id must resolve to a live block anywhere it appears, a `**Decisions**:` / `**Threats**:` line may not cite a superseded one, and a `D-<n>` or `S-<n>` that a FINAL cites nowhere is a warning (the check is gated on FINAL, because only there is every phase required to carry its ids; `## Revisions` is history and grants no citation). `checkLinks` resolves every relative link rather than only `.`-prefixed ones, skipping schemes and root-relative paths. `basename` replaced `split('/')`, so the linter is no longer POSIX-only. The Key may now grow to six letters, matching `PIPELINE.md`'s instruction to lengthen it on a collision. `build-phase` step 2 names the settle-commit risk and its recovery, and the postflight rule no longer assumes npm. New skill: `status`.

2.1.0 added the **revision pass** (`PIPELINE.md`, Re-running a stage): `research` and `security-analyse` can now run round-trips against each other. Each detects its own re-run, reads backwards before forwards, changes only what its closed **Revision triggers** list fires on, records the round in its own `## Revisions`, and reports "converged" when nothing fired. A reversed decision or a retired finding keeps its heading and gains `**Superseded by**`, so citations still resolve. The budget is two rounds, after which each skill recommends `pre-issues` as the arbiter — a further round asked for by hand still runs, and says the budget is past. The single forward pass is unchanged and remains the default. The same release made an approved **Promise** land complete — criterion, phase **Covers**, and the task that keeps it — which is what stopped it failing the run's own postflight.

Known gaps:

- **`checkMap` matches the map heading anywhere in the file**, so a document merely mentioning "Decision map" passes the check that it has one.
- **`checkCitations` reads ids from a document's text**, so an id inside a fenced code block or an illustrative example counts as a citation. Harmless today, since neither research nor threats documents ship examples of foreign ids.
- **Nothing checks the `## Revisions` sections against each other** — a research round recorded with no corresponding threats round is invisible to the linter, and only `pre-issues` would notice.
- **`build-phase`, `issues` and `close-feature` are unlinted**: they act on GitHub, and their invariants live only in prose.

Update this file when a stage, an artifact name or an invariant moves — not for wording changes inside a skill.
