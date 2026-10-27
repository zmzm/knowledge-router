import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VaultRetriever } from '../dist/index.js';
import { parseMarkdown, indexDocument } from '../dist/parser.js';
import { tokenize } from '../dist/search/tokenizer.js';
import { BM25 } from '../dist/search/bm25.js';
import { SearchEngine } from '../dist/search/engine.js';

const fixtures = new URL('./fixtures/coding/', import.meta.url);
const exec = promisify(execFile);
let vault;
let retriever;
before(async () => {
  vault = await mkdtemp(join(tmpdir(), 'knowledge-router-test-'));
  await cp(fixtures, vault, { recursive: true });
  retriever = await VaultRetriever.open(vault);
});
after(async () => {
  await rm(vault, { recursive: true, force: true });
});

const cases = [
  ['invalidate query cache after useMutation', 'frontend', 'react-query'],
  ['how should this custom hook return its values', 'frontend', 'hook'],
  ['protect route and redirect unauthenticated user', 'frontend', 'routing'],
  ['transaction around several Prisma writes', 'backend', 'database'],
  ['design pagination query params and response DTO', 'backend', 'api'],
  ['use semantic symbol navigation before editing method', 'common', 'serena'],
];
for (const [query, domain, skill] of cases) {
  test(`routes: ${query}`, async () => {
    const route = await retriever.route({ query });
    assert.equal(route.domain, domain);
    assert.equal(route.skill, skill);
    assert.ok(route.confidence > 0 && route.confidence < 1);
    assert.ok(route.reasons.length);
  });
}

test('returns complete skill, ranked reference sections, and explainable evidence', async () => {
  const response = await retriever.search({
    query: 'cache invalidation useMutation invalidateQueries',
  });
  const [skill, reference] = response.results;
  assert.equal(skill.path, 'frontend/react-query/SKILL.md');
  assert.equal(skill.content, await readFile(join(vault, skill.path), 'utf8'));
  assert.ok(
    skill.reasons.some((reason) => reason.type === 'keyword' && reason.value === 'useMutation'),
  );
  assert.equal(reference.path, 'frontend/react-query/references/cache-invalidation.md');
  assert.ok(
    reference.reasons.some(
      (reason) => reason.type === 'topic' && reason.value === 'cache invalidation',
    ),
  );
  assert.ok(
    response.results.some((result) =>
      result.reasons.some(
        (reason) => reason.type === 'identifier' && reason.value === 'invalidateQueries',
      ),
    ),
  );
  assert.ok(response.results.every((result) => result.reasons.length));
  assert.ok(response.results.length <= 5);
  assert.ok(response.results.filter((result) => result.kind === 'reference').length <= 3);
  assert.ok(!response.results.some((result) => result.path === 'AGENTS.md'));
  for (const result of response.results.slice(1)) {
    assert.equal(
      result.content,
      (
        await retriever.read({
          path: result.path,
          startLine: result.startLine,
          endLine: result.endLine,
        })
      ).content,
    );
    assert.ok(result.content.length < (await readFile(join(vault, result.path), 'utf8')).length);
  }
});

test('optimistic mutation guidance ranks above unrelated query options', async () => {
  const response = await retriever.search({ query: 'optimistic mutation update' });
  assert.equal(response.route.skill, 'react-query');
  assert.equal(response.results[1].path, 'frontend/react-query/references/mutations.md');
  assert.match(response.results[1].section, /Optimistic updates/);
});

test('path hints boost a match but cannot route an unrelated query', async () => {
  const paths = ['apps/web/src/course/course.hook.ts'];
  const query = 'rename this custom hook and improve its return interface';
  const withPath = await retriever.route({ query, paths });
  assert.equal(withPath.skill, 'hook');
  assert.ok(withPath.reasons.some((reason) => reason.type === 'path'));
  const unknown = await retriever.search({ query: 'zyxwvu astronomy nebula', paths });
  assert.equal(unknown.route.skill, undefined);
  assert.equal(unknown.route.confidence, 0);
  assert.deepEqual(unknown.results, []);
  const excluded = await retriever.route({ query, paths: ['apps/web/course.spec.hook.ts'] });
  assert.ok(!excluded.reasons.some((reason) => reason.type === 'path'));
});

