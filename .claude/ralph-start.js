'use strict';

/**
 * Starts, or resumes, the Ralph loop.
 *
 * The chain advances itself from here: each link's Stop hook calls `advance()` in
 * `.claude/ralph/lib.js`, which spawns the next one. This script only makes sure the ground is fit
 * to start on, claims the run, and launches the first link — so a run that fails does so here, on a
 * terminal a person is looking at, rather than three sessions deep in a log file.
 *
 * Usage:
 *   node .claude/ralph-start.js                    start a fresh run from the first pending phase
 *   node .claude/ralph-start.js --dry-run          decide and print the first link, spawn nothing
 *   node .claude/ralph-start.js --resume           continue the run, clearing the halt and
 *                                                  granting its ceilings again
 *   node .claude/ralph-start.js --phase 2          start (or resume) at a specific phase number
 *   node .claude/ralph-start.js --status           print where the run got to, change nothing
 *   node .claude/ralph-start.js --pick [n]         list what is open and start the nth of it
 *   node .claude/ralph-start.js --watch            start it, then watch it in this terminal
 *   node .claude/ralph-start.js --ui [--port N]    start it, and open the dashboard as well
 *
 * The run itself never depends on a view: `--watch` and `--ui` only attach one to the chain the
 * other flags start, and closing it leaves the build running.
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('./ralph/lib');
const pick = require('./ralph/pick');

const argv = process.argv.slice(2);

/**
 * Whether a flag was passed.
 *
 * @param {string} name The flag, without its leading dashes.
 * @returns {boolean} True when present.
 */
function flag(name) {
  return argv.includes(`--${name}`);
}

/**
 * The value passed after a flag.
 *
 * @param {string} name The flag, without its leading dashes.
 * @returns {string|undefined} The following argument, when there is one.
 */
function option(name) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

/**
 * Refuses to start unless everything the first link needs is already true. Every check here is one
 * the loop cannot recover from on its own, which is why they are fatal rather than warnings.
 *
 * @param {object} config The loop config.
 * @param {object} [opts] `{ resuming }` — a resume stashes a dirty tree rather than refusing it.
 * @returns {string[]} The problems found; an empty array means the ground is fit.
 */
function preflight(config, opts = {}) {
  const problems = [];

  const status = lib.run('git', ['status', '--porcelain']);
  if (status.code !== 0)
    problems.push('git status failed — is this a repository?');
  else if (status.stdout.trim() && !opts.resuming) {
    problems.push(`the working tree is dirty:\n${status.stdout.trim()}`);
  }

  if (lib.run('gh', ['auth', 'status']).code !== 0) {
    problems.push('gh is not authenticated — run `gh auth login`');
  }

  try {
    const ms = lib.readMs(config);
    if (!Array.isArray(ms.phases) || !ms.phases.length)
      problems.push(`${config.ms} holds no phases`);
    if (!ms.sources || !ms.sources.final) {
      problems.push(
        `${config.ms} names no final plan — run /bldprj:pre-issues first`,
      );
    }
  } catch (err) {
    problems.push(`cannot read ${config.ms}: ${err.message}`);
  }

  if (
    !fs.existsSync(path.join(lib.ROOT, 'plugins/bldprj/scripts/docs-lint.mjs'))
  ) {
    problems.push(
      'plugins/bldprj/scripts/docs-lint.mjs is missing — the merge gate needs it',
    );
  }

  if (
    config.phases.some((p) => p.needsDb) &&
    lib.run('docker', ['compose', 'version']).code !== 0
  ) {
    problems.push('docker compose is unavailable, and a phase needs Postgres');
  }

  const lock = lib.readLock();
  if (lock && !flag('resume')) {
    problems.push(
      `run ${lock.runId} still holds the lock — pass --resume, or delete .claude/ralph.lock`,
    );
  }

  for (const label of ['ralph:done', 'ralph:blocked']) {
    const has = lib.run('gh', [
      'label',
      'list',
      '--search',
      label,
      '--json',
      'name',
    ]);
    if (has.code !== 0 || !has.stdout.includes(label)) {
      problems.push(
        `the ${label} label does not exist — run \`gh label create ${label}\``,
      );
    }
  }

  return problems;
}

/**
 * Reads one line from the terminal, when there is one to read.
 *
 * Synchronous on purpose: everything else this script does is, and a picker that turned the file
 * inside out to await a keystroke would be harder to follow than the question it asks.
 *
 * @param {string} question What to print before reading.
 * @returns {string} What was typed, trimmed; an empty string when there is no terminal.
 */
