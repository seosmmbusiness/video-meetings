'use strict';

/**
 * A `PreToolUse` guard on `Bash`, for the commands that must not run however the loop is feeling.
 *
 * The permission `deny` list in `settings.json` is prefix-and-glob matching, so it cannot see a flag
 * that arrives in an unexpected position — `git commit -m x` followed by a verification-skipping flag
 * slips a rule written against `git commit <flag>*`. This guard reads the command line instead.
 *
 * **Patterns are matched unanchored, over the command with its prose arguments removed.** That
 * combination is the whole design, and both halves were learned the hard way:
 *
 * - Matching the raw command line refused an innocent `gh pr create` whose body *described* the
 *   flags the guard watches for. So the values of the prose-carrying options — `-m`, `--message`,
 *   `--body`, `--title`, `--description` — are stripped before matching. Only those: a quoted string
 *   anywhere else may well be a command (`bash -c "…"`), and stays inspected.
 * - Anchoring to a command position was tried instead and was far worse: a leading space, a subshell,
 *   `if …; then …`, a brace group or a line continuation each walked straight past it. Nine bypasses
 *   out of nine attempts. Unanchored matching has no such holes, and the strip list is what keeps it
 *   from crying wolf.
 *
 * A rule marked `loopOnly` is refused only inside a Ralph link, which the loop stamps with
 * `RALPH_LINK`. Merging a PR is something a person does deliberately and an unattended chain must not
 * do on its own initiative; refusing it everywhere only teaches people to route around the guard.
 * Everything else is destructive whoever asks, and is refused for both.
 */

const fs = require('node:fs');

/** True when this session is a link of a Ralph run rather than a person's own. */
const IN_LOOP = Boolean(process.env.RALPH_LINK);

/**
 * Options whose value is prose a person wrote, not a command to be run. Their values are removed
 * before matching so that describing a dangerous command never counts as running one.
 */
const PROSE_OPTIONS =
  /(?:^|\s)(?:-m|--message|--body|--title|--description|--reason)[=\s]+/;

/** Commands that are refused. `loopOnly` narrows a rule to unattended runs. */
const RULES = [
  {
    pattern: /\bgit\s+(?:commit|push)\b[\s\S]*?(?:--no-verify|\s-n(?=\s|$))/,
    reason: 'the pre-commit and pre-push gates stay in the loop',
  },
  {
    pattern:
      /\bgit\s+push\b[\s\S]*?(?:--force\b|--force-with-lease\b|\s-f(?=\s|$))/,
    reason: 'a force push can destroy commits nothing else holds',
  },
  {
    pattern: /\bgit\s+push\b[^\n;&|]*\b(?:main|develop)\b/,
    reason: 'the base branch takes commits only through a merged PR',
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    reason: 'a hard reset discards work that was never committed',
  },
  {
    pattern: /\bgit\s+clean\b[^\n;&|]*-[a-z]*[fdx]/,
    reason: 'git clean deletes untracked files irrecoverably',
  },
  {
    pattern: /\bgit\s+(?:branch\s+-D|push\b[^\n;&|]*--delete)\b/,
    reason: 'deleting a branch can drop the only copy of a phase',
  },
  {
    pattern: /\bgit\s+rebase\b/,
    reason: 'a rebase rewrites the history the phase evidence lives in',
    loopOnly: true,
  },
  {
    pattern: /\bgh\s+pr\s+merge\b/,
    reason:
      'the loop merges through verify.js, once it has re-run the checks itself',
    loopOnly: true,
  },
  {
    pattern: /\bgh\s+api\b[^\n;&|]*(?:pulls\/\d+\/merge|\/merge\b)/,
    reason: 'merging through the API is still merging',
    loopOnly: true,
  },
  {
    pattern: /\bgh\s+(?:repo|release)\s+delete\b/,
    reason: 'destructive GitHub operation',
  },
  {
    pattern: /\bgh\s+api\b[^\n;&|]*-X\s*DELETE\b/,
    reason: 'destructive GitHub API call',
  },
  {
    pattern: /\bprisma\s+migrate\s+reset\b/,
    reason: 'a migrate reset drops the development database',
  },
  {
    // Only an explicit relative subpath is left alone: an absolute path, `~`, `.`, or anything
    // reaching upwards can be the repository itself or the machine around it.
    pattern:
      /\brm\s+(?:-[a-zA-Z]*\s+)*-?[a-zA-Z]*r[a-zA-Z]*\s+(?:-\S+\s+)*(?:[/~]|\.\.|\.\s|\.$|\$)/,
    reason: 'recursive delete of an absolute, home-relative or upward path',
  },
  {
    pattern: /(?:^|[\s;&|(])sudo\s/,
    reason: 'the loop does not escalate privileges',
  },
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

/**
 * Removes the values of the prose-carrying options, leaving everything else to be inspected.
 *
 * Handles the three ways a value arrives — single-quoted, double-quoted, or bare — and repeats until
 * no prose option is left, so a command carrying several of them is fully stripped.
 *
 * @param {string} command The raw command line.
 * @returns {string} The command with prose values replaced by a placeholder.
 */
function stripProse(command) {
  let out = command;
  for (let i = 0; i < 20; i += 1) {
    const at = out.search(PROSE_OPTIONS);
    if (at === -1) break;
    const match = out.slice(at).match(PROSE_OPTIONS)[0];
    const valueAt = at + match.length;
    const quote = out[valueAt];
    let end;
    if (quote === '"' || quote === "'") {
      end = out.indexOf(quote, valueAt + 1);
      end = end === -1 ? out.length : end + 1;
    } else {
      const rest = out.slice(valueAt).search(/\s/);
      end = rest === -1 ? out.length : valueAt + rest;
    }
    out = `${out.slice(0, at)}${match}<prose>${out.slice(end)}`;
  }
  return out;
}

const input = readInput();
const raw = ((input.tool_input && input.tool_input.command) || '').toString();
const command = stripProse(raw);

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
