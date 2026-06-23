/**
 * Advanced Memory System - 三层记忆系统
 *
 * 支持:
 * - Episodic Memory: 情景记忆 (具体事件/经历)
 * - Semantic Memory: 语义记忆 (知识/概念)
 * - Summary Memory: 摘要记忆 (压缩总结)
 * - Context Compression: 上下文压缩
 *
 * 注意：这里的 AdvancedMemoryType 和 AdvancedMemoryEntry 是会话内记忆，
 * 与 memory-types.js 中的 MemoryType/MemoryEntry（持久化文件系统记忆）互补。
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * 高级记忆类型（会话内三层记忆）。
 * 与 memory-types.js 的 MemoryType（持久化分类）正交。
 */
export const AdvancedMemoryType = {
  EPISODIC: 'episodic', // 情景记忆
  SEMANTIC: 'semantic', // 语义记忆
  SUMMARY: 'summary', // 摘要记忆
};

/**
 * 高级记忆条目（会话内记忆，支持评分/压缩/向量检索）。
 */
export class AdvancedMemoryEntry {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.type = data.type || AdvancedMemoryType.EPISODIC;
    this.content = data.content;
    this.timestamp = data.timestamp || Date.now();
    this.importance = data.importance || 0.5; // 0-1
    this.accessCount = 0;
    this.lastAccessed = this.timestamp;

    // 向量嵌入 (用于语义检索)
    this.embedding = data.embedding || null;

    // 元数据
    this.metadata = data.metadata || {};
    this.tags = data.tags || [];

    // 关联
    this.relatedIds = data.relatedIds || [];

    // 压缩信息
    this.compressionLevel = data.compressionLevel || 0;
    this.originalLength =
      data.originalLength || (typeof data.content === 'string' ? data.content.length : 0);
  }

  /**
   * 访问记忆
   */
  access() {
    this.accessCount++;
    this.lastAccessed = Date.now();
    return this;
  }

  /**
   * 计算记忆得分 (用于淘汰)
   */
  calculateScore() {
    const age = Date.now() - this.timestamp;
    const recency = Date.now() - this.lastAccessed;

    // 重要性 + 访问频率 - 年龄衰减 - 访问间隔
    return (
      this.importance * 100 +
      Math.log(this.accessCount + 1) * 10 -
      (age / (1000 * 60 * 60 * 24)) * 0.1 - // 每天衰减0.1
      (recency / (1000 * 60 * 60)) * 0.5 // 每小时衰减0.5
    );
  }
}

/**
 * 上下文压缩器
 */
export class ContextCompressor {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens || 4000;
    this.compressionRatio = config.compressionRatio || 0.5;
  }

  /**
   * 压缩上下文
   */
  compress(context, targetTokens = null) {
    const target = targetTokens || this.maxTokens * this.compressionRatio;
    const currentTokens = this.estimateTokens(context);

    if (currentTokens <= target) {
      return { compressed: context, ratio: 1.0 };
    }

    // 策略1: 移除低重要性内容
    let compressed = this.removeLowImportance(context, target);

    // 策略2: 摘要长内容
    if (this.estimateTokens(compressed) > target) {
      compressed = this.summarizeContent(compressed, target);
    }

    // 策略3: 截断历史
    if (this.estimateTokens(compressed) > target) {
      compressed = this.truncateHistory(compressed, target);
    }

    return {
      compressed,
      ratio: this.estimateTokens(compressed) / currentTokens,
    };
  }

  /**
   * 估算token数
   */
  estimateTokens(content) {
    if (typeof content === 'string') {
      // 粗略估算: 1 token ≈ 4 字符
      return Math.ceil(content.length / 4);
    }
    if (Array.isArray(content)) {
      return content.reduce((sum, item) => sum + this.estimateTokens(item), 0);
    }
    if (typeof content === 'object') {
      return this.estimateTokens(JSON.stringify(content));
    }
    return 0;
  }

  /**
   * 移除低重要性内容
   */
  removeLowImportance(context, targetTokens) {
    if (!Array.isArray(context)) {
      return context;
    }

    // 按重要性排序
    const sorted = [...context].sort((a, b) => (b.importance || 0.5) - (a.importance || 0.5));

    let result = [];
    let tokens = 0;

    for (const item of sorted) {
      const itemTokens = this.estimateTokens(item.content || item);
      if (tokens + itemTokens <= targetTokens) {
        result.push(item);
        tokens += itemTokens;
      }
    }

    // 按原始顺序排序
    return result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * 摘要内容
   */
  summarizeContent(context, targetTokens) {
    if (typeof context === 'string') {
      // 简单摘要: 保留开头和结尾
      const tokens = this.estimateTokens(context);
      if (tokens <= targetTokens) {
        return context;
      }

      const ratio = targetTokens / tokens;
      const keepLength = Math.floor(context.length * ratio * 0.8);

      return (
        context.substring(0, keepLength / 2) +
        '\n... [content summarized] ...\n' +
        context.substring(context.length - keepLength / 2)
      );
    }

    if (Array.isArray(context)) {
      return context.map((item) => ({
        ...item,
        content: this.summarizeContent(item.content, targetTokens / context.length),
      }));
    }

    return context;
  }

  /**
   * 截断历史
   */
  truncateHistory(context, targetTokens) {
    if (!Array.isArray(context)) {
      return context;
    }

    // 保留最新的内容
    let result = [];
    let tokens = 0;

    for (let i = context.length - 1; i >= 0; i--) {
      const item = context[i];
      const itemTokens = this.estimateTokens(item.content || item);

      if (tokens + itemTokens <= targetTokens) {
        result.unshift(item);
        tokens += itemTokens;
      } else {
        break;
      }
    }

    return result;
  }
}