test('explicit constraints, empty results, and invalid inputs', async () => {
  const forced = await retriever.search({
    query: 'cache invalidation',
    domain: 'backend',
    skill: 'database',
  });
  assert.equal(forced.route.domain, 'backend');
  assert.equal(forced.route.skill, 'database');
  assert.equal(forced.route.confidence, 1);
  assert.ok(forced.results.every((result) => result.domain === 'backend'));
  assert.equal((await retriever.search({ query: 'useMutation', limit: 1 })).results.length, 1);
  assert.deepEqual((await retriever.search({ query: 'useMutation', limit: 0 })).results, []);
  await assert.rejects(retriever.search({ query: ' ' }), /query/);
  await assert.rejects(retriever.search({ query: 'x', limit: -1 }), /limit/);
  await assert.rejects(retriever.route({ query: 'x', domain: 'missing' }), /Unknown domain/);
  await assert.rejects(
    retriever.route({ query: 'x', skill: 'missing' }),
    /Unknown or excluded skill/,
  );
});

test('inactive documents are excluded unless explicitly included', async () => {
  const request = { query: 'cache invalidation', limit: 10 };
  assert.ok(
    !(await retriever.search(request)).results.some((result) =>
      result.path.includes('old-invalidation'),
    ),
  );
  const expanded = await VaultRetriever.open(vault, { maxReferenceSections: 20 });
  assert.ok(
    (await expanded.search({ ...request, includeInactive: true })).results.some((result) =>
      result.path.includes('old-invalidation'),
    ),
  );
});

test('clearly named root guidance can be retrieved', async () => {
  const result = await retriever.search({ query: 'explain instruction precedence' });
  assert.ok(result.results.some((item) => item.path === 'RULES.md'));
});

test('read supports full documents, unambiguous sections and line ranges', async () => {
  const path = 'frontend/react-query/references/cache-invalidation.md';
  const section = await retriever.read({ path, section: 'Selective Invalidation' });
  assert.equal(section.section, 'Cache Invalidation > Notes > Selective Invalidation');
  assert.match(section.content, /predicate/);
  assert.equal((await retriever.read({ path, section: section.section })).content, section.content);
  assert.equal((await retriever.read({ path, startLine: 1, endLine: 1 })).content, '---');
  await assert.rejects(retriever.read({ path, section: 'missing' }), /Section not found/);
  await assert.rejects(retriever.read({ path, startLine: 0 }), /Invalid line range/);
  await assert.rejects(retriever.read({ path, endLine: 10000 }), /Invalid line range/);
  await assert.rejects(retriever.read({ path, section: 'Rules', startLine: 1 }), /not both/);
  await assert.rejects(retriever.read({ path: '../outside.md' }), /traversal/);
  await assert.rejects(retriever.read({ path: '/etc/passwd' }), /relative/);
});

test('cache is reusable and ranking is stable across repeated opens', async () => {
  const request = { query: 'invalidate query cache after useMutation', paths: ['apps/a.hook.ts'] };
  const reopened = await VaultRetriever.open(vault);
  assert.deepEqual(await retriever.search(request), await reopened.search(request));
  const data = JSON.parse(await readFile(join(vault, '.knowledge/index.json'), 'utf8'));
  assert.equal(data.version, 2);
  assert.ok(data.documents.every((doc) => doc.hash && Number.isFinite(doc.modifiedAt)));
  assert.ok(data.documents.some((doc) => doc.kind === 'domain-index'));
});

test('CLI build, route, search, read, and JSON errors', async () => {
  const cli = resolve('dist/cli.js');
  for (const command of ['build', 'route', 'search']) {
    const args = [
      cli,
      command,
      ...(command === 'build' ? [] : ['invalidate query cache after useMutation']),
      '--vault',
      vault,
      '--json',
    ];
    const { stdout, stderr } = await exec(process.execPath, args);
    assert.equal(stderr, '');
    const data = JSON.parse(stdout);
    if (command === 'route') {
      assert.equal(data.skill, 'react-query');
    }
    if (command === 'search') {
      assert.equal(data.results[0].kind, 'skill');
    }
    if (command === 'build') {
      assert.equal(data.vault, vault);
    }
  }
  const { stdout } = await exec(process.execPath, [
    cli,
    'read',
    'RULES.md',
    '--vault',
    vault,
    '--json',
  ]);
  assert.match(JSON.parse(stdout).content, /Instruction Precedence/);
  await assert.rejects(
    exec(process.execPath, [cli, 'search', 'x', '--limit', 'wat', '--json']),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(JSON.parse(error.stderr).error, /integer/);
      return true;
    },
  );
});

