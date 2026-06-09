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
 */

import { readFile, stat, mkdir, writeFile } from 'fs/promises';
import { basename, extname, isAbsolute, resolve, join } from 'path';
import { Buffer } from 'buffer';
import { URL } from 'url';
import { Embedder, heuristicCountTokens, mmrReRank, mergeAdjacentChunks } from '../../core/embedder.js';
import { ToolCategory } from '../../core/types.js';

/* ─── constants ─────────────────────────────────────────────────────── */
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const CHUNK_TOKENS_TARGET = 750;
const CHUNK_TOKENS_MIN = 600;
const CHUNK_TOKENS_MAX = 900;
const OVERLAP_TOKENS = 125;
const MIN_SEMANTIC_SCORE = 0.25;
const MMR_LAMBDA = 0.7;
const USER_AGENT = 'AI-Engineering-Agent/1.0 (+document-rag)';
const LEXICAL_SCORE_BOOST = 0.25;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const RRF_K = 60;           // RRF constant, typical range 20-100

/* ─── shared state ──────────────────────────────────────────────────── */
const documents = new Map();
const chunks = [];
let embedderPromise = null;
let bm25Cache = null;        // BM25 index rebuilt when chunks change
let bm25CacheKey = 0;        // increments on every document_add/clear

/* ─── persistence ───────────────────────────────────────────────────── */
let loadedPersistDir = null;

function getPersistDir(workingDir) {
  return join(resolve(workingDir || process.cwd()), '.agent-data', 'doc-rag');
}

async function ensureState(workingDir) {
  const dir = getPersistDir(workingDir);
  if (loadedPersistDir === dir) {return;}
  loadedPersistDir = dir;
  documents.clear();
  chunks.length = 0;
  bm25Cache = null;
  bm25CacheKey++;
  try {
    const docJson = await readFile(join(dir, 'documents.json'), 'utf-8');
    const chunkJson = await readFile(join(dir, 'chunks.json'), 'utf-8');
    const loadedDocs = JSON.parse(docJson);
    const loadedChunks = JSON.parse(chunkJson);
    for (const [key, val] of Object.entries(loadedDocs)) {documents.set(key, val);}
    chunks.push(...loadedChunks);
  } catch {
    // No persisted document index yet.
  }
}

async function saveState(workingDir) {
  const dir = getPersistDir(workingDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'documents.json'), JSON.stringify(Object.fromEntries(documents)), 'utf-8');
  // Strip ephemeral fields before serializing to keep file small
  const serializable = chunks.map(c => {
    const { embedding, ...rest } = c;
    return embedding ? { ...rest, embedding } : rest;
  });
  await writeFile(join(dir, 'chunks.json'), JSON.stringify(serializable), 'utf-8');
}

/* ─── embedder factory ──────────────────────────────────────────────── */
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const embedder = new Embedder();
      await embedder.initialize();
      return embedder;
    })();
  }
  return embedderPromise;
}

/* =====================================================================
 * SECTION HEADING DETECTION
 * =====================================================================
 * Scans the document for lines that behave like section headings:
 *   - Match known keywords (中文 / English)
 *   - Are short lines that end with ':' or '：'
 *   - Are ALL-CAPS short lines (English style)
 *   - Use markdown-like markers (# heading, **heading**)
 *
 * Returns an ordered list of {lineIndex, text, kind, normalized}.
 * ------------------------------------------------------------------- */

// Known section heading keywords — multi-lingual (covering resume,
// project-doc, technical-report style documents).
const SECTION_KEYWORDS_EN = [
  'experience', 'work experience', 'professional experience',
  'education', 'academic background', 'skills', 'technical skills',
  'projects', 'project', 'summary', 'objective', 'about',
  'certifications', 'certificates', 'awards', 'honors',
  'publications', 'references', 'contact', 'languages',
  'introduction', 'background', 'methodology', 'methods',
  'results', 'discussion', 'conclusion', 'appendix',
  'overview', 'key results', 'limitations', 'related work',
];

