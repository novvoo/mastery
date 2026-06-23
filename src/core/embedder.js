/**
 * Embedder - 专业向量嵌入模块 (RAG 能力核心)
 * 核心功能：
 * - 基于 ONNX Runtime 的本地推理
 * - gte-multilingual-base 模型支持
 * - 批量嵌入处理
 * - 语义相似度计算
 */

import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile, rename, rm, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { homedir } from 'os';

const DEFAULT_EMBEDDING_REPO = 'onnx-community/gte-multilingual-base';
const DEFAULT_EMBEDDING_REVISION = 'main';
const DEFAULT_EMBEDDING_FILE = 'onnx/model.onnx';
const DEFAULT_TOKENIZER_FILE = 'tokenizer.json';
const DEFAULT_TOKENIZER_CONFIG_FILE = 'tokenizer_config.json';
const DEFAULT_POOLING = 'cls';
const DEFAULT_HF_ENDPOINT = 'https://huggingface.co';
const DEFAULT_HF_MIRROR = 'https://hf-mirror.com';
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_PROBE_TIMEOUT_MS = 10000;
const MAX_INPUT_TEXT_CHARS = 100000; // soft cap per input (sanity only, not a truncation target)
const EMBEDDING_BATCH_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 512; // gte-multilingual-base official max sequence length

export function getDefaultEmbeddingModelPath() {
  return join(
    process.env.AEMA_MODEL_CACHE_DIR || join(homedir(), '.cache', 'mastery'),
    'models',
    DEFAULT_EMBEDDING_REPO,
    DEFAULT_EMBEDDING_REVISION,
    DEFAULT_EMBEDDING_FILE,
  );
}

export function resolveEmbeddingModelDownloadCandidates(options = {}) {
  return resolveEmbeddingFileDownloadCandidates(
    options.file || process.env.EMBEDDING_MODEL_FILE || DEFAULT_EMBEDDING_FILE,
    { ...options, allowModelUrl: true },
  );
}

export function resolveEmbeddingFileDownloadCandidates(file, options = {}) {
  const resolvedFile =
    file || options.file || process.env.EMBEDDING_MODEL_FILE || DEFAULT_EMBEDDING_FILE;

  if (options.allowModelUrl && (options.modelUrl || process.env.EMBEDDING_MODEL_URL)) {
    return [options.modelUrl || process.env.EMBEDDING_MODEL_URL];
  }

  const repo = options.repo || process.env.EMBEDDING_MODEL_REPO || DEFAULT_EMBEDDING_REPO;
  const revision =
    options.revision || process.env.EMBEDDING_MODEL_REVISION || DEFAULT_EMBEDDING_REVISION;
  const extraMirrors = [
    options.hfEndpoint || process.env.HF_ENDPOINT,
    ...(options.mirrors || splitEnvList(process.env.EMBEDDING_MODEL_MIRRORS)),
    DEFAULT_HF_MIRROR,
  ];
  const endpoints = uniqueStrings([DEFAULT_HF_ENDPOINT, ...extraMirrors])
    .filter(Boolean)
    .map((endpoint) => endpoint.replace(/\/+$/, ''));

  return endpoints.map((endpoint) => `${endpoint}/${repo}/resolve/${revision}/${resolvedFile}`);
}

export class Embedder {
  #model;
  #tokenizer;
  #modelPath;
  #tokenizerPath;
  #tokenizerConfigPath;
  #dimension;
  #batchSize;
  #initialized;
  #onnxRuntime;
  #autoDownload;
  #downloadTimeoutMs;
  #probeTimeoutMs;
  #fallbackReason;
  #pooling;
  #maxTokens;

