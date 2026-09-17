const stopwords = new Set(
  (
    'a an and are as at be before by can do does for from how i in into is it its ' +
    'of on or our should that the their them these this to using use was we when which with would you your after'
  ).split(' '),
);

/** Keep whole identifiers alongside their component words; do not stem identifiers. */
export function rawTokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}_$]+/gu) ?? [];
}

function splitIdentifier(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_$]/g, ' ');
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

export function tokenize(text: string): string[] {
  return rawTokens(text).flatMap((original) => {
    const whole = original.toLowerCase();
    const parts = rawTokens(splitIdentifier(original)).map((word) => singular(word.toLowerCase()));
    return [...new Set([whole, ...parts])].filter((word) => !stopwords.has(word));
  });
}

export function phrase(text: string): string {
  return rawTokens(splitIdentifier(text)).join(' ').toLowerCase();
}

export function containsPhrase(text: string, value: string): boolean {
  const needle = phrase(value);
  return !!needle && ` ${phrase(text)} `.includes(` ${needle} `);
}

export interface Query {
  text: string;
  terms: Set<string>;
  originals: string[];
}

export function normalizeQuery(text: string): Query {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('query must be a non-empty string');
  }
  return { text: text.trim(), terms: new Set(tokenize(text)), originals: rawTokens(text) };
}
