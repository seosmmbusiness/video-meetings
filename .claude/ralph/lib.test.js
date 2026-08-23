'use strict';

/**
 * The chain runtime's suite: `node --test .claude/ralph/lib.test.js`.
 *
 * Only the parts that are pure reasoning rather than a session: who is allowed to decide what
 * happens next, and what a dry run is allowed to touch. Everything here works on a lock file of its
 * own under the OS temp directory — never `.claude/ralph.advance.lock` — so running the suite while
 * a real loop is going cannot take the lock a live decision needs.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('./lib');

/**
 * A lock path of this test's own.
 *
 * @param {string} name What the file is called.
 * @returns {string} An absolute path in a fresh temp directory.
 */
function tempLock(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-lock-'));
  return path.join(dir, name);
}

test('claimAdvance lets one caller decide and refuses the next', () => {
  const lock = tempLock('advance.lock');
  const first = lib.claimAdvance(lock);
  assert.ok(first, 'the first claim was refused');
  assert.equal(lib.claimAdvance(lock), null, 'two callers held it at once');
  first();
  const second = lib.claimAdvance(lock);
  assert.ok(second, 'the lock was not released');
  second();
  assert.equal(fs.existsSync(lock), false);
});

test('claimAdvance takes over a lock whose holder is gone', () => {
  const lock = tempLock('advance.lock');
  fs.writeFileSync(
    lock,
    `${JSON.stringify({ pid: 0x7fffffff, nonce: 'dead', at: new Date().toISOString() })}\n`,
  );
  const claim = lib.claimAdvance(lock);
  assert.ok(claim, 'a lock left by a dead process wedged the chain');
  claim();
});

test('claimAdvance leaves a lock alone while its holder is alive', () => {
  const lock = tempLock('advance.lock');
  fs.writeFileSync(
    lock,
    `${JSON.stringify({ pid: process.pid, nonce: 'live', at: new Date().toISOString() })}\n`,
  );
  assert.equal(lib.claimAdvance(lock), null);
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).nonce, 'live');
});

test('releasing a claim never deletes somebody else’s lock', () => {
  const lock = tempLock('advance.lock');
  const release = lib.claimAdvance(lock);
  assert.ok(release);
  // Somebody else's claim, as a stale takeover would leave it.
  fs.writeFileSync(
    lock,
    `${JSON.stringify({ pid: process.pid, nonce: 'theirs', at: new Date().toISOString() })}\n`,
  );
  release();
  assert.equal(
    fs.existsSync(lock),
    true,
    'a slow release deleted the claim somebody else had made',
  );
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).nonce, 'theirs');
});

test('a dry run keeps its state in memory and writes nothing', () => {
  const before = fs.existsSync(lib.STATE_PATH)
    ? fs.readFileSync(lib.STATE_PATH, 'utf8')
    : null;
  process.env.RALPH_DRY_RUN = '1';
  try {
    const composed = {
      runId: 1,
      active: true,
      phaseIndex: 0,
      stage: 'start',
      sessions: 0,
      startedAt: new Date().toISOString(),
    };
    lib.writeState(composed);
    // What the decision that follows reads back is what the dry run composed, not what an older run
    // left on disk — that is the whole reason the in-memory slot exists.
    assert.deepEqual(lib.readState(), composed);
  } finally {
    delete process.env.RALPH_DRY_RUN;
  }
  const after = fs.existsSync(lib.STATE_PATH)
    ? fs.readFileSync(lib.STATE_PATH, 'utf8')
    : null;
  assert.equal(after, before, 'a dry run wrote the real state file');
});

/**
 * A hold path of this test's own, so arming one here never reaches a live run.
 *
 * @returns {string} An absolute path in a fresh temp directory.
 */
function tempHold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-hold-'));
  return path.join(dir, 'ralph.hold.json');
}

test('a hold is armed, read back, and cleared without leaving a file behind', () => {
  const file = tempHold();
  assert.equal(
    lib.readHold(file),
    null,
    'a hold was armed before anything armed one',
  );
  const armed = lib.writeHold({ action: 'stop', at: 'phase' }, file);
  assert.equal(armed.action, 'stop');
  assert.equal(armed.at, 'phase');
  assert.ok(armed.armedAt, 'the hold does not say when it was armed');
  assert.equal(lib.readHold(file).at, 'phase');
  lib.writeHold(null, file);
  assert.equal(lib.readHold(file), null);
  assert.equal(fs.existsSync(file), false);
});

