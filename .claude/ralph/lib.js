'use strict';

/**
 * Shared runtime for the Ralph loop.
 *
 * The loop is a chain, not a tree: every link — a `claude -p` session or a `node` step — ends by
 * calling `advance()`, which works out the next stage and spawns exactly one detached successor
 * before returning. Nothing in the chain ever waits on its successor, so the Stop hook that drives
 * it always exits well inside its timeout and sessions never nest.
 *
 * Config (`.claude/ralph.config.json`) is committed and read-only at run time. State
 * (`.claude/ralph.state.json`), logs, the lock and the stop file are local and gitignored.
 */

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLAUDE_DIR = path.join(ROOT, '.claude');
const CONFIG_PATH = path.join(CLAUDE_DIR, 'ralph.config.json');
const STATE_PATH = path.join(CLAUDE_DIR, 'ralph.state.json');
const STOP_PATH = path.join(CLAUDE_DIR, 'ralph.stop');
const PAUSE_PATH = path.join(CLAUDE_DIR, 'ralph.pause');
const HOLD_PATH = path.join(CLAUDE_DIR, 'ralph.hold.json');
const OVERRIDES_PATH = path.join(CLAUDE_DIR, 'ralph.overrides.json');
const LOCK_PATH = path.join(CLAUDE_DIR, 'ralph.lock');
const ADVANCE_LOCK_PATH = path.join(CLAUDE_DIR, 'ralph.advance.lock');
const LOG_ROOT = path.join(CLAUDE_DIR, 'ralph-logs');
const CONTRACT = path.join('.claude', 'ralph.md');

/** Stages that need no session — `advance()` performs them and moves straight on. */
const SILENT_STAGES = new Set(['merge', 'settle-merge', 'next']);

/** What an armed hold does to the chain when the boundary it waits for arrives. */
const HOLD_ACTIONS = ['pause', 'stop'];

/** The boundaries a hold can wait for, in the order the chain reaches them. */
const HOLD_BOUNDARIES = ['task', 'phase'];

/**
 * The state a dry run composed, held in memory because a dry run writes nothing. Only ever read
 * back under `RALPH_DRY_RUN`, so a real run cannot see it.
 */
let dryState = null;

/**
 * Whether this process is only deciding, not spawning.
 *
 * Read each time rather than captured at load, so a caller that parses its own `--dry-run` flag
 * after requiring this module can still set it.
 *
 * @returns {boolean} True when `RALPH_DRY_RUN=1`.
 */
function isDry() {
  return process.env.RALPH_DRY_RUN === '1';
}

/**
 * Reads the committed loop config.
 *
 * @returns {object} The parsed `.claude/ralph.config.json`.
 * @throws {Error} When the file is missing or is not valid JSON.
 */
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Reads the settings a monitor has changed while the run was in flight.
 *
 * These live outside the committed config on purpose: the config is the run's record of what it was
 * meant to do, and a person turning the model down at two in the morning is not that record.
 *
 * @returns {object} The overrides, or an empty object when none have been set.
 */
function readOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merges a patch into the overrides file, dropping any key set back to `null`.
 *
 * @param {object} patch The settings to change.
 * @returns {object} The overrides as they now stand.
 */
