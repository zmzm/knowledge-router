import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import picomatch from 'picomatch';
import { indexDocument } from './parser.js';
import type { FreshnessResult, RetrieverOptions, VaultIndex } from './types.js';

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const configKey = (options: RetrieverOptions): string =>
  JSON.stringify({
    domains: options.domains ? [...options.domains].sort(compareText) : null,
    exclude: [...(options.exclude ?? [])].sort(compareText),
  });

export async function discover(vaultPath: string, options: RetrieverOptions): Promise<string[]> {
  const files: string[] = [];
  const excluded = options.exclude?.length
    ? picomatch(options.exclude, { dot: true })
    : () => false;
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(resolve(vaultPath, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'templates'
      ) {
        continue;
      }
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (excluded(path) || excluded(`${path}/`)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        files.push(path);
      }
      // Do not follow symlinks: discovery stays inside the supplied vault.
    }
  }
  await walk('');
  const domains = new Set(
    options.domains ??
      files.flatMap((path) => {
        const parts = path.split('/');
        return (parts.length === 2 && /^index\.md$/i.test(parts[1]!)) ||
          (parts.length >= 3 && /^skill\.md$/i.test(parts.at(-1)!))
          ? [parts[0]!]
          : [];
      }),
  );
  return files.filter((path) => !path.includes('/') || domains.has(path.split('/')[0]!));
}

export async function buildIndex(
  vaultPath: string,
  options: RetrieverOptions,
): Promise<VaultIndex> {
  const documents = [];
  for (const path of await discover(vaultPath, options)) {
    try {
      const absolute = await safePath(vaultPath, path);
      const content = await readFile(absolute, 'utf8');
      const info = await stat(absolute);
      documents.push(indexDocument(path, content, info.mtimeMs, info.size));
    } catch (error) {
      throw new Error(`Cannot index ${path}: ${(error as Error).message}`, { cause: error });
    }
  }
  return {
    version: 2,
    vaultPath,
    configKey: configKey(options),
    generatedAt: new Date().toISOString(),
    documents,
  };
}

/** Treat cache contents as an optimization, never as trusted paths or executable data. */
export async function loadIndex(
  path: string,
  vaultPath: string,
  options: RetrieverOptions,
): Promise<VaultIndex | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object') {
      return;
    }
    const index = value as VaultIndex;
    if (
      index.version !== 2 ||
      index.vaultPath !== vaultPath ||
      index.configKey !== configKey(options) ||
      typeof index.generatedAt !== 'string' ||
      !Number.isFinite(Date.parse(index.generatedAt)) ||
      !Array.isArray(index.documents)
    ) {
      return;
    }
    // Validate the fields consumed by retrieval; malformed/old caches are rebuilt.
    const paths = new Set<string>();
    const skills = new Set<string>();
    for (const doc of index.documents) {
      if (
        !doc ||
        typeof doc.path !== 'string' ||
        !isRelativePath(doc.path) ||
        !['root', 'domain-index', 'skill', 'reference'].includes(doc.kind) ||
        !['content', 'prose', 'code', 'hash', 'id'].every(
          (key) => typeof (doc as unknown as Record<string, unknown>)[key] === 'string',
        ) ||
        !['domain', 'skill', 'title', 'name', 'description', 'priority', 'status'].every((key) => {
          const field = (doc as unknown as Record<string, unknown>)[key];
          return field === undefined || typeof field === 'string';
        }) ||
        (doc.frameworks !== undefined &&
          (!Array.isArray(doc.frameworks) ||
            !doc.frameworks.every((item) => typeof item === 'string'))) ||
        (doc.canonical !== undefined && typeof doc.canonical !== 'boolean') ||
        !Number.isFinite(doc.modifiedAt) ||
        !Number.isFinite(doc.size) ||
        !['topics', 'aliases', 'keywords', 'pathTriggers', 'pathExcludes'].every((key) => {
          const list = (doc as unknown as Record<string, unknown>)[key];
          return Array.isArray(list) && list.every((item) => typeof item === 'string');
        }) ||
        !Array.isArray(doc.headings) ||
        !doc.headings.every(
          (heading) =>
            heading &&
            typeof heading.title === 'string' &&
            typeof heading.content === 'string' &&
            typeof heading.prose === 'string' &&
            typeof heading.code === 'string' &&
            Array.isArray(heading.hierarchy) &&
            heading.hierarchy.every((item) => typeof item === 'string') &&
            Number.isInteger(heading.level) &&
            heading.level >= 0 &&
            heading.level <= 6 &&
            Number.isInteger(heading.startLine) &&
            heading.startLine >= 1 &&
            Number.isInteger(heading.endLine) &&
            heading.endLine >= heading.startLine,
        )
      ) {
        return;
      }
      if (paths.has(doc.path)) {
        return;
      }
      paths.add(doc.path);
      if (doc.kind === 'skill') {
        const key = `${doc.domain}/${doc.skill}`;
        if (skills.has(key)) {
          return;
        }
        skills.add(key);
      }
    }
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      return;
    }
    throw error;
  }
}

/** Compare source hashes against this snapshot without parsing YAML or rewriting the cache. */
export async function checkIndexFreshness(
  vaultPath: string,
  options: RetrieverOptions,
  index: VaultIndex,
): Promise<FreshnessResult> {
  const files = await discover(vaultPath, options);
  const current = new Set(files);
  const indexed = new Map(index.documents.map((doc) => [doc.path, doc]));
  const added = files.filter((path) => !indexed.has(path)).sort(compareText);
  const deleted = index.documents
    .filter((doc) => !current.has(doc.path))
    .map((doc) => doc.path)
    .sort(compareText);
  const modified: string[] = [];
  for (const path of files) {
    const doc = indexed.get(path);
    if (!doc) {
      continue;
    }
    const content = await readFile(await safePath(vaultPath, path), 'utf8');
    if (createHash('sha256').update(content).digest('hex') !== doc.hash) {
      modified.push(path);
    }
  }
  return {
    snapshot: { version: index.version, generatedAt: index.generatedAt },
    fresh: !added.length && !modified.length && !deleted.length,
    added,
    modified: modified.sort(compareText),
    deleted,
  };
}

export async function saveIndex(path: string, index: VaultIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(index), { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}

function isRelativePath(path: string): boolean {
  return (
    !!path &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => part === '..' || part === '.')
  );
}

export async function safePath(vaultPath: string, path: string): Promise<string> {
  if (!isRelativePath(path)) {
    throw new Error('Path must be relative to the vault and cannot contain traversal');
  }
  const absolute = await realpath(resolve(vaultPath, path));
  const inside = relative(vaultPath, absolute);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Path escapes the vault');
  }
  return absolute;
}