test('Markdown parsing preserves hierarchy, line ranges, YAML, and fenced identifiers', () => {
  const source = [
    '---',
    'description: >-',
    '  Multi-line YAML',
    '  description.',
    'topics: [cache, mutation]',
    '---',
    '# Cache',
    '',
    '## Rules',
    'Invalidate cache.',
    '',
    '~~~ts',
    '# not a heading',
    'queryClient.invalidateQueries();',
    '~~~',
    '',
    '### Example',
    'useMutation();',
    '',
    '## Next',
    'Other prose.',
  ].join('\n');
  const parsed = parseMarkdown(source);
  assert.equal(parsed.metadata.description, 'Multi-line YAML description.');
  assert.deepEqual(
    parsed.headings.map((h) => h.hierarchy),
    [['Cache'], ['Cache', 'Rules'], ['Cache', 'Rules', 'Example'], ['Cache', 'Next']],
  );
  assert.ok(!parsed.prose.includes('invalidateQueries'));
  assert.ok(parsed.code.includes('invalidateQueries'));
  assert.equal(parsed.headings[1].startLine, 9);
  for (const heading of parsed.headings) {
    assert.equal(
      heading.content,
      source
        .split('\n')
        .slice(heading.startLine - 1, heading.endLine)
        .join('\n'),
    );
  }
  assert.throws(() => parseMarkdown('---\nfoo: [\n---\n# Invalid'), /Invalid YAML/);
  assert.throws(() => parseMarkdown('---\nfoo: bar'), /Unterminated/);
  assert.equal(indexDocument('frontend/new/SKILL.md', '# New').skill, 'new');
  assert.deepEqual(
    parseMarkdown('Title\n=====\n\nBody\n\nSub\n---\nText').headings.map((h) => h.level),
    [1, 2],
  );
});

test('tokenization preserves technical identifiers and supports components', () => {
  const terms = tokenize(
    'queryClient.invalidateQueries after useMutation NestJS DTO @tanstack/react-query',
  );
  for (const term of [
    'queryclient',
    'query',
    'client',
    'invalidatequeries',
    'invalidate',
    'usemutation',
    'mutation',
    'nestjs',
    'dto',
    'tanstack',
  ]) {
    assert.ok(terms.includes(term), term);
  }
});

test('BM25 rewards focused matches and handles empty corpora', () => {
  const corpus = new BM25([
    'cache invalidation',
    `cache ${'unrelated '.repeat(100)}`,
    'database writes',
  ]);
  const query = new Set(['cache', 'invalidation']);
  assert.ok(corpus.score(0, query).score > corpus.score(1, query).score);
  assert.equal(corpus.score(2, query).score, 0);
  assert.equal(new BM25([]).score(0, query).score, 0);
});

test('curated phrases and canonical guidance outrank repeated body text', () => {
  const skill = indexDocument(
    'systems/cache/SKILL.md',
    '---\nkeywords: [cache invalidation]\n---\n# Cache',
  );
  const document = (name, frontmatter, body = 'Invalidate cache safely.') =>
    indexDocument(
      `systems/cache/references/${name}.md`,
      `---\n${frontmatter}\n---\n# Guidance\n\n## Rules\n${body}`,
    );
  const documents = [
    skill,
    document('canonical', 'topics: [cache invalidation]\ncanonical: true'),
    document('ordinary', 'topics: [cache invalidation]'),
    document('low', 'topics: [cache invalidation]\npriority: low'),
    document(
      'body-only',
      'priority: high',
      'cache and lots of unrelated text then invalidation. '.repeat(40),
    ),
  ];
  const engine = new SearchEngine(documents, 10);
  const results = engine.search({ query: 'cache invalidation', limit: 10 }).results;
  assert.deepEqual(
    results.slice(1).map((result) => result.path.split('/').at(-1)),
    ['canonical.md', 'ordinary.md', 'low.md'],
  );
  assert.ok(results[1].reasons.some((reason) => reason.type === 'canonical'));
  assert.ok(results[3].reasons.some((reason) => reason.type === 'priority'));
});