function writeOverrides(patch) {
  const next = { ...readOverrides() };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  const tmp = `${OVERRIDES_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, OVERRIDES_PATH);
  return next;
}

/**
 * The config a link is actually spawned with: what is committed, with the run's overrides on top.
 *
 * @param {object} [config] The committed config; read from disk when omitted.
 * @returns {object} The effective config.
 */
function effectiveConfig(config = readConfig()) {
  return { ...config, ...readOverrides() };
}

/**
 * Reads the feature's milestone map, which the pipeline's skills keep current.
 *
 * @param {object} config The loop config, for its `ms` path.
 * @returns {object} The parsed `docs/<slug>/<slug>-MS.json`.
 * @throws {Error} When the file is missing or is not valid JSON.
 */
function readMs(config) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, config.ms), 'utf8'));
}

/**
 * Reads the loop's runtime state.
 *
 * @returns {object|null} The parsed state, or `null` when no run has been started.
 */
function readState() {
  if (isDry() && dryState) return dryState;
  if (!fs.existsSync(STATE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

/**
 * Writes the loop's runtime state atomically, so a chain killed mid-write still reads back.
 *
 * @param {object} state The state to persist.
 * @returns {void}
 */
function writeState(state) {
  // A dry run decides and prints; it records nothing. Without this it would claim a run id, bump the
  // session count and leave a lock behind, so the real run that followed would refuse to start. The
  // state it composes is kept in memory instead, because the decision it is about to print is made
  // against that state and not against whatever an older run left on disk.
  if (isDry()) {
    dryState = state;
    return;
  }
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, STATE_PATH);
}

/**
 * Whether a halt has been requested, by a session or by hand (`touch .claude/ralph.stop`).
 *
 * @returns {boolean} True when the stop file exists.
 */
function stopRequested() {
  return fs.existsSync(STOP_PATH);
}

/**
 * Why the chain was halted.
 *
 * @returns {string|null} The stop file's contents, or `null` when no halt is in place.
 */
function stopReason() {
  if (!stopRequested()) return null;
  try {
    return fs.readFileSync(STOP_PATH, 'utf8').trim() || 'halted';
  } catch {
    return 'halted';
  }
}

/**
 * Whether the chain is being held at the next link boundary.
 *
 * A pause differs from a halt in what it means rather than in what it does: a halt is the loop
 * refusing to go on, and needs a person to decide something; a pause is a person holding it, and is
 * lifted by pressing the same button again.
 *
 * @returns {boolean} True when the pause file exists.
 */
function pauseRequested() {
  return fs.existsSync(PAUSE_PATH);
}

/**
 * Holds the chain at the next link boundary, by hand or because a standing hold fired.
 *
 * @param {string} reason Why, for the pause file a view reads back.
 * @returns {void}
 */
function pauseChain(reason) {
  if (isDry()) return;
  fs.writeFileSync(PAUSE_PATH, `${new Date().toISOString()} ${reason}\n`);
}

/**
 * Reads the standing hold a view armed, if there is one.
 *
 * A hold is not a pause: a pause takes the chain at the next link boundary, wherever that falls,
 * while a hold waits for a boundary a run can actually be picked up from — a task whose commits and
 * `ralph:done` label have landed, or a phase that has merged and settled. Anything the chain cannot
 * act on reads as no hold at all, since a hold that cannot fire would only ever be a run that never
 * stopped where it was told to.
 *
 * @param {string} [holdPath] Where the hold is kept; a suite passes a path of its own.
 * @returns {{ action: string, at: string, reason: string, armedAt: string }|null} The hold.
 */
function readHold(holdPath = HOLD_PATH) {
  if (!fs.existsSync(holdPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(holdPath, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!HOLD_ACTIONS.includes(parsed.action)) return null;
  if (!HOLD_BOUNDARIES.includes(parsed.at)) return null;
  return parsed;
}

/**
 * Arms a standing hold, or clears the one that is armed.
 *
 * @param {{ action: string, at: string, reason?: string }|null} hold The hold, or `null` to clear.
 * @param {string} [holdPath] Where to keep it; a suite passes a path of its own.
 * @returns {object|null} The hold as it was written, or `null` when one was cleared.
 */
function writeHold(hold, holdPath = HOLD_PATH) {
  if (!hold) {
    try {
      fs.unlinkSync(holdPath);
    } catch {
      /* nothing was armed */
    }
    return null;
  }
  const armed = {
    action: hold.action,
    at: hold.at,
    reason: hold.reason || '',
    armedAt: new Date().toISOString(),
  };
  const tmp = `${holdPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(armed, null, 2)}\n`);
  fs.renameSync(tmp, holdPath);
  return armed;
}

/**
 * Whether an armed hold fires at a boundary the chain has just reached.
 *
 * A phase boundary fires every hold, including one armed for a task: a hold set while a close, merge
 * or settle link was in flight has no task boundary ahead of it in this phase, and sitting through
 * the phase boundary would stop the run somewhere in the middle of the next phase instead.
 *
 * @param {object|null} hold The armed hold, when there is one.
 * @param {string} boundary The boundary reached — `'task'` or `'phase'`.
 * @returns {boolean} True when the chain should hold here.
 */
function holdFiresAt(hold, boundary) {
  if (!hold || !HOLD_ACTIONS.includes(hold.action)) return false;
  if (!HOLD_BOUNDARIES.includes(hold.at)) return false;
  if (!HOLD_BOUNDARIES.includes(boundary)) return false;
  return boundary === 'phase' || hold.at === 'task';
}

/**
 * What a hold reads as, in the words of the control that armed it.
 *
 * @param {object|null} hold The hold.
 * @returns {string|null} A phrase like `stop after this phase`, or `null` when none is armed.
 */
function describeHold(hold) {
  if (!hold) return null;
  return `${hold.action} after this ${hold.at}`;
}

/**
 * Fires a hold: clears it, then holds or halts the chain where it stands.
 *
 * The hold is cleared before it acts, so a resume carries on rather than stopping again at the very
 * boundary it was just released from.
 *
 * @param {object} hold The hold that fired.
 * @param {object} state The current state.
 * @param {string} where The boundary reached, in words, for the reason a person reads back.
 * @returns {void}
 */
function fireHold(hold, state, where) {
  const label = describeHold(hold);
  if (isDry()) {
    process.stdout.write(`⏸ would hold here: ${label} — ${where}\n`);
    return;
  }
  writeHold(null);
  if (hold.action === 'stop') {
    halt(`${label} — ${where}`, state);
    return;
  }
  pauseChain(`${label} — ${where}`);
  event(state, { type: 'pause', reason: `${label} — ${where}`, by: 'hold' });
  process.stdout.write(`⏸ Ralph paused: ${label} — ${where}\n`);
}

/**
 * The window the run's ceilings are counted over: the whole run, or — once it has been resumed —
 * the stretch since that resume.
 *
 * A run that stopped at a boundary last night and is picked up this morning spent those hours
 * waiting for a person, not working, and counting them would refuse the very resume that was asked
 * for. An explicit `--resume` is therefore a fresh grant of both ceilings.
 *
 * @param {object} state The current state.
 * @returns {{ since: string, sessions: number }} When the window opened, and the session count then.
 */
function budgetWindow(state) {
  const budget = (state && state.budget) || {};
  return {
    since:
      budget.since || (state && state.startedAt) || new Date().toISOString(),
    sessions: Number.isFinite(budget.sessions) ? budget.sessions : 0,
  };
}

/**
 * Whether the run has spent one of the ceilings its current window grants it.
 *
 * @param {object} config The effective config.
 * @param {object} state The current state.
 * @param {number} [now] The instant to measure against, for a suite that fixes the clock.
 * @returns {string|null} Which ceiling was reached, or `null` while there is budget left.
 */
function ceilingSpent(config, state, now = Date.now()) {
  const window = budgetWindow(state);
  if (
    config.maxSessionsPerRun &&
    (state.sessions || 0) - window.sessions >= config.maxSessionsPerRun
  ) {
    return `session ceiling reached (${config.maxSessionsPerRun})`;
  }
  if (config.maxRunHours) {
    const hours = (now - Date.parse(window.since)) / 3_600_000;
    if (hours >= config.maxRunHours) {
      return `wall-clock ceiling reached (${config.maxRunHours}h)`;
    }
  }
  return null;
}

/**
 * Halts the chain: writes the stop file with a reason and records the halt in the event log.
 *
 * @param {string} reason Why the chain stopped, in enough detail to act on.
 * @param {object|null} state The current state, when one is loaded.
 * @returns {void}
 */
function halt(reason, state = null) {
  if (!isDry()) {
    fs.writeFileSync(STOP_PATH, `${new Date().toISOString()} ${reason}\n`);
    if (state) event(state, { type: 'halt', reason });
  }
  process.stdout.write(`⛔ Ralph halted: ${reason}\n`);
}

/**
 * The directory this run's logs and markers live in.
 *
 * @param {object} state The current state, for its `runId`.
 * @returns {string} An absolute path, created if it does not exist.
 */
function runDir(state) {
  const dir = path.join(LOG_ROOT, String(state.runId));
  // A dry run wants the path for the line it prints, not the directory: creating one would leave an
  // empty run behind every time somebody looked at what the loop would do next.
  if (!isDry()) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Appends one line to this run's event log, the machine-readable record of the whole chain.
 *
 * @param {object} state The current state.
 * @param {object} entry What happened, merged with a timestamp, stage and phase.
 * @returns {void}
 */
function event(state, entry) {
  if (isDry()) return;
  const line = {
    at: new Date().toISOString(),
    phase: state.phaseIndex + 1,
    stage: state.stage,
    ...entry,
  };
  fs.appendFileSync(
    path.join(runDir(state), 'events.jsonl'),
    `${JSON.stringify(line)}\n`,
  );
}

/**
 * Claims the run for this chain, so a second `ralph-start` cannot interleave commits with it.
 *
 * @param {object} state The current state, whose `runId` identifies the chain.
 * @returns {void}
 */
function writeLock(state) {
  if (isDry()) return;
  fs.writeFileSync(
    LOCK_PATH,
    `${JSON.stringify({ runId: state.runId, pid: process.pid })}\n`,
  );
}

/**
 * Reads the lock, if any.
 *
 * @returns {object|null} The lock's `{ runId, pid }`, or `null` when the loop is not running.
 */
function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Releases the run's lock.
 *
 * @returns {void}
 */
function clearLock() {
  if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
}

/**
 * Runs a command to completion and captures its output. Used only for the short, deterministic
 * calls the chain makes itself (`git`, `gh`, `npm`) — never to run a session.
 *
 * @param {string} cmd The executable.
 * @param {string[]} args Its arguments, as an argv array so no shell parses them.
 * @param {object} [opts] Extra `spawnSync` options.
 * @returns {{ code: number, stdout: string, stderr: string }} Exit code and captured streams.
 */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    code: res.status === null ? 1 : res.status,
    // A command killed by a signal exits with a null status, which is not the same thing as failing
    // — the merge gate has to tell "the tests went red" from "somebody stopped the run".
    signal: res.signal || null,
    stdout: res.stdout || '',
    stderr: res.stderr || (res.error ? String(res.error.message) : ''),
  };
}

/**
 * Calls the GitHub CLI and parses its JSON output.
 *
 * @param {string[]} args The `gh` arguments, ending in a `--json`/`--jq` form that prints JSON.
 * @returns {*} The parsed response.
 * @throws {Error} When `gh` fails or prints something that is not JSON.
 */
function gh(args) {
  const res = run('gh', args);
  if (res.code !== 0)
    throw new Error(`gh ${args.join(' ')} failed: ${res.stderr.trim()}`);
  return JSON.parse(res.stdout || 'null');
}

/**
 * This phase's block from the milestone map.
 *
 * @param {object} ms The parsed MS file.
 * @param {number} phaseIndex Zero-based index into `ms.phases`.
 * @returns {object|undefined} The phase block, or `undefined` past the last phase.
 */
function phaseOf(ms, phaseIndex) {
  return ms.phases[phaseIndex];
}

/**
 * The phase's unfinished tasks, in plan order.
 *
 * Order comes from the MS file's `issues` array — which `issues` wrote in plan order, 1.1 first —
 * never from `gh issue list`, which returns newest first and would walk the phase backwards. GitHub
 * is consulted only for each issue's current state and labels.
 *
 * @param {object} ms The parsed MS file.
 * @param {number} phaseIndex Zero-based index into `ms.phases`.
 * @returns {Array<object>} `{ task, number, title }` for each issue still to do, plan order.
 * @throws {Error} When the milestone cannot be read from GitHub.
 */
function issueQueue(ms, phaseIndex) {
  const phase = phaseOf(ms, phaseIndex);
  const live = gh([
    'issue',
    'list',
    '--milestone',
    phase.milestone.title,
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    'number,state,labels',
  ]);
  const byNumber = new Map(live.map((i) => [i.number, i]));
  return phase.issues.filter((issue) => {
    const now = byNumber.get(issue.number);
    if (!now) return true;
    if (now.state !== 'OPEN') return false;
    return !now.labels.some(
      (l) => l.name === 'ralph:done' || l.name === 'ralph:blocked',
    );
  });
}

/**
 * Whether an issue carries a label — how a finished or blocked task is recorded without closing it,
 * since the pipeline closes issues only through a merged PR's `Closes` lines.
 *
 * @param {number} number The issue number.
 * @param {string} label The label to look for.
 * @returns {boolean} True when the issue carries it.
 */
function issueHasLabel(number, label) {
  const issue = gh(['issue', 'view', String(number), '--json', 'labels']);
  return issue.labels.some((l) => l.name === label);
}

/**
 * The state of a pull request.
 *
 * @param {string} ref A PR URL or number.
 * @returns {{ state: string, mergedAt: string|null, mergeable: string }} What GitHub reports.
 */
function prView(ref) {
  return gh([
    'pr',
    'view',
    ref,
    '--json',
    'state,mergedAt,mergeable,url,number',
  ]);
}

/**
 * The open PR for a branch, if there is one.
 *
 * @param {string} branch The head branch name.
 * @returns {object|null} `{ number, url }`, or `null` when the branch has no open PR.
 */
function openPrForBranch(branch) {
  const list = gh([
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,url',
    '--limit',
    '5',
  ]);
  return list.length ? list[0] : null;
}

/**
 * The branch a phase's work lives on.
 *
 * @param {object} ms The parsed MS file.
 * @param {number} phaseIndex Zero-based index into `ms.phases`.
 * @returns {string} `feature/<slug>-phase-<N>`, or the refactor track's `refactor/` equivalent.
 */
function phaseBranch(ms, phaseIndex) {
  const prefix = ms.track === 'refactor' ? 'refactor' : 'feature';
  return `${prefix}/${ms.feature}-phase-${phaseOf(ms, phaseIndex).phase}`;
}

/**
 * The branch a settle run of its own cuts, per `build-phase` step 9.
 *
 * @param {object} ms The parsed MS file.
 * @param {number} phaseIndex Zero-based index into `ms.phases`.
 * @returns {string} `chore/<slug>-phase-<N>-done`.
 */
function settleBranch(ms, phaseIndex) {
  return `chore/${ms.feature}-phase-${phaseOf(ms, phaseIndex).phase}-done`;
}

/**
 * Spawns one detached link of the chain and returns immediately.
 *
 * Arguments go as an argv array, so nothing a milestone or issue title contains is ever parsed by a
 * shell. Output goes to a file, because a detached process has no terminal to inherit.
 *
 * @param {object} state The current state, for the run's log directory.
 * @param {string} label What this link is, used for the log filename.
 * @param {string} cmd The executable.
 * @param {string[]} args Its argv.
 * @param {string} [ext] The log's extension — `jsonl` for a session's event stream, `log` for a step.
 * @returns {{ log: string, pid: number|null }|null} Where it writes and what it is, or `null` on a
 *   dry run.
 */
function spawnLink(state, label, cmd, args, ext = 'log') {
  const logFile = path.join(
    runDir(state),
    `${String(state.sessions).padStart(3, '0')}-${label}.${ext}`,
  );
  if (isDry()) {
    process.stdout.write(
      `[dry-run] ${label}\n  ${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}\n  → ${logFile}\n`,
    );
    return null;
  }
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    // Stamps the link as part of this run. The Stop and SessionEnd hooks are registered for the
    // whole project, so without this an ordinary interactive session ending would advance the chain.
    env: { ...process.env, RALPH_LINK: String(state.runId) },
  });
  child.unref();
  return { log: logFile, pid: child.pid || null };
}

/**
 * Spawns a headless Claude session for one link of the chain.
 *
 * The session writes `stream-json` rather than text, which costs nothing and is the whole reason a
 * person can watch a run: every tool call, turn and cost lands in the log as it happens, instead of
 * one block of prose arriving after the session has already ended.
 *
 * @param {object} config The effective config, for model, effort, ceilings and permission mode.
 * @param {object} state The current state.
 * @param {string} label What this session is, used for the log filename.
 * @param {string} prompt The session's whole instruction.
 * @param {number} maxTurns The turn ceiling for this session.
 * @returns {{ log: string, pid: number|null }|null} Where it writes and what it is, or `null` on a
 *   dry run.
 */
function spawnSession(config, state, label, prompt, maxTurns) {
  const args = [
    '-p',
    prompt,
    '--model',
    config.model,
    '--max-turns',
    String(maxTurns),
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  if (config.effort) args.push('--effort', config.effort);
  if (config.fallbackModel) args.push('--fallback-model', config.fallbackModel);
  if (config.maxBudgetUsdPerSession) {
    args.push('--max-budget-usd', String(config.maxBudgetUsdPerSession));
  }
  return spawnLink(state, label, 'claude', args, 'jsonl');
}

/**
 * Spawns a `node` step of the chain — the links that must be deterministic rather than reasoned.
 *
 * @param {object} state The current state.
 * @param {string} label What this step is, used for the log filename.
 * @param {string[]} args Arguments after the node executable.
 * @returns {{ log: string, pid: number|null }|null} Where it writes and what it is, or `null` on a
 *   dry run.
 */
function spawnStep(state, label, args) {
  return spawnLink(state, label, process.execPath, args);
}

/**
 * The prompt for a stage.
 *
 * Every prompt starts by pointing at the contract rather than restating it, so the rules live in one
 * file that a session reads fresh each time.
 *
 * @param {string} stage The stage to build a prompt for.
 * @param {object} ctx `{ config, ms, state, issue }` as far as the stage needs them.
 * @returns {string} The session's instruction.
 * @throws {Error} When the stage has no prompt because it needs no session.
 */
function promptFor(stage, ctx) {
  const { config, ms, state, issue } = ctx;
  const base = config.baseBranch || 'main';
  if (stage === 'done') {
    return `Read ${CONTRACT} first. Every phase of ${ms.feature} has settled. Run \`/bldprj:close-feature ${ms.feature}\` and end the session. Do not merge the close-out PR — leave it for the user.`;
  }

  const phase = phaseOf(ms, state.phaseIndex);
  const n = phase.phase;
  const head = `Read ${CONTRACT} first and follow it exactly. Feature: ${ms.feature}. Phase ${n} — ${phase.title}. Milestone: "${phase.milestone.title}". Branch: ${phaseBranch(ms, state.phaseIndex)}.`;

  switch (stage) {
    case 'open':
      return `${head}

Open the phase — steps 2 to 4 of the build-phase contract, and nothing beyond them:
- confirm the working tree is clean; if it is not, follow the blocked protocol instead of resetting anything;
- bring ${base} current with \`git checkout ${base} && git pull --ff-only\`;
- bring up the infrastructure this phase's suites need (\`npm run db:up\`, then the migrate script when the phase touches the schema);
- cut the phase branch from that base, or switch to it if it already exists and its commits are accounted for;
- claim the phase in ${config.ms}: "status": "in-progress", "branch", and progress.currentPhase; commit it as \`docs: start phase ${n}\`.

Implement no task. Do not push. End the session as soon as the claim commit exists.`;

    case 'task':
      return `${head}

Implement exactly one task: issue #${issue.number} — ${issue.title} (task ${issue.task}).

Read its issue body first (\`gh issue view ${issue.number}\`) — it carries Covers, Decisions, Threats, Verified by and the phase's Done when — then this phase's block in ${ms.sources.final}, then only the D-<n> and S-<n> it cites, then the module docs for what it touches.

Work it test-first as the contract states, commit it as the contract states, label the issue \`ralph:done\`, and end the session. Take no other task, open no PR, close no issue.`;

    case 'close':
      return `${head}

Every task in this phase is implemented. Close the phase — steps 6 to 8 of the build-phase contract:
- move the docs with the code: module docs plus their INDEX row and pointer, JSDoc, Swagger annotations, README/.env.example where they moved, and the app's HISTORY.md entry;
- run the phase's full check set and show the real output: ${(ctx.config.checks[ctx.layer] || []).map((s) => `\`npm run ${s}\``).join(', ')}, plus \`npm run build\` when configs, dependencies or a public API moved, plus \`node plugins/bldprj/scripts/docs-lint.mjs .\`;
- walk the phase's Done when clause by clause, each backed by a fact you actually saw;
- run the project's code review habit (the \`requesting-code-review\` skill) before pushing, and check every S-<n> this phase carries against its control;
- the branch tip must be green: push it and open the PR with \`gh pr create --base ${base} --milestone "${phase.milestone.title}"\`, whose body carries the Goal, one line per task with its issue number and commits, the Done when evidence, the Verified by evidence including each red \`test(...)\` commit ahead of its \`feat(...)\` one, links to RESEARCH and THREATS, and one \`Closes #<n>\` line per implemented issue;
- record the review state: MS phase "status": "in-review" with its "pr" block, FINAL's tasks for this phase ticked with the in-review status line; commit as \`docs: phase ${n} in review\` and push.

Do not merge — the loop merges, after re-running the checks itself.`;

    case 'settle':
      return `${head}

This phase's PR is merged. Run \`/bldprj:build-phase ${n}\` — it will see the phase is \`in-review\` against a merged PR and run as a settle run (step 9): close any issue the merge left open, close milestone ${phase.milestone.number} once all its issues are closed, mark the phase \`completed\` in the MS file with progress updated, set FINAL's phase status to complete, and add the \`docs/Features.md\` row. Cut \`${settleBranch(ms, state.phaseIndex)}\` from a freshly pulled ${base} for the settle commit and open its PR. Do not merge it.`;

    default:
      throw new Error(`stage ${stage} needs no session`);
  }
}

