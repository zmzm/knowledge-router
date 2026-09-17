import { tokenize } from './tokenizer.js';

/** Small in-memory BM25 corpus, built once and reused by an open retriever. */
export class BM25 {
  private readonly frequencies: Map<string, number>[];
  private readonly lengths: number[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(texts: string[]) {
    this.frequencies = texts.map((text) => {
      const counts = new Map<string, number>();
      for (const term of tokenize(text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
      for (const term of counts.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      return counts;
    });
    this.lengths = this.frequencies.map((counts) =>
      [...counts.values()].reduce((sum, count) => sum + count, 0),
    );
    this.averageLength =
      this.lengths.reduce((sum, length) => sum + length, 0) / (texts.length || 1) || 1;
  }

  score(index: number, terms: Set<string>): { score: number; matches: string[] } {
    const counts = this.frequencies[index];
    if (!counts) {
      return { score: 0, matches: [] };
    }
    let score = 0;
    const matches: string[] = [];
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) {
        continue;
      }
      const df = this.documentFrequency.get(term)!;
      const idf = Math.log(1 + (this.frequencies.length - df + 0.5) / (df + 0.5));
      score +=
        (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * this.lengths[index]!) / this.averageLength));
      matches.push(term);
    }
    return { score, matches };
  }
}
