/**
 * BM25 index for Document RAG — pure JS, zero deps.
 *
 * BM25Okapi over the indexed chunks. Used for lexical (keyword-matching)
 * retrieval in a hybrid pipeline.
 *
 * Index is lazily built from the chunks array on first search after any
 * document_add/document_clear.
 */

/* ─── constants ─────────────────────────────────────────────────────── */
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/* ─── BM25Index class ───────────────────────────────────────────────── */
export class BM25Index {
  constructor(chunkList) {
    this.docs = [];
    this.docFreq = new Map();   // term → doc count
    this.avgdl = 0;
    this.totalLen = 0;
    this._build(chunkList);
  }

  _tokenize(text) {
    if (!text) { return []; }
    const t = String(text).toLowerCase();
    // CJK chars → individual tokens; words → whole word tokens.
    const out = [];
    // Words first (keep runs of letters/digits/underscore)
    const wordRe = /[\p{L}\p{N}_-]+/gu;
    let match;
    while ((match = wordRe.exec(t)) !== null) {
      if (match[0].length >= 2) { out.push(match[0]); }
    }
    // CJK chars as individual tokens (bigrams would be better for recall,
    // but unigrams are fine for ranking and cheap to compute).
    for (const ch of t) {
      if (/[\u4e00-\u9fff]/.test(ch)) { out.push(ch); }
    }
    return out;
  }

  _build(chunkList) {
    for (let i = 0; i < chunkList.length; i++) {
      const tokens = this._tokenize(chunkList[i].text || '');
      const freq = new Map();
      for (const tok of tokens) {
        freq.set(tok, (freq.get(tok) || 0) + 1);
      }
      this.docs.push({ tokens: freq, length: tokens.length });
      this.totalLen += tokens.length;
      for (const [t] of freq) {
        this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1);
      }
    }
    this.avgdl = this.docs.length > 0 ? this.totalLen / this.docs.length : 0;
  }

  score(query, docIndex) {
    const queryTokens = this._tokenize(query);
    if (queryTokens.length === 0) { return 0; }
    const doc = this.docs[docIndex];
    if (!doc) { return 0; }
    const N = this.docs.length;
    let score = 0;
    for (const qt of queryTokens) {
      const f = doc.tokens.get(qt) || 0;
      if (f === 0) { continue; }
      const df = this.docFreq.get(qt) || 0;
      const idf = Math.max(0.0001, Math.log((N - df + 0.5) / (df + 0.5) + 1));
      const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / Math.max(1, this.avgdl)));
      score += idf * (f * (BM25_K1 + 1)) / denom;
    }
    return score;
  }

  search(query, limit) {
    const max = Math.max(1, Math.min(limit || 50, this.docs.length));
    const scored = [];
    for (let i = 0; i < this.docs.length; i++) {
      const s = this.score(query, i);
      if (s > 0) { scored.push({ index: i, score: s }); }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max);
  }
}
