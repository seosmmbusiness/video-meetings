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
      '**Verified by**: e2e spec over the scenario, per CLAUDE.md',
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

test('a phase that names no workflow is a warning', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '**Verified by**: e2e spec over the scenario, per CLAUDE.md\n',
    '',
  );
  const run = lint(files);
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /phase 1 has no \*\*Verified by\*\*/);
});

test('archived work is not held to a field the contract gained later', () => {
  const run = lint({
    'docs/INDEX.md': [
      '# Docs index',
      '',
      '| Key | Feature | What it is | Documents |',
      '| --- | ------- | ---------- | --------- |',
      '| OLD | old | Shipped. | [PRD](archive/old/old-PRD.md) · [Plan](archive/old/old-PLAN.md) |',
      '',
    ].join('\n'),
    'docs/archive/old/old-PRD.md': [
      '# PRD: Old',
      '',
      '**Key**: OLD',
      '**Date**: 2026-08-07',
      '**Status**: done',
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
    'docs/archive/old/old-PLAN.md': [
      '# Plan: Old',
      '',
      '**Key**: OLD',
      '**Date**: 2026-08-07',
      '**Status**: shipped',
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
  });
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /0 errors, 0 warnings/);
});

test('a tests: task is exempt from the phase ceiling, wrapped marker included', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '- [ ] **1.1** Do X — X becomes true',
    [
      '- [ ] **1.1** Cover X through Z with failing specs —',
      '      tests: the e2e cases for AC-1, red before 1.2 starts',
      '- [ ] **1.2** Do X — X becomes true',
      '- [ ] **1.3** Do Y — Y becomes true',
      '- [ ] **1.4** Do Z — Z becomes true',
      '- [ ] **1.5** Do V — V becomes true',
      '- [ ] **1.6** Do W — W becomes true',
    ].join('\n'),
  );
  const run = lint(files);
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /0 errors, 0 warnings/);
});

test('a sixth building task is over the phase ceiling', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '- [ ] **1.1** Do X — X becomes true',
    [
      '- [ ] **1.1** Do X — X becomes true',
      '- [ ] **1.2** Do Y — Y becomes true',
      '- [ ] **1.3** Do Z — Z becomes true',
      '- [ ] **1.4** Do V — V becomes true',
      '- [ ] **1.5** Do W — W becomes true',
      '- [ ] **1.6** Do U — U becomes true',
    ].join('\n'),
  );
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /carries 6 live building tasks, over the 5/);
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
      '**Verified by**: e2e spec over the scenario, per CLAUDE.md',
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
      '**Verified by**: green baseline → change → green, no existing test edited',
      '**Tasks**:',
      '',
      '- [ ] **R1.1** Pin behaviour — tests: passes before code moves',
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

/**
 * Builds a feature whose FINAL cites the research and threats beside it.
 * @param {{ decisions?: string, threats?: string, research?: string[], findings?: string[] }} parts
 *   Overrides for the FINAL's citation lines and the two source documents' blocks.
 * @returns {Record<string, string>} Relative paths and their contents.
 */
function consolidatedFeature(parts = {}) {
  const files = cleanFeature();
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '**Status**: preliminary',
    '**Status**: superseded by [demo-FINAL.md](./demo-FINAL.md)',
  );
  files['docs/demo/demo-FINAL.md'] = [
    '# Final plan: Demo',
    '',
    '**Key**: DEM',
    '**Date**: 2026-08-07',
    '**Status**: ready',
    '',
    '## Phase 1. Tracer',
    '',
    '**Goal**: X works',
    '**Covers**: AC-1',
    parts.decisions ?? '**Decisions**: D-1',
    parts.threats ?? '**Threats**: S-1',
    '**Verified by**: e2e spec over the scenario, per CLAUDE.md',
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
  files['docs/demo/demo-RESEARCH.md'] = [
    '# Research: Demo',
    '',
    '## 2. Decision map',
    '',
    '| Phase | Tasks | Decisions |',
    '| ----- | ----- | --------- |',
    '| 1     | 1.1   | D-1       |',
    '',
    ...(parts.research ?? ['### D-1. Which storage?', '']),
    '## Asked & assumed',
    '',
    '- **Assumed** — nothing · nothing.',
    '',
  ].join('\n');
  files['docs/demo/demo-THREATS.md'] = [
    '# Threats: Demo',
    '',
    '## 2. Threat map',
    '',
    '| Phase | Tasks | Findings |',
    '| ----- | ----- | -------- |',
    '| 1     | 1.1   | S-1      |',
    '',
    ...(parts.findings ?? ['### S-1. Stranger reads a row.', '']),
    '## Asked & assumed',
    '',
    '- **Assumed** — nothing · nothing.',
    '',
  ].join('\n');
  files['docs/INDEX.md'] = files['docs/INDEX.md'].replace(
    'Research — · Threats — · Final —',
    [
      '[Research](demo/demo-RESEARCH.md)',
      '[Threats](demo/demo-THREATS.md)',
      '[Final](demo/demo-FINAL.md)',
    ].join(' · '),
  );
  return files;
}