test('ties are deterministic and expose uncertainty and alternatives', () => {
  const a = indexDocument('systems/alpha/SKILL.md', '---\nkeywords: [widget]\n---\n# Widgets');
  const b = indexDocument('systems/beta/SKILL.md', a.content);
  const first = new SearchEngine([b, a], 3).route({ query: 'widget' });
  const second = new SearchEngine([a, b], 3).route({ query: 'widget' });
  assert.deepEqual(first, second);
  assert.equal(first.skill, 'alpha');
  assert.ok(first.confidence > 0 && first.confidence < 0.65);
  assert.equal(first.alternatives[0].skill, 'beta');
  assert.equal(first.alternatives[0].confidence, first.confidence);
});

test('inactive skills exclude their references and metadata aliases route without path hints', () => {
  const skill = indexDocument('systems/cache/SKILL.md', '---\nstatus: archived\n---\n# Cache');
  const reference = indexDocument(
    'systems/cache/references/reset.md',
    '---\naliases: [fresh start]\n---\n# Reset\n\n## Start\nPerform a fresh start.',
  );
  const engine = new SearchEngine([skill, reference], 3);
  assert.equal(engine.route({ query: 'fresh start' }).skill, undefined);
  assert.equal(engine.route({ query: 'fresh start', includeInactive: true }).skill, 'cache');
  assert.throws(() => engine.route({ query: 'cache', skill: 'cache' }), /excluded/);
});

