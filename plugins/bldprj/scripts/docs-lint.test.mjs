/**
 * Tests for docs-lint.mjs, runnable with `node --test` and nothing else.
 * Each case builds a throwaway project under the OS temp dir, runs the linter
 * against it as a child process, and asserts on its output and exit code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LINT = join(dirname(fileURLToPath(import.meta.url)), 'docs-lint.mjs');

/**
 * Writes a throwaway project tree from a path → content map.
 * @param {Record<string, string>} files Relative paths and their contents.
 * @returns {string} Absolute path of the project root created.
 */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-lint-'));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/**
 * Runs the linter over a project tree and tears the tree down.
 * @param {Record<string, string>} files Relative paths and their contents.
 * @returns {{ status: number, stdout: string, stderr: string }} The run's result.
 */
function lint(files) {
  const root = project(files);
  const run = spawnSync(process.execPath, [LINT, root], { encoding: 'utf8' });
  rmSync(root, { recursive: true, force: true });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Builds the smallest feature-track document set that lints clean.
 * @returns {Record<string, string>} Relative paths and their contents.
 */
function cleanFeature() {
  return {
    'docs/INDEX.md': [
      '# Docs index',
      '',
      '| Key | Feature | What it is | Documents |',
      '| --- | ------- | ---------- | --------- |',
      '| DEM | demo | Demo. | [PRD](demo/demo-PRD.md) · [Plan](demo/demo-PLAN.md) · Research — · Threats — · Final — |',
      '',
    ].join('\n'),
    'docs/demo/demo-PRD.md': [
      '# PRD: Demo',
      '',
      '**Key**: DEM',
      '**Date**: 2026-08-07',
      '**Status**: draft',
      '',
      '## 5. Acceptance criteria',
      '',
      '- [ ] **AC-1** Doing X returns Y.',
      '',
      '## Asked & assumed',
      '',
      '- **Assumed** — nothing · nothing.',
      '',
    ].join('\n'),
    'docs/demo/demo-PLAN.md': [
      '# Plan: Demo',
      '',
      '**Key**: DEM',
      '**Date**: 2026-08-07',
      '**Status**: preliminary',
      '',
      '## Phase 1. Tracer',
      '',
      '**Goal**: X works',
      '**Covers**: AC-1',
      '**Tasks**:',
      '',
      '- [ ] **1.1** Do X — X becomes true',
      '',
      '**Done when**: X observed',
      '',
      '## Asked & assumed',
      '',
      '- **Assumed** — nothing · nothing.',
      '',
    ].join('\n'),
  };
}

test('a consistent feature folder lints clean', () => {
  const run = lint(cleanFeature());
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /0 errors, 0 warnings/);
});

test('a versioned plan file is an error — the plan is revised in place', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN-v2.md'] = files['docs/demo/demo-PLAN.md'];
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /plan versions are not part of the contract/);
});

test('an invalid MS file is a finding, not a crash', () => {
  const files = cleanFeature();
  files['docs/demo/demo-MS.json'] = '{ this is not json';
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, /is not valid JSON/);
});

test('a backlog published from a superseded FINAL is stale', () => {
  const files = cleanFeature();
  const finalBody = (extra) =>
    [
      '# Final plan: Demo',
      '',
      '**Key**: DEM',
      '**Date**: 2026-08-07',
      ...extra,
      '',
      '## Phase 1. Tracer',
      '',
      '**Goal**: X works',
      '**Covers**: AC-1',
      '**Tasks**:',
      '',
      '- [ ] **1.1** Do X — X becomes true',
      '',
      '**Done when**: X observed',
      '',
      '## Asked & assumed',
      '',
      '- **Assumed** — nothing · nothing.',
      '',
    ].join('\n');
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '**Status**: preliminary',
    '**Status**: superseded by [demo-FINAL.md](./demo-FINAL.md)',
  );
  files['docs/demo/demo-FINAL.md'] = finalBody([
    '**Status**: superseded by [demo-FINAL-v2.md](./demo-FINAL-v2.md)',
  ]);
  files['docs/demo/demo-FINAL-v2.md'] = finalBody(['**Status**: ready']);
  files['docs/demo/demo-MS.json'] = JSON.stringify({
    sources: {
      plan: 'docs/demo/demo-PLAN.md',
      final: 'docs/demo/demo-FINAL.md',
    },
    phases: [],
  });
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /sources\.final points at demo-FINAL\.md while demo-FINAL-v2\.md is current/,
  );
});

