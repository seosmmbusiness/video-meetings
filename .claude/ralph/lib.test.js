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
