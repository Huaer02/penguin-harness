// Ranking for the knowledge base: BM25 over a lexical index, cosine over stored vectors,
// and reciprocal-rank fusion to combine the two. Tokens are latin/digit runs, with one
// token per CJK character so Chinese queries and documents work without a segmenter.

/** Lexical tokens of a text: lowercase latin/digit runs (underscores kept, so identifiers stay whole) and single CJK characters. */
export function tokenize(text) {
  const lower = String(text).toLowerCase();
  const tokens = [];
  for (const match of lower.matchAll(
    /[a-z0-9_]+|[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g,
  )) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Corpus statistics for BM25, built once per load: document lengths, term document frequencies. */
export function buildIndex(chunks) {
  const docLen = [];
  const postings = new Map(); // term -> Map(chunk position -> term frequency)
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    const tokens = tokenize(chunks[i].text);
    docLen.push(tokens.length);
    total += tokens.length;
    const seen = new Map();
    for (const token of tokens) seen.set(token, (seen.get(token) || 0) + 1);
    for (const [term, tf] of seen) {
      let posting = postings.get(term);
      if (!posting) {
        posting = new Map();
        postings.set(term, posting);
      }
      posting.set(i, tf);
    }
  }
  return {
    n: chunks.length,
    avgdl: chunks.length > 0 ? total / chunks.length : 0,
    docLen,
    postings,
  };
}

/** BM25 (Okapi): the top `limit` chunk positions with their scores. */
export function bm25(index, query, { k1 = 1.2, b = 0.75, limit = 8 } = {}) {
  const scores = new Map();
  for (const term of new Set(tokenize(query))) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const idf = Math.log(1 + (index.n - posting.size + 0.5) / (posting.size + 0.5));
    for (const [i, tf] of posting) {
      const dl = index.docLen[i] || 0;
      const weight = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / (index.avgdl || 1)));
      scores.set(i, (scores.get(i) || 0) + idf * weight);
    }
  }
  return [...scores.entries()]
    .sort((a, z) => z[1] - a[1])
    .slice(0, limit)
    .map(([index_, score]) => ({ index: index_, score }));
}

/** Cosine similarity of two equal-dimension vectors; a zero vector scores 0. */
export function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Reciprocal-rank fusion (Cormack et al., 2009): each list contributes 1/(k + rank) per
 * entry, k = 60. `lexical` and `semantic` share the chunk-position space of one load.
 */
export function rrfFuse(lexical, semantic, { k = 60, limit = 8 } = {}) {
  const scores = new Map();
  const add = (list) => {
    list.forEach((entry, rank) => {
      scores.set(entry.index, (scores.get(entry.index) || 0) + 1 / (k + rank + 1));
    });
  };
  add(lexical);
  add(semantic);
  return [...scores.entries()]
    .sort((a, z) => z[1] - a[1])
    .slice(0, limit)
    .map(([index, score]) => ({ index, score }));
}
