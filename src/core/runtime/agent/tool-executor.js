/**
 * Tool Executor — 工具调用执行器
 *
 * 职责：
 *   - 规范化工具调用（合并原生与 text-parsed）
 *   - 去重与缓存（进程内 + 跨进程 JSONL 文件）
 *   - 安全策略 enforcement（调用 SecurityPolicy.evaluate）
 *   - 参数 schema 验证（对 ToolRegistry.validateAndCoerceArgs）
 *   - 必填参数兜底检查
 *   - 超时控制（withTimeout 60s/tool）
 *   - shell 工具运行时重写（redirect shell 为 runtime tool）
 *   - 记录到 ToolEvents，更新工作区状态，通知执行计划
 *
 * 原为 ReActAgent.#executeToolCall 及其辅助方法，约 200 行。
 */

import { existsSync, mkdir } from 'fs';
import { readFile, appendFile } from 'fs/promises';
import path from 'path';
import { withTimeout } from '../../../errors/error-handler.js';
import { TextToolParser } from '../../text-tool-parser.js';
import { Decision } from './support/security-policy.js';

const TOOL_RESULT_CACHE_MAX = 500;
const TOOL_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DIR_TOOL_CACHE_TTL_MS = 30 * 1000;
const READ_ONLY_TOOLS = new Set([
  'list_dir',
  'read_file',
  'glob',
  'tree',
  'stat_file',
  'search_codebase',
  'file_analyzer',
  'view_patch',
  'workspace_knowledge',
]);

const MUTATION_TOOLS = new Set([
  'write_file',
  'write_file_with_hashline',
  'edit_file',
  'update_file',
  'delete_file',
  'move_file',
  'rename_file',
  'shell',
  'lsp_rename',
  'lsp_workspace_edit',
  'lsp_code_action',
  'hashline_apply',
]);

function isPlanTaskPseudoTool(name) {
  return /^task_\d+$/i.test(String(name || ''));
}

// ==== 文件作用域强制：工程级约束，不依赖 prompt ====
// 当执行计划提供了当前子任务的 scopeFiles 时，
// 以下工具的目标路径必须在 scopeFiles 范围内，否则直接拦截。

const SCOPE_READ_TOOLS = new Set(['read_file', 'list_dir', 'tree']);

/**
 * 从工具参数中提取目标文件路径（用于作用域匹配）。
 * @param {string} name 工具名
 * @param {object} args 工具参数
 * @returns {string|null}
 */
function getScopeTargetPath(name, args) {
  if (!args) return null;
  switch (name) {
    case 'read_file':
      return args.path || args.filePath || null;
    case 'list_dir':
      return args.path || null;
    case 'tree':
      return args.path || null;
    default:
      return null;
  }
}

/**
 * 检查目标路径是否在给定的 scopeFiles 范围内。
 * scopeFiles 约定（来自 graph-planner）：
 *   - 目录以 / 结尾，如 "src/runtime/" → 匹配该目录下所有文件
 *   - 文件直接写完整路径，如 "src/foo.js" → 精确匹配
 *
 * @param {string} targetPath 目标文件/目录路径
 * @param {string[]} scopeFiles 当前子任务的作用域文件列表
 * @param {string} workingDir 工作区根目录
 * @returns {boolean}
 */
