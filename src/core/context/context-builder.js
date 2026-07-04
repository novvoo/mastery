/**
 * ContextBuilder — 统一的 LLM 上下文构建器
 *
 * 参考 oh-my-pi 的设计理念：
 * - 所有上下文注入通过统一的 builder 模式
 * - 每种上下文有明确的类型、优先级、注入时机
 * - 可追踪、可调试、可重现
 *
 * 解决的问题：
 * - 之前有 N 种注入方式（systemPrompt, addSystemMessage, addLayer,
 *   taskAnchor, routingPrompt, taskConstraintPrompt...）散落在各处
 * - 难以追踪最终发送给 LLM 的 prompt 是如何组成的
 * - 不同模块用不同的注入方式，没有统一契约
 *
 * 使用方式：
 *   const builder = new ContextBuilder();
 *   builder
 *     .system('You are a coding agent.')
 *     .layer('tools', toolsPrompt, { priority: 100 })
 *     .task('Task description...')
 *     .append('user', 'Please help me...');
 *   const messages = builder.build();
 */

export const ContextEntryType = {
  SYSTEM: 'system', // 核心系统提示
  LAYER: 'layer', // 分层上下文（带优先级的动态上下文）
  TASK_ANCHOR: 'task', // 任务锚点
  USER: 'user', // 用户消息
  ASSISTANT: 'assistant', // 助手消息
  TOOL_RESULT: 'tool', // 工具结果
};

export const ContextPriority = {
  CRITICAL: 1000, // 必须保留（系统提示、安全规则）
  HIGH: 100, // 高优先级（工具定义、任务描述）
  NORMAL: 50, // 普通优先级
  LOW: 10, // 低优先级（辅助信息、示例）
  OPTIONAL: 1, // 可选（最先被裁剪）
};

export class ContextBuilder {
  #entries = [];
  #layers = new Map(); // layerId -> { content, priority, type }

  /**
   * 设置系统提示
   * @param {string} content
   * @returns {ContextBuilder}
   */
  system(content) {
    this.#entries.push({
      type: ContextEntryType.SYSTEM,
      content,
      priority: ContextPriority.CRITICAL,
    });
    return this;
  }

  /**
   * 添加分层上下文（可替换、可删除）
   * @param {string} id - 层的唯一标识
   * @param {string} content
   * @param {object} [options]
   * @param {number} [options.priority] - 优先级，越高越先保留
   * @returns {ContextBuilder}
   */
  layer(id, content, options = {}) {
    this.#layers.set(id, {
      id,
      content,
      priority: options.priority ?? ContextPriority.NORMAL,
    });
    return this;
  }

  /**
   * 删除一个层
   * @param {string} id
   * @returns {boolean}
   */
  removeLayer(id) {
    return this.#layers.delete(id);
  }

  /**
   * 检查层是否存在
   * @param {string} id
   * @returns {boolean}
   */
  hasLayer(id) {
    return this.#layers.has(id);
  }

  /**
   * 设置任务锚点
   * @param {string} content
   * @returns {ContextBuilder}
   */
  task(content) {
    this.#entries.push({
      type: ContextEntryType.TASK_ANCHOR,
      content,
      priority: ContextPriority.HIGH,
    });
    return this;
  }

  /**
   * 追加用户消息
   * @param {string} content
   * @returns {ContextBuilder}
   */
  user(content) {
    this.#entries.push({
      type: ContextEntryType.USER,
      content,
      priority: ContextPriority.HIGH,
    });
    return this;
  }

  /**
   * 追加助手消息
   * @param {string} content
   * @returns {ContextBuilder}
   */
  assistant(content) {
    this.#entries.push({
      type: ContextEntryType.ASSISTANT,
      content,
      priority: ContextPriority.NORMAL,
    });
    return this;
  }

  /**
   * 追加工具结果
   * @param {string} content
   * @returns {ContextBuilder}
   */
  toolResult(content) {
    this.#entries.push({
      type: ContextEntryType.TOOL_RESULT,
      content,
      priority: ContextPriority.NORMAL,
    });
    return this;
  }

  /**
   * 构建消息数组
   * @returns {Array<{role: string, content: string}>}
   */
  build() {
    const messages = [];

    // 1. System 消息（合并所有 system + 高优先级 layer）
    const systemParts = [];
    for (const entry of this.#entries) {
      if (entry.type === ContextEntryType.SYSTEM) {
        systemParts.push(entry.content);
      }
    }

    // 2. 按优先级排序的 layers
    const sortedLayers = Array.from(this.#layers.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    for (const layer of sortedLayers) {
      systemParts.push(layer.content);
    }

    // 3. 任务锚点
    const taskAnchors = this.#entries.filter((e) => e.type === ContextEntryType.TASK_ANCHOR);
    for (const anchor of taskAnchors) {
      systemParts.push(anchor.content);
    }

    if (systemParts.length > 0) {
      messages.push({
        role: 'system',
        content: systemParts.join('\n\n'),
      });
    }

    // 4. 对话历史（user / assistant / tool）
    for (const entry of this.#entries) {
      if (
        entry.type === ContextEntryType.USER ||
        entry.type === ContextEntryType.ASSISTANT ||
        entry.type === ContextEntryType.TOOL_RESULT
      ) {
        messages.push({
          role: entry.type === ContextEntryType.TOOL_RESULT ? 'tool' : entry.type,
          content: entry.content,
        });
      }
    }

    return messages;
  }

  /**
   * 获取所有层的信息（用于调试）
   * @returns {Array<{id: string, priority: number}>}
   */
  getLayersInfo() {
    return Array.from(this.#layers.values()).map((l) => ({
      id: l.id,
      priority: l.priority,
      size: l.content?.length ?? 0,
    }));
  }

  /**
   * 清空所有内容
   */
  clear() {
    this.#entries = [];
    this.#layers.clear();
    return this;
  }

  /**
   * 创建一个独立的副本
   * @returns {ContextBuilder}
   */
  clone() {
    const copy = new ContextBuilder();
    copy.#entries = [...this.#entries];
    copy.#layers = new Map(this.#layers);
    return copy;
  }
}
