/**
 * Document RAG tools for user-provided files, URLs, and raw text.
 */

import { readFile, stat, mkdir, writeFile } from 'fs/promises';
import { basename, extname, isAbsolute, resolve, join } from 'path';
import { Buffer } from 'buffer';
import { URL } from 'url';
import { Embedder } from '../../core/embedder.js';
import { ToolCategory } from '../../core/types.js';

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const CHUNK_CHARS = 2400;
const OVERLAP_CHARS = 300;
const USER_AGENT = 'AI-Engineering-Agent/1.0 (+document-rag)';
const LEXICAL_SCORE_BOOST = 0.25;

const documents = new Map();
const chunks = [];
let embedderPromise = null;

// Document RAG persistence: survives agent restart
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
  await writeFile(join(dir, 'chunks.json'), JSON.stringify(chunks), 'utf-8');
}

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

export function createDocumentRagTools() {
  return [
    createDocumentAddTool(),
    createDocumentSearchTool(),
    createDocumentListTool(),
    createDocumentClearTool(),
  ];
}

function createDocumentAddTool() {
  return {
    name: 'document_add',
    description: 'Add a user document to the document RAG index. Supports local .txt/.md/.json/.html/.pdf/.docx files, http(s) URLs, or raw text content. Use before document_search when the user asks questions about uploaded/provided documents or links.',
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
      const documentChunks = chunkText(parsed.text).map((text, index) => ({
        text,
        metadata: {
          documentId,
          title: parsed.title,
          source: parsed.source,
          kind: parsed.kind,
          chunkIndex: index + 1,
        },
      }));

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
        // Embedding failure is non-fatal: search falls back to batch embedding
        if (typeof process !== 'undefined' && process.emitWarning) {
          process.emitWarning('Document RAG embedding failed: ' + e.message);
        }
      }

      await saveState(ctx?.workingDirectory);

      ctx?.ui?.debugEvent?.('Document added to RAG index', {
        id: documentId,
        title: parsed.title,
        source: parsed.source,
        kind: parsed.kind,
        chunks: documentChunks.length,
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
      };
    },
  };
}

function createDocumentSearchTool() {
  return {
    name: 'document_search',
    description: 'Search previously added user documents by meaning using embeddings. Use this to answer questions grounded in uploaded documents, PDFs, DOCX files, or web document links.',
    category: ToolCategory.FILESYSTEM,
    params: {
      query: { type: 'string', description: 'Natural-language question or concept to search for.' },
      limit: { type: 'number', description: 'Maximum matching chunks to return (default 5, max 20).' },
      document_id: { type: 'string', description: 'Optional document id to restrict search.' },
    },
    required: ['query'],
    handler: async ({ query, limit, document_id }, ctx) => {
      await ensureState(ctx?.workingDirectory);
      const scopedChunks = document_id
        ? chunks.filter(chunk => chunk.metadata.documentId === document_id)
        : chunks;

      if (scopedChunks.length === 0) {
        return 'No documents are indexed yet. Use document_add with a local path, URL, or content first.';
      }

      const maxResults = normalizeLimit(limit);

      // Prefer pre-computed embeddings when available (avoids re-embedding all chunks)
      const hasPrecomputed = scopedChunks.some(c => Array.isArray(c.embedding) && c.embedding.length > 100);
      let results;

      if (hasPrecomputed) {
        const embedder = await getEmbedder();
        const qEmb = await embedder.embed(query);
        results = searchWithEmbeddings(qEmb, query, scopedChunks, maxResults);
      for (const r of results) {r.query = query;}
      }

      // Fallback: batch-embed all chunks (for legacy data or embedding failures)
      if (!results || results.length === 0) {
        const embedder = await getEmbedder();
        const semanticResults = await embedder.batchFindSimilar(query, scopedChunks, {
          limit: maxResults,
          threshold: 0,
          includeAll: true,
        });
        results = rerankWithLexicalSignals(query, semanticResults).slice(0, maxResults);
        // Attach query for snippet extraction
        for (const r of results) {r.query = query;}
      }

      ctx?.ui?.debugEvent?.('Document search completed', {
        query,
        chunks: scopedChunks.length,
        resultCount: results.length,
      });

      return formatSearchResults(results);
    },
  };
}

function createDocumentListTool() {
  return {
    name: 'document_list',
    description: 'List user documents currently loaded into the document RAG index.',
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
        await saveState(ctx?.workingDirectory);
        return { success: removed, removed: removed ? 1 : 0 };
      }
      const count = documents.size;
      documents.clear();
      chunks.length = 0;
      await saveState(ctx?.workingDirectory);
      return { success: true, removed: count };
    },
  };
}

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

function chunkText(text) {
  const normalized = normalizeText(text);

  // Strategy: split by blank lines (paragraphs), merge small ones, split large ones.
  // Only fall back to character split when there are no structural boundaries.

  const paragraphs = normalized.split(/\n{2,}/).filter(Boolean).map(p => p.trim());
  if (paragraphs.length <= 1 && paragraphs[0] && paragraphs[0].length > CHUNK_CHARS) {
    // Single wall of text: try line-by-line, then character split
    const lines = paragraphs[0].split('\n').filter(Boolean).map(l => l.trim());
    if (lines.length > 1) {
      return mergeParagraphs(lines, CHUNK_CHARS);
    }
    // Completely unstructured text — use legacy character split
    return legacyChunkText(normalized);
  }

  return mergeParagraphs(paragraphs, CHUNK_CHARS);
}

/**
 * Merge small paragraphs into CHUNK_CHARS-sized blocks, split oversized ones.
 */
