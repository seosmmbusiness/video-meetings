'use strict';

/**
 * The merge gate's own suite: `node --test .claude/ralph/verify.test.js`.
 *
 * Small on purpose — the gate itself is npm scripts and a `gh pr merge`, and running those is what
 * the gate is for. What is asserted here is the one piece of reasoning it does: telling a check set
 * that came back red from a check set that was killed. Getting that backwards is expensive in a way
 * a suite can prevent — the step writes a receipt, comments the "failure" on the real PR and halts
 * the run, all because somebody pressed Stop.
 */

const test = require('node:test');
const assert = require('node:assert');

const verify = require('./verify');

test('abandoned finds the check a signal killed', () => {
  const killed = verify.abandoned([
    { script: 'lint', code: 0, signal: null },
    { script: 'test', code: 1, signal: 'SIGTERM' },
  ]);
  assert.equal(killed.script, 'test');
});

test('abandoned sees nothing in a check set that merely went red', () => {
  assert.equal(
    verify.abandoned([
      { script: 'lint', code: 0, signal: null },
      { script: 'test', code: 1, signal: null },
    ]),
    null,
  );
});

test('abandoned copes with a check set that never started', () => {
  assert.equal(verify.abandoned([]), null);
  assert.equal(verify.abandoned(undefined), null);
});

test('parseArgs reads the step options the chain spawns it with', () => {
  assert.deepEqual(
    verify.parseArgs([
      '--phase-index',
      '2',
      '--pr',
      'https://github.com/x/y/pull/9',
      '--scope',
      'docs',
    ]),
    { phaseIndex: 2, pr: 'https://github.com/x/y/pull/9', scope: 'docs' },
  );
});

test('parseArgs defaults the scope to the full check set', () => {
  assert.equal(verify.parseArgs(['--pr', 'https://x/1']).scope, 'full');
});

test('parseArgs refuses to run without a PR to gate', () => {
  assert.throws(
    () => verify.parseArgs(['--scope', 'full']),
    /--pr is required/,
  );
});

const CONFIG = {
  checks: {
    api: ['lint', 'format:check', 'test', 'test:int:api', 'test:e2e:api'],
    web: ['lint', 'format:check', 'test', 'test:e2e:web'],
  },
  phases: [
    { phase: 1, layer: 'api', needsDb: true },
    { phase: 2, layer: 'web', needsDb: true },
  ],
};

test('a phase PR is gated on its own layer’s check set', () => {
  assert.deepEqual(verify.checkScripts(CONFIG, 0, 'full'), CONFIG.checks.api);
  assert.deepEqual(verify.checkScripts(CONFIG, 1, 'full'), CONFIG.checks.web);
});

test('a settle PR is gated on the checks a docs-only commit can fail', () => {
  assert.deepEqual(verify.checkScripts(CONFIG, 1, 'docs'), [
    'lint',
    'format:check',
  ]);
});

test('the close-out gate runs both layers once, in order, and builds', () => {
  // The last gate of the whole feature: it re-proves what close-feature claimed the acceptance
  // criteria on, so it cannot be narrower than the union of the phases it is closing.
  assert.deepEqual(verify.checkScripts(CONFIG, 2, 'closeout'), [
    'lint',
    'format:check',
    'test',
    'test:int:api',
    'test:e2e:api',
    'test:e2e:web',
    'build',
  ]);
});

test('the close-out gate stands up its own infrastructure, whatever the phase said', () => {
  // `--phase-index` points past the last phase by then, so nothing about needsDb can be read off it.
  assert.equal(verify.needsDb(CONFIG, 9, 'closeout'), true);
  assert.equal(verify.needsDb(CONFIG, 0, 'full'), true);
  assert.equal(
    verify.needsDb({ ...CONFIG, phases: [{ phase: 1 }] }, 0, 'full'),
    false,
  );
  assert.equal(verify.needsDb(CONFIG, 0, 'docs'), false);
});

test('the gate checks the PR’s own branch, and switches to it when it is not there', () => {
  // The chain is normally already on the branch it is about to merge — the close stage left it
  // there. A run resumed by hand can be anywhere, and checks that pass on another branch say
  // nothing at all about the PR they would merge.
  assert.deepEqual(
    verify.branchPlan('feature/x-phase-1', 'feature/x-phase-1', false),
    {
      action: 'none',
      why: '',
    },
  );
  assert.equal(
    verify.branchPlan('main', 'chore/x-closeout', false).action,
    'checkout',
  );
});

test('the gate refuses to switch over work somebody left in the tree', () => {
  const plan = verify.branchPlan('main', 'chore/x-closeout', true);
  assert.equal(plan.action, 'refuse');
  assert.match(plan.why, /chore\/x-closeout/);
});

test('a PR whose branch cannot be read is checked where the chain stands', () => {
  assert.equal(verify.branchPlan('main', null, false).action, 'none');
  assert.equal(verify.branchPlan('main', '', true).action, 'none');
});

test('after a merge the tree goes back to the base branch it merged into', () => {
  // The gate checks out the PR's branch to run the checks. Left there, the next decision — and the
  // survey of what is open — would read a branch that has just been merged and deleted.
  assert.equal(
    verify.branchPlan('chore/x-closeout', 'main', false).action,
    'checkout',
  );
  assert.equal(verify.branchPlan('main', 'main', false).action, 'none');
});