/**
 * The layer key for a phase, which selects its check set.
 *
 * @param {object} config The loop config.
 * @param {number} phaseIndex Zero-based index into `config.phases`.
 * @returns {string} `'api'` or `'web'`, defaulting to `'api'`.
 */
function layerOf(config, phaseIndex) {
  const phase = config.phases[phaseIndex];
  return (phase && phase.layer) || 'api';
}

/**
 * The guards every link runs before doing anything. Any false answer ends the chain quietly, which
 * is the behaviour a loop left running overnight needs: it stops, it does not improvise.
 *
 * @param {object} config The loop config.
 * @param {object|null} state The current state, when one is loaded.
 * @param {object} [hookInput] The Stop/SessionEnd hook's parsed stdin, when a hook is the caller.
 * @returns {{ ok: boolean, why: string }} Whether to continue, and why not when not.
 */
function guards(config, state, hookInput = {}) {
  if (!state)
    return {
      ok: false,
      why: 'no run state — start with `node .claude/ralph-start.js`',
    };
  if (!state.active) return { ok: false, why: 'run is not active' };
  if (stopRequested())
    return {
      ok: false,
      why: `stop requested: ${fs.readFileSync(STOP_PATH, 'utf8').trim()}`,
    };
  if (pauseRequested())
    return {
      ok: false,
      why: `paused: ${fs.readFileSync(PAUSE_PATH, 'utf8').trim()}`,
    };
  if (hookInput.stop_hook_active)
    return { ok: false, why: 'stop_hook_active — refusing to re-enter' };

  // A hook firing for a session the chain did not spawn is somebody working in this repo by hand.
  // Both hooks are registered project-wide, so without this their session ending would advance the
  // loop underneath them.
  if (hookInput.session_id && process.env.RALPH_LINK !== String(state.runId)) {
    return {
      ok: false,
      why: 'this session is not a link of the run — leaving it alone',
    };
  }

  const lock = readLock();
  if (lock && lock.runId !== state.runId) {
    return {
      ok: false,
      why: `lock belongs to run ${lock.runId}, this state is ${state.runId}`,
    };
  }
  const spent = ceilingSpent(config, state);
  if (spent) return { ok: false, why: spent };
  if (hookInput.session_id) {
    const marker = path.join(runDir(state), `spawned-${hookInput.session_id}`);
    if (fs.existsSync(marker)) {
      return {
        ok: false,
        why: `already advanced past session ${hookInput.session_id}`,
      };
    }
  }
  return { ok: true, why: '' };
}

