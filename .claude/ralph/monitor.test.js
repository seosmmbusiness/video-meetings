'use strict';

/**
 * The monitor core's own suite: `node --test .claude/ralph/monitor.test.js`.
 *
 * Everything here is the half of the monitor that decides rather than renders: what a link is doing,
 * how far the run has got, which settings a person may change, and — the part worth a suite of its
 * own — exactly which commands a rollback would run before it runs any of them. A rollback resets
 * branches and reverts merges, so its plan is built as data, asserted here, and only then executed.
 */

const test = require('node:test');
const assert = require('node:assert');

const monitor = require('./monitor');

/** One `assistant` line as the CLI emits it, wrapped the way `--output-format stream-json` does. */
function assistantLine(blocks, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', model: 'claude-opus-5', content: blocks },
    session_id: 's1',
    timestamp: '2026-08-18T18:00:00.000Z',
    ...extra,
  });
}

test('describeToolUse names the file a tool touches, relative to the run root', () => {
  assert.equal(
    monitor.describeToolUse(
      {
        type: 'tool_use',
        name: 'Edit',
        input: { file_path: '/repo/apps/api/src/users/users.service.ts' },
      },
      '/repo',
    ),
    'Edit apps/api/src/users/users.service.ts',
  );
});

test('describeToolUse shows the command a Bash call runs', () => {
  assert.equal(
    monitor.describeToolUse({
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm run test:api -- users.service.spec' },
    }),
    'Bash npm run test:api -- users.service.spec',
  );
});

test('describeToolUse collapses a multi-line command to one line', () => {
  const line = monitor.describeToolUse({
    type: 'tool_use',
    name: 'Bash',
    input: { command: 'git add -A \\\n  && git commit -m "feat: x"' },
  });
  assert.ok(!line.includes('\n'), `still multi-line: ${line}`);
  assert.ok(line.startsWith('Bash git add -A'), line);
});

test('describeToolUse falls back to the tool name when nothing identifies the call', () => {
  assert.equal(
    monitor.describeToolUse({ type: 'tool_use', name: 'TodoWrite', input: {} }),
    'TodoWrite',
  );
});

test('describeToolUse truncates rather than wrapping the panel', () => {
  const line = monitor.describeToolUse({
    type: 'tool_use',
    name: 'Bash',
    input: { command: 'x'.repeat(500) },
  });
  assert.ok(line.length <= 120, `too long: ${line.length}`);
  assert.ok(line.endsWith('…'));
});

test('parseStream reads the session id and model from the init line', () => {
  const parsed = monitor.parseStream(
    [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'abc-123',
        model: 'claude-opus-5',
        cwd: '/repo',
      }),
    ].join('\n'),
  );
  assert.equal(parsed.sessionId, 'abc-123');
  assert.equal(parsed.model, 'claude-opus-5');
  assert.equal(parsed.finished, false);
});

test('parseStream collects tool calls in order, newest last', () => {
  const parsed = monitor.parseStream(
    [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        cwd: '/repo',
      }),
      assistantLine([
        { type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } },
      ]),
      assistantLine([
        { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/b.ts' } },
      ]),
    ].join('\n'),
  );
  assert.deepEqual(
    parsed.activity.map((a) => a.text),
    ['Read a.ts', 'Edit b.ts'],
  );
  assert.equal(parsed.activity.at(-1).kind, 'tool');
});

test('parseStream finds the session id in a tail that lost the init line', () => {
  // A long session's log is read from the end, so the id has to come off whatever line is there.
  const parsed = monitor.parseStream(
    [
      assistantLine([{ type: 'text', text: 'still working' }], {
        session_id: 'sess-A',
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'sess-A',
        total_cost_usd: 0.4,
      }),
    ].join('\n'),
  );
  assert.equal(parsed.sessionId, 'sess-A');
  assert.equal(parsed.finished, true);
});

