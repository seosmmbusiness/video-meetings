'use strict';

/**
 * The Ralph loop's driver, registered on both `Stop` and `SessionEnd`.
 *
 * It reads the hook's stdin, hands the decision to `advance()`, and exits — it never waits on the
 * session it spawns. That matters twice over: a hook that blocked would be killed at its timeout
 * long before a 200-turn session finished, and a hook that spawned its successor *inside* itself
 * would nest the whole chain instead of advancing it. `SessionEnd` is the backstop for a session
 * that dies on its turn ceiling without `Stop` firing; the per-session marker `advance()` writes
 * makes the pair idempotent, so the two events cannot spawn two successors.
 */

const fs = require('node:fs');

/**
 * Reads and parses the hook's stdin payload.
 *
 * @returns {object} The hook input, or an empty object when stdin is absent or unparseable.
 */
function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const input = readInput();

try {
  const lib = require('../ralph/lib');
  lib.advance(input);
} catch (err) {
  // A driver that throws must not take the session's exit with it: log and let the run be resumed
  // by hand with `node .claude/ralph-start.js --resume`.
  process.stdout.write(`Ralph driver error: ${err.message}\n`);
}

process.exit(0);
