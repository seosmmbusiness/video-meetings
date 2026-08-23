'use strict';

/**
 * What work is open, and which of it the loop is able to take.
 *
 * The chain itself only ever knows one feature: the one its config names. This module is what
 * answers the question that comes after that feature is finished — what else is open, and where
 * should the next run start. It reads three sources, in the order the loop trusts them:
 *
 * 1. **Open milestones on GitHub** — work somebody has already cut into issues. A milestone maps
 *    back to a phase through the MS file that created it, so taking one is taking that phase.
 * 2. **Phases in the plans** — an MS file whose phase is not `completed` but whose milestone is
 *    closed or missing. The plan holds the work; GitHub does not have it open.
 * 3. **A feature whose phases have all settled** but which was never closed out — the close-out is
 *    the work that remains.
 *
 * Issues outside all of that — no milestone, no MS file — are reported and never offered: the loop's
 * whole contract is a phase's Done when, Verified by and FINAL block, and an issue that has none of
 * them has nothing for a session to work against.
 *
 * Nothing here writes to GitHub, and nothing decides on its own: a person picks, and the pick is
 * saved so the run continues to the end of what was picked.
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('./lib');

/** Directories under `docs/` that never hold live work. */
const NOT_WORK = new Set(['archive', 'modules']);

/**
 * Every live MS file in the repository, newest plan last.
 *
 * @param {string} root The repository root.
 * @returns {Array<{ file: string, doc: object }>} Each MS file's repo-relative path and contents.
 */
function msFiles(root) {
  const docs = path.join(root, 'docs');
  let entries = [];
  try {
    entries = fs.readdirSync(docs, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || NOT_WORK.has(entry.name)) continue;
    let names = [];
    try {
      names = fs.readdirSync(path.join(docs, entry.name));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith('-MS.json'))) {
      const file = path.join('docs', entry.name, name);
      try {
        found.push({
          file,
          doc: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')),
        });
      } catch {
        // A half-written or hand-edited MS file is not work the loop can take; the pipeline's own
        // linter is where that gets reported, not here.
      }
    }
  }
  return found;
}

/**
 * The `Touches` line a FINAL plan gives one phase.
 *
 * @param {string} text The FINAL plan.
 * @param {number} phase The phase number.
 * @returns {string|null} What that phase touches, or `null` when the plan does not say.
 */
