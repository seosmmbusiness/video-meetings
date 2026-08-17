'use strict';

/**
 * A `PreToolUse` guard on `Bash`, for the commands that must not run however the loop is feeling.
 *
 * The permission `deny` list in `settings.json` is prefix-and-glob matching, so it cannot see a flag
 * that arrives in an unexpected position — `git commit -m x` with a verification-skipping flag after
 * it slips a rule written against `git commit <flag>*`. This guard reads the command line instead.
 *
 * Two things keep it from crying wolf, both learned by having it block legitimate work:
 *
 * - **Every pattern is anchored to a command position** — the start of the line, or just after `;`,
 *   `&&`, `||` or a pipe. Without that anchor the guard matched its own trigger words inside a PR
 *   body being passed as an argument, and refused an innocent `gh pr create`. Pass long prose with
 *   `--body-file` rather than inline, and this cannot bite at all.
 * - **A rule marked `loopOnly` applies only inside a Ralph link**, which the loop stamps with
 *   `RALPH_LINK`. Merging a PR is a thing a person does deliberately and an unattended chain must
 *   not do on its own initiative; refusing it everywhere only teaches the guard to be routed around.
 *   Everything else is destructive whoever asks, and is refused for both.
 */

const fs = require('node:fs');

/** True when this session is a link of a Ralph run rather than a person's own. */
const IN_LOOP = Boolean(process.env.RALPH_LINK);

/** Matches the start of a command: line start, or just after a shell operator. */
const AT_COMMAND = String.raw`(?:^|[\n;&|]\s*)`;

/** One segment of a command, up to the next operator — so a match cannot span two commands. */
const SEGMENT = String.raw`[^\n;&|]*`;

/**
 * Builds a rule anchored to a command position.
 *
 * @param {string} body The pattern source, matched immediately after the command anchor.
 * @param {string} reason Why the command is refused, shown to the caller.
 * @param {boolean} [loopOnly] True to refuse it only inside a Ralph link.
 * @returns {{ pattern: RegExp, reason: string, loopOnly: boolean }} The rule.
 */
function rule(body, reason, loopOnly = false) {
  return { pattern: new RegExp(AT_COMMAND + body), reason, loopOnly };
}

/** Commands that are refused, in the order they are tried. */
const RULES = [
  rule(
    String.raw`git\s+(?:commit|push)\b${SEGMENT}(?:--no-verify|\s-n(?=\s|$))`,
    'the pre-commit and pre-push gates stay in the loop',
  ),
  rule(
    String.raw`git\s+push\b${SEGMENT}(?:--force|\s-f(?=\s|$))`,
    'a force push can destroy commits nothing else holds',
  ),
  rule(
    String.raw`git\s+push\b${SEGMENT}\b(?:main|develop)\b`,
    'the base branch takes commits only through a merged PR',
  ),
  rule(
    String.raw`git\s+reset\s+--hard\b`,
    'a hard reset discards work that was never committed',
  ),
  rule(
    String.raw`git\s+clean\b${SEGMENT}-[a-z]*[fdx]`,
    'git clean deletes untracked files irrecoverably',
  ),
  rule(
    String.raw`git\s+rebase\b`,
    'a rebase rewrites the history the phase evidence lives in',
    true,
  ),
  rule(
    String.raw`gh\s+pr\s+merge\b`,
    'the loop merges through verify.js, once it has re-run the checks itself',
    true,
  ),
  rule(
    String.raw`gh\s+(?:repo|release)\s+delete\b`,
    'destructive GitHub operation',
  ),
  rule(
    String.raw`gh\s+api\b${SEGMENT}-X\s*DELETE\b`,
    'destructive GitHub API call',
  ),
  rule(
    String.raw`gh\s+api\b${SEGMENT}(?:pulls/\d+/merge|/merge\b)`,
    'merging through the API is still merging',
    true,
  ),
  rule(
    String.raw`(?:npx\s+)?prisma\s+migrate\s+reset\b`,
    'a migrate reset drops the development database',
  ),
  rule(
    String.raw`rm\s+-[a-z]*r[a-z]*f?\s+/(?!run/media)`,
    'recursive delete outside the project',
  ),
  rule(String.raw`sudo\b`, 'the loop does not escalate privileges'),
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

for (const { pattern, reason, loopOnly } of RULES) {
  if (loopOnly && !IN_LOOP) continue;
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