test('a consolidated feature citing live ids both ways lints clean', () => {
  const run = lint(consolidatedFeature());
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /0 errors, 0 warnings/);
});

test('a decision no phase cites is a warning once a FINAL exists', () => {
  const run = lint(
    consolidatedFeature({
      research: [
        '### D-1. Which storage?',
        '',
        '### D-2. Which validator?',
        '',
      ],
    }),
  );
  assert.equal(run.status, 0, run.stdout);
  assert.match(
    run.stdout,
    /defines D-2, which demo-FINAL\.md cites nowhere — implementation will not see it/,
  );
});

test('a preliminary plan is not held to citing every decision', () => {
  const files = cleanFeature();
  files['docs/demo/demo-RESEARCH.md'] = [
    '# Research: Demo',
    '',
    '## 2. Decision map',
    '',
    '| Phase | Tasks | Decisions |',
    '| ----- | ----- | --------- |',
    '| 1     | 1.1   | D-1       |',
    '',
    '### D-1. Which storage?',
    '',
    '## Asked & assumed',
    '',
    '- **Assumed** — nothing · nothing.',
    '',
  ].join('\n');
  files['docs/INDEX.md'] = files['docs/INDEX.md'].replace(
    'Research —',
    '[Research](demo/demo-RESEARCH.md)',
  );
  const run = lint(files);
  assert.equal(run.status, 0, run.stdout);
  assert.doesNotMatch(run.stdout, /cites nowhere/);
});

test('a phase citing a superseded decision is an error', () => {
  const run = lint(
    consolidatedFeature({
      research: [
        '### D-1. Which storage?',
        '',
        '- **Superseded by**: D-2 — cannot scope by owner, round 2',
        '',
        '### D-2. Which storage, after S-1?',
        '',
      ],
      decisions: '**Decisions**: D-1, D-2',
    }),
  );
  assert.equal(run.status, 1);
  assert.match(
    run.stdout,
    /cites D-1, which a revision round superseded — cite its replacement/,
  );
});

test('a superseded decision named only in ## Revisions is not a citation', () => {
  const files = consolidatedFeature({
    research: [
      '### D-1. Which storage?',
      '',
      '- **Superseded by**: D-2 — cannot scope by owner, round 2',
      '',
      '### D-2. Which storage, after S-1?',
      '',
    ],
    decisions: '**Decisions**: D-2',
  });
  files['docs/demo/demo-FINAL.md'] = files['docs/demo/demo-FINAL.md'].concat(
    [
      '## Revisions',
      '',
      '- 2026-08-07 — round 2: D-1 superseded by D-2 — S-1.',
      '',
    ].join('\n'),
  );
  const run = lint(files);
  assert.equal(run.status, 0, run.stdout);
  assert.doesNotMatch(run.stdout, /superseded — cite its replacement/);
  assert.doesNotMatch(run.stdout, /cites nowhere/);
});

test('a relative link with no leading dot is still resolved', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PRD.md'] = files['docs/demo/demo-PRD.md'].replace(
    '## Asked & assumed',
    '[the plan](demo-PLAN.md) and [a ghost](demo-GHOST.md)\n\n## Asked & assumed',
  );
  const run = lint(files);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /link to demo-GHOST\.md does not resolve/);
  assert.doesNotMatch(run.stdout, /link to demo-PLAN\.md/);
});

test('an external or root-relative link is left alone', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PRD.md'] = files['docs/demo/demo-PRD.md'].replace(
    '## Asked & assumed',
    '[docs](https://example.com/x) [mail](mailto:a@b.c) [root](/nope.md)\n\n## Asked & assumed',
  );
  const run = lint(files);
  assert.equal(run.status, 0, run.stdout);
  assert.doesNotMatch(run.stdout, /does not resolve/);
});

test('a key is allowed to grow to six letters on a collision', () => {
  const files = cleanFeature();
  files['docs/demo/demo-PRD.md'] = files['docs/demo/demo-PRD.md'].replace(
    '**Key**: DEM',
    '**Key**: DEMOPQ',
  );
  files['docs/demo/demo-PLAN.md'] = files['docs/demo/demo-PLAN.md'].replace(
    '**Key**: DEM',
    '**Key**: DEMOPQ',
  );
  const ok = lint(files);
  assert.equal(ok.status, 0, ok.stdout);

  files['docs/demo/demo-PRD.md'] = files['docs/demo/demo-PRD.md'].replace(
    '**Key**: DEMOPQ',
    '**Key**: DEMOPQR',
  );
  const tooLong = lint(files);
  assert.equal(tooLong.status, 1);
  assert.match(tooLong.stdout, /2–6 uppercase letters/);
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
