/**
 * AgentRouter — 工具调用执行、安全策略、去重、缓存
 *
 * 从 ReActAgent 拆出的职责：
 *   - 工具调用规范化、安全校验、执行
 *   - 工具结果缓存（内存 + JSONL 持久化）
 *   - 去重检查
 *   - 工作区状态预测
 *   - Shell 运行时工具重写
 *   - 工具未找到时的友好错误
 */

import { withTimeout } from '../../../errors/error-handler.js';
import { existsSync } from 'fs';
import { readFile, appendFile, mkdir } from 'fs/promises';
import { normalizeToolArgumentAliases } from './tool-executor.js';

const NON_CACHEABLE_TOOLS = new Set(['ask_user', 'request_user_input']);

export class AgentRouter {
  #debugEvent;
  #toolRegistry;
  #textToolParser;
  #ui;
  #config;
  #contentStore;
  #fileAnalyzer;
  #memoryManager;
  #sessionManager;
  #modelProvider;

  // 去重
  #toolCallHistory = [];
  // 持久化缓存
  #toolResultCache = new Map();
  #toolResultCachePath;
  #toolResultCacheMaxSize = 500;
  #toolResultCacheLoaded = false;
  #toolResultCacheEnabled = true;

  constructor({
    debugEvent,
    toolRegistry,
    textToolParser,
    ui,
    config,
    contentStore,
    fileAnalyzer,
    memoryManager,
    sessionManager,
    modelProvider,
  }) {
    this.#debugEvent = debugEvent;
    this.#toolRegistry = toolRegistry;
    this.#textToolParser = textToolParser;
    this.#ui = ui;
    this.#config = config;
    this.#contentStore = contentStore;
    this.#fileAnalyzer = fileAnalyzer;
    this.#memoryManager = memoryManager;
    this.#sessionManager = sessionManager;
    this.#modelProvider = modelProvider;

    this.#toolResultCacheEnabled = config.toolResultCacheEnabled !== false;
    const agentDataDir = `${config.workingDirectory}/.agent-data`;
    this.#toolResultCachePath = this.#toolResultCacheEnabled
      ? `${agentDataDir}/tool-cache.jsonl`
      : null;
    this.#toolResultCacheMaxSize = 500;
    this.#toolResultCacheLoaded = false;
  }

  /** 重置每次 run 的状态 */
  reset() {
    this.#toolCallHistory = [];
    this.#toolResultCache = new Map();
    this.#toolResultCacheLoaded = false;
  }

  /**
   * 执行单个工具调用
   * @param {object} toolCall
   * @param {object} options - { resultMode, activeRoutedToolNames, workspaceState, observationSummarizer, currentTask }
   * @returns {Promise<{name:string, result:any, error?:string, skipped?:boolean}>}
   */
  async executeToolCall(toolCall, options = {}) {
    const normalizedToolCall = this.#normalizeToolCall(toolCall);
    if (!normalizedToolCall || typeof normalizedToolCall !== 'object') {
      return {
        name: 'unknown',
        result: null,
        error: 'Invalid tool call: null or invalid input',
      };
    }
    const rewrittenToolCall =
      this.#rewriteShellRuntimeToolCall(normalizedToolCall) || normalizedToolCall;
    const { id, name, arguments: args } = rewrittenToolCall;
    const resultMode = options.resultMode || 'tool';
    const startedAt = Date.now();

    // 去重 - Phase 6 优化：使用增强签名，降低跨任务/同参数不同上下文的误伤
    const callSignature = this.#computeCallSignature(name, args, options);
    const canUseCache = !NON_CACHEABLE_TOOLS.has(name);
    if (canUseCache) {
      await this.#loadToolResultCache();
    }
    if (
      canUseCache &&
      (this.#toolCallHistory.includes(callSignature) || this.#toolResultCache.has(callSignature))
    ) {
      const cachedResult = this.#toolResultCache.get(callSignature);
      if (cachedResult) {
        this.#ui.info?.(`Duplicate tool call: ${name}. Reusing cached result.`);
        this.#debugEvent('Tool call cached', {
          reason: 'duplicate',
          tool: name,
          arguments: args,
          resultMode,
          cachedResult: true,
          currentTaskId: options.currentTask?.id,
        });
        return { name, args, result: cachedResult, cached: true, reused: true };
      }
      this.#ui.warn(`Duplicate tool call detected: ${name}. No cached result available.`);
      return {
        name,
        args,
        result: `Duplicate ${name} blocked: no cached result available. Change arguments or move to the next task.`,
        skipped: true,
        duplicate: true,
      };
    }
    if (canUseCache) {
      this.#toolCallHistory.push(callSignature);
      if (this.#toolCallHistory.length > 50) {
        this.#toolCallHistory = this.#toolCallHistory.slice(-25);
      }
    }