test('parseStream keeps assistant prose as activity of its own', () => {
  const parsed = monitor.parseStream(
    assistantLine([
      { type: 'text', text: 'Writing the red spec for the name endpoint.' },
    ]),
  );
  assert.deepEqual(parsed.activity, [
    {
      kind: 'text',
      text: 'Writing the red spec for the name endpoint.',
      at: '2026-08-18T18:00:00.000Z',
    },
  ]);
});

test('parseStream ignores thinking blocks, which are not activity', () => {
  const parsed = monitor.parseStream(
    assistantLine([{ type: 'thinking', thinking: 'let me consider…' }]),
  );
  assert.deepEqual(parsed.activity, []);
});

test('parseStream tracks the running thinking-token estimate', () => {
  const parsed = monitor.parseStream(
    [
      JSON.stringify({
        type: 'system',
        subtype: 'thinking_tokens',
        estimated_tokens: 50,
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'thinking_tokens',
        estimated_tokens: 117,
      }),
    ].join('\n'),
  );
  assert.equal(parsed.thinking, 117);
});

test('parseStream counts a turn per assistant message', () => {
  const parsed = monitor.parseStream(
    [
      assistantLine([{ type: 'text', text: 'one' }]),
      assistantLine([{ type: 'text', text: 'two' }]),
    ].join('\n'),
  );
  assert.equal(parsed.turns, 2);
});

test('parseStream reads cost and the closing report off the result line', () => {
  const parsed = monitor.parseStream(
    [
      assistantLine([{ type: 'text', text: 'done' }]),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 1.25,
        num_turns: 42,
        duration_ms: 61_000,
        result: 'Задача #135 выполнена.',
      }),
    ].join('\n'),
  );
  assert.equal(parsed.finished, true);
  assert.equal(parsed.error, false);
  assert.equal(parsed.cost, 1.25);
  assert.equal(parsed.turns, 42);
  assert.equal(parsed.result, 'Задача #135 выполнена.');
});

test('parseStream marks an errored result as an error', () => {
  const parsed = monitor.parseStream(
    JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      total_cost_usd: 0.5,
    }),
  );
  assert.equal(parsed.finished, true);
  assert.equal(parsed.error, true);
});

test('parseStream survives the half-written last line a live tail cuts', () => {
  const parsed = monitor.parseStream(
    [
      assistantLine([{ type: 'text', text: 'kept' }]),
      '{"type":"assistant","message":{"content":[{"type":"te',
    ].join('\n'),
  );
  assert.deepEqual(
    parsed.activity.map((a) => a.text),
    ['kept'],
  );
});

test('parseStream reports the rate-limit window when the stream mentions one', () => {
  const parsed = monitor.parseStream(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: 1787082000,
      },
    }),
  );
  assert.equal(parsed.rateLimit.status, 'allowed');
  assert.equal(parsed.rateLimit.type, 'five_hour');
});

test('parseStream treats a plain-text log as prose, not as a broken stream', () => {
  const parsed = monitor.parseStream('Задача #135 выполнена.\nКоммит ed593f4.');
  assert.equal(parsed.activity.at(-1).text, 'Коммит ed593f4.');
  assert.equal(parsed.activity.at(-1).kind, 'text');
});

test('activityLines returns at most the asked-for number of lines, newest last', () => {
  const parsed = monitor.parseStream(
    [
      assistantLine([{ type: 'text', text: 'one' }]),
      assistantLine([{ type: 'text', text: 'two' }]),
      assistantLine([{ type: 'text', text: 'three' }]),
      assistantLine([{ type: 'text', text: 'four' }]),
    ].join('\n'),
  );
  assert.deepEqual(monitor.activityLines(parsed, 3), ['two', 'three', 'four']);
});

const MS = {
  feature: 'user-profile',
  phases: [
    {
      phase: 1,
      title: 'Account name in the API',
      status: 'in-progress',
      issues: [
        { task: '1.1', number: 134, title: 'cover it' },
        { task: '1.2', number: 135, title: 'store it' },
        { task: '1.3', number: 136, title: 'serve it' },
      ],
    },
    { phase: 2, title: 'Account name in the web app', status: 'pending' },
  ],
};

