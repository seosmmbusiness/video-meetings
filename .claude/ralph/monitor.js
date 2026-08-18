'use strict';

/**
 * The monitor core — everything the two views share, and nothing either of them draws.
 *
 * The loop itself is deliberately blind: each link writes a log and exits, and the chain decides
 * from the MS file and GitHub rather than from anything a person can see. This module is the other
 * half of that arrangement — it reads the same files the chain writes, folds them into one snapshot,
 * and offers the four controls a person needs over an unattended build: pause, resume, stop and
 * roll back.
 *
 * Two rules shape it:
 *
 * - **A snapshot never calls the network.** It is taken twice a second by the TUI and by every
 *   connected browser, so it reads local files only. GitHub is consulted just once, when a rollback
 *   needs to know which commit a merge landed as.
 * - **A rollback is planned before it is run.** `planRollback` returns the argv of every command it
 *   would execute, so what resets a branch or reverts a merge can be asserted in a suite (and shown
 *   to the person pressing the button) before anything runs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const lib = require('./lib');

/** How wide one activity line may be before it is truncated. */
const ACTIVITY_WIDTH = 120;

/** How many activity entries a parse keeps; the views show the last two or three. */
const ACTIVITY_KEEP = 60;

/** How much of a log's tail is read. A long session's log is far larger, and only the end matters. */
const TAIL_BYTES = 256 * 1024;

/** The effort levels `claude --effort` accepts. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The settings a person may change while a run is in flight. Everything else in the config is
 * committed and stays that way: changing the merge strategy or the check set mid-run would make the
 * run's own record of itself untrue.
 */
const SETTINGS = {
  model: { kind: 'model', label: 'model' },
  fallbackModel: { kind: 'model', label: 'fallback' },
  effort: { kind: 'enum', values: EFFORTS, label: 'effort' },
  maxTurnsPerTask: { kind: 'int', min: 1, max: 2000, label: 'turns/task' },
  maxTurnsPerBookend: {
    kind: 'int',
    min: 1,
    max: 2000,
    label: 'turns/bookend',
  },
  maxBudgetUsdPerSession: {
    kind: 'number',
    min: 0.5,
    max: 1000,
    label: 'budget $/session',
  },
  taskRetries: { kind: 'int', min: 0, max: 10, label: 'retries' },
};

/** What a model name may look like, which is narrow enough that no shell metacharacter fits. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The three ways back, in the order the UI offers them: least destructive first. */
const ROLLBACK_MODES = [
  {
    key: 'restart-link',
    title: 'Restart the current link',
    detail:
      'Kill the session, put the tree back where it stood when the link started, and run the same stage again.',
    destructive: true,
  },
  {
    key: 'back-one-task',
    title: 'Undo the last finished task',
    detail:
      'Reset the phase branch to before that task, take its ralph:done label off, and let the chain pick it up again.',
    destructive: true,
  },
  {
    key: 'revert-merge',
    title: 'Revert a merged phase PR',
    detail:
      'Open a revert PR against the base branch and halt the run. Nothing is pushed to the base branch itself.',
    destructive: true,
  },
];

/**
 * A path as a person reading a dashboard wants it: relative to the run's root when it is inside it.
 *
 * @param {string} value The path, absolute or not.
 * @param {string} root The directory to make it relative to.
 * @returns {string} The shortened path, or the original when it lies outside the root.
 */
