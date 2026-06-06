/**
 * Tokenizer - 跨平台一致性分词模块
 * 核心功能：
 * - 基于 @huggingface/tokenizers 的确定性分词
 * - 多种模型支持 (GPT, Claude, Gemini 等)
 * - 跨平台一致的 Token 计数
 * - 序列化和缓存支持
 */

const MODEL_CONFIGS = {
  'gpt-4': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
  'gpt-4o': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
  'gpt-4o-mini': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
  'gpt-4-turbo': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
  'gpt-3.5-turbo': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
  'claude': { vocab_size: 32000, model_type: 'o200k_base', fallback_chars_per_token: 3.5 },
  'claude-3': { vocab_size: 32000, model_type: 'o200k_base', fallback_chars_per_token: 3.5 },
  'claude-3.5': { vocab_size: 32000, model_type: 'o200k_base', fallback_chars_per_token: 3.5 },
  'gemini': { vocab_size: 256000, model_type: 'tiktoken', fallback_chars_per_token: 4 },
  'gemini-1.5-pro': { vocab_size: 256000, model_type: 'tiktoken', fallback_chars_per_token: 4 },
  'gemini-1.5-flash': { vocab_size: 256000, model_type: 'tiktoken', fallback_chars_per_token: 4 },
  'qwen': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'qwen-plus': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'qwen-turbo': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'qwen2.5': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'qwen2.5-plus': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'qwen3.5-plus': { vocab_size: 151936, model_type: 'qwen', fallback_chars_per_token: 3 },
  'glm-4': { vocab_size: 151552, model_type: 'glm', fallback_chars_per_token: 3 },
  'glm-4-flash': { vocab_size: 151552, model_type: 'glm', fallback_chars_per_token: 3 },
  'glm-4-plus': { vocab_size: 151552, model_type: 'glm', fallback_chars_per_token: 3 },
  'deepseek-chat': { vocab_size: 102400, model_type: 'deepseek', fallback_chars_per_token: 3 },
  'deepseek-coder': { vocab_size: 102400, model_type: 'deepseek', fallback_chars_per_token: 3 },
  'default': { vocab_size: 100256, model_type: 'cl100k_base', fallback_chars_per_token: 4 },
};

export class Tokenizer {
  #tokenizer;
  #modelName;
  #config;
  #initialized;
  #cache;

  constructor(options = {}) {
    this.#modelName = Tokenizer.normalizeModelName(options.model || 'gpt-4o');
    this.#config = MODEL_CONFIGS[this.#modelName] || MODEL_CONFIGS.default;
    this.#initialized = false;
    this.#cache = new Map();
    this.#tokenizer = null;
  }

  async initialize() {
    if (this.#initialized) {return;}

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
    if (!text) {return [];}

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
    if (!tokens || tokens.length === 0) {return '';}

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

  countTokensSync(text) {
    if (!text) {return 0;}
    return this.#fallbackEncode(String(text)).length;
  }

  async countTokensBatch(texts) {
    const results = [];
    for (const text of texts) {
      results.push(await this.countTokens(text));
    }
    return results;
  }

  #fallbackEncode(text) {
    const tokens = [];
    const charsPerToken = Math.max(1, Math.ceil(Number(this.#config.fallback_chars_per_token || 4)));
    let nonCjkRun = '';

    const flushNonCjkRun = () => {
      if (!nonCjkRun) {return;}
      for (let i = 0; i < nonCjkRun.length; i += charsPerToken) {
        tokens.push(this.#hashChunk(nonCjkRun.slice(i, i + charsPerToken)));
      }
      nonCjkRun = '';
    };

    for (const char of text) {
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
        flushNonCjkRun();
        tokens.push(this.#hashChunk(char + "\x00"), this.#hashChunk(char + "\x01"));
        continue;
      }
      nonCjkRun += char;
    }

    flushNonCjkRun();
    return tokens;
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
    if (tokens.length <= maxTokens) {return text;}

    const truncatedTokens = tokens.slice(0, maxTokens);
    return await this.decode(truncatedTokens);
  }

  async #truncateStart(text, maxTokens) {
    const tokens = await this.encode(text);
    if (tokens.length <= maxTokens) {return text;}

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
    return MODEL_CONFIGS[Tokenizer.normalizeModelName(modelName)] || MODEL_CONFIGS.default;
  }

  static normalizeModelName(modelName) {
    const normalized = String(modelName || 'default').toLowerCase().trim();
    const shortName = normalized.includes('/') ? normalized.split('/').pop() : normalized;

    if (MODEL_CONFIGS[shortName]) {return shortName;}
    if (shortName.startsWith('claude-3.5')) {return 'claude-3.5';}
    if (shortName.startsWith('claude-3')) {return 'claude-3';}
    if (shortName.startsWith('claude')) {return 'claude';}
    if (shortName.startsWith('gemini-1.5-pro')) {return 'gemini-1.5-pro';}
    if (shortName.startsWith('gemini-1.5-flash')) {return 'gemini-1.5-flash';}
    if (shortName.startsWith('gemini')) {return 'gemini';}
    if (shortName.startsWith('qwen3.5-plus')) {return 'qwen3.5-plus';}
    if (shortName.startsWith('qwen2.5-plus')) {return 'qwen2.5-plus';}
    if (shortName.startsWith('qwen2.5')) {return 'qwen2.5';}
    if (shortName.startsWith('qwen-plus')) {return 'qwen-plus';}
    if (shortName.startsWith('qwen-turbo')) {return 'qwen-turbo';}
    if (shortName.startsWith('qwen')) {return 'qwen';}
    if (shortName.startsWith('glm-4-plus')) {return 'glm-4-plus';}
    if (shortName.startsWith('glm-4-flash')) {return 'glm-4-flash';}
    if (shortName.startsWith('glm-4')) {return 'glm-4';}
    if (shortName.startsWith('deepseek-coder')) {return 'deepseek-coder';}
    if (shortName.startsWith('deepseek')) {return 'deepseek-chat';}
    if (shortName.startsWith('gpt-4o-mini')) {return 'gpt-4o-mini';}
    if (shortName.startsWith('gpt-4o')) {return 'gpt-4o';}
    if (shortName.startsWith('gpt-4-turbo')) {return 'gpt-4-turbo';}
    if (shortName.startsWith('gpt-4')) {return 'gpt-4';}
    if (shortName.startsWith('gpt-3.5')) {return 'gpt-3.5-turbo';}
    return shortName;
  }

  static createTokenCounter(options = {}) {
    const tokenizer = new Tokenizer(options);
    return (text) => tokenizer.countTokensSync(text);
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