test('phaseProgress counts phases and the task inside the phase', () => {
  const progress = monitor.phaseProgress(MS, {
    phaseIndex: 0,
    stage: 'task',
    currentIssue: 135,
  });
  assert.equal(progress.phaseNumber, 1);
  assert.equal(progress.phaseTotal, 2);
  assert.equal(progress.title, 'Account name in the API');
  assert.equal(progress.taskNumber, 2);
  assert.equal(progress.taskTotal, 3);
});

test('phaseProgress reports no task while a phase is between tasks', () => {
  const progress = monitor.phaseProgress(MS, {
    phaseIndex: 0,
    stage: 'close',
    currentIssue: null,
  });
  assert.equal(progress.taskNumber, null);
  assert.equal(progress.taskTotal, 3);
});

test('phaseProgress survives a state pointing past the last phase', () => {
  const progress = monitor.phaseProgress(MS, {
    phaseIndex: 2,
    stage: 'done',
    currentIssue: null,
  });
  assert.equal(progress.phaseNumber, null);
  assert.equal(progress.phaseTotal, 2);
});

test('validateSetting accepts the effort levels the CLI accepts', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(monitor.validateSetting('effort', level).ok, true, level);
  }
  assert.equal(monitor.validateSetting('effort', 'turbo').ok, false);
});

test('validateSetting clears an override when given an empty value', () => {
  const verdict = monitor.validateSetting('effort', '');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.value, null);
});

test('validateSetting keeps numeric ceilings numeric and positive', () => {
  assert.deepEqual(monitor.validateSetting('maxTurnsPerTask', '150'), {
    ok: true,
    value: 150,
  });
  assert.equal(monitor.validateSetting('maxTurnsPerTask', '0').ok, false);
  assert.equal(monitor.validateSetting('maxTurnsPerTask', 'many').ok, false);
  assert.equal(
    monitor.validateSetting('maxBudgetUsdPerSession', '7.5').value,
    7.5,
  );
});

test('validateSetting refuses a key that is not an override', () => {
  assert.equal(monitor.validateSetting('mergeStrategy', 'squash').ok, false);
  assert.equal(monitor.validateSetting('workers', '4').ok, false);
});

test('validateSetting refuses the names every object inherits', () => {
  for (const key of [
    'toString',
    'constructor',
    'hasOwnProperty',
    'valueOf',
    '__proto__',
  ]) {
    const verdict = monitor.validateSetting(key, '5');
    assert.equal(verdict.ok, false, `${key} was accepted as a setting`);
  }
});

test('validateSetting takes a model alias or a full model id', () => {
  assert.equal(monitor.validateSetting('model', 'sonnet').value, 'sonnet');
  assert.equal(
    monitor.validateSetting('model', 'claude-opus-5').value,
    'claude-opus-5',
  );
  assert.equal(monitor.validateSetting('model', 'rm -rf /').ok, false);
});

const CHECKPOINTS = [
  {
    at: '2026-08-18T17:52:00.000Z',
    stage: 'task',
    issue: 134,
    sha: 'aaa1111',
    branch: 'feature/user-profile-phase-1',
  },
  {
    at: '2026-08-18T17:58:00.000Z',
    stage: 'task',
    issue: 135,
    sha: 'bbb2222',
    branch: 'feature/user-profile-phase-1',
  },
];