function shortPath(value, root) {
  if (!value || !root) return value || '';
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Collapses anything into a single line of whitespace-normalised text.
 *
 * @param {*} value What to render.
 * @returns {string} One line, with runs of whitespace squeezed to single spaces.
 */
function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncates to a width, marking that something was cut.
 *
 * @param {string} value The text.
 * @param {number} [width] The ceiling, in characters.
 * @returns {string} The text, at most `width` characters long.
 */
function truncate(value, width = ACTIVITY_WIDTH) {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

/**
 * One line describing a tool call, the way a person watching over a shoulder would say it.
 *
 * @param {object} block An assistant message's `tool_use` block.
 * @param {string} [root] The session's working directory, used to shorten paths.
 * @returns {string} `Edit apps/api/src/x.ts`, `Bash npm run test:api`, or just the tool's name.
 */
function describeToolUse(block, root = lib.ROOT) {
  const name = block.name || 'tool';
  const input = block.input || {};
  const detail =
    input.command ??
    input.file_path ??
    input.path ??
    input.notebook_path ??
    input.pattern ??
    input.url ??
    input.description ??
    input.query ??
    input.prompt ??
    '';
  const said = oneLine(shortPath(oneLine(detail), root));
  return truncate(said ? `${name} ${said}` : name);
}

/**
 * Folds a link's log into what the views need: who is running, what it is doing, and how it ended.
 *
 * Handles three shapes, because a run's log directory holds all three: the `stream-json` a session
 * writes, the plain text a `node` step writes, and the half-written last line a live tail cuts.
 *
 * @param {string} text The log's tail.
 * @param {object} [opts] `{ root }` to override the working directory paths are shortened against.
 * @returns {object} `{ sessionId, model, activity, turns, thinking, cost, finished, error, result,
 *   rateLimit, root }`.
 */
function parseStream(text, opts = {}) {
  const parsed = {
    sessionId: null,
    model: null,
    root: opts.root || lib.ROOT,
    activity: [],
    turns: 0,
    thinking: 0,
    cost: null,
    finished: false,
    error: false,
    result: null,
    rateLimit: null,
    durationMs: null,
  };
  const lines = String(text || '').split('\n');
  const objects = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // A tail cuts the newest line mid-write, and a `node` step's log is not JSON at all. Both are
      // expected rather than exceptional: skip the line and keep what parsed.
    }
  }

  if (!objects.length) {
    for (const line of lines) {
      const said = oneLine(line);
      if (said) parsed.activity.push({ kind: 'text', text: truncate(said) });
    }
    parsed.activity = parsed.activity.slice(-ACTIVITY_KEEP);
    return parsed;
  }

  for (const object of objects) {
    // Every line carries the session id, and only the first carries `cwd` — which matters because a
    // tail of a long log never contains that first line, and the id is what makes standing in for a
    // finished session idempotent with its own late hook.
    if (object.session_id) parsed.sessionId = object.session_id;
    if (object.type === 'system' && object.subtype === 'init') {
      parsed.model = object.model || parsed.model;
      if (object.cwd) parsed.root = object.cwd;
      continue;
    }
    if (object.type === 'system' && object.subtype === 'thinking_tokens') {
      parsed.thinking = object.estimated_tokens ?? parsed.thinking;
      continue;
    }
    if (object.type === 'rate_limit_event' && object.rate_limit_info) {
      parsed.rateLimit = {
        status: object.rate_limit_info.status,
        type: object.rate_limit_info.rateLimitType,
        resetsAt: object.rate_limit_info.resetsAt,
      };
      continue;
    }
    if (object.type === 'assistant' && object.message) {
      parsed.turns += 1;
      parsed.model = object.message.model || parsed.model;
      const content = Array.isArray(object.message.content)
        ? object.message.content
        : [];
      for (const block of content) {
        if (block.type === 'tool_use') {
          parsed.activity.push({
            kind: 'tool',
            text: describeToolUse(block, parsed.root),
            at: object.timestamp,
          });
        } else if (block.type === 'text') {
          const said = oneLine(block.text);
          if (said)
            parsed.activity.push({
              kind: 'text',
              text: truncate(said),
              at: object.timestamp,
            });
        }
      }
      continue;
    }
    if (object.type === 'result') {
      parsed.finished = true;
      parsed.error = Boolean(object.is_error);
      if (typeof object.total_cost_usd === 'number')
        parsed.cost = object.total_cost_usd;
      if (typeof object.num_turns === 'number') parsed.turns = object.num_turns;
      if (typeof object.duration_ms === 'number')
        parsed.durationMs = object.duration_ms;
      if (typeof object.result === 'string') parsed.result = object.result;
    }
  }

  parsed.activity = parsed.activity.slice(-ACTIVITY_KEEP);
  return parsed;
}

/**
 * The last few things a link did, newest last — the "what is it doing right now" panel.
 *
 * @param {object} parsed A `parseStream` result.
 * @param {number} [count] How many lines to return.
 * @returns {string[]} At most `count` lines.
 */
function activityLines(parsed, count = 3) {
  return parsed.activity.slice(-count).map((entry) => entry.text);
}

/**
 * Where the run has got to, counted the way the dashboard shows it.
 *
 * @param {object} ms The parsed MS file.
 * @param {object} state The loop's state.
 * @returns {object} `{ phaseNumber, phaseTotal, phaseIndex, title, status, taskNumber, taskTotal }`.
 */
function phaseProgress(ms, state) {
  const phases = (ms && ms.phases) || [];
  const phase = phases[state.phaseIndex];
  const issues = (phase && phase.issues) || [];
  const at = state.currentIssue
    ? issues.findIndex((issue) => issue.number === state.currentIssue)
    : -1;
  return {
    phaseIndex: state.phaseIndex,
    phaseNumber: phase ? phase.phase : null,
    phaseTotal: phases.length,
    title: phase ? phase.title : null,
    status: phase ? phase.status : null,
    taskNumber: at === -1 ? null : at + 1,
    taskTotal: issues.length,
    taskId: at === -1 ? null : issues[at].task,
    taskTitle: at === -1 ? null : issues[at].title,
  };
}

