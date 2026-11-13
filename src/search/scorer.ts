import picomatch from 'picomatch';
import type { IndexedDocument, IndexedHeading, SearchReason } from '../types.js';
import { containsPhrase, phrase, rawTokens, tokenize, type Query } from './tokenizer.js';

export interface Score {
  score: number;
  metadataScore: number;
  reasons: SearchReason[];
}

export function matchingTerms(text: string, query: Query): string[] {
  return [...new Set(tokenize(text))].filter((term) => query.terms.has(term));
}

/** Require two distinct query words and coverage of at least 75% of non-stopwords. */
export function strongTextMatch(matches: string[], query: Query): boolean {
  const words = new Map<string, string[]>();
  for (const original of query.originals) {
    const terms = [...new Set(tokenize(original))].sort();
    if (terms.length) {
      words.set(terms.join(' '), terms);
    }
  }
  const matched = new Set(matches);
  const hits = [...words.values()].filter((terms) => terms.some((term) => matched.has(term)));
  return hits.length >= 2 && hits.length / words.size >= 0.75;
}

// These words describe almost any coding task. Keep them searchable in content and
// curated phrases, but do not let an incidental description match establish scope.
const genericDescriptionTerms = new Set([
  'user',
  'users',
  'data',
  'rule',
  'rules',
  'feature',
  'features',
  'pattern',
  'patterns',
  'convention',
  'conventions',
  'guidance',
  'code',
]);
const structuralHeading =
  /^(when (not )?to use( this knowledge)?|rules|local rules|knowledge map|maintenance notes|boundary with other skills|what this skill covers|fast decision hints)$/i;

export function metadataScore(doc: IndexedDocument, query: Query): Score {
  let score = 0;
  const reasons: SearchReason[] = [];
  const phrases = new Map<string, { score: number; reason: SearchReason }>();
  const curated = (
    values: string[],
    type: SearchReason['type'],
    weight: number,
    exactOnly = false,
  ) => {
    for (const value of values) {
      const terms = new Set(tokenize(phrase(value)));
      const hits = [...terms].filter((term) => query.terms.has(term));
      const exact = curatedPhraseMatch(query.text, value);
      if (!terms.size || !hits.length || (exactOnly && !exact)) {
        continue;
      }
      const key = syntaxBearing(value) ? value.toLowerCase().replace(/\s+/g, '') : phrase(value);
      const contribution = weight * (exact ? 1.5 : (hits.length / terms.size) ** 2);
      const existing = phrases.get(key);
      if (
        !existing ||
        contribution > existing.score ||
        (contribution === existing.score && value < existing.reason.value)
      ) {
        phrases.set(key, { score: contribution, reason: { type, value } });
      }
    }
  };
  curated(doc.keywords, 'keyword', 15, true);
  curated(doc.topics, 'topic', 12);
  curated(doc.aliases, 'alias', 10, true);
  // A phrase counts once across curated fields. Each field contributes its strongest three.
  for (const type of ['keyword', 'topic', 'alias']) {
    const strongest = [...phrases.entries()]
      .filter(([, item]) => item.reason.type === type)
      .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, 3);
    for (const [, item] of strongest) {
      score += item.score;
      reasons.push(item.reason);
    }
  }
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
    const hits = matchingTerms(doc.description, query).filter(
      (term) => !genericDescriptionTerms.has(term),
    );
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
  if (section) {
    // Document metadata supplies context, but cannot dominate local section evidence.
    result.score = Math.min(18, result.score * 0.75);
    result.metadataScore = result.score;
  }
  const headingText = section
    ? section.hierarchy.join(' ')
    : doc.headings
        .filter((heading) => !structuralHeading.test(heading.title))
        .map((heading) => heading.title)
        .join(' ');
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
      (!/^[A-Z][A-Z_]+$/.test(value) || query.originals.includes(value)) &&
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
    doc.topics.some((topic) => matchingTerms(topic, query).length > 0)
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

function syntaxBearing(value: string): boolean {
  return /[=()[\]{}<>*]|[-.:]$/.test(value.trim());
}

function curatedPhraseMatch(text: string, value: string): boolean {
  if (!syntaxBearing(value)) {
    return containsPhrase(text, value);
  }
  const parts = value.match(/[\p{L}\p{N}_$]+|[^\s]/gu) ?? [];
  const pattern = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const end = /[\p{L}\p{N}_$]$/u.test(value.trim()) ? '(?![\\p{L}\\p{N}_$])' : '';
  return !!pattern && new RegExp(`(?<![\\p{L}\\p{N}_$])${pattern}${end}`, 'iu').test(text);
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