const SECTION_KEYWORDS_ZH = [
  '教育背景', '教育经历', '学历', '学习经历',
  '工作经历', '工作经验', '职业经历', '任职经历', '从业经历',
  '项目经验', '项目经历', '项目',
  '专业技能', '技能', '核心技能', '技术栈',
  '个人简介', '自我介绍', '个人评价', '自我评价', '简介', '摘要',
  '荣誉奖项', '获奖情况', '荣誉', '奖项',
  '证书', '资格证书', '认证',
  '论文发表', '发表', '出版物',
  '语言能力', '语言',
  '联系方式', '联系', '求职意向', '意向',
  '概述', '背景', '方法', '结果', '讨论', '结论', '附录',
  '相关工作', '参考文献',
];

// Numeric prefix patterns tolerated: "1. Experience", "① 教育背景", "Chapter 2: ..."
const PREFIX_STRIP_RE = /^(?:\s*(?:\d+[.\)、\)）:]|[①-⑳][.:\s]+|[一二三四五六七八九十]+[、.:\s]+|Chapter\s+\d+[:\s]+|[IVXLCDM]+\.\s*))?\s*/i;

function normalizeHeading(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(PREFIX_STRIP_RE, '');
  s = s.replace(/[:：|\-\s]+$/g, '').trim();
  // Strip markdown bold markers
  s = s.replace(/^\*+\s*|\s*\*+$/g, '').trim();
  s = s.replace(/^#+\s*/, '').trim();
  return s;
}

function looksLikeHeading(line) {
  if (!line) return null;
  const trimmed = line.trim();
  const len = Array.from(trimmed).length;

  if (len > 60) return null;
  if (len < 2) return null;

  // Skip lines that look like list items / bullets
  if (/^[\-\*•\d][\.\)\s]/.test(trimmed)) return null;
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) return null;

  const normalized = normalizeHeading(trimmed);
  if (!normalized) return null;

  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return { text: normalized, kind: 'markdown' };
  }

  if (/^(\*+|_+)\s*\S.*\S\s*\1\s*:?$/.test(trimmed)) {
    return { text: normalized, kind: 'bold' };
  }

  if (/^[A-Z][A-Z0-9\s&/\-]{2,40}$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    const lower = normalized.toLowerCase();
    if (SECTION_KEYWORDS_EN.some(k => lower.includes(k)) || len <= 25) {
      return { text: normalized, kind: 'allcaps' };
    }
  }

  const lowerNorm = normalized.toLowerCase();
  const zhHit = SECTION_KEYWORDS_ZH.find(k => normalized.includes(k));
  if (zhHit) return { text: normalized, kind: 'zh-keyword', matched: zhHit };

  const enHit = SECTION_KEYWORDS_EN.find(k => lowerNorm.includes(k));
  if (enHit) return { text: normalized, kind: 'en-keyword', matched: enHit };

  if (/[:：]\s*$/.test(trimmed) && len <= 30) {
    return { text: normalized, kind: 'trailing-colon' };
  }

  return null;
}

function detectSections(rawText) {
  if (!rawText) return [];
  const lines = rawText.split('\n');
  const hits = [];

  // First pass: collect candidate headings with their line index
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    // Heuristic: a section heading line is typically short and followed by
    // either a blank line OR content that doesn't look like a paragraph
    // continuation. We are lenient — the cost of a false positive is low
    // (just an extra chunk boundary) while the cost of missing one is high.
    const trimmed = line.trim();
    if (Array.from(trimmed).length > 60) continue;

    const match = looksLikeHeading(trimmed);
    if (match) {
      hits.push({ lineIndex: i, ...match });
    }
  }

  // Second pass: filter out false positives — a heading's "content area"
  // must have non-trivial text (≥ 2 non-empty lines after it, until next heading).
  const sections = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].lineIndex;
    const end = (i + 1 < hits.length) ? hits[i + 1].lineIndex : lines.length;

    // Count non-empty lines in the section body
    let bodyLines = 0;
    for (let j = start + 1; j < end; j++) {
      if (lines[j] && lines[j].trim()) bodyLines++;
    }

    // First "section" can't start on line 0 if it's really just a title —
    // but we include it anyway (cost is low). Require at least 1 body line
    // unless it's the last section and the doc is tiny.
    if (bodyLines >= 1 || hits.length === 1) {
      sections.push({
        startLine: start,
        endLine: end,
        heading: hits[i].text,
        kind: hits[i].kind,
        bodyLines,
      });
    }
  }

  // If no sections detected at all, treat the whole doc as a single section
  if (sections.length === 0 && lines.some(l => l && l.trim())) {
    sections.push({
      startLine: 0,
      endLine: lines.length,
      heading: 'Content',
      kind: 'default',
      bodyLines: lines.filter(l => l && l.trim()).length,
    });
  }

  return sections;
}