/**
 * Checks one setting a person is trying to change, before it can reach a spawned session's argv.
 *
 * @param {string} key The setting's name.
 * @param {*} raw What the person typed.
 * @returns {{ ok: boolean, value?: *, why?: string }} The parsed value, or why it was refused.
 */
function validateSetting(key, raw) {
  // An own-property test, not a lookup: `SETTINGS['toString']` is truthy on any object literal, and
  // a value posted under that key would reach a spawned session's argv.
  const spec = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
  if (!spec)
    return { ok: false, why: `${key} is not a setting a run may change` };

  const value = typeof raw === 'string' ? raw.trim() : raw;
  if (value === '' || value === null || value === undefined)
    return { ok: true, value: null };

  if (spec.kind === 'enum') {
    return spec.values.includes(value)
      ? { ok: true, value }
      : { ok: false, why: `${key} must be one of ${spec.values.join(', ')}` };
  }

  if (spec.kind === 'model') {
    return MODEL_RE.test(String(value))
      ? { ok: true, value: String(value) }
      : { ok: false, why: `${value} is not a model name` };
  }

  const number = Number(value);
  if (!Number.isFinite(number))
    return { ok: false, why: `${key} must be a number` };
  if (spec.kind === 'int' && !Number.isInteger(number))
    return { ok: false, why: `${key} must be a whole number` };
  if (number < spec.min || number > spec.max) {
    return {
      ok: false,
      why: `${key} must be between ${spec.min} and ${spec.max}`,
    };
  }
  return { ok: true, value: number };
}

/**
 * A name for the branch a rollback leaves behind, so nothing it discards is unreachable.
 *
 * @param {object} state The loop's state.
 * @param {string} [stamp] An explicit timestamp, for tests.
 * @returns {string} A branch name unique to this rollback.
 */
function backupRef(state, stamp) {
  const when = stamp || new Date().toISOString().replace(/[:.]/g, '-');
  return `ralph-backup/${state.runId || 'run'}-${when}`;
}

/**
 * Every checkpoint taken before a task link, oldest first.
 *
 * @param {object} state The loop's state.
 * @returns {Array<object>} The task checkpoints.
 */
function taskCheckpoints(state) {
  return (state.checkpoints || []).filter((c) => c.stage === 'task');
}

/**
 * Builds — but never runs — a rollback, as the argv of each step and the state to leave behind.
 *
 * @param {string} mode One of `ROLLBACK_MODES`' keys.
 * @param {object} ctx `{ state, ms, config, merge, clean, stamp }`.
 * @returns {object} `{ ok, why, target, backup, steps, nextState, halts, resumes, summary }`.
 */
