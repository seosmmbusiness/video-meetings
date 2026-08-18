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