function touchesOf(text, phase) {
  // Split rather than one regex: the last phase's block has no `## ` after it to stop at, and the
  // lookahead that would have handled that was quietly matching a literal Z.
  const block = String(text || '')
    .split(/^## /m)
    .find((section) => new RegExp(`^Phase ${phase}\\.`).test(section));
  if (!block) return null;
  const touches = block.match(/^\*\*Touches\*\*:\s*(.+)$/m);
  return touches ? touches[1].trim() : null;
}

/**
 * The per-phase config the merge gate needs, read off the plan rather than hand-written.
 *
 * `layer` selects the check set; `needsDb` decides whether the gate brings Postgres up first. A
 * phase the plan says nothing about gets the careful answer — the API check set, with the database
 * — because a check set that is too wide costs minutes and one that is too narrow merges untested
 * code.
 *
 * @param {string} finalText The feature's FINAL plan.
 * @param {object} doc The parsed MS file.
 * @returns {Array<{ phase: number, layer: string, needsDb: boolean }>} One entry per phase.
 */
function phasesFromFinal(finalText, doc) {
  return (doc.phases || []).map((phase) => {
    const touches = touchesOf(finalText, phase.phase);
    if (!touches) return { phase: phase.phase, layer: 'api', needsDb: true };
    return {
      phase: phase.phase,
      layer: /\bweb\b/i.test(touches) ? 'web' : 'api',
      needsDb: /\b(api|web|database|storage|db)\b/i.test(touches),
    };
  });
}

/**
 * The FINAL plan an MS file names, from wherever it now lives.
 *
 * @param {string} root The repository root.
 * @param {object} doc The parsed MS file.
 * @returns {string} The plan's text, or an empty string when it cannot be read.
 */
function readFinal(root, doc) {
  const named = doc.sources && doc.sources.final;
  if (!named) return '';
  for (const candidate of [named, named.replace(/^docs\//, 'docs/archive/')]) {
    try {
      return fs.readFileSync(path.join(root, candidate), 'utf8');
    } catch {
      // Try the archive, then give up: the defaults in `phasesFromFinal` cover a missing plan.
    }
  }
  return '';
}

/**
 * Everything that is open, in the order the loop would take it.
 *
 * @param {object} [deps] `{ root, gh }`, injected by the suite.
 * @returns {{ candidates: Array<object>, loose: Array<object>, empty: boolean }} The survey.
 */
function survey(deps = {}) {
  const root = deps.root || lib.ROOT;
  const gh = deps.gh || lib.gh;

  let milestones = [];
  try {
    milestones =
      gh([
        'api',
        'repos/{owner}/{repo}/milestones',
        '--paginate',
        '--state',
        'open',
      ]) || [];
  } catch {
    milestones = [];
  }

  let issues = [];
  try {
    issues =
      gh([
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number,title,milestone',
      ]) || [];
  } catch {
    issues = [];
  }

  const openMilestones = new Map(milestones.map((m) => [m.number, m]));
  const candidates = [];

  for (const { file, doc } of msFiles(root)) {
    const phases = doc.phases || [];
    const unfinished = phases.filter((p) => p.status !== 'completed');
    if (!phases.length) continue;
    if (!unfinished.length) {
      candidates.push({
        kind: 'closeout',
        feature: doc.feature,
        ms: file,
        phase: null,
        milestone: null,
        title: `every phase settled — ${doc.feature} is waiting to be closed out`,
        status: 'completed',
        open: 0,
      });
      continue;
    }
    for (const phase of unfinished) {
      const milestone =
        phase.milestone && openMilestones.get(phase.milestone.number);
      candidates.push({
        kind: milestone ? 'milestone' : 'phase',
        feature: doc.feature,
        ms: file,
        phase: phase.phase,
        milestone: phase.milestone || null,
        title: phase.title,
        status: phase.status,
        open: milestone ? milestone.open_issues : null,
      });
    }
  }

  const order = { milestone: 0, phase: 1, closeout: 2 };
  candidates.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.feature.localeCompare(b.feature) ||
      (a.phase || 0) - (b.phase || 0),
  );

  return {
    candidates,
    loose: issues.filter((issue) => !issue.milestone),
    empty: candidates.length === 0,
  };
}

/**
 * The survey as a person reads it — one numbered line per thing the loop can start.
 *
 * @param {object} work What `survey` returned.
 * @returns {string} The report.
 */
function describe(work) {
  const lines = [];
  if (work.empty) {
    lines.push('Nothing open — no milestone, phase or feature is waiting.');
  } else {
    lines.push('Open work, in the order the loop would take it:');
    work.candidates.forEach((c, i) => {
      const head =
        c.kind === 'milestone'
          ? `milestone #${c.milestone.number} "${c.milestone.title}" · ${c.feature} phase ${c.phase}`
          : c.kind === 'phase'
            ? `phase ${c.phase} of ${c.feature} (${c.status}, no open milestone)`
            : `close-out ${c.feature}`;
      const tail =
        c.kind === 'milestone'
          ? ` · ${c.open} open issue${c.open === 1 ? '' : 's'}`
          : '';
      const what = c.kind === 'closeout' ? '' : ` — ${c.title}`;
      lines.push(`  ${i + 1}) ${head}${tail}${what}`);
    });
  }
  if (work.loose.length) {
    lines.push('');
    lines.push(
      'Outside the pipeline — no milestone and no plan, so the loop cannot take them:',
    );
    for (const issue of work.loose)
      lines.push(`  · #${issue.number} ${issue.title}`);
  }
  return lines.join('\n');
}

/**
 * Saves a pick so the run works it to the end, and says where the chain starts.
 *
 * The pick goes into the run's overrides rather than the committed config: it belongs to this run,
 * not to the repository, and the config's own `feature`/`ms` stay whatever was committed.
 *
 * @param {object} candidate One entry from `survey().candidates`.
 * @param {object} [deps] `{ root, writeOverrides }`, injected by the suite.
 * @returns {{ phaseIndex: number, selection: object, phases: Array<object> }} Where to start, and
 *   what was chosen.
 * @throws {Error} When the candidate's MS file cannot be read.
 */
function selectWork(candidate, deps = {}) {
  const root = deps.root || lib.ROOT;
  const write = deps.writeOverrides || lib.writeOverrides;
  const doc = JSON.parse(
    fs.readFileSync(path.join(root, candidate.ms), 'utf8'),
  );
  const phases = phasesFromFinal(readFinal(root, doc), doc);
  write({ feature: doc.feature, ms: candidate.ms, phases });

  const phaseIndex =
    candidate.kind === 'closeout'
      ? doc.phases.length
      : doc.phases.findIndex((p) => p.phase === candidate.phase);

  return {
    phaseIndex,
    phases,
    selection: {
      kind: candidate.kind,
      feature: doc.feature,
      ms: candidate.ms,
      phase: candidate.phase || null,
      milestone: candidate.milestone || null,
      // A milestone or a phase is one phase's worth of work: the chain settles it and stops there.
      // A close-out is the end of a feature, and runs to the end of the feature.
      stopAfterPhase: candidate.kind === 'closeout' ? null : candidate.phase,
      at: new Date().toISOString(),
    },
  };
}

module.exports = {
  describe,
  msFiles,
  phasesFromFinal,
  readFinal,
  selectWork,
  survey,
  touchesOf,
};