function planRollback(mode, ctx) {
  const { state, ms, config } = ctx;
  const base = (config && config.baseBranch) || 'main';

  if (mode === 'restart-link') {
    const target =
      (state.link && state.link.checkpoint) ||
      (state.checkpoints || []).at(-1) ||
      null;
    if (!target || !target.sha) {
      return {
        ok: false,
        why: 'no checkpoint was recorded for the current link — nothing to restart from',
      };
    }
    const backup = backupRef(state, ctx.stamp);
    const branch = target.branch;
    // The backup is not allowed to fail: everything after it discards commits, and a rollback with
    // no way back is the one thing this button must never be.
    const steps = [
      { argv: ['git', 'branch', backup, branch] },
      { argv: ['git', 'checkout', branch] },
      { argv: ['git', 'reset', '--hard', target.sha] },
    ];
    if (ctx.clean) steps.push({ argv: ['git', 'clean', '-fd'] });
    // A link that got as far as labelling its issue leaves the label behind when its commits are
    // reset away, and the chain would then skip the task it just discarded. Taking the label off is
    // allowed to fail: most restarts happen long before the label exists.
    const issue =
      target.issue || (target.stage === 'task' ? state.currentIssue : null);
    if (target.stage === 'task' && issue) {
      steps.push({
        argv: [
          'gh',
          'issue',
          'edit',
          String(issue),
          '--remove-label',
          'ralph:done',
        ],
        allowFail: true,
      });
    }
    return {
      ok: true,
      why: '',
      mode,
      target,
      backup,
      steps,
      nextState: {
        stage: state.stage,
        currentIssue: state.currentIssue,
        link: null,
        attempts: {},
      },
      halts: false,
      resumes: true,
      summary: `restart ${state.stage}${state.currentIssue ? ` (#${state.currentIssue})` : ''} from ${target.sha.slice(0, 7)}`,
    };
  }

  if (mode === 'back-one-task') {
    // Scoped to this phase's own branch. Checkpoints are kept for the whole run, so without this a
    // rollback at the start of phase 2 would reach back into phase 1 and reset a branch that has
    // already merged.
    const phase = lib.phaseOf(ms, state.phaseIndex);
    if (!phase) {
      return {
        ok: false,
        why: 'no phase is in flight — nothing to walk back to',
      };
    }
    // Only while the phase is still being worked. Once its PR is open or merged, the branch these
    // checkpoints name is in review or in the base branch, and resetting it would rewrite history
    // somebody else already has.
    if (phase.status !== 'in-progress') {
      return {
        ok: false,
        why: `phase ${phase.phase} is ${phase.status} — its tasks are no longer a rollback away`,
      };
    }
    const branch = lib.phaseBranch(ms, state.phaseIndex);
    const checkpoints = taskCheckpoints(state).filter(
      (c) => c.branch === branch,
    );
    const inFlight =
      state.link && state.link.stage === 'task' ? state.link.issue : null;
    const undo = [...checkpoints]
      .reverse()
      .find((c) => c.issue && c.issue !== inFlight);
    if (!undo) {
      return {
        ok: false,
        why: 'no finished task has a checkpoint to walk back to',
      };
    }
    // A retried task has more than one checkpoint; the first one is the tree before any attempt.
    const target = checkpoints.find((c) => c.issue === undo.issue);
    const backup = backupRef(state, ctx.stamp);
    const steps = [
      { argv: ['git', 'branch', backup, target.branch] },
      { argv: ['git', 'checkout', target.branch] },
      { argv: ['git', 'reset', '--hard', target.sha] },
    ];
    if (ctx.clean) steps.push({ argv: ['git', 'clean', '-fd'] });
    steps.push({
      argv: [
        'gh',
        'issue',
        'edit',
        String(undo.issue),
        '--remove-label',
        'ralph:done',
      ],
      allowFail: true,
    });
    return {
      ok: true,
      why: '',
      mode,
      target,
      backup,
      steps,
      nextState: {
        stage: 'task',
        currentIssue: null,
        link: null,
        attempts: {},
      },
      halts: false,
      resumes: true,
      summary: `undo task #${undo.issue}, back to ${target.sha.slice(0, 7)}`,
    };
  }

  if (mode === 'revert-merge') {
    const merge = ctx.merge;
    if (!merge || !merge.mergeCommit) {
      return {
        ok: false,
        why: 'no merged PR is recorded for this run — nothing to revert',
      };
    }
    const branch = `revert/${ms.feature}-phase-${merge.phase}`;
    return {
      ok: true,
      why: '',
      mode,
      target: { sha: merge.mergeCommit, branch },
      backup: null,
      steps: [
        { argv: ['git', 'checkout', base] },
        { argv: ['git', 'pull', '--ff-only'] },
        { argv: ['git', 'checkout', '-b', branch] },
        { argv: ['git', 'revert', '-m', '1', '--no-edit', merge.mergeCommit] },
        { argv: ['git', 'push', '-u', 'origin', branch] },
        {
          argv: [
            'gh',
            'pr',
            'create',
            '--base',
            base,
            '--head',
            branch,
            '--title',
            `revert: phase ${merge.phase} of ${ms.feature}`,
            '--body',
            `Reverts the merge of #${merge.pr} (\`${merge.mergeCommit}\`), rolled back from the Ralph monitor.\n\nThe run is halted. Decide what happens to phase ${merge.phase} before restarting it.`,
          ],
        },
      ],
      nextState: { link: null },
      halts: true,
      resumes: false,
      summary: `revert PR #${merge.pr} on a branch of its own`,
    };
  }

  return { ok: false, why: `${mode} is not a rollback this loop knows` };
}

/**
 * A duration as a person would say it.
 *
 * @param {number} ms Milliseconds.
 * @returns {string} `45s`, `2m 05s` or `1h 02m`.
 */
function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * A progress bar of a fixed width, whatever the numbers do.
 *
 * @param {number} value How far along.
 * @param {number} total The whole.
 * @param {number} width How many characters the bar occupies.
 * @returns {string} The bar.
 */
function progressBar(value, total, width) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const filled = Math.min(width, Math.round(ratio * width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

/**
 * Whether a process is still running.
 *
 * @param {number} pid The process id.
 * @returns {boolean} True when the process exists.
 */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Reads the end of a file, which is all a live view ever needs.
 *
 * @param {string} file The path.
 * @param {number} [bytes] How much of the tail to read.
 * @returns {string} The tail, or an empty string when the file cannot be read.
 */
function readTail(file, bytes = TAIL_BYTES) {
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (!length) return '';
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/** Cost per log file, keyed by path, so a tick does not re-read logs that have not changed. */
const costCache = new Map();

/**
 * What the run has spent so far, summed from each finished session's own result line.
 *
 * @param {string} dir The run's log directory.
 * @returns {{ total: number, sessions: number }} Dollars spent, and how many logs reported a cost.
 */
function runCost(dir) {
  let total = 0;
  let sessions = 0;
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return { total: 0, sessions: 0 };
  }
  for (const file of files) {
    if (file === 'events.jsonl') continue;
    const full = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const cached = costCache.get(full);
    let cost = cached && cached.size === stat.size ? cached.cost : null;
    if (cost === null) {
      cost = parseStream(readTail(full, 64 * 1024)).cost;
      costCache.set(full, { size: stat.size, cost });
    }
    if (typeof cost === 'number') {
      total += cost;
      sessions += 1;
    }
  }
  return { total, sessions };
}

/**
 * The tail of the run's event log.
 *
 * @param {string} dir The run's log directory.
 * @param {number} [count] How many events to keep.
 * @returns {Array<object>} The parsed events, oldest first.
 */
function readEvents(dir, count = 40) {
  const text = readTail(path.join(dir, 'events.jsonl'), 64 * 1024);
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      /* a half-written line */
    }
  }
  return events.slice(-count);
}

/**
 * The most recent merge this run performed, which is what a revert would undo.
 *
 * @param {Array<object>} events The run's events.
 * @returns {{ pr: string, phase: number }|null} The merge, or `null` when the run has merged nothing.
 */
function lastMerge(events) {
  // `stage` tells the two merges apart: the merge gate records both the phase PR (`merge`) and the
  // settle PR (`settle-merge`) with the same event type, and only the phase PR is a revert anybody
  // means when they press the button.
  const merged = [...events]
    .reverse()
    .find((e) => e.type === 'merged' && e.stage === 'merge');
  return merged ? { pr: merged.pr, phase: merged.phase } : null;
}

/**
 * Asks GitHub which commit a merge landed as. The one call in this module that touches the network,
 * made only when a rollback is actually being planned.
 *
 * @param {object} merge `{ pr, phase }` as `lastMerge` returns it.
 * @returns {object|null} The merge with `mergeCommit` filled in, or `null` when GitHub cannot say.
 */
function resolveMerge(merge) {
  if (!merge || !merge.pr) return null;
  try {
    const view = lib.gh([
      'pr',
      'view',
      String(merge.pr),
      '--json',
      'mergeCommit,number,title',
    ]);
    if (!view || !view.mergeCommit) return null;
    return { ...merge, mergeCommit: view.mergeCommit.oid, title: view.title };
  } catch {
    return null;
  }
}

/**
 * The latest check receipt the merge gate wrote, if any.
 *
 * @param {string} dir The run's log directory.
 * @returns {object|null} `{ phase, scope, green, failing, at }`, or `null` when nothing has run.
 */
function readChecks(dir) {
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('-checks.json'))
      .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.at - b.at);
  } catch {
    return null;
  }
  const newest = files.at(-1);
  if (!newest) return null;
  try {
    const receipt = JSON.parse(
      fs.readFileSync(path.join(dir, newest.f), 'utf8'),
    );
    const failing = (receipt.results || []).find((r) => r.code !== 0);
    return {
      phase: receipt.phase,
      scope: receipt.scope,
      green: receipt.green,
      failing: failing ? failing.script : null,
      at: receipt.at,
    };
  } catch {
    return null;
  }
}

