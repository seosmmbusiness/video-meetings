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
 *   node .claude/ralph-start.js --resume           continue the existing state, clearing the halt
 *   node .claude/ralph-start.js --phase 2          start (or resume) at a specific phase number
 *   node .claude/ralph-start.js --status           print where the run got to, change nothing
 */

const fs = require('node:fs');
const path = require('node:path');

const lib = require('./ralph/lib');

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
 * @returns {string[]} The problems found; an empty array means the ground is fit.
 */
function preflight(config) {
  const problems = [];

  const status = lib.run('git', ['status', '--porcelain']);
  if (status.code !== 0)
    problems.push('git status failed — is this a repository?');
  else if (status.stdout.trim()) {
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
      `\nHALTED: ${fs.readFileSync(lib.STOP_PATH, 'utf8').trim()}\n`,
    );
  }
  process.stdout.write(
    `logs: ${path.join('.claude/ralph-logs', String(state.runId))}\n`,
  );
}

const config = lib.readConfig();

if (flag('status')) {
  printStatus(config);
  process.exit(0);
}

const problems = preflight(config);
if (problems.length) {
  process.stdout.write(
    `Ralph will not start:\n${problems.map((p) => `  • ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}

const ms = lib.readMs(config);
const existing = lib.readState();
const resuming = flag('resume') && existing;

const phaseArg = option('phase');
const phaseIndex = phaseArg
  ? ms.phases.findIndex((p) => String(p.phase) === String(phaseArg))
  : resuming
    ? existing.phaseIndex
    : firstOpenPhase(ms);

if (phaseIndex < 0 || phaseIndex >= ms.phases.length) {
  process.stdout.write(
    `No phase ${phaseArg ?? ''} to work — every phase in ${config.ms} has settled.\n`,
  );
  process.exit(1);
}

const state = {
  runId: resuming ? existing.runId : Math.floor(Date.now() / 1000),
  active: true,
  phaseIndex,
  stage: resuming && !phaseArg ? existing.stage : 'start',
  currentIssue: null,
  attempts: resuming ? existing.attempts || {} : {},
  sessions: resuming ? existing.sessions || 0 : 0,
  startedAt: resuming ? existing.startedAt : new Date().toISOString(),
};

if (option('stage')) state.stage = option('stage');
if (lib.stopRequested()) fs.unlinkSync(lib.STOP_PATH);

lib.writeState(state);
lib.writeLock(state);
lib.event(state, {
  type: resuming ? 'resume' : 'start',
  phase: state.phaseIndex + 1,
});

process.stdout.write(
  `🚀 Ralph run ${state.runId} — ${ms.feature}, phase ${ms.phases[phaseIndex].phase} (${ms.phases[phaseIndex].title})\n` +
    `   logs:  tail -f ${path.join('.claude/ralph-logs', String(state.runId))}/*.log\n` +
    `   halt:  touch .claude/ralph.stop\n` +
    `   where: node .claude/ralph-start.js --status\n\n`,
);

lib.advance();
