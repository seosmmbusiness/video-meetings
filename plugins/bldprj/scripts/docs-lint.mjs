#!/usr/bin/env node
/**
 * Checks the invariants this plugin's pipeline (`../PIPELINE.md`) states in prose:
 * key uniqueness, task numbering, label and phase-title lengths, acceptance-criteria
 * coverage and duplicates, D-/S- citation integrity, plan ↔ final ↔ backlog
 * agreement (including a backlog published from a superseded FINAL), and
 * resolvable links that stay inside the project.
 *
 * Usage: `node docs-lint.mjs [project-dir]` — exits 1 when an error is found,
 * 0 on warnings only.
 *
 * The script ships inside the plugin, so it cannot infer the project from its own
 * location: the project root is the first argument, else `$CLAUDE_PROJECT_DIR`, else
 * the working directory.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, sep } from 'node:path';

const ROOT = resolve(
  process.argv[2] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
);
const DOCS = join(ROOT, 'docs');
const MAX_LABEL = 60;
const MAX_PHASE_TITLE = 50;
const MAX_TASKS_PER_PHASE = 5;
const PHASE_STATUSES = ['pending', 'in-progress', 'in-review', 'completed'];

/** @type {{ level: 'error' | 'warn', file: string, line: number | null, message: string }[]} */
const findings = [];

/**
 * Records a problem against a file.
 * @param {'error' | 'warn'} level Whether the problem fails the run.
 * @param {string} file Absolute path of the file the problem sits in.
 * @param {number | null} line 1-based line number, or null when it is a whole-file problem.
 * @param {string} message What is wrong, in one line.
 * @returns {void}
 */
function report(level, file, line, message) {
  findings.push({ level, file: relative(ROOT, file), line, message });
}

/**
 * Lists the immediate subdirectories of a directory.
 * @param {string} dir Directory to list.
 * @returns {string[]} Absolute paths of the subdirectories, empty when dir is missing.
 */
function subdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory());
}

/**
 * Reads a file and splits it into lines.
 * @param {string} file Absolute path to read.
 * @returns {{ text: string, lines: string[] }} The raw text and its lines.
 */
function readLines(file) {
  const text = readFileSync(file, 'utf8');
  return { text, lines: text.split('\n') };
}

/**
 * Finds the value of a `**Field**: value` header line.
 * @param {string[]} lines Lines of the document.
 * @param {string} field Field name without the asterisks.
 * @returns {string | null} The trimmed value, or null when the field is absent.
 */
function header(lines, field) {
  const match = lines.find((line) => line.startsWith(`**${field}**:`));
  return match ? match.slice(match.indexOf(':') + 1).trim() : null;
}

/**
 * Resolves a path written in a document against the project root.
 * @param {string} path Relative path as a document states it.
 * @returns {string | null} The absolute path, or null when it escapes the root.
 */
function insideRoot(path) {
  const abs = resolve(ROOT, path);
  return abs === ROOT || abs.startsWith(ROOT + sep) ? abs : null;
}

/**
 * Collects the documents of one track inside a feature folder.
 * @param {string} folder Absolute path of the `docs/<slug>` folder.
 * @param {'feature' | 'refactor'} track Which track's files to collect.
 * @returns {{ slug: string, track: string, prd: string | null, plans: string[], finals: string[], research: string | null, threats: string | null, ms: string | null }} The track's files.
 */
function collectTrack(folder, track) {
  const slug = folder.split('/').pop();
  const infix = track === 'refactor' ? '-REFACTOR' : '';
  const names = readdirSync(folder);
  /**
   * Resolves one document by its suffix, keeping the tracks apart.
   * @param {string} suffix Filename suffix after the slug.
   * @returns {string | null} Absolute path, or null when absent.
   */
  const pick = (suffix) => {
    const name = `${slug}${infix}${suffix}`;
    return names.includes(name) ? join(folder, name) : null;
  };
  /**
   * Collects every version of one versioned document, oldest first.
   * @param {string} kind Document name between the slug and the version — `PLAN` or `FINAL`.
   * @returns {string[]} Absolute paths, ordered by version.
   */
  const versions = (kind) => {
    const pattern = new RegExp(`^${slug}${infix}-${kind}(-v(\\d+))?\\.md$`);
    return names
      .filter((name) => pattern.test(name))
      .filter((name) => track === 'refactor' || !name.includes('-REFACTOR-'))
      .sort((a, b) => docVersion(a, pattern) - docVersion(b, pattern))
      .map((name) => join(folder, name));
  };
  return {
    slug,
    track,
    prd: pick('-PRD.md'),
    plans: versions('PLAN'),
    finals: versions('FINAL'),
    research: pick('-RESEARCH.md'),
    threats: pick('-THREATS.md'),
    ms: pick('-MS.json'),
  };
}