/**
 * Everything both views draw, read from local files only.
 *
 * @returns {object} The snapshot; `{ ok: false, why }` when no run has been started.
 */
function snapshot() {
  const config = lib.readConfig();
  const overrides = lib.readOverrides();
  const settings = lib.effectiveConfig(config);
  const state = lib.readState();
  const paused = lib.pauseRequested();
  const stopped = lib.stopRequested();
  const halt = stopped ? lib.stopReason() : null;

  if (!state) {
    return {
      ok: false,
      why: 'no run state — start one with `node .claude/ralph-start.js`',
      paused,
      stopped,
      halt,
      settings,
      overrides,
      feature: config.feature,
    };
  }

  let ms = null;
  let msError = null;
  try {
    ms = lib.readMs(config);
  } catch (err) {
    msError = err.message;
  }

  const dir = lib.runDir(state);
  const link = state.link || null;
  const alive = link ? !link.endedAt && isAlive(link.pid) : false;
  const stream = link && link.log ? parseStream(readTail(link.log)) : null;
  const events = readEvents(dir);
  const cost = runCost(dir);
  const progress = ms
    ? phaseProgress(ms, state)
    : { phaseNumber: null, phaseTotal: 0, taskNumber: null, taskTotal: 0 };

  return {
    ok: true,
    runId: state.runId,
    feature: (ms && ms.feature) || config.feature,
    baseBranch: config.baseBranch || 'main',
    branch:
      ms && ms.phases[state.phaseIndex]
        ? lib.phaseBranch(ms, state.phaseIndex)
        : null,
    active: state.active,
    paused,
    stopped,
    halt,
    msError,
    startedAt: state.startedAt,
    elapsedMs: Date.now() - Date.parse(state.startedAt),
    sessions: state.sessions,
    stage: state.stage,
    currentIssue: state.currentIssue,
    progress,
    phases: ms
      ? ms.phases.map((p) => ({
          phase: p.phase,
          title: p.title,
          status: p.status,
        }))
      : [],
    link: link
      ? {
          label: link.label,
          kind: link.kind,
          stage: link.stage,
          issue: link.issue,
          pid: link.pid,
          alive,
          log: link.log,
          logName: path.basename(link.log || ''),
          model: link.model,
          effort: link.effort,
          startedAt: link.startedAt,
          elapsedMs: link.startedAt
            ? Date.now() - Date.parse(link.startedAt)
            : null,
          checkpoint: link.checkpoint || null,
        }
      : null,
    activity: stream ? activityLines(stream, 3) : [],
    stream: stream
      ? {
          turns: stream.turns,
          thinking: stream.thinking,
          cost: stream.cost,
          finished: stream.finished,
          error: stream.error,
          rateLimit: stream.rateLimit,
          result: stream.result ? truncate(oneLine(stream.result), 400) : null,
        }
      : null,
    workers: { active: alive ? 1 : 0, limit: 1 },
    cost: { run: cost.total, sessions: cost.sessions },
    ceilings: {
      sessions: config.maxSessionsPerRun,
      hours: config.maxRunHours,
      retries: settings.taskRetries,
    },
    settings: {
      model: settings.model,
      fallbackModel: settings.fallbackModel || null,
      effort: settings.effort || null,
      maxTurnsPerTask: settings.maxTurnsPerTask,
      maxTurnsPerBookend: settings.maxTurnsPerBookend,
      maxBudgetUsdPerSession: settings.maxBudgetUsdPerSession,
      taskRetries: settings.taskRetries,
    },
    overrides,
    checks: readChecks(dir),
    lastMerge: lastMerge(events),
    events: events.slice(-8),
    logDir: dir,
    at: new Date().toISOString(),
  };
}

