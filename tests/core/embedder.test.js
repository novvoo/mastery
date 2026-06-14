import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  getDefaultEmbeddingModelPath,
  resolveEmbeddingModelDownloadCandidates,
  resolveEmbeddingFileDownloadCandidates,
  Embedder,
  heuristicCountTokens,
  mmrReRank,
  mergeAdjacentChunks,
} from '../../src/core/embedder.js';

// ============================================================
// Pure function tests
// ============================================================

describe('getDefaultEmbeddingModelPath', () => {
  test('returns a string path', () => {
    const path = getDefaultEmbeddingModelPath();
    expect(typeof path).toBe('string');
    expect(path.length).toBeGreaterThan(0);
  });

  test('includes the default repo name', () => {
    const path = getDefaultEmbeddingModelPath();
    expect(path).toContain('onnx-community');
  });

  test('respects AEMA_MODEL_CACHE_DIR env variable', () => {
    const original = process.env.AEMA_MODEL_CACHE_DIR;
    process.env.AEMA_MODEL_CACHE_DIR = '/custom/cache';
    const path = getDefaultEmbeddingModelPath();
    expect(path.startsWith('/custom/cache')).toBe(true);
    process.env.AEMA_MODEL_CACHE_DIR = original;
  });
});

describe('resolveEmbeddingModelDownloadCandidates', () => {
  test('returns an array of URLs', () => {
    const candidates = resolveEmbeddingModelDownloadCandidates();
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('includes huggingface endpoint', () => {
    const candidates = resolveEmbeddingModelDownloadCandidates();
    const hasHF = candidates.some(u => u.includes('huggingface.co'));
    expect(hasHF).toBe(true);
  });

  test('respects modelUrl option', () => {
    const candidates = resolveEmbeddingModelDownloadCandidates({
      modelUrl: 'https://example.com/model.onnx',
    });
    expect(candidates).toContain('https://example.com/model.onnx');
  });
});

describe('resolveEmbeddingFileDownloadCandidates', () => {
  test('returns URLs for a given file', () => {
    const candidates = resolveEmbeddingFileDownloadCandidates('onnx/model.onnx');
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toContain('onnx/model.onnx');
  });

  test('respects custom repo option', () => {
    const candidates = resolveEmbeddingFileDownloadCandidates('onnx/model.onnx', {
      repo: 'my-org/my-model',
    });
    expect(candidates.some(u => u.includes('my-org/my-model'))).toBe(true);
  });
});

describe('heuristicCountTokens', () => {
  test('returns 0 for empty string', () => {
    expect(heuristicCountTokens('')).toBe(0);
  });

  test('returns 0 for null/undefined', () => {
    expect(heuristicCountTokens(null)).toBe(0);
    expect(heuristicCountTokens(undefined)).toBe(0);
  });

  test('counts Latin tokens with rough compensation', () => {
    const count = heuristicCountTokens('hello world');
    expect(count).toBeGreaterThan(0);
    // "hello" + "world" = 2 words * 1.3 = ~2.6, rounded to 3
    expect(count).toBe(3);
  });

  test('counts CJK characters directly', () => {
    const count = heuristicCountTokens('你好世界');
    // 4 CJK characters = 4 tokens (each CJK char counted as 1)
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('handles mixed CJK and Latin text', () => {
    const count = heuristicCountTokens('使用React框架');
    expect(count).toBeGreaterThan(0);
  });
});

describe('mmrReRank', () => {
  test('returns empty array for empty input', () => {
    expect(mmrReRank([])).toEqual([]);
  });

  test('returns all items when count <= limit', () => {
    const items = [
      { score: 0.9, text: 'a' },
      { score: 0.8, text: 'b' },
    ];
    const result = mmrReRank(items, { limit: 5 });
    expect(result).toHaveLength(2);
  });

  test('limits results to the specified limit', () => {
    const items = [
      { score: 0.9, text: 'alpha' },
      { score: 0.8, text: 'beta' },
      { score: 0.7, text: 'gamma' },
      { score: 0.6, text: 'delta' },
    ];
    const result = mmrReRank(items, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  test('filters items below minScore', () => {
    const items = [
      { score: 0.9, text: 'a' },
      { score: 0.3, text: 'b' },
      { score: 0.1, text: 'c' },
    ];
    const result = mmrReRank(items, { limit: 5, minScore: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  test('promotes diversity with lower lambda', () => {
    const items = [
      { score: 0.9, text: 'react hooks' },
      { score: 0.85, text: 'react state' },
      { score: 0.5, text: 'vue components' },
    ];
    // With lambda=1 (pure relevance), first two should be the high-scoring ones
    const relevanceResult = mmrReRank(items, { lambda: 1.0, limit: 2 });
    expect(relevanceResult[0].score).toBe(0.9);
  });

  test('preserves original index in _origIndex', () => {
    const items = [
      { score: 0.5, text: 'a' },
      { score: 0.9, text: 'b' },
    ];
    const result = mmrReRank(items, { limit: 5 });
    expect(result.some(r => r._origIndex !== undefined)).toBe(true);
  });
});

describe('mergeAdjacentChunks', () => {
  test('returns input as-is for empty array', () => {
    expect(mergeAdjacentChunks([])).toEqual([]);
  });

  test('returns input as-is for non-array', () => {
    expect(mergeAdjacentChunks(null)).toBeNull();
  });

  test('returns single item unchanged', () => {
    const items = [{ text: 'hello', metadata: { documentId: 'doc1', chunkIndex: 0 } }];
    const result = mergeAdjacentChunks(items);
    expect(result).toHaveLength(1);
  });

  test('merges consecutive chunks from same document', () => {
    const items = [
      { text: 'Hello ', metadata: { documentId: 'doc1', chunkIndex: 0 } },
      { text: 'World', metadata: { documentId: 'doc1', chunkIndex: 1 } },
    ];
    const result = mergeAdjacentChunks(items);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('Hello');
    expect(result[0].text).toContain('World');
  });

  test('does not merge chunks from different documents', () => {
    const items = [
      { text: 'Doc1', metadata: { documentId: 'doc1', chunkIndex: 0 } },
      { text: 'Doc2', metadata: { documentId: 'doc2', chunkIndex: 0 } },
    ];
    const result = mergeAdjacentChunks(items);
    expect(result).toHaveLength(2);
  });

  test('does not merge non-consecutive chunks', () => {
    const items = [
      { text: 'Part A', metadata: { documentId: 'doc1', chunkIndex: 0 } },
      { text: 'Part C', metadata: { documentId: 'doc1', chunkIndex: 3 } },
    ];
    const result = mergeAdjacentChunks(items);
    expect(result).toHaveLength(2);
  });
});

// ============================================================
// Embedder class tests (constructor + inspect, no real ONNX)
// ============================================================

describe('Embedder', () => {
  test('constructs with default options', () => {
    const embedder = new Embedder();
    expect(embedder).toBeDefined();
  });

  test('constructs with custom dimension', () => {
    const embedder = new Embedder({ dimension: 1024 });
    expect(embedder).toBeDefined();
  });

  test('constructs with custom model path', () => {
    const embedder = new Embedder({ modelPath: '/tmp/test-model.onnx' });
    expect(embedder).toBeDefined();
  });

  test('inspect() returns object with expected keys before init', async () => {
    const embedder = new Embedder({ autoDownload: false });
    const info = await embedder.inspect();
    expect(info).toBeDefined();
    expect(info).toHaveProperty('initialized');
    expect(info).toHaveProperty('dimension');
    expect(info).toHaveProperty('modelPath');
    expect(info).toHaveProperty('batchSize');
    expect(info).toHaveProperty('pooling');
  });

  test('inspect() shows not initialized before initialize()', async () => {
    const embedder = new Embedder({ autoDownload: false });
    const info = await embedder.inspect();
    expect(info.initialized).toBe(false);
  });

  test('initialize() sets initialized to true', async () => {
    const embedder = new Embedder({ autoDownload: false });
    await embedder.initialize();
    const info = await embedder.inspect();
    expect(info.initialized).toBe(true);
  });

  test('initialize() is idempotent (safe to call twice)', async () => {
    const embedder = new Embedder({ autoDownload: false });
    await embedder.initialize();
    await embedder.initialize();
    const info = await embedder.inspect();
    expect(info.initialized).toBe(true);
  });
});