/**
 * Records that this session has been advanced past, so a Stop and a SessionEnd firing for the same
 * session cannot spawn two successors.
 *
 * @param {object} state The current state.
 * @param {string|undefined} sessionId The finished session's id, when a hook supplied one.
 * @returns {void}
 */
function markAdvanced(state, sessionId) {
  if (!sessionId) return;
  fs.writeFileSync(path.join(runDir(state), `spawned-${sessionId}`), '');
}

/**
 * Where the tree stands right before a link is spawned — the point a rollback returns to.
 *
 * Taken by the chain rather than by the monitor, because only the chain knows the instant a link
 * begins, and a checkpoint taken a moment later would already include that link's first commit.
 *
 * @param {string} stage The stage about to run.
 * @param {number|null} issue The issue that stage is working, when it has one.
 * @returns {{ at: string, stage: string, issue: number|null, sha: string, branch: string }} The
 *   checkpoint.
 */
function checkpoint(stage, issue) {
  return {
    at: new Date().toISOString(),
    stage,
    issue: issue || null,
    sha: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(),
  };
}

/**
 * Records the link about to run, so a view can say what is in flight and a rollback knows what to
 * undo. Checkpoints are capped: a long run keeps its recent history, not all of it.
 *
 * @param {object} state The current state, mutated in place.
 * @param {object} link `{ kind, stage, label, issue, model, effort }` describing the link.
 * @returns {object} The checkpoint taken for it.
 */
