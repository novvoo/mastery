/**
 * Document RAG tools for user-provided files, URLs, and raw text.
 *
 * Architecture (v2):
 *   1. Parsing  : structured text extraction with section heading detection
 *                  (lightweight docling-style heuristic — no Python deps).
 *   2. Chunking : section-aware — sections are natural split boundaries;
 *                  chunks never cross unrelated sections unless forced by size.
 *                  Chunks carry sectionPath metadata for precise citations.
 *   3. Indexing : (a) semantic embeddings via Embedder, (b) BM25 lexical
 *                  index built on-the-fly in pure JS.
 *   4. Retrieval: hybrid (semantic + BM25) via Reciprocal Rank Fusion, then
 *                 merge-adjacent, then MMR for diversity.
 *   5. Answer   : structured JSON with citations[], evidence[], section paths,
 *                 confidence, and missing_info.
 *
 * Module split:
 *   - document-rag-state.js      — shared mutable state & persistence
 *   - document-rag-parsing.js    — document loading & format-specific parsing
 *   - document-rag-chunking.js   — section-aware, token-bounded chunking
 *   - document-rag-bm25.js       — BM25 index (pure JS)
 *   - document-rag-retrieval.js  — hybrid search (semantic + BM25, RRF fusion)
 *   - document-rag-utils.js      — text normalization, snippets, formatting
 *   - document-rag-sections.js   — section detection & heading normalization
 */

import {
  documents,
  chunks,
  bm25Cache,
  bm25CacheKey,
  invalidateBM25Cache,
  resetState,
  ensureState,
  saveState,
  getEmbedder,
} from './document-rag-state.js';

import {
  loadDocument,
  inferKind,
} from './document-rag-parsing.js';

import {
  chunkText,
  tokenCount,
} from './document-rag-chunking.js';

import {
  BM25Index,
} from './document-rag-bm25.js';

import {
  hybridSearch,
  rrfFuse,
  MIN_SEMANTIC_SCORE,
  MMR_LAMBDA,
  RRF_K,
} from './document-rag-retrieval.js';

import {
  normalizeText,
  extractRelevantSnippet,
  formatSearchResults,
  normalizeLimit,
  sanitizeId,
  condenseForAnswer,
} from './document-rag-utils.js';

import {
  buildSectionPaths,
  detectSections,
  looksLikeHeading,
  normalizeHeading,
} from './document-rag-sections.js';

import { ToolCategory } from '../../core/types.js';
import { mmrReRank, mergeAdjacentChunks } from '../../core/embedder.js';

/* =====================================================================
 * TOOLS
 * ===================================================================== */

export function createDocumentRagTools() {
  return [
    createDocumentAddTool(),
    createDocumentSearchTool(),
    createDocumentAnswerTool(),
    createDocumentListTool(),
    createDocumentClearTool(),
  ];
}