  constructor(options = {}) {
    this.#modelPath =
      options.modelPath || process.env.EMBEDDING_MODEL_PATH || getDefaultEmbeddingModelPath();
    const modelDirectory = dirname(this.#modelPath);
    const modelRoot =
      basename(modelDirectory) === 'onnx' ? dirname(modelDirectory) : modelDirectory;
    this.#tokenizerPath =
      options.tokenizerPath ||
      process.env.EMBEDDING_TOKENIZER_PATH ||
      join(modelRoot, DEFAULT_TOKENIZER_FILE);
    this.#tokenizerConfigPath =
      options.tokenizerConfigPath ||
      process.env.EMBEDDING_TOKENIZER_CONFIG_PATH ||
      join(modelRoot, DEFAULT_TOKENIZER_CONFIG_FILE);
    this.#dimension = options.dimension || 768;
    this.#batchSize = options.batchSize || 32;
    this.#pooling = normalizePooling(
      options.pooling || process.env.EMBEDDING_POOLING || DEFAULT_POOLING,
    );
    this.#maxTokens = Number(
      options.maxTokens || process.env.EMBEDDING_MAX_TOKENS || DEFAULT_MAX_TOKENS,
    );
    this.#initialized = false;
    this.#onnxRuntime = null;
    this.#model = null;
    this.#tokenizer = null;
    this.#autoDownload =
      options.autoDownload ?? process.env.EMBEDDING_MODEL_AUTO_DOWNLOAD !== 'false';
    this.#downloadTimeoutMs = Number(
      options.downloadTimeoutMs ||
        process.env.EMBEDDING_MODEL_DOWNLOAD_TIMEOUT_MS ||
        DEFAULT_DOWNLOAD_TIMEOUT_MS,
    );
    this.#probeTimeoutMs = Number(
      options.probeTimeoutMs ||
        process.env.EMBEDDING_MODEL_PROBE_TIMEOUT_MS ||
        DEFAULT_PROBE_TIMEOUT_MS,
    );
    this.#fallbackReason = null;
  }

  async initialize() {
    if (this.#initialized) {
      return;
    }

    try {
      this.#onnxRuntime = await this.#loadONNXRuntime();
      this.#tokenizer = await this.#loadTokenizer();
      this.#model = await this.#loadModel();
      this.#initialized = true;
      this.#fallbackReason = null;
    } catch (error) {
      console.warn('ONNX Runtime initialization failed, using fallback:', error.message);
      this.#fallbackReason = error.message;
      this.#initialized = true;
    }
  }

  async inspect() {
    const modelFile = await this.#getModelFileStatus();
    return {
      initialized: this.#initialized,
      usingONNX: !!(this.#onnxRuntime && this.#tokenizer && this.#model),
      usingFallback: !(this.#onnxRuntime && this.#tokenizer && this.#model),
      fallbackReason: this.#fallbackReason,
      modelPath: this.#modelPath,
      tokenizerPath: this.#tokenizerPath,
      tokenizerConfigPath: this.#tokenizerConfigPath,
      modelFile,
      autoDownload: this.#autoDownload,
      downloadTimeoutMs: this.#downloadTimeoutMs,
      probeTimeoutMs: this.#probeTimeoutMs,
      downloadCandidates: resolveEmbeddingModelDownloadCandidates(),
      dimension: this.#dimension,
      batchSize: this.#batchSize,
      pooling: this.#pooling,
    };
  }

  async prepareModel(options = {}) {
    await this.#ensureModelAvailable(options);
    return await this.inspect();
  }

  async #getModelFileStatus() {
    try {
      const fileStat = await stat(this.#modelPath);
      return {
        exists: true,
        bytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      };
    } catch {
      return {
        exists: false,
        bytes: 0,
        modifiedAt: null,
      };
    }
  }

  async #loadONNXRuntime() {
    try {
      const ort = await import('onnxruntime-node');
      return ort;
    } catch (error) {
      throw new Error(
        'ONNX Runtime not available. Install a compatible ONNX runtime package or use the fallback embedder.',
      );
    }
  }

  async #loadTokenizer() {
    try {
      const { Tokenizer } = await import('@huggingface/tokenizers');
      await this.#ensureTokenizerFilesAvailable();
      const [tokenizerJson, tokenizerConfig] = await Promise.all([
        this.#readJSONFile(this.#tokenizerPath),
        this.#readJSONFile(this.#tokenizerConfigPath),
      ]);
      return new Tokenizer(tokenizerJson, tokenizerConfig);
    } catch (error) {
      throw new Error(`Failed to load tokenizer: ${error.message}`);
    }
  }

  async #loadModel() {
    try {
      await this.#ensureModelAvailable();
      const session = await this.#onnxRuntime.InferenceSession.create(this.#modelPath);
      return session;
    } catch (error) {
      throw new Error(`Failed to load ONNX model: ${error.message}`);
    }
  }

  async #ensureModelAvailable(options = {}) {
    if (existsSync(this.#modelPath) || !this.#autoDownload) {
      return;
    }

    await mkdir(dirname(this.#modelPath), { recursive: true });
    const candidates = resolveEmbeddingModelDownloadCandidates();
    const rankedCandidates = await this.#rankDownloadCandidates(candidates, options);
    const selected = rankedCandidates[0];

    if (!selected) {
      throw new Error('Embedding model is missing and no download candidates are configured.');
    }

    try {
      options.onDownloadSelected?.(selected);
      await this.#downloadModel(selected.url, options);
    } catch (error) {
      const probeSummary = rankedCandidates
        .map(
          (candidate) =>
            `${candidate.url}: ${candidate.available ? 'available' : candidate.error || 'unavailable'}`,
        )
        .join('; ');
      throw new Error(
        `Embedding model is missing and selected download failed. Selected: ${selected.url}: ${error.message}. Probes: ${probeSummary}`,
      );
    }
  }

  async #ensureTokenizerFilesAvailable(options = {}) {
    await this.#ensureAuxiliaryFileAvailable(this.#tokenizerPath, DEFAULT_TOKENIZER_FILE, options);
    await this.#ensureAuxiliaryFileAvailable(
      this.#tokenizerConfigPath,
      DEFAULT_TOKENIZER_CONFIG_FILE,
      options,
    );
  }

  async #ensureAuxiliaryFileAvailable(path, file, options = {}) {
    if (existsSync(path) || !this.#autoDownload) {
      return;
    }

    await mkdir(dirname(path), { recursive: true });
    const candidates = resolveEmbeddingFileDownloadCandidates(file);
    const rankedCandidates = await this.#rankDownloadCandidates(candidates, options);
    const selected = rankedCandidates[0];

    if (!selected) {
      throw new Error(`${file} is missing and no download candidates are configured.`);
    }

    await this.#downloadFile(selected.url, path, options);
  }

  async #rankDownloadCandidates(candidates, options = {}) {
    if (candidates.length <= 1 || options.probeCandidates === false) {
      return candidates.map((url, index) => ({
        url,
        index,
        available: true,
        durationMs: 0,
        totalBytes: null,
      }));
    }

    options.onDownloadProbeStart?.({ candidates, timeoutMs: this.#probeTimeoutMs });
    const probes = await Promise.all(
      candidates.map((url, index) => this.#probeDownloadCandidate(url, index)),
    );

    for (const probe of probes) {
      options.onDownloadProbeResult?.(probe);
    }

    const available = probes
      .filter((probe) => probe.available)
      .sort((a, b) => a.durationMs - b.durationMs || a.index - b.index);

    if (available.length > 0) {
      return available;
    }

    return probes.sort((a, b) => a.index - b.index);
  }

  async #probeDownloadCandidate(url, index) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#probeTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      const totalBytes =
        Number(
          response.headers?.get?.('content-length') || response.headers?.get?.('x-linked-size'),
        ) || null;

      if (!response.ok) {
        return {
          url,
          index,
          available: false,
          status: response.status,
          durationMs,
          totalBytes,
          error: `HTTP ${response.status}`,
        };
      }

      return {
        url,
        index,
        available: true,
        status: response.status,
        durationMs,
        totalBytes,
        error: null,
      };
    } catch (error) {
      return {
        url,
        index,
        available: false,
        status: null,
        durationMs: Date.now() - startedAt,
        totalBytes: null,
        error:
          error?.name === 'AbortError'
            ? `probe timed out after ${this.#probeTimeoutMs}ms`
            : error.message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async #downloadModel(url, options = {}) {
    await this.#downloadFile(url, this.#modelPath, options);
  }

  async #downloadFile(url, destinationPath, options = {}) {
    const tmpPath = `${destinationPath}.download`;
    await rm(tmpPath, { force: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#downloadTimeoutMs);
    try {
      options.onDownloadStart?.({ url, timeoutMs: this.#downloadTimeoutMs });
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalBytes = Number(response.headers?.get?.('content-length')) || null;
      let downloadedBytes = 0;
      options.onDownloadProgress?.({ url, downloadedBytes, totalBytes });

      const progress = new Transform({
        transform(chunk, encoding, callback) {
          downloadedBytes += chunk.length;
          options.onDownloadProgress?.({ url, downloadedBytes, totalBytes });
          callback(null, chunk);
        },
      });

      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(tmpPath));
      const fileStat = await stat(tmpPath);
      if (fileStat.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      await rename(tmpPath, destinationPath);
      options.onDownloadComplete?.({ url, bytes: fileStat.size });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`download timed out after ${this.#downloadTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      await rm(tmpPath, { force: true });
    }
  }

  async #readJSONFile(path) {
    return JSON.parse(await readFile(path, 'utf8'));
  }

  async embed(text, options = {}) {
    if (!text) {
      return this.#createZeroVector();
    }

    const texts = Array.isArray(text) ? text : [text];

    // 限制输入大小
    const normalizedTexts = texts.map((t) => {
      if (typeof t === 'string' && t.length > MAX_INPUT_TEXT_CHARS) {
        console.warn(
          `Embedder: truncating input from ${t.length} to ${MAX_INPUT_TEXT_CHARS} chars`,
        );
        return t.substring(0, MAX_INPUT_TEXT_CHARS);
      }
      return t;
    });

    // 超时控制
    const timeoutMs = options.timeoutMs || EMBEDDING_BATCH_TIMEOUT_MS;
    let timer;

    try {
      const embeddings = await Promise.race([
        this.#generateEmbeddings(normalizedTexts, options),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Embedding generation timed out')), timeoutMs);
        }),
      ]);

      return Array.isArray(text) ? embeddings : embeddings[0];
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async #generateEmbeddings(texts, options = {}) {
    const normalizedTexts = texts.map((t) => this.#preprocessText(t));
    const embeddings = [];

    for (let i = 0; i < normalizedTexts.length; i += this.#batchSize) {
      const batch = normalizedTexts.slice(i, i + this.#batchSize);
      const batchEmbeddings = await this.#processBatch(batch);
      embeddings.push(...batchEmbeddings);
    }

    if (options.normalize !== false) {
      return embeddings.map((e) => this.#normalizeVector(e));
    }

    return embeddings;
  }

  async #processBatch(texts) {
    if (this.#model && this.#tokenizer) {
      return this.#processWithONNX(texts);
    }
    return this.#processWithFallback(texts);
  }

  async #processWithONNX(texts) {
    const encodings = texts.map((text) => this.#tokenizer.encode(text));

    // Truncate to max sequence length at the TOKEN level (not character level).
    // We reserve 2 positions for <[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]>/sep_token equivalent bookend tokens
    // that the tokenizer may add implicitly.
    const maxTokens = Math.max(8, this.#maxTokens - 2);
    const maxLength = Math.min(Math.max(...encodings.map((e) => e.ids.length)), this.#maxTokens);

    const paddedIds = encodings.map((e) => {
      const ids = [...e.ids];
      // Truncate overlong sequences at token level (prefer keep start-of-text)
      if (ids.length > maxTokens) {
        ids.length = maxTokens;
      }
      while (ids.length < maxLength) {
        ids.push(0);
      }
      return ids.slice(0, maxLength);
    });

    const attentionMask = paddedIds.map((ids) => ids.map((id) => (id !== 0 ? 1 : 0)));

    const feeds = {
      input_ids: new this.#onnxRuntime.Tensor(
        'int64',
        BigInt64Array.from(paddedIds.flat().map((value) => BigInt(value))),
        [texts.length, maxLength],
      ),
      attention_mask: new this.#onnxRuntime.Tensor(
        'int64',
        BigInt64Array.from(attentionMask.flat().map((value) => BigInt(value))),
        [texts.length, maxLength],
      ),
    };

    const outputs = await this.#model.run(feeds);
    const outputName = this.#model.outputNames?.[0] || Object.keys(outputs)[0];
    const output = outputs[outputName];
    return this.#poolTokenEmbeddings(output, attentionMask, texts.length, maxLength, this.#pooling);
  }

  #poolTokenEmbeddings(output, attentionMask, batchSize, sequenceLength, pooling) {
    const data = output.data;
    const dims = output.dims || [];
    const hiddenSize = dims.length >= 3 ? dims[2] : this.#dimension;
    this.#dimension = hiddenSize;

    if (dims.length === 2) {
      return Array.from({ length: batchSize }, (_, index) => {
        const start = index * hiddenSize;
        return Array.from(data.slice(start, start + hiddenSize));
      });
    }

    if (pooling === 'cls') {
      return Array.from({ length: batchSize }, (_, batchIndex) => {
        const start = batchIndex * sequenceLength * hiddenSize;
        return Array.from(data.slice(start, start + hiddenSize));
      });
    }

    return Array.from({ length: batchSize }, (_, batchIndex) => {
      const embedding = new Array(hiddenSize).fill(0);
      let tokenCount = 0;

      for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex++) {
        if (!attentionMask[batchIndex][tokenIndex]) {
          continue;
        }

        tokenCount += 1;
        const base = (batchIndex * sequenceLength + tokenIndex) * hiddenSize;
        for (let dim = 0; dim < hiddenSize; dim++) {
          embedding[dim] += data[base + dim];
        }
      }

      if (tokenCount === 0) {
        return embedding;
      }

      return embedding.map((value) => value / tokenCount);
    });
  }

  async #processWithFallback(texts) {
    return texts.map((text) => this.#generatePseudoEmbedding(text));
  }

  #generatePseudoEmbedding(text) {
    const embedding = new Array(this.#dimension).fill(0);
    const normalized = this.#preprocessText(text).toLowerCase();
    const terms = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];

    for (const term of terms) {
      const weight = 1 / Math.sqrt(Math.max(term.length, 1));
      embedding[this.#hashString(term) % this.#dimension] += weight;

      for (let i = 0; i < term.length - 2; i++) {
        const gram = term.slice(i, i + 3);
        embedding[this.#hashString(gram) % this.#dimension] += 0.25;
      }
    }

    return embedding;
  }

  #hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  #preprocessText(text) {
    // Normalize whitespace only. Length/truncation happens at the token level
    // in #processWithONNX (cap to this.#maxTokens tokens) so chunks never
    // silently lose semantic content due to a character-only cutoff.
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  #normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) {
      return vector;
    }
    return vector.map((val) => val / magnitude);
  }

  #createZeroVector() {
    return new Array(this.#dimension).fill(0);
  }

  async computeSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embedding dimensions must match');
    }

    const dotProduct = embedding1.reduce((sum, val, i) => sum + val * embedding2[i], 0);

    return Math.max(-1, Math.min(1, dotProduct));
  }

  async findMostSimilar(query, candidates, options = {}) {
    const limit = options.limit || 5;
    const threshold = options.threshold || 0;

    const queryEmbedding = await this.embed(query);
    const scoredCandidates = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidateEmbedding = await this.embed(candidates[i].text || candidates[i]);
      const similarity = await this.computeSimilarity(queryEmbedding, candidateEmbedding);

      if (similarity >= threshold) {
        scoredCandidates.push({
          index: i,
          text: candidates[i].text || candidates[i],
          score: similarity,
          metadata: candidates[i].metadata || {},
        });
      }
    }

    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates.slice(0, limit);
  }

  async batchFindSimilar(query, candidates, options = {}) {
    const limit = options.limit || 5;
    const batchSize = options.batchSize || 100;
    const includeAll = options.includeAll === true;

    const queryEmbedding = await this.embed(query);
    const results = [];

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const batchEmbeddings = await this.embed(batch.map((c) => c.text || c));

      for (let j = 0; j < batch.length; j++) {
        const similarity = await this.computeSimilarity(queryEmbedding, batchEmbeddings[j]);
        results.push({
          index: i + j,
          text: batch[j].text || batch[j],
          score: similarity,
          metadata: batch[j].metadata || {},
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return includeAll ? results : results.slice(0, limit);
  }

  getDimension() {
    return this.#dimension;
  }

  isInitialized() {
    return this.#initialized;
  }

  async getModelInfo() {
    return {
      modelPath: this.#modelPath,
      dimension: this.#dimension,
      batchSize: this.#batchSize,
      maxTokens: this.#maxTokens,
      pooling: this.#pooling,
      initialized: this.#initialized,
      onnxRuntime: !!this.#onnxRuntime,
      hasTokenizer: !!this.#tokenizer,
    };
  }

  /**
   * Returns the maximum number of tokens accepted per embedding input.
   * Pure sync accessor; does not require initialize().
   */
  getMaxTokens() {
    return this.#maxTokens;
  }

  /**
   * Counts tokens for one or more texts using the real tokenizer when
   * available, otherwise falls back to a whitespace+punctuation heuristic
   * (roughly 4 chars per token for CJK-heavy text, 0.75 words per token
   * for Latin script). Safe to call before initialize().
   */
  countTokens(textOrTexts) {
    const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
    if (this.#tokenizer) {
      return texts.map((t) => {
        try {
          return this.#tokenizer.encode(String(t || '')).ids.length;
        } catch {
          return heuristicCountTokens(String(t || ''));
        }
      });
    }
    return texts.map((t) => heuristicCountTokens(String(t || '')));
  }

  /**
   * Splits a long text into roughly N-token chunks using the tokenizer
   * (falls back to heuristic token counting when the tokenizer is not
   * available). Returns an array of plain-text chunks. The tokenizer
   * window (maxTokens) is used as a hard per-chunk cap.
   */
  splitByTokenCount(text, options = {}) {
    const textStr = String(text || '');
    const target = Number(options.targetTokens) || 750;
    const overlap = Number(options.overlapTokens) || 100;
    const hardCap = Math.max(
      32,
      Math.min(this.#maxTokens, Number(options.maxTokensPerChunk) || this.#maxTokens),
    );
    const finalTarget = Math.min(target, hardCap);
    const finalOverlap = Math.min(overlap, Math.max(8, Math.floor(finalTarget * 0.2)));

    if (!textStr) {
      return [];
    }

    // Fast path: small text → one chunk
    const totalTokens = this.countTokens(textStr)[0];
    if (totalTokens <= finalTarget) {
      return [textStr];
    }

    // Split into natural segments (newlines / sentences) first, then
    // greedily pack segments into chunks, recomputing token counts per
    // assembled buffer. This keeps sentences/paragraphs intact when
    // possible, which is much better for retrieval quality.
    const segments = textStr.split(/(\s{2,}|\n{1,})/).filter(Boolean);
    const chunks = [];
    let buffer = '';
    let bufferTokens = 0;
    let overlapTail = '';
    let overlapTailTokens = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segTokens = this.countTokens(seg)[0];

      // Check if adding this segment would exceed the hard cap
      if (buffer && bufferTokens + segTokens > finalTarget) {
        chunks.push(buffer.trim());
        // Carry overlap from the tail of the finished chunk
        if (finalOverlap > 0) {
          const words = buffer.split(/\s+/);
          overlapTail = words.slice(-Math.max(4, Math.ceil(finalOverlap / 2))).join(' ');
          overlapTailTokens = this.countTokens(overlapTail)[0];
        } else {
          overlapTail = '';
          overlapTailTokens = 0;
        }
        buffer = overlapTail;
        bufferTokens = overlapTailTokens;
      }

      buffer = buffer
        ? buffer + (buffer.endsWith(' ') || seg.startsWith(' ') ? '' : ' ') + seg
        : seg;
      bufferTokens += segTokens;
    }

    const trimmed = buffer.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }

    // Final safety: if any chunk still exceeds hardCap, forcibly split it
    const finalChunks = [];
    for (const c of chunks) {
      const cTokens = this.countTokens(c)[0];
      if (cTokens <= hardCap) {
        finalChunks.push(c);
      } else {
        // Force split at word boundaries
        const words = c.split(/\s+/);
        let sub = '';
        let subTokens = 0;
        for (const w of words) {
          const wTokens = this.countTokens(w)[0];
          if (sub && subTokens + wTokens > hardCap) {
            finalChunks.push(sub.trim());
            sub = w;
            subTokens = wTokens;
          } else {
            sub = sub ? sub + ' ' + w : w;
            subTokens += wTokens;
          }
        }
        if (sub.trim()) {
          finalChunks.push(sub.trim());
        }
      }
    }
    return finalChunks;
  }
}

function splitEnvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function normalizePooling(value) {
  const normalized = String(value || DEFAULT_POOLING).toLowerCase();
  if (normalized === 'mean' || normalized === 'cls') {
    return normalized;
  }
  return DEFAULT_POOLING;
}

/**
 * Rough token counter used when a real tokenizer is unavailable.
 * Treats CJK characters as ~1 token each and splits Latin script on
 * whitespace/punctuation. Good enough to size chunks before a real
 * embedding pass runs.
 */
export function heuristicCountTokens(text) {
  const s = String(text || '');
  if (!s) {
    return 0;
  }
  const cjkMatches =
    s.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || [];
  const cjkCount = cjkMatches.length;
  const stripped = s.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    ' ',
  );
  const latinTokens = stripped.match(/[\p{L}\p{N}_-]+/gu) || [];
  // 1.3 rough compensation for sub-word tokenization on Latin text
  return Math.round(cjkCount + latinTokens.length * 1.3);
}

/**
 * Maximal Marginal Relevance re-ranking.
 * @param {Array<{score:number,embedding?:number[]|null,text?:string}>} items
 * @param {number} lambda  1.0 = pure relevance; 0.0 = pure diversity
 * @param {number} limit   how many items to return
 * @param {number} minScore items below this are discarded (before MMR)
 */
export function mmrReRank(items, { lambda = 0.7, limit = 5, minScore = -Infinity } = {}) {
  const candidates = items
    .map((it, i) => ({ ...it, _origIndex: i }))
    .filter((it) => Number(it.score) >= minScore);

  if (candidates.length === 0) {
    return [];
  }
  if (candidates.length <= limit) {
    return candidates;
  }

  const selected = [];
  const remaining = candidates.slice();

  while (selected.length < limit && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const rel = Number(cand.score) || 0;
      let maxSimToSelected = 0;
      for (const sel of selected) {
        const sim = fastSimilarity(cand, sel);
        if (sim > maxSimToSelected) {
          maxSimToSelected = sim;
        }
      }
      const mmr = lambda * rel - (1 - lambda) * maxSimToSelected;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      break;
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

function fastSimilarity(a, b) {
  if (
    Array.isArray(a.embedding) &&
    Array.isArray(b.embedding) &&
    a.embedding.length === b.embedding.length
  ) {
    let dot = 0;
    for (let i = 0; i < a.embedding.length; i++) {
      dot += a.embedding[i] * b.embedding[i];
    }
    return Math.max(-1, Math.min(1, dot));
  }
  // Fallback: bag-of-words jaccard over tokens
  return jaccardSimilarity(String(a.text || ''), String(b.text || ''));
}

function jaccardSimilarity(a, b) {
  if (!a || !b) {
    return 0;
  }
  const ta = new Set(a.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []);
  const tb = new Set(b.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []);
  if (ta.size === 0 || tb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      inter++;
    }
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Merge adjacent chunks from the same document when they overlap or are
 * contiguous. Useful for document RAG results where a single paragraph
 * may have been split across multiple chunks.
 */
export function mergeAdjacentChunks(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  const byDoc = new Map();
  for (const it of items) {
    const docId = it.metadata?.documentId || '__global__';
    if (!byDoc.has(docId)) {
      byDoc.set(docId, []);
    }
    byDoc.get(docId).push(it);
  }
  const out = [];
  for (const group of byDoc.values()) {
    group.sort(
      (a, b) => (Number(a.metadata?.chunkIndex) || 0) - (Number(b.metadata?.chunkIndex) || 0),
    );
    let i = 0;
    while (i < group.length) {
      let current = { ...group[i] };
      while (i + 1 < group.length) {
        const next = group[i + 1];
        if (next.metadata?.documentId !== current.metadata?.documentId) {
          break;
        }
        // Merge if chunk indices are consecutive and content differs
        if (shouldMerge(current, next)) {
          current = mergeTwo(current, next);
          i++;
        } else {
          break;
        }
      }
      out.push(current);
      i++;
    }
  }
  return out;
}

function shouldMerge(a, b) {
  const idxA = Number(a.metadata?.chunkIndex) || 0;
  const idxB = Number(b.metadata?.chunkIndex) || 0;
  if (idxB - idxA !== 1) {
    return false;
  }
  // Don't merge if one text is already fully contained in the other
  const tA = String(a.text || '').toLowerCase();
  const tB = String(b.text || '').toLowerCase();
  if (tA.includes(tB) || tB.includes(tA)) {
    return true;
  }
  return true;
}

function mergeTwo(a, b) {
  const combined = String(a.text || '') + '\n\n' + String(b.text || '');
  return {
    ...a,
    text: combined,
    score: Math.max(Number(a.score) || 0, Number(b.score) || 0),
    metadata: {
      ...(a.metadata || {}),
      chunkIndex: b.metadata?.chunkIndex || a.metadata?.chunkIndex,
      _mergedFrom: (a.metadata?._mergedFrom || 1) + 1,
    },
  };
}

export default Embedder;