function beginLink(state, link) {
  const point = checkpoint(link.stage, link.issue);
  state.checkpoints = [...(state.checkpoints || []), point].slice(-50);
  state.link = {
    ...link,
    startedAt: point.at,
    checkpoint: point,
    pid: null,
    log: null,
  };
  return point;
}

/**
 * Reconciles the stage the state claims with what the MS file and GitHub actually show, and returns
 * the stage to act on. State is authoritative for the sub-steps the pipeline does not record; the MS
 * file wins wherever it disagrees, so a chain restarted by hand recovers instead of repeating work.
 *
 * @param {object} config The loop config.
 * @param {object} ms The parsed MS file.
 * @param {object} state The current state.
 * @returns {{ stage: string, why: string }} The stage to run, and what decided it.
 */
function reconcile(config, ms, state) {
  const phase = phaseOf(ms, state.phaseIndex);
  if (!phase) return { stage: 'done', why: 'no phase left in the MS file' };

  if (phase.status === 'completed') {
    const settlePr = openPrForBranch(settleBranch(ms, state.phaseIndex));
    if (settlePr)
      return {
        stage: 'settle-merge',
        why: `settle PR #${settlePr.number} is open`,
      };
    return { stage: 'next', why: `phase ${phase.phase} is completed` };
  }

  if (phase.status === 'pending')
    return { stage: 'open', why: 'phase is pending' };

  if (phase.status === 'in-review') {
    if (!phase.pr || !phase.pr.url) {
      return {
        stage: 'halt',
        why: 'phase is in-review with no PR recorded in the MS file',
      };
    }
    const pr = prView(phase.pr.url);
    if (pr.state === 'MERGED')
      return { stage: 'settle', why: `PR ${pr.url} is merged` };
    if (pr.state === 'OPEN')
      return { stage: 'merge', why: `PR ${pr.url} is open` };
    return {
      stage: 'halt',
      why: `PR ${pr.url} is ${pr.state} — closed unmerged is a human decision`,
    };
  }

  if (phase.status === 'in-progress') {
    const queue = issueQueue(ms, state.phaseIndex);
    if (queue.length)
      return { stage: 'task', why: `${queue.length} task(s) left` };
    return { stage: 'close', why: 'every task is done' };
  }

  return { stage: 'halt', why: `unknown phase status "${phase.status}"` };
}

