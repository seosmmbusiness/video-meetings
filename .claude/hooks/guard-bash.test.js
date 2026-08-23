'use strict';

/**
 * The bash guard's own suite: `node --test .claude/hooks/guard-bash.test.js`.
 *
 * It exists because the guard has been wrong in both directions within an hour of being written —
 * once refusing a legitimate `gh pr create` whose body merely described the flags it watches for,
 * once letting nine bypasses through after that was "fixed" by anchoring patterns to a command
 * position. Both classes are cases below, so neither can come back unnoticed.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const GUARD = path.join(__dirname, 'guard-bash.js');

/** Built rather than written out, so the guard cannot match this file's own source. */
const SKIP = ['--no', 'verify'].join('-');

/**
 * Asks the guard what it makes of one command.
 *
 * @param {string} command The bash command line.
 * @param {boolean} inLoop Whether to present the call as a Ralph link.
 * @param {string} [cwd] Where to run it, for the rules that ask git about a branch.
 * @returns {string} `'deny'` or `'allow'`.
 * @throws {Error} When the guard cannot be run or prints something unparseable.
 */
function verdict(command, inLoop, cwd) {
  const env = { ...process.env };
  if (inLoop) env.RALPH_LINK = '9999';
  else delete env.RALPH_LINK;
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env,
    cwd: cwd || process.cwd(),
  });
  return out.trim()
    ? JSON.parse(out).hookSpecificOutput.permissionDecision
    : 'allow';
}

/** Destructive whoever asks — refused in both contexts. */
const ALWAYS_DENY = [
  `git commit -m "x" ${SKIP}`,
  `git push origin feature/x ${SKIP}`,
  'git push --force origin feature/x',
  'git push --force-with-lease',
  'git push -f',
  'git push origin main',
  'git reset --hard HEAD~3',
  'git clean -fdx',
  'git branch -D chore/ralph-loop',
  'gh repo delete seosmmbusiness/video-meetings',
  'gh api repos/o/r/issues/1 -X DELETE',
  'npx prisma migrate reset --force',
  'sudo rm /etc/hosts',
  'npm run lint && git reset --hard origin/main',
  'rm -rf /run/media/johnny/SomeData/Education/video-meetings',
  'rm -rf ~/projects',
  'rm -rf ..',
];

/** The bypasses that walked past an anchored version of this guard. */
const BYPASSES = [
  '  git reset --hard HEAD~1',
  '\tgit clean -fdx',
  'if true; then git reset --hard; fi',
  '(git reset --hard HEAD~1)',
  '{ git clean -fdx; }',
  'bash -c "git reset --hard HEAD~1"',
  'echo $(git reset --hard HEAD~1)',
  'git push \\\n  --force origin x',
];

/** Deliberate for a person, forbidden for an unattended chain. */
const LOOP_ONLY = [
  'gh pr merge 42 --merge',
  'git rebase -i main',
  'gh api repos/o/r/pulls/42/merge -X PUT',
];

/** Ordinary work the guard must never touch. */
const ALWAYS_ALLOW = [
  'git commit -m "feat(api): add the profile module"',
  'git push -u origin feature/user-profile-phase-1',
  'git status --porcelain',
  'git branch -d feature/user-profile-phase-1',
  'npm run test:e2e:api',
  'npm run db:up',
  'gh pr create --base main --title "UP 1. Account name in the API"',
  'gh issue edit 134 --add-label ralph:done',
  'npx prisma migrate dev --name add_user_profile',
  'node plugins/bldprj/scripts/docs-lint.mjs .',
  'rm -rf node_modules/.cache',
];

/** Prose arguments that name a dangerous command without being one. */
const PROSE_NOT_COMMANDS = [
  `gh pr create --title x --body "glob rules cannot see ${SKIP} in a trailing position"`,
  'gh pr comment 1 --body "do not use git reset --hard here"',
  `git commit -m "docs: explain why ${SKIP} is refused"`,
  "gh issue comment 5 --body 'ralph tried git push --force and was refused'",
];

test('refuses destructive commands in both contexts', () => {
  for (const command of ALWAYS_DENY) {
    assert.strictEqual(verdict(command, true), 'deny', command);
    assert.strictEqual(verdict(command, false), 'deny', command);
  }
});

