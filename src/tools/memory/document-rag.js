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
let stateLoaded = false;
let persistDir = null;

function getPersistDir(workingDir) {
  if (!persistDir) {
    persistDir = join(workingDir || process.cwd(), '.agent-data', 'doc-rag');
  }
  return persistDir;
}

async function ensureState(workingDir) {
  if (stateLoaded) return;
  stateLoaded = true;
  const dir = getPersistDir(workingDir);
  try {
    const docJson = await readFile(join(dir, 'documents.json'), 'utf-8');
    const chunkJson = await readFile(join(dir, 'chunks.json'), 'utf-8');
    const loadedDocs = JSON.parse(docJson);
    const loadedChunks = JSON.parse(chunkJson);
    documents.clear();
    chunks.length = 0;
    for (const [key, val] of Object.entries(loadedDocs)) documents.set(key, val);
    chunks.push(...loadedChunks);
  } catch {}
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

      const embedder = await getEmbedder();
      const semanticResults = await embedder.batchFindSimilar(query, scopedChunks, {
        limit: normalizeLimit(limit),
        threshold: 0,
        includeAll: true,
      });
      const results = rerankWithLexicalSignals(query, semanticResults)
        .slice(0, normalizeLimit(limit));

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
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return normalizeText(result.text || '');
    } finally {
      await parser.destroy();
    }
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

function chunkText(text) {
  const normalized = normalizeText(text);
  const result = [];

  for (let start = 0; start < normalized.length; start += CHUNK_CHARS - OVERLAP_CHARS) {
    const end = Math.min(normalized.length, start + CHUNK_CHARS);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      result.push(chunk);
    }
    if (end === normalized.length) {
      break;
    }
  }

  return result;
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

function formatSearchResults(results) {
  if (results.length === 0) {
    return 'No document matches found.';
  }

  return results.map((result, index) => {
    const metadata = result.metadata || {};
    const preview = result.text.slice(0, 1200);
    const scoreDetails = Number.isFinite(result.semanticScore) && Number.isFinite(result.lexicalScore)
      ? ` semantic=${result.semanticScore.toFixed(3)} lexical=${result.lexicalScore.toFixed(3)}`
      : '';
    return [
      `${index + 1}. ${metadata.title} (${metadata.documentId}#${metadata.chunkIndex}) score=${result.score.toFixed(3)}${scoreDetails}`,
      `Source: ${metadata.source}`,
      preview,
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

  for (const term of expandChineseQueryIntent(normalized)) {
    addSearchTerm(terms, term, 0.9);
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

function expandChineseQueryIntent(query) {
  const expansions = [];

  if (/(学校|毕业|学历|学位|本科|硕士|博士|教育)/u.test(query)) {
    expansions.push('教育背景', '本科', '硕士', '博士', '大学', '学院', '计算机科学');
  }

  if (/(工作|做过|经历|岗位|职位|负责|项目|公司|任职)/u.test(query)) {
    expansions.push('工作经历', '工程师', '负责', '项目', '架构', '实现', '公司');
  }

  if (/(邮箱|邮件|email|联系方式|电话|手机)/iu.test(query)) {
    expansions.push('email', 'mail', '电话', '手机', '联系方式');
  }

  return expansions;
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