/**
 * Whether the lock a previous decision left behind can be taken from it.
 *
 * @returns {boolean} True when the holder is gone, or has held it far longer than a decision takes.
 */
function advanceLockStale(lockPath = ADVANCE_LOCK_PATH) {
  let held;
  try {
    held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return true;
  }
  if (!held || !held.pid) return true;
  try {
    process.kill(held.pid, 0);
  } catch (err) {
    if (err.code !== 'EPERM') return true;
  }
  return Date.now() - Date.parse(held.at || 0) > 10 * 60_000;
}

/**
 * Claims the right to decide what happens next.
 *
 * Deciding used to be safe by construction: only the link that had just ended ever called
 * `advance()`. A monitor's Resume button broke that — two views, or two clicks a second apart, can
 * each start a decision, and each would reconcile the same stage and spawn a session for the same
 * task onto the same working tree. The claim is a file rather than anything in-process, because the
 * callers are separate processes.
 *
 * @param {string} [lockPath] Where the claim is written; a suite passes a path of its own so it
 *   never touches the lock a live run depends on.
 * @returns {Function|null} A release function, or `null` when somebody else is deciding.
 */
function claimAdvance(lockPath = ADVANCE_LOCK_PATH) {
  const nonce = `${process.pid}-${crypto.randomUUID()}`;

  /**
   * Whether the lock on disk is still the one this call wrote.
   *
   * @returns {boolean} True when the file holds this claim's nonce.
   */
  const holdsIt = () => {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8')).nonce === nonce;
    } catch {
      return false;
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const takeover = attempt > 0;
    try {
      fs.writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: process.pid, nonce, at: new Date().toISOString() })}\n`,
        { flag: 'wx' },
      );
      // Taking a stale lock is unlink-then-create, and two processes can interleave those and both
      // believe they hold it. Waiting a moment and re-reading settles which of them actually does;
      // the ordinary uncontended claim skips this entirely.
      if (takeover) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        if (!holdsIt()) return null;
      }
      return () => {
        // Only ever release a lock this call still owns, or a slow release would delete the claim
        // somebody else has since made.
        if (!holdsIt()) return;
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* already released */
        }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (!advanceLockStale(lockPath)) return null;
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* somebody else cleared it first */
      }
    }
  }
  return null;
}

/**
 * Works out the next link of the chain and spawns it. The one entry point every caller shares —
 * the Stop hook, the verify step, the start script and a monitor's Resume — so the loop has exactly
 * one place that decides what happens next, and only one decision at a time.
 *
 * @param {object} [hookInput] The hook's parsed stdin, when a hook is the caller.
 * @returns {void}
 */
function advance(hookInput = {}) {
  if (isDry()) return decide(hookInput);
  const release = claimAdvance();
  if (!release) {
    process.stdout.write(
      'Ralph: not advancing — another decision is already in flight\n',
    );
    // Recorded rather than only printed: this line is written into a detached step's log file that
    // nobody is watching, and a chain that stopped here should be visible in the run's own history.
    const held = readState();
    if (held) event(held, { type: 'advance-refused', why: 'lock held' });
    return undefined;
  }
  try {
    return decide(hookInput);
  } finally {
    release();
  }
}

/**
 * The decision itself, run with the advance lock held.
 *
 * @param {object} hookInput The hook's parsed stdin, when a hook is the caller.
 * @returns {void}
 */
function decide(hookInput) {
  const config = effectiveConfig();
  const state = readState();
  const gate = guards(config, state, hookInput);
  if (!gate.ok) {
    process.stdout.write(`Ralph: not advancing — ${gate.why}\n`);
    return;
  }

  markAdvanced(state, hookInput.session_id);

  // Whatever called advance() is the link that just ended. Stamping it here is what lets a view say
  // "finished" without trusting a pid, which the operating system is free to hand to someone else.
  if (state.link && !state.link.endedAt) {
    state.link = { ...state.link, endedAt: new Date().toISOString() };
    writeState(state);
  }

  let ms;
  try {
    ms = readMs(config);
  } catch (err) {
    halt(`cannot read the MS file: ${err.message}`, state);
    return;
  }

  // Verify the link that just finished did what its stage promised, before moving on.
  const check = verifyPreviousStage(config, ms, state);
  if (!check.ok) {
    if (check.retry) {
      state.attempts[check.key] = (state.attempts[check.key] || 0) + 1;
      if (state.attempts[check.key] > config.taskRetries) {
        writeState(state);
        halt(
          `${check.why} — retry budget (${config.taskRetries}) exhausted`,
          state,
        );
        return;
      }
      event(state, {
        type: 'retry',
        why: check.why,
        attempt: state.attempts[check.key],
      });
      writeState(state);
    } else {
      halt(check.why, state);
      return;
    }
  }

  // A hold armed from a view fires at a boundary rather than at the next link. A finished task is
  // the first one the chain reaches: its commits and its `ralph:done` label have landed, so a run
  // held here is one `--resume` picks up without repeating anything. A task that is going round
  // again is not a boundary, which is why this asks the verdict rather than the stage alone.
  const armed = readHold();
  if (check.ok && state.stage === 'task' && holdFiresAt(armed, 'task')) {
    fireHold(
      armed,
      state,
      state.currentIssue
        ? `task #${state.currentIssue} finished`
        : 'task finished',
    );
    return;
  }

  let guard = 0;
  for (;;) {
    if (guard++ > 8) {
      halt('stage machine did not settle in 8 steps', state);
      return;
    }
    const { stage, why } = reconcile(config, ms, state);
    state.stage = stage;

    if (stage === 'halt') {
      writeState(state);
      halt(why, state);
      return;
    }

    if (stage === 'next') {
      event(state, { type: 'phase-complete', why });
      const settled = phaseOf(ms, state.phaseIndex);
      state.phaseIndex += 1;
      state.attempts = {};
      state.currentIssue = null;
      writeState(state);
      // The cleanest boundary there is: the phase has merged and settled, the base branch holds
      // everything it produced, and the next link would be the first of a new phase. Every hold
      // fires here, including one armed for a task — see `holdFiresAt`.
      if (holdFiresAt(armed, 'phase')) {
        fireHold(
          armed,
          state,
          `phase ${settled ? settled.phase : '?'} settled`,
        );
        return;
      }
      continue;
    }

    if (SILENT_STAGES.has(stage)) {
      // A merge re-runs the check set first, which takes minutes — far too long for a hook. It goes
      // out as its own detached step, and that step calls advance() again when it is done.
      const phase = phaseOf(ms, state.phaseIndex);
      const target =
        stage === 'merge'
          ? phase.pr.url
          : openPrForBranch(settleBranch(ms, state.phaseIndex)).url;
      state.sessions += 1;
      const label = `${stage}-p${phase.phase}`;
      beginLink(state, {
        kind: 'step',
        stage,
        label,
        issue: null,
        pr: target,
      });
      writeState(state);
      const spawned = spawnStep(state, label, [
        path.join(CLAUDE_DIR, 'ralph', 'verify.js'),
        '--phase-index',
        String(state.phaseIndex),
        '--pr',
        target,
        '--scope',
        stage === 'merge' ? 'full' : 'docs',
      ]);
      if (spawned) {
        state.link = { ...state.link, ...spawned };
        writeState(state);
      }
      event(state, {
        type: 'spawn',
        link: stage,
        pr: target,
        log: spawned && spawned.log,
        why,
      });
      return;
    }

    const issue = stage === 'task' ? issueQueue(ms, state.phaseIndex)[0] : null;
    state.currentIssue = issue ? issue.number : null;
    state.sessions += 1;

    const current = phaseOf(ms, state.phaseIndex);
    const label = issue
      ? `task-${issue.task.replace('.', '-')}-i${issue.number}`
      : `${stage}${current ? `-p${current.phase}` : ''}`;
    beginLink(state, {
      kind: 'session',
      stage,
      label,
      issue: state.currentIssue,
      model: config.model,
      effort: config.effort || null,
    });
    writeState(state);

    const prompt = promptFor(stage, {
      config,
      ms,
      state,
      issue,
      layer: layerOf(config, state.phaseIndex),
    });
    const maxTurns =
      stage === 'task' ? config.maxTurnsPerTask : config.maxTurnsPerBookend;

    // Close-out is the last link there is: end the run with it, rather than letting `done` re-enter.
    if (stage === 'done') {
      state.active = false;
      writeState(state);
    }

    const spawned = spawnSession(config, state, label, prompt, maxTurns);
    if (spawned) {
      state.link = { ...state.link, ...spawned };
      writeState(state);
    }
    event(state, {
      type: 'spawn',
      link: stage,
      issue: state.currentIssue,
      model: config.model,
      effort: config.effort || null,
      log: spawned && spawned.log,
      why,
    });
    return;
  }
}

