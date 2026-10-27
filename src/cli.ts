#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { VaultRetriever } from './index.js';
import type { RouteResult, SearchResponse } from './types.js';

const help = `Knowledge Router — deterministic Markdown retrieval

Usage:
  knowledge build [vault] [--cache PATH] [--json]
  knowledge status [--vault PATH] [--cache PATH] [--json]
  knowledge route "query" [options]
  knowledge search "query" [options]
  knowledge read relative/path.md [--section "Heading > Child"] [options]

Options:
  --vault PATH          Vault directory (default: KNOWLEDGE_VAULT or cwd)
  --cache PATH          Index path, relative to vault or absolute
  --path PATH           Project path hint (repeatable)
  --domain NAME         Restrict to a domain
  --skill NAME          Select a skill explicitly
  --limit N             Maximum search results (default 5)
  --max-skills N        Include up to 1 or 2 skills with close scores (search only)
  --include-inactive    Include deprecated and archived guidance
  --section TITLE      Read one heading chunk
  --start-line N        Read from this line (1-based, inclusive)
  --end-line N          Read through this line (inclusive)
  --json                Machine-readable output
  --help                Show help

Existing indexes are snapshots. Run build after editing the vault.
Use status to check source hashes for added, modified, or deleted documents.
Search includes guidance content; use --json for structured agent consumption.
`;

function numeric(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return;
  }
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be an integer`);
  }
  return Number(value);
}

function formatRoute(route: RouteResult): string {
  const lines = [
    `Domain: ${route.domain ?? '(unresolved)'}`,
    `Skill: ${route.skill ?? '(unresolved)'}`,
    `Confidence: ${route.confidence} (heuristic, not a probability)`,
  ];
  if (route.reasons.length) {
    lines.push('Matches:', ...route.reasons.map((reason) => `- ${reason.type}: ${reason.value}`));
  }
  if (route.alternatives?.length) {
    lines.push(
      'Alternatives:',
      ...route.alternatives.map(
        (candidate) =>
          `- ${candidate.domain}/${candidate.skill} (confidence: ${candidate.confidence})`,
      ),
    );
  }
  if (!route.skill) {
    lines.push(
      'Refine the query with an operation and technology; add --path for affected project files or --domain/--skill when known.',
    );
  }
  return lines.join('\n');
}

function formatSearch(response: SearchResponse): string {
  const related = response.relatedRoutes?.length
    ? `\nRelated skills: ${response.relatedRoutes.map((route) => `${route.domain}/${route.skill}`).join(', ')}`
    : '';
  return `Snapshot: ${response.snapshot.generatedAt}\n${formatRoute(response.route)}${related}\n\n${
    response.results.length
      ? response.results
          .map(
            (result, i) =>
              `${i + 1}. ${result.path}${result.section ? `\n   section: ${result.section}` : ''}\n   score: ${result.score}` +
              `\n   lines: ${result.startLine}–${result.endLine}\n   matches:\n` +
              result.reasons.map((reason) => `   - ${reason.type}: ${reason.value}`).join('\n') +
              `\n\n${result.content}`,
          )
          .join('\n\n')
      : 'No relevant context found.'
  }`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      vault: { type: 'string' },
      cache: { type: 'string' },
      path: { type: 'string', multiple: true },
      domain: { type: 'string' },
      skill: { type: 'string' },
      limit: { type: 'string' },
      'max-skills': { type: 'string' },
      section: { type: 'string' },
      'start-line': { type: 'string' },
      'end-line': { type: 'string' },
      'include-inactive': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }
  const [command, argument] = positionals;
  if (!['build', 'status', 'route', 'search', 'read'].includes(command!)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (positionals.length > 2) {
    throw new Error('Unexpected arguments; quote the query as one argument');
  }
  if (command === 'status' && argument) {
    throw new Error('status does not accept an argument; use --vault');
  }
  if (command !== 'build' && command !== 'status' && !argument) {
    throw new Error(`${command} requires ${command === 'read' ? 'a path' : 'a query'}`);
  }
  if (command === 'build' && argument && values.vault) {
    throw new Error('Use either a build vault argument or --vault');
  }
  const limit = numeric(values.limit, '--limit');
  const maxSkills = numeric(values['max-skills'], '--max-skills');
  if (values['max-skills'] !== undefined && command !== 'search') {
    throw new Error('--max-skills is only available for search');
  }
  const startLine = numeric(values['start-line'], '--start-line');
  const endLine = numeric(values['end-line'], '--end-line');
  const vault = resolve(
    command === 'build' && argument
      ? argument
      : (values.vault ?? process.env.KNOWLEDGE_VAULT ?? '.'),
  );
  const retriever = await VaultRetriever.open(vault, {
    cachePath: values.cache,
    rebuild: command === 'build',
  });
  if (command === 'build') {
    console.log(
      values.json
        ? JSON.stringify({ vault: retriever.vaultPath, index: retriever.cachePath })
        : `Built ${retriever.cachePath}`,
    );
  } else if (command === 'status') {
    const result = await retriever.checkFreshness();
    console.log(
      values.json
        ? JSON.stringify(result, null, 2)
        : [
            `Index: ${result.fresh ? 'fresh' : 'stale'}`,
            `Snapshot: ${result.snapshot.generatedAt}`,
            ...result.added.map((path) => `Added: ${path}`),
            ...result.modified.map((path) => `Modified: ${path}`),
            ...result.deleted.map((path) => `Deleted: ${path}`),
            ...(result.fresh ? [] : ['Run knowledge build to refresh the snapshot.']),
          ].join('\n'),
    );
  } else if (command === 'read') {
    const result = await retriever.read({
      path: argument!,
      section: values.section,
      startLine,
      endLine,
    });
    console.log(values.json ? JSON.stringify(result, null, 2) : result.content);
  } else {
    const request = {
      query: argument!,
      paths: values.path,
      domain: values.domain,
      skill: values.skill,
      includeInactive: values['include-inactive'],
    };
    if (command === 'route') {
      const result = await retriever.route(request);
      console.log(values.json ? JSON.stringify(result, null, 2) : formatRoute(result));
    } else {
      const result = await retriever.search({ ...request, limit, maxSkills });
      console.log(values.json ? JSON.stringify(result, null, 2) : formatSearch(result));
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    process.argv.includes('--json') ? JSON.stringify({ error: message }) : `knowledge: ${message}`,
  );
  process.exitCode = 1;
});
