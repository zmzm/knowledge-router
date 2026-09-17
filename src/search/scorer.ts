import picomatch from 'picomatch';
import type { IndexedDocument, IndexedHeading, SearchReason } from '../types.js';
import { containsPhrase, rawTokens, tokenize, type Query } from './tokenizer.js';

export interface Score {
  score: number;
  metadataScore: number;
  reasons: SearchReason[];
}

export function matchingTerms(text: string, query: Query): string[] {
  return [...new Set(tokenize(text))].filter((term) => query.terms.has(term));
}

export function metadataScore(doc: IndexedDocument, query: Query): Score {
  let score = 0;
  const reasons: SearchReason[] = [];
  const curated = (
    values: string[],
    type: SearchReason['type'],
    weight: number,
    exactOnly = false,
  ) => {
    for (const value of values) {
      const terms = new Set(tokenize(value));
      const hits = [...terms].filter((term) => query.terms.has(term));
      const exact = containsPhrase(query.text, value);
      if (!terms.size || !hits.length || (exactOnly && !exact)) {
        continue;
      }
      score += weight * (exact ? 1.5 : (hits.length / terms.size) ** 2);
      reasons.push({ type, value });
    }
  };
  curated(doc.keywords, 'keyword', 15, true);
  curated(doc.topics, 'topic', 12);
  curated(doc.aliases, 'alias', 10, true);
  // Score title, name, and structural skill name as one field to avoid triple counting.
  const titles = [
    doc.title,
    doc.kind === 'skill' ? doc.name : undefined,
    doc.kind === 'skill' ? doc.skill : undefined,
  ].filter((v): v is string => !!v);
  let titleBest = 0;
  let titleValue = '';
  for (const title of titles) {
    const hits = matchingTerms(title, query);
    const value =
      10 *
      (hits.length / Math.max(1, new Set(tokenize(title)).size)) ** 2 *
      (containsPhrase(query.text, title) ? 1.5 : 1);
    if (value > titleBest) {
      titleBest = value;
      titleValue = title;
    }
  }
  if (titleBest) {
    score += titleBest;
    reasons.push({ type: 'title', value: titleValue });
  }
  if (doc.description) {
    const hits = matchingTerms(doc.description, query);
    score +=
      8 *
      Math.min(3, hits.length / Math.sqrt(Math.max(1, new Set(tokenize(doc.description)).size)));
    if (hits.length) {
      reasons.push({ type: 'description', value: hits.join(', ') });
    }
  }
  return { score, metadataScore: score, reasons };
}

export function scoreText(
  doc: IndexedDocument,
  query: Query,
  lexical: { score: number; matches: string[] },
  section?: IndexedHeading,
): Score {
  const result = metadataScore(doc, query);
  const headingText = section
    ? section.hierarchy.join(' ')
    : doc.headings.map((heading) => heading.title).join(' ');
  const headingHits = matchingTerms(headingText, query);
  if (headingHits.length) {
    result.score +=
      5 *
      Math.min(2, headingHits.length / Math.sqrt(Math.max(1, new Set(tokenize(headingText)).size)));
    result.reasons.push({
      type: 'heading',
      value: section?.hierarchy.join(' > ') || headingHits.join(', '),
    });
  }
  const queryIdentifiers = new Set(query.originals.map((value) => value.toLowerCase()));
  const identifiers = [...new Set(rawTokens(section?.code ?? doc.code))].filter(
    (value) =>
      queryIdentifiers.has(value.toLowerCase()) &&
      (/[a-z][A-Z]|[A-Z]{2}|[_$]/.test(value) ||
        (/^[A-Z]/.test(value) && query.originals.includes(value))) &&
      tokenize(value).length > 0,
  );
  if (identifiers.length) {
    result.score += 4 * Math.min(3, identifiers.length);
    result.reasons.push(...identifiers.map((value) => ({ type: 'identifier' as const, value })));
  }
  if (lexical.score > 0) {
    result.score += (3 * lexical.score) / (lexical.score + 2);
    result.reasons.push({ type: 'fulltext', value: lexical.matches.join(', ') });
  }
  if (
    result.score > 0 &&
    doc.canonical &&
    result.reasons.some((reason) => reason.type === 'topic')
  ) {
    result.score += 2;
    result.reasons.push({ type: 'canonical', value: 'true' });
  }
  if (result.score > 0 && (doc.priority === 'high' || doc.priority === 'low')) {
    result.score *= doc.priority === 'high' ? 1.03 : 0.97;
    result.reasons.push({ type: 'priority', value: doc.priority });
  }
  return result;
}

export function pathScore(doc: IndexedDocument, paths: string[]): SearchReason[] {
  const normalized = paths.map((path) => path.replace(/\\/g, '/').replace(/^\.\//, ''));
  const excluded = doc.pathExcludes.length ? picomatch(doc.pathExcludes) : () => false;
  return doc.pathTriggers
    .filter((pattern) => {
      const matches = picomatch(pattern);
      return normalized.some((path) => !excluded(path) && matches(path));
    })
    .map((value) => ({ type: 'path', value }));
}