/**
 * Checks that the link that just finished left the record its stage promised. This is what keeps a
 * session's own account of itself out of the loop's decisions: a task counts as done because the
 * issue carries `ralph:done`, not because a transcript said so.
 *
 * @param {object} config The loop config.
 * @param {object} ms The parsed MS file.
 * @param {object} state The current state.
 * @returns {{ ok: boolean, retry: boolean, why: string, key: string }} The verdict.
 */
function verifyPreviousStage(config, ms, state) {
  const ok = { ok: true, retry: false, why: '', key: '' };
  const phase = phaseOf(ms, state.phaseIndex);
  if (!phase) return ok;

  switch (state.stage) {
    case 'open':
      if (phase.status !== 'in-progress') {
        return {
          ok: false,
          retry: true,
          why: `phase ${phase.phase} was not claimed in the MS file`,
          key: `open-${phase.phase}`,
        };
      }
      return ok;

    case 'task': {
      const number = state.currentIssue;
      if (!number) return ok;
      const done = issueHasLabel(number, 'ralph:done');
      const blocked = issueHasLabel(number, 'ralph:blocked');
      if (blocked)
        return {
          ok: false,
          retry: false,
          why: `issue #${number} is labelled ralph:blocked`,
          key: `task-${number}`,
        };
      if (!done) {
        return {
          ok: false,
          retry: true,
          why: `issue #${number} finished without the ralph:done label`,
          key: `task-${number}`,
        };
      }
      return ok;
    }

    case 'close':
      if (phase.status !== 'in-review') {
        return {
          ok: false,
          retry: true,
          why: `phase ${phase.phase} did not reach in-review`,
          key: `close-${phase.phase}`,
        };
      }
      return ok;

    case 'settle':
      if (phase.status !== 'completed') {
        return {
          ok: false,
          retry: true,
          why: `phase ${phase.phase} did not settle`,
          key: `settle-${phase.phase}`,
        };
      }
      return ok;

    default:
      return ok;
  }
}

module.exports = {
  ROOT,
  CLAUDE_DIR,
  CONFIG_PATH,
  STATE_PATH,
  STOP_PATH,
  PAUSE_PATH,
  HOLD_PATH,
  OVERRIDES_PATH,
  LOCK_PATH,
  ADVANCE_LOCK_PATH,
  LOG_ROOT,
  HOLD_ACTIONS,
  HOLD_BOUNDARIES,
  isDry,
  advance,
  beginLink,
  budgetWindow,
  ceilingSpent,
  checkpoint,
  claimAdvance,
  clearLock,
  describeHold,
  effectiveConfig,
  event,
  gh,
  guards,
  halt,
  issueQueue,
  layerOf,
  fireHold,
  holdFiresAt,
  openPrForBranch,
  pauseChain,
  pauseRequested,
  phaseBranch,
  phaseOf,
  prView,
  promptFor,
  readConfig,
  readLock,
  readMs,
  readHold,
  readOverrides,
  readState,
  reconcile,
  run,
  runDir,
  settleBranch,
  stopReason,
  stopRequested,
  writeHold,
  writeLock,
  writeOverrides,
  writeState,
};
