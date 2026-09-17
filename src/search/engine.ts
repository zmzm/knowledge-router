import type {
  IndexedDocument,
  IndexedHeading,
  RouteRequest,
  RouteResult,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from '../types.js';
import { compareText } from '../storage.js';
import { BM25 } from './bm25.js';
import { containsPhrase, normalizeQuery, tokenize } from './tokenizer.js';
import { matchingTerms, metadataScore, pathScore, scoreText, type Score } from './scorer.js';

interface Candidate extends Score {
  doc: IndexedDocument;
}
interface Section {
  doc: IndexedDocument;
  heading: IndexedHeading;
}
const inactive = (doc: IndexedDocument): boolean =>
  doc.status === 'deprecated' || doc.status === 'archived';
const order = (a: Candidate, b: Candidate): number =>
  b.score - a.score || compareText(a.doc.path, b.doc.path);
const round = (value: number): number => Math.round(value * 1000) / 1000;

export class SearchEngine {
  private readonly documents: IndexedDocument[];
  private readonly corpus: BM25;
  private readonly sections: Section[];
  private readonly sectionCorpus: BM25;
  private readonly inactiveSkills: Set<string>;

  constructor(
    documents: IndexedDocument[],
    private readonly maxSections: number,
  ) {
    this.documents = [...documents].sort((a, b) => compareText(a.path, b.path));
    this.inactiveSkills = new Set(
      documents
        .filter((doc) => doc.kind === 'skill' && inactive(doc))
        .map((doc) => `${doc.domain}/${doc.skill}`),
    );
    this.corpus = new BM25(this.documents.map((doc) => `${doc.prose}\n${doc.code}`));
    this.sections = this.documents
      .filter((doc) => doc.kind === 'reference')
      .flatMap((doc) =>
        doc.headings
          .filter((heading) => heading.prose.trim() || heading.code.trim())
          .map((heading) => ({ doc, heading })),
      );
    this.sectionCorpus = new BM25(
      this.sections.map(({ heading }) => `${heading.prose}\n${heading.code}`),
    );
  }

  private eligible(doc: IndexedDocument, request: RouteRequest): boolean {
    if (request.domain && doc.domain !== request.domain) {
      return false;
    }
    if (request.includeInactive) {
      return true;
    }
    if (inactive(doc)) {
      return false;
    }
    return !this.inactiveSkills.has(`${doc.domain}/${doc.skill}`);
  }

  private candidates(request: RouteRequest): Candidate[] {
    const query = normalizeQuery(request.query);
    if (
      request.paths &&
      (!Array.isArray(request.paths) || request.paths.some((path) => typeof path !== 'string'))
    ) {
      throw new Error('paths must be an array of strings');
    }
    if (request.domain && !this.documents.some((doc) => doc.domain === request.domain)) {
      throw new Error(`Unknown domain: ${request.domain}`);
    }
    const referenceEvidence = new Map<string, Score>();
    for (const doc of this.documents) {
      if (doc.kind !== 'reference' || !this.eligible(doc, request)) {
        continue;
      }
      const evidence = metadataScore(doc, query);
      const key = `${doc.domain}/${doc.skill}`;
      if (evidence.score > (referenceEvidence.get(key)?.score ?? 0)) {
        referenceEvidence.set(key, evidence);
      }
    }
    const candidates: Candidate[] = [];
    this.documents.forEach((doc, index) => {
      if (doc.kind !== 'skill' || !this.eligible(doc, request)) {
        return;
      }
      if (request.skill && doc.skill !== request.skill && doc.name !== request.skill) {
        return;
      }
      const lexical = this.corpus.score(index, query.terms);
      const scored = scoreText(doc, query, lexical);
      const support = referenceEvidence.get(`${doc.domain}/${doc.skill}`);
      if (support && support.score > 0) {
        scored.score += Math.min(12, support.score * 0.4);
        scored.metadataScore += Math.min(12, support.metadataScore * 0.4);
        scored.reasons.push(
          ...support.reasons.map((reason) => ({
            ...reason,
            value: `${reason.value} (reference metadata)`,
          })),
        );
      }
      // Query evidence is required before adding path signals.
      if (
        !request.skill &&
        (scored.score < 5 || (scored.metadataScore < 3 && lexical.matches.length < 2))
      ) {
        return;
      }
      const paths = pathScore(doc, request.paths ?? []);
      if (paths.length) {
        scored.score += 8;
        scored.reasons.push(...paths);
      }
      if (request.skill) {
        scored.reasons.push({ type: 'explicit', value: `skill: ${request.skill}` });
      }
      if (request.domain) {
        scored.reasons.push({ type: 'explicit', value: `domain: ${request.domain}` });
      }
      candidates.push({ ...scored, doc });
    });
    if (request.skill && !candidates.length) {
      throw new Error(`Unknown or excluded skill: ${request.skill}`);
    }
    if (request.skill && !request.domain && candidates.length > 1) {
      throw new Error(`Skill ${request.skill} exists in multiple domains; provide domain`);
    }

    // Domain evidence is the strongest skill, with a small contribution from its index.
    // Summing all skills would unfairly favor domains containing more files.
    const domains = new Map<string | undefined, number>();
    for (const candidate of candidates) {
      domains.set(
        candidate.doc.domain,
        Math.max(domains.get(candidate.doc.domain) ?? 0, candidate.score),
      );
    }
    for (const doc of this.documents) {
      if (doc.kind !== 'domain-index' || !this.eligible(doc, request) || !domains.has(doc.domain)) {
        continue;
      }
      const signal = metadataScore(doc, query).score;
      domains.set(doc.domain, domains.get(doc.domain)! + Math.min(3, signal * 0.1));
    }
    const domain = [...domains].sort(
      (a, b) => b[1] - a[1] || compareText(a[0] ?? '', b[0] ?? ''),
    )[0]?.[0];
    candidates.sort(order);
    const primary = candidates.findIndex((candidate) => candidate.doc.domain === domain);
    if (primary > 0) {
      candidates.unshift(...candidates.splice(primary, 1));
    }
    return candidates;
  }

  route(request: RouteRequest): RouteResult {
    return this.routeResult(request, this.candidates(request));
  }

  private routeResult(request: RouteRequest, candidates: Candidate[]): RouteResult {
    const best = candidates[0];
    if (!best) {
      return {
        domain: request.domain,
        confidence: 0,
        reasons: request.domain ? [{ type: 'explicit', value: `domain: ${request.domain}` }] : [],
      };
    }
    const second = Math.max(0, ...candidates.slice(1).map((candidate) => candidate.score));
    const confidence = (score: number, competitor: number) =>
      round(
        Math.min(
          0.98,
          (score / (score + 15)) *
            (0.65 + (0.35 * Math.max(0, score - competitor)) / Math.max(score, 1)),
        ),
      );
    return {
      domain: best.doc.domain,
      skill: best.doc.skill,
      confidence: request.skill ? 1 : confidence(best.score, second),
      reasons: best.reasons,
      alternatives: candidates.slice(1, 4).map((candidate) => ({
        domain: candidate.doc.domain,
        skill: candidate.doc.skill,
        confidence: confidence(candidate.score, best.score),
      })),
    };
  }

  search(request: SearchRequest): SearchResponse {
    const limit = request.limit ?? 5;
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('limit must be a non-negative integer');
    }
    const candidates = this.candidates(request);
    const route = this.routeResult(request, candidates);
    if (!limit) {
      return { route, results: [] };
    }
    const query = normalizeQuery(request.query);
    const results: SearchResult[] = [];
    const primary = this.documents.find(
      (doc) =>
        doc.kind === 'skill' &&
        route.skill &&
        doc.domain === route.domain &&
        doc.skill === route.skill &&
        this.eligible(doc, request),
    );
    if (primary) {
      const candidate = candidates.find((item) => item.doc === primary)!;
      results.push(this.result(primary, candidate));
    }
    const references: SearchResult[] = [];
    this.sections.forEach(({ doc, heading }, index) => {
      if (
        !primary ||
        doc.domain !== primary.domain ||
        doc.skill !== primary.skill ||
        !this.eligible(doc, request)
      ) {
        return;
      }
      // A reference must physically belong to the primary skill's references subtree.
      const referenceRoot = `${primary.path.slice(0, primary.path.lastIndexOf('/'))}/references/`;
      if (!doc.path.startsWith(referenceRoot)) {
        return;
      }
      const localMatches = matchingTerms(
        `${heading.title} ${heading.prose} ${heading.code}`,
        query,
      );
      if (!localMatches.length) {
        return;
      }
      const scored = scoreText(doc, query, this.sectionCorpus.score(index, query.terms), heading);
      if (scored.score < 5) {
        return;
      }
      references.push(this.result(doc, scored, heading));
    });
    references.sort(
      (a, b) => b.score - a.score || compareText(a.path, b.path) || a.startLine - b.startLine,
    );
    results.push(...references.slice(0, Math.min(this.maxSections, limit - results.length)));

    // Generic root bodies cannot flood a routed result. Require an explicit title or curated phrase.
    const roots: SearchResult[] = [];
    this.documents.forEach((doc, index) => {
      if (doc.kind !== 'root' || (!request.includeInactive && inactive(doc))) {
        return;
      }
      const named = [
        doc.path,
        doc.title ?? '',
        doc.name ?? '',
        ...doc.topics,
        ...doc.aliases,
        ...doc.keywords,
      ].some((value) => tokenizeNonempty(value) && containsPhrase(query.text, value));
      if (!named) {
        return;
      }
      const score = scoreText(doc, query, this.corpus.score(index, query.terms));
      if (containsPhrase(query.text, doc.path)) {
        score.score += 15;
        score.reasons.push({ type: 'explicit', value: doc.path });
      }
      if (score.score >= 10) {
        roots.push(this.result(doc, score));
      }
    });
    roots.sort((a, b) => b.score - a.score || compareText(a.path, b.path));
    if (roots[0] && results.length < limit) {
      results.push(roots[0]);
    }
    return { route, results };
  }

  private result(doc: IndexedDocument, score: Score, heading?: IndexedHeading): SearchResult {
    return {
      path: doc.path,
      kind: doc.kind,
      domain: doc.domain,
      skill: doc.skill,
      section: heading ? heading.hierarchy.join(' > ') || heading.title : undefined,
      score: round(score.score),
      content: heading?.content ?? doc.content,
      startLine: heading?.startLine ?? 1,
      endLine: heading?.endLine ?? doc.content.split(/\r?\n/).length,
      reasons: score.reasons,
    };
  }
}

function tokenizeNonempty(value: string): boolean {
  return tokenize(value).length > 0;
}