/**
 * Reads the version number out of a plan or final-plan filename.
 * @param {string} name Filename of the document.
 * @param {RegExp} pattern Pattern with the version in group 2.
 * @returns {number} The version, 1 for the unsuffixed document.
 */
function docVersion(name, pattern) {
  const match = name.match(pattern);
  return match && match[2] ? Number(match[2]) : 1;
}

/**
 * Parses a plan into phases with their tasks.
 * @param {string} file Absolute path of the plan.
 * @returns {{ number: string, title: string, line: number, covers: string[], tasks: { number: string, label: string, state: string, line: number }[] }[]} The phases in file order.
 */
function parsePlan(file) {
  const { lines } = readLines(file);
  const phases = [];
  let current = null;
  lines.forEach((raw, index) => {
    const phaseMatch = raw.match(/^##\s+Phase\s+(R?\d+)\.\s*(.+?)\s*$/);
    if (phaseMatch) {
      current = {
        number: phaseMatch[1],
        title: phaseMatch[2],
        line: index + 1,
        covers: [],
        tasks: [],
      };
      phases.push(current);
      return;
    }
    if (!current) return;
    if (raw.startsWith('**Covers**:')) {
      current.covers = [...raw.matchAll(/AC-\d+/g)].map((match) => match[0]);
      return;
    }
    const taskMatch = raw.match(
      /^\s*-\s+\[( |x|~)\]\s+\*\*(R?\d+\.\d+)\*\*\s+(.*)$/,
    );
    if (taskMatch) {
      const [, state, number, rest] = taskMatch;
      const label = rest.split(' — ')[0].trim();
      current.tasks.push({ number, label, state, line: index + 1 });
    }
  });
  return phases;
}

/**
 * Checks one plan file on its own terms: numbering, sizes, and the phase titles.
 * @param {string} file Absolute path of the plan.
 * @param {ReturnType<typeof parsePlan>} phases Parsed phases of that plan.
 * @returns {void}
 */
function checkPlanShape(file, phases) {
  if (phases.length === 0) {
    report('error', file, null, 'no `## Phase <n>. <title>` heading found');
    return;
  }
  for (const phase of phases) {
    if (phase.title.length > MAX_PHASE_TITLE) {
      report(
        'error',
        file,
        phase.line,
        `phase title is ${phase.title.length} chars, over the ${MAX_PHASE_TITLE} a milestone title allows`,
      );
    }
    const live = phase.tasks.filter((task) => task.state !== '~');
    if (live.length > MAX_TASKS_PER_PHASE) {
      report(
        'error',
        file,
        phase.line,
        `phase ${phase.number} carries ${live.length} live tasks, over the ${MAX_TASKS_PER_PHASE} a phase allows`,
      );
    }
    if (phase.tasks.length === 0) {
      report('warn', file, phase.line, `phase ${phase.number} has no tasks`);
    }
    const seen = new Set();
    const indexes = [];
    for (const task of phase.tasks) {
      const [phaseNumber, taskIndex] = task.number.split('.');
      if (phaseNumber !== phase.number) {
        report(
          'error',
          file,
          task.line,
          `task ${task.number} sits under phase ${phase.number}`,
        );
      }
      if (seen.has(task.number)) {
        report(
          'error',
          file,
          task.line,
          `task ${task.number} is numbered twice`,
        );
      }
      seen.add(task.number);
      indexes.push(Number(taskIndex));
      if (task.label.length > MAX_LABEL) {
        report(
          'error',
          file,
          task.line,
          `label of ${task.number} is ${task.label.length} chars, over the ${MAX_LABEL} an issue title allows`,
        );
      }
      if (task.label.endsWith('.')) {
        report(
          'warn',
          file,
          task.line,
          `label of ${task.number} ends with a period`,
        );
      }
    }
    indexes.sort((a, b) => a - b);
    if (indexes.some((value, position) => value !== position + 1)) {
      report(
        'warn',
        file,
        phase.line,
        `phase ${phase.number} numbers its tasks ${indexes.join(', ')} — a dropped task stays as - [~]`,
      );
    }
  }
}

/**
 * Checks that every live acceptance criterion in the PRD is covered by a phase.
 * @param {string} prd Absolute path of the PRD.
 * @param {string} buildable Absolute path of the document the backlog is built from.
 * @param {ReturnType<typeof parsePlan>} phases Parsed phases of that document.
 * @returns {void}
 */
function checkCoverage(prd, buildable, phases) {
  const { lines } = readLines(prd);
  const defined = new Set();
  const retired = new Set();
  lines.forEach((raw, index) => {
    const match = raw.match(/^\s*-\s+\[( |x|~)\]\s+\*\*(AC-\d+)\*\*/);
    if (!match) return;
    const [, state, criterion] = match;
    if (defined.has(criterion)) {
      report('error', prd, index + 1, `${criterion} is defined twice`);
    }
    defined.add(criterion);
    if (state === '~') retired.add(criterion);
  });
  if (defined.size === 0) {
    report('warn', prd, null, 'no `**AC-<n>**` acceptance criteria found');
    return;
  }
  const covered = new Set(phases.flatMap((phase) => phase.covers));
  for (const criterion of defined) {
    if (retired.has(criterion)) continue;
    if (!covered.has(criterion)) {
      report(
        'error',
        buildable,
        null,
        `${criterion} is in the PRD but in no phase's **Covers**`,
      );
    }
  }
  for (const claim of covered) {
    if (retired.has(claim)) {
      report(
        'warn',
        buildable,
        null,
        `**Covers** names ${claim}, which a ruling retired in the PRD`,
      );
    } else if (!defined.has(claim)) {
      report(
        'error',
        buildable,
        null,
        `**Covers** names ${claim}, which the PRD does not define`,
      );
    }
  }
}

/**
 * Checks that the final plan carried every live task of the plan it consolidated.
 * @param {string} plan Absolute path of the current plan.
 * @param {ReturnType<typeof parsePlan>} planPhases Parsed phases of that plan.
 * @param {string} final Absolute path of the current final plan.
 * @param {ReturnType<typeof parsePlan>} finalPhases Parsed phases of that final plan.
 * @returns {void}
 */
function checkCarriedTasks(plan, planPhases, final, finalPhases) {
  const carried = new Set(
    finalPhases.flatMap((phase) => phase.tasks.map((task) => task.number)),
  );
  for (const phase of planPhases) {
    for (const task of phase.tasks) {
      if (task.state === '~' || carried.has(task.number)) continue;
      report(
        'error',
        final,
        null,
        `task ${task.number} is live in ${basename(plan)} and absent here — a dropped task stays as - [~]`,
      );
    }
  }
}

/**
 * Checks the MS file against the document it was published from.
 * @param {string} ms Absolute path of the MS file.
 * @param {ReturnType<typeof parsePlan>} phases Parsed phases of the document named in sources.
 * @returns {void}
 */
function checkBacklog(ms, phases) {
  let data;
  try {
    data = JSON.parse(readFileSync(ms, 'utf8'));
  } catch (error) {
    report('error', ms, null, `is not valid JSON: ${error.message}`);
    return;
  }
  for (const [name, path] of Object.entries(data.sources ?? {})) {
    if (typeof path !== 'string' || !path.endsWith('.md')) continue;
    const abs = insideRoot(path);
    if (!abs) {
      report(
        'error',
        ms,
        null,
        `sources.${name} points at ${path}, which escapes the project root`,
      );
    } else if (!existsSync(abs)) {
      report(
        'error',
        ms,
        null,
        `sources.${name} points at ${path}, which does not exist`,
      );
    }
  }
  if (!data.sources?.final) {
    report(
      'error',
      ms,
      null,
      'sources.final is missing — build-phase reads its phases and tasks from it',
    );
  }
  const liveTasks = new Set(
    phases.flatMap((phase) =>
      phase.tasks
        .filter((task) => task.state !== '~')
        .map((task) => task.number),
    ),
  );
  const published = new Set();
  for (const phase of data.phases ?? []) {
    if (phase.status && !PHASE_STATUSES.includes(phase.status)) {
      report(
        'error',
        ms,
        null,
        `phase ${phase.phase} has status "${phase.status}", outside ${PHASE_STATUSES.join(' → ')}`,
      );
    }
    if (
      phase.status === 'completed' &&
      phase.pr &&
      phase.pr.state !== 'merged'
    ) {
      report(
        'error',
        ms,
        null,
        `phase ${phase.phase} is completed while its PR state is "${phase.pr.state}" — a phase settles on a merge`,
      );
    }
    for (const issue of phase.issues ?? []) {
      published.add(issue.task);
      if (!liveTasks.has(issue.task)) {
        report(
          'error',
          ms,
          null,
          `issue #${issue.number} claims task ${issue.task}, which the final plan no longer has live`,
        );
      }
    }
  }
  for (const task of liveTasks) {
    if (!published.has(task)) {
      report(
        'warn',
        ms,
        null,
        `task ${task} has no issue — re-run /issues on the current final plan`,
      );
    }
  }
  const pending = (data.phases ?? []).find(
    (phase) => phase.status === 'pending',
  );
  const next = data.progress?.nextPhase;
  if (pending && next && String(next.phase) !== String(pending.phase)) {
    report(
      'error',
      ms,
      null,
      `progress.nextPhase points at phase ${next.phase}, but phase ${pending.phase} is the first still pending`,
    );
  }
}

/**
 * Checks that every relative markdown link in a document resolves.
 * @param {string} file Absolute path of the document.
 * @returns {void}
 */
function checkLinks(file) {
  const { lines } = readLines(file);
  lines.forEach((raw, index) => {
    for (const match of raw.matchAll(/\]\((\.[^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target && !existsSync(resolve(dirname(file), target))) {
        report('error', file, index + 1, `link to ${target} does not resolve`);
      }
    }
  });
}

/**
 * Checks that every D-/S- id the buildable document cites is actually defined
 * where it is minted, so build-phase never loads a phase against a dangling id.
 * @param {string} buildable Absolute path of the plan or FINAL later stages read.
 * @param {string | null} research Absolute path of the research file, when present.
 * @param {string | null} threats Absolute path of the threats file, when present.
 * @returns {void}
 */
function checkCitations(buildable, research, threats) {
  /**
   * Collects the ids a document defines as `### <id>.` blocks.
   * @param {string | null} file Absolute path of the defining document.
   * @param {RegExp} pattern Pattern with the id in group 1.
   * @returns {Set<string>} The defined ids, empty when the file is absent.
   */
  const ids = (file, pattern) =>
    file
      ? new Set(
          [...readLines(file).text.matchAll(pattern)].map((match) => match[1]),
        )
      : new Set();
  const sources = {
    D: {
      known: ids(research, /^###\s+(D-\d+)\./gm),
      file: research,
      stage: 'research',
    },
    S: {
      known: ids(threats, /^###\s+(S-\d+)\./gm),
      file: threats,
      stage: 'threats',
    },
  };
  readLines(buildable).lines.forEach((raw, index) => {
    if (!raw.startsWith('**Decisions**:') && !raw.startsWith('**Threats**:'))
      return;
    for (const match of raw.matchAll(/\b([DS]-\d+)\b/g)) {
      const id = match[1];
      const { known, file, stage } = sources[id[0]];
      if (!file) {
        report(
          'error',
          buildable,
          index + 1,
          `cites ${id} but there is no ${stage} file beside it`,
        );
      } else if (!known.has(id)) {
        report(
          'error',
          buildable,
          index + 1,
          `cites ${id}, which ${basename(file)} does not define`,
        );
      }
    }
  });
}

/**
 * Checks that a document carries the map the stages after it read.
 * @param {string | null} file Absolute path of the research or threats file.
 * @param {string} mapName Heading the map sits under.
 * @param {ReturnType<typeof parsePlan>} phases Phases the map has to name.
 * @returns {void}
 */
function checkMap(file, mapName, phases) {
  if (!file) return;
  const { text } = readLines(file);
  if (!new RegExp(mapName, 'i').test(text)) {
    report(
      'warn',
      file,
      null,
      `has no ${mapName} — issues and build-phase read a phase's ids from it`,
    );
    return;
  }
  for (const phase of phases) {
    if (!new RegExp(`\\|\\s*${phase.number}\\s*\\|`).test(text)) {
      report(
        'warn',
        file,
        null,
        `${mapName} has no row for phase ${phase.number}`,
      );
    }
  }
}

/**
 * Runs every check over one track of one feature folder.
 * @param {ReturnType<typeof collectTrack>} track The track's collected files.
 * @param {Map<string, string>} keys Key → folder, for the uniqueness check.
 * @returns {void}
 */
function checkTrack(track, keys) {
  if (!track.prd && track.plans.length === 0) return;
  if (!track.prd) {
    report(
      'error',
      track.plans[0],
      null,
      `has no ${track.track} PRD beside it`,
    );
    return;
  }
  const prdLines = readLines(track.prd).lines;
  const key = header(prdLines, 'Key');
  if (!key || !/^[A-Z]{2,4}$/.test(key)) {
    report(
      'error',
      track.prd,
      null,
      `**Key** is "${key ?? 'missing'}" — 2–4 uppercase letters`,
    );
  } else {
    const owner = keys.get(key);
    if (owner && owner !== track.slug) {
      report(
        'error',
        track.prd,
        null,
        `key ${key} is already taken by docs/${owner}`,
      );
    }
    keys.set(key, track.slug);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header(prdLines, 'Date') ?? '')) {
    report('warn', track.prd, null, '**Date** is missing or is not YYYY-MM-DD');
  }
  for (const file of [
    track.prd,
    ...track.plans,
    ...track.finals,
    track.research,
    track.threats,
  ]) {
    if (!file) continue;
    checkLinks(file);
    if (!/^##\s+Asked & assumed/m.test(readLines(file).text)) {
      report('warn', file, null, 'has no `## Asked & assumed` section');
    }
  }
  if (track.plans.length === 0 && track.finals.length === 0) return;

  // The plan is exactly one file, revised in place (PIPELINE.md, Versions):
  // a versioned plan file is a leftover from a retired contract.
  for (const plan of track.plans.filter((p) => /-PLAN-v\d+\.md$/.test(p))) {
    report(
      'error',
      plan,
      null,
      'plan versions are not part of the contract — the plan is revised in place, with its history in ## Revisions',
    );
  }
  const currentPlan =
    track.plans.find((p) => !/-PLAN-v\d+\.md$/.test(p)) ??
    track.plans[track.plans.length - 1] ??
    null;
  const currentFinal = track.finals[track.finals.length - 1] ?? null;

  // The plan is superseded by the FINAL `pre-issues` consolidated it into,
  // and every FINAL version by the next one.
  /** @type {[string, string][]} */
  const superseded = [];
  if (currentPlan && currentFinal) superseded.push([currentPlan, currentFinal]);
  track.finals.slice(0, -1).forEach((final, index) => {
    superseded.push([final, track.finals[index + 1]]);
  });
  for (const [document, next] of superseded) {
    if (!readLines(document).text.includes('superseded by')) {
      report(
        'error',
        document,
        null,
        `does not say it is superseded by ${basename(next)}`,
      );
    }
  }
  const planPhases = currentPlan ? parsePlan(currentPlan) : null;
  if (currentPlan) {
    checkPlanShape(currentPlan, planPhases);
  } else {
    report(
      'warn',
      currentFinal,
      null,
      'has no plan beside it — the preliminary cut is part of the record',
    );
  }

  // The final plan supersedes the preliminary one: once it exists, it is the
  // document `issues` publishes and `build-phase` builds from.
  const buildable = currentFinal ?? currentPlan;
  const phases = currentFinal ? parsePlan(currentFinal) : planPhases;
  if (currentFinal) {
    checkPlanShape(currentFinal, phases);
    if (currentPlan) {
      checkCarriedTasks(currentPlan, planPhases, currentFinal, phases);
    }
  }
  checkCoverage(track.prd, buildable, phases);
  checkCitations(buildable, track.research, track.threats);
  checkMap(track.research, 'Decision map', phases);
  checkMap(track.threats, 'Threat map', phases);
  if (track.ms) {
    let data = null;
    try {
      data = JSON.parse(readFileSync(track.ms, 'utf8'));
    } catch {
      data = null; // checkBacklog reports the parse failure itself.
    }
    const publishedFinal = data?.sources?.final
      ? insideRoot(data.sources.final)
      : null;
    if (publishedFinal && currentFinal && publishedFinal !== currentFinal) {
      report(
        'error',
        track.ms,
        null,
        `sources.final points at ${basename(publishedFinal)} while ${basename(currentFinal)} is current — re-run /bldprj:issues on it`,
      );
    }
    const source = data?.sources?.final ?? data?.sources?.plan;
    const published = typeof source === 'string' ? insideRoot(source) : null;
    checkBacklog(
      track.ms,
      published && existsSync(published) ? parsePlan(published) : phases,
    );
  }
}

/**
 * Checks that the docs index has exactly one resolvable row per feature folder.
 * @param {string[]} folders Absolute paths of the feature folders.
 * @returns {void}
 */
function checkIndex(folders) {
  const index = join(DOCS, 'INDEX.md');
  if (!existsSync(index)) {
    if (folders.length > 0)
      report('warn', DOCS, null, 'INDEX.md is missing — the PRD opens it');
    return;
  }
  const { text } = readLines(index);
  for (const folder of folders) {
    const slug = folder.split('/').pop();
    const rows = text
      .split('\n')
      .filter((line) => line.includes(`${slug}/${slug}-`));
    if (rows.length === 0)
      report('error', index, null, `has no row for ${slug}`);
    if (rows.length > 1)
      report('error', index, null, `has ${rows.length} rows for ${slug}`);
  }
  readLines(index).lines.forEach((raw, position) => {
    for (const match of raw.matchAll(/\]\(([^)\s#]+)\)/g)) {
      if (match[1].startsWith('http')) continue;
      if (!existsSync(resolve(DOCS, match[1]))) {
        report(
          'error',
          index,
          position + 1,
          `link to ${match[1]} does not resolve`,
        );
      }
    }
  });
}

/**
 * Runs the whole check and prints what it found.
 * @returns {void}
 */
function main() {
  const folders = [...subdirs(DOCS), ...subdirs(join(DOCS, 'archive'))].filter(
    (folder) => !folder.endsWith('/archive'),
  );
  if (folders.length === 0) {
    // A wrong project root looks exactly like a project with no documents yet,
    // so say which root was checked when nothing about it looks like a project.
    const hint = existsSync(join(ROOT, 'package.json'))
      ? ''
      : ' (no package.json there either — pass the project directory as the first argument)';
    const shown = relative(process.cwd(), DOCS);
    const where = !shown || shown.startsWith('..') ? DOCS : shown;
    console.log(
      `docs-lint: no feature folders under ${where} — nothing to check.${hint}`,
    );
    return;
  }
  const keys = new Map();
  for (const folder of folders) {
    checkTrack(collectTrack(folder, 'feature'), keys);
    checkTrack(collectTrack(folder, 'refactor'), keys);
  }
  checkIndex(
    folders.filter((folder) =>
      readdirSync(folder).some((name) => name.endsWith('PRD.md')),
    ),
  );

  const errors = findings.filter((finding) => finding.level === 'error');
  for (const finding of findings) {
    const where = finding.line
      ? `${finding.file}:${finding.line}`
      : finding.file;
    console.log(
      `${finding.level === 'error' ? 'error' : ' warn'}  ${where} — ${finding.message}`,
    );
  }
  const checked = `${folders.length} feature folder${folders.length === 1 ? '' : 's'}`;
  console.log(
    `docs-lint: ${checked}, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${findings.length - errors.length} warning${findings.length - errors.length === 1 ? '' : 's'}.`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

main();
