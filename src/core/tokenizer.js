/**
 * Tokenizer - 跨平台一致性分词模块
 * 核心功能：
 * - 基于 @huggingface/tokenizers 的确定性分词
 * - 多种模型支持 (GPT, Claude, Gemini 等)
 * - 跨平台一致的 Token 计数
 * - 序列化和缓存支持
 */

const MODEL_CONFIGS = {
  'gpt-4': { vocab_size: 100256, model_type: 'cl100k_base' },
  'gpt-4o': { vocab_size: 100256, model_type: 'cl100k_base' },
  'gpt-4o-mini': { vocab_size: 100256, model_type: 'cl100k_base' },
  'gpt-4-turbo': { vocab_size: 100256, model_type: 'cl100k_base' },
  'claude': { vocab_size: 32000, model_type: 'o200k_base' },
  'claude-3': { vocab_size: 32000, model_type: 'o200k_base' },
  'gemini': { vocab_size: 256000, model_type: 'tiktoken' },
  'default': { vocab_size: 100256, model_type: 'cl100k_base' },
};

export class Tokenizer {
  #tokenizer;
  #modelName;
  #config;
  #initialized;
  #cache;

  constructor(options = {}) {
    this.#modelName = options.model || 'gpt-4o';
    this.#config = MODEL_CONFIGS[this.#modelName] || MODEL_CONFIGS.default;
    this.#initialized = false;
    this.#cache = new Map();
    this.#tokenizer = null;
  }

  async initialize() {
    if (this.#initialized) return;

    try {
      const { Tokenizer } = await import('@huggingface/tokenizers');
      const modelType = this.#config.model_type;

      let pretrainedName;
      switch (modelType) {
        case 'cl100k_base':
          pretrainedName = 'gpt-4';
          break;
        case 'o200k_base':
          pretrainedName = 'claude';
          break;
        default:
          pretrainedName = 'gpt-4';
      }

      this.#tokenizer = await Tokenizer.frompretrained(`Xenova/${pretrainedName}-tokenizer`);
      this.#initialized = true;
    } catch (error) {
      console.warn('Tokenizer initialization warning:', error.message);
      this.#initialized = true;
    }
  }

  async encode(text, options = {}) {
    if (!text) return [];

    const cacheKey = `${text}_${options.addSpecialTokens || false}`;
    if (this.#cache.has(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    if (this.#tokenizer) {
      const encoding = this.#tokenizer.encode(text, {
        addSpecialTokens: options.addSpecialTokens !== false,
      });
      const tokens = Array.from(encoding.getIds());

      if (options.cache !== false) {
        this.#cache.set(cacheKey, tokens);
      }

      return tokens;
    }