/**
 * 高级记忆管理器
 */
export class AdvancedMemoryManager extends EventEmitter {
  #memories = new Map();
  #episodic = [];
  #semantic = new Map(); // key -> AdvancedMemoryEntry
  #summaries = [];
  #compressor;
  #config;

  constructor(config = {}) {
    super();
    this.#config = {
      maxEpisodicMemories: config.maxEpisodicMemories || 1000,
      maxSummaries: config.maxSummaries || 100,
      compressionThreshold: config.compressionThreshold || 0.8,
      ...config,
    };
    this.#compressor = new ContextCompressor(config.compression);
  }

  /**
   * 添加情景记忆
   */
  addEpisodic(content, metadata = {}) {
    const entry = new AdvancedMemoryEntry({
      type: AdvancedMemoryType.EPISODIC,
      content,
      importance: metadata.importance || 0.5,
      metadata,
      tags: metadata.tags || [],
    });

    this.#episodic.push(entry);
    this.#memories.set(entry.id, entry);

    // 检查是否需要压缩
    if (this.#episodic.length > this.#config.maxEpisodicMemories) {
      this.#compressOldMemories();
    }

    this.emit('memory:added', entry);
    return entry;
  }

  /**
   * 添加语义记忆
   */
  addSemantic(key, content, metadata = {}) {
    const entry = new AdvancedMemoryEntry({
      type: AdvancedMemoryType.SEMANTIC,
      content,
      importance: metadata.importance || 0.7,
      metadata,
      tags: metadata.tags || [],
    });

    this.#semantic.set(key, entry);
    this.#memories.set(entry.id, entry);

    this.emit('semantic:added', { key, entry });
    return entry;
  }

  /**
   * 添加摘要记忆
   */
  addSummary(content, metadata = {}) {
    const entry = new AdvancedMemoryEntry({
      type: AdvancedMemoryType.SUMMARY,
      content,
      importance: metadata.importance || 0.6,
      metadata,
      tags: metadata.tags || [],
    });

    this.#summaries.push(entry);
    this.#memories.set(entry.id, entry);

    // 限制摘要数量
    if (this.#summaries.length > this.#config.maxSummaries) {
      this.#summaries.shift(); // 移除最旧的
    }

    this.emit('summary:added', entry);
    return entry;
  }

  /**
   * 检索记忆
   */
  retrieve(query, options = {}) {
    const { type = null, limit = 10, minImportance = 0, tags = [] } = options;

    let candidates = [];

    // 收集候选
    if (!type || type === AdvancedMemoryType.EPISODIC) {
      candidates.push(...this.#episodic);
    }
    if (!type || type === AdvancedMemoryType.SEMANTIC) {
      candidates.push(...this.#semantic.values());
    }
    if (!type || type === AdvancedMemoryType.SUMMARY) {
      candidates.push(...this.#summaries);
    }

    // 过滤
    candidates = candidates.filter((m) => {
      if (m.importance < minImportance) {
        return false;
      }
      if (tags.length > 0 && !tags.some((t) => m.tags.includes(t))) {
        return false;
      }
      return true;
    });

    // 排序 (相关性 + 重要性 + 时效性)
    candidates.sort((a, b) => {
      const scoreA = this.#calculateRelevance(a, query) + a.calculateScore();
      const scoreB = this.#calculateRelevance(b, query) + b.calculateScore();
      return scoreB - scoreA;
    });

    // 访问记录
    const results = candidates.slice(0, limit);
    results.forEach((r) => r.access());

    return results;
  }

  /**
   * 语义检索
   */
  semanticRetrieve(queryEmbedding, options = {}) {
    const { limit = 10, threshold = 0.7 } = options;

    const results = [];

    for (const memory of this.#memories.values()) {
      if (!memory.embedding) {
        continue;
      }

      const similarity = this.#cosineSimilarity(queryEmbedding, memory.embedding);
      if (similarity >= threshold) {
        results.push({ memory, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit).map((r) => r.memory);
  }

  /**
   * 压缩旧记忆
   */
  #compressOldMemories() {
    // 按得分排序
    const sorted = [...this.#episodic].sort((a, b) => a.calculateScore() - b.calculateScore());

    // 移除低分记忆
    const toRemove = sorted.slice(0, Math.floor(sorted.length * 0.2));

    for (const memory of toRemove) {
      // 创建摘要
      this.addSummary(memory.content, {
        sourceId: memory.id,
        originalType: memory.type,
        tags: ['compressed', ...memory.tags],
      });

      // 移除原记忆
      this.#episodic = this.#episodic.filter((m) => m.id !== memory.id);
      this.#memories.delete(memory.id);
    }

    this.emit('memory:compressed', { removed: toRemove.length });
  }

  /**
   * 生成上下文
   */
  generateContext(currentQuery, maxTokens = 4000) {
    const context = {
      summaries: [],
      semantic: [],
      episodic: [],
    };

    // 1. 添加相关摘要
    const relevantSummaries = this.retrieve(currentQuery, {
      type: AdvancedMemoryType.SUMMARY,
      limit: 5,
    });
    context.summaries = relevantSummaries.map((m) => m.content);

    // 2. 添加语义知识
    const relevantSemantic = this.retrieve(currentQuery, {
      type: AdvancedMemoryType.SEMANTIC,
      limit: 10,
    });
    context.semantic = relevantSemantic.map((m) => ({
      key: m.metadata.key,
      content: m.content,
      importance: m.importance,
    }));

    // 3. 添加情景记忆
    const relevantEpisodic = this.retrieve(currentQuery, {
      type: AdvancedMemoryType.EPISODIC,
      limit: 20,
    });
    context.episodic = relevantEpisodic.map((m) => ({
      timestamp: m.timestamp,
      content: m.content,
    }));

    // 压缩上下文
    const compressed = this.#compressor.compress(context, maxTokens);

    return {
      ...compressed.compressed,
      compressionRatio: compressed.ratio,
    };
  }

  /**
   * 计算相关性
   */
  #calculateRelevance(memory, query) {
    if (!query) {
      return 0;
    }

    const content =
      typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content);

    // 简单关键词匹配
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentWords = content.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (contentWords.includes(word)) {
        matches++;
      }
    }

    return matches / queryWords.length;
  }

  /**
   * 余弦相似度
   */
  #cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      total: this.#memories.size,
      episodic: this.#episodic.length,
      semantic: this.#semantic.size,
      summaries: this.#summaries.length,
    };
  }

  /**
   * 序列化当前记忆状态到磁盘文件。
   * 将 Episodic、Semantic、Summary 三层记忆序列化为 JSON。
   *
   * @param {string} filePath - 保存路径
   * @returns {{ path: string, totalEntries: number }}
   */
  saveToDisk(filePath) {
    const serialized = {
      version: 1,
      timestamp: Date.now(),
      episodic: this.#episodic.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
        importance: m.importance,
        accessCount: m.accessCount,
        lastAccessed: m.lastAccessed,
        metadata: m.metadata,
        tags: m.tags,
        relatedIds: m.relatedIds,
        compressionLevel: m.compressionLevel,
        originalLength: m.originalLength,
      })),
      semantic: Array.from(this.#semantic.entries()).map(([key, m]) => ({
        key,
        id: m.id,
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
        importance: m.importance,
        accessCount: m.accessCount,
        lastAccessed: m.lastAccessed,
        metadata: m.metadata,
        tags: m.tags,
        relatedIds: m.relatedIds,
      })),
      summaries: this.#summaries.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
        importance: m.importance,
        accessCount: m.accessCount,
        lastAccessed: m.lastAccessed,
        metadata: m.metadata,
        tags: m.tags,
        relatedIds: m.relatedIds,
      })),
    };

    writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
    this.emit('memory:saved', {
      path: filePath,
      total: serialized.episodic.length + serialized.semantic.length + serialized.summaries.length,
    });
    return {
      path: filePath,
      totalEntries:
        serialized.episodic.length + serialized.semantic.length + serialized.summaries.length,
    };
  }

  /**
   * 从磁盘文件反序列化并恢复记忆状态。
   * 清空当前记忆后加载。
   *
   * @param {string} filePath
   * @returns {{ loaded: boolean, totalEntries: number }}
   */
  loadFromDisk(filePath) {
    if (!existsSync(filePath)) {
      return { loaded: false, totalEntries: 0 };
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      if (data.version !== 1) {
        throw new Error(`Unsupported memory format version: ${data.version}`);
      }

      // 清空当前
      this.clear();

      // 恢复 Episodic
      if (Array.isArray(data.episodic)) {
        for (const e of data.episodic) {
          const entry = new AdvancedMemoryEntry(e);
          entry.accessCount = e.accessCount || 0;
          entry.lastAccessed = e.lastAccessed || e.timestamp;
          this.#episodic.push(entry);
          this.#memories.set(entry.id, entry);
        }
      }

      // 恢复 Semantic
      if (Array.isArray(data.semantic)) {
        for (const s of data.semantic) {
          const entry = new AdvancedMemoryEntry(s);
          entry.accessCount = s.accessCount || 0;
          entry.lastAccessed = s.lastAccessed || s.timestamp;
          this.#semantic.set(s.key, entry);
          this.#memories.set(entry.id, entry);
        }
      }

      // 恢复 Summary
      if (Array.isArray(data.summaries)) {
        for (const s of data.summaries) {
          const entry = new AdvancedMemoryEntry(s);
          entry.accessCount = s.accessCount || 0;
          entry.lastAccessed = s.lastAccessed || s.timestamp;
          this.#summaries.push(entry);
          this.#memories.set(entry.id, entry);
        }
      }

      const total = this.#memories.size;
      this.emit('memory:loaded', { path: filePath, total });
      return { loaded: true, totalEntries: total };
    } catch (err) {
      this.emit('memory:loadError', { path: filePath, error: err.message });
      return { loaded: false, totalEntries: 0 };
    }
  }

  /**
   * 将会话记忆摘要持久化为可读文本（供 prompt 注入或归档）。
   *
   * @param {{ maxEntries?: number, includeMetadata?: boolean }} opts
   * @returns {string} 格式化的文本
   */
  toSummaryText(opts = {}) {
    const { maxEntries = 20, includeMetadata = true } = opts;
    const parts = [];

    parts.push('# Session Memory Summary');
    parts.push(`> Generated: ${new Date().toISOString()}`);
    parts.push(
      `> Total: ${this.#memories.size} (Episodic: ${this.#episodic.length}, Semantic: ${this.#semantic.size}, Summaries: ${this.#summaries.length})`,
    );
    parts.push('');

    // 摘要（最高价值）
    if (this.#summaries.length > 0) {
      parts.push('## Summaries');
      for (const m of this.#summaries.slice(-Math.min(maxEntries, this.#summaries.length))) {
        const age = this.#formatAge(m.timestamp);
        parts.push(`- [${age}] ${this.#truncate(m.content, 200)}`);
      }
      parts.push('');
    }

    // 语义知识
    if (this.#semantic.size > 0) {
      parts.push('## Semantic Knowledge');
      let count = 0;
      for (const [key, m] of this.#semantic) {
        if (count >= maxEntries) {
          break;
        }
        const age = this.#formatAge(m.timestamp);
        parts.push(
          `- **${key}**: ${this.#truncate(m.content, 150)}${includeMetadata ? ` (importance: ${m.importance.toFixed(1)})` : ''}`,
        );
        count++;
      }
      parts.push('');
    }

    // 近期情景
    if (this.#episodic.length > 0) {
      parts.push('## Recent Episodic');
      const recent = this.#episodic.slice(-Math.min(maxEntries, this.#episodic.length));
      for (const m of recent) {
        const age = this.#formatAge(m.timestamp);
        const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
        parts.push(`- [${age}]${tags} ${this.#truncate(m.content, 100)}`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  #truncate(text, maxLen) {
    if (!text) {
      return '';
    }
    const str = String(text).replace(/\n/g, ' ');
    return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
  }

  #formatAge(ts) {
    const agoMs = Date.now() - ts;
    if (agoMs < 60000) {
      return '<1m ago';
    }
    if (agoMs < 3600000) {
      return `${Math.floor(agoMs / 60000)}m ago`;
    }
    if (agoMs < 86400000) {
      return `${Math.floor(agoMs / 3600000)}h ago`;
    }
    return `${Math.floor(agoMs / 86400000)}d ago`;
  }

  /**
   * 清空记忆
   */
  clear() {
    this.#memories.clear();
    this.#episodic = [];
    this.#semantic.clear();
    this.#summaries = [];
    this.emit('memory:cleared');
  }
}

export default AdvancedMemoryManager;