function askLine(question) {
  if (!process.stdin.isTTY) return '';
  process.stdout.write(question);
  const buffer = Buffer.alloc(256);
  try {
    const read = fs.readSync(0, buffer, 0, buffer.length, null);
    return buffer.subarray(0, read).toString('utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Surveys what is open, prints it, and starts what the person picked.
 *
 * @param {string|undefined} argument The `--pick` value, when one was given.
 * @returns {{ phaseIndex: number, selection: object }|null} What was chosen, or `null` when nothing
 *   is open or nobody chose.
 */
function pickWork(argument) {
  const work = pick.survey();
  process.stdout.write(`${pick.describe(work)}\n`);
  if (work.empty) return null;

  const typed =
    argument && /^\d+$/.test(argument)
      ? argument
      : askLine(
          `\nWhich one? [1-${work.candidates.length}, or enter to stop] `,
        );
  const at = Number(typed);
  if (
    !typed ||
    !Number.isInteger(at) ||
    at < 1 ||
    at > work.candidates.length
  ) {
    process.stdout.write(
      '\nNothing picked — start again with `--pick <n>` when you have decided.\n',
    );
    return null;
  }

  const chosen = pick.selectWork(work.candidates[at - 1]);
  const { selection } = chosen;
  process.stdout.write(
    `\n✓ ${selection.kind === 'closeout' ? `closing out ${selection.feature}` : `${selection.feature} phase ${selection.phase}`}` +
      `${selection.stopAfterPhase ? ` — the run stops once phase ${selection.stopAfterPhase} has settled` : ' — the run goes to the end of the feature'}\n\n`,
  );
  return chosen;
}

/**
 * The index of the first phase that is not yet completed.
 *
 * @param {object} ms The parsed MS file.
 * @returns {number} A zero-based index, or `ms.phases.length` when every phase has settled.
 */
function firstOpenPhase(ms) {
  const at = ms.phases.findIndex((p) => p.status !== 'completed');
  return at === -1 ? ms.phases.length : at;
}

/**
 * Prints where the run got to, without touching anything.
 *
 * @param {object} config The loop config.
 * @returns {void}
 */
function printStatus(config) {
  const state = lib.readState();
  if (!state) {
    process.stdout.write('No run state — nothing has been started.\n');
    return;
  }
  const ms = lib.readMs(config);
  process.stdout.write(
    `run ${state.runId} · active=${state.active} · phase ${state.phaseIndex + 1}/${ms.phases.length} · stage ${state.stage} · issue ${state.currentIssue ?? '—'} · ${state.sessions} sessions\n`,
  );
  ms.phases.forEach((p, i) => {
    process.stdout.write(
      `  ${i === state.phaseIndex ? '→' : ' '} phase ${p.phase} ${p.status}\n`,
    );
  });
  if (lib.stopRequested()) {
    process.stdout.write(
      `\nHALTED: ${fs.readFileSync(lib.STOP_PATH, 'utf8').trim() || 'no reason recorded'}\n`,
    );
  }
  if (lib.pauseRequested()) {
    process.stdout.write(
      `\nPAUSED: ${fs.readFileSync(lib.PAUSE_PATH, 'utf8').trim()}\n`,
    );
  }
  const hold = lib.readHold();
  if (hold) {
    process.stdout.write(
      `hold: ${lib.describeHold(hold)} — armed ${hold.armedAt}, not yet reached\n`,
    );
  }
  const overrides = lib.readOverrides();
  if (Object.keys(overrides).length) {
    process.stdout.write(
      `overrides: ${Object.entries(overrides)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ')}\n`,
    );
  }
  process.stdout.write(
    `logs: ${path.join('.claude/ralph-logs', String(state.runId))}\n`,
  );
}

// A dry run decides and prints every link it would spawn, and spawns none. `lib` reads this each
// time rather than at load, so setting it here reaches the spawn.
if (flag('dry-run')) process.env.RALPH_DRY_RUN = '1';

let config = lib.effectiveConfig();

if (flag('status')) {
  printStatus(config);
  process.exit(0);
}

const existingState = lib.readState();
const resumingRun = flag('resume') && existingState;

const problems = preflight(config, { resuming: Boolean(resumingRun) });
if (problems.length) {
  process.stdout.write(
    `Ralph will not start:\n${problems.map((p) => `  • ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}

let ms = lib.readMs(config);
const existing = existingState;
const resuming = resumingRun;

// Whether this feature still has anything for the chain to do. A feature whose phases have all
// settled is not finished — the close-out is the last link — but one whose documents have been
// archived is, and that is when the loop looks for what else is open rather than refusing to start.
const settledOut =
  ms.phases.every((phase) => phase.status === 'completed') &&
  (/^docs\/archive\//.test(config.ms) ||
    !fs.existsSync(path.join(lib.ROOT, config.ms)) ||
    Boolean(existing && existing.closeout && existing.closeout.mergedAt));

let selection = resuming && existing ? existing.selection || null : null;

if (flag('pick') || (settledOut && !flag('dry-run'))) {
  const chosen = pickWork(option('pick'));
  // Nothing open, or nothing picked, is not a failure — there is simply no run to start.
  if (!chosen) process.exit(0);
  selection = chosen.selection;
  config = lib.effectiveConfig();
  ms = lib.readMs(config);
}

// A resume over a killed session finds its half-written tree. Neither carrying on over it nor
// dropping it is right, so it goes into a stash of its own and the next session is asked to judge
// whether what it holds belongs to the task it is about to do.
const stashed = resuming && !flag('dry-run') ? lib.stashDirty(existing) : null;

const phaseArg = option('phase');
const phaseIndex = phaseArg
  ? ms.phases.findIndex((p) => String(p.phase) === String(phaseArg))
  : selection && selection.phase
    ? ms.phases.findIndex((p) => p.phase === selection.phase)
    : resuming
      ? existing.phaseIndex
      : firstOpenPhase(ms);

if (phaseArg && phaseIndex < 0) {
  process.stdout.write(`${config.ms} holds no phase ${phaseArg}.\n`);
  process.exit(1);
}
// Past the last phase is not an error: it is the close-out, which is a link like any other.

const state = lib.startState({
  existing,
  resuming: Boolean(resuming),
  phaseIndex,
  phaseNamed: Boolean(phaseArg),
});

if (stashed) state.stash = stashed;
if (selection) state.selection = selection;
if (option('stage')) state.stage = option('stage');
// Starting a run clears the halt and the hold it is starting from — but a dry run must not, or
// looking at what would happen next would quietly un-halt a loop somebody stopped on purpose. The
// pause goes too: a hold that fired leaves one behind, and `--resume` would otherwise be refused by
// the guard on the very next breath.
if (!flag('dry-run')) {
  if (lib.stopRequested()) fs.unlinkSync(lib.STOP_PATH);
  if (lib.pauseRequested()) fs.unlinkSync(lib.PAUSE_PATH);
  // A hold belongs to the run that armed it; a resume keeps it, a fresh run does not inherit it.
  if (!resuming) lib.writeHold(null);
}

lib.writeState(state);
lib.writeLock(state);
lib.event(state, {
  type: resuming ? 'resume' : 'start',
  phase: state.phaseIndex + 1,
});

if (stashed) {
  process.stdout.write(
    `📦 the tree was dirty — stashed as ${stashed.sha.slice(0, 8)} (${stashed.message})\n` +
      `   files: ${stashed.files.join(', ')}\n` +
      '   the next session reads it and decides whether it belongs to its task.\n\n',
  );
}

const startingOn = ms.phases[phaseIndex];
process.stdout.write(
  `🚀 Ralph run ${state.runId} — ${ms.feature}, ${startingOn ? `phase ${startingOn.phase} (${startingOn.title})` : 'close-out'}\n` +
    `   logs:  tail -f ${path.join('.claude/ralph-logs', String(state.runId))}/*\n` +
    `   watch: node .claude/ralph-watch.js  (add --ui for the dashboard)\n` +
    `   halt:  touch .claude/ralph.stop\n` +
    `   where: node .claude/ralph-start.js --status\n\n`,
);

// A resume must not decide anything while a link is still working: `advance()` reads its caller as
// the link that just ended, so resuming over a live session used to retire it on paper and spawn a
// second agent onto the same task and the same working tree.
const owner = lib.linkOwner(state, {});
if (owner.ok) {
  lib.advance();
} else {
  process.stdout.write(
    `   note:  ${owner.why}\n` +
      '          the chain carries on by itself when it ends; nothing was spawned here.\n\n',
  );
}

if (!flag('dry-run') && (flag('watch') || flag('ui'))) {
  require('./ralph-watch')
    .attach({ ui: flag('ui'), port: option('port'), noTui: flag('no-tui') })
    .catch((err) => {
      process.stdout.write(
        `The run started; the view did not: ${err.message}\n` +
          'Attach again with `node .claude/ralph-watch.js`.\n',
      );
    });
}