    return this.#fallbackEncode(text);
  }

  async decode(tokens, options = {}) {
    if (!tokens || tokens.length === 0) return '';

    if (this.#tokenizer) {
      return this.#tokenizer.decode(tokens, {
        skipSpecialTokens: options.skipSpecialTokens || false,
      });
    }

    return this.#fallbackDecode(tokens);
  }

  async countTokens(text) {
    const tokens = await this.encode(text);
    return tokens.length;
  }

  async countTokensBatch(texts) {
    const results = [];
    for (const text of texts) {
      results.push(await this.countTokens(text));
    }
    return results;
  }

  #fallbackEncode(text) {
    const chars = text.split('');
    const tokens = [];
    let i = 0;

    while (i < chars.length) {
      let len = Math.min(4, chars.length - i);

      while (i + len > chars.length) {
        len--;
      }

      const chunk = chars.slice(i, i + len).join('');

      if (this.#isValidUTF8(chunk)) {
        tokens.push(this.#hashChunk(chunk));
      } else {
        tokens.push(this.#hashChunk(chars[i]));
        i++;
        continue;
      }

      i += len;
    }

    return tokens;
  }

  #isValidUTF8(str) {
    try {
      return decodeURIComponent(encodeURIComponent(str)) === str;
    } catch {
      return false;
    }
  }

  #hashChunk(chunk) {
    let hash = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % this.#config.vocab_size;
  }

  #fallbackDecode(tokens) {
    return tokens.map((t) => String.fromCharCode(t % 256)).join('');
  }

  truncate(text, maxTokens, options = {}) {
    const direction = options.direction || 'end';

    if (direction === 'end') {
      return this.#truncateEnd(text, maxTokens);
    } else {
      return this.#truncateStart(text, maxTokens);
    }
  }

  async #truncateEnd(text, maxTokens) {
    const tokens = await this.encode(text);
    if (tokens.length <= maxTokens) return text;

    const truncatedTokens = tokens.slice(0, maxTokens);
    return await this.decode(truncatedTokens);
  }

  async #truncateStart(text, maxTokens) {
    const tokens = await this.encode(text);
    if (tokens.length <= maxTokens) return text;

    const truncatedTokens = tokens.slice(-maxTokens);
    return await this.decode(truncatedTokens);
  }

  pad(tokens, targetLength, options = {}) {
    const padToken = options.padToken || 0;
    const paddingSide = options.paddingSide || 'right';

    if (tokens.length >= targetLength) {
      return tokens.slice(0, targetLength);
    }

    const padding = new Array(targetLength - tokens.length).fill(padToken);

    if (paddingSide === 'left') {
      return [...padding, ...tokens];
    } else {
      return [...tokens, ...padding];
    }
  }

  createAttentionMask(tokens) {
    return tokens.map((t) => (t !== 0 ? 1 : 0));
  }

  async tokenizeForModel(text, model, options = {}) {
    const tokens = await this.encode(text, { addSpecialTokens: true });

    const modelConfig = MODEL_CONFIGS[model] || MODEL_CONFIGS.default;
    const maxLength = options.maxLength || 8192;

    let processedTokens = tokens;
    if (processedTokens.length > maxLength) {
      processedTokens = processedTokens.slice(0, maxLength);
    }

    const attentionMask = this.createAttentionMask(processedTokens);
    const tokenTypeIds = new Array(processedTokens.length).fill(0);

    return {
      input_ids: processedTokens,
      attention_mask: attentionMask,
      token_type_ids: tokenTypeIds,
      token_count: processedTokens.length,
    };
  }

  getVocabSize() {
    return this.#config.vocab_size;
  }

  getModelName() {
    return this.#modelName;
  }

  getModelType() {
    return this.#config.model_type;
  }

  clearCache() {
    this.#cache.clear();
  }

  getCacheSize() {
    return this.#cache.size;
  }

  async serialize() {
    return {
      modelName: this.#modelName,
      config: this.#config,
      cacheSize: this.#cache.size,
    };
  }

  static getAvailableModels() {
    return Object.keys(MODEL_CONFIGS);
  }

  static getModelConfig(modelName) {
    return MODEL_CONFIGS[modelName] || MODEL_CONFIGS.default;
  }
}

export class TokenBatchProcessor {
  #tokenizer;
  #batchSize;

  constructor(tokenizer, options = {}) {
    this.#tokenizer = tokenizer;
    this.#batchSize = options.batchSize || 100;
  }

  async processBatch(texts, operation = 'encode') {
    const results = [];

    for (let i = 0; i < texts.length; i += this.#batchSize) {
      const batch = texts.slice(i, i + this.#batchSize);
      const batchResults = await Promise.all(
        batch.map((text) =>
          operation === 'encode'
            ? this.#tokenizer.encode(text)
            : this.#tokenizer.countTokens(text)
        )
      );
      results.push(...batchResults);
    }

    return results;
  }

  async encodeBatch(texts) {
    return this.processBatch(texts, 'encode');
  }

  async countBatch(texts) {
    return this.processBatch(texts, 'count');
  }
}

export default Tokenizer;