test('a corrupt hold file reads as no hold rather than throwing', () => {
  const file = tempHold();
  fs.writeFileSync(file, '{ this is not json');
  assert.equal(lib.readHold(file), null);
});

test('a hold naming something the chain cannot do reads as no hold', () => {
  const file = tempHold();
  fs.writeFileSync(file, JSON.stringify({ action: 'reboot', at: 'phase' }));
  assert.equal(
    lib.readHold(file),
    null,
    'an action the chain has no name for was honoured',
  );
  fs.writeFileSync(file, JSON.stringify({ action: 'stop', at: 'commit' }));
  assert.equal(
    lib.readHold(file),
    null,
    'a boundary the chain never reaches was honoured',
  );
});

test('a task hold fires the moment a task boundary is reached', () => {
  assert.equal(lib.holdFiresAt({ action: 'stop', at: 'task' }, 'task'), true);
});

test('a task hold fires at the end of a phase too, when no task boundary came first', () => {
  // Armed while a close, merge or settle link was in flight, a task hold would otherwise sit
  // through the whole phase boundary and stop somewhere in the middle of the next phase.
  assert.equal(lib.holdFiresAt({ action: 'stop', at: 'task' }, 'phase'), true);
});

test('a phase hold sits through task boundaries and fires only at the end of the phase', () => {
  assert.equal(
    lib.holdFiresAt({ action: 'pause', at: 'phase' }, 'task'),
    false,
  );
  assert.equal(
    lib.holdFiresAt({ action: 'pause', at: 'phase' }, 'phase'),
    true,
  );
});

test('nothing fires when no hold is armed, or at a boundary that is not one', () => {
  assert.equal(lib.holdFiresAt(null, 'phase'), false);
  assert.equal(lib.holdFiresAt({ action: 'stop', at: 'task' }, 'link'), false);
});

test('describeHold reads back as the control that armed it', () => {
  assert.equal(
    lib.describeHold({ action: 'pause', at: 'phase' }),
    'pause after this phase',
  );
  assert.equal(
    lib.describeHold({ action: 'stop', at: 'task' }),
    'stop after this task',
  );
  assert.equal(lib.describeHold(null), null);
});

test('the ceilings are measured over the whole run until it is resumed', () => {
  const started = '2026-08-20T00:00:00.000Z';
  const state = { startedAt: started, sessions: 12 };
  assert.deepEqual(lib.budgetWindow(state), { since: started, sessions: 0 });
  assert.equal(
    lib.ceilingSpent(
      { maxSessionsPerRun: 60, maxRunHours: 8 },
      state,
      Date.parse(started) + 3_600_000,
    ),
    null,
  );
  assert.match(
    lib.ceilingSpent(
      { maxRunHours: 8 },
      state,
      Date.parse(started) + 9 * 3_600_000,
    ) || '',
    /wall-clock ceiling/,
  );
  assert.match(
    lib.ceilingSpent({ maxSessionsPerRun: 12 }, state, Date.parse(started)) ||
      '',
    /session ceiling/,
  );
});

test('a resume grants the run its ceilings again, counted from the resume', () => {
  // The run that stopped at a phase boundary last night is picked up this morning: the hours it
  // spent waiting for a person are not hours it spent working, and a resumed run that refused to
  // advance on the ceiling it had already hit is what made this window exist.
  const started = '2026-08-20T00:00:00.000Z';
  const resumed = '2026-08-21T09:00:00.000Z';
  const state = {
    startedAt: started,
    sessions: 12,
    budget: { since: resumed, sessions: 12 },
  };
  assert.deepEqual(lib.budgetWindow(state), { since: resumed, sessions: 12 });
  assert.equal(
    lib.ceilingSpent(
      { maxSessionsPerRun: 60, maxRunHours: 8 },
      state,
      Date.parse(resumed) + 3_600_000,
    ),
    null,
    'a resumed run was refused on the budget it had already spent',
  );
  assert.match(
    lib.ceilingSpent(
      { maxSessionsPerRun: 60 },
      { ...state, sessions: 72 },
      Date.parse(resumed),
    ) || '',
    /session ceiling/,
    'the resumed window never ends',
  );
});