    // 工作区状态预测
    const { workspaceState, observationSummarizer } = options;
    if (workspaceState) {
      const prediction = workspaceState.predictToolResult(name, args);
      if (prediction.canSkip) {
        const isWarning = prediction.type === 'will_fail';
        const logFn = isWarning ? this.#ui.warn : this.#ui.info;
        logFn?.(`${isWarning ? '⚠️' : 'ℹ️'} Skipping ${name}: ${prediction.reason}`);
        this.#debugEvent('Tool call skipped (workspace prediction)', {
          tool: name,
          arguments: args,
          reason: prediction.reason,
          prediction: prediction.type,
        });
        return {
          name,
          args,
          result: prediction.predicted || { error: prediction.reason },
          skipped: true,
          predicted: true,
        };
      }
    }

    this.#ui.toolCall(name, args);

    // 工具查找
    const tool = this.#toolRegistry.get(name);
    if (!tool) {
      const errorMsg = this.#formatToolNotFoundError(name, options.activeRoutedToolNames);
      this.#debugEvent('Tool lookup failed', { tool: name, arguments: args });
      this.#ui.toolError(name, errorMsg);
      return { name, args, result: errorMsg, error: errorMsg };
    }

    // 路由检查：当 currentTask 存在时，由任务的 allowedTools 和安全策略决定，不做 phase 限制
    if (options.activeRoutedToolNames && !options.activeRoutedToolNames.has(name)) {
      const taskAllowed = options.currentTask?.allowedTools;
      if (taskAllowed && taskAllowed.includes(name)) {
        // 当前任务允许该工具，放行（由安全策略和 scopeFiles 做最终守卫）
      } else if (taskAllowed && !taskAllowed.includes(name)) {
        // 当前任务存在但未明确允许该工具，检查安全策略
        const securityPolicy = options.securityPolicy;
        if (securityPolicy && typeof securityPolicy.isToolAllowed === 'function') {
          if (!securityPolicy.isToolAllowed(name)) {
            const errorMsg = `Tool "${name}" is blocked by security policy.`;
            this.#debugEvent('Tool call blocked by security policy', {
              tool: name,
              arguments: args,
            });
            this.#ui.toolError(name, errorMsg);
            return { name, args, result: errorMsg, error: errorMsg };
          }
        }
        // 安全策略允许，则放行
      } else {
        // 没有 currentTask，严格路由检查
        const availableToolNames = Array.from(options.activeRoutedToolNames).join(', ') || '(none)';
        const errorMsg = `Tool "${name}" is registered but not available in the current request phase. Available tools now: ${availableToolNames}.`;
        this.#debugEvent('Tool call blocked by routing', { tool: name, arguments: args });
        this.#ui.toolError(name, errorMsg);
        return { name, args, result: errorMsg, error: errorMsg };
      }
    }

    // 参数别名标准化
    let effectiveArgs = normalizeToolArgumentAliases(name, args || {});

    // 参数校验
    if (typeof this.#toolRegistry.validateAndCoerceArgs === 'function') {
      const v = this.#toolRegistry.validateAndCoerceArgs(name, effectiveArgs);
      if (!v.valid) {
        // 参数校验失败 —— 返回错误让 LLM 修正后重新调用
        const schemaInfo = v.schema || {};
        const requiredParams = schemaInfo.required || [];
        const paramDefs = schemaInfo.properties || {};
        const paramDesc = Object.entries(paramDefs)
          .map(([k, def]) => {
            const type = def.type || 'any';
            const desc = def.description || '';
            const req = requiredParams.includes(k) ? '（必填）' : '（可选）';
            return `${k}: ${type}${req}${desc ? ` - ${desc}` : ''}`;
          })
          .join('\n');

        const errorMsg = `工具 "${name}" 参数校验失败，请修正后重新调用：

错误详情：
${v.errors.map((e) => `  - ${e}`).join('\n')}

传入的参数：
${JSON.stringify(v.originalArgs || args, null, 2)}

期望的参数定义：
${paramDesc || '无参数定义'}

请检查参数类型和必填项，修正后重新发起工具调用。`;

        this.#ui.warn?.(`[Tool args blocked] ${name}: ${v.errors.join('; ')}`);
        this.#debugEvent('Tool call blocked by param validation', { tool: name, errors: v.errors });
        return { name, args: effectiveArgs, result: errorMsg, error: errorMsg };
      }
      effectiveArgs = v.coercedArgs;
    }

    // 必填参数检查
    if (tool.required && Array.isArray(tool.required)) {
      const missing = tool.required.filter((param) => {
        const value = effectiveArgs ? effectiveArgs[param] : undefined;
        return value === undefined || value === null || value === '';
      });
      if (missing.length > 0) {
        const errorMsg = `Missing required parameter(s): ${missing.join(', ')}. The "${name}" tool requires: ${tool.required.join(', ')}.`;
        this.#debugEvent('Tool call missing required params', { tool: name, missing });
        this.#ui.warn?.(errorMsg);
        return { name, args: effectiveArgs, result: errorMsg, error: errorMsg };
      }
    }

    // 安全策略
    const securityBlock = this.#enforceToolSecurity(name, args);
    if (securityBlock) {
      this.#debugEvent('Tool call blocked by security policy', {
        tool: name,
        reason: securityBlock,
      });
      this.#ui.toolError(name, securityBlock);
      return {
        name,
        args: effectiveArgs,
        result: `Error: Security policy blocked ${name}: ${securityBlock}`,
        error: securityBlock,
      };
    }

    this.#debugEvent('Tool call started', {
      id,
      tool: name,
      category: tool.category,
      source: rewrittenToolCall.source || toolCall.source || 'native',
      resultMode,
      workingDirectory: this.#config.workingDirectory,
      arguments: args,
      purpose: tool.description,
    });

    try {
      const context = {
        workingDirectory: this.#config.workingDirectory,
        memoryManager: this.#memoryManager,
        sessionManager: this.#sessionManager,
        modelProvider: this.#modelProvider,
        debug: this.#isDebugEnabled(),
        ui: this.#ui,
        toolName: name,
        subAgent: this.#config.subAgent,
        activePlanManager: options.activePlanManager,
        planner: options.planner,
        activePlan: options.activePlan,
        currentTask: options.currentTask,
        contentStore: this.#contentStore,
        fileAnalyzer: this.#fileAnalyzer,
      };

      // —— write_file 预览审批：若注册了 writeFileApproval 回调，先让用户确认 ——
      if (name === 'write_file' && typeof this.#config.writeFileApproval === 'function') {
        const approved = await this.#config.writeFileApproval({
          args: effectiveArgs,
          workingDirectory: this.#config.workingDirectory,
          context,
        });
        if (approved === false) {
          return {
            name,
            args: effectiveArgs,
            result: 'write_file: 用户取消了本次写入（diff 预览阶段拒绝）。',
            skipped: true,
          };
        }
        // 若审批返回了一个对象 { content?: string }，用它覆盖 original args.content
        if (approved && typeof approved === 'object' && typeof approved.content === 'string') {
          effectiveArgs = { ...(effectiveArgs || {}), content: approved.content };
        }
      }

      const result = await withTimeout(
        () => tool.handler(effectiveArgs, context),
        60000,
        `Tool ${name}`,
      );

      const finalResult = this.#applyToolSecurityResultPolicy(name, result);

      // ---- WorkspaceState 自动 hook：读/写文件后更新快照与最近引用 ----
      if (workspaceState) {
        this.#updateWorkspaceState(name, effectiveArgs, finalResult, workspaceState);
      }

      this.#debugEvent('Tool call completed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        resultPreview: this.#preview(
          typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult),
          300,
        ),
      });
      this.#ui.toolResult(name, finalResult);
      if (canUseCache) {
        this.#toolResultCache.set(
          callSignature,
          typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult),
        );
        this.#flushToolResultCacheEntry(callSignature, this.#toolResultCache.get(callSignature));
      }

      return { name, args: effectiveArgs, result: finalResult };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#debugEvent('Tool call failed', {
        tool: name,
        durationMs: Date.now() - startedAt,
        error: errorMsg,
      });
      this.#ui.toolError(name, errorMsg);
      return { name, args: effectiveArgs, result: `Error: ${errorMsg}`, error: errorMsg };
    }
  }

  // ---- 缓存 ----

  async #loadToolResultCache() {
    if (this.#toolResultCacheLoaded) {
      return;
    }
    this.#toolResultCacheLoaded = true;
    if (!this.#toolResultCachePath) {
      return;
    }
    try {
      if (!existsSync(this.#toolResultCachePath)) {
        return;
      }
      const content = await readFile(this.#toolResultCachePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines.slice(-this.#toolResultCacheMaxSize)) {
        try {
          const { signature, result } = JSON.parse(line);
          if (signature && typeof result === 'string') {
            this.#toolResultCache.set(signature, result);
          }
        } catch {
          /* skip malformed line */
        }
      }
    } catch (err) {
      try {
        console.warn('[ToolCache] 加载失败:', err.message);
      } catch {}
    }
  }

  async #flushToolResultCacheEntry(signature, result) {
    if (!this.#toolResultCachePath) {
      return;
    }
    try {
      const dir = this.#toolResultCachePath.substring(
        0,
        this.#toolResultCachePath.lastIndexOf('/'),
      );
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      const line = JSON.stringify({ signature, result, createdAt: Date.now() }) + '\n';
      await appendFile(this.#toolResultCachePath, line, 'utf-8');
    } catch (err) {
      try {
        console.warn('[ToolCache] 写入失败:', err.message);
      } catch {}
    }
  }

  // ---- 去重签名（Phase 6） ----

  /**
   * 计算增强的工具调用签名，用于精确去重。
   * 相比旧的 `${name}:${JSON.stringify(args)}`，改进点：
   *   1. 参数键按字母顺序规范化，避免键序不同导致重复 miss
   *   2. 加入 currentTask.id，避免跨任务同参数被误判为重复
   *   3. 读工具加入工作区文件 tag/版本，避免文件已变更后仍复用旧结果
   */
  #computeCallSignature(name, args, options = {}) {
    const normalizedArgs = this.#normalizeArgsForSignature(args);
    const parts = [name, JSON.stringify(normalizedArgs)];

    if (options.currentTask?.id) {
      parts.push(`task:${options.currentTask.id}`);
    }

    // 对读工具，若 workspaceState 能提供文件版本标识，则加入签名
    if (this.#isReadTool(name) && options.workspaceState) {
      const targetPath = this.#getReadToolTargetPath(name, args);
      if (targetPath && typeof options.workspaceState.getFileTag === 'function') {
        const tag = options.workspaceState.getFileTag(targetPath);
        if (tag) {
          parts.push(`tag:${tag}`);
        }
      }
    }

    return parts.join('|');
  }

  #normalizeArgsForSignature(value) {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.#normalizeArgsForSignature(item));
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = this.#normalizeArgsForSignature(value[key]);
    }
    return sorted;
  }

  #isReadTool(name) {
    return ['read_file', 'list_dir', 'glob', 'tree', 'stat_file', 'search_codebase'].includes(name);
  }

  #getReadToolTargetPath(name, args) {
    if (!args) {
      return null;
    }
    switch (name) {
      case 'read_file':
        return args.path || args.filePath || null;
      case 'list_dir':
      case 'glob':
      case 'tree':
      case 'stat_file':
        return args.path || null;
      case 'search_codebase':
        return args.path || args.target_directories?.[0] || null;
      default:
        return null;
    }
  }

  // ---- 工具调用规范化 ----

  #normalizeToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') {
      return toolCall;
    }
    if (toolCall.name) {
      return { ...toolCall, arguments: this.#parseToolArguments(toolCall.arguments) };
    }
    if (toolCall.function?.name) {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: this.#parseToolArguments(toolCall.function.arguments),
        source: toolCall.type || 'native_tool_call',
        raw: toolCall,
      };
    }
    return toolCall;
  }

  #parseToolArguments(args) {
    if (!args) {
      return {};
    }
    if (typeof args === 'object') {
      return args;
    }
    if (typeof args !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  #rewriteShellRuntimeToolCall(toolCall) {
    if (toolCall?.name !== 'shell') {
      return null;
    }
    const command = String(toolCall.arguments?.command || '').trim();
    if (!command) {
      return null;
    }
    const parsed = this.#textToolParser
      .parse(`\`\`\`bash\n${command}\n\`\`\``)
      .filter((call) => call.name !== 'shell');
    if (parsed.length === 0) {
      return null;
    }
    const replacement = parsed[0];
    this.#debugEvent('Shell tool call rewritten to runtime tool', {
      originalCommand: command,
      replacementTool: replacement.name,
      replacementArguments: replacement.arguments,
    });
    return { ...replacement, id: toolCall.id, source: 'shell_runtime_tool_redirect' };
  }

  // ---- 安全 ----

  #enforceToolSecurity(name, args) {
    const policy = this.#config.securityPolicy;
    if (!policy) {
      return null;
    }
    if (typeof policy.requiresApproval === 'function' && policy.requiresApproval(name)) {
      return 'approval_required';
    }
    if (typeof policy.validateToolCall === 'function') {
      const result = policy.validateToolCall(name, args);
      if (result === false) {
        return 'denied';
      }
      if (result && result.allowed === false) {
        return result.reason || 'denied';
      }
    }
    return null;
  }

  #applyToolSecurityResultPolicy(name, result) {
    const policy = this.#config.securityPolicy;
    if (policy && typeof policy.truncateResult === 'function') {
      return policy.truncateResult(name, result);
    }
    return result;
  }

  // ---- 错误格式化 ----

  #formatToolNotFoundError(toolName, activeRoutedToolNames) {
    const allTools = this.#toolRegistry.getAll();
    const availableToolNames = activeRoutedToolNames
      ? Array.from(activeRoutedToolNames).join(', ')
      : allTools.map((t) => t.name).join(', ');

    const browserToolPatterns = [
      'navigate',
      'browse',
      'browser',
      'web',
      'url',
      'fetch',
      'get_weather',
    ];
    const isBrowserTool = browserToolPatterns.some((pattern) =>
      toolName.toLowerCase().includes(pattern),
    );

    let errorMsg = `Unknown tool: "${toolName}". Available tools: ${availableToolNames}`;
    if (isBrowserTool) {
      errorMsg += `\n\nℹ️  It looks like you're trying to use a browser/web tool. `;
      errorMsg += `These tools are provided by MCP servers. Try using:\n`;
      errorMsg += `  1. Use "mcp_list_servers" to see connected MCP servers\n`;
      errorMsg += `  2. Use "mcp_list_tools" to see all available MCP tools\n`;
      errorMsg += `  3. If no browser server is connected, use "mcp_connect" to connect one`;
    }

    const mcpTools = allTools.filter((t) => t.name.includes('/') || t.name.startsWith('mcp_'));
    if (mcpTools.length > 0 && toolName.includes('/') === false && !toolName.startsWith('mcp_')) {
      const similarTools = mcpTools.filter((t) =>
        t.name.toLowerCase().includes(toolName.toLowerCase().split('/').pop()),
      );
      if (similarTools.length > 0) {
        errorMsg += `\n\n💡  Did you mean one of these? ${similarTools.map((t) => t.name).join(', ')}`;
      }
    }
    return errorMsg;
  }

  #isDebugEnabled() {
    return this.#config.debug === true || process.env.DEBUG === 'true';
  }

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }

  // ---- WorkspaceState hook：读/写/列举文件后自动同步 ----
  #updateWorkspaceState(toolName, args, result, ws) {
    if (!ws || !args) {
      return;
    }
    const filePath = args.path || args.file_path || args.file || args.target || null;

    // 1) 任何"带 path 的文件操作"都把该路径标记为"最近引用"
    if (filePath && typeof filePath === 'string') {
      try {
        ws.recordReference(filePath, toolName);
      } catch (_) {}
    }

    // 2) read_file / read_file_lines → 缓存文件内容快照
    if (
      (toolName === 'read_file' || toolName === 'file_read' || toolName === 'cat_file') &&
      filePath
    ) {
      try {
        if (result && typeof result === 'object') {
          const text = result.text ?? result.content ?? result.data ?? null;
          if (typeof text === 'string' && text.length > 0) {
            ws.setFileSnapshot(filePath, text, toolName);
          }
        } else if (typeof result === 'string') {
          ws.setFileSnapshot(filePath, result, toolName);
        }
      } catch (_) {}
    }

    // 3) write_file → 缓存写入的内容
    if ((toolName === 'write_file' || toolName === 'file_write') && filePath) {
      const content = args.content ?? args.text ?? null;
      if (typeof content === 'string' && content.length > 0) {
        try {
          ws.setFileSnapshot(filePath, content, toolName);
        } catch (_) {}
      }
    }

    // 4) list_dir / glob → 同步标记目录存在（recordDirectoryListing
    if (toolName === 'list_dir' || toolName === 'glob_search' || toolName === 'glob') {
      try {
        const entries = Array.isArray(result?.entries)
          ? result.entries
          : Array.isArray(result?.files)
            ? result.files
            : Array.isArray(result)
              ? result
              : [];
        if (filePath) {
          ws.recordDirectoryListing(filePath, entries.map(String), toolName);
        }
      } catch (_) {}
    }
  }
}
