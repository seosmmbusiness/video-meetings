'use strict';

/**
 * The Ralph loop's merge gate.
 *
 * Full auto means no person reads the PR before it lands, so what guards the base branch has to be
 * an exit code rather than a session's account of itself. This step re-runs the phase's whole check
 * set here, writes the receipt, and merges only on a clean sweep. A single non-zero exit halts the
 * chain with the failing command and its output kept in the log.
 *
 * Usage: node .claude/ralph/verify.js --phase-index <n> --pr <url> --scope full|docs
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const lib = require('./lib');

/**
 * The apps/api server this step started, when it started one. Kept at module scope so a signal can
 * reach it: the monitor's Stop and Rollback kill this step's process group, and `npm run dev:api` is
 * spawned detached into a group of its own, so nothing but this handler would take it down with us.
 */
let apiServer = null;

/**
 * Stops the apps/api server this step started, its whole process group with it.
 *
 * @returns {void}
 */
function stopApiServer() {
  if (!apiServer) return;
  const { pid } = apiServer;
  apiServer = null;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return; // already gone
  }
  // This process is usually about to exit, so there is no event loop left to wait on: block briefly
  // and make sure. A dev server left holding port 3001 would answer the next merge gate's readiness
  // probe and let a browser suite run green against the previous build.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* it went on the first signal */
  }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    stopApiServer();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

/**
 * Parses this step's own arguments.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ phaseIndex: number, pr: string, scope: string }} The parsed options.
 * @throws {Error} When a required option is missing.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2)
    out[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!out.pr) throw new Error('--pr is required');
  return {
    phaseIndex: Number(out['phase-index'] || 0),
    pr: out.pr,
    scope: out.scope || 'full',
  };
}

/**
 * Waits for a TCP port to accept a connection, which is how the loop knows apps/api is up before
 * the browser suite runs against it.
 *
 * @param {number} port The port to probe.
 * @param {number} timeoutMs How long to keep trying.
 * @returns {Promise<boolean>} True once the port answers, false on timeout.
 */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

/**
 * Runs one npm script and reports how it went.
 *
 * @param {string} script The root script name, e.g. `test:int:api`.
 * @returns {{ script: string, code: number, signal: string|null, tail: string }} How it went.
 */
function npmRun(script) {
  process.stdout.write(`\n=== npm run ${script} ===\n`);
  const res = lib.run('npm', ['run', script], { stdio: 'pipe' });
  process.stdout.write(res.stdout);
  process.stdout.write(res.stderr);
  const tail = `${res.stdout}${res.stderr}`.split('\n').slice(-25).join('\n');
  return { script, code: res.code, signal: res.signal, tail };
}

/**
 * Runs the pipeline's documentation linter, which every commit touching `docs/` has to pass.
 *
 * @returns {{ script: string, code: number, signal: string|null, tail: string }} How it went.
 */
function docsLint() {
  process.stdout.write('\n=== docs-lint ===\n');
  const res = lib.run(
    process.execPath,
    ['plugins/bldprj/scripts/docs-lint.mjs', '.'],
    {
      stdio: 'pipe',
    },
  );
  process.stdout.write(res.stdout);
  process.stdout.write(res.stderr);
  const tail = `${res.stdout}${res.stderr}`.split('\n').slice(-25).join('\n');
  return { script: 'docs-lint', code: res.code, signal: res.signal, tail };
}

/**
 * Runs the check set a scope calls for, bringing up whatever infrastructure it needs first and
 * taking it down afterwards.
 *
 * @param {object} config The loop config.
 * @param {number} phaseIndex Zero-based index into `config.phases`.
 * @param {string} scope `'full'` for a phase PR, `'docs'` for a settle PR.
 * @returns {Promise<Array<object>>} One result per check, in the order they ran.
 */
