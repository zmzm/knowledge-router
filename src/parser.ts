import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parseDocument } from 'yaml';
import type { DocumentKind, IndexedDocument, IndexedHeading } from './types.js';

const kinds = new Set<DocumentKind>(['root', 'domain-index', 'skill', 'reference']);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

/** Heading chunks own only the lines up to the next heading, so results never overlap. */
export function parseMarkdown(content: string): {
  metadata: Record<string, unknown>;
  headings: IndexedHeading[];
  prose: string;
  code: string;
  title?: string;
} {
  const lines = content.split(/\r?\n/);
  let bodyStart = 0;
  let metadata: Record<string, unknown> = {};
  if (lines[0]?.replace(/^\uFEFF/, '').trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0) {
      throw new Error('Unterminated YAML frontmatter');
    }
    const yaml = parseDocument(lines.slice(1, end).join('\n'));
    if (yaml.errors.length) {
      throw new Error(`Invalid YAML: ${yaml.errors[0]!.message}`);
    }
    metadata = record(yaml.toJS({ maxAliasCount: 100 }));
    bodyStart = end + 1;
  }

  const proseLines: string[] = Array(lines.length).fill('');
  const codeLines: string[] = Array(lines.length).fill('');
  const markers: Array<{ title: string; level: number; start: number; headingEnd: number }> = [];
  let fence: { char: string; length: number } | undefined;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        fence = undefined;
      } else {
        codeLines[i] = line;
      }
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1]![0] === '`' && opening[2]!.includes('`'))) {
      fence = { char: opening[1]![0]!, length: opening[1]!.length };
      continue;
    }
    if (/^( {4}|\t)/.test(line)) {
      codeLines[i] = line;
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:\s+(.*?)\s*|\s*)$/);
    const setext = lines[i + 1]?.match(/^ {0,3}(=+|-+)\s*$/);
    if (atx) {
      markers.push({
        title: (atx[2] ?? '').replace(/\s+#+\s*$/, ''),
        level: atx[1]!.length,
        start: i,
        headingEnd: i,
      });
    } else if (line.trim() && setext && !/^\s*[-*>|]/.test(line)) {
      markers.push({
        title: line.trim(),
        level: setext[1]![0] === '=' ? 1 : 2,
        start: i,
        headingEnd: i + 1,
      });
      i++;
    } else {
      proseLines[i] = line;
      // Inline identifiers also remain searchable as code.
      codeLines[i] = [...line.matchAll(/`+([^`]+)`+/g)].map((match) => match[1]).join(' ');
    }
  }

  const headings: IndexedHeading[] = [];
  const hierarchy: Array<{ title: string; level: number }> = [];
  const add = (title: string, level: number, start: number, end: number, headingEnd: number) => {
    while (hierarchy.length && hierarchy.at(-1)!.level >= level) {
      hierarchy.pop();
    }
    if (level) {
      hierarchy.push({ title, level });
    }
    headings.push({
      title,
      level,
      hierarchy: hierarchy.map((item) => item.title),
      content: lines.slice(start, end).join('\n'),
      prose: proseLines
        .slice(headingEnd + 1, end)
        .join('\n')
        .trim(),
      code: codeLines
        .slice(headingEnd + 1, end)
        .join('\n')
        .trim(),
      startLine: start + 1,
      endLine: end,
    });
  };
  const first = markers[0]?.start ?? lines.length;
  if (lines.slice(bodyStart, first).join('\n').trim()) {
    add('Introduction', 0, bodyStart, first, bodyStart - 1);
  }
  markers.forEach((marker, index) =>
    add(
      marker.title,
      marker.level,
      marker.start,
      markers[index + 1]?.start ?? lines.length,
      marker.headingEnd,
    ),
  );
  return {
    metadata,
    headings,
    prose: proseLines.join('\n').trim(),
    code: codeLines.join('\n').trim(),
    title: markers.find((marker) => marker.level === 1)?.title ?? markers[0]?.title,
  };
}

export function indexDocument(
  path: string,
  content: string,
  modifiedAt = 0,
  size = Buffer.byteLength(content),
): IndexedDocument {
  const parsed = parseMarkdown(content);
  const meta = parsed.metadata;
  const parts = path.split('/');
  const filename = posix.basename(path).toLowerCase();
  const inferred: DocumentKind =
    parts.length === 1
      ? 'root'
      : parts.length === 2 && filename === 'index.md'
        ? 'domain-index'
        : filename === 'skill.md'
          ? 'skill'
          : 'reference';
  const kind = kinds.has(meta.kind as DocumentKind) ? (meta.kind as DocumentKind) : inferred;
  const triggers = record(meta.triggers);
  const referenceDirectory = parts.indexOf('references', 2);
  const skill =
    kind === 'skill'
      ? parts.slice(1, -1).join('/') || undefined
      : referenceDirectory >= 0
        ? parts.slice(1, referenceDirectory).join('/')
        : parts.length > 2
          ? parts[1]
          : undefined;
  return {
    id: string(meta.id) ?? path,
    path,
    kind,
    domain: string(meta.domain) ?? (parts.length > 1 ? parts[0] : undefined),
    skill: string(meta.skill) ?? skill,
    title: parsed.title ?? string(meta.name) ?? posix.basename(path, '.md'),
    name: string(meta.name),
    description: string(meta.description),
    topics: strings(meta.topics),
    aliases: strings(meta.aliases),
    keywords: [...strings(meta.keywords), ...strings(triggers.keywords)],
    pathTriggers: strings(triggers.paths),
    pathExcludes: strings(triggers.excludes),
    headings: parsed.headings,
    prose: parsed.prose,
    code: parsed.code,
    content,
    priority: string(meta.priority),
    status: string(meta.status)?.toLowerCase(),
    canonical: typeof meta.canonical === 'boolean' ? meta.canonical : undefined,
    modifiedAt,
    size,
    hash: createHash('sha256').update(content).digest('hex'),
  };
}
