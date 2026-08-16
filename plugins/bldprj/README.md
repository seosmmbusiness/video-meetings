# bldprj — Build Project Pipeline

The document pipeline a feature or refactor is built through, packaged as one Claude Code plugin. Eight stages, nine skills, one chain, one artifact per stage — plus `status`, which reports on the chain from outside it:

```
prd | refactor-prd  →  plan-phase  →  research  →  security-analyse  →  pre-issues  →  issues  →  build-phase  →  close-feature
```

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

One skill sits outside the chain: **`status`** reads `docs/` and reports where every work item has got to and the one command that moves it on. It writes nothing and calls nothing, so it is safe at any point.

The chain runs forward once, and that pass is complete on its own. `research` and `security-analyse` can additionally be run against each other — a mechanism that cannot carry a control sends the work back to `research`, and a decision that moves an entry point sends it back to `security-analyse`. A re-run is detected, not asked for, and it revises rather than rewrites: it changes only what its own closed list of triggers fires on, records the round in the document's `## Revisions`, and reports **converged** when nothing fired. Two rounds is the budget; past that, `pre-issues` is the cheaper arbiter. See **Re-running a stage** in `PIPELINE.md`.

## Layout

```text
bldprj/
├── .claude-plugin/plugin.json   # manifest
├── CLAUDE.md                    # for whoever edits the plugin: goals, invariants, workflow
├── PIPELINE.md                  # the contract all stages share: identity, versions, asking
├── REFACTOR-TRACK.md            # everything the refactor track does differently
├── skills/<name>/SKILL.md       # one skill per stage
└── scripts/docs-lint.mjs        # the validator (docs-lint.test.mjs is its node:test suite)
```

`PIPELINE.md` and `REFACTOR-TRACK.md` sit at the plugin root because every skill reads them; each `SKILL.md` points at them with `../../PIPELINE.md`.

## Installing

From a marketplace — any repo that carries this plugin and lists it in a `.claude-plugin/marketplace.json` at its root:

```bash
claude plugin marketplace add <path or URL of that repo>
claude plugin install bldprj@<marketplace name> --scope project
```

A marketplace install **copies** the plugin into `~/.claude/plugins/cache`; edits to the source reach that copy only after `claude plugin marketplace update` + `claude plugin update`, and the `version` in `plugin.json` is the update signal — bump it when a skill changes.

The zero-install alternative: symlink this folder into a **skills directory** — `.claude/skills/bldprj` for one project, `~/.claude/skills/bldprj` for every project — and it loads in place, edits taking effect the next session. Don't combine both in one project: the pipeline would load twice.

Either way the skills are invoked namespaced:

```
/bldprj:prd meeting file upload
/bldprj:plan-phase docs/meeting-file-upload/meeting-file-upload-PRD.md
```

Check that it loaded, and validate after editing the manifest or a skill's frontmatter:

```bash
claude plugin list
claude plugin validate <path to this folder>
```

`validate` warns that the plugin's own `CLAUDE.md` is not loaded as project context. That is expected: the file documents the plugin for whoever edits it, in the repo that hosts it, and is not meant to reach an installed copy — `--strict` turns that warning into a failure.

## The validator

`scripts/docs-lint.mjs` checks what `PIPELINE.md` makes mechanical: key uniqueness, task numbering, label and phase-title lengths, the five-building-tasks-per-phase ceiling (a `tests:` task is exempt), every phase naming the workflow it is **Verified by** (a warning, and not asked of already-archived work), acceptance-criteria coverage and duplicates, D-/S- citation integrity in both directions (a cited id resolves to a live block, a superseded one is not cited as current, and a decision or finding a FINAL cites nowhere is a warning), plan ↔ final plan ↔ backlog agreement (including a backlog left behind by a newer FINAL), and resolvable links that stay inside the project.

It reads the project's `docs/` tree, which it cannot infer from its own location inside the plugin, so the project root comes from the first argument, else `$CLAUDE_PROJECT_DIR`, else the working directory:

```bash
node scripts/docs-lint.mjs ~/code/app       # against any project
node --test scripts/docs-lint.test.mjs      # the validator's own suite
```

Exit code 1 on an error, 0 on warnings only. A project may wrap it in a `docs:lint` script of its own; the skills' postflight uses that script when it exists and falls back to the plugin's copy (`PIPELINE.md`, Writing a document).

## What the skills assume about a project

The stages are project-agnostic: commands, layers, stacks and conventions are **read from the project's own docs** (`CLAUDE.md`, `README.md`, module docs) at run time, and the concrete names inside the skills are examples, not requirements. What a project has to provide:

- `docs/` as the documents' home — `docs/<slug>/` per work item, `docs/INDEX.md`, `docs/archive/`, `docs/Features.md` / `docs/Refactor.md`; the skills create each of these on first use.
- `gh` authenticated against the repo, for `issues`, `build-phase` and `close-feature`.
- Project docs that actually state its conventions — how to run tests, lint and build, where module docs live, **and how each layer is written and verified** — since the skills read them instead of assuming a stack. That last one is what `plan-phase` copies into every phase's **Verified by** and `build-phase` writes code to; a project silent about it gets a pipeline silent about it.
- The labels its backlog uses (e.g. layer labels plus `security`, `test`, `refactor`, `performance`); `issues` applies only labels the repo has and asks before creating a missing one.
