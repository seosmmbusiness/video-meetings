# bldprj

A Claude Code plugin: the document pipeline a feature or refactor is built through. Eight stages, nine skills, one artifact per stage, from a PRD to a shipped and archived feature — plus `status`, a tenth skill that only reports on the chain.

This file is for working **on the plugin**. What the pipeline _is_ lives in [`PIPELINE.md`](PIPELINE.md) (the contract every skill shares — the stage table, the artifacts, and **Delegating a step**) and [`REFACTOR-TRACK.md`](REFACTOR-TRACK.md) (what the refactor track does differently) — don't restate either here. [`README.md`](README.md) is the user-facing doc: the layout, both install routes, the validator. [`CHANGELOG.md`](CHANGELOG.md) is the release log, one entry per version.

## Goal

Turn a one-line feature wish into merged code without the two failures that eat a solo pipeline: **a decision nobody wrote down**, and **a promise nobody proved**. Every stage owns exactly one class of decision, writes exactly one artifact, and reads the artifact the stage before it wrote — so a choice is made once, at the cheapest moment, and is still readable three stages later by its identifier.

Three properties everything else is subordinate to:

- **Traceable** — every task traces up to an `AC-<n>` and down to the `D-<n>` and `S-<n>` that constrain it. Numbers are minted once and never reused.
- **Falsifiable** — a criterion names an observation that would prove it wrong; close-out holds the shipped code against each one.
- **Project-agnostic** — commands, layers and conventions are read from the host project's own docs at run time. Concrete names inside the skills are examples, never requirements.

## Layout

The tree is in `README.md`. Two things about it matter when editing: `PIPELINE.md` and `REFACTOR-TRACK.md` sit at the plugin root because every skill reads them (each `SKILL.md` reaches them as `../../PIPELINE.md`), and `status` is the one skill that is not a stage — it reads `docs/`, writes no file, makes no network call, and runs no postflight. Keep it that way: the moment it corrects something it becomes a stage with no artifact to own.

## Invariants

Break one of these and the chain stops resolving. The linter enforces the mechanical ones; the rest live in prose because only a reader can check them.

- **One owner per identifier.** `slug`/`Key`/`AC-<n>` → `prd`, `<phase>.<n>` → `plan-phase`, `D-<n>` → `research`, `S-<n>` → `security-analyse`, `T-<n>` → `pre-issues`. A skill never mints another's id and never renumbers one.
- **One artifact per stage**, at the path the Artifacts table in `PIPELINE.md` fixes. Filenames are the API: `docs-lint.mjs`, `issues` and `build-phase` all resolve documents by exact name and infix.
- **The plan is revised in place; FINAL is versioned.** A `-PLAN-v<N>.md` is a contract violation the linter reports.
- **A skill writes documents, not code.** Only `build-phase` touches the host project's source, installs anything or edits its manifest.
- **Every skill reads `PIPELINE.md` before its step 1**, and the refactor track's file when the argument carries the `-REFACTOR-` infix. Rules are stated once, there, not copied into skills.
- **Delegation is never load-bearing.** A step may hand its reading to an agent, and every **Done when** stays reachable inline. A skill that cannot be run without a subagent is a broken skill.
- **No shipped agent writes.** Agents read and report: `Write`, `Edit` and `NotebookEdit` are removed from every one, and none mints an identifier. Only `build-phase` touches the host project's source, and only in the session running it.
- **Every run ends with the next command in the chain**, so the user never has to remember the order.

## Working on the plugin

- **Frontmatter** is `name` + `description` only, and the description is what routes an invocation: it says what the skill produces, when to use it, and which skill consumes its output. Rewriting one changes routing — treat it as an interface change.
- **A rule belongs in one place.** New shared behaviour goes in `PIPELINE.md`; a track difference in `REFACTOR-TRACK.md`; only the steps themselves in a `SKILL.md`. A rule stated twice will drift.
- **Changing an artifact name, a heading a later stage parses, or an id shape is a breaking change** — grep the whole plugin for it, update `docs-lint.mjs`, and add a case to `docs-lint.test.mjs`.
- **Nothing project-specific.** No stack, script name, framework or repo of a host project in the text except as an explicitly marked example (`e.g. …`). The skills read the host's `CLAUDE.md` / `README.md` / module docs instead.
- **An agent's `description` routes it, and its `## Report` is consumed by a named step** — both are interfaces. Changing either means grepping the skills for the agent's name and updating the `Expect back` line that reads it.
- **Keep the tables in sync**: the stage table appears in `PIPELINE.md` and `README.md`, and the pipeline chain line appears in every `SKILL.md`. Adding or renaming a stage means touching all of them.

### Before committing a change

```bash
node --test scripts/docs-lint.test.mjs                    # the validator's own suite
node scripts/docs-lint.mjs <a project using the pipeline> # against real documents
claude plugin validate .                                  # manifest + skill frontmatter
npx prettier --check <the files you touched>              # the host repo formats these
```

`claude plugin validate` reports one **expected warning**: "CLAUDE.md at the plugin root is not loaded as project context." That is correct and deliberate — this file is for whoever edits the plugin, in the repo that hosts it, where it loads as ordinary nested project context. It is not meant to reach an installed copy, and the fix the warning suggests (turn it into a skill) would put plugin-maintenance instructions into the user's skill list. Run `--strict` only when you want that warning to fail the command.

Then bump `version` in `.claude-plugin/plugin.json` and add the entry at the top of `CHANGELOG.md` under the same number — the manifest and the changelog are the only two places a version is named, and one without the other is exactly how 2.3.0 and 2.3.1 drifted apart. Commit subject: `bldprj: <what changed>`.

### Installed two ways

Both routes — marketplace and skills directory — are in `README.md`, Installing. The one thing the host repo has to do itself on the skills-directory route: link the agents too, `.claude/agents/<name>.md` → `../../plugins/bldprj/agents/<name>.md`, because a skills directory loads **skills only** and a plugin's `agents/` folder is scanned for installed plugins alone — otherwise every delegation falls silently to the inline level; `/agents` says which happened. Never both routes in one project — the pipeline would load twice.

## Known gaps

- **`checkMap` matches the map heading anywhere in the file**, so a document merely mentioning "Decision map" passes the check that it has one.
- **`checkCitations` reads ids from a document's text**, so an id inside a fenced code block or an illustrative example counts as a citation. Harmless today, since neither research nor threats documents ship examples of foreign ids.
- **Nothing checks the `## Revisions` sections against each other** — a research round recorded with no corresponding threats round is invisible to the linter, and only `pre-issues` would notice.
- **Nothing checks a delegation against the agents that exist.** A `**Delegate**` line naming an agent this plugin does not ship, or a shipped agent no step ever names, is invisible: `claude plugin validate .` parses agent frontmatter, but the wiring between a step and its agent lives only in prose.
- **`build-phase`, `issues` and `close-feature` are unlinted**: they act on GitHub, and their invariants live only in prose.
- **Nothing checks a `**Verified by**` line against the project docs it cites** — only that a phase has one. A line that has drifted from the host's `CLAUDE.md` is `pre-issues`' conflict class 10 to catch, by reading, and nothing mechanical backs it up.
- **The `tests:` marker is matched at the head of a task's description**, so a building task whose description happens to open by discussing tests would read as test-only and slip the ceiling. The marker is a contract, not a heuristic, and the linter treats it as one.

Update this file when a stage, an artifact name or an invariant moves — not for wording changes inside a skill. A release is recorded in `CHANGELOG.md`, not here.
