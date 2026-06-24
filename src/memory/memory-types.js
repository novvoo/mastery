export const MemoryType = Object.freeze({
  USER: 'user',
  FEEDBACK: 'feedback',
  PROJECT: 'project',
  REFERENCE: 'reference',
});

/**
 * Topic 分类（人可读的主题笔记本）。
 * 每个 topic 对应一个 topics/{name}.md 文件。
 */
export const MemoryTopic = Object.freeze({
  ARCHITECTURE: 'architecture',
  DEBUGGING: 'debugging',
  CONVENTIONS: 'conventions',
  DEPENDENCIES: 'dependencies',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  TESTING: 'testing',
  DEPLOYMENT: 'deployment',
  API: 'api',
  GENERAL: 'general',
});

/**
 * 根据记忆 type + tags 自动推断最佳 topic（基于得分的多模式匹配）。
 */
export function inferTopic(type, tags = [], content = '') {
  const text = (tags.join(' ') + ' ' + content).toLowerCase();

  // 模式定义：权重越高的 pattern 越具辨识度
  const patterns = [
    [
      MemoryTopic.DEBUGGING,
      /\b(?:debug|debugging|bug|error|crash|traceback|stack trace|workaround|troubleshoot)\b/i,
      10,
    ],
    [
      MemoryTopic.TESTING,
      /\b(?:test|spec|mock|stub|fixture|coverage|assert|e2e|unit test|integration test)\b/i,
      10,
    ],
    [
      MemoryTopic.SECURITY,
      /\b(?:csrf|xss|cve|vulnerab|exploit|encrypt|decrypt|authn|authz|jwt|oauth)\b/i,
      10,
    ],
    [
      MemoryTopic.DEPLOYMENT,
      /\b(?:deploy|docker|kubernetes|helm|terraform|ci\b|cd\b|jenkins|infra|release)\b/i,
      10,
    ],
    [
      MemoryTopic.API,
      /\b(?:api\b|endpoint|graphql|rpc|swagger|openapi|restful|grpc|protobuf)\b/i,
      10,
    ],
    [
      MemoryTopic.DEPENDENCIES,
      /\b(?:dependenc|package|library|version|upgrade|npm\b|pip\b|cargo\b|gem\b|lockfile)\b/i,
      9,
    ],
    [
      MemoryTopic.PERFORMANCE,
      /\b(?:perform|slow|fast|optimiz|memory leak|cache|latency|throughput|benchmark)\b/i,
      9,
    ],
    [
      MemoryTopic.CONVENTIONS,
      /\b(?:convention|coding style|naming|format|best practice|guideline|lint|eslint|prettier)\b/i,
      8,
    ],
    // Architecture pattern - 权重最低因为 "module"/"component" 太通用
    [
      MemoryTopic.ARCHITECTURE,
      /\b(?:architect|design pattern|monorepo|microservice|middleware|hexagonal|event sourcing)\b/i,
      7,
    ],
  ];

  let bestTopic = null;
  let bestScore = 0;

  for (const [topic, regex, weight] of patterns) {
    const matches = (text.match(regex) || []).length;
    const score = matches * weight;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  if (bestScore >= 7) {
    return bestTopic;
  }

  // Fallback: check for weak ARCHITECTURE signals if nothing else matched
  if (/\b(?:module|component|layer|pipeline|service)\b/i.test(text)) {
    if (
      /\b(?:pattern|structure|design|layout|abstraction|decouple|interface|dependency inversion)\b/i.test(
        text,
      )
    ) {
      return MemoryTopic.ARCHITECTURE;
    }
  }

  // 根据类型回退
  if (type === MemoryType.PROJECT) {
    return MemoryTopic.ARCHITECTURE;
  }
  if (type === MemoryType.REFERENCE) {
    return MemoryTopic.GENERAL;
  }

  return MemoryTopic.GENERAL;
}

export const MemoryStatus = Object.freeze({
  ACTIVE: 'active',
  STALE: 'stale',
  VERIFIED: 'verified',
  EXPIRED: 'expired',
});

export const StaleThreshold = Object.freeze({
  USER: 7,
  FEEDBACK: 3,
  PROJECT: 2,
  REFERENCE: 14,
});

/**
 * 初始重要性：不同类型记忆的初始权重（0-1）。
 */
export const InitialImportance = Object.freeze({
  USER: 0.9,
  FEEDBACK: 0.85,
  PROJECT: 0.7,
  REFERENCE: 0.75,
});

/**
 * 半衰期（天）：重要性衰减到初始值 50% 所需的天数。
 * 半衰期越短，淡忘越快。
 */
export const ImportanceHalfLife = Object.freeze({
  USER: 90, // 用户偏好最持久
  FEEDBACK: 30, // 反馈可能过时
  PROJECT: 14, // 项目知识变化快
  REFERENCE: 60, // 参考资料较稳定
});

/**
 * 软排除阈值：relevanceScore 低于此值的记忆在检索/上下文中被排除。
 */
export const SOFT_EVICTION_THRESHOLD = 0.3;

/**
 * 硬驱逐阈值：relevanceScore 低于此值的记忆在 compaction 时被删除。
 */
export const HARD_EVICTION_THRESHOLD = 0.12;

export class MemoryEntry {
  constructor(data) {
    this.id = data.id || `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.type = data.type;
    this.title = data.title;
    this.content = data.content;
    this.timestamp = data.timestamp || Date.now();
    this.lastUsed = data.lastUsed || this.timestamp;
    this.status = MemoryStatus.ACTIVE;
    this.usageCount = data.usageCount || 0;
    this.metadata = data.metadata || {};
    this.source = data.source || null;
    this.tags = data.tags || [];
    this.relatedIds = data.relatedIds || [];
    // 重要性评分：0-1，初始值按类型设定，随时间衰减，随访问提升
    this.importanceScore = data.importanceScore ?? this._initImportance();

    this._validate();
  }

  /** 根据类型计算初始重要性 */
  _initImportance() {
    return InitialImportance[this.type?.toUpperCase()] ?? 0.7;
  }

  /**
   * 获取综合相关度评分 = 基础重要性 × 时间衰减 + 访问加成。
   *
   * 时间衰减使用指数衰减模型：score = importanceScore * 0.5^(age/halfLife)
   * 访问加成：每次访问 +0.03，由 usageCount 贡献。
   *
   * @param {number} [now] - 当前时间戳（用于测试）
   * @returns {number} 0-1 的综合评分
   */
  getRelevanceScore(now) {
    const current = now || Date.now();
    const halfLifeDays = ImportanceHalfLife[this.type?.toUpperCase()] ?? 30;
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
    const ageMs = Math.max(0, current - this.timestamp);
    const decay = Math.pow(0.5, ageMs / halfLifeMs);

    // 基础重要性 × 衰减
    let score = this.importanceScore * decay;

    // 访问加成：每次访问提升少量分数（上限 0.15）
    const accessBoost = Math.min(0.15, this.usageCount * 0.03);
    score = Math.min(1.0, score + accessBoost);

    // 最近访问额外加成：30 天内访问过 +0.05
    const daysSinceAccess = (current - this.lastUsed) / (1000 * 60 * 60 * 24);
    if (daysSinceAccess < 30) {
      score = Math.min(1.0, score + 0.05);
    }

    return score;
  }

  _validate() {
    if (!MemoryType[this.type?.toUpperCase()]) {
      throw new Error(
        `Invalid memory type: ${this.type}. Must be one of: ${Object.values(MemoryType).join(', ')}`,
      );
    }
    if (!this.title || typeof this.title !== 'string') {
      throw new Error('Memory title is required');
    }
    if (!this.content || typeof this.content !== 'string') {
      throw new Error('Memory content is required');
    }
  }

  access() {
    this.usageCount++;
    this.lastUsed = Date.now();
    // 每次访问微幅提升基础重要性（上限 1.0）
    this.importanceScore = Math.min(1.0, this.importanceScore + 0.01);
    return this;
  }

  isStale() {
    const thresholdDays = StaleThreshold[this.type?.toUpperCase()] || 7;
    const ageDays = (Date.now() - this.timestamp) / (1000 * 60 * 60 * 24);
    return ageDays >= thresholdDays;
  }

  isExpired() {
    const ageDays = (Date.now() - this.timestamp) / (1000 * 60 * 60 * 24);
    return ageDays >= 30;
  }

  toFrontmatter() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      timestamp: new Date(this.timestamp).toISOString(),
      status: this.status,
      tags: this.tags,
      source: this.source,
      usageCount: this.usageCount,
      importanceScore: Math.round(this.importanceScore * 1000) / 1000,
    };
  }

  toMarkdown() {
    const frontmatter = this.toFrontmatter();
    const yaml = Object.entries(frontmatter)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return `${k}:\n  - ${v.join('\n  - ')}`;
        }
        return `${k}: ${JSON.stringify(v)}`;
      })
      .join('\n');

    return `---\n${yaml}\n---\n\n${this.content}`;
  }

  static fromMarkdown(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      throw new Error('Invalid markdown format: missing frontmatter');
    }

    const frontmatterStr = match[1];
    const content = match[2].trim();

    const frontmatter = {};
    let currentKey = null;
    let currentArray = [];

    for (const line of frontmatterStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('- ')) {
        if (currentKey) {
          currentArray.push(trimmed.slice(2));
        }
        continue;
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > -1) {
        if (currentKey && currentArray.length > 0) {
          frontmatter[currentKey] = currentArray;
          currentArray = [];
        }

        currentKey = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();

        try {
          frontmatter[currentKey] = JSON.parse(value);
        } catch {
          frontmatter[currentKey] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    if (currentKey && currentArray.length > 0) {
      frontmatter[currentKey] = currentArray;
    }

    return new MemoryEntry({
      id: frontmatter.id,
      type: frontmatter.type,
      title: frontmatter.title,
      content,
      timestamp:
        typeof frontmatter.timestamp === 'string'
          ? new Date(frontmatter.timestamp).getTime()
          : frontmatter.timestamp,
      metadata: {},
      tags: frontmatter.tags || [],
      source: frontmatter.source || null,
    });
  }
}
