/**
 * Workspace semantic search backed by the Embedder.
 */

import { readFile, stat } from 'fs/promises';
import { relative, resolve } from 'path';
import { glob } from 'glob';
import { Embedder } from '../../core/embedder.js';
import { ToolCategory } from '../../core/types.js';

const DEFAULT_PATTERN = '**/*.{js,mjs,cjs,ts,tsx,jsx,json,md,txt,yml,yaml,css,html}';
const MAX_FILE_BYTES = 256 * 1024;
const CHUNK_LINES = 80;
const OVERLAP_LINES = 12;

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

function chunkFile(path, content) {
  const lines = content.split('\n');
  const chunks = [];

  for (let start = 0; start < lines.length; start += CHUNK_LINES - OVERLAP_LINES) {
    const end = Math.min(lines.length, start + CHUNK_LINES);
    const text = lines.slice(start, end).join('\n').trim();
    if (text) {
      chunks.push({
        text,
        metadata: {
          path,
          startLine: start + 1,
          endLine: end,
        },
      });
    }
    if (end === lines.length) break;
  }

  return chunks;
}

async function buildIndex(workingDirectory, scopePath, pattern) {
  const root = resolve(workingDirectory, scopePath || '.');
  const cacheKey = `${root}\0${pattern}`;
  const cached = indexCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 30000) {
    return cached.chunks;
  }

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
      '**/package-lock.json',
    ],
  });

  const chunks = [];
  for (const file of files.slice(0, 500)) {
    const fileStat = await stat(file);
    if (fileStat.size > MAX_FILE_BYTES) continue;

    const content = await readFile(file, 'utf-8');
    if (content.includes('\0')) continue;

    const relPath = relative(workingDirectory, file);
    chunks.push(...chunkFile(relPath, content));
  }

  indexCache.set(cacheKey, {
    createdAt: Date.now(),
    chunks,
  });

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
  }).join('\n\n');
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
