/**
 * Workspace semantic search backed by the Embedder.
 */

import { readFile, stat } from 'fs/promises';
import { relative, resolve } from 'path';
import { glob } from 'glob';
import { Embedder } from '../../core/embedder.js';
import { ToolCategory } from '../../core/types.js';
import { VectorIndex } from './vector-index.js';

const DEFAULT_PATTERN = '**/*.{js,mjs,cjs,ts,tsx,jsx,json,md,txt,yml,yaml,css,html}';
const MAX_FILE_BYTES = 256 * 1024;
const CHUNK_LINES = 80;
const OVERLAP_LINES = 12;
const BUILD_TIMEOUT_MS = 60000; // 60秒构建超时
const MAX_INDEX_SIZE_MB = 50; // 索引最大50MB

const indexCache = new Map();
let embedderPromise = null;

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

function normalizeLimit(limit) {
  return Math.max(1, Math.min(Number(limit) || 5, 20));
}

/**
 * Structure-aware code chunking.
 *
 * Strategy (language-agnostic, no regex for syntax):
 *   1. Split file by blank lines → natural sections (function defs, classes, import blocks)
 *   2. Sections <= CHUNK_LINES  → keep as-is
 *   3. Sections >  CHUNK_LINES  → split by top-level indentation resets (zero-regex, works for any brace / indent language)
 *   4. Still too large          → sliding-window fallback (original behaviour)
 *
 * Returns chunks with { text, metadata } that the agent can later use the LLM
 * itself to re-contextualise any truncated code.
 */
function chunkFile(path, content) {
  const lines = content.split('\n');
  const chunks = [];

  // ── Tier 1: split by blank lines (natural logical boundaries) ──
  const blankSections = splitByBlankLines(lines);

  for (const section of blankSections) {
    const sectionLen = section.end - section.start + 1;

    if (sectionLen <= CHUNK_LINES) {
      emitChunk(lines, section.start, section.end);
      continue;
    }

    // ── Tier 2: split large section by top-level indentation ──
    const indentSections = splitByTopLevelIndentation(lines, section.start, section.end);

    // Only use indent split if it actually broke the section up
    if (indentSections.length > 1) {
      for (const sub of indentSections) {
        const subLen = sub.end - sub.start + 1;
        if (subLen <= CHUNK_LINES) {
          emitChunk(lines, sub.start, sub.end);
        } else {
          // ── Tier 3: sliding-window fallback (original behaviour) ──
          slidingWindowFallback(lines, sub.start, sub.end);
        }
      }
    } else {
      // Indent analysis didn't help → fallback
      slidingWindowFallback(lines, section.start, section.end);
    }
  }

  return chunks;

  // ── helpers ──

  function emitChunk(srcLines, s, e) {
    const text = srcLines.slice(s, e).join('\n').trim();
    if (!text) {return;}
    chunks.push({
      text,
      metadata: { path, startLine: s + 1, endLine: e },
    });
  }

  function slidingWindowFallback(srcLines, s, e) {
    for (let i = s; i < e; i += CHUNK_LINES - OVERLAP_LINES) {
      const end = Math.min(e, i + CHUNK_LINES);
      const text = srcLines.slice(i, end).join('\n').trim();
      if (text) {
        chunks.push({
          text,
          metadata: { path, startLine: i + 1, endLine: end },
        });
      }
      if (end >= e) {break;}
    }
  }
}

/**
 * Split lines by blank lines. Returns [{ start, end }] with original line indices.
 */
function splitByBlankLines(lines) {
  const sections = [];
  let sectionStart = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === '') {
      if (i > sectionStart) {
        sections.push({ start: sectionStart, end: i });
      }
      sectionStart = i + 1;
    }
  }
  return sections;
}

/**
 * Split a range of lines by top-level indentation changes.
 * Zero regex for syntax — purely measures whitespace prefix length.
 */
function splitByTopLevelIndentation(lines, rangeStart, rangeEnd) {
  const sections = [];
  let secStart = rangeStart;
  let baseIndent = null;

  for (let i = rangeStart; i < rangeEnd; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines inside the section
    if (!trimmed) {continue;}

    const indent = line.length - trimmed.length;

    if (baseIndent === null) {
      baseIndent = indent;
      continue;
    }

    // A new top-level construct: indentation resets to baseIndent (or less),
    // and there is enough content before it to count as a separate section
    const precededByContent = i - secStart > 1;
    if (precededByContent && indent <= baseIndent && line.trim()) {
      sections.push({ start: secStart, end: i });
      secStart = i;
      // Don't reset baseIndent — keep comparing to original base
    }
  }

  // Last section
  if (secStart < rangeEnd) {
    sections.push({ start: secStart, end: rangeEnd });
  }

  return sections;
}