/**
 * Records something a person did from a view, in the same log the chain writes to.
 *
 * @param {object} entry What happened.
 * @returns {void}
 */
function record(entry) {
  const state = lib.readState();
  if (state) lib.event(state, { by: 'monitor', ...entry });
}

/**
 * Holds the chain at the next link boundary. The link in flight is left to finish: killing it is
 * what `stop({ kill: true })` and a rollback are for.
 *
 * @param {string} [reason] Why, for the pause file and the event log.
 * @returns {{ ok: boolean, why: string }} The outcome.
 */
function pause(reason = 'paused from the monitor') {
  fs.writeFileSync(lib.PAUSE_PATH, `${new Date().toISOString()} ${reason}\n`);
  record({ type: 'pause', reason });
  return {
    ok: true,
    why: 'paused — the chain stops when the link in flight ends',
  };
}

/**
 * Spawns the one-shot step that asks the chain what comes next. It runs detached, because deciding
 * costs a couple of GitHub round trips and no view should block on them.
 *
 * @param {object} state The loop's state, for its log directory.
 * @returns {number|null} The step's pid.
 */
function spawnAdvance(state, opts = {}) {
  const log = path.join(lib.runDir(state), 'monitor-advance.log');
  const fd = fs.openSync(log, 'a');
  const args = [path.join(lib.CLAUDE_DIR, 'ralph', 'advance.js')];
  if (opts.sessionId) args.push('--session', opts.sessionId);
  const child = spawn(process.execPath, args, {
    cwd: lib.ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    // Stamps the step as part of this run, which is what lets it stand in for a session whose own
    // hook was refused while the chain was paused.
    env: { ...process.env, RALPH_LINK: String(state.runId) },
  });
  child.unref();
  return child.pid || null;
}

/**
 * Lets the chain go on: clears the pause and any halt, and — when nothing is in flight — asks the
 * chain for its next link.
 *
 * @returns {{ ok: boolean, why: string }} The outcome.
 */
function resume() {
  const state = lib.readState();
  if (!state) return { ok: false, why: 'no run state to resume' };
  if (fs.existsSync(lib.PAUSE_PATH)) fs.unlinkSync(lib.PAUSE_PATH);
  if (fs.existsSync(lib.STOP_PATH)) fs.unlinkSync(lib.STOP_PATH);

  // A live pid is not by itself proof that the link can still carry the chain: a session whose hook
  // fired while the pause was down had its one chance refused, and its process may still be winding
  // up for a second or two afterwards. Its own log says which it is — a `result` line means the
  // session is over — and the session id off that log makes standing in for it idempotent with the
  // late hook, should one still arrive.
  const stream =
    state.link && state.link.log
      ? parseStream(readTail(state.link.log, 64 * 1024))
      : null;
  const spent = Boolean(
    state.link && (state.link.endedAt || (stream && stream.finished)),
  );
  const alive = state.link ? isAlive(state.link.pid) : false;
  if (alive && !spent) {
    record({ type: 'resume', why: 'a link is still working' });
    return {
      ok: true,
      why: 'resumed — the link in flight keeps the chain going when it ends',
    };
  }
  if (!state.active) {
    state.active = true;
    lib.writeState(state);
  }
  record({ type: 'resume', why: 'monitor asked the chain for its next link' });
  spawnAdvance(state, { sessionId: stream && stream.sessionId });
  return { ok: true, why: 'resumed — deciding the next link' };
}