/* ─── document_add ────────────────────────────────────────────────── */
function createDocumentAddTool() {
  return {
    name: 'document_add',
    description: 'Add a user document to the document RAG index. Supports local .txt/.md/.json/.html/.pdf/.docx files, http(s) URLs, or raw text content. Uses section-aware chunking and builds a hybrid semantic+BM25 index.',
    category: ToolCategory.FILESYSTEM,
    params: {
      source: { type: 'string', description: 'Local path or http(s) URL. Optional if content is provided.' },
      content: { type: 'string', description: 'Raw document text to index directly.' },
      title: { type: 'string', description: 'Optional human-readable document title.' },
      id: { type: 'string', description: 'Optional stable document id. Defaults to a generated id.' },
    },
    handler: async ({ source, content, title, id }, ctx) => {
      await ensureState(ctx?.workingDirectory);
      const startedAt = Date.now();
      const parsed = await loadDocument({ source, content, title }, ctx);
      const documentId = sanitizeId(id) || createDocumentId(parsed.title, parsed.source);

      // --- section detection & chunking ---
      const sections = detectSections(parsed.text);
      const sectionPaths = buildSectionPaths(sections);

      // Produce chunks, each carrying its section path.
      const textChunks = chunkText(parsed.text);
      const rawTokens = tokenCount(parsed.text);

      // Assign sectionPath to each chunk: we re-derive it by matching each
      // chunk's text against its section of origin. For simplicity, we use
      // the line boundaries from `sections` and the start position of each
      // chunk's first 80 chars within the normalized text.
      const normalizedText = normalizeText(parsed.text);
      const lines = normalizedText.split('\n');
      const sectionBoundaries = sections.map(s => ({
        heading: s.heading,
        startChar: lines.slice(0, s.startLine).join('\n').length + (s.startLine > 0 ? 1 : 0),
        endChar: lines.slice(0, s.endLine).join('\n').length,
      }));

      const documentChunks = textChunks.map((chunk, index) => {
        const text = typeof chunk === 'string' ? chunk : chunk.text;
        const sectionPath = chunk?.sectionPath || inferSectionForChunk(text, normalizedText, sectionBoundaries);
        return {
          text,
          metadata: {
            documentId,
            title: parsed.title,
            source: parsed.source,
            kind: parsed.kind,
            chunkIndex: index + 1,
            sectionPath,
          },
        };
      });

      if (documentChunks.length === 0) {
        return { success: false, error: 'Document contained no indexable text.' };
      }

      removeDocument(documentId);
      documents.set(documentId, {
        id: documentId,
        title: parsed.title,
        source: parsed.source,
        kind: parsed.kind,
        chars: parsed.text.length,
        tokens: rawTokens,
        sections: sectionPaths.length,
        section_headings: sectionPaths.map(p => p[0]),
        chunks: documentChunks.length,
        addedAt: new Date().toISOString(),
      });
      chunks.push(...documentChunks);

      // Pre-compute embeddings so search doesn't re-embed all chunks every time
      try {
        const embedder = await getEmbedder();
        const texts = documentChunks.map(c => c.text);
        const embeddings = await embedder.embed(texts);
        for (let i = 0; i < documentChunks.length; i++) {
          documentChunks[i].embedding = embeddings[i] || null;
        }
      } catch (e) {
        if (typeof process !== 'undefined' && process.emitWarning) {
          process.emitWarning('Document RAG embedding failed: ' + e.message);
        }
      }

      // Invalidate BM25 cache — chunks array changed
      invalidateBM25Cache();

      await saveState(ctx?.workingDirectory);

      ctx?.ui?.debugEvent?.('Document added to RAG index', {
        id: documentId,
        title: parsed.title,
        source: parsed.source,
        kind: parsed.kind,
        chunks: documentChunks.length,
        sections: sectionPaths.length,
        tokens: rawTokens,
        durationMs: Date.now() - startedAt,
      });

      return {
        success: true,
        id: documentId,
        title: parsed.title,
        source: parsed.source,
        kind: parsed.kind,
        chunks: documentChunks.length,
        chars: parsed.text.length,
        tokens: rawTokens,
        sections: sectionPaths.length,
        section_headings: sectionPaths.map(p => p[0]).slice(0, 20),
      };
    },
  };
}

function inferSectionForChunk(chunkText, fullText, boundaries) {
  if (!boundaries || boundaries.length === 0) { return ['Content']; }
  const needle = chunkText.trim().slice(0, 80);
  if (!needle) { return ['Content']; }
  const pos = fullText.indexOf(needle);
  if (pos === -1) { return ['Content']; }
  // Find the section whose [startChar, endChar] range contains pos
  for (const b of boundaries) {
    if (pos >= b.startChar && pos <= b.endChar) { return [b.heading]; }
  }
  // Fallback: closest preceding section
  let chosen = boundaries[0];
  for (const b of boundaries) { if (b.startChar <= pos) { chosen = b; } }
  return [chosen.heading];
}