/* ─── section path / hierarchy building ──────────────────────────── */
function buildSectionPaths(sections) {
  // Heuristic hierarchy: "keyword sections" (like "教育背景") are treated as
  // top-level; sub-sections are detected by indentation or by heading-length
  // heuristics. For the common resume use-case we keep it flat but include
  // the parent heading as the sectionPath.
  const paths = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    paths.push([s.heading]);
  }
  return paths;
}

/* =====================================================================
 * STRUCTURED CHUNKING (section-aware, token-bounded)
 * ===================================================================== */

function chunkText(text) {
  const normalized = normalizeText(text);
  const totalTokens = tokenCount(normalized);
  const sections = detectSections(normalized);

  if (totalTokens <= CHUNK_TOKENS_MAX) {
    const sectionPaths = sections.length > 1
      ? sections.slice(0, 1).map(s => s.heading)
      : ['Content'];
    return [{ text: normalized, sectionPath: sectionPaths, tokens: totalTokens }];
  }

  if (sections.length > 1) {
    return chunkBySections(normalized, sections);
  }

  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return legacyTokenSplit(normalized);
  }
  return packByTokens(paragraphs);
}

function chunkBySections(text, sections) {
  const lines = text.split('\n');
  const outputChunks = [];

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const sectionLines = lines.slice(sec.startLine, sec.endLine);
    const sectionText = sectionLines.join('\n').trim();
    if (!sectionText) continue;

    const sectionTokens = tokenCount(sectionText);

    if (sectionTokens <= CHUNK_TOKENS_MAX) {
      outputChunks.push({
        text: sectionText,
        sectionPath: [sec.heading],
        tokens: sectionTokens,
      });
      continue;
    }

    const paragraphs = sectionText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length <= 1) {
      const subChunks = packByTokens(
        sectionText.split('\n').map(l => l.trim()).filter(Boolean),
        [sec.heading]
      );
      for (const c of subChunks) outputChunks.push(c);
      continue;
    }

    const subChunks = packByTokens(paragraphs, [sec.heading]);
    for (const c of subChunks) outputChunks.push(c);
  }

  return outputChunks;
}

function packByTokens(segments, sectionPath) {
  const result = [];
  let buffer = '';
  let bufferTokens = 0;

  for (const seg of segments) {
    if (!seg) continue;
    const segTokens = tokenCount(seg);

    if (segTokens > CHUNK_TOKENS_MAX) {
      if (buffer) {
        result.push(makePackResult(buffer, sectionPath, bufferTokens));
        buffer = '';
        bufferTokens = 0;
      }
      const linePieces = seg.split('\n').map(l => l.trim()).filter(Boolean);
      for (const piece of linePieces) {
        const pieceTokens = tokenCount(piece);
        if (pieceTokens > CHUNK_TOKENS_MAX) {
          const split = legacyTokenSplit(piece);
          for (const s of split) {
            const t = typeof s === 'string' ? s : s.text;
            result.push(makePackResult(t, sectionPath, tokenCount(t)));
          }
        } else if (bufferTokens + pieceTokens > CHUNK_TOKENS_TARGET) {
          result.push(makePackResult(buffer, sectionPath, bufferTokens));
          buffer = carryOverlap(buffer) + ' ' + piece;
          bufferTokens = tokenCount(buffer);
        } else {
          buffer = buffer ? buffer + '\n\n' + piece : piece;
          bufferTokens += pieceTokens;
        }
      }
      continue;
    }

    if (bufferTokens + segTokens > CHUNK_TOKENS_TARGET) {
      result.push(makePackResult(buffer, sectionPath, bufferTokens));
      buffer = carryOverlap(buffer) + ' ' + seg;
      bufferTokens = tokenCount(buffer);
    } else {
      buffer = buffer ? buffer + '\n\n' + seg : seg;
      bufferTokens += segTokens;
    }
  }
  if (buffer && buffer.trim()) result.push(makePackResult(buffer, sectionPath, bufferTokens));
  return result;
}

