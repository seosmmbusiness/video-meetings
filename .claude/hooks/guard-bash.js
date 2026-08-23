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
const { execFileSync } = require('node:child_process');

/** True when this session is a link of a Ralph run rather than a person's own. */
const IN_LOOP = Boolean(process.env.RALPH_LINK);

/**
 * Options whose value is prose a person wrote, not a command to be run. Their values are removed
 * before matching so that describing a dangerous command never counts as running one.
 */
const PROSE_OPTIONS =
  /(?:^|\s)(?:-m|--message|--body|--title|--description|--reason)[=\s]+/;

/**
 * Branch names the pipeline itself creates, and close-out step 7 is expected to retire once they
 * have landed. Anything else — a person's branch, a base branch, a ref path — is not covered.
 */
const PIPELINE_BRANCH =
  /^(?:feature|refactor)\/[A-Za-z0-9._-]+-phase-\d+$|^chore\/[A-Za-z0-9._-]+-phase-\d+-done$|^chore\/[A-Za-z0-9._-]+-closeout$/;

/**
 * Whether a ref has already landed on the base branch.
 *
 * @param {string} ref The ref to test, e.g. `refs/remotes/origin/feature/x-phase-1`.
 * @param {string} base The base ref it should be contained in.
 * @returns {boolean} True when `ref` is an ancestor of `base`.
 */
function landed(ref, base) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, base], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a ref exists at all.
 *
 * @param {string} ref The ref to look for.
 * @returns {boolean} True when git resolves it.
 */
function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this command is close-out step 7: retiring pipeline branches that have already merged.
 *
 * The blanket refusal on deleting branches exists because an unmerged branch can be the only copy
 * of a phase — but it also stopped `close-feature` from finishing its own cleanup, which left every
 * phase branch of a shipped feature sitting on the remote and put two lines in the report that a
 * person then had to action by hand. Both halves are kept here: only the pipeline's own branch
 * names, and only once the base branch already contains them.
 *
 * @param {string} command The command line, prose already stripped.
 * @returns {boolean} True when every branch named is the pipeline's and has landed.
 */
function retiresLandedBranches(command) {
  const push = command.match(/\bgit\s+push\b([^\n;&|]*)/);
  if (!push) return false;
  const words = push[1].trim().split(/\s+/).filter(Boolean);
  if (!words.includes('--delete') && !words.includes('-d')) return false;
  const plain = words.filter((word) => !word.startsWith('-'));
  const [remote, ...branches] = plain;
  if (!remote || !/^[A-Za-z0-9._-]+$/.test(remote) || !branches.length)
    return false;

  // Git flow's base where the project uses it, `main` otherwise — the same order close-feature reads.
  const develop = `refs/remotes/${remote}/develop`;
  const base = refExists(develop) ? develop : `refs/remotes/${remote}/main`;
  return branches.every(
    (branch) =>
      PIPELINE_BRANCH.test(branch) &&
      landed(`refs/remotes/${remote}/${branch}`, base),
  );
}

/** Commands that are refused. `loopOnly` narrows a rule to unattended runs, `exempt` lets one
 * specific, checkable case through. */
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
    exempt: retiresLandedBranches,
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

for (const { pattern, reason, loopOnly, exempt } of RULES) {
  if (loopOnly && !IN_LOOP) continue;
  if (pattern.test(command)) {
    if (exempt && exempt(command)) continue;
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