function mergeParagraphs(paragraphs, maxChars) {
  const result = [];
  let buffer = '';
  for (const para of paragraphs) {
    if (!para) {continue;}
    if (para.length > maxChars) {
      // Oversized paragraph: flush buffer first
      if (buffer) { result.push(buffer); buffer = ''; }
      // Split oversized paragraph by semantic boundary closest to midpoint
      const midpoint = Math.floor(para.length / 2);
      const breakAt = para.lastIndexOf('\n', midpoint);
      const first = breakAt > maxChars * 0.3 ? para.slice(0, breakAt).trim() : para.slice(0, maxChars).trim();
      const second = (breakAt > maxChars * 0.3 ? para.slice(breakAt) : para.slice(maxChars)).trim();
      if (first) {result.push(first);}
      if (second) {result.push(second);}
      continue;
    }
    // Merge small paragraphs up to maxChars
    if (buffer.length + para.length + 1 > maxChars) {
      result.push(buffer);
      buffer = para;
    } else {
      buffer = buffer ? buffer + '\n\n' + para : para;
    }
  }
  if (buffer) {result.push(buffer);}
  return result;
}

/** Legacy character-split fallback for completely unstructured text. */
function legacyChunkText(text) {
  const result = [];
  for (let start = 0; start < text.length; start += CHUNK_CHARS - OVERLAP_CHARS) {
    const end = Math.min(text.length, start + CHUNK_CHARS);
    const chunk = text.slice(start, end).trim();
    if (chunk) {result.push(chunk);}
    if (end === text.length) {break;}
  }
  return result;
}

function inferKind(source, contentType = '') {
  const ext = extname(getURLSafePath(source)).toLowerCase();
  const type = contentType.toLowerCase();
  if (ext === '.pdf' || type.includes('application/pdf')) {return 'pdf';}
  if (ext === '.docx' || type.includes('wordprocessingml.document')) {return 'docx';}
  if (ext === '.html' || ext === '.htm' || type.includes('text/html')) {return 'html';}
  if (ext === '.json' || type.includes('application/json')) {return 'json';}
  if (ext === '.md' || ext === '.markdown') {return 'markdown';}
  return 'text';
}

function getURLSafePath(source) {
  try {
    return new URL(source).pathname;
  } catch {
    return source;
  }
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

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function searchWithEmbeddings(queryEmbedding, queryText, scopedChunks, limit) {
  // Direct cosine similarity against pre-computed chunk embeddings
  const scored = [];
  for (let i = 0; i < scopedChunks.length; i++) {
    const chunk = scopedChunks[i];
    if (!chunk.embedding || !Array.isArray(chunk.embedding) || chunk.embedding.length < 100) {continue;}
    let dot = 0;
    for (let j = 0; j < queryEmbedding.length; j++) {dot += queryEmbedding[j] * chunk.embedding[j];}
    const lexicalScore = computeLexicalScore(queryText, chunk.text);
    scored.push({
      index: i,
      text: chunk.text,
      score: dot,
      metadata: chunk.metadata,
      semanticScore: dot,
      lexicalScore,
    });
  }
  // Fallback if no chunks had embeddings
  if (scored.length === 0) {return [];}

  // Rerank with lexical signals
  scored.sort((a, b) => (b.score + b.lexicalScore * LEXICAL_SCORE_BOOST) - (a.score + a.lexicalScore * LEXICAL_SCORE_BOOST));
  return scored.slice(0, limit);
}

function extractRelevantSnippet(text, query, maxLen) {
  const terms = extractSearchTerms(query || '');
  if (terms.length === 0 || !text) {return (text || '').slice(0, 150);}

  const lines = text.split('\n').filter(Boolean);

  // Score each line; penalise long lines at tie-break level to prefer specific matches
  const scored = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = lower.split(term.value).length - 1;
      score += count * term.weight * 10;
    }
    // Tiny length penalty to break ties: prefer short specific lines over long incidental ones
    return { text: line, score: score - Math.min(line.length / 100, 1), index: lines.indexOf(line) };
  });

  // Find best match (highest effective score); start snippet from its position
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find(m => m.score > 0.5);
  if (!best) {return (text || '').slice(0, 150);}

  let startPos = 0;
  for (let i = 0; i < best.index; i++) {
    startPos += lines[i].length + 1;
  }
  return text.substring(startPos, startPos + maxLen).trim();
}

function formatSearchResults(results) {
  if (results.length === 0) {
    return 'No document matches found.';
  }

  return results.map((result, index) => {
    const metadata = result.metadata || {};
    const preview = extractRelevantSnippet(result.text, result.query || '', 400);
    const display = preview.length > 400 ? preview.slice(0, 397) + '...' : preview;
    const pct = Math.round((result.score + 1) / 2 * 100);
    return [
      `[${metadata.title || 'Untitled'}] \u2192 ${pct}% match`,
      display,
      `Source: ${metadata.source}`,
    ].join('\n');
  }).join('\n\n');
}

function rerankWithLexicalSignals(query, semanticResults) {
  return semanticResults
    .map(result => {
      const semanticScore = Number(result.score) || 0;
      const lexicalScore = computeLexicalScore(query, result.text || '');
      const score = Math.min(1, semanticScore + (lexicalScore * LEXICAL_SCORE_BOOST));

      return {
        ...result,
        score,
        semanticScore,
        lexicalScore,
      };
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

const CHINESE_STOP_TERMS = new Set([
  '哪个',
  '什么',
  '的是',
  '是哪个',
  '做过',
]);

function normalizeLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 5, 20));
}

function removeDocument(documentId) {
  const existed = documents.delete(documentId);
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].metadata.documentId === documentId) {
      chunks.splice(i, 1);
    }
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

function inferTitleFromURL(url) {
  try {
    const parsed = new URL(url);
    return basename(parsed.pathname) || parsed.hostname;
  } catch {
    return url;
  }
}

export default createDocumentRagTools;