test('refactor acceptance criteria are held to coverage like a feature', () => {
  const run = lint({
    'docs/INDEX.md': [
      '# Docs index',
      '',
      '| Key | Feature | What it is | Documents |',
      '| --- | ------- | ---------- | --------- |',
      '| SPD | speed | Speed. | [PRD](speed/speed-REFACTOR-PRD.md) |',
      '',
    ].join('\n'),
    'docs/speed/speed-REFACTOR-PRD.md': [
      '# Refactor PRD: Speed',
      '',
      '**Key**: SPD',
      '**Date**: 2026-08-07',
      '',
      '## 7. Acceptance criteria',
      '',
      '- [ ] **AC-1** The suite passes unchanged.',
      '- [ ] **AC-2** The endpoint emits 2 queries, down from 1 + N.',
      '',
      '## Asked & assumed',
      '',
      '- **Assumed** — nothing · nothing.',
      '',
    ].join('\n'),
    'docs/speed/speed-REFACTOR-PLAN.md': [
      '# Plan: Speed',
      '',
      '**Key**: SPD',
      '',
      '## Phase R1. Characterization tests',
      '',
      '**Covers**: AC-1',
      '**Tasks**:',
      '',
      '- [ ] **R1.1** Pin behaviour — test passes before code moves',
      '',
      '**Done when**: suite green',
      '',
      '## Asked & assumed',
      '',
      '- **Assumed** — nothing · nothing.',
      '',
    ].join('\n'),
  });
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /AC-2 is in the PRD but in no phase's \*\*Covers\*\*/,
  );
});

test('an MS source escaping the project root is an error', () => {
  const files = cleanFeature();
  files['docs/demo/demo-MS.json'] = JSON.stringify({
    sources: { final: '../../outside-FINAL.md' },
    phases: [],
  });
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /escapes the project root/);
});

test('a duplicated acceptance-criterion number is an error', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PRD.md'] = files['docs/demo/demo-PRD.md'].replace(
    '- [ ] **AC-1** Doing X returns Y.',
    '- [ ] **AC-1** Doing X returns Y.\n- [ ] **AC-1** Doing X returns Z.',
  );
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /AC-1 is defined twice/);
});

test('a cited decision id must exist in the research file', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '**Covers**: AC-1',
    '**Covers**: AC-1\n**Decisions**: D-1',
  );
  const missing = lint(files);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /cites D-1 but there is no research file/);

  files['docs/demo/demo-RESEARCH.md'] = [
    '# Research: Demo',
    '',
    '## 2. Decision map',
    '',
    '| Phase | Tasks | Decisions |',
    '| ----- | ----- | --------- |',
    '| 1     | 1.1   | D-2       |',
    '',
    '### D-2. Which storage?',
    '',
    '## Asked & assumed',
    '',
    '- **Assumed** — nothing · nothing.',
    '',
  ].join('\n');
  const dangling = lint(files);
  assert.equal(dangling.status, 1);
  assert.match(
    dangling.stdout,
    /cites D-1, which demo-RESEARCH\.md does not define/,
  );
});

test('a FINAL with no plan beside it is still checked', () => {
  const files = cleanFeature();
  files['docs/demo/demo-FINAL.md'] = files['docs/demo/demo-PLAN.md']
    .replace('# Plan: Demo', '# Final plan: Demo')
    .replace('**Status**: preliminary', '**Status**: ready')
    .replace('**Covers**: AC-1', '**Covers**: AC-1, AC-9');
  delete files['docs/demo/demo-PLAN.md'];
  files['docs/INDEX.md'] = files['docs/INDEX.md'].replace(
    '[Plan](demo/demo-PLAN.md)',
    '[Final](demo/demo-FINAL.md)',
  );
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /has no plan beside it/);
  assert.match(
    run.stdout,
    /\*\*Covers\*\* names AC-9, which the PRD does not define/,
  );
});