/**
 * A state whose link is one session, with a log this suite controls.
 *
 * @param {object} link What to record as the link in flight.
 * @returns {object} A state object shaped like the loop's own.
 */
function stateWithLink(link) {
  return { runId: 1, active: true, phaseIndex: 0, stage: 'task', link };
}

test('the link’s own hook is allowed to decide what happens next', () => {
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    { session_id: 'abc' },
    { alive: () => true, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, true, verdict.why);
});

test('a hook from a session that is not the link in flight decides nothing', () => {
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    { session_id: 'orphan' },
    { alive: () => true, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /orphan/);
});

test('an orphan whose own session has already died still decides nothing', () => {
  // The duplicate-session race: a session the chain replaced ends minutes later, its Stop hook
  // fires, and the chain reads it as the *current* link finishing — retry, second session, one
  // working tree, two agents.
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    { session_id: 'orphan' },
    { alive: () => false, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, false);
});

test('an advance with no session id waits while a link is still alive', () => {
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    {},
    { alive: () => true, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /still in flight/);
});

test('an advance with no session id is allowed once the link is gone', () => {
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    {},
    { alive: () => false, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, true, verdict.why);
});

test('a step decides from its own process, and from no other', () => {
  const link = { kind: 'step', pid: process.pid, log: '/dev/null' };
  assert.equal(
    lib.linkOwner(stateWithLink(link), {}, { alive: () => true }).ok,
    true,
  );
  assert.equal(
    lib.linkOwner(
      stateWithLink({ ...link, pid: process.pid + 1 }),
      {},
      { alive: () => true },
    ).ok,
    false,
  );
});

test('a link already stamped as ended never blocks the chain', () => {
  const verdict = lib.linkOwner(
    stateWithLink({
      kind: 'session',
      pid: 1234,
      log: '/dev/null',
      endedAt: new Date().toISOString(),
    }),
    { session_id: 'whoever' },
    { alive: () => true, sessionOf: () => 'abc' },
  );
  assert.equal(verdict.ok, true, verdict.why);
});

test('a chain with nothing in flight lets its next link be decided', () => {
  assert.equal(lib.linkOwner({ runId: 1 }, {}, {}).ok, true);
});

test('a dead link whose session id cannot be read stops blocking the chain', () => {
  const verdict = lib.linkOwner(
    stateWithLink({ kind: 'session', pid: 1234, log: '/dev/null' }),
    { session_id: 'late' },
    { alive: () => false, sessionOf: () => null },
  );
  assert.equal(verdict.ok, true, verdict.why);
});

test('linkSessionId reads the id off a session log, newest line first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-log-'));
  const log = path.join(dir, 'link.jsonl');
  fs.writeFileSync(
    log,
    `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-1' })}\n` +
      `${JSON.stringify({ type: 'assistant', session_id: 'sid-1' })}\n`,
  );
  assert.equal(lib.linkSessionId({ log }), 'sid-1');
  assert.equal(
    lib.linkSessionId({ log: path.join(dir, 'missing.jsonl') }),
    null,
  );
  assert.equal(lib.linkSessionId(null), null);
});

test('a resumed run keeps the link the chain is waiting on', () => {
  const existing = {
    runId: 7,
    phaseIndex: 2,
    stage: 'task',
    sessions: 12,
    startedAt: '2026-08-23T10:00:00.000Z',
    checkpoints: [{ sha: 'abc' }],
    attempts: { 'task-164': 1 },
    link: { kind: 'session', pid: 4242, log: '/tmp/link.jsonl' },
    closeout: { pr: 'https://example.test/pull/1' },
  };
  const next = lib.startState({ existing, resuming: true });
  // Dropping it is how the duplicate-session race began: with no link recorded, the next caller of
  // advance() looked like the session in flight ending, and the chain spawned a second one.
  assert.deepEqual(next.link, existing.link);
  assert.deepEqual(next.closeout, existing.closeout);
  assert.equal(next.runId, 7);
  assert.equal(next.sessions, 12);
  assert.equal(next.phaseIndex, 2);
  assert.equal(next.stage, 'task');
  assert.equal(next.budget.sessions, 12);
  assert.notEqual(next.budget.since, existing.startedAt);
});