function makePackResult(text, sectionPath, tokens) {
  return { text: text.trim(), sectionPath: sectionPath || ['Content'], tokens };
}

function carryOverlap(text) {
  if (!text) return '';
  const pieces = text.split(/\s+/).filter(Boolean);
  if (pieces.length === 0) return '';
  const targetWords = Math.max(6, Math.round(OVERLAP_TOKENS / 1.3));
  return pieces.slice(-targetWords).join(' ');
}

function legacyTokenSplit(text) {
  const result = [];
  const s = String(text || '');
  if (!s) return result;
  const words = s.split(/\s+/);
  let buffer = '';
  let bufferTokens = 0;
  for (const word of words) {
    const wTokens = Math.max(1, Math.round(tokenCount(word)));
    if (bufferTokens + wTokens > CHUNK_TOKENS_TARGET) {
      result.push({ text: buffer.trim(), sectionPath: ['Content'], tokens: bufferTokens });
      buffer = carryOverlap(buffer) + ' ' + word;
      bufferTokens = tokenCount(buffer);
    } else {
      buffer = buffer ? buffer + ' ' + word : word;
      bufferTokens += wTokens;
    }
  }
  if (buffer && buffer.trim()) {
    result.push({ text: buffer.trim(), sectionPath: ['Content'], tokens: bufferTokens });
  }
  return result;
}

function tokenCount(text) {
  try {
    if (typeof heuristicCountTokens === 'function') return heuristicCountTokens(text);
  } catch {}
  const s = String(text || '');
  if (!s) return 0;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (s.match(/[\p{L}\p{N}_-]+/gu) || []).length;
  return Math.max(1, Math.round(cjk + words * 1.3));
}

/* =====================================================================
 * BM25 INDEX — pure JS, zero deps
 * =====================================================================
 * BM25Okapi over the indexed chunks. Used for lexical (keyword-matching)
 * retrieval in a hybrid pipeline.
 *
 * Index is lazily built from the chunks array on first search after any
 * document_add/document_clear.
 * ------------------------------------------------------------------- */

class BM25Index {
  constructor(chunkList) {
    this.docs = [];
    this.docFreq = new Map();   // term → doc count
    this.avgdl = 0;
    this.totalLen = 0;
    this._build(chunkList);
  }