test('refuses them however the command is dressed up', () => {
  for (const command of BYPASSES) {
    assert.strictEqual(verdict(command, true), 'deny', command);
    assert.strictEqual(verdict(command, false), 'deny', command);
  }
});

test('refuses merge and rebase to a link, allows them to a person', () => {
  for (const command of LOOP_ONLY) {
    assert.strictEqual(verdict(command, true), 'deny', command);
    assert.strictEqual(verdict(command, false), 'allow', command);
  }
});

test('leaves ordinary work alone', () => {
  for (const command of ALWAYS_ALLOW) {
    assert.strictEqual(verdict(command, true), 'allow', command);
    assert.strictEqual(verdict(command, false), 'allow', command);
  }
});

test('reads prose arguments as prose, not as commands', () => {
  for (const command of PROSE_NOT_COMMANDS) {
    assert.strictEqual(verdict(command, true), 'allow', command);
    assert.strictEqual(verdict(command, false), 'allow', command);
  }
});

test('says why it refused', () => {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_input: { command: 'git reset --hard' } }),
    encoding: 'utf8',
  });
  const decision = JSON.parse(out).hookSpecificOutput;
  assert.strictEqual(decision.hookEventName, 'PreToolUse');
  assert.match(decision.permissionDecisionReason, /guard-bash\.js/);
});

/** Built rather than written out, so the guard cannot match this file's own source. */
const PUSH_DELETE = ['git', 'push', 'origin', '--delete'].join(' ');
const FORCE_DELETE = ['git', 'branch', '-D'].join(' ');

/**
 * A throwaway repository with remote refs standing in for a pipeline's branches.
 *
 * No real remote is needed: what the guard asks is whether `origin/<branch>` is an ancestor of the
 * base, and a ref written by hand answers that exactly as a fetched one would.
 *
 * @returns {string} The repository's path.
 */
function repoWithBranches() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-guard-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  git('init', '--initial-branch', 'main');
  git('config', 'user.email', 'suite@example.test');
  git('config', 'user.name', 'Suite');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-m', 'first');
  const base = git('rev-parse', 'HEAD').trim();
  git('update-ref', 'refs/remotes/origin/main', base);
  git('update-ref', 'refs/remotes/origin/feature/demo-phase-1', base);
  git('update-ref', 'refs/remotes/origin/chore/demo-phase-1-done', base);
  git('checkout', '-q', '-b', 'unmerged');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git('add', '-A');
  git('commit', '-m', 'second');
  git(
    'update-ref',
    'refs/remotes/origin/feature/demo-phase-9',
    git('rev-parse', 'HEAD').trim(),
  );
  git('checkout', '-q', 'main');
  return dir;
}

test('a link may retire a merged phase branch on origin, which is close-out step 7', () => {
  const cwd = repoWithBranches();
  assert.strictEqual(
    verdict(`${PUSH_DELETE} feature/demo-phase-1`, true, cwd),
    'allow',
  );
  assert.strictEqual(
    verdict(`${PUSH_DELETE} chore/demo-phase-1-done`, true, cwd),
    'allow',
  );
  assert.strictEqual(
    verdict(
      `${PUSH_DELETE} feature/demo-phase-1 chore/demo-phase-1-done`,
      true,
      cwd,
    ),
    'allow',
  );
});

test('a branch that never landed is not the pipeline\u2019s to retire', () => {
  const cwd = repoWithBranches();
  // Unmerged: it may be the only copy of a phase.
  assert.strictEqual(
    verdict(`${PUSH_DELETE} feature/demo-phase-9`, true, cwd),
    'deny',
  );
  // Not a pipeline branch at all, however merged it is.
  assert.strictEqual(verdict(`${PUSH_DELETE} main`, true, cwd), 'deny');
  assert.strictEqual(
    verdict(`${PUSH_DELETE} refs/heads/feature/demo-phase-1`, true, cwd),
    'deny',
  );
  // One good name does not carry a bad one along with it.
  assert.strictEqual(
    verdict(
      `${PUSH_DELETE} feature/demo-phase-1 feature/demo-phase-9`,
      true,
      cwd,
    ),
    'deny',
  );
});

test('the force-delete of a local branch stays refused whatever it is called', () => {
  const cwd = repoWithBranches();
  assert.strictEqual(
    verdict(`${FORCE_DELETE} feature/demo-phase-1`, true, cwd),
    'deny',
  );
});
