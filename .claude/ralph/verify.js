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
 * @returns {{ script: string, code: number, tail: string }} Its exit code and the tail of its output.
 */
function npmRun(script) {
  process.stdout.write(`\n=== npm run ${script} ===\n`);
  const res = lib.run('npm', ['run', script], { stdio: 'pipe' });
  process.stdout.write(res.stdout);
  process.stdout.write(res.stderr);
  const tail = `${res.stdout}${res.stderr}`.split('\n').slice(-25).join('\n');
  return { script, code: res.code, tail };
}

/**
 * Runs the pipeline's documentation linter, which every commit touching `docs/` has to pass.
 *
 * @returns {{ script: string, code: number, tail: string }} Its exit code and output tail.
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
  return { script: 'docs-lint', code: res.code, tail };
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
  let api = null;

  if (phase.needsDb) {
    const up = npmRun('db:up');
    results.push(up);
    if (up.code !== 0) return results;
  }

  if (scripts.includes('test:e2e:web')) {
    // Playwright's own webServer starts apps/web on 3000; apps/api on 3001 is ours to start.
    process.stdout.write('\n=== starting apps/api for the browser suite ===\n');
    api = require('node:child_process').spawn('npm', ['run', 'dev:api'], {
      cwd: lib.ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    if (!(await waitForPort(3001, 120_000))) {
      if (api) process.kill(-api.pid, 'SIGTERM');
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
    if (api) {
      try {
        process.kill(-api.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  return results;
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

main().catch((err) => {
  const state = lib.readState();
  lib.halt(`verify step threw: ${err.message}`, state);
  process.exitCode = 1;
});
