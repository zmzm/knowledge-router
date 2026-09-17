#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { VaultRetriever } from './index.js';
import type { RouteResult, SearchResponse } from './types.js';

const help = `Knowledge Router — deterministic Markdown retrieval

Usage:
  knowledge build [vault] [--cache PATH] [--json]
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
  --include-inactive    Include deprecated and archived guidance
  --section TITLE      Read one heading chunk
  --start-line N        Read from this line (1-based, inclusive)
  --end-line N          Read through this line (inclusive)
  --json                Machine-readable output
  --help                Show help

Existing indexes are snapshots. Run build after editing the vault.
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
  return `Domain: ${route.domain ?? '(unresolved)'}\nSkill: ${route.skill ?? '(unresolved)'}\nConfidence: ${route.confidence}`;
}

function formatSearch(response: SearchResponse): string {
  return `${formatRoute(response.route)}\n\n${
    response.results.length
      ? response.results
          .map(
            (result, i) =>
              `${i + 1}. ${result.path}${result.section ? `\n   section: ${result.section}` : ''}\n   score: ${result.score}` +
              `\n   lines: ${result.startLine}–${result.endLine}\n   matches:\n` +
              result.reasons.map((reason) => `   - ${reason.type}: ${reason.value}`).join('\n'),
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
  if (!['build', 'route', 'search', 'read'].includes(command!)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (positionals.length > 2) {
    throw new Error('Unexpected arguments; quote the query as one argument');
  }
  if (command !== 'build' && !argument) {
    throw new Error(`${command} requires ${command === 'read' ? 'a path' : 'a query'}`);
  }
  if (command === 'build' && argument && values.vault) {
    throw new Error('Use either a build vault argument or --vault');
  }
  const limit = numeric(values.limit, '--limit');
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
      const result = await retriever.search({ ...request, limit });
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