function isPathInScope(targetPath, scopeFiles, workingDir) {
  if (!targetPath || !scopeFiles || scopeFiles.length === 0) {
    return true; // 无约束时放行
  }

  // 规范化路径：去掉前导 /，解析 ..，确保使用正斜杠
  const resolve = (p) => {
    // 相对于工作区根目录解析
    const abs = path.resolve(workingDir, p);
    // 转为相对于工作区根目录的相对路径，使用正斜杠
    let rel = path.relative(workingDir, abs);
    if (!rel) return '';
    // 统一斜杠方向
    rel = rel.replace(/\\/g, '/');
    return rel;
  };

  const resolved = resolve(targetPath);

  for (const scope of scopeFiles) {
    let normalized = scope.trim().replace(/^\/+/, '');

    if (normalized.endsWith('/')) {
      // 目录作用域：目标必须在该目录下
      normalized = normalized.replace(/\/+$/, '');
      const scopeDir = resolve(normalized);
      if (resolved === scopeDir || resolved.startsWith(scopeDir + '/')) {
        return true;
      }
    } else {
      // 文件作用域：精确匹配
      const scopeFile = resolve(normalized);
      if (resolved === scopeFile) {
        return true;
      }
    }
  }

  return false;
}

export class ToolExecutor {
  #toolRegistry;
  #securityPolicy;
  #textToolParser;
  #ui;
  #config;
  #callHistory = new Set();
  #resultCache = new Map();
  #dirToolCache = new Map();
  #cacheLoaded = false;
  #events = [];
  #observerHooks = [];
  #eventEmitter;
  #contentStore;
  #fileAnalyzer;
  #snapshotStore;
  #hashlinePatcher;
  #lspManager;
  #editOrchestrator;

