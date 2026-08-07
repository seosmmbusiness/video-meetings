# bldprj — Build Project Pipeline

The document pipeline a feature or refactor is built through, packaged as one Claude Code plugin. Seven skills, one chain, one artifact per stage:

```
prd | refactor-prd  →  plan-phase  →  research  →  security-analyse  →  pre-issues  →  issues  →  build-phase
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

## Layout

```text
plugins/bldprj/
├── .claude-plugin/plugin.json   # manifest
├── PIPELINE.md                  # the contract all seven share: identity, versions, asking
├── REFACTOR-TRACK.md            # everything the refactor track does differently
├── skills/<name>/SKILL.md       # one skill per stage
└── scripts/docs-lint.mjs        # the validator behind `npm run docs:lint`
```

`PIPELINE.md` and `REFACTOR-TRACK.md` sit at the plugin root because every skill reads them; each `SKILL.md` points at them with `../../PIPELINE.md`.

## How it loads

The plugin's files live here, in `plugins/bldprj/`. Claude Code discovers a plugin when it finds a `.claude-plugin/plugin.json` under a **skills directory**, so this repo keeps a relative symlink pointing at that folder:

```text
.claude/skills/bldprj -> ../../plugins/bldprj
```

That is the whole install: the plugin loads as `bldprj@skills-dir`, in place, with no marketplace, no install command and no cache copy — so an edit to a `SKILL.md` here takes effect in the next session rather than after a plugin update. Its skills are invoked namespaced:

```
/bldprj:prd meeting file upload
/bldprj:plan-phase docs/meeting-file-upload/meeting-file-upload-PRD.md
```

Check that it loaded, and validate after editing the manifest or a skill's frontmatter:

```bash
claude plugin list                        # → bldprj@skills-dir  ✔ loaded
claude plugin validate ./plugins/bldprj --strict
```

### Using it in another project

The repo root carries a marketplace manifest (`.claude-plugin/marketplace.json`) listing this plugin, so another project on this machine can install it:

```bash
claude plugin marketplace add /path/to/video-meetings
claude plugin install bldprj@video-meetings-plugins --scope project
```

A marketplace install **copies** the plugin into `~/.claude/plugins/cache`, so edits made here reach that copy only after `claude plugin marketplace update` + `claude plugin update`, and the `version` in `plugin.json` is the update signal — bump it when you change a skill. Inside this repo, use the symlink and leave the marketplace alone; installing it here too would load the pipeline twice.

The other zero-install option is personal rather than per-project: symlink this folder into `~/.claude/skills/` and it loads in every project you open.

## The validator

`scripts/docs-lint.mjs` checks what `PIPELINE.md` makes mechanical: key uniqueness, task numbering, label and phase-title lengths, acceptance-criteria coverage, plan ↔ final plan ↔ backlog agreement, and resolvable links.

It reads the project's `docs/` tree, which it cannot infer from its own location inside the plugin, so the project root comes from the first argument, else `$CLAUDE_PROJECT_DIR`, else the working directory:

```bash
npm run docs:lint                      # from the project root
node scripts/docs-lint.mjs ~/code/app  # against another project
```

Exit code 1 on an error, 0 on warnings only.

## What the skills assume about a project

The stages are project-agnostic; these conventions are not, and are what a new project has to provide:

- `docs/<slug>/` for the documents, `docs/INDEX.md` as their index, `docs/archive/<slug>/` for shipped work, and `docs/Features.md` / `docs/Refactor.md` as the human-readable logs.
- A `docs:lint` npm script pointing at `scripts/docs-lint.mjs`.
- `gh` authenticated against the repo, for `issues` and `build-phase`.
- Repo conventions the skills read rather than impose: root `CLAUDE.md`, per-app `CLAUDE.md`, and module docs indexed in `.claude/modules/INDEX.md`.
