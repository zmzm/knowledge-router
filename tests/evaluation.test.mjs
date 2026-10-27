import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkThresholds, evaluateCases, validateDataset } from '../scripts/evaluation.mjs';

test('evaluation measures route accuracy, abstention, deduplicated recall and confident errors', async () => {
  const route = { domain: 'systems', skill: 'cache', confidence: 0.8 };
  const wrong = { domain: 'systems', skill: 'other', confidence: 0.9 };
  const item = (id, routes, documents, request = {}) => ({
    id,
    tags: ['measured'],
    request: { query: id, ...request },
    expected: { routes, documents },
  });
  const cases = [
    item('correct', [route], ['a.md', 'b.md']),
    item('alternative', [route], ['b.md']),
    item('false-positive', [], []),
    item('abstain', [], []),
    item('explicit', [route], ['a.md'], { skill: 'cache' }),
  ];
  const result = (selected, paths) => ({
    route: selected,
    results: paths.map((path) => ({ path })),
  });
  const responses = {
    correct: result(route, ['a.md', 'a.md', 'b.md']),
    alternative: result({ ...wrong, alternatives: [route] }, ['c.md']),
    'false-positive': result(wrong, []),
    abstain: result({ confidence: 0 }, []),
    explicit: result({ ...route, confidence: 1 }, ['a.md']),
  };
  const report = await evaluateCases(cases, async (request) => responses[request.query], { k: 2 });
  assert.equal(report.metrics.routeAccuracy, 3 / 5);
  assert.equal(report.metrics.positiveRouteAccuracy, 2 / 3);
  assert.equal(report.metrics.abstentionAccuracy, 1 / 2);
  assert.equal(report.metrics.routeRecallAt3, 4 / 5);
  assert.equal(report.metrics.documentRecallAtK, 1 / 2);
  assert.equal(report.metrics.confidentRoutes, 3);
  assert.equal(report.metrics.confidentErrors, 2);
  assert.equal(report.metrics.confidentErrorRate, 2 / 3);
  assert.deepEqual(report.byTag.measured, report.metrics);
  assert.deepEqual(report.cases[0].missingDocuments, ['b.md']);
  assert.ok(!report.cases[4].confident);
});

test('evaluation CLI fails the quality gate while returning a structured report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-router-eval-test-'));
  try {
    const path = join(directory, 'dataset.json');
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        name: 'Intentional retrieval miss',
        vault: resolve('tests/fixtures/coding'),
        thresholds: { routeAccuracy: { min: 1 } },
        cases: [
          {
            id: 'miss',
            request: { query: 'zyxwvu nebula' },
            expected: { routes: [{ domain: 'frontend', skill: 'hook' }], documents: [] },
          },
        ],
      }),
    );
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        'scripts/evaluate.mjs',
        '--dataset',
        path,
        '--check',
        '--summary',
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, '');
        const report = JSON.parse(error.stdout);
        assert.equal(report.metrics.routeAccuracy, 0);
        assert.equal(report.check.passed, false);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('evaluation handles empty denominators and validates thresholds and case labels', async () => {
  const empty = await evaluateCases([], async () => {
    throw new Error('No cases');
  });
  assert.equal(empty.metrics.routeAccuracy, null);
  assert.equal(empty.metrics.confidentErrorRate, null);
  assert.deepEqual(checkThresholds({ routeAccuracy: 0.9 }, { routeAccuracy: { min: 0.8 } }), []);
  assert.equal(checkThresholds({ routeAccuracy: 0.7 }, { routeAccuracy: { min: 0.8 } }).length, 1);
  assert.equal(
    checkThresholds({ confidentErrorRate: null }, { confidentErrorRate: { max: 0 } }).length,
    1,
  );
  assert.throws(() => checkThresholds({}, { misspelled: { min: 1 } }), /Invalid/);
  assert.throws(() => validateDataset({ schemaVersion: 1, cases: [] }), /Dataset/);
  const item = { id: 'one', request: { query: 'cache' }, expected: { routes: [], documents: [] } };
  assert.doesNotThrow(() => validateDataset({ schemaVersion: 1, cases: [item] }));
  assert.throws(() => validateDataset({ schemaVersion: 1, cases: [item, item] }), /duplicate/);
  await assert.rejects(
    evaluateCases([], async () => {}, { k: 0 }),
    /positive integer/,
  );
});