/**
 * Kills the link in flight, and its whole process group with it, so no `npm` or `git` it started
 * outlives it.
 *
 * @param {object} state The loop's state.
 * @param {string} [signal] The signal to send.
 * @returns {boolean} True when something was signalled.
 */
function killLink(state, signal = 'SIGTERM') {
  const pid = state && state.link && state.link.pid;
  if (!pid || !isAlive(pid)) return false;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Waits for a process to actually be gone, escalating to `SIGKILL` if it will not go.
 *
 * This blocks on purpose. A rollback resets the working tree the moment it returns, and a session
 * that is still dying is still writing files — running `git reset --hard` alongside it is how a
 * rollback would leave a tree that matches neither the checkpoint nor the work it discarded.
 *
 * It blocks the event loop while it waits, which is safe here for one reason worth stating: a link
 * is never this process's own child — it was spawned by the previous link — so nothing depends on
 * this process reaping it.
 *
 * @param {object} state The loop's state, for the link's pid.
 * @param {number} [graceMs] How long to wait for a polite exit before killing.
 * @param {number} [hardMs] How long to wait after `SIGKILL` before giving up.
 * @returns {boolean} True when nothing is running any more.
 */
function waitForLink(state, graceMs = 8000, hardMs = 3000) {
  const pid = state && state.link && state.link.pid;
  if (!pid) return true;
  const clock = new Int32Array(new SharedArrayBuffer(4));
  /**
   * Blocks the thread briefly, which is the point.
   *
   * @param {number} ms How long.
   * @returns {void}
   */
  const wait = (ms) => Atomics.wait(clock, 0, 0, ms);

  const deadline = Date.now() + graceMs;
  while (isAlive(pid) && Date.now() < deadline) wait(200);
  if (!isAlive(pid)) return true;

  killLink(state, 'SIGKILL');
  const hardDeadline = Date.now() + hardMs;
  while (isAlive(pid) && Date.now() < hardDeadline) wait(200);
  return !isAlive(pid);
}

/**
 * Waits for whatever decision is in flight to finish, so what follows acts on the chain's settled
 * state rather than on a snapshot that is about to change under it.
 *
 * @param {number} [timeoutMs] How long to wait before giving up.
 * @returns {boolean} True when no decision is in flight any more.
 */
function settleDecision(timeoutMs = 3000) {
  const clock = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = lib.claimAdvance();
    if (release) {
      release();
      return true;
    }
    if (Date.now() >= deadline) return false;
    Atomics.wait(clock, 0, 0, 100);
  }
}

/**
 * Halts the run. The stop file goes down before anything is killed, so the dying session's own Stop
 * hook finds the halt already in place and spawns no successor.
 *
 * @param {object} [opts] `{ kill }` to end the link in flight too, rather than let it finish.
 * @returns {{ ok: boolean, why: string }} The outcome.
 */
function stop(opts = {}) {
  const state = lib.readState();
  if (!state) return { ok: false, why: 'no run state to stop' };
  lib.halt(opts.reason || 'stopped from the monitor', state);
  if (!opts.kill)
    return { ok: true, why: 'halted — the link in flight finishes first' };

  // A decision that began just before the halt landed is still allowed to spawn its link; waiting
  // for it to finish means the kill reaches whatever is actually running, rather than the link that
  // was running when the button was pressed.
  settleDecision();
  const current = lib.readState() || state;
  const killed = killLink(current, 'SIGTERM');
  if (killed) {
    setTimeout(() => {
      const now = lib.readState();
      if (now && now.link && isAlive(now.link.pid)) killLink(now, 'SIGKILL');
    }, 5000).unref();
  }
  return {
    ok: true,
    why: killed ? 'halted, and the link in flight killed' : 'halted',
  };
}

/**
 * Runs a rollback.
 *
 * The order matters and is the whole safety of the thing. The right to decide is claimed first, so
 * no hook can spawn a link into the middle of this; the state is read under that claim, so what is
 * killed is what is actually running; the plan is built before anything is destroyed, so a refused
 * rollback leaves the run exactly as it found it; and only then is the chain paused, the link killed
 * and the steps run.
 *
 * @param {string} mode One of `ROLLBACK_MODES`' keys.
 * @param {object} [opts] `{ clean }` to drop untracked files as well.
 * @returns {{ ok: boolean, why: string, plan?: object, ran?: Array<object> }} The outcome.
 */
