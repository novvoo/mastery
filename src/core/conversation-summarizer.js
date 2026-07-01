/**
 * ConversationSummarizer - 对话摘要压缩器
 *
 * 核心理念：遇到 token 超限时，不丢弃旧消息，而是将其压缩为语义摘要。
 * 类似 ChatGPT / Claude 的"对话摘要"机制 —— 旧消息被凝练为一段摘要文本注入上下文。
 *
 * 工作流程：
 *  1. 将消息历史分为三个区域：
 *     Zone 1 (远古) — 已压缩为摘要，不再逐条保留
 *     Zone 2 (中间) — 本轮需要压缩的消息批次
 *     Zone 3 (最近) — 保留完整内容，不压缩
 *  2. 对 Zone 2 的消息执行结构化提取：
 *     - 用户请求/意图
 *     - 工具调用及其结果摘要
 *     - 文件读写/编辑记录
 *     - 关键决策和发现
 *     - 错误和异常
 *  3. 生成密集的信息块，替换 Zone 2 的所有消息
 *
 * 与 DynamicContextPruning 的区别：
 *  - DCP: 裁剪 → 丢弃低重要性消息 → 信息丢失
 *  - 本模块: 压缩 → 将消息浓缩为摘要 → 语义保留
 */

// 摘要最大字符数（限制单次压缩产物的大小）
const MAX_SUMMARY_CHARS = 2000;
// 每个工具结果提取的最大字符数
const MAX_TOOL_RESULT_CHARS = 150;
// 文件操作记录的截取行数
const MAX_FILE_CONTENT_LINES = 3;

export class ConversationSummarizer {
  /** @type {import('./workspace/workspace-state.js').WorkspaceState|null} */
  #workspaceState;

  constructor(workspaceState = null) {
    this.#workspaceState = workspaceState;
  }

  /**
   * 将一批消息压缩为语义摘要。
   *
   * @param {Array<{role: string, content: string, toolCalls?: Array, toolCallId?: string, name?: string}>} messages
   *   需要压缩的消息列表（按时间顺序，从旧到新）
   * @param {object} [options]
   * @param {number} [options.maxChars=MAX_SUMMARY_CHARS] 摘要最大字符数
   * @returns {string} 语义摘要文本（可直接作为 system message 注入）
   */
  summarize(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return '';
    }

    const maxChars = options.maxChars || MAX_SUMMARY_CHARS;
    const parts = [];

