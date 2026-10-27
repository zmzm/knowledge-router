export type DocumentKind = 'root' | 'domain-index' | 'skill' | 'reference';

export interface IndexedHeading {
  title: string;
  level: number;
  hierarchy: string[];
  content: string;
  prose: string;
  code: string;
  startLine: number;
  endLine: number;
}

export interface IndexedDocument {
  id: string;
  kind: DocumentKind;
  path: string;
  domain?: string;
  skill?: string;
  title?: string;
  name?: string;
  description?: string;
  topics: string[];
  aliases: string[];
  keywords: string[];
  pathTriggers: string[];
  pathExcludes: string[];
  headings: IndexedHeading[];
  prose: string;
  code: string;
  content: string;
  priority?: string;
  canonical?: boolean;
  status?: string;
  modifiedAt: number;
  size: number;
  hash: string;
}

export interface SearchReason {
  type:
    | 'keyword'
    | 'topic'
    | 'alias'
    | 'title'
    | 'description'
    | 'heading'
    | 'path'
    | 'domain'
    | 'identifier'
    | 'fulltext'
    | 'fallback'
    | 'related'
    | 'canonical'
    | 'priority'
    | 'explicit';
  value: string;
}

export interface RouteRequest {
  query: string;
  paths?: string[];
  domain?: string;
  skill?: string;
  includeInactive?: boolean;
}

export interface RouteCandidate {
  domain?: string;
  skill?: string;
  confidence: number;
}

export interface RouteResult extends RouteCandidate {
  alternatives?: RouteCandidate[];
  reasons: SearchReason[];
}

export interface SearchRequest extends RouteRequest {
  limit?: number;
  /** Include at most two skills when their scores are close. Default 1. */
  maxSkills?: number;
}

export interface SearchResult {
  path: string;
  kind: DocumentKind;
  domain?: string;
  skill?: string;
  section?: string;
  score: number;
  content: string;
  /** SHA-256 of the complete source document in the indexed snapshot. */
  hash: string;
  startLine: number;
  endLine: number;
  reasons: SearchReason[];
}

export interface SearchResponse {
  snapshot: IndexSnapshot;
  route: RouteResult;
  /** Additional skills actually included in results, when maxSkills is 2. */
  relatedRoutes?: RouteResult[];
  results: SearchResult[];
}

export interface IndexSnapshot {
  version: 2;
  generatedAt: string;
}

export interface FreshnessResult {
  snapshot: IndexSnapshot;
  fresh: boolean;
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface ReadRequest {
  path: string;
  section?: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadResponse {
  path: string;
  section?: string;
  content: string;
  /** SHA-256 of the complete current source document, including for section reads. */
  hash: string;
  startLine: number;
  endLine: number;
}

export interface RetrieverOptions {
  /** Absolute path, or relative to the vault. Defaults to .knowledge/index.json. */
  cachePath?: string;
  /** Restrict discovery; otherwise infer domains from INDEX.md and SKILL.md paths. */
  domains?: string[];
  /** Additional POSIX-style glob patterns to exclude from discovery. */
  exclude?: string[];
  maxReferenceSections?: number;
  /** Rebuild on open even when a reusable cache exists. */
  rebuild?: boolean;
}

export interface VaultIndex extends IndexSnapshot {
  vaultPath: string;
  configKey: string;
  documents: IndexedDocument[];
}