test('reader rejects ambiguous headings and accepts full hierarchies', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'knowledge-router-sections-'));
  try {
    await writeFile(
      join(temp, 'notes.md'),
      '# Notes\n\n## First\n\n### Rules\nOne.\n\n## Second\n\n### Rules\nTwo.',
    );
    const reader = await VaultRetriever.open(temp);
    await assert.rejects(reader.read({ path: 'notes.md', section: 'Rules' }), /Ambiguous/);
    assert.match(
      (await reader.read({ path: 'notes.md', section: 'Notes > Second > Rules' })).content,
      /Two/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('full rebuild handles changes/deletions, new domains, corruption, and symlink escapes', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'knowledge-router-rebuild-'));
  try {
    await mkdir(join(temp, 'mobile/native/references'), { recursive: true });
    const skillPath = join(temp, 'mobile/native/SKILL.md');
    await writeFile(skillPath, '---\nkeywords: [SwiftUI]\n---\n# SwiftUI\n\nBuild mobile layouts.');
    await writeFile(
      join(temp, 'mobile/native/references/layout.md'),
      '# Layout\n\n## SwiftUI layout\nUse SwiftUI stacks.',
    );
    await symlink('/etc', join(temp, 'external'));
    const router = await VaultRetriever.open(temp);
    assert.equal((await router.route({ query: 'SwiftUI layout' })).domain, 'mobile');
    await assert.rejects(router.read({ path: 'external/passwd.md' }));
    await symlink(join(vault, 'RULES.md'), join(temp, 'escape.md'));
    await assert.rejects(router.read({ path: 'escape.md' }), /escapes/);
    await writeFile(skillPath, '---\nkeywords: [Kotlin]\n---\n# Kotlin\n\nBuild mobile layouts.');
    await rm(join(temp, 'mobile/native/references/layout.md'));
    await router.build();
    assert.equal((await router.route({ query: 'SwiftUI' })).skill, undefined);
    assert.equal((await router.route({ query: 'Kotlin' })).skill, 'native');
    await writeFile(join(temp, '.knowledge/index.json'), '{broken');
    const rebuilt = await VaultRetriever.open(temp);
    assert.equal((await rebuilt.route({ query: 'Kotlin' })).skill, 'native');
    const filtered = await VaultRetriever.open(temp, { domains: ['frontend'] });
    assert.equal((await filtered.route({ query: 'Kotlin' })).skill, undefined);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('a named domain outweighs generic reference conventions without forcing unrelated routes', () => {
  const documents = [
    indexDocument(
      'frontend/coding/SKILL.md',
      '---\ndescription: Component conventions.\n---\n# Frontend Coding Skill\n\n## Patterns\nFrontend component conventions.',
    ),
    indexDocument(
      'backend/api/SKILL.md',
      '---\ndescription: RESTful API design patterns and conventions for endpoints\n---\n# Backend API Design Skill',
    ),
    indexDocument(
      'backend/api/references/rest.md',
      '---\ntopics: [RESTful conventions]\n---\n# RESTful Conventions\n\n## Rules\nUse consistent naming conventions.',
    ),
  ];
  const engine = new SearchEngine(documents, 3);
  for (const query of ['frontend conventions', 'frontend component conventions']) {
    const route = engine.route({ query });
    assert.equal(route.domain, 'frontend', query);
    assert.ok(
      route.reasons.some((reason) => reason.type === 'domain' && reason.value === 'frontend'),
    );
  }
  assert.equal(engine.route({ query: 'frontend nebula astronomy' }).skill, undefined);
  assert.equal(
    engine.route({ query: 'frontend conventions', domain: 'backend' }).domain,
    'backend',
  );
  assert.equal(engine.route({ query: 'frontend conventions', skill: 'api' }).skill, 'api');
  assert.ok(
    !engine
      .route({ query: 'frontend backend conventions' })
      .reasons.some((reason) => reason.type === 'domain'),
  );
  const renamed = documents.map((doc) => ({
    ...doc,
    domain: doc.domain === 'frontend' ? 'mobile' : doc.domain,
  }));
  assert.equal(
    new SearchEngine(renamed, 3).route({ query: 'mobile component conventions' }).domain,
    'mobile',
  );
});

test('text search includes guidance content and unresolved searches explain how to retry', async () => {
  const cli = resolve('dist/cli.js');
  const query = 'invalidate query cache after useMutation';
  const response = await retriever.search({ query });
  const { stdout } = await exec(process.execPath, [cli, 'search', query, '--vault', vault]);
  assert.ok(stdout.includes(response.results[0].content));
  for (const alternative of response.route.alternatives ?? []) {
    assert.ok(stdout.includes(`${alternative.domain}/${alternative.skill}`));
  }
  const unresolved = await exec(process.execPath, [
    cli,
    'search',
    'nebula zyxwvu',
    '--vault',
    vault,
  ]);
  assert.match(unresolved.stdout, /--path/);
  assert.match(unresolved.stdout, /--domain/);
});

test('checkout launcher finds nvm Node without a shell profile and preserves JSON arguments', async () => {
  const home = await mkdtemp(join(tmpdir(), 'knowledge-router-runtime-'));
  try {
    const bin = join(home, '.nvm/versions/node/v22.0.0/bin');
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, join(bin, 'node'));
    const blockedBin = join(home, 'bin');
    await mkdir(blockedBin);
    await writeFile(join(blockedBin, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const env = { HOME: home, PATH: `${blockedBin}:/usr/bin:/bin` };
    const launcher = resolve('scripts/knowledge');
    const args = [
      launcher,
      'search',
      'invalidate query cache after useMutation',
      '--vault',
      vault,
      '--json',
    ];
    const { stdout } = await exec('/bin/sh', args, { env });
    assert.equal(JSON.parse(stdout).route.skill, 'react-query');
    const customNvm = await exec('/bin/sh', args, {
      env: { ...env, HOME: join(home, 'unused'), NVM_DIR: join(home, '.nvm') },
    });
    assert.equal(JSON.parse(customNvm.stdout).route.skill, 'react-query');
    const configured = await exec('/bin/sh', args, {
      env: { ...env, KNOWLEDGE_NODE: process.execPath },
    });
    assert.equal(JSON.parse(configured.stdout).route.skill, 'react-query');
    await assert.rejects(
      exec('/bin/sh', args, { env: { ...env, HOME: join(home, 'unused') } }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Node.js 22\+ was not found/);
        return true;
      },
    );
    await assert.rejects(
      exec('/bin/sh', args, { env: { ...env, KNOWLEDGE_NODE: join(home, 'missing') } }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /KNOWLEDGE_NODE/);
        return true;
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
