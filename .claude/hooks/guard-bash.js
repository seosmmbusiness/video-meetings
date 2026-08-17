'use strict';

/**
 * A `PreToolUse` guard on `Bash`, for the commands that must not run however the loop is feeling.
 *
 * The permission `deny` list in `settings.json` is prefix-and-glob matching, so it cannot see a flag
 * that arrives in an unexpected position — `git commit -m x --no-verify` slips a
 * `Bash(git commit --no-verify*)` rule. This guard reads the whole command line instead, which is
 * the only way to catch them reliably. It runs for every session, Ralph's or a person's.
 *
 * Each rule exists because an unattended loop would otherwise be able to destroy work that is not
 * yet pushed anywhere, or to land code past the gates the repo put in its own way.
 */

const fs = require('node:fs');

/** Command patterns that are refused, with the reason the caller is told. */
const RULES = [
  [
    /--no-verify|(^|\s)-n(\s|$)(?=.*\bcommit\b)/,
    'the pre-commit and pre-push gates stay in the loop',
  ],
  [
    /\bgit\s+push\b.*(--force|-f(\s|$))/,
    'a force push can destroy commits nothing else holds',
  ],
  [
    /\bgit\s+push\b.*\b(main|develop)\b/,
    'the base branch takes commits only through a merged PR',
  ],
  [
    /\bgit\s+reset\s+--hard\b/,
    'a hard reset discards work that was never committed',
  ],
  [
    /\bgit\s+clean\b.*-[a-z]*[fdx]/,
    'git clean deletes untracked files irrecoverably',
  ],
  [
    /\bgit\s+rebase\b/,
    'a rebase rewrites the history the phase evidence lives in',
  ],
  [
    /\bgh\s+pr\s+merge\b/,
    'the loop merges, after re-running the checks itself',
  ],
  [/\bgh\s+(repo|release)\s+delete\b/, 'destructive GitHub operation'],
  [
    /\bgh\s+api\b.*-X\s*(DELETE|PATCH\s+.*state=closed.*milestones)/,
    'destructive GitHub API call',
  ],
  [
    /\bprisma\s+migrate\s+reset\b/,
    'a migrate reset drops the development database',
  ],
  [
    /\brm\s+-[a-z]*r[a-z]*f?\s+\/(?!run\/media)/,
    'recursive delete outside the project',
  ],
  [/^\s*sudo\b/, 'the loop does not escalate privileges'],
];

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
const command = (
  (input.tool_input && input.tool_input.command) ||
  ''
).toString();

for (const [pattern, reason] of RULES) {
  if (pattern.test(command)) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Blocked by .claude/hooks/guard-bash.js: ${reason}.`,
        },
      })}\n`,
    );
    process.exit(0);
  }
}

process.exit(0);
