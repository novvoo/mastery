/**
 * ObservationSummarizer - 观察结果提炼器
 *
 * 核心功能：
 * - 将原始的工具调用结果转化为结构化的事实
 * - 提取关键信息，丢弃冗余内容
 * - 生成适合保留在上下文中的精简摘要
 */

export class ObservationSummarizer {
  constructor(workspaceState) {
    this.#workspaceState = workspaceState;
  }

  /** @type {import('./workspace-state.js').WorkspaceState} */
  #workspaceState;

  /**
   * 处理工具结果并提取事实
   * @param {string} toolName - 工具名称
   * @param {object} args - 工具参数
   * @param {any} result - 工具结果
   * @returns {object} - { summary, facts }
   */
  processToolResult(toolName, args, result) {
    const handler = this.#handlers[toolName];
    if (handler) {
      return handler.call(this, args, result);
    }

    // 默认处理
    return {
      summary: this.#defaultSummary(toolName, args, result),
      facts: [],
      shouldCache: true,
    };
  }

  /**
   * 生成高层次的上下文摘要
   * @param {number} maxFacts - 最大事实数
   */
  generateContextSummary(maxFacts = 10) {
    const facts = this.#workspaceState.getCriticalFacts();
    const summaries = [];

    // 按类型分组
    const byType = {};
    for (const fact of facts) {
      if (!byType[fact.type]) {
        byType[fact.type] = [];
      }
      byType[fact.type].push(fact);
    }

    // 生成每种类型的摘要
    for (const [type, typeFacts] of Object.entries(byType)) {
      summaries.push(this.#summarizeFactType(type, typeFacts.slice(0, 3)));
    }

    return summaries.slice(0, maxFacts).join('\n');
  }

  /**
   * 生成工作区状态的自然语言描述
   */
  generateWorkspaceDescription() {
    const summary = this.#workspaceState.getSummary();
    const lines = [];

    lines.push(
      `工作区已探索: ${summary.trackedFiles} 个文件, ${summary.trackedDirectories} 个目录`,
    );

    if (summary.knownNotFound > 0) {
      lines.push(`已知不存在的路径: ${summary.knownNotFound} 个`);
    }

    // 添加最近的发现
    const recentFacts = summary.recentFacts || [];
    if (recentFacts.length > 0) {
      lines.push('\n最近的发现:');
      for (const fact of recentFacts.slice(-3)) {
        lines.push(`- ${fact.type}: ${fact.value}`);
      }
    }

    return lines.join('\n');
  }

  // ============ 工具特定处理器 ============

  #handlers = {
    list_dir: (args, result) => {
      const path = args?.path || args?.dir || '.';

      if (typeof result === 'string') {
        const entries = result
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        // 记录到工作区状态
        this.#workspaceState.recordDirectoryListing(path, entries, 'list_dir');

        return {
          summary: `目录 ${path} 包含 ${entries.length} 个条目`,
          facts: [
            {
              type: 'directory_listing',
              value: { path, count: entries.length, entries: entries.slice(0, 10) },
              priority: 'medium',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `列出目录 ${path}`,
        facts: [],
        shouldCache: true,
      };
    },

    read_file: (args, result) => {
      const path = args?.path || args?.file_path || args?.file;
      const success =
        !result?.toString().startsWith('Error:') && !result?.toString().includes('No such file');

      if (success) {
        this.#workspaceState.recordFileRead(path, true, result);

        // 提取关键信息
        const keyInfo = this.#extractKeyInfo(result);

        return {
          summary: `已读取文件 ${path} (${keyInfo.lines} 行)`,
          facts: [
            {
              type: 'file_content_summary',
              value: { path, ...keyInfo },
              priority: 'high',
            },
          ],
          shouldCache: true,
        };
      } else {
        this.#workspaceState.recordFileRead(path, false, { error: result });

        return {
          summary: `无法读取文件 ${path}: ${result}`,
          facts: [
            {
              type: 'path_not_found',
              value: { path, error: result },
              priority: 'high',
            },
          ],
          shouldCache: true,
        };
      }
    },

    write_file: (args, result) => {
      const path = args?.path || args?.file_path || args?.file;

      if (result?.toString().includes('success') || result?.toString().includes('written')) {
        this.#workspaceState.recordFileWrite(path);

        return {
          summary: `成功写入文件 ${path}`,
          facts: [
            {
              type: 'file_created',
              value: { path },
              priority: 'high',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `写入文件 ${path} 结果: ${result}`,
        facts: [],
        shouldCache: true,
      };
    },

    edit_file: (args, result) => {
      const path = args?.path || args?.file_path;

      if (result?.toString().includes('success') || result?.toString().includes('edited')) {
        return {
          summary: `成功编辑文件 ${path}`,
          facts: [
            {
              type: 'file_modified',
              value: { path },
              priority: 'high',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `编辑文件 ${path} 结果: ${result}`,
        facts: [],
        shouldCache: true,
      };
    },

    glob: (args, result) => {
      const pattern = args?.pattern || args?.glob;

      if (Array.isArray(result)) {
        this.#workspaceState.recordGlobResults(pattern, result);

        return {
          summary: `Glob 模式 ${pattern} 匹配 ${result.length} 个文件`,
          facts: [
            {
              type: 'glob_matches',
              value: { pattern, count: result.length, examples: result.slice(0, 5) },
              priority: 'medium',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `Glob 搜索 ${pattern}`,
        facts: [],
        shouldCache: true,
      };
    },

    search: (args, result) => {
      const query = args?.query || args?.text || args?.search;

      if (typeof result === 'string') {
        const matches = (result.match(/---\n/g) || []).length;

        return {
          summary: `搜索 "${query}" 找到 ${matches} 处匹配`,
          facts: [
            {
              type: 'search_results',
              value: { query, count: matches },
              priority: 'medium',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `搜索 "${query}"`,
        facts: [],
        shouldCache: true,
      };
    },

    shell: (args, result) => {
      const command = args?.command || args?.input || '';

      // 从命令中提取关键信息
      if (command.includes('git status')) {
        return {
          summary: this.#parseGitStatus(result),
          facts: [
            {
              type: 'git_status',
              value: this.#parseGitStatus(result),
              priority: 'medium',
            },
          ],
          shouldCache: true,
        };
      }

      if (command.includes('ls') || command.includes('find')) {
        return {
          summary: `Shell 命令执行: ${command.substring(0, 50)}...`,
          facts: [
            {
              type: 'shell_output',
              value: { command, output: result?.toString().substring(0, 200) },
              priority: 'low',
            },
          ],
          shouldCache: true,
        };
      }

      return {
        summary: `执行命令: ${command.substring(0, 50)}...`,
        facts: [],
        shouldCache: true,
      };
    },

    pty_start: (args, result) => {
      const command = args?.command;

      return {
        summary: `启动交互式终端: ${command?.substring(0, 50) || 'command'}`,
        facts: [],
        shouldCache: true,
      };
    },
  };

  // ============ 辅助方法 ============

  #defaultSummary(toolName, args, result) {
    const argsPreview = args ? JSON.stringify(args).substring(0, 100) : '';
    return {
      summary: `工具 ${toolName}: ${argsPreview}`,
      facts: [],
      shouldCache: true,
    };
  }

  #extractKeyInfo(content) {
    if (typeof content !== 'string') {
      return { lines: 0, chars: 0 };
    }

    const lines = content.split('\n').length;
    const chars = content.length;
    const hasCode = /```|```[\s\S]*?```|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bimport\b/.test(
      content,
    );
    const hasError = /\berror\b|\bfail\b|\bexception\b/i.test(content);

    return {
      lines,
      chars,
      hasCode,
      hasError,
    };
  }

  #parseGitStatus(result) {
    if (!result || typeof result !== 'string') {
      return 'Git 状态未知';
    }

    const lines = result.split('\n').filter(Boolean);
    const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('M ')).length;
    const newFiles = lines.filter((l) => l.startsWith('??') || l.startsWith('A ')).length;
    const deleted = lines.filter((l) => l.startsWith(' D') || l.startsWith('D ')).length;

    return `Git: ${modified} 修改, ${newFiles} 新文件, ${deleted} 删除`;
  }

  #summarizeFactType(type, facts) {
    switch (type) {
      case 'path_not_found':
        return `❌ 不存在的路径: ${facts.map((f) => f.value.path).join(', ')}`;

      case 'directory_listing':
        return `📁 目录 ${facts[0]?.value?.path}: ${facts[0]?.value?.count || 0} 个条目`;

      case 'file_readable':
        return `✅ 可读文件: ${facts.map((f) => f.value.path).join(', ')}`;

      case 'file_created':
        return `✨ 新建文件: ${facts.map((f) => f.value.path).join(', ')}`;

      case 'file_modified':
        return `📝 已修改: ${facts.map((f) => f.value.path).join(', ')}`;

      case 'glob_matches':
        return `🔍 Glob ${facts[0]?.value?.pattern}: ${facts[0]?.value?.count || 0} 匹配`;

      case 'git_status':
        return facts[0]?.value || 'Git 状态';

      default:
        return `${type}: ${facts.length} 条记录`;
    }
  }
}

export default ObservationSummarizer;
