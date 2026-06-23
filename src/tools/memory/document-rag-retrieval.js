/**
 * Hybrid retrieval for Document RAG — semantic + BM25, fused with RRF.
 */

import { BM25Index } from './document-rag-bm25.js';
import { getEmbedder } from './document-rag-state.js';
import {
  normalizeText,
  extractRelevantSnippet,
  normalizeSearchText,
  CHINESE_STOP_TERMS,
  LEXICAL_SCORE_BOOST,
} from './document-rag-utils.js';

/* ─── constants ─────────────────────────────────────────────────────── */
export const MIN_SEMANTIC_SCORE = 0.25;
export const MMR_LAMBDA = 0.7;
export const RRF_K = 60;

/* ─── RRF fusion ────────────────────────────────────────────────────── */
export function rrfFuse(rankLists, k) {
  // rankLists: Array of [{index, score}], each list ordered descending by score.
  // Returns Map<index, fusedScore>.
  const K = k || RRF_K;
  const fused = new Map();
  for (const list of rankLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const prev = fused.get(item.index) || 0;
      fused.set(item.index, prev + 1 / (K + rank + 1));
    }
  }
  return fused;
}

/* ─── hybrid search ─────────────────────────────────────────────────── */
export async function hybridSearch(query, scopedChunks, opts) {
  const maxResults = opts?.limit || 20;
  const finalMinScore = opts?.minScore ?? MIN_SEMANTIC_SCORE;

  // Build a one-off BM25 on the scoped view.
  const scopedBm25 = new BM25Index(scopedChunks);

  // --- BM25 ranking (lexical) ---
  const lexicalRaw = scopedBm25.search(query, Math.min(scopedChunks.length, 200));
  const lexicalByIndex = new Map(lexicalRaw.map((r) => [r.index, r.score]));

  // --- Semantic ranking ---
  const embedder = await getEmbedder();
  const hasPrecomputed = scopedChunks.some(
    (c) => Array.isArray(c.embedding) && c.embedding.length > 100,
  );
  let semanticByIndex;
  let semanticResults;

  if (hasPrecomputed) {
    const qEmb = await embedder.embed(query);
    // Direct cosine against each scoped chunk
    const scored = [];
    for (let i = 0; i < scopedChunks.length; i++) {
      const chunk = scopedChunks[i];
      if (!chunk.embedding) {
        continue;
      }
      let dot = 0;
      for (let j = 0; j < qEmb.length; j++) {
        dot += qEmb[j] * chunk.embedding[j];
      }
      scored.push({ index: i, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    semanticResults = scored.slice(0, 200);
    semanticByIndex = new Map(scored.map((r) => [r.index, r.score]));
  } else {
    // Embedder-side batch scoring
    semanticResults = await embedder.batchFindSimilar(query, scopedChunks, {
      limit: Math.min(scopedChunks.length, 200),
      includeAll: false,
    });
    // batchFindSimilar returns [{text, score, metadata}] with indices in the
    // input array. We re-map to integer indices.
    semanticByIndex = new Map();
    for (let i = 0; i < semanticResults.length; i++) {
      const r = semanticResults[i];
      const idx = scopedChunks.findIndex((c) => c.text === r.text);
      if (idx !== -1) {
        semanticByIndex.set(idx, r.score);
      }
    }
    semanticResults = [...semanticByIndex.entries()]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score);
  }

  // --- RRF fusion ---
  const fused = rrfFuse([
    semanticResults.slice(0, Math.min(50, semanticResults.length)),
    lexicalRaw.slice(0, Math.min(50, lexicalRaw.length)),
  ]);

  // --- Build final result list ---
  const results = [];
  for (const [idx, fusedScore] of fused.entries()) {
    const chunk = scopedChunks[idx];
    const semScore = semanticByIndex.get(idx) ?? 0;
    const lexScore = lexicalByIndex.get(idx) ?? 0;
    results.push({
      index: idx,
      text: chunk.text,
      score: fusedScore,
      semanticScore: semScore,
      lexicalScore: lexScore,
      metadata: chunk.metadata,
    });
  }
  results.sort((a, b) => b.score - a.score);

  // Apply min_score filter (on semantic score — BM25 doesn't have a fixed
  // range, so we let lexical hits be kept as long as at least one signal is
  // strong enough).
  const filtered = results.filter(
    (r) => Number(r.semanticScore) >= finalMinScore || r.lexicalScore > 0,
  );
  return filtered.length > 0 ? filtered.slice(0, maxResults) : results.slice(0, maxResults);
}

/* ─── lexical reranking ─────────────────────────────────────────────── */
export function rerankWithLexicalSignals(query, semanticResults) {
  return semanticResults
    .map((result) => {
      const semanticScore = Number(result.score) || 0;
      const lexicalScore = computeLexicalScore(query, result.text || '');
      const score = Math.min(1, semanticScore + lexicalScore * LEXICAL_SCORE_BOOST);
      return { ...result, score, semanticScore, lexicalScore };
    })
    .sort((a, b) => b.score - a.score);
}

function computeLexicalScore(query, text) {
  const queryTerms = extractSearchTerms(query);
  if (queryTerms.length === 0) {
    return 0;
  }
  const normalizedText = normalizeSearchText(text);
  const matchedWeight = queryTerms.reduce((sum, term) => {
    if (!normalizedText.includes(term.value)) {
      return sum;
    }
    return sum + term.weight;
  }, 0);
  const totalWeight = queryTerms.reduce((sum, term) => sum + term.weight, 0);
  return totalWeight > 0 ? Math.min(1, matchedWeight / totalWeight) : 0;
}

function extractSearchTerms(query) {
  const normalized = normalizeSearchText(query);
  const terms = new Map();

  for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || []) {
    addSearchTerm(terms, token, token.length >= 4 ? 1.4 : 1);
  }
  for (const gram of createCjkGrams(normalized, 2)) {
    addSearchTerm(terms, gram, 0.45);
  }
  return Array.from(terms.entries()).map(([value, weight]) => ({ value, weight }));
}

function addSearchTerm(terms, value, weight) {
  const normalized = normalizeSearchText(value);
  if (normalized.length < 2 || CHINESE_STOP_TERMS.has(normalized)) {
    return;
  }
  terms.set(normalized, Math.max(terms.get(normalized) || 0, weight));
}

function createCjkGrams(text, size) {
  const chars = Array.from(text).filter((char) => /[\p{Script=Han}]/u.test(char));
  const grams = [];
  for (let i = 0; i <= chars.length - size; i++) {
    grams.push(chars.slice(i, i + size).join(''));
  }
  return grams;
}