test('a fresh run starts with no link, no checkpoints and its ceilings at zero', () => {
  const next = lib.startState({
    existing: {
      runId: 7,
      link: { pid: 1 },
      checkpoints: [{ sha: 'abc' }],
      sessions: 12,
    },
    resuming: false,
    phaseIndex: 0,
  });
  assert.equal(next.link, undefined);
  assert.deepEqual(next.checkpoints, []);
  assert.equal(next.sessions, 0);
  assert.equal(next.stage, 'start');
  assert.equal(next.budget.sessions, 0);
});

test('resuming at a named phase re-enters that phase from the start', () => {
  const existing = {
    runId: 7,
    phaseIndex: 2,
    stage: 'task',
    sessions: 3,
    link: { pid: 1 },
  };
  const next = lib.startState({
    existing,
    resuming: true,
    phaseIndex: 4,
    phaseNamed: true,
  });
  assert.equal(next.phaseIndex, 4);
  assert.equal(next.stage, 'start');
});

/**
 * An MS file shaped like the pipeline's own, with every phase in the state asked for.
 *
 * @param {string[]} statuses One status per phase.
 * @returns {object} The MS file.
 */
function msWith(statuses) {
  return {
    feature: 'demo',
    track: 'feature',
    sources: { final: 'docs/demo/demo-FINAL.md' },
    phases: statuses.map((status, i) => ({
      phase: i + 1,
      title: `phase ${i + 1}`,
      status,
      milestone: { number: i + 1, title: `Demo ${i + 1}` },
      issues: [],
      pr: { url: `https://example.test/pull/${i + 1}` },
    })),
  };
}

test('the close-out branch is the one close-feature cuts', () => {
  assert.equal(
    lib.closeoutBranch(msWith(['completed'])),
    'chore/demo-closeout',
  );
  assert.equal(
    lib.closeoutBranch({ ...msWith(['completed']), track: 'refactor' }),
    'chore/demo-closeout',
  );
});

test('every phase settled and no close-out PR yet runs close-feature', () => {
  const state = { phaseIndex: 2, stage: 'next' };
  const next = lib.reconcile({}, msWith(['completed', 'completed']), state, {
    openPr: () => null,
  });
  assert.equal(next.stage, 'done');
});

test('an open close-out PR goes to the merge gate rather than to a second close-feature', () => {
  const state = { phaseIndex: 2, stage: 'done' };
  const next = lib.reconcile({}, msWith(['completed', 'completed']), state, {
    openPr: (branch) =>
      branch === 'chore/demo-closeout'
        ? { number: 9, url: 'https://example.test/pull/9' }
        : null,
  });
  assert.equal(next.stage, 'closeout-merge');
  assert.match(next.why, /#9/);
});

test('a merged close-out is the end of the run, not another lap', () => {
  const state = {
    phaseIndex: 2,
    stage: 'closeout-merge',
    closeout: {
      pr: 'https://example.test/pull/9',
      mergedAt: '2026-08-23T20:00:00.000Z',
    },
  };
  const next = lib.reconcile({}, msWith(['completed', 'completed']), state, {
    openPr: () => null,
  });
  assert.equal(next.stage, 'finished');
});

test('the close-out session is told to open the PR and leave the merge to the loop', () => {
  const prompt = lib.promptFor('done', {
    config: { baseBranch: 'main' },
    ms: msWith(['completed']),
    state: { phaseIndex: 1 },
  });
  assert.match(prompt, /close-feature demo/);
  assert.doesNotMatch(prompt, /leave it for the user/);
  assert.match(prompt, /do not merge the close-out PR/i);
  assert.match(prompt, /loop[\s\S]{0,80}merges/i);
});

test('a close-out session that opened no PR is retried rather than believed', () => {
  const ms = msWith(['completed', 'completed']);
  const state = { phaseIndex: 2, stage: 'done' };
  const missing = lib.verifyPreviousStage({}, ms, state, {
    openPr: () => null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.retry, true);
  assert.equal(missing.key, 'closeout');

  const opened = lib.verifyPreviousStage({}, ms, state, {
    openPr: () => ({ number: 9, url: 'https://example.test/pull/9' }),
  });
  assert.equal(opened.ok, true, opened.why);
});

test('the MS file is still found after close-out has archived it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-ms-'));
  fs.mkdirSync(path.join(root, 'docs/archive/demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs/archive/demo/demo-MS.json'),
    JSON.stringify({ feature: 'demo', phases: [] }),
  );
  const ms = lib.readMs({ ms: 'docs/demo/demo-MS.json' }, root);
  assert.equal(ms.feature, 'demo');
  assert.throws(() => lib.readMs({ ms: 'docs/gone/gone-MS.json' }, root));
});