  _tokenize(text) {
    if (!text) return [];
    const t = String(text).toLowerCase();
    // CJK chars → individual tokens; words → whole word tokens.
    const out = [];
    // Words first (keep runs of letters/digits/underscore)
    const wordRe = /[\p{L}\p{N}_-]+/gu;
    let match;
    while ((match = wordRe.exec(t)) !== null) {
      if (match[0].length >= 2) out.push(match[0]);
    }
    // CJK chars as individual tokens (bigrams would be better for recall,
    // but unigrams are fine for ranking and cheap to compute).
    for (const ch of t) {
      if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
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
    if (queryTokens.length === 0) return 0;
    const doc = this.docs[docIndex];
    if (!doc) return 0;
    const N = this.docs.length;
    let score = 0;
    for (const qt of queryTokens) {
      const f = doc.tokens.get(qt) || 0;
      if (f === 0) continue;
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
      if (s > 0) scored.push({ index: i, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max);
  }
}

function getOrBuildBM25() {
  if (bm25Cache) return bm25Cache;
  bm25Cache = new BM25Index(chunks);
  return bm25Cache;
}

/* =====================================================================
 * HYBRID SEARCH — semantic + BM25, fused with RRF
 * ===================================================================== */

function rrfFuse(rankLists, k) {
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

async function hybridSearch(query, scopedChunks, opts) {
  const maxResults = opts?.limit || 20;
  const finalMinScore = opts?.minScore ?? MIN_SEMANTIC_SCORE;

  // Build an indexMap: position-in-scopedChunks → position-in-global-chunks
  // Because BM25 is built on the global chunks[] array, but scopedChunks may
  // be a filtered view. We'll do a simpler approach: build a one-off BM25 on
  // the scoped view.
  const scopedBm25 = new BM25Index(scopedChunks);

  // --- BM25 ranking (lexical) ---
  const lexicalRaw = scopedBm25.search(query, Math.min(scopedChunks.length, 200));
  const lexicalByIndex = new Map(lexicalRaw.map(r => [r.index, r.score]));

  // --- Semantic ranking ---
  const embedder = await getEmbedder();
  const hasPrecomputed = scopedChunks.some(c => Array.isArray(c.embedding) && c.embedding.length > 100);
  let semanticByIndex;
  let semanticResults;

  if (hasPrecomputed) {
    const qEmb = await embedder.embed(query);
    // Direct cosine against each scoped chunk
    const scored = [];
    for (let i = 0; i < scopedChunks.length; i++) {
      const chunk = scopedChunks[i];
      if (!chunk.embedding) continue;
      let dot = 0;
      for (let j = 0; j < qEmb.length; j++) dot += qEmb[j] * chunk.embedding[j];
      scored.push({ index: i, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    semanticResults = scored.slice(0, 200);
    semanticByIndex = new Map(scored.map(r => [r.index, r.score]));
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
      // batchFindSimilar result objects carry the matched item; we need its
      // position in scopedChunks. Do a linear remap via identity match on text.
      const r = semanticResults[i];
      const idx = scopedChunks.findIndex(c => c.text === r.text);
      if (idx !== -1) semanticByIndex.set(idx, r.score);
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
  const filtered = results.filter(r => Number(r.semanticScore) >= finalMinScore || r.lexicalScore > 0);
  return filtered.length > 0 ? filtered.slice(0, maxResults) : results.slice(0, maxResults);
}

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
      bm25Cache = null;
      bm25CacheKey++;

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
  if (!boundaries || boundaries.length === 0) return ['Content'];
  const needle = chunkText.trim().slice(0, 80);
  if (!needle) return ['Content'];
  const pos = fullText.indexOf(needle);
  if (pos === -1) return ['Content'];
  // Find the section whose [startChar, endChar] range contains pos
  for (const b of boundaries) {
    if (pos >= b.startChar && pos <= b.endChar) return [b.heading];
  }
  // Fallback: closest preceding section
  let chosen = boundaries[0];
  for (const b of boundaries) if (b.startChar <= pos) chosen = b;
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
      for (const r of results) r.query = query;

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
        bm25Cache = null;
        bm25CacheKey++;
        await saveState(ctx?.workingDirectory);
        return { success: removed, removed: removed ? 1 : 0 };
      }
      const count = documents.size;
      documents.clear();
      chunks.length = 0;
      bm25Cache = null;
      bm25CacheKey++;
      await saveState(ctx?.workingDirectory);
      return { success: true, removed: count };
    },
  };
}

/* =====================================================================
 * STRUCTURED ANSWER BUILDER (enhanced with section paths)
 * ===================================================================== */

async function synthesizeWithLLM(question, evidenceItems, modelProvider) {
  if (!modelProvider || typeof modelProvider.chat !== 'function') return null;

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
          if (!c.sections.some(s => s.join(' › ') === key)) c.sections.push(sectionPath);
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
    if (synthesizedAnswer) answerMethod = 'llm-evidence-based';
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

function condenseForAnswer(text, question, maxChars) {
  if (!text) return '';
  const queryTerms = new Set(
    (String(question || '').toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])
  );
  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  const scored = sentences.map((s, i) => {
    const lower = s.toLowerCase();
    let hit = 0;
    for (const t of queryTerms) if (lower.includes(t)) hit++;
    return { text: s, score: hit, index: i };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  let used = 0;
  for (const s of scored) {
    if (used + s.text.length > maxChars) break;
    picked.push(s);
    used += s.text.length;
  }
  picked.sort((a, b) => a.index - b.index);
  const out = picked.map(p => p.text).join(' ').trim();
  if (!out) return text.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars - 3) + '...' : out;
}

/* =====================================================================
 * DOCUMENT LOADING / PARSING
 * ===================================================================== */

async function loadDocument({ source, content, title }, ctx) {
  if (typeof content === 'string' && content.trim()) {
    return {
      title: title || 'Inline document',
      source: 'inline',
      kind: 'text',
      text: content,
    };
  }

  if (!source) {
    throw new Error('document_add requires either source or content.');
  }

  const sourceValue = String(source).trim();
  if (/^https?:\/\//i.test(sourceValue)) {
    return await loadURL(sourceValue, title);
  }

  return await loadLocalFile(sourceValue, title, ctx?.workingDirectory || process.cwd());
}

async function loadLocalFile(path, title, workingDirectory) {
  const absolutePath = isAbsolute(path) ? path : resolve(workingDirectory, path);
  const fileStat = await stat(absolutePath);
  if (fileStat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is too large (${fileStat.size} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  const buffer = await readFile(absolutePath);
  const kind = inferKind(absolutePath, '');
  const text = await parseBuffer(buffer, kind);
  return {
    title: title || basename(absolutePath),
    source: absolutePath,
    kind,
    text,
  };
}

async function loadURL(url, title) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch document URL: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is too large (${buffer.length} bytes). Limit is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  const kind = inferKind(url, contentType);
  const text = await parseBuffer(buffer, kind);
  return {
    title: title || inferTitleFromURL(url),
    source: url,
    kind,
    text,
  };
}

async function parseBuffer(buffer, kind) {
  if (kind === 'pdf') {
    ensurePdfJsNodeGlobals();
    return await withSuppressedPdfJsCanvasWarnings(async () => {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return normalizeText(result.text || '');
      } finally {
        await parser.destroy();
      }
    });
  }

  if (kind === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return normalizeText(result.value || '');
  }

  const text = buffer.toString('utf-8');
  if (kind === 'html') {
    return cleanHTML(text);
  }
  return normalizeText(text);
}

function ensurePdfJsNodeGlobals() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {};
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {};
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
  }
}

async function withSuppressedPdfJsCanvasWarnings(fn) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args.map(arg => String(arg)).join(' ');
    if (
      message.includes('Cannot load "@napi-rs/canvas"') ||
      message.includes('Cannot polyfill `DOMMatrix`') ||
      message.includes('Cannot polyfill `ImageData`') ||
      message.includes('Cannot polyfill `Path2D`')
    ) {
      return;
    }
    originalWarn(...args);
  };

  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

/* =====================================================================
 * UTILITIES
 * ===================================================================== */

function extractRelevantSnippet(text, query, maxLen) {
  const terms = extractSearchTerms(query || '');
  if (terms.length === 0 || !text) return (text || '').slice(0, maxLen || 500);

  const lines = text.split('\n').filter(Boolean);
  const scored = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = lower.split(term.value).length - 1;
      score += count * term.weight * 10;
    }
    return { text: line, score: score - Math.min(line.length / 100, 1), index: lines.indexOf(line) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find(m => m.score > 0.5);
  if (!best) return (text || '').slice(0, maxLen || 500);

  let startPos = 0;
  for (let i = 0; i < best.index; i++) startPos += lines[i].length + 1;
  return text.substring(startPos, startPos + (maxLen || 500)).trim();
}

function formatSearchResults(results, meta = {}) {
  if (!results || results.length === 0) {
    if (meta.minScore != null) {
      return `No document matches above min_score=${meta.minScore}. Try a lower min_score or broader query.`;
    }
    return 'No document matches found.';
  }

  const header = [
    `Found ${results.length} relevant snippet${results.length === 1 ? '' : 's'}${meta.totalChunks ? ` (from ${meta.totalChunks} indexed chunk${meta.totalChunks === 1 ? '' : 's'})` : ''}.`,
    meta.minScore != null ? `min_score ≥ ${meta.minScore}` : null,
  ].filter(Boolean).join(' ');

  const items = results.map((result, index) => {
    const metadata = result.metadata || {};
    const preview = extractRelevantSnippet(result.text, result.query || '', 500);
    const display = preview.length > 500 ? preview.slice(0, 497) + '...' : preview;
    const scorePct = typeof result.semanticScore === 'number'
      ? Math.round((result.semanticScore + 1) / 2 * 100)
      : Math.round((Number(result.score) + 1) / 2 * 100);
    const sectionPath = metadata.sectionPath
      ? metadata.sectionPath.join(' › ')
      : null;

    const lines = [];
    lines.push(`#${index + 1} [${metadata.title || 'Untitled'}] ${scorePct}%`);
    if (sectionPath) lines.push(`Section: ${sectionPath}`);
    if (metadata.source) lines.push(`Source : ${metadata.source}`);
    if (metadata.chunkIndex) lines.push(`Chunk  : ${metadata.chunkIndex}`);
    if (typeof result.semanticScore === 'number') lines.push(`Semantic: ${result.semanticScore.toFixed(3)}`);
    if (typeof result.lexicalScore === 'number' && result.lexicalScore > 0) {
      lines.push(`Lexical (BM25) : ${result.lexicalScore.toFixed(3)}`);
    }
    lines.push('---');
    lines.push(display);
    return lines.join('\n');
  });

  return header + '\n\n' + items.join('\n\n');
}

function rerankWithLexicalSignals(query, semanticResults) {
  return semanticResults
    .map(result => {
      const semanticScore = Number(result.score) || 0;
      const lexicalScore = computeLexicalScore(query, result.text || '');
      const score = Math.min(1, semanticScore + (lexicalScore * LEXICAL_SCORE_BOOST));
      return { ...result, score, semanticScore, lexicalScore };
    })
    .sort((a, b) => b.score - a.score);
}

function computeLexicalScore(query, text) {
  const queryTerms = extractSearchTerms(query);
  if (queryTerms.length === 0) return 0;
  const normalizedText = normalizeSearchText(text);
  const matchedWeight = queryTerms.reduce((sum, term) => {
    if (!normalizedText.includes(term.value)) return sum;
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
  if (normalized.length < 2 || CHINESE_STOP_TERMS.has(normalized)) return;
  terms.set(normalized, Math.max(terms.get(normalized) || 0, weight));
}

function createCjkGrams(text, size) {
  const chars = Array.from(text).filter(char => /[\p{Script=Han}]/u.test(char));
  const grams = [];
  for (let i = 0; i <= chars.length - size; i++) {
    grams.push(chars.slice(i, i + size).join(''));
  }
  return grams;
}

function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanHTML(html) {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

const CHINESE_STOP_TERMS = new Set(['哪个', '什么', '的是', '是哪个', '做过']);

function normalizeLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 5, 20));
}

function removeDocument(documentId) {
  const existed = documents.delete(documentId);
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].metadata.documentId === documentId) chunks.splice(i, 1);
  }
  if (existed) {
    bm25Cache = null;
    bm25CacheKey++;
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

function sanitizeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inferKind(source, contentType = '') {
  const ext = extname(getURLSafePath(source)).toLowerCase();
  const type = contentType.toLowerCase();
  if (ext === '.pdf' || type.includes('application/pdf')) return 'pdf';
  if (ext === '.docx' || type.includes('wordprocessingml.document')) return 'docx';
  if (ext === '.html' || ext === '.htm' || type.includes('text/html')) return 'html';
  if (ext === '.json' || type.includes('application/json')) return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'text';
}

function getURLSafePath(source) {
  try { return new URL(source).pathname; } catch { return source; }
}

function inferTitleFromURL(url) {
  try {
    const parsed = new URL(url);
    return basename(parsed.pathname) || parsed.hostname;
  } catch { return url; }
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
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
