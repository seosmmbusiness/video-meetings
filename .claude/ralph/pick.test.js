'use strict';

/**
 * The work picker's suite: `node --test .claude/ralph/pick.test.js`.
 *
 * What is asserted here is the reasoning, never the network: GitHub is injected, the repository is a
 * temp directory. The order matters more than it looks — a milestone is work somebody has already
 * cut into issues, a phase is work a plan holds but GitHub does not yet, and a loose issue is
 * neither, so the loop offers them in that order and refuses to start the last kind at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pick = require('./pick');

/**
 * A repository with the plan documents this suite reasons over.
 *
 * @param {object} files Paths relative to the root, mapped to their contents.
 * @returns {string} The root's path.
 */
function repoWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-pick-'));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof body === 'string' ? body : JSON.stringify(body),
    );
  }
  return root;
}

/**
 * An MS file with the phase statuses asked for.
 *
 * @param {string} feature The slug.
 * @param {string[]} statuses One status per phase.
 * @returns {object} The MS file.
 */
function ms(feature, statuses) {
  return {
    feature,
    track: 'feature',
    sources: { final: `docs/${feature}/${feature}-FINAL.md` },
    phases: statuses.map((status, i) => ({
      phase: i + 1,
      title: `Phase ${i + 1} of ${feature}`,
      status,
      milestone: { number: 100 + i, title: `${feature} ${i + 1}` },
      issues: [{ task: `${i + 1}.1`, number: 200 + i, title: 'a task' }],
    })),
  };
}

const FINAL = `# Final plan

## Phase 1. Account name in the API

**Touches**: api · database

## Phase 2. Profile page

**Touches**: web

## Phase 3. Docs only

**Touches**: docs
`;

test('an open milestone is the first work offered, because its issues already exist', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['in-progress', 'pending']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({
    root,
    gh: (args) =>
      args[0] === 'api'
        ? [
            {
              number: 100,
              title: 'demo 1',
              open_issues: 2,
              closed_issues: 4,
              state: 'open',
            },
          ]
        : [],
  });
  assert.equal(work.candidates[0].kind, 'milestone');
  assert.equal(work.candidates[0].feature, 'demo');
  assert.equal(work.candidates[0].phase, 1);
  assert.equal(work.candidates[0].milestone.number, 100);
  assert.equal(work.candidates[0].open, 2);
});

test('a phase a plan holds but GitHub has not cut into a milestone comes after', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['completed', 'pending']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({ root, gh: () => [] });
  assert.equal(work.candidates.length, 1);
  assert.equal(work.candidates[0].kind, 'phase');
  assert.equal(work.candidates[0].phase, 2);
});

test('a feature whose phases have all settled is offered as a close-out', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['completed', 'completed']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({ root, gh: () => [] });
  assert.equal(work.candidates[0].kind, 'closeout');
  assert.equal(work.candidates[0].feature, 'demo');
});

test('work already archived is finished work, and is offered as nothing at all', () => {
  const root = repoWith({
    'docs/archive/demo/demo-MS.json': ms('demo', ['completed', 'completed']),
    'docs/archive/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({ root, gh: () => [] });
  assert.deepEqual(work.candidates, []);
  assert.equal(work.empty, true);
});

test('an issue outside the pipeline is reported, never offered as work', () => {
  const root = repoWith({
    'docs/archive/demo/demo-MS.json': ms('demo', ['completed']),
  });
  const work = pick.survey({
    root,
    gh: (args) =>
      args[0] === 'issue'
        ? [
            { number: 300, title: 'flaky test', milestone: null },
            {
              number: 301,
              title: 'in a milestone',
              milestone: { number: 100, title: 'demo 1' },
            },
          ]
        : [],
  });
  assert.deepEqual(work.candidates, []);
  assert.equal(work.loose.length, 1);
  assert.equal(work.loose[0].number, 300);
  // Loose issues are not work the loop can take, so their presence is not "something open to start".
  assert.equal(work.empty, true);
});

test('the layer and infrastructure of each phase are read off the plan, not guessed', () => {
  const phases = pick.phasesFromFinal(
    FINAL,
    ms('demo', ['pending', 'pending', 'pending']),
  );
  assert.deepEqual(phases, [
    { phase: 1, layer: 'api', needsDb: true },
    { phase: 2, layer: 'web', needsDb: true },
    { phase: 3, layer: 'api', needsDb: false },
  ]);
});

test('a plan that says nothing about a phase gets the careful default', () => {
  const phases = pick.phasesFromFinal(
    '# nothing here',
    ms('demo', ['pending']),
  );
  assert.deepEqual(phases, [{ phase: 1, layer: 'api', needsDb: true }]);
});

test('picking work writes the config the chain reads, and says where to start', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['completed', 'pending']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({ root, gh: () => [] });
  const written = {};
  const chosen = pick.selectWork(work.candidates[0], {
    root,
    writeOverrides: (patch) => Object.assign(written, patch),
  });
  assert.equal(written.feature, 'demo');
  assert.equal(written.ms, 'docs/demo/demo-MS.json');
  assert.equal(written.phases.length, 2);
  assert.equal(chosen.phaseIndex, 1);
  assert.equal(chosen.selection.kind, 'phase');
  assert.equal(chosen.selection.phase, 2);
});

test('choosing a milestone keeps the chain to that milestone alone', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['in-progress', 'pending']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({
    root,
    gh: (args) =>
      args[0] === 'api'
        ? [
            {
              number: 100,
              title: 'demo 1',
              open_issues: 1,
              closed_issues: 0,
              state: 'open',
            },
          ]
        : [],
  });
  const chosen = pick.selectWork(work.candidates[0], {
    root,
    writeOverrides: () => {},
  });
  assert.equal(chosen.selection.kind, 'milestone');
  assert.equal(chosen.selection.stopAfterPhase, 1);
});

test('choosing a close-out keeps the chain going to the end of the feature', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['completed']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({ root, gh: () => [] });
  const chosen = pick.selectWork(work.candidates[0], {
    root,
    writeOverrides: () => {},
  });
  assert.equal(chosen.selection.kind, 'closeout');
  assert.equal(chosen.selection.stopAfterPhase, null);
  assert.equal(chosen.phaseIndex, 1);
});

test('the survey reads as a list a person can answer with one number', () => {
  const root = repoWith({
    'docs/demo/demo-MS.json': ms('demo', ['in-progress', 'pending']),
    'docs/demo/demo-FINAL.md': FINAL,
  });
  const work = pick.survey({
    root,
    gh: (args) =>
      args[0] === 'api'
        ? [
            {
              number: 100,
              title: 'demo 1',
              open_issues: 2,
              closed_issues: 4,
              state: 'open',
            },
          ]
        : [{ number: 300, title: 'flaky test', milestone: null }],
  });
  const text = pick.describe(work);
  assert.match(text, /1\)/);
  assert.match(text, /milestone #100/);
  assert.match(text, /demo/);
  assert.match(text, /#300/);
});

test('nothing open says so in one line, and offers no numbers to type', () => {
  const root = repoWith({
    'docs/archive/demo/demo-MS.json': ms('demo', ['completed']),
  });
  const work = pick.survey({ root, gh: () => [] });
  const text = pick.describe(work);
  assert.match(text, /nothing open/i);
  assert.doesNotMatch(text, /1\)/);
});