async function runChecks(config, phaseIndex, scope) {
  if (scope === 'docs')
    return [npmRun('lint'), npmRun('format:check'), docsLint()];

  const layer = lib.layerOf(config, phaseIndex);
  const scripts = config.checks[layer] || config.checks.api;
  const phase = config.phases[phaseIndex] || {};
  const results = [];
  if (phase.needsDb) {
    const up = npmRun('db:up');
    results.push(up);
    if (up.code !== 0) return results;
  }

  if (scripts.includes('test:e2e:web')) {
    // Playwright's own webServer starts apps/web on 3000; apps/api on 3001 is ours to start.
    process.stdout.write('\n=== starting apps/api for the browser suite ===\n');
    apiServer = require('node:child_process').spawn('npm', ['run', 'dev:api'], {
      cwd: lib.ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    if (!(await waitForPort(3001, 120_000))) {
      stopApiServer();
      return [
        ...results,
        { script: 'apps/api start', code: 1, tail: 'port 3001 never answered' },
      ];
    }
  }

  try {
    for (const script of scripts) {
      const result = npmRun(script);
      results.push(result);
      if (result.code !== 0) break;
    }
    if (results.every((r) => r.code === 0)) results.push(docsLint());
  } finally {
    stopApiServer();
  }
  return results;
}

/**
 * The check that was killed rather than failed, if any.
 *
 * A command terminated by a signal comes back with no exit code, and the merge gate must not read
 * that as a red check set: it is what being stopped looks like from in here.
 *
 * @param {Array<object>} results The check results so far.
 * @returns {object|null} The killed check, or `null` when every check ran to an exit code.
 */
function abandoned(results) {
  return (results || []).find((r) => r && r.signal) || null;
}

/**
 * Runs the checks, merges the PR when they all pass, and hands the chain on.
 *
 * @returns {Promise<void>} Resolves once the successor has been spawned or the chain has halted.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = lib.readConfig();
  const state = lib.readState();

  if (!state || !state.active || lib.stopRequested()) {
    process.stdout.write('Ralph: verify step declining — run is not active\n');
    return;
  }

  const results = await runChecks(config, opts.phaseIndex, opts.scope);

  // Being killed is not a red check set. The monitor's Stop and Rollback write the stop or pause
  // file *before* they signal this step's process group, and a check that dies with its parent comes
  // back with a signal rather than an exit code — either way, what happened is that a person stopped
  // the run, and reporting it as a failed gate would comment on the PR and halt with a false reason.
  const aborted = abandoned(results);
  if (aborted || lib.stopRequested() || lib.pauseRequested()) {
    process.stdout.write(
      `\nRalph: checks abandoned — ${aborted ? `\`${aborted.script}\` was killed by ${aborted.signal}` : 'the run was halted or paused while they ran'}. Nothing reported.\n`,
    );
    return;
  }

  const receipt = {
    at: new Date().toISOString(),
    phase: opts.phaseIndex + 1,
    scope: opts.scope,
    pr: opts.pr,
    results,
    green: results.every((r) => r.code === 0),
  };
  fs.writeFileSync(
    path.join(
      lib.runDir(state),
      `phase-${opts.phaseIndex + 1}-${opts.scope}-checks.json`,
    ),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  lib.event(state, { type: 'checks', scope: opts.scope, green: receipt.green });

  if (!receipt.green) {
    const failed = results.find((r) => r.code !== 0);
    lib.run('gh', [
      'pr',
      'comment',
      opts.pr,
      '--body',
      `Ralph did not merge this PR: \`${failed.script}\` exited ${failed.code}.\n\n\`\`\`\n${failed.tail}\n\`\`\``,
    ]);
    lib.halt(
      `${failed.script} exited ${failed.code} — PR ${opts.pr} left open`,
      state,
    );
    return;
  }

  const pr = lib.prView(opts.pr);
  if (pr.state !== 'OPEN') {
    process.stdout.write(`PR ${opts.pr} is ${pr.state}, not merging again\n`);
  } else {
    if (pr.mergeable === 'CONFLICTING') {
      lib.halt(
        `PR ${opts.pr} has conflicts — a human decides how they resolve`,
        state,
      );
      return;
    }
    const strategy = `--${config.mergeStrategy || 'merge'}`;
    process.stdout.write(`\n=== gh pr merge ${strategy} ${opts.pr} ===\n`);
    const merged = lib.run('gh', ['pr', 'merge', opts.pr, strategy]);
    process.stdout.write(merged.stdout + merged.stderr);
    if (merged.code !== 0) {
      lib.halt(`gh pr merge failed: ${merged.stderr.trim()}`, state);
      return;
    }
    lib.event(state, { type: 'merged', pr: opts.pr, strategy });
  }

  lib.advance();
}

module.exports = { abandoned, parseArgs };

// Only when run as a step of the chain: requiring this file — a suite does — must not merge a PR.
if (require.main === module) {
  main().catch((err) => {
    const state = lib.readState();
    lib.halt(`verify step threw: ${err.message}`, state);
    process.exitCode = 1;
  });
}