/**
 * A throwaway repository with one committed file and one uncommitted change.
 *
 * @returns {string} The repository's path.
 */
function repoWithDirtyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-stash-'));
  const git = (...args) =>
    require('node:child_process').execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  git('init', '--initial-branch', 'main');
  git('config', 'user.email', 'suite@example.test');
  git('config', 'user.name', 'Suite');
  fs.writeFileSync(path.join(dir, 'tracked.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git('commit', '-m', 'first');
  fs.writeFileSync(path.join(dir, 'tracked.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(dir, 'untracked.ts'), 'export const b = 3;\n');
  return dir;
}

test('a resume puts what an interrupted session left behind into a stash of its own', () => {
  const cwd = repoWithDirtyTree();
  const state = { runId: 42, stage: 'task', currentIssue: 164 };
  const stash = lib.stashDirty(state, { cwd });
  assert.ok(stash, 'nothing was stashed');
  assert.match(stash.sha, /^[0-9a-f]{7,40}$/);
  assert.match(stash.message, /ralph\/42/);
  // Untracked files go too, or the next session inherits half of the interrupted one's work.
  assert.deepEqual(stash.files.sort(), ['tracked.ts', 'untracked.ts']);
  const status = require('node:child_process').execFileSync(
    'git',
    ['status', '--porcelain'],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(status.trim(), '', 'the tree was left dirty');
  const list = require('node:child_process').execFileSync(
    'git',
    ['stash', 'list'],
    { cwd, encoding: 'utf8' },
  );
  assert.match(list, /ralph\/42/);
});

test('a clean tree is stashed as nothing at all', () => {
  const cwd = repoWithDirtyTree();
  require('node:child_process').execFileSync('git', ['stash', 'push', '-u'], {
    cwd,
    stdio: 'ignore',
  });
  assert.equal(lib.stashDirty({ runId: 1 }, { cwd }), null);
});

test('the next session is told what the stash holds and how to judge it', () => {
  const ms = msWith(['in-progress']);
  const prompt = lib.promptFor('task', {
    config: { baseBranch: 'main', ms: 'docs/demo/demo-MS.json' },
    ms,
    state: {
      phaseIndex: 0,
      stash: {
        sha: 'deadbeef',
        message: 'ralph/42 task #164',
        files: ['apps/web/src/lib/profile-api.ts'],
        stage: 'task',
        issue: 164,
      },
    },
    issue: { number: 164, title: 'Password form', task: '6.1' },
  });
  assert.match(prompt, /deadbeef/);
  assert.match(prompt, /profile-api\.ts/);
  // Judge it, rather than apply it blind or ignore it.
  assert.match(prompt, /stash show/);
  assert.match(prompt, /belongs to (?:this|the) task/i);
});

test('a session that has already been handed the stash is not told about it again', () => {
  const ms = msWith(['in-progress']);
  const state = {
    phaseIndex: 0,
    stash: {
      sha: 'deadbeef',
      message: 'x',
      files: [],
      handedTo: 'task-6-1-i164',
    },
  };
  const prompt = lib.promptFor('task', {
    config: { baseBranch: 'main', ms: 'docs/demo/demo-MS.json' },
    ms,
    state,
    issue: { number: 164, title: 'Password form', task: '6.1' },
  });
  assert.doesNotMatch(prompt, /deadbeef/);
});

test('a run told to take one milestone stops when that milestone has settled', () => {
  const state = {
    selection: { kind: 'milestone', phase: 6, stopAfterPhase: 6 },
  };
  assert.equal(lib.selectionSatisfied(state, { phase: 6 }), true);
  assert.equal(lib.selectionSatisfied(state, { phase: 5 }), false);
});

test('a run closing out a feature runs on through every phase boundary', () => {
  const state = {
    selection: { kind: 'closeout', phase: null, stopAfterPhase: null },
  };
  assert.equal(lib.selectionSatisfied(state, { phase: 6 }), false);
  assert.equal(lib.selectionSatisfied({}, { phase: 6 }), false);
});