    // === 1. 用户请求/意图提取 ===
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length > 0) {
      const userTasks = this.#extractUserTasks(userMessages);
      if (userTasks) {
        parts.push(userTasks);
      }
    }

    // === 2. 工具调用及其结果摘要 ===
    const toolResults = messages.filter((m) => m.role === 'tool' || m.role === 'tool_result');
    if (toolResults.length > 0) {
      const toolSummary = this.#summarizeToolOperations(toolResults);
      if (toolSummary) {
        parts.push(toolSummary);
      }
    }

    // === 3. 助手关键决策/发现 ===
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length > 0) {
      const assistantSummary = this.#summarizeAssistantResponses(assistantMessages);
      if (assistantSummary) {
        parts.push(assistantSummary);
      }
    }

    // === 4. WorkspaceState 关键事实（如果可用）===
    if (this.#workspaceState) {
      const wsFacts = this.#extractWorkspaceFacts();
      if (wsFacts) {
        parts.push(wsFacts);
      }
    }

    // === 5. 文件操作摘要 ===
    const fileOps = this.#extractFileOperations(messages);
    if (fileOps) {
      parts.push(fileOps);
    }

    // === 组装摘要 ===
    if (parts.length === 0) {
      return `[Previous context: ${messages.length} messages processed, no significant content extracted]`;
    }

    let summary = `[CONVERSATION SUMMARY — ${messages.length} earlier messages compressed]\n${parts.join('\n\n')}`;

    // 硬上限截断
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars - 50) + '\n... [summary truncated]';
    }

    return summary;
  }

  /**
   * 提取用户任务/意图
   */
  #extractUserTasks(userMessages) {
    const tasks = [];
    const seen = new Set(); // 去重

    for (const msg of userMessages) {
      const content = String(msg.content || '').trim();
      if (!content || seen.has(content.slice(0, 80))) {continue;}
      seen.add(content.slice(0, 80));

      // 提取前 120 字符作为任务描述
      const taskDesc = content.length > 120 ? content.slice(0, 120) + '...' : content;
      // 跳过纯提示/格式化消息（如 "No tool call detected" 等）
      if (
        taskDesc.includes('No tool call detected') ||
        taskDesc.includes('output in one of these formats') ||
        taskDesc.startsWith('[HARD STOP]') ||
        taskDesc.startsWith('[TERMINAL]') ||
        taskDesc.startsWith('[Context summary') ||
        taskDesc.startsWith('Observation from')
      ) {
        continue;
      }
      tasks.push(taskDesc);
    }

    if (tasks.length === 0) {return null;}

    return `User Tasks & Feedback:\n${tasks.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`;
  }

  /**
   * 摘要工具操作及其结果
   */
  #summarizeToolOperations(toolResults) {
    // 按工具类型分组
    const byOperation = {
      reads: [], // read_file, file_read
      writes: [], // write_file, edit_file, replace_in_file
      searches: [], // search, grep, glob, find
      lists: [], // list_dir, ls
      shells: [], // execute_command, shell
      other: [],
    };

    for (const msg of toolResults) {
      const content = String(msg.content || '');
      const prefix = this.#classifyObservation(content);

      switch (prefix.type) {
        case 'file_read':
          byOperation.reads.push({ path: prefix.path, summary: prefix.summary });
          break;
        case 'file_write':
        case 'file_edit':
          byOperation.writes.push({ path: prefix.path, summary: prefix.summary });
          break;
        case 'search':
          byOperation.searches.push({ summary: prefix.summary });
          break;
        case 'list':
          byOperation.lists.push({ summary: prefix.summary });
          break;
        case 'shell':
          byOperation.shells.push({ summary: prefix.summary });
          break;
        default:
          // 尝试从 content 中提取关键信息
          const trimmed = content.slice(0, MAX_TOOL_RESULT_CHARS).replace(/\n/g, ' ');
          if (trimmed.length > 20) {
            byOperation.other.push({ summary: trimmed });
          }
      }
    }

    const lines = [];

    if (byOperation.reads.length > 0) {
      const uniquePaths = [...new Set(byOperation.reads.map((r) => r.path).filter(Boolean))];
      lines.push(`Files Read (${byOperation.reads.length}): ${uniquePaths.slice(0, 8).join(', ')}`);
    }

    if (byOperation.writes.length > 0) {
      const uniquePaths = [...new Set(byOperation.writes.map((w) => w.path).filter(Boolean))];
      lines.push(
        `Files Modified/Written (${byOperation.writes.length}): ${uniquePaths.join(', ')}`,
      );
    }

    if (byOperation.searches.length > 0) {
      lines.push(
        `Searches: ${byOperation.searches
          .slice(0, 5)
          .map((s) => s.summary)
          .join(' | ')}`,
      );
    }

    if (byOperation.lists.length > 0) {
      lines.push(
        `Directories Listed: ${byOperation.lists
          .slice(0, 5)
          .map((l) => l.summary)
          .join(', ')}`,
      );
    }

    if (byOperation.shells.length > 0) {
      lines.push(`Shell Commands Executed: ${byOperation.shells.length} operations`);
    }

    if (byOperation.other.length > 0 && lines.length === 0) {
      lines.push(`Tool Operations: ${byOperation.other.length} miscellaneous`);
    }

    // 统计
    const total = toolResults.length;
    lines.push(`Total tool operations in this segment: ${total}`);

    return lines.length > 0
      ? `Tool Operations Summary:\n${lines.map((l) => `  • ${l}`).join('\n')}`
      : null;
  }

  /**
   * 摘要助手响应中的关键决策
   */
  #summarizeAssistantResponses(messages) {
    const insights = [];
    const decisions = [];

    for (const msg of messages) {
      const content = String(msg.content || '');

      // 提取关键决策信号
      const decisionPatterns = [
        {
          regex: /I (will|am going to|plan to|need to|should|must)\s+(.{20,150})/gi,
          label: 'plan',
        },
        {
          regex: /(?:decided|decision|choose|select)\s+(?:to\s+)?(.{20,150})/gi,
          label: 'decision',
        },
        {
          regex: /(?:discovered|found|identified|noticed|realized)\s+(?:that\s+)?(.{20,150})/gi,
          label: 'discovery',
        },
        {
          regex: /(?:the issue is|the problem is|the root cause is|the bug is)\s+(.{20,150})/gi,
          label: 'diagnosis',
        },
      ];

      for (const { regex, label } of decisionPatterns) {
        let match;
        while ((match = regex.exec(content)) !== null) {
          const text = (match[1] || '').trim().replace(/\n/g, ' ');
          if (text.length > 5 && text.length < 200) {
            (label === 'plan' || label === 'decision' ? decisions : insights).push(
              `[${label}] ${text}`,
            );
          }
        }
      }

      // 提取 tool calls 名称
      const toolCalls = msg.toolCalls || msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        const names = toolCalls.map((tc) => tc.function?.name || tc.name || 'unknown');
        decisions.push(`[called tools] ${names.join(', ')}`);
      }

      // 检测最终答案
      if (
        /FINAL_ANSWER|final answer|summary of changes|here.*what.*(done|changed|created|fixed)/i.test(
          content,
        )
      ) {
        decisions.push('[produced] Final answer / task completion');
      }
    }

    const lines = [];
    if (decisions.length > 0) {
      lines.push(
        `Key Decisions:\n${decisions
          .slice(0, 6)
          .map((d) => `  • ${d}`)
          .join('\n')}`,
      );
    }
    if (insights.length > 0) {
      lines.push(
        `Key Insights:\n${insights
          .slice(0, 6)
          .map((i) => `  • ${i}`)
          .join('\n')}`,
      );
    }
    if (lines.length === 0 && messages.length > 0) {
      lines.push(`Assistant Responses: ${messages.length} messages`);
    }

    return lines.length > 0 ? `Assistant Analysis Summary:\n${lines.join('\n')}` : null;
  }

  /**
   * 提取文件操作记录
   */
  #extractFileOperations(messages) {
    const operations = {
      created: [],
      modified: [],
      deleted: [],
      searched: [],
    };

    for (const msg of messages) {
      const content = String(msg.content || '');

      // 从 assistant 的工具调用中提取
      if (msg.role === 'assistant' && (msg.toolCalls || msg.tool_calls)) {
        const calls = msg.toolCalls || msg.tool_calls || [];
        for (const call of calls) {
          const name = (call.function?.name || call.name || '').toLowerCase();
          const args = this.#parseArgs(call.function?.arguments || call.arguments);
          const path = args?.path || args?.file_path || args?.file || args?.target_file;

          if (!path) {continue;}

          if (name.includes('write') || name.includes('create')) {
            operations.created.push(path);
          } else if (name.includes('edit') || name.includes('replace') || name.includes('modify')) {
            operations.modified.push(path);
          } else if (name.includes('delete') || name.includes('remove')) {
            operations.deleted.push(path);
          } else if (
            name.includes('search') ||
            name.includes('grep') ||
            name.includes('find') ||
            name.includes('glob')
          ) {
            operations.searched.push(args?.pattern || args?.query || args?.text || path);
          }
        }
      }

      // 从 tool result 中提取 "Successfully wrote/edited/deleted" 消息
      if (msg.role === 'tool' || msg.role === 'tool_result') {
        const writeMatch = content.match(
          /(?:Successfully|成功)\s+(?:wrote|created|写入|创建)\s+(?:file\s+)?['"]?([^\s"'\n]+)/i,
        );
        if (writeMatch) {operations.created.push(writeMatch[1]);}

        const editMatch = content.match(
          /(?:Successfully|成功)\s+(?:edited|modified|编辑|修改)\s+(?:file\s+)?['"]?([^\s"'\n]+)/i,
        );
        if (editMatch) {operations.modified.push(editMatch[1]);}

        const delMatch = content.match(
          /(?:Successfully|成功)\s+(?:deleted|removed|删除)\s+(?:file\s+)?['"]?([^\s"'\n]+)/i,
        );
        if (delMatch) {operations.deleted.push(delMatch[1]);}
      }
    }

    const lines = [];
    const uniqCreated = [...new Set(operations.created)];
    const uniqModified = [...new Set(operations.modified)];
    const uniqDeleted = [...new Set(operations.deleted)];

    if (uniqCreated.length > 0) {
      lines.push(`Files Created: ${uniqCreated.join(', ')}`);
    }
    if (uniqModified.length > 0) {
      lines.push(`Files Modified: ${uniqModified.join(', ')}`);
    }
    if (uniqDeleted.length > 0) {
      lines.push(`Files Deleted: ${uniqDeleted.join(', ')}`);
    }
    if (operations.searched.length > 0) {
      lines.push(`Search Patterns: ${[...new Set(operations.searched)].slice(0, 5).join(', ')}`);
    }

    return lines.length > 0 ? `File Operations:\n${lines.map((l) => `  • ${l}`).join('\n')}` : null;
  }

  /**
   * 从 WorkspaceState 提取关键事实
   */
  #extractWorkspaceFacts() {
    if (!this.#workspaceState) {return null;}

    const summary = this.#workspaceState.getSummary();
    const criticalFacts = this.#workspaceState.getCriticalFacts();

    const lines = [];

    if (summary.trackedFiles > 0 || summary.trackedDirectories > 0) {
      lines.push(
        `Workspace explored: ${summary.trackedFiles} files, ${summary.trackedDirectories} dirs`,
      );
    }

    if (summary.knownNotFound > 0) {
      lines.push(`Known non-existent paths: ${summary.knownNotFound}`);
    }

    if (criticalFacts.length > 0) {
      const factLines = criticalFacts.slice(0, 8).map((f) => {
        const val =
          typeof f.value === 'object'
            ? JSON.stringify(f.value).slice(0, 80)
            : String(f.value).slice(0, 80);
        return `  - ${f.type}: ${val}`;
      });
      lines.push(`Critical Facts:\n${factLines.join('\n')}`);
    }

    return lines.length > 0 ? `Workspace Knowledge:\n${lines.join('\n')}` : null;
  }

  /**
   * 分类 Observation 消息
   */
  #classifyObservation(content) {
    if (!content) {return { type: 'unknown', summary: '' };}

    // Observation from tool_name: ...
    const obsMatch = content.match(/^Observation from (\w+)/);
    const toolName = obsMatch ? obsMatch[1] : '';

    // read_file 结果
    if (toolName === 'read_file' || toolName === 'file_read') {
      const pathMatch = content.match(/File "([^"]+)"|Path "([^"]+)"/);
      const path = pathMatch ? pathMatch[1] || pathMatch[2] : '';
      const linesMatch = content.match(/(\d+)\s+(?:lines?|行)/);
      const lines = linesMatch ? linesMatch[1] : '?';
      return {
        type: 'file_read',
        path,
        summary: `read ${path} (${lines} lines)`,
      };
    }

    // write_file 结果
    if (toolName === 'write_file' || toolName === 'file_write') {
      const pathMatch = content.match(/File "([^"]+)"|file\s+([^\s,]+)/i);
      const path = pathMatch ? pathMatch[1] || pathMatch[2] : '';
      return {
        type: 'file_write',
        path,
        summary: `wrote ${path}`,
      };
    }

    // edit_file 结果
    if (toolName === 'edit_file' || toolName === 'replace_in_file') {
      const pathMatch = content.match(/File "([^"]+)"|file\s+([^\s,]+)/i);
      const path = pathMatch ? pathMatch[1] || pathMatch[2] : '';
      return {
        type: 'file_edit',
        path,
        summary: `edited ${path}`,
      };
    }

    // list_dir 结果
    if (toolName === 'list_dir') {
      const pathMatch = content.match(/目录\s+(\S+)|Directory\s+"([^"]+)"/);
      const path = pathMatch ? pathMatch[1] || pathMatch[2] : '';
      const countMatch = content.match(/(\d+)\s+(?:个条目|entries?)/);
      const count = countMatch ? countMatch[1] : '?';
      return {
        type: 'list',
        path,
        summary: `listed ${path} (${count} entries)`,
      };
    }

    // search / grep 结果
    if (toolName === 'search' || toolName === 'grep' || toolName === 'search_content') {
      const matchCount = (content.match(/found|matches?|处匹配/gi) || []).length;
      const firstLine = content.split('\n')[0]?.slice(0, 100) || '';
      return {
        type: 'search',
        summary: firstLine || `search result (${matchCount} hints)`,
      };
    }

    // shell 命令结果
    if (toolName === 'execute_command' || toolName === 'shell') {
      const cmdMatch = content.match(/(?:command|Command):\s*(.+)/i);
      const cmd = cmdMatch ? cmdMatch[1].slice(0, 80) : 'shell command';
      return {
        type: 'shell',
        summary: cmd,
      };
    }

    return { type: 'unknown', summary: content.slice(0, MAX_TOOL_RESULT_CHARS) };
  }

  /**
   * 解析工具参数
   */
  #parseArgs(args) {
    if (!args) {return null;}
    if (typeof args === 'object' && !Array.isArray(args)) {return args;}
    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default ConversationSummarizer;