/* ─── document_search ────────────────────────────────────────────── */
function createDocumentSearchTool() {
  return {
    name: 'document_search',
    description: 'Search previously added user documents using hybrid (semantic + BM25 lexical) scoring. Use this to answer questions grounded in uploaded documents.',
    category: ToolCategory.FILESYSTEM,
    params: {
      query: { type: 'string', description: 'Natural-language question or concept to search for.' },
      limit: { type: 'number', description: 'Maximum matching chunks to return (default 5, max 20).' },
      document_id: { type: 'string', description: 'Optional document id to restrict search.' },
      min_score: { type: 'number', description: 'Minimum semantic score to keep (default 0.25; higher = stricter).' },
      mmr_lambda: { type: 'number', description: 'MMR balance: 1.0 = pure relevance, 0.0 = pure diversity (default 0.7).' },
    },
    required: ['query'],
    handler: async ({ query, limit, document_id, min_score, mmr_lambda }, ctx) => {
      await ensureState(ctx?.workingDirectory);
      const scopedChunks = document_id
        ? chunks.filter(chunk => chunk.metadata.documentId === document_id)
        : chunks;

      if (scopedChunks.length === 0) {
        return 'No documents are indexed yet. Use document_add with a local path, URL, or content first.';
      }

      const maxResults = normalizeLimit(limit);
      const finalMinScore = Number.isFinite(+min_score) ? Number(min_score) : MIN_SEMANTIC_SCORE;
      const finalLambda = Number.isFinite(+mmr_lambda) ? Number(mmr_lambda) : MMR_LAMBDA;

      // Phase 1: hybrid search (semantic + BM25 → RRF fusion)
      const hybrid = await hybridSearch(query, scopedChunks, {
        limit: Math.min(scopedChunks.length, 200),
        minScore: finalMinScore,
      });

      // Phase 2: merge adjacent chunks from the same document/section
      const merged = mergeAdjacentChunks(hybrid);

      // Phase 3: MMR for diversity
      const reranked = mmrReRank(merged, {
        lambda: finalLambda,
        limit: maxResults,
        minScore: -Infinity,
      });

      const results = (reranked.length > 0 ? reranked : hybrid).slice(0, maxResults);
      for (const r of results) { r.query = query; }

      ctx?.ui?.debugEvent?.('Document search completed', {
        query,
        chunks: scopedChunks.length,
        finalResults: results.length,
        hybrid_scores: results.map(r => ({ fused: r.score, semantic: r.semanticScore, lexical: r.lexicalScore })),
      });

      return formatSearchResults(results, { totalChunks: scopedChunks.length, minScore: finalMinScore });
    },
  };
}

/* ─── document_answer ────────────────────────────────────────────── */
function createDocumentAnswerTool() {
  return {
    name: 'document_answer',
    description: 'Given a natural-language question about the uploaded documents, return a structured RAG answer including citations (with section paths), evidence snippets, confidence, and missing-info. Use this instead of document_search when the user wants a direct, citeable answer.',
    category: ToolCategory.FILESYSTEM,
    params: {
      question: { type: 'string', description: 'The question to answer based on the indexed documents.' },
      limit: { type: 'number', description: 'Max evidence chunks to consider (default 8, max 20).' },
      document_id: { type: 'string', description: 'Optional document id to restrict search.' },
      min_score: { type: 'number', description: 'Minimum semantic score (default 0.25).' },
      mmr_lambda: { type: 'number', description: 'MMR lambda for diversity (default 0.7).' },
    },
    required: ['question'],
    handler: async ({ question, limit, document_id, min_score, mmr_lambda }, ctx) => {
      await ensureState(ctx?.workingDirectory);
      const scopedChunks = document_id
        ? chunks.filter(chunk => chunk.metadata.documentId === document_id)
        : chunks;

      if (scopedChunks.length === 0) {
        return buildEmptyAnswer(question, 'No documents are indexed yet. Use document_add first.');
      }

      const maxResults = Math.min(20, Math.max(3, Number(limit) || 8));
      const finalMinScore = Number.isFinite(+min_score) ? Number(min_score) : MIN_SEMANTIC_SCORE;
      const finalLambda = Number.isFinite(+mmr_lambda) ? Number(mmr_lambda) : MMR_LAMBDA;

      // Phase 1: hybrid retrieval
      const hybrid = await hybridSearch(question, scopedChunks, {
        limit: Math.min(scopedChunks.length, 200),
        minScore: finalMinScore,
      });

      // Phase 2: merge adjacent → MMR
      const merged = mergeAdjacentChunks(hybrid);
      const reranked = mmrReRank(merged, { lambda: finalLambda, limit: maxResults, minScore: -Infinity });
      const evidence = (reranked.length > 0 ? reranked : hybrid).slice(0, maxResults);

      return buildStructuredAnswer(question, evidence, scopedChunks.length, finalMinScore, {
        modelProvider: ctx?.modelProvider || null,
      });
    },
  };
}

/* ─── document_list ────────────────────────────────────────────────── */
function createDocumentListTool() {
  return {
    name: 'document_list',
    description: 'List user documents currently loaded into the document RAG index, including section counts and chunk counts.',
    category: ToolCategory.FILESYSTEM,
    params: {},
    handler: async (args, ctx) => {
      await ensureState(ctx?.workingDirectory);
      return {
        success: true,
        count: documents.size,
        documents: Array.from(documents.values()),
      };
    },
  };
}