  constructor({
    toolRegistry,
    securityPolicy,
    textToolParser,
    ui,
    config,
    contentStore,
    fileAnalyzer,
    snapshotStore,
    hashlinePatcher,
    lspManager,
    editOrchestrator,
  }) {
    this.#toolRegistry = toolRegistry;
    this.#securityPolicy = securityPolicy || null;
    this.#textToolParser = textToolParser || new TextToolParser(toolRegistry);
    this.#ui = ui || {
      toolCall: () => {},
      toolResult: () => {},
      toolError: () => {},
      warn: () => {},
      debug: () => {},
    };
    this.#config = config || {};
    this.#contentStore = contentStore || null;
    this.#fileAnalyzer = fileAnalyzer || null;
    this.#snapshotStore = snapshotStore || null;
    this.#hashlinePatcher = hashlinePatcher || null;
    this.#lspManager = lspManager || null;
    this.#editOrchestrator = editOrchestrator || null;
  }

  // ============== 公共 API ==============

  /** 动态计算缓存路径 — 确保工作目录切换后使用新目录 */
  get #toolResultCachePath() {
    if (this.#config.toolResultCacheEnabled === false) {
      return null;
    }
    const workingDir = this.#config.workingDirectory || process.cwd();
    return `${workingDir}/.agent-data/tool-cache.jsonl`;
  }

  get events() {
    return this.#events.slice();
  }

  /** 订阅工具事件（返回取消函数） */
  onEvent(fn) {
    this.#observerHooks.push(fn);
    return () => {
      const idx = this.#observerHooks.indexOf(fn);
      if (idx >= 0) {
        this.#observerHooks.splice(idx, 1);
      }
    };
  }

  /** 重置调用历史与缓存（跨会话保留缓存文件，但内存清空） */
  reset() {
    this.#callHistory = new Set();
    this.#resultCache = new Map();
    this.#dirToolCache = new Map();
    this.#events = [];
    this.#cacheLoaded = false;
  }

  /**
   * 执行一次工具调用。
   * @param {object} toolCall — { id, name, arguments, source }
   * @param {object} context — 额外上下文对象（memoryManager, sessionManager, modelProvider, ...）
   * @param {object} options — { resultMode: 'tool' | 'observation', emitObservation: fn }
   */
  async execute(toolCall, context = {}, options = {}) {
    const normalized = this.#normalizeToolCall(toolCall);
    const rewritten = this.#rewriteShellRuntimeToolCall(normalized) || normalized;
    const { id, name, arguments: args } = rewritten;
    const resultMode = options.resultMode || 'tool';
    const startedAt = Date.now();
    const callSignature = `${name}:${JSON.stringify(args)}`;

    // ============ 去重：内存 + 持久化缓存（读工具使用文件 hash 智能跳过） ============
    await this.#loadResultCache();
    const isReadOnly = READ_ONLY_TOOLS.has(name);
    const isMutation = !isReadOnly;

    const persistentCacheHit = isMutation && this.#resultCache.has(callSignature);
    let inRunDuplicate = this.#callHistory.has(callSignature);

    let cacheHit = false;

    if (persistentCacheHit) {
      cacheHit = true;
    } else if (inRunDuplicate && isMutation) {
      cacheHit = true;
    } else if (isReadOnly) {
      const targetPath = getScopeTargetPath(name, args);
      if (targetPath && this.#snapshotStore) {
        const currentTag = this.#snapshotStore.head(targetPath);
        const cached = this.#resultCache.get(callSignature);

        if (cached && currentTag) {
          const cachedData = typeof cached === 'string' ? JSON.parse(cached) : cached;
          if (cachedData.fileTag === currentTag) {
            cacheHit = true;
          }
        } else if (currentTag && name === 'read_file' && (args.offset || args.limit)) {
          if (this.#snapshotStore && typeof this.#snapshotStore.byHash === 'function') {
            const snapshot = this.#snapshotStore.byHash(targetPath, currentTag);
            if (snapshot && (snapshot.content || snapshot.data?.text)) {
              cacheHit = true;
            }
          }
        }
      }

      const dirTools = ['list_dir', 'glob', 'tree'];
      if (dirTools.includes(name) && !cacheHit) {
        const dirCached = this.#dirToolCache.get(callSignature);
        if (dirCached && Date.now() - dirCached.timestamp < DIR_TOOL_CACHE_TTL_MS) {
          cacheHit = true;
        }
      }
    }

    if (cacheHit) {
      let cachedResult = null;
      const cachedEntry = this.#resultCache.get(callSignature);
      const dirCached = this.#dirToolCache.get(callSignature);

      if (cachedEntry) {
        cachedResult = typeof cachedEntry === 'string' ? cachedEntry : cachedEntry.result;
      } else if (name === 'read_file' && (args.offset || args.limit)) {
        const targetPath = getScopeTargetPath(name, args);
        const currentTag = this.#snapshotStore?.head(targetPath);
        if (currentTag && this.#snapshotStore?.byHash) {
          const snapshot = this.#snapshotStore.byHash(targetPath, currentTag);
          if (snapshot && (snapshot.content || snapshot.data?.text)) {
            const content = snapshot.content || snapshot.data.text;
            const lines = content.split('\n');
            const start = (args.offset || 1) - 1;
            const end = start + (args.limit || lines.length);
            const sliced = lines.slice(start, end);
            cachedResult = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
          }
        }
      } else if (['list_dir', 'glob', 'tree'].includes(name) && dirCached) {
        cachedResult = dirCached.result;
      }

      if (isReadOnly && cachedResult) {
        this.#ui.debug?.(`Read-only tool cache hit: ${name}`);
        const observation = `Cached result for ${name}:\n${cachedResult}\n\nUse this result; do not repeat the same call unless inputs changed.`;
        options.emitObservation?.(id, name, observation, resultMode);
        this.#recordEvent(name, args, true, cachedResult);
        return {
          name,
          result: cachedResult,
          cached: true,
          skipped: false,
        };
      }

      if (isMutation) {
        const cachedMutationResult = this.#resultCache.get(callSignature);
        const observation = cachedMutationResult
          ? `Duplicate mutation ${name} blocked. Previous result:\n${cachedMutationResult}`
          : `Duplicate mutation ${name} blocked. Use previous observation or change arguments.`;

        options.emitObservation?.(id, name, observation, resultMode);
        this.#recordEvent(name, args, !!cachedMutationResult, cachedMutationResult || observation);

        return {
          name,
          result: {
            duplicate: true,
            skipped: true,
            message: observation,
            previousResult: cachedMutationResult || null,
            suggestedNextAction: 'Use prior result or change arguments before retrying.',
          },
          skipped: true,
          duplicateMutation: true,
          cached: !!cachedMutationResult,
        };
      }
    }

    // ============ 基于工作区状态的智能预测（若提供） ============
    if (
      this.#config.workspaceState &&
      typeof this.#config.workspaceState.predictToolResult === 'function'
    ) {
      const prediction = this.#config.workspaceState.predictToolResult(name, args);
      if (prediction.canSkip) {
        this.#ui.warn?.(`⚠️  Skipping ${name}: ${prediction.reason}`);
        const observation = `Based on previous exploration:\n${prediction.reason}\n\nThis operation would fail. Consider a different approach or check workspace_knowledge first.`;
        options.emitObservation?.(id, name, observation, resultMode);
        this.#recordEvent(name, args, false, prediction.reason);
        return {
          name,
          result: prediction.predicted || { error: prediction.reason },
          skipped: true,
          predicted: true,
        };
      }
    }

    this.#ui.toolCall?.(name, args);

    const tool = this.#toolRegistry.get(name);
    if (!tool) {
      let msg;
      if (isPlanTaskPseudoTool(name)) {
        msg = `Invalid tool "${name}". This is a plan task label, not an executable tool. Use real tools such as list_dir, read_file, edit_file, write_file, shell, or verify.`;
      } else {
        msg = `Tool "${name}" is not registered.`;
      }
      options.emitObservation?.(id, name, msg, resultMode);
      this.#recordEvent(name, args, false, msg);
      this.#ui.toolError?.(name, msg);
      return { name, result: msg, error: msg };
    }

    // ============ 参数 schema 验证 ============
    let effectiveArgs = args || {};
    if (typeof this.#toolRegistry.validateAndCoerceArgs === 'function') {
      const v = this.#toolRegistry.validateAndCoerceArgs(name, args);
      if (!v.valid) {
        this.#ui.warn?.(`[Tool args] ${name}: ${(v.errors || []).join('; ')}`);
      }
      effectiveArgs = v.coercedArgs;
    }

    // ============ 必填参数检查（兜底，对没定义 schema 的工具） ============
    if (Array.isArray(tool.required) && tool.required.length > 0) {
      const missing = tool.required.filter((param) => {
        const value = effectiveArgs ? effectiveArgs[param] : undefined;
        return value === undefined || value === null || value === '';
      });
      if (missing.length > 0) {
        const msg = `Missing required parameter(s): ${missing.join(', ')}. The "${name}" tool requires: ${tool.required.join(', ')}.`;
        options.emitObservation?.(id, name, msg, resultMode);
        this.#recordEvent(name, args, false, msg);
        this.#ui.warn?.(msg);
        return { name, result: msg, error: msg };
      }
    }

    // ============ 安全策略评估 ============
    const securityBlock = this.#enforceSecurity(name, effectiveArgs);
    if (securityBlock) {
      options.emitObservation?.(
        id,
        name,
        `Error: Security policy blocked ${name}: ${securityBlock}`,
        resultMode,
      );
      this.#recordEvent(name, args, false, `Security policy blocked tool call: ${securityBlock}`);
      this.#ui.toolError?.(name, securityBlock);
      return {
        name,
        result: `Error: Security policy blocked ${name}: ${securityBlock}`,
        error: securityBlock,
      };
    }

    // ============ write_file 审批（若配置了 writeFileApproval） ============
    if (name === 'write_file' && typeof this.#config.writeFileApproval === 'function') {
      const approved = await this.#config.writeFileApproval({
        args: effectiveArgs,
        workingDirectory: this.#config.workingDirectory || process.cwd(),
      });
      if (approved === false) {
        const reason = 'write_file: 人工审批未通过，跳过本次写入';
        options.emitObservation?.(id, name, reason, resultMode);
        this.#recordEvent(name, effectiveArgs, false, reason);
        return { name, result: reason, skipped: true };
      }
      if (approved && typeof approved === 'object' && typeof approved.content === 'string') {
        effectiveArgs = { ...(effectiveArgs || {}), content: approved.content };
      }
    }

    // ============ 文件作用域强制（工程级：硬拦截越界读取） ============
    if (SCOPE_READ_TOOLS.has(name) && context.scopeFiles && context.scopeFiles.length > 0) {
      const targetPath = getScopeTargetPath(name, effectiveArgs);
      if (
        targetPath &&
        !isPathInScope(
          targetPath,
          context.scopeFiles,
          this.#config.workingDirectory || process.cwd(),
        )
      ) {
        const scopeList = context.scopeFiles.join(', ');
        const blockedMsg =
          `SCOPE_BLOCKED: "${targetPath}" 不在当前子任务的作用域内 [${scopeList}]。\n` +
          `当前执行计划已限定文件范围，如需访问此文件，请完成当前子任务后推进到下一阶段。`;
        options.emitObservation?.(id, name, blockedMsg, resultMode);
        this.#recordEvent(name, effectiveArgs, false, blockedMsg);
        this.#ui.warn?.(`Scope blocked: ${name} → ${targetPath}`);
        return { name, result: blockedMsg, skipped: true, scopeBlocked: true };
      }
    }

    // ============ 执行工具 ============
    const executionContext = {
      workingDirectory: this.#config.workingDirectory || process.cwd(),
      memoryManager: context.memoryManager,
      sessionManager: context.sessionManager,
      modelProvider: context.modelProvider,
      debug: context.debug || false,
      ui: this.#ui,
      toolName: name,
      subAgent: context.subAgent,
      contentStore: this.#contentStore,
      fileAnalyzer: this.#fileAnalyzer,
      snapshotStore: this.#snapshotStore,
      hashlinePatcher: this.#hashlinePatcher,
      lspManager: this.#lspManager,
      editOrchestrator: this.#editOrchestrator,
      toolEventsSnapshot: this.#events.map((e) => ({ ...e })),
    };

    // ============ 文件存在性检查（read_file 前的防御） ============
    if (name === 'read_file') {
      const targetPath = getScopeTargetPath(name, effectiveArgs);
      if (targetPath) {
        const absPath = path.resolve(executionContext.workingDirectory, targetPath);
        const fileExists = existsSync(absPath);
        
        if (!fileExists) {
          const parentDir = path.dirname(targetPath);
          const parentAbs = path.resolve(executionContext.workingDirectory, parentDir);
          
          let fallbackDir = parentDir;
          let fallbackAbs = parentAbs;
          
          // 如果父目录也不存在，回退到工作区根目录
          if (!existsSync(parentAbs)) {
            fallbackDir = '.';
            fallbackAbs = executionContext.workingDirectory;
          }
          
          if (existsSync(fallbackAbs)) {
            const dirTool = this.#toolRegistry.get('list_dir');
            if (dirTool) {
              try {
                const dirResult = await dirTool.handler({ path: fallbackDir }, executionContext);
                const fallbackDesc = fallbackDir === '.' ? 'workspace root' : `"${fallbackDir}"`;
                const observation = `File not found: "${targetPath}". Here's the directory listing for ${fallbackDesc}:\n${dirResult}\n\nPlease check the correct file path.`;
                options.emitObservation?.(id, name, observation, resultMode);
                this.#recordEvent('list_dir', { path: fallbackDir }, true, dirResult);
                this.#ui.toolResult?.('list_dir', dirResult, { path: fallbackDir });
                return { 
                  name, 
                  result: `Error: File not found: ${targetPath}\n\nDirectory listing for ${fallbackDesc}:\n${dirResult}`, 
                  skipped: true,
                  fallbackToDir: true 
                };
              } catch (e) {
                // 目录列表也失败，继续执行原始 read_file 返回错误
              }
            }
          }
        }
      }
    }

    let finalResult;
    try {
      const rawResult = await withTimeout(
        () => tool.handler(effectiveArgs, executionContext),
        60000,
        `Tool ${name}`,
      );
      finalResult = this.#applySecurityResultPolicy(name, rawResult);
      this.#recordEvent(name, effectiveArgs, true, finalResult);

      if (MUTATION_TOOLS.has(name)) {
        this.#invalidateReadOnlyHistory();
      }

      // 仅成功执行的调用才加入历史，避免失败后无法重试
      this.#callHistory.add(callSignature);
      if (this.#callHistory.size > 50) {
        const oldest = this.#callHistory.values().next().value;
        this.#callHistory.delete(oldest);
      }
      // 写工具写持久化缓存，读工具写内存缓存（通过 snapshotStore.head 比对文件 hash）
      if (!isReadOnly) {
        const cachedValue =
          typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);
        this.#resultCache.set(callSignature, cachedValue);
        this.#flushCacheEntry(callSignature, cachedValue);

        // 写文件后预填充读缓存，避免立即重复读取
        const writeTools = [
          'write_file',
          'write_file_with_hashline',
          'edit_file',
          'update_file',
          'rename_file',
        ];
        if (writeTools.includes(name)) {
          const targetPath = getScopeTargetPath(name, effectiveArgs);
          if (targetPath && this.#snapshotStore) {
            const fileTag = this.#snapshotStore.head(targetPath);
            if (fileTag) {
              // 尝试从参数中获取内容（如果可用）
              let content = effectiveArgs.content || effectiveArgs.text;

              // 如果参数中没有内容，从磁盘读取
              if (!content) {
                try {
                  content = await readFile(targetPath, 'utf-8');
                } catch (e) {
                  // 文件可能还未创建或无法读取
                }
              }

              if (content) {
                // 预填充带行号的结果缓存（模拟 read_file 的输出格式）
                const lines = content.split('\n');
                const numberedResult = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
                const readSignature = `read_file:${JSON.stringify({ path: effectiveArgs.path || effectiveArgs.file })}`;
                this.#resultCache.set(readSignature, { result: numberedResult, fileTag });
              }
            }
          }
        }
      } else {
        // 读工具：存储结果和当前文件 tag 到内存缓存，供后续 hash 比对
        const targetPath = getScopeTargetPath(name, effectiveArgs);
        const fileTag =
          targetPath && this.#snapshotStore ? this.#snapshotStore.head(targetPath) : null;
        this.#resultCache.set(callSignature, { result: finalResult, fileTag });

        // 目录类工具：存储到 TTL 缓存
        const dirTools = ['list_dir', 'glob', 'tree'];
        if (dirTools.includes(name)) {
          this.#dirToolCache.set(callSignature, {
            result: finalResult,
            timestamp: Date.now(),
          });

          // 限制目录工具缓存大小
          if (this.#dirToolCache.size > 50) {
            const oldestKey = this.#dirToolCache.keys().next().value;
            this.#dirToolCache.delete(oldestKey);
          }
        }
      }
      this.#ui.toolResult?.(name, finalResult, effectiveArgs);
      options.emitObservation?.(id, name, finalResult, resultMode);
      return { name, result: finalResult, durationMs: Date.now() - startedAt };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#recordEvent(name, effectiveArgs, false, `Error: ${errorMsg}`);
      this.#ui.toolError?.(name, errorMsg, effectiveArgs);
      options.emitObservation?.(id, name, `Error: ${errorMsg}`, resultMode);
      return { name, result: `Error: ${errorMsg}`, error: errorMsg };
    }
  }

  // ============== 内部：安全策略 ==============

  #enforceSecurity(name, args) {
    const policy = this.#securityPolicy;
    if (!policy) {
      return null;
    }
    if (typeof policy.evaluate === 'function') {
      const decision = policy.evaluate(name, args, {});
      if (decision.decision === Decision.DENY) {
        return decision.suggestedMessage || decision.detail || 'denied';
      }
      if (decision.decision === Decision.REQUIRE_APPROVAL) {
        return decision.suggestedMessage || 'approval required';
      }
      if (decision.decision === Decision.RATE_LIMITED) {
        return decision.suggestedMessage || 'rate limited';
      }
      return null;
    }
    // 向后兼容：旧 API
    if (typeof policy.requiresApproval === 'function' && policy.requiresApproval(name)) {
      return 'approval_required';
    }
    if (typeof policy.validateToolCall === 'function') {
      const r = policy.validateToolCall(name, args);
      if (r === false) {
        return 'denied';
      }
      if (r && r.allowed === false) {
        return r.reason || 'denied';
      }
    }
    return null;
  }

  #applySecurityResultPolicy(name, result) {
    const policy = this.#securityPolicy;
    if (policy && typeof policy.truncateResult === 'function') {
      return policy.truncateResult(name, result);
    }
    return result;
  }

  // ============== 内部：缓存与历史 ==============

  async #loadResultCache() {
    if (this.#cacheLoaded) {
      return;
    }
    this.#cacheLoaded = true;
    if (!this.#toolResultCachePath) {
      return;
    }
    try {
      if (!existsSync(this.#toolResultCachePath)) {
        return;
      }
      const content = await readFile(this.#toolResultCachePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const now = Date.now();
      for (const line of lines.slice(-TOOL_RESULT_CACHE_MAX)) {
        try {
          const { signature, result, createdAt } = JSON.parse(line);
          if (signature && typeof result === 'string') {
            // 超过 TTL 的条目忽略
            if (!createdAt || now - createdAt < TOOL_RESULT_CACHE_TTL_MS) {
              this.#resultCache.set(signature, result);
            }
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  async #flushCacheEntry(signature, result) {
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
      await appendFile(
        this.#toolResultCachePath,
        JSON.stringify({ signature, result, createdAt: Date.now() }) + '\n',
        'utf8',
      );
    } catch {
      /* ignore */
    }
  }

  #invalidateReadOnlyHistory() {
    for (const sig of [...this.#callHistory]) {
      const toolName = sig.split(':', 1)[0];
      if (READ_ONLY_TOOLS.has(toolName)) {
        this.#callHistory.delete(sig);
      }
    }
    for (const sig of [...this.#resultCache.keys()]) {
      const toolName = sig.split(':', 1)[0];
      if (READ_ONLY_TOOLS.has(toolName)) {
        this.#resultCache.delete(sig);
      }
    }
    this.#dirToolCache.clear();
  }

  #recordEvent(name, args, success, result) {
    const preview =
      typeof result === 'string'
        ? result.substring(0, 300)
        : JSON.stringify(result ?? '').substring(0, 300);
    const event = { name, args, success, resultPreview: preview };
    this.#events.push(event);
    for (const fn of this.#observerHooks) {
      try {
        fn(event);
      } catch {
        /* ignore */
      }
    }
  }

  // ============== 内部：规范化与重写 ==============

  #normalizeToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') {
      return toolCall;
    }
    if (toolCall.name) {
      return { ...toolCall, arguments: this.#parseArgs(toolCall.arguments) };
    }
    if (toolCall.function?.name) {
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: this.#parseArgs(toolCall.function.arguments),
        source: toolCall.type || 'native_tool_call',
        raw: toolCall,
      };
    }
    return toolCall;
  }

  #parseArgs(args) {
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
      .filter((c) => c.name !== 'shell');
    if (parsed.length === 0) {
      return null;
    }
    const replacement = parsed[0];
    return { ...replacement, id: toolCall.id, source: 'shell_runtime_tool_redirect' };
  }
}

export default ToolExecutor;
