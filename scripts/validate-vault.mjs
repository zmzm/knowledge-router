import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { VaultRetriever } from '../dist/index.js';

const vault = process.argv[2];
if (!vault) {
  throw new Error('Usage: npm run validate:vault -- /path/to/coding');
}
const temporary = await mkdtemp(join(tmpdir(), 'knowledge-router-validation-'));
try {
  const cachePath = join(temporary, 'index.json');
  const started = performance.now();
  const retriever = await VaultRetriever.open(vault, { cachePath });
  const buildMs = performance.now() - started;
  const openStarted = performance.now();
  const reopened = await VaultRetriever.open(vault, { cachePath });
  const cachedOpenMs = performance.now() - openStarted;
  const cases = [
    ['invalidate query cache after useMutation', 'frontend', 'react-query'],
    ['how should this custom hook return its values', 'frontend', 'hook'],
    ['protect route and redirect unauthenticated user', 'frontend', 'routing'],
    ['transaction around several Prisma writes', 'backend', 'database'],
    ['design pagination query params and response DTO', 'backend', 'api'],
    ['use semantic symbol navigation before editing method', 'common', 'serena'],
    ['frontend component conventions', 'frontend', 'coding'],
    ['frontend conventions', 'frontend', 'coding'],
    [
      'invalidate React Query enrollment queries after quiz attempt mutation updates progress',
      'frontend',
      'react-query',
    ],
  ];
  const timings = [];
  for (const [query, domain, skill] of cases) {
    const start = performance.now();
    const response = await retriever.search({ query });
    timings.push(performance.now() - start);
    assert.equal(response.route.domain, domain, query);
    assert.equal(response.route.skill, skill, query);
    assert.ok(response.results[0].kind === 'skill');
    assert.ok(response.results.every((result) => result.reasons.length));
    assert.deepEqual(response, await reopened.search({ query }));
  }
  const paths = ['apps/web/src/course/course.hook.ts'];
  const query = 'How should I invalidate React Query cache after updating a course?';
  const result = await retriever.search({ query, paths });
  assert.equal(result.route.skill, 'react-query');
  assert.equal(result.results[1].path, 'frontend/react-query/references/cache-invalidation.md');
  assert.equal(
    (
      await retriever.route({
        query: 'rename this custom hook and improve its return interface',
        paths,
      })
    ).skill,
    'hook',
  );
  const optimistic = await retriever.search({ query: 'optimistic mutation update' });
  assert.match(optimistic.results[1].path, /(?:mutations|advanced-patterns)\.md$/);
  const index = JSON.parse(await readFile(cachePath, 'utf8'));
  console.log(
    JSON.stringify(
      {
        node: process.version,
        architecture: process.arch,
        documents: index.documents.length,
        sections: index.documents.reduce((sum, doc) => sum + doc.headings.length, 0),
        indexBytes: (await stat(cachePath)).size,
        buildMs: Math.round(buildMs),
        cachedOpenMs: Math.round(cachedOpenMs),
        searchMs: { min: Math.round(Math.min(...timings)), max: Math.round(Math.max(...timings)) },
        processRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        acceptanceCasesPassed: cases.length + 3,
        example: {
          route: result.route,
          results: result.results.map(({ content: _content, ...rest }) => rest),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
