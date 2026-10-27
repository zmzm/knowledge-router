import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VaultRetriever } from '../dist/index.js';
import { indexDocument } from '../dist/parser.js';
import { SearchEngine } from '../dist/search/engine.js';
import { metadataScore } from '../dist/search/scorer.js';
import { normalizeQuery } from '../dist/search/tokenizer.js';

test('duplicate curated phrases cannot inflate scores or confidence across metadata fields', () => {
  const make = (repeat) =>
    indexDocument(
      'systems/alpha/SKILL.md',
      `---
keywords: [${Array(repeat).fill('cache invalidation').join(', ')}]
triggers:
  keywords: [cache invalidation]
topics: [CACHE-invalidation, cache_invalidation]
aliases: [cache invalidation, CACHE INVALIDATION]
---
# Alpha`,
    );
  const query = normalizeQuery('cache invalidation');
  const once = make(1);
  const repeated = make(20);
  assert.equal(metadataScore(once, query).score, 22.5);
  assert.deepEqual(metadataScore(repeated, query), metadataScore(once, query));
  const competitor = indexDocument(
    'systems/beta/SKILL.md',
    '---\nkeywords: [cache invalidation]\n---\n# Beta',
  );
  assert.deepEqual(
    new SearchEngine([once, competitor], 3).route({ query: query.text }),
    new SearchEngine([repeated, competitor], 3).route({ query: query.text }),
  );
});

test('each curated field counts its strongest three unique phrases with stable tie breaking', () => {
  const words = Array.from({ length: 20 }, (_, i) => `signal${i}`);
  const query = normalizeQuery(words.join(' '));
  for (const [field, weight] of [
    ['keywords', 15],
    ['topics', 12],
    ['aliases', 10],
  ]) {
    const make = (values) =>
      indexDocument(
        'systems/alpha/SKILL.md',
        `---\n${field}: [${values.join(', ')}]\n---\n# Guide`,
      );
    const result = metadataScore(make(words), query);
    assert.equal(result.score, 3 * weight * 1.5);
    assert.equal(result.reasons.length, 3);
    assert.deepEqual(result, metadataScore(make([...words].reverse()), query));
  }
});

test('equivalent camelCase and spaced metadata use the same partial-match coverage', () => {
  const query = normalizeQuery('cache');
  const make = (topics) =>
    indexDocument('systems/alpha/SKILL.md', `---\ntopics: [${topics.join(', ')}]\n---\n# Guide`);
  const once = metadataScore(make(['cacheInvalidation']), query).score;
  assert.equal(
    once,
    metadataScore(make(['cache invalidation', 'CACHE-invalidation', 'cacheInvalidation']), query)
      .score,
  );
});

test('syntax-bearing triggers preserve punctuation instead of matching unrelated prose', () => {
  const docs = [
    indexDocument(
      'frontend/accessibility/SKILL.md',
      '---\nkeywords: ["role=", "aria-"]\n---\n# Accessibility',
    ),
    indexDocument('backend/security/SKILL.md', '---\nkeywords: [access control]\n---\n# Security'),
  ];
  const engine = new SearchEngine(docs, 3);
  assert.equal(metadataScore(docs[0], normalizeQuery('role based access control')).score, 0);
  assert.equal(
    engine.route({
      query: 'role-based access control admin mentor permissions who can create content',
    }).skill,
    'security',
  );
  for (const query of ['role="button"', 'role = "button"', 'aria-label="Close"']) {
    assert.equal(engine.route({ query }).skill, 'accessibility');
  }
});

function mixedDocuments() {
  return ['alpha', 'beta'].flatMap((skill, i) => {
    const word = i ? 'cache' : 'hook';
    return [
      indexDocument(
        `frontend/${skill}/SKILL.md`,
        `---\nkeywords: [${word}]\n---\n# ${word}\n\nGuidance.`,
      ),
      indexDocument(
        `frontend/${skill}/references/rules.md`,
        `# ${word}\n\n## First\nFollow hook cache rules.\n\n## Second\nApply hook cache conventions.`,
      ),
    ];
  });
}

