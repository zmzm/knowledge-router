import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMarkdown } from './parser.js';
import { buildIndex, loadIndex, safePath, saveIndex } from './storage.js';
import { SearchEngine } from './search/engine.js';
import type {
  ReadRequest,
  ReadResponse,
  RetrieverOptions,
  RouteRequest,
  RouteResult,
  SearchRequest,
  SearchResponse,
} from './types.js';

export type * from './types.js';

export class VaultRetriever {
  private engine?: SearchEngine;
  private building?: Promise<void>;
  private constructor(
    readonly vaultPath: string,
    private readonly options: RetrieverOptions,
    readonly cachePath: string,
  ) {}

  static async open(vaultPath: string, options: RetrieverOptions = {}): Promise<VaultRetriever> {
    const absolute = await realpath(resolve(vaultPath));
    if (!(await stat(absolute)).isDirectory()) {
      throw new Error('vaultPath must be a directory');
    }
    const max = options.maxReferenceSections ?? 3;
    if (!Number.isInteger(max) || max < 0) {
      throw new Error('maxReferenceSections must be a non-negative integer');
    }
    const copied = {
      ...options,
      domains: options.domains && [...options.domains],
      exclude: options.exclude && [...options.exclude],
    };
    const retriever = new VaultRetriever(
      absolute,
      copied,
      resolve(absolute, options.cachePath ?? '.knowledge/index.json'),
    );
    if (/\.md$/i.test(retriever.cachePath)) {
      throw new Error('cachePath cannot overwrite a Markdown source file');
    }
    const index = options.rebuild
      ? undefined
      : await loadIndex(retriever.cachePath, absolute, copied);
    if (index) {
      retriever.engine = new SearchEngine(index.documents, max);
    } else {
      await retriever.build();
    }
    return retriever;
  }

  /** Explicit full rebuild: handles added, modified, and deleted files. */
  async build(): Promise<void> {
    if (this.building) {
      return this.building;
    }
    this.building = (async () => {
      const index = await buildIndex(this.vaultPath, this.options);
      const engine = new SearchEngine(index.documents, this.options.maxReferenceSections ?? 3);
      await saveIndex(this.cachePath, index);
      this.engine = engine;
    })();
    try {
      await this.building;
    } finally {
      this.building = undefined;
    }
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    return this.engine!.route(request);
  }
  async search(request: SearchRequest): Promise<SearchResponse> {
    return this.engine!.search(request);
  }

  /** Read current source files, not the cached snapshot. Lines are 1-based and inclusive. */
  async read(request: ReadRequest): Promise<ReadResponse> {
    if (
      request.section !== undefined &&
      (request.startLine !== undefined || request.endLine !== undefined)
    ) {
      throw new Error('Specify a section or a line range, not both');
    }
    const absolute = await safePath(this.vaultPath, request.path);
    if (!/\.md$/i.test(request.path)) {
      throw new Error('Only Markdown files can be read');
    }
    const content = await readFile(absolute, 'utf8');
    const lines = content.split(/\r?\n/);
    if (request.section !== undefined) {
      const headings = parseMarkdown(content).headings;
      const matches = headings.filter(
        (heading) =>
          heading.title === request.section ||
          (heading.hierarchy.join(' > ') || heading.title) === request.section,
      );
      if (!matches.length) {
        throw new Error(`Section not found: ${request.section}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `Ambiguous section: ${request.section}; use a full hierarchy or line range`,
        );
      }
      const heading = matches[0]!;
      return {
        path: request.path,
        section: heading.hierarchy.join(' > ') || heading.title,
        content: heading.content,
        startLine: heading.startLine,
        endLine: heading.endLine,
      };
    }
    const startLine = request.startLine ?? 1;
    const endLine = request.endLine ?? lines.length;
    if (
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine > lines.length
    ) {
      throw new Error(`Invalid line range; document has ${lines.length} lines`);
    }
    return {
      path: request.path,
      content:
        request.startLine === undefined && request.endLine === undefined
          ? content
          : lines.slice(startLine - 1, endLine).join('\n'),
      startLine,
      endLine,
    };
  }
}
