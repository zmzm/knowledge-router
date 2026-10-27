import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VaultRetriever } from '../dist/index.js';
import { indexDocument } from '../dist/parser.js';
import { SearchEngine } from '../dist/search/engine.js';

const exec = promisify(execFile);
async function withVault(files, run) {
  const vault = await mkdtemp(join(tmpdir(), 'knowledge-router-priorities-'));
  const write = async (path, content) => {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  };
  try {
    for (const [path, content] of Object.entries(files)) {
      await write(path, content);
    }
    await run(vault, write);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
}

test('nested skills retain unique identities, references, and explicit selection after reopening', async () => {
  await withVault(
    {
      'frontend/forms/react/SKILL.md': '---\nname: react-forms\nkeywords: [React]\n---\n# React',
      'frontend/forms/vue/SKILL.md': '---\nname: vue-forms\nkeywords: [Vue]\n---\n# Vue',
      'frontend/forms/react/references/rules.md': '# React\n\n## Rules\nReact forms.',
      'frontend/forms/vue/references/rules.md': '# Vue\n\n## Rules\nVue forms.',
    },
    async (vault) => {
      const first = await VaultRetriever.open(vault);
      const reopened = await VaultRetriever.open(vault);
      for (const router of [first, reopened]) {
        for (const skill of [undefined, 'vue-forms', 'forms/vue']) {
          const response = await router.search({ query: 'Vue forms', skill });
          assert.equal(response.route.skill, 'forms/vue');
          assert.equal(response.results[0].path, 'frontend/forms/vue/SKILL.md');
          assert.ok(response.results.some((item) => item.kind === 'reference'));
          assert.ok(response.results.every((item) => item.path.startsWith('frontend/forms/vue/')));
        }
      }
    },
  );
});

test('ambiguous names and duplicate explicit skill identities report actionable errors', () => {
  const a = indexDocument('frontend/forms/react/SKILL.md', '---\nname: forms\n---\n# React');
  const b = indexDocument('frontend/forms/vue/SKILL.md', '---\nname: forms\n---\n# Vue');
  const engine = new SearchEngine([a, b], 3);
  assert.throws(
    () => engine.search({ query: 'forms', domain: 'frontend', skill: 'forms' }),
    /Ambiguous skill.*forms/,
  );
  assert.throws(
    () =>
      new SearchEngine(
        [
          { ...a, skill: 'same' },
          { ...b, skill: 'same' },
        ],
        3,
      ),
    /Duplicate skill.*frontend\/same/,
  );
});

test('an inactive nested skill does not exclude its active sibling or leak its references', () => {
  const engine = new SearchEngine(
    [
      indexDocument('frontend/forms/react/SKILL.md', '---\nstatus: archived\n---\n# React'),
      indexDocument('frontend/forms/vue/SKILL.md', '---\nkeywords: [Vue]\n---\n# Vue'),
      indexDocument('frontend/forms/react/references/rules.md', '# React\n\nVue forms.'),
      indexDocument('frontend/forms/vue/references/rules.md', '# Vue\n\nVue forms.'),
    ],
    3,
  );
  const response = engine.search({ query: 'Vue forms' });
  assert.equal(response.route.skill, 'forms/vue');
  assert.ok(response.results.every((item) => item.path.startsWith('frontend/forms/vue/')));
});

test('strong body matches route skills and return sections without curated metadata', () => {
  const engine = new SearchEngine(
    [
      indexDocument(
        'backend/database/SKILL.md',
        '# Database\n\nUse serializable isolation and retry deadlocks.',
      ),
      indexDocument(
        'backend/database/references/guide.md',
        '# Guide\n\n## Details\nUse serializable isolation and retry deadlocks.',
      ),
    ],
    3,
  );
  const response = engine.search({ query: 'serializable isolation retry deadlocks' });
  assert.equal(response.route.skill, 'database');
  assert.equal(response.results[1].section, 'Guide > Details');
  assert.ok(response.route.reasons.some((reason) => reason.type === 'fallback'));
  assert.equal(engine.route({ query: 'serializable astronomy nebula' }).skill, undefined);
  assert.equal(engine.route({ query: 'deadlocks' }).skill, undefined);
  assert.equal(engine.route({ query: 'serializable serializable' }).skill, undefined);
});

test('a strong reference body match can discover its skill and explicit searches can retrieve it', () => {
  const engine = new SearchEngine(
    [
      indexDocument('backend/database/SKILL.md', '# Database\n\nGeneral guidance.'),
      indexDocument(
        'backend/database/references/guide.md',
        '# Guide\n\n## Details\nUse serializable isolation and retry deadlocks.',
      ),
    ],
    3,
  );
  for (const skill of [undefined, 'database']) {
    const response = engine.search({ query: 'serializable isolation retry deadlocks', skill });
    assert.equal(response.route.skill, 'database');
    assert.equal(response.results[1].path, 'backend/database/references/guide.md');
  }
});

test('curated routes retain precedence over a strong text-only alternative', () => {
  const engine = new SearchEngine(
    [
      indexDocument(
        'backend/database/SKILL.md',
        '---\nkeywords: [serializable isolation]\n---\n# Database',
      ),
      indexDocument('backend/other/SKILL.md', '# Other\n\nSerializable isolation retry deadlocks.'),
    ],
    3,
  );
  const response = engine.search({ query: 'serializable isolation retry deadlocks' });
  assert.equal(response.route.skill, 'database');
  assert.ok(!response.route.reasons.some((reason) => reason.type === 'fallback'));
});

test('fallback reference evidence stays inside its skill and honors inactive and domain filters', () => {
  const documents = [
    indexDocument('backend/database/SKILL.md', '# Database'),
    indexDocument(
      'backend/database/references/old.md',
      '---\nstatus: archived\n---\n# Guide\n\nSerializable isolation retry deadlocks.',
    ),
    indexDocument(
      'backend/other/references/spoofed.md',
      '---\nskill: database\n---\n# Guide\n\nSerializable isolation retry deadlocks.',
    ),
    indexDocument('frontend/forms/SKILL.md', '# Forms'),
  ];
  const engine = new SearchEngine(documents, 3);
  const query = 'serializable isolation retry deadlocks';
  assert.equal(engine.route({ query }).skill, undefined);
  const response = engine.search({ query, includeInactive: true });
  assert.equal(response.route.skill, 'database');
  assert.equal(response.results[1].path, 'backend/database/references/old.md');
  assert.equal(engine.route({ query, includeInactive: true, domain: 'frontend' }).skill, undefined);
});

test('duplicate skills fail rebuilding without replacing a working cache or engine', async () => {
  await withVault(
    { 'backend/database/SKILL.md': '---\nskill: database\n---\n# Database' },
    async (vault, write) => {
      const router = await VaultRetriever.open(vault);
      const before = await router.search({ query: 'database' });
      const cache = await readFile(router.cachePath, 'utf8');
      await write('backend/other/SKILL.md', '---\nskill: database\n---\n# Other');
      await assert.rejects(router.build(), /Duplicate skill.*backend\/database/);
      assert.deepEqual(await router.search({ query: 'database' }), before);
      assert.equal(await readFile(router.cachePath, 'utf8'), cache);
    },
  );
});

test('freshness checks detect additions, deletions, and same-size edits without changing the snapshot', async () => {
  await withVault(
    {
      'backend/database/SKILL.md': '---\nkeywords: [Prisma]\n---\n# Database\nOld guidance.',
      'backend/database/references/removed.md': '# Old\n\nOld guidance.',
    },
    async (vault, write) => {
      const router = await VaultRetriever.open(vault);
      assert.equal((await router.checkFreshness()).fresh, true);
      const before = await router.search({ query: 'Prisma' });
      const cached = await readFile(router.cachePath, 'utf8');
      const path = 'backend/database/SKILL.md';
      const info = await stat(join(vault, path));
      await write(path, '---\nkeywords: [Kysely]\n---\n# Database\nNew guidance.');
      await utimes(join(vault, path), info.atime, info.mtime);
      await write('backend/database/references/added.md', '# New\n\nNew guidance.');
      await write('.hidden/ignored.md', '# Hidden');
      await rm(join(vault, 'backend/database/references/removed.md'));
      const reopened = await VaultRetriever.open(vault);
      const status = await reopened.checkFreshness();
      assert.equal(status.fresh, false);
      assert.deepEqual(status.added, ['backend/database/references/added.md']);
      assert.deepEqual(status.modified, [path]);
      assert.deepEqual(status.deleted, ['backend/database/references/removed.md']);
      assert.deepEqual(status.snapshot, before.snapshot);
      assert.deepEqual(await reopened.search({ query: 'Prisma' }), before);
      assert.notEqual((await reopened.read({ path })).hash, before.results[0].hash);
      assert.equal(await readFile(router.cachePath, 'utf8'), cached);
      await reopened.build();
      assert.equal((await reopened.checkFreshness()).fresh, true);
      const after = await reopened.search({ query: 'Kysely' });
      assert.equal(after.results[0].hash, (await reopened.read({ path })).hash);
      assert.equal(
        after.results[0].hash,
        (await reopened.read({ path, section: 'Database' })).hash,
      );
      assert.equal(
        after.results[0].hash,
        (await reopened.read({ path, startLine: 1, endLine: 1 })).hash,
      );
      assert.ok(after.snapshot.generatedAt);
    },
  );
});

test('freshness checks respect exclusions and do not parse edited YAML', async () => {
  await withVault(
    {
      'backend/database/SKILL.md': '# Database',
      'backend/database/references/ignored.md': '# Ignored',
    },
    async (vault, write) => {
      const router = await VaultRetriever.open(vault, { exclude: ['**/ignored.md'] });
      await write('backend/database/references/ignored.md', '---\nbroken: [');
      assert.equal((await router.checkFreshness()).fresh, true);
      await write('backend/database/SKILL.md', '---\nbroken: [');
      assert.deepEqual((await router.checkFreshness()).modified, ['backend/database/SKILL.md']);
    },
  );
});

test('legacy caches are rebuilt for the new skill identity format', async () => {
  await withVault({ 'frontend/forms/vue/SKILL.md': '# Vue' }, async (vault) => {
    const router = await VaultRetriever.open(vault);
    const cache = JSON.parse(await readFile(router.cachePath, 'utf8'));
    cache.version = 1;
    cache.documents[0].skill = 'forms';
    await writeFile(router.cachePath, JSON.stringify(cache));
    const reopened = await VaultRetriever.open(vault);
    assert.equal((await reopened.route({ query: 'Vue', skill: 'forms/vue' })).skill, 'forms/vue');
    assert.equal(JSON.parse(await readFile(router.cachePath, 'utf8')).version, 2);
  });
});

test('caches with duplicate skill identities are rebuilt instead of failing open', async () => {
  await withVault(
    { 'frontend/forms/vue/SKILL.md': '# Vue', 'frontend/forms/react/SKILL.md': '# React' },
    async (vault) => {
      const router = await VaultRetriever.open(vault);
      const cache = JSON.parse(await readFile(router.cachePath, 'utf8'));
      cache.documents[1].skill = cache.documents[0].skill;
      await writeFile(router.cachePath, JSON.stringify(cache));
      const reopened = await VaultRetriever.open(vault);
      assert.equal((await reopened.route({ query: 'Vue' })).skill, 'forms/vue');
    },
  );
});

test('CLI status reports freshness and search exposes snapshot and document hashes', async () => {
  await withVault({ 'backend/database/SKILL.md': '# Database' }, async (vault, write) => {
    await VaultRetriever.open(vault);
    const cli = resolve('dist/cli.js');
    const args = [cli, 'status', '--vault', vault];
    const fresh = JSON.parse((await exec(process.execPath, [...args, '--json'])).stdout);
    assert.equal(fresh.fresh, true);
    await write('backend/database/SKILL.md', '# Database\n\nChanged.');
    const stale = JSON.parse((await exec(process.execPath, [...args, '--json'])).stdout);
    assert.equal(stale.fresh, false);
    assert.deepEqual(stale.modified, ['backend/database/SKILL.md']);
    assert.match((await exec(process.execPath, args)).stdout, /stale/);
    const search = JSON.parse(
      (await exec(process.execPath, [cli, 'search', 'database', '--vault', vault, '--json']))
        .stdout,
    );
    assert.equal(search.snapshot.generatedAt, fresh.snapshot.generatedAt);
    assert.match(search.results[0].hash, /^[a-f0-9]{64}$/);
  });
});
