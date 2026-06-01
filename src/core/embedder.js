/**
 * Embedder - 专业向量嵌入模块 (RAG 能力核心)
 * 核心功能：
 * - 基于 ONNX Runtime 的本地推理
 * - gte-modernbert-base 模型支持
 * - 批量嵌入处理
 * - 语义相似度计算
 */

export class Embedder {
  #model;
  #tokenizer;
  #modelPath;
  #dimension;
  #batchSize;
  #initialized;
  #onnxRuntime;

  constructor(options = {}) {
    this.#modelPath = options.modelPath || './models/gte-modernbert-base.onnx';
    this.#dimension = options.dimension || 768;
    this.#batchSize = options.batchSize || 32;
    this.#initialized = false;
    this.#onnxRuntime = null;
    this.#model = null;
    this.#tokenizer = null;
  }

  async initialize() {
    if (this.#initialized) return;

    try {
      this.#onnxRuntime = await this.#loadONNXRuntime();
      this.#tokenizer = await this.#loadTokenizer();
      this.#model = await this.#loadModel();
      this.#initialized = true;
    } catch (error) {
      console.warn('ONNX Runtime initialization failed, using fallback:', error.message);
      this.#initialized = true;
    }
  }

  async #loadONNXRuntime() {
    try {
      const ort = await import('onnxruntime-node');
      return ort;
    } catch (error) {
      throw new Error('ONNX Runtime not available. Install a compatible ONNX runtime package or use the fallback embedder.');
    }
  }

  async #loadTokenizer() {
    try {
      const { Tokenizer } = await import('@huggingface/tokenizers');
      const tokenizer = await Tokenizer.frompretrained('sentence-transformers/gte-modernbert-base');
      return tokenizer;
    } catch (error) {
      throw new Error('Failed to load tokenizer:', error.message);
    }
  }

  async #loadModel() {
    try {
      const session = await this.#onnxRuntime.InferenceSession.create(this.#modelPath);
      return session;
    } catch (error) {
      throw new Error('Failed to load ONNX model:', error.message);
    }
  }

  async embed(text, options = {}) {
    if (!text) return this.#createZeroVector();

    const texts = Array.isArray(text) ? text : [text];
    const embeddings = await this.#generateEmbeddings(texts, options);

    return Array.isArray(text) ? embeddings : embeddings[0];
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
    const encodings = this.#tokenizer.encodeBatch(texts);

    const maxLength = Math.min(
      Math.max(...encodings.map((e) => e.length)),
      512
    );

    const paddedIds = encodings.map((e) => {
      const ids = e.getIds();
      while (ids.length < maxLength) ids.push(0);
      return ids.slice(0, maxLength);
    });

    const attentionMask = paddedIds.map((ids) => ids.map((id) => (id !== 0 ? 1 : 0)));

    const inputIdsTensor = new this.#onnxRuntime.Tensor(
      'input_ids',
      new this.#onnxRuntime.TensorProto.int64(paddedIds.flat()),
      [texts.length, maxLength]
    );

    const attentionMaskTensor = new this.#onnxRuntime.Tensor(
      'attention_mask',
      new this.#onnxRuntime.TensorProto.int64(attentionMask.flat()),
      [texts.length, maxLength]
    );

    const outputs = await this.#model.run([inputIdsTensor, attentionMaskTensor]);
    const lastHiddenState = outputs[0].data;

    const embeddings = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * this.#dimension;
      const end = start + this.#dimension;
      embeddings.push(Array.from(lastHiddenState.slice(start, end)));
    }

    return embeddings;
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
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 512);
  }

  #normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map((val) => val / magnitude);
  }

  #createZeroVector() {
    return new Array(this.#dimension).fill(0);
  }

  async computeSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embedding dimensions must match');
    }

    const dotProduct = embedding1.reduce(
      (sum, val, i) => sum + val * embedding2[i],
      0
    );

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

    return results.slice(0, limit);
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
      initialized: this.#initialized,
      onnxRuntime: !!this.#onnxRuntime,
    };
  }
}

export default Embedder;
