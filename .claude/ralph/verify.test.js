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