async function buildIndex(workingDirectory, scopePath, pattern) {
  const root = resolve(workingDirectory, scopePath || '.');
  const cacheKey = `${root}\0${pattern}`;
  const cached = indexCache.get(cacheKey);
  if (cached) {return cached.chunks;}

  // Try persistent on-disk index (survives agent restarts)
  const vIndex = new VectorIndex(workingDirectory);
  const persisted = await vIndex.load(cacheKey);
  if (persisted && !persisted.stale && persisted.chunks) {
    indexCache.set(cacheKey, { chunks: persisted.chunks });
    return persisted.chunks;
  }

  // 带超时的索引构建
  let timedOut = false;

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('Index build timed out after ' + BUILD_TIMEOUT_MS + 'ms'));
    }, BUILD_TIMEOUT_MS);
  });

  const buildPromise = (async () => {
    const files = await glob(pattern, {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.agent-data/**',
        '**/.automation/**',
        '**/.test-temp/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/bun.lock',
      ],
    });

    // 限制文件数量，避免超大项目卡死
    const MAX_FILES = 500;
    const slice = files.slice(0, MAX_FILES);
    
    // Read files concurrently (max 20 at a time)
    const fileEntries = [];
    const CONCURRENCY = 20;
    
    for (let i = 0; i < slice.length; i += CONCURRENCY) {
      if (timedOut) {break;}
      
      const batch = await Promise.all(slice.slice(i, i + CONCURRENCY).map(async (file) => {
        try {
          const fileStat = await stat(file);
          if (fileStat.size > MAX_FILE_BYTES) {return [];}
          const text = await readFile(file, 'utf-8');
          if (text.includes('\0')) {return [];}
          const relPath = relative(workingDirectory, file);
          return chunkFile(relPath, text);
        } catch { return []; }
      }));
      for (const result of batch) {fileEntries.push(...result);}
    }
    
    return fileEntries;
  })();

  let chunks;
  try {
    chunks = await Promise.race([buildPromise, timeoutPromise]);
  } catch (error) {
    if (error.message.includes('timed out')) {
      console.warn('semantic_search: index build timed out, returning partial index');
      // 如果有部分构建结果，返回部分结果
      chunks = [];
    } else {
      throw error;
    }
  }

  const MAX_CHUNKS = 2000;
  if (chunks.length > MAX_CHUNKS) {
    if (typeof process !== "undefined" && process.emitWarning) {
      process.emitWarning("semantic_search: truncating " + chunks.length + " chunks to " + MAX_CHUNKS);
    }
    chunks.length = MAX_CHUNKS;
  }

  // 检查索引大小
  const estimatedSize = JSON.stringify(chunks).length;
  const MAX_INDEX_BYTES = MAX_INDEX_SIZE_MB * 1024 * 1024;
  if (estimatedSize > MAX_INDEX_BYTES) {
    const keepRatio = MAX_INDEX_BYTES / estimatedSize;
    const keepCount = Math.floor(chunks.length * keepRatio);
    if (typeof process !== "undefined" && process.emitWarning) {
      process.emitWarning("semantic_search: index too large (" + Math.round(estimatedSize / 1024 / 1024) + "MB), keeping " + keepCount + " of " + chunks.length + " chunks");
    }
    chunks.length = keepCount;
  }

  // Save to persistent and memory caches
  if (chunks.length > 0) {
    await vIndex.save(cacheKey, chunks);
  }
  indexCache.set(cacheKey, { chunks, builtAt: Date.now() });

  return chunks;
}

function formatResults(results) {
  if (results.length === 0) {
    return 'No semantic matches found.';
  }

  return results.map((result, index) => {
    const { path, startLine, endLine } = result.metadata;
    const preview = result.text
      .split('\n')
      .slice(0, 12)
      .join('\n');
    return [
      `${index + 1}. ${path}:${startLine}-${endLine} score=${result.score.toFixed(3)}`,
      preview,
    ].join('\n');
  }).join('\n\n') + '\n\n---\nChunks are split at structural boundaries (blank lines, indentation). If a chunk looks truncated (starts/ends mid-definition), use read_file on the full file and let the LLM extract the relevant section — do not rely solely on the partial chunk text.';
}

export function createSemanticSearchTool() {
  return {
    name: 'semantic_search',
    description: 'Search the workspace by meaning using embeddings. Use this proactively when the user asks where a concept is implemented, when lexical search may miss synonyms, when recalling project context, or before broad codebase changes.',
    category: ToolCategory.FILESYSTEM,
    params: {
      query: { type: 'string', description: 'Natural-language search query or concept' },
      path: { type: 'string', description: 'Optional directory relative to working directory to limit indexing' },
      pattern: { type: 'string', description: `Optional glob pattern relative to path (default ${DEFAULT_PATTERN})` },
      limit: { type: 'number', description: 'Maximum number of matching chunks to return (default 5, max 20)' },
    },
    required: ['query'],
    handler: async ({ query, path, pattern, limit }, ctx) => {
      const startedAt = Date.now();
      const chunks = await buildIndex(
        ctx.workingDirectory,
        path || '.',
        pattern || DEFAULT_PATTERN
      );

      if (chunks.length === 0) {
        return 'No indexable text files found for semantic search.';
      }

      const embedder = await getEmbedder();
      const results = await embedder.batchFindSimilar(query, chunks, {
        limit: normalizeLimit(limit),
        threshold: 0,
      });

      if (ctx.debug && ctx.ui?.debugEvent) {
        ctx.ui.debugEvent('Semantic search completed', {
          query,
          chunks: chunks.length,
          durationMs: Date.now() - startedAt,
          resultCount: results.length,
        });
      }

      return formatResults(results);
    },
  };
}
