/**
 * 批量工具调用并行执行器
 *
 * 参考 oh-my-pi 的批量工具调用实现。
 *
 * 允许同时执行多个独立的工具调用（如并行读取多个文件），
 * 自动处理依赖关系和失败传播。
 */

/**
 * 工具调用依赖分析器
 * 判断哪些工具调用可以并行执行
 */
export class ToolCallDependencyAnalyzer {
  /**
   * 分析工具调用之间的依赖关系
   *
   * @param {Array} toolCalls - 工具调用列表
   * @returns {Array<Array>} 分组后的工具调用（每组可并行执行）
   */
  analyze(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    // 简单分组策略：
    // 1. mutation 工具（write_file, edit_file）必须串行
    // 2. inspection 工具（read_file, glob, grep）可并行
    // 3. 有路径依赖的工具需要串行（如先 list_dir 再 read_file）

    const mutationTools = new Set([
      'write_file',
      'edit_file',
      'delete_file',
      'rename_file',
      'mkdir',
      'git_commit',
      'git_push',
      'apply_hashline_patch',
    ]);

    const groups = [];
    let currentGroup = [];
    let lastMutation = false;
    const seenPaths = new Set();

    for (const call of toolCalls) {
      const name = call.name || call.function?.name || '';
      const args = call.arguments || call.function?.arguments || {};

      // mutation 工具必须单独执行
      if (mutationTools.has(name)) {
        // 先执行当前组
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        // mutation 工具单独一组
        groups.push([call]);
        lastMutation = true;
        // 记录操作的路径
        if (args.path) {
          seenPaths.add(args.path);
        }
        continue;
      }

      // shell 工具可能有写入操作，保守处理
      if (name === 'shell') {
        const cmd = String(args.command || '').toLowerCase();
        // 写入类命令单独执行
        if (/\b(touch|cp|mv|rm|sed|tee|install|>|>>)\b/.test(cmd)) {
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
            currentGroup = [];
          }
          groups.push([call]);
          continue;
        }
      }

      // 检查是否有路径依赖（读取刚写入的文件需要串行）
      if (name === 'read_file' && args.path && seenPaths.has(args.path)) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        groups.push([call]);
        continue;
      }

      // 其他工具可以加入当前组并行执行
      currentGroup.push(call);
      lastMutation = false;
    }

    // 添加最后一组
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * 检查两个工具调用是否有依赖关系
   *
   * @param {object} call1 - 第一个工具调用
   * @param {object} call2 - 第二个工具调用
   * @returns {boolean} 是否有依赖
   */
  hasDependency(call1, call2) {
    const name1 = call1.name || call1.function?.name || '';
    const name2 = call2.name || call2.function?.name || '';
    const args1 = call1.arguments || call1.function?.arguments || {};
    const args2 = call2.arguments || call2.function?.arguments || {};

    // mutation 工具对任何后续工具都有依赖
    const mutationTools = new Set(['write_file', 'edit_file', 'delete_file', 'rename_file']);

    if (mutationTools.has(name1)) {
      return true;
    }

    // 路径依赖：读取刚写入的文件
    if (name1 === 'write_file' && name2 === 'read_file') {
      return args1.path === args2.path;
    }

    return false;
  }
}

/**
 * 批量工具调用执行器
 */
export class BatchToolExecutor {
  #toolExecutor;
  #dependencyAnalyzer;
  #maxConcurrency;
  #onProgress;

  constructor(options = {}) {
    this.#toolExecutor = options.toolExecutor;
    this.#dependencyAnalyzer = new ToolCallDependencyAnalyzer();
    this.#maxConcurrency = options.maxConcurrency || 5;
    this.#onProgress = options.onProgress;
  }

  /**
   * 执行批量工具调用
   *
   * @param {Array} toolCalls - 工具调用列表
   * @param {object} context - 执行上下文
   * @returns {Promise<Array>} 执行结果列表
   */
  async executeBatch(toolCalls, context = {}, options = {}) {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    // 分析依赖关系，分组
    const groups = this.#dependencyAnalyzer.analyze(toolCalls);

    const results = [];
    for (const group of groups) {
      // 单个工具直接执行
      if (group.length === 1) {
        const result = await this.#executeSingle(group[0], context, options);
        results.push(result);
        continue;
      }

      // 多个工具并行执行
      const groupResults = await this.#executeParallel(group, context, options);
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * 执行单个工具调用
   */
  async #executeSingle(call, context, options = {}) {
    const name = call.name || call.function?.name || '';
    const args = call.arguments || call.function?.arguments || {};
    const observations = [];
    const startedAt = Date.now();

    if (this.#onProgress) {
      this.#onProgress({ type: 'start', toolName: name, args });
    }

    try {
      const result = await this.#toolExecutor.execute(call, context, {
        ...options,
        emitObservation: (id, toolName, observation, mode) => {
          observations.push({ id, name: toolName, observation, mode });
          if (!options.deferObservations) {
            options.emitObservation?.(id, toolName, observation, mode);
          }
        },
      });
      const durationMs = Date.now() - startedAt;
      if (result && typeof result === 'object' && result.durationMs == null) {
        result.durationMs = durationMs;
      }

      if (this.#onProgress) {
        this.#onProgress({ type: 'complete', toolName: name, result });
      }

      return {
        toolCall: call,
        execResult: result,
        durationMs,
        observations,
      };
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      if (this.#onProgress) {
        this.#onProgress({ type: 'error', toolName: name, error: e });
      }

      return {
        toolCall: call,
        execResult: {
          name,
          args,
          result: null,
          error: e.message || String(e),
          success: false,
          skipped: false,
          durationMs,
        },
        durationMs,
        observations,
      };
    }
  }

  /**
   * 并行执行一组工具调用
   */
  async #executeParallel(group, context, options = {}) {
    // 限制并发数
    const batches = [];
    for (let i = 0; i < group.length; i += this.#maxConcurrency) {
      batches.push(group.slice(i, i + this.#maxConcurrency));
    }

    const results = [];
    for (const batch of batches) {
      const promises = batch.map((call) => this.#executeSingle(call, context, options));
      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 获取分组信息（用于调试/可视化）
   */
  getGroups(toolCalls) {
    return this.#dependencyAnalyzer.analyze(toolCalls);
  }
}

/**
 * 判断工具调用是否可以并行执行
 *
 * @param {string} toolName - 工具名称
 * @returns {boolean}
 */
export function canParallelize(toolName) {
  const parallelizableTools = new Set([
    'read_file',
    'list_dir',
    'glob',
    'grep',
    'search',
    'search_codebase',
    'semantic_search',
    'web_fetch',
    'web_search',
    'lsp_symbols',
    'lsp_diagnostics',
    'lsp_references',
  ]);

  return parallelizableTools.has(toolName);
}

/**
 * 获取工具调用的并行执行策略
 *
 * @param {Array} toolCalls - 工具调用列表
 * @returns {{ parallelizable: Array, sequential: Array }}
 */
export function getExecutionStrategy(toolCalls) {
  const parallelizable = [];
  const sequential = [];

  for (const call of toolCalls) {
    const name = call.name || call.function?.name || '';
    if (canParallelize(name)) {
      parallelizable.push(call);
    } else {
      sequential.push(call);
    }
  }

  return { parallelizable, sequential };
}

export default {
  ToolCallDependencyAnalyzer,
  BatchToolExecutor,
  canParallelize,
  getExecutionStrategy,
};