/* ─── document_clear ───────────────────────────────────────────────── */
function createDocumentClearTool() {
  return {
    name: 'document_clear',
    description: 'Clear one document or the entire document RAG index.',
    category: ToolCategory.FILESYSTEM,
    params: {
      document_id: { type: 'string', description: 'Optional document id to remove. If omitted, clears all documents.' },
    },
    handler: async ({ document_id }, ctx) => {
      await ensureState(ctx?.workingDirectory);
      if (document_id) {
        const removed = removeDocument(document_id);
        invalidateBM25Cache();
        await saveState(ctx?.workingDirectory);
        return { success: removed, removed: removed ? 1 : 0 };
      }
      const count = documents.size;
      resetState();
      await saveState(ctx?.workingDirectory);
      return { success: true, removed: count };
    },
  };
}

/* =====================================================================
 * STRUCTURED ANSWER BUILDER (enhanced with section paths)
 * ===================================================================== */

async function synthesizeWithLLM(question, evidenceItems, modelProvider) {
  if (!modelProvider || typeof modelProvider.chat !== 'function') { return null; }

  const topEv = evidenceItems.slice(0, 5);
  const evidenceText = topEv.map((e, i) => {
    const md = e.metadata || {};
    const section = (md.sectionPath && md.sectionPath.length > 0)
      ? ` [section: ${md.sectionPath.join(' › ')}]`
      : '';
    return `[Evidence #${i + 1}] doc=${md.documentId || '?'} chunk=${md.chunkIndex || '?'}${section}\n${(e.snippet || e.text || '').trim()}`;
  }).join('\n\n---\n\n');

  const systemPrompt =
    '你是一个严谨的证据型问答助手。你的任务是：仅根据用户提供的 evidence 片段，用简洁的中文（或与 question 相同的语言）回答问题。\n' +
    '规则：\n' +
    '1) 严格依据 evidence 内容作答，不得引入外部知识，不得臆测。\n' +
    '2) 如果 evidence 中没有相关内容，直接说明"证据不足，无法回答"。\n' +
    '3) 直接输出答案，不需要礼貌语、不需要重复问题，不要出现"根据证据"等套话。\n' +
    '4) 答案中在关键信息后的括号内引用证据编号，例如：(证据 #1)。';

  const userPrompt =
    `Question: ${question}\n\n` +
    `Evidence snippets (most relevant first):\n${evidenceText}\n\n` +
    `Answer:`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const resp = await modelProvider.chat(messages, {
      maxTokens: 600,
      temperature: 0.0,
    });
    const text = (resp?.text || '').trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

function buildEmptyAnswer(question, reason) {
  return {
    structured_rag: true,
    question,
    answer: reason || 'No documents available to answer this question.',
    citations: [],
    evidence: [],
    confidence: 0.0,
    missing_info: {
      reason,
      no_documents: true,
      low_relevance: false,
    },
    meta: {
      total_indexed_chunks: 0,
      min_score: null,
      evidence_used: 0,
      retrieval_method: 'hybrid',
    },
  };
}

async function buildStructuredAnswer(question, evidence, totalChunks, minScore, options = {}) {
  const { modelProvider = null } = options;

  if (!evidence || evidence.length === 0) {
    return {
      structured_rag: true,
      question,
      answer: 'No document content scored above the relevance threshold. The indexed documents may not cover this question.',
      citations: [],
      evidence: [],
      confidence: 0.05,
      missing_info: {
        reason: `No chunks passed min_score=${minScore}.`,
        no_documents: false,
        low_relevance: true,
      },
      meta: {
        total_indexed_chunks: totalChunks,
        min_score: minScore,
        evidence_used: 0,
        retrieval_method: 'hybrid',
      },
    };
  }

  const seenDocs = new Set();
  const citations = [];
  const evidenceItems = [];

  // Also aggregate unique sections referenced (useful for the answer)
  const sectionsHit = new Set();

  for (let i = 0; i < evidence.length; i++) {
    const item = evidence[i];
    const md = item.metadata || {};
    const docId = md.documentId || md.source || `doc-${i}`;
    const docTitle = md.title || 'Untitled';
    const sectionPath = md.sectionPath || null;
    const snippet = extractRelevantSnippet(item.text, question, 400);
    const semanticPct = typeof item.semanticScore === 'number'
      ? Math.round((item.semanticScore + 1) / 2 * 100)
      : null;

    // Keep sectionPath unique for display
    if (sectionPath && Array.isArray(sectionPath)) {
      sectionsHit.add(sectionPath.join(' › '));
    }

    evidenceItems.push({
      rank: i + 1,
      document_id: docId,
      title: docTitle,
      source: md.source || null,
      chunk_index: md.chunkIndex || null,
      section_path: sectionPath,
      score: Number(item.score) || 0,          // fused (RRF) score
      semantic_score: Number(item.semanticScore) || 0,
      lexical_score: Number(item.lexicalScore) || 0,
      score_pct: semanticPct,
      snippet,
      text_length: String(item.text || '').length,
    });

    if (!seenDocs.has(docId)) {
      seenDocs.add(docId);
      citations.push({
        document_id: docId,
        title: docTitle,
        source: md.source || null,
        kind: md.kind || null,
        references: 1,
        sections: sectionPath ? [sectionPath] : [],
      });
    } else {
      const c = citations.find(c => c.document_id === docId);
      if (c) {
        c.references += 1;
        if (sectionPath) {
          const key = sectionPath.join(' › ');
          if (!c.sections.some(s => s.join(' › ') === key)) { c.sections.push(sectionPath); }
        }
      }
    }
  }

  // Confidence from top-3 semantic scores (cosine → [0,1])
  const topSemScores = evidence.slice(0, 3).map(e => Number(e.semanticScore) || 0);
  const avgTop = topSemScores.reduce((a, b) => a + b, 0) / Math.max(1, topSemScores.length);
  const confidence = Math.max(0, Math.min(1, (avgTop + 1) / 2));

  const lowRelevance = avgTop < 0.1;

  // Synthesize the "answer" field: try LLM first (zero hardcoded keywords),
  // fall back to evidence-best-snippet when model unavailable.
  let synthesizedAnswer = null;
  let answerMethod = 'fallback-extractive';
  if (modelProvider && typeof modelProvider.chat === 'function' && !lowRelevance) {
    synthesizedAnswer = await synthesizeWithLLM(question, evidenceItems, modelProvider);
    if (synthesizedAnswer) { answerMethod = 'llm-evidence-based'; }
  }
  if (!synthesizedAnswer) {
    const topSnippet = evidenceItems.slice(0, 2).map(e => e.snippet).join(' ');
    synthesizedAnswer = condenseForAnswer(topSnippet, question, 600);
  }

  const missingInfo = {
    reason: lowRelevance
      ? 'Top evidence scores are low. The answer may be incomplete or speculative — verify against the evidence snippets.'
      : null,
    no_documents: false,
    low_relevance: lowRelevance,
    suggested_next: lowRelevance
      ? 'Try: (a) a more specific query, (b) lowering min_score, or (c) adding more relevant documents.'
      : null,
  };

  return {
    structured_rag: true,
    question,
    answer: synthesizedAnswer,
    sections_hit: [...sectionsHit].slice(0, 20),
    citations,
    evidence: evidenceItems,
    confidence: Math.round(confidence * 1000) / 1000,
    missing_info: missingInfo,
    meta: {
      total_indexed_chunks: totalChunks,
      min_score: minScore,
      evidence_used: evidenceItems.length,
      retrieval_method: 'hybrid',
      answer_method: answerMethod,
    },
  };
}

/* =====================================================================
 * DOCUMENT MANAGEMENT HELPERS
 * ===================================================================== */

function removeDocument(documentId) {
  const existed = documents.delete(documentId);
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].metadata.documentId === documentId) { chunks.splice(i, 1); }
  }
  if (existed) {
    invalidateBM25Cache();
  }
  return existed;
}

function createDocumentId(title, source) {
  const base = sanitizeId(title || source || 'document') || 'document';
  let candidate = base;
  let suffix = 2;
  while (documents.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

/* ─── exposed for tests ──────────────────────────────────────────── */
export const _internal = {
  detectSections,
  normalizeHeading,
  looksLikeHeading,
  BM25Index,
  rrfFuse,
  chunkText,
  tokenCount,
};

export default createDocumentRagTools;