test('planRollback restarts the current link from the checkpoint taken before it', () => {
  const plan = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: {
        checkpoint: { sha: 'bbb2222', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.sha, 'bbb2222');
  assert.ok(
    plan.steps.some((s) => s.argv.join(' ') === 'git reset --hard bbb2222'),
    JSON.stringify(plan.steps),
  );
  assert.ok(plan.backup, 'a rollback keeps a way back');
});

test('planRollback backs the branch up before it resets anything', () => {
  const plan = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: {
        checkpoint: { sha: 'bbb2222', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  const backupAt = plan.steps.findIndex((s) => s.argv.includes('branch'));
  const resetAt = plan.steps.findIndex((s) => s.argv.includes('reset'));
  assert.ok(backupAt >= 0 && backupAt < resetAt, JSON.stringify(plan.steps));
});

test('planRollback undoes the last finished task and hands it back to the chain', () => {
  const plan = monitor.planRollback('back-one-task', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.ok, true);
  assert.equal(
    plan.target.sha,
    'bbb2222',
    'the tree as it was before task 1.2',
  );
  assert.ok(
    plan.steps.some(
      (s) => s.argv.join(' ') === 'gh issue edit 135 --remove-label ralph:done',
    ),
    JSON.stringify(plan.steps),
  );
  assert.equal(plan.nextState.currentIssue, null);
  assert.equal(plan.nextState.stage, 'task');
});

test('planRollback discards a link still in flight along with the task before it', () => {
  const plan = monitor.planRollback('back-one-task', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 136,
      checkpoints: [
        ...CHECKPOINTS,
        {
          at: '2026-08-18T18:04:00.000Z',
          stage: 'task',
          issue: 136,
          sha: 'ccc3333',
          branch: 'feature/user-profile-phase-1',
        },
      ],
      link: {
        stage: 'task',
        issue: 136,
        checkpoint: { sha: 'ccc3333', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.target.sha, 'bbb2222');
  assert.ok(
    plan.steps.some(
      (s) => s.argv.join(' ') === 'gh issue edit 135 --remove-label ralph:done',
    ),
    'the finished task is unlabelled; the one still in flight never had the label',
  );
});

test('planRollback goes back to the first attempt when a task was retried', () => {
  const retried = [
    CHECKPOINTS[0],
    CHECKPOINTS[1],
    {
      at: '2026-08-18T18:06:00.000Z',
      stage: 'task',
      issue: 135,
      sha: 'ddd4444',
      branch: 'feature/user-profile-phase-1',
    },
  ];
  const plan = monitor.planRollback('back-one-task', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: retried,
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(
    plan.target.sha,
    'bbb2222',
    'before the first attempt, not the second',
  );
});

test('planRollback refuses to walk back past the checkpoints it has', () => {
  const plan = monitor.planRollback('back-one-task', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 134,
      checkpoints: [],
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.ok, false);
  assert.match(plan.why, /checkpoint/i);
});

test('planRollback reverts a merged PR on a branch of its own, never on the base', () => {
  const plan = monitor.planRollback('revert-merge', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: null,
      checkpoints: CHECKPOINTS,
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
    merge: { pr: 172, mergeCommit: 'ccc3333', phase: 1 },
  });
  assert.equal(plan.ok, true);
  const argvs = plan.steps.map((s) => s.argv.join(' '));
  assert.ok(
    argvs.some((a) => a.startsWith('git checkout -b revert/')),
    JSON.stringify(argvs),
  );
  assert.ok(argvs.some((a) => a === 'git revert -m 1 --no-edit ccc3333'));
  assert.ok(
    !argvs.some((a) => /push .*\bmain\b/.test(a)),
    'nothing pushes to the base branch',
  );
  assert.ok(argvs.some((a) => a.startsWith('gh pr create')));
});

test('planRollback halts the run after a revert, since a person decides what follows', () => {
  const plan = monitor.planRollback('revert-merge', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: null,
      checkpoints: CHECKPOINTS,
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
    merge: { pr: 172, mergeCommit: 'ccc3333', phase: 1 },
  });
  assert.equal(plan.halts, true);
  assert.equal(plan.resumes, false);
});

test('planRollback refuses a revert with no merge to revert', () => {
  const plan = monitor.planRollback('revert-merge', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: null,
      checkpoints: [],
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
    merge: null,
  });
  assert.equal(plan.ok, false);
});

test('planRollback rejects a mode it does not know', () => {
  const plan = monitor.planRollback('undo-everything', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: null,
      checkpoints: CHECKPOINTS,
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.ok, false);
});

test('planRollback names every mode the UI offers', () => {
  assert.deepEqual(
    monitor.ROLLBACK_MODES.map((m) => m.key),
    ['restart-link', 'back-one-task', 'revert-merge'],
  );
  for (const mode of monitor.ROLLBACK_MODES) {
    assert.equal(typeof mode.title, 'string');
    assert.ok(mode.title.length > 0);
    assert.equal(typeof mode.destructive, 'boolean');
  }
});

test('planRollback keeps untracked files unless it is told to clean', () => {
  const kept = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: {
        checkpoint: { sha: 'bbb2222', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.ok(!kept.steps.some((s) => s.argv.includes('clean')));

  const cleaned = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: {
        checkpoint: { sha: 'bbb2222', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
    clean: true,
  });
  assert.ok(cleaned.steps.some((s) => s.argv.join(' ') === 'git clean -fd'));
});

test('planRollback never lets the backup step fail quietly', () => {
  const ctx = {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: {
        checkpoint: { sha: 'bbb2222', branch: 'feature/user-profile-phase-1' },
      },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  };
  for (const mode of ['restart-link', 'back-one-task']) {
    const plan = monitor.planRollback(mode, ctx);
    const backup = plan.steps.find((s) => s.argv.includes('branch'));
    assert.ok(backup, `${mode} takes no backup`);
    assert.ok(!backup.allowFail, `${mode} would reset even with no way back`);
  }
});

test('waitForLink returns once the link is actually gone', () => {
  const { execFileSync } = require('node:child_process');
  // Spawned through a process that exits at once, so the thing under test is somebody else's child —
  // which is what a link always is, and what keeps it out of this process's zombie table.
  const pid = Number(
    execFileSync(process.execPath, [
      '-e',
      'const { spawn } = require("node:child_process");' +
        'const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"],' +
        ' { detached: true, stdio: "ignore" });' +
        'c.unref(); process.stdout.write(String(c.pid));',
    ]).toString(),
  );
  const state = { link: { pid } };
  assert.equal(monitor.isAlive(pid), true);
  monitor.killLink(state, 'SIGTERM');
  assert.equal(monitor.waitForLink(state, 4000, 2000), true);
  assert.equal(monitor.isAlive(pid), false);
});

test('waitForLink is satisfied immediately when there is no link', () => {
  assert.equal(monitor.waitForLink({ link: null }), true);
  assert.equal(monitor.waitForLink({}), true);
});

test('planRollback takes the done label off the task a restart discards', () => {
  const plan = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'task',
      currentIssue: 135,
      checkpoints: CHECKPOINTS,
      link: { stage: 'task', issue: 135, checkpoint: CHECKPOINTS[1] },
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  const unlabel = plan.steps.find((s) => s.argv.includes('--remove-label'));
  assert.ok(
    unlabel,
    'a restarted task would keep a label for work that is gone',
  );
  assert.equal(
    unlabel.argv.join(' '),
    'gh issue edit 135 --remove-label ralph:done',
  );
  assert.equal(
    unlabel.allowFail,
    true,
    'most restarts happen before any label',
  );
});

test('planRollback does not take a done label off a bookend link', () => {
  const plan = monitor.planRollback('restart-link', {
    state: {
      phaseIndex: 0,
      stage: 'close',
      currentIssue: null,
      checkpoints: [
        {
          at: '2026-08-18T18:10:00.000Z',
          stage: 'close',
          issue: null,
          sha: 'eee5555',
          branch: 'feature/user-profile-phase-1',
        },
      ],
      link: null,
    },
    ms: MS,
    config: { baseBranch: 'main' },
  });
  assert.ok(!plan.steps.some((s) => s.argv.includes('--remove-label')));
});

test('planRollback keeps back-one-task inside the phase it is in', () => {
  // Phase 2 under way, with only phase 1's checkpoints recorded: they name a branch that has already
  // merged, and must not be reachable from here.
  const plan = monitor.planRollback('back-one-task', {
    state: {
      phaseIndex: 1,
      stage: 'task',
      currentIssue: null,
      checkpoints: CHECKPOINTS,
      link: null,
    },
    ms: {
      ...MS,
      phases: [
        { ...MS.phases[0], status: 'completed' },
        { ...MS.phases[1], status: 'in-progress', issues: [] },
      ],
    },
    config: { baseBranch: 'main' },
  });
  assert.equal(plan.ok, false);
  assert.match(plan.why, /checkpoint/i);
});

test('planRollback refuses back-one-task once the phase has left in-progress', () => {
  for (const status of ['in-review', 'completed']) {
    const plan = monitor.planRollback('back-one-task', {
      state: {
        phaseIndex: 0,
        stage: 'settle',
        currentIssue: null,
        checkpoints: CHECKPOINTS,
        link: null,
      },
      ms: { ...MS, phases: [{ ...MS.phases[0], status }, MS.phases[1]] },
      config: { baseBranch: 'main' },
    });
    assert.equal(plan.ok, false, `${status} still offered a reset`);
    assert.match(plan.why, new RegExp(status));
  }
});

test('lastMerge means the phase PR, not the settle PR that followed it', () => {
  const events = [
    { at: '1', type: 'merged', stage: 'merge', phase: 1, pr: 'https://x/172' },
    {
      at: '2',
      type: 'merged',
      stage: 'settle-merge',
      phase: 1,
      pr: 'https://x/173',
    },
  ];
  assert.deepEqual(monitor.lastMerge(events), {
    pr: 'https://x/172',
    phase: 1,
  });
});

test('lastMerge is null when only a settle PR has merged', () => {
  assert.equal(
    monitor.lastMerge([
      {
        at: '1',
        type: 'merged',
        stage: 'settle-merge',
        phase: 1,
        pr: 'https://x/173',
      },
    ]),
    null,
  );
});

test('formatDuration reads as a person would say it', () => {
  assert.equal(monitor.formatDuration(0), '0s');
  assert.equal(monitor.formatDuration(45_000), '45s');
  assert.equal(monitor.formatDuration(125_000), '2m 05s');
  assert.equal(monitor.formatDuration(3_725_000), '1h 02m');
});

test('progressBar fills in proportion and never overflows its width', () => {
  assert.equal(monitor.progressBar(0, 6, 6).replace(/░/g, '.'), '......');
  assert.equal(monitor.progressBar(6, 6, 6).length, 6);
  assert.equal(monitor.progressBar(99, 6, 6).length, 6);
  assert.equal(monitor.progressBar(3, 6, 6).length, 6);
});

test('validateHold accepts each hold the views offer', () => {
  assert.deepEqual(
    monitor.validateHold({ action: 'pause', at: 'phase' }).hold.action,
    'pause',
  );
  assert.equal(
    monitor.validateHold({ action: 'stop', at: 'phase' }).hold.at,
    'phase',
  );
  assert.equal(
    monitor.validateHold({ action: 'stop', at: 'task' }).hold.at,
    'task',
  );
});

test('validateHold clears the hold when it is given no action', () => {
  const cleared = monitor.validateHold({ action: null, at: 'phase' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.hold, null);
});

test('validateHold refuses an action or a boundary the chain has no name for', () => {
  assert.equal(
    monitor.validateHold({ action: 'reboot', at: 'phase' }).ok,
    false,
  );
  assert.equal(
    monitor.validateHold({ action: 'stop', at: 'commit' }).ok,
    false,
  );
  assert.equal(monitor.validateHold({ action: 'stop' }).ok, false);
});

test('a validated hold carries a reason a person reads back in the event log', () => {
  const { hold } = monitor.validateHold({ action: 'stop', at: 'task' });
  assert.match(hold.reason, /stop after this task/);
});