test('multi-skill search returns both complete skills and shares the reference budget fairly', () => {
  const docs = mixedDocuments();
  const engine = new SearchEngine(docs, 3);
  const ordinary = engine.search({ query: 'hook cache' });
  assert.equal(ordinary.results.filter((item) => item.kind === 'skill').length, 1);
  const request = { query: 'hook cache', maxSkills: 2 };
  const response = engine.search(request);
  assert.deepEqual(response.route, ordinary.route);
  assert.deepEqual(
    response.results.slice(0, 2).map((item) => item.path),
    ['frontend/alpha/SKILL.md', 'frontend/beta/SKILL.md'],
  );
  assert.equal(response.results[1].content, docs[2].content);
  assert.equal(response.relatedRoutes[0].skill, 'beta');
  assert.ok(response.relatedRoutes[0].reasons.some((reason) => reason.type === 'related'));
  const refs = response.results.filter((item) => item.kind === 'reference');
  assert.equal(refs.length, 3);
  assert.deepEqual(
    refs.slice(0, 2).map((item) => item.skill),
    ['alpha', 'beta'],
  );
  assert.equal(response.results.length, 5);
  assert.deepEqual(response, new SearchEngine([...docs].reverse(), 3).search(request));
});

test('multi-skill expansion honors explicit choices, relevance margins, domains, and inactive status', () => {
  const docs = mixedDocuments();
  const engine = new SearchEngine(docs, 3);
  const request = { query: 'hook cache', maxSkills: 2 };
  assert.equal(
    engine.search({ ...request, skill: 'alpha' }).results.filter((item) => item.kind === 'skill')
      .length,
    1,
  );
  const weak = new SearchEngine(
    [docs[0], indexDocument('frontend/weak/SKILL.md', '---\ndescription: hook\n---\n# Guide')],
    3,
  ).search(request);
  assert.equal(weak.results.filter((item) => item.kind === 'skill').length, 1);
  const archived = docs.map((doc) => (doc.skill === 'beta' ? { ...doc, status: 'archived' } : doc));
  const inactive = new SearchEngine(archived, 3);
  assert.equal(inactive.search(request).results.filter((item) => item.kind === 'skill').length, 1);
  assert.equal(
    inactive
      .search({ ...request, includeInactive: true })
      .results.filter((item) => item.kind === 'skill').length,
    2,
  );
  const domains = docs.map((doc) =>
    doc.skill === 'beta'
      ? { ...doc, domain: 'backend', path: doc.path.replace('frontend/', 'backend/') }
      : doc,
  );
  assert.equal(
    new SearchEngine(domains, 3)
      .search({ ...request, domain: 'frontend' })
      .results.filter((item) => item.kind === 'skill').length,
    1,
  );
  assert.equal(
    new SearchEngine(domains, 3).search(request).results.filter((item) => item.kind === 'skill')
      .length,
    1,
  );
  assert.equal(
    new SearchEngine(domains, 3)
      .search({ ...request, query: 'frontend backend hook cache' })
      .results.filter((item) => item.kind === 'skill').length,
    2,
  );
});

test('CLI exposes multi-skill search and rejects the flag on routing commands', async () => {
  const exec = promisify(execFile);
  const vault = await mkdtemp(join(tmpdir(), 'knowledge-router-related-'));
  try {
    for (const [skill, word] of [
      ['alpha', 'hook'],
      ['beta', 'cache'],
    ]) {
      const path = join(vault, 'frontend', skill);
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'SKILL.md'), `---\nkeywords: [${word}]\n---\n# ${word}`);
    }
    const retriever = await VaultRetriever.open(vault);
    const cli = resolve('dist/cli.js');
    const args = [cli, 'search', 'hook cache', '--vault', vault, '--max-skills', '2'];
    const response = JSON.parse((await exec(process.execPath, [...args, '--json'])).stdout);
    assert.deepEqual(
      response,
      JSON.parse(JSON.stringify(await retriever.search({ query: 'hook cache', maxSkills: 2 }))),
    );
    assert.equal(response.relatedRoutes.length, 1);
    assert.match((await exec(process.execPath, args)).stdout, /Related skills/);
    await assert.rejects(
      exec(process.execPath, [
        cli,
        'route',
        'hook cache',
        '--vault',
        vault,
        '--max-skills',
        '2',
        '--json',
      ]),
      (error) => {
        assert.match(JSON.parse(error.stderr).error, /only available for search/);
        return true;
      },
    );
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test('multi-skill limits validate inputs and never exceed document or section budgets', () => {
  const engine = new SearchEngine(mixedDocuments(), 0);
  for (const maxSkills of [0, 3, 1.5, '2']) {
    assert.throws(() => engine.search({ query: 'hook cache', maxSkills }), /maxSkills/);
  }
  for (const limit of [0, 1, 2, 10]) {
    const response = engine.search({ query: 'hook cache', maxSkills: 2, limit });
    assert.equal(response.results.length, Math.min(limit, 2));
    assert.ok(response.results.every((item) => item.kind === 'skill'));
    assert.equal(response.relatedRoutes?.length ?? 0, limit >= 2 ? 1 : 0);
  }
});