function rollback(mode, opts = {}) {
  const release = lib.claimAdvance();
  if (!release) {
    return {
      ok: false,
      why: 'the chain is deciding its next link — try again in a moment',
    };
  }
  let spawnAfter = null;
  try {
    const config = lib.readConfig();
    const state = lib.readState();
    if (!state) return { ok: false, why: 'no run state to roll back' };
    let ms;
    try {
      ms = lib.readMs(config);
    } catch (err) {
      return { ok: false, why: `cannot read the MS file: ${err.message}` };
    }

    const merge =
      mode === 'revert-merge'
        ? resolveMerge(lastMerge(readEvents(lib.runDir(state))))
        : null;
    const plan = planRollback(mode, {
      state,
      ms,
      config,
      merge,
      clean: opts.clean,
    });
    if (!plan.ok) return plan;

    // The pause goes down before the kill, so a killed session's Stop hook finds the chain already
    // held. A pause somebody else set is left in place at the end rather than cleared for them.
    const wasPaused = lib.pauseRequested();
    pause(`rollback: ${mode}`);
    killLink(state, 'SIGTERM');
    if (!waitForLink(state)) {
      if (!wasPaused && fs.existsSync(lib.PAUSE_PATH))
        fs.unlinkSync(lib.PAUSE_PATH);
      return {
        ok: false,
        why: `the link in flight (pid ${state.link.pid}) will not die — nothing was rolled back`,
      };
    }

    const ran = [];
    for (const step of plan.steps) {
      const [cmd, ...args] = step.argv;
      const result = lib.run(cmd, args);
      ran.push({ argv: step.argv, code: result.code });
      if (result.code !== 0 && !step.allowFail) {
        record({ type: 'rollback-failed', mode, step: step.argv.join(' ') });
        lib.halt(
          `rollback (${mode}) stopped at \`${step.argv.join(' ')}\`: ${result.stderr.trim() || result.stdout.trim()}`,
          state,
        );
        return {
          ok: false,
          why: `\`${step.argv.join(' ')}\` exited ${result.code}`,
          plan,
          ran,
        };
      }
    }

    const next = lib.readState() || state;
    Object.assign(next, plan.nextState);
    lib.writeState(next);
    record({
      type: 'rollback',
      mode,
      target: plan.target,
      backup: plan.backup,
    });

    if (plan.halts) {
      lib.halt(`rolled back: ${plan.summary}`, next);
      return {
        ok: true,
        why: `${plan.summary} — the run is halted`,
        plan,
        ran,
      };
    }
    if (wasPaused) {
      return {
        ok: true,
        why: `${plan.summary} — still paused, as it was before the rollback`,
        plan,
        ran,
      };
    }
    if (fs.existsSync(lib.PAUSE_PATH)) fs.unlinkSync(lib.PAUSE_PATH);
    // Spawned after the claim is released, since the step it spawns has to claim it in turn.
    spawnAfter = next;
    return {
      ok: true,
      why: `${plan.summary} — the chain is running again`,
      plan,
      ran,
    };
  } finally {
    release();
    if (spawnAfter) spawnAdvance(spawnAfter);
  }
}

/**
 * Changes what the next link is spawned with. A session already running keeps the model, effort and
 * ceilings it was started with — nothing can change those mid-flight.
 *
 * @param {object} patch The settings to set; a `null` or empty value clears an override.
 * @returns {{ ok: boolean, why: string, overrides?: object }} The outcome.
 */
function applySettings(patch) {
  const accepted = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    const verdict = validateSetting(key, raw);
    if (!verdict.ok) return { ok: false, why: verdict.why };
    accepted[key] = verdict.value;
  }
  if (!Object.keys(accepted).length)
    return { ok: false, why: 'nothing to change' };
  const overrides = lib.writeOverrides(accepted);
  record({ type: 'settings', patch: accepted });
  return {
    ok: true,
    why: 'saved — the next link is spawned with it',
    overrides,
  };
}

module.exports = {
  ACTIVITY_WIDTH,
  EFFORTS,
  ROLLBACK_MODES,
  SETTINGS,
  activityLines,
  applySettings,
  describeToolUse,
  formatDuration,
  isAlive,
  killLink,
  lastMerge,
  parseStream,
  pause,
  phaseProgress,
  planRollback,
  progressBar,
  readEvents,
  readTail,
  resolveMerge,
  resume,
  rollback,
  runCost,
  settleDecision,
  shortPath,
  snapshot,
  spawnAdvance,
  stop,
  truncate,
  validateSetting,
  waitForLink,
};
