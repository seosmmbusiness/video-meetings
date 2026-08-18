'use strict';

/**
 * Asks the chain for its next link, as a step of its own.
 *
 * The monitor uses this rather than calling `advance()` in-process: deciding costs a couple of
 * GitHub round trips, and a view that blocked on them would stop redrawing exactly when a person is
 * watching to see whether their button did anything.
 *
 * Usage: node .claude/ralph/advance.js [--session <id>]
 *
 * `--session` names the link this decision is standing in for — a session that ended while the chain
 * was paused, whose own hook was refused at the time. Passing it makes the decision idempotent with
 * that session's late `Stop`/`SessionEnd` hook, which finds the marker already written and declines.
 */

const lib = require('./lib');

const argv = process.argv.slice(2);
const at = argv.indexOf('--session');
const sessionId = at === -1 ? undefined : argv[at + 1];

try {
  lib.advance(sessionId ? { session_id: sessionId } : {});
} catch (err) {
  process.stdout.write(`Ralph advance step error: ${err.message}\n`);
  process.exitCode = 1;
}
