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
import { TextToolParser } from '../../parsing/text-tool-parser.js';
import { Decision } from './support/security-policy.js';
import { ObservationErrorCode } from './support/observation-state.js';
import { normalizeToolResult } from './tool-result.js';

const TOOL_RESULT_CACHE_MAX = 500;
const TOOL_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DIR_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;
const NON_CACHEABLE_TOOLS = new Set([
  'ask_user',
  'request_user_input',
  'shell',
  'verify',
  'review',
  'preview',
  'lsp_diagnostics',
  'git_commit',
]);
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
  'apply_hashline_patch',
]);

function hasRangeArg(args) {
  return (
    (args && Object.prototype.hasOwnProperty.call(args, 'offset')) ||
    Object.prototype.hasOwnProperty.call(args || {}, 'limit')
  );
}

function getSnapshotText(snapshot) {
  if (!snapshot) {
    return null;
  }
  if (typeof snapshot.content === 'string') {
    return snapshot.content;
  }
  if (typeof snapshot.data?.text === 'string') {
    return snapshot.data.text;
  }
  return null;
}

function formatPathAlternatives(alternatives) {
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return '';
  }
  return alternatives
    .slice(0, 8)
    .map((item) => {
      if (typeof item === 'string') {
        return `- ${item}`;
      }
      return `- ${item.path}${item.reason ? ` (${item.reason})` : ''}`;
    })
    .join('\n');
}

function buildMissingReadObservation({
  targetPath,
  reason,
  alternatives,
  directoryListing,
  correction,
}) {
  const candidateText = formatPathAlternatives(alternatives);
  const listingText = directoryListing ? `\n\nDirectory evidence:\n${directoryListing}` : '';
  const candidateBlock = candidateText
    ? `\n\nKnown existing path candidates from prior list_dir/read observations:\n${candidateText}`
    : '';
  const correctionText =
    correction ||
    `\n\nCorrection: do not retry "${targetPath}". Pick one of the existing paths above, run list_dir on the relevant parent directory, or use write_file if this is a new file you need to create.`;
  return (
    `Error: File not found: "${targetPath}".\n` +
    `${reason || 'The requested path is not known to exist.'}` +
    candidateBlock +
    listingText +
    correctionText
  );
}

function isPlanTaskPseudoTool(name) {
  return /^task_\d+$/i.test(String(name || ''));
}

// ==== 文件作用域强制：工程级约束，不依赖 prompt ====
// 当执行计划提供了当前子任务的 scopeFiles 时，
// 以下工具的目标路径必须在 scopeFiles 范围内，否则直接拦截。

const SCOPE_READ_TOOLS = new Set(['read_file', 'list_dir', 'tree']);
const SCOPE_WRITE_TOOLS = new Set([
  'write_file',
  'write_file_with_hashline',
  'edit_file',
  'update_file',
  'delete_file',
  'move_file',
  'rename_file',
  'apply_hashline_patch',
  'hashline_apply',
]);
const PLAN_CONTROL_TOOLS = new Set(['change_plan']);

/**
 * 从工具参数中提取目标文件路径（用于作用域匹配）。
 * @param {string} name 工具名
 * @param {object} args 工具参数
 * @returns {string|null}
 */
function getScopeTargetPath(name, args) {
  if (!args) {
    return null;
  }
  switch (name) {
    case 'read_file':
      return args.path || args.file_path || args.file || args.filePath || null;
    case 'write_file':
    case 'write_file_with_hashline':
    case 'edit_file':
    case 'update_file':
    case 'delete_file':
    case 'move_file':
    case 'rename_file':
      return args.path || args.file_path || args.file || args.filePath || null;
    case 'list_dir':
      return args.path || null;
    case 'tree':
      return args.path || null;
    case 'apply_hashline_patch': {
      const patch = typeof args.patch === 'string' ? args.patch : '';
      const match = patch.match(/^\[([^#\]\r\n]+)#[^\]\r\n]+\]/m);
      return match?.[1]?.trim() || null;
    }
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
    if (!rel) {
      return '';
    }
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

function normalizeToolNameSet(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Set) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Set(value);
  }
  return null;
}

export function normalizeToolArgumentAliases(name, args = {}) {
  if (!args || typeof args !== 'object') {
    return {};
  }

  const normalized = { ...args };

  if (['read_file', 'write_file', 'edit_file', 'list_dir'].includes(name) && !normalized.path) {
    normalized.path = normalized.file_path || normalized.file || normalized.filename;
  }

  if (name === 'write_file' && normalized.content === undefined) {
    normalized.content =
      normalized.new_content ??
      normalized.newContent ??
      normalized.text ??
      normalized.contents ??
      normalized.data;
  }

  if (name === 'edit_file') {
    if (normalized.old_str === undefined) {
      normalized.old_str = normalized.old_text ?? normalized.oldContent ?? normalized.old;
    }
    if (normalized.new_str === undefined) {
      normalized.new_str =
        normalized.new_text ?? normalized.new_content ?? normalized.newContent ?? normalized.new;
    }
    // Support old_string/new_string (claude-code/Aider convention) as well
    if (normalized.old_string !== undefined && normalized.old_text === undefined) {
      normalized.old_text = normalized.old_string;
    }
    if (normalized.new_string !== undefined && normalized.new_text === undefined) {
      normalized.new_text = normalized.new_string;
    }
    if (normalized.new_text === undefined && normalized.new_str !== undefined) {
      normalized.new_text = normalized.new_str;
    }
    if (normalized.old_text === undefined && normalized.old_str !== undefined) {
      normalized.old_text = normalized.old_str;
    }
  }

  if (name === 'project_profile' && normalized.task === undefined) {
    const taskParts = [
      normalized.issue,
      normalized.problem,
      normalized.finding,
      normalized.solution,
      normalized.goal,
      normalized.request,
      normalized.description,
    ].filter((part) => typeof part === 'string' && part.trim());
    if (taskParts.length > 0) {
      normalized.task = taskParts.join('\n');
    }
  }

  return normalized;
}

function normalizeVirtualWorkspaceAbsolutePath(value, workingDirectory) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed)) {
    return value;
  }

  const root = path.resolve(workingDirectory || process.cwd());
  const resolved = path.resolve(trimmed);
  const relativeToRoot = path.relative(root, resolved);
  if (relativeToRoot && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
    return relativeToRoot;
  }
  if (resolved === root) {
    return '.';
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const match = normalized.match(/^\/workspace\/[^/]+\/(.+)$/);
  if (match?.[1]) {
    return match[1];
  }
  return value;
}

function normalizeWorkspacePathArgs(name, args = {}, workingDirectory) {
  if (!args || typeof args !== 'object') {
    return args;
  }
  const pathKeys = [];
  if (['read_file', 'write_file', 'edit_file', 'list_dir', 'tree', 'stat_file'].includes(name)) {
    pathKeys.push('path', 'file_path', 'file', 'filename', 'filePath');
  }
  if (pathKeys.length === 0) {
    return args;
  }
  let changed = false;
  const next = { ...args };
  for (const key of pathKeys) {
    if (typeof next[key] !== 'string') {
      continue;
    }
    const normalized = normalizeVirtualWorkspaceAbsolutePath(next[key], workingDirectory);
    if (normalized !== next[key]) {
      next[key] = normalized;
      changed = true;
    }
  }
  return changed ? normalizeToolArgumentAliases(name, next) : args;
}

function getAllowedToolSet(context = {}) {
  const taskAllowed = context.currentTask?.allowedTools;
  if (Array.isArray(taskAllowed) && taskAllowed.length > 0) {
    const baseTools = new Set([
      ...READ_ONLY_TOOLS,
      ...taskAllowed,
      ...PLAN_CONTROL_TOOLS,
    ]);
    return baseTools;
  }
  return null;
}

function isCreateOrImplementationTask(task, activePlan) {
  const text = String(
    `${task?.id || ''} ${task?.name || ''} ${task?.description || ''}`,
  ).toLowerCase();
  return Boolean(
    activePlan?.context?.createFromScratch ||
    task?.phase === 'implementation' ||
    /\b(create|new|setup|implement|write|skeleton|scaffold|from scratch)\b|创建|新建|搭建|实现|工程化/.test(
      text,
    ),
  );
}

// 从错误结果中提取失败指纹的关键部分
function extractFailureFingerprint(name, args, result) {
  const resultStr = String(result ?? '');
  // 提取第一个有意义的错误行（跳过前缀的 "Error:" 等通用前缀）
  const errorLines = resultStr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let keyErrorLine = '';
  let firstStackFrame = '';

  for (const line of errorLines) {
    // 找第一个堆栈帧
    if (/^\s*at\s+/.test(line) && !firstStackFrame) {
      firstStackFrame = line.replace(/\s+/g, ' ').trim();
      break;
    }
    // 找包含错误类型的行
    if (
      /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError|Error|Exception|FAIL|failed)\b/i.test(
        line,
      ) &&
      line.length < 300
    ) {
      if (!keyErrorLine) {
        keyErrorLine = line;
      }
    }
  }

  // 如果没找到具体错误行，用前 200 个字符
  if (!keyErrorLine) {
    keyErrorLine = resultStr.substring(0, 200);
  }

  // 指纹：工具名 + 关键错误行 + 第一个堆栈帧
  const fingerprintBase = `${name}:${keyErrorLine}:${firstStackFrame}`;
  // 简单 hash（截断 + 去空格）
  return fingerprintBase.replace(/\s+/g, ' ').trim().substring(0, 300);
}

function shouldBlockContradictingRead(name, args, context = {}) {
  if (name !== 'read_file') {
    return null;
  }
  const workspaceState = context.workspaceState;
  if (!workspaceState || typeof workspaceState.isWorkspaceEmpty !== 'function') {
    return null;
  }
  if (workspaceState.isWorkspaceEmpty() !== true) {
    return null;
  }
  if (!isCreateOrImplementationTask(context.currentTask, context.activePlan)) {
    return null;
  }
  const targetPath = getScopeTargetPath(name, args);
  if (!targetPath) {
    return null;
  }
  return null;
}

function hasObservedWorkspaceRoot(events = []) {
  return events.some((event) => {
    if (!event || event.success === false) {
      return false;
    }
    if (event.name === 'workspace_knowledge') {
      return true;
    }
    if (!['list_dir', 'tree', 'glob'].includes(event.name)) {
      return false;
    }
    const targetPath = getScopeTargetPath(event.name, event.args || event.arguments || {});
    return !targetPath || targetPath === '.' || targetPath === './' || targetPath === '';
  });
}

function shouldRequireWorkspaceObservationBeforeMutation(name, _args, context = {}) {
  if (!MUTATION_TOOLS.has(name)) {
    return null;
  }
  if (!isCreateOrImplementationTask(context.currentTask, context.activePlan)) {
    return null;
  }

  const workspaceState = context.workspaceState;
  if (workspaceState && typeof workspaceState.isWorkspaceEmpty === 'function') {
    if (workspaceState.isWorkspaceEmpty() === true) {
      return null;
    }
  }

  if (hasObservedWorkspaceRoot(context.toolEventsSnapshot || [])) {
    return null;
  }

  return (
    `WORKSPACE_CONTEXT_REQUIRED: Before ${name} in a create/implementation task, ` +
    `inspect the real workspace root with list_dir({"path":"."}). ` +
    `This prevents overwriting or ignoring an existing project layout.`
  );
}

/**
 * 在 mutation 前检查 profile_project 任务是否已完成。
 * 如果 plan 中包含 profile_project 任务但尚未完成，阻止 mutation。
 * 这样确保 Agent 在写代码前先理解项目配置。
 */
function shouldRequireProjectProfileBeforeMutation(name, _args, context = {}) {
  if (!MUTATION_TOOLS.has(name)) {
    return null;
  }
  if (!context.activePlanManager) {
    return null;
  }
  const plan = context.activePlanManager.activePlan;
  if (!plan) {
    return null;
  }
  const profileTask = plan.getTask('profile_project');
  if (!profileTask) {
    return null;
  }
  if (profileTask.status === 'completed' || profileTask.status === 'skipped') {
    return null;
  }
  if (plan.context?.createFromScratch) {
    return null;
  }
  return (
    `PROFILE_PROJECT_REQUIRED: Before ${name}, you must complete the "Profile existing project" step. ` +
    `Call project_profile({"task": "..."}) once to scan config files, scripts, and test modules. ` +
    `This gives you all the project context you need in a single call.`
  );
}

function isWorkspaceRootObservation(name, args, context = {}) {
  if (name !== 'list_dir') {
    return false;
  }
  if (!isCreateOrImplementationTask(context.currentTask, context.activePlan)) {
    return false;
  }
  const targetPath = getScopeTargetPath(name, args);
  return !targetPath || targetPath === '.' || targetPath === './' || targetPath === '';
}

function isRootProjectContextPath(targetPath) {
  if (!targetPath) {
    return false;
  }
  const normalized = targetPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized || normalized.includes('/')) {
    return false;
  }
  return (
    /^(package|bun|pnpm-lock|yarn\.lock|package-lock)\.json$/i.test(normalized) ||
    /^readme(\.[\w-]+)?$/i.test(normalized) ||
    /^(vite|webpack|rollup|tsconfig|jsconfig|eslint|prettier|tailwind|postcss|next|nuxt|svelte|astro|vitest|jest|playwright|cypress|babel|biome|turbo)\.config\.[cm]?[jt]s$/i.test(
      normalized,
    ) ||
    /^(tsconfig|jsconfig|composer|pyproject|cargo|go\.mod|requirements|gemfile|makefile|dockerfile)(\..*)?$/i.test(
      normalized,
    )
  );
}

function isWorkspaceContextRead(name, args, context = {}) {
  if (name !== 'read_file') {
    return false;
  }
  if (!isCreateOrImplementationTask(context.currentTask, context.activePlan)) {
    return false;
  }
  if (!hasObservedWorkspaceRoot(context.toolEventsSnapshot || [])) {
    return false;
  }
  return isRootProjectContextPath(getScopeTargetPath(name, args));
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
  #fileFreshnessCache = new Map();
  #failureFingerprints = new Map();

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
    this.#fileFreshnessCache = new Map();
    this.#failureFingerprints = new Map();
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
    const normalizedArgsCall = {
      ...normalized,
      arguments: normalizeToolArgumentAliases(normalized?.name, normalized?.arguments),
    };
    const rewritten = this.#rewriteShellRuntimeToolCall(normalizedArgsCall) || normalizedArgsCall;
    const { id, name, arguments: args } = rewritten;
    const resultMode = options.resultMode || 'tool';
    const startedAt = Date.now();
    const callSignature = `${name}:${JSON.stringify(args)}`;

    const allowedToolNames = getAllowedToolSet({
      ...context,
      toolRegistry: context.toolRegistry || this.#toolRegistry,
    });
    if (allowedToolNames && !allowedToolNames.has(name)) {
      const availableToolNames = Array.from(allowedToolNames).join(', ') || '(none)';
      const msg = `Tool "${name}" is not recommended for the current plan task/phase. Suggested tools: ${availableToolNames}. Proceeding anyway.`;
      options.emitObservation?.(id, name, msg, resultMode);
      this.#recordEvent(name, args, false, msg);
      this.#ui.toolWarning?.(name, msg);
    }

    // ============ 去重：内存 + 持久化缓存（读工具使用文件 hash 智能跳过） ============
    const canUseCache = !NON_CACHEABLE_TOOLS.has(name);
    if (canUseCache) {
      await this.#loadResultCache();
    }
    const isReadOnly = READ_ONLY_TOOLS.has(name);
    const isMutation = !isReadOnly;

    const persistentCacheHit = canUseCache && isMutation && this.#resultCache.has(callSignature);
    let inRunDuplicate = canUseCache && this.#callHistory.has(callSignature);

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
        } else if (currentTag && name === 'read_file' && hasRangeArg(args)) {
          if (this.#snapshotStore && typeof this.#snapshotStore.byHash === 'function') {
            const snapshot = this.#snapshotStore.byHash(targetPath, currentTag);
            if (getSnapshotText(snapshot) !== null) {
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
      } else if (name === 'read_file' && hasRangeArg(args)) {
        const targetPath = getScopeTargetPath(name, args);
        const currentTag = this.#snapshotStore?.head(targetPath);
        if (currentTag && this.#snapshotStore?.byHash) {
          const snapshot = this.#snapshotStore.byHash(targetPath, currentTag);
          const content = getSnapshotText(snapshot);
          if (content !== null) {
            const lines = content.split('\n');
            const start = (args.offset ?? 1) - 1;
            const end = start + (args.limit ?? lines.length);
            const sliced = lines.slice(start, end);
            cachedResult = sliced.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
          }
        }
      } else if (['list_dir', 'glob', 'tree'].includes(name) && dirCached) {
        cachedResult = dirCached.result;
      }

      if (isReadOnly && cachedResult !== null && cachedResult !== undefined) {
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
        const hasCachedMutationResult = this.#resultCache.has(callSignature);
        const cachedMutationResult = this.#resultCache.get(callSignature);
        const observation = hasCachedMutationResult
          ? `Duplicate mutation ${name} skipped. Previous result:\n${cachedMutationResult}`
          : `Duplicate mutation ${name} skipped. Use previous observation or change arguments.`;

        options.emitObservation?.(id, name, observation, resultMode);
        this.#recordEvent(
          name,
          args,
          hasCachedMutationResult,
          hasCachedMutationResult ? cachedMutationResult : observation,
        );

        return {
          name,
          result: {
            duplicate: true,
            skipped: true,
            message: observation,
            previousResult: hasCachedMutationResult ? cachedMutationResult : null,
            suggestedNextAction: 'Use prior result or change arguments before retrying.',
          },
          skipped: true,
          duplicateMutation: true,
          cached: hasCachedMutationResult,
        };
      }
    }

    // ============ 重复失败检测：相同失败指纹 + 工作区未改变时阻止重试 ============
    const failureFingerprint = `${name}:${JSON.stringify(args)}`;
    const prevFailure = this.#failureFingerprints.get(failureFingerprint);
    if (prevFailure && prevFailure.count >= 2) {
      const blockedMsg =
        `REPEATED_FAILURE_BLOCKED: "${name}" has failed with the same error pattern ${prevFailure.count} times without any workspace mutation.\n` +
        `Last error:\n${prevFailure.lastError}\n\n` +
        `Do not repeat this exact call. Instead:\n` +
        `1. Gather more diagnostic information first (read relevant files, check config)\n` +
        `2. Change the command/arguments meaningfully\n` +
        `3. Make a code change that could fix the underlying cause\n` +
        `4. Use a different approach or tool`;
      options.emitObservation?.(id, name, blockedMsg, resultMode);
      this.#recordEvent(name, args, false, blockedMsg);
      this.#ui.warn?.(`Repeated failure blocked: ${name}`);
      return {
        name,
        result: blockedMsg,
        args,
        error: `Repeated failure blocked after ${prevFailure.count} attempts`,
        skipped: true,
        repeatedFailure: true,
        errorCode: ObservationErrorCode.REPEATED_FAILURE,
      };
    }

    // ============ 基于工作区状态的智能预测（若提供） ============
    const workspaceState = context.workspaceState || this.#config.workspaceState;
    if (workspaceState && typeof workspaceState.predictToolResult === 'function') {
      const prediction = workspaceState.predictToolResult(name, args);
      if (prediction.canSkip) {
        // Skip predictions are normal observations (already sent to LLM via
        // emitObservation below). Log at debug level — NOT warn/error — to
        // avoid polluting the error log with expected behavior.
        this.#ui.debug?.(`Skipping ${name}: ${prediction.reason}`);
        const predictedSuccess = prediction.type !== 'will_fail';
        const observation = predictedSuccess
          ? `Based on previous workspace observations:\n${prediction.reason}\n\nSkipping redundant operation; use the observed fact and continue.`
          : name === 'read_file'
            ? buildMissingReadObservation({
                targetPath: args?.path || args?.file_path || args?.file || '(unknown)',
                reason: prediction.reason,
                alternatives: prediction.predicted?.alternatives,
              })
            : `Based on previous exploration:\n${prediction.reason}\n\nThis operation would fail. Consider a different approach or check workspace_knowledge first.`;
        options.emitObservation?.(id, name, observation, resultMode);
        this.#recordEvent(name, args, predictedSuccess, observation);
        return {
          name,
          result: predictedSuccess ? prediction.predicted || prediction.reason : observation,
          args,
          skipped: true,
          predicted: true,
          success: predictedSuccess,
          ...(predictedSuccess ? { cached: true } : { error: prediction.reason }),
        };
      }
    }

    const factBlocked = shouldBlockContradictingRead(name, args, {
      ...context,
      workspaceState: context.workspaceState || this.#config.workspaceState,
      workingDirectory: this.#config.workingDirectory || process.cwd(),
    });
    if (factBlocked) {
      options.emitObservation?.(id, name, factBlocked, resultMode);
      this.#recordEvent(name, args, false, factBlocked);
      this.#ui.warn?.(`Fact blocked: ${name}`);
      return {
        name,
        result: factBlocked,
        args,
        error: factBlocked,
        skipped: true,
        factBlocked: true,
        errorCode: ObservationErrorCode.FACT_CONTRADICTION,
      };
    }

    const workspaceObservationRequired = shouldRequireWorkspaceObservationBeforeMutation(
      name,
      args,
      {
        ...context,
        workspaceState: context.workspaceState || this.#config.workspaceState,
        toolEventsSnapshot: this.#events,
      },
    );
    if (workspaceObservationRequired) {
      options.emitObservation?.(id, name, workspaceObservationRequired, resultMode);
      this.#recordEvent(name, args, false, workspaceObservationRequired);
      this.#ui.warn?.(`Workspace context required before ${name}`);
      return {
        name,
        result: workspaceObservationRequired,
        args,
        error: workspaceObservationRequired,
        skipped: true,
        workspaceContextRequired: true,
      };
    }

    // profile_project 完成检查：如果 plan 中包含 profile_project 尚未完成，阻止 mutation
    const profileProjectRequired = shouldRequireProjectProfileBeforeMutation(name, args, {
      ...context,
      activePlanManager: context.activePlanManager,
    });
    if (profileProjectRequired) {
      options.emitObservation?.(id, name, profileProjectRequired, resultMode);
      this.#recordEvent(name, args, false, profileProjectRequired);
      this.#ui.warn?.(`Project profile required before ${name}`);
      return {
        name,
        result: profileProjectRequired,
        args,
        error: profileProjectRequired,
        skipped: true,
        profileProjectRequired: true,
      };
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
        this.#recordEvent(name, args, false, errorMsg);
        return {
          name,
          result: errorMsg,
          error: errorMsg,
          errorCode: ObservationErrorCode.SCHEMA_VALIDATION_FAILED,
        };
      }
      effectiveArgs = v.coercedArgs;
    }

    effectiveArgs = normalizeWorkspacePathArgs(
      name,
      effectiveArgs,
      this.#config.workingDirectory || process.cwd(),
    );

    // ============ 必填参数检查（兜底，对没定义 schema 的工具） ============
    if (Array.isArray(tool.required) && tool.required.length > 0) {
      const missing = tool.required.filter((param) => {
        const value = effectiveArgs ? effectiveArgs[param] : undefined;
        // Respect allowEmpty: if the param definition allows empty strings,
        // only treat undefined/null as missing (not ''). This supports delete
        // operations where new_text="" is a valid intentional value.
        const paramDef = tool.params?.[param] || tool.parameters?.properties?.[param];
        const allowEmpty = paramDef?.allowEmpty === true;
        if (allowEmpty) {
          return value === undefined || value === null;
        }
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

    const writeBeforeReadResult = this.#checkWriteBeforeRead(name, effectiveArgs, context);
    if (writeBeforeReadResult) {
      options.emitObservation?.(id, name, writeBeforeReadResult.result, resultMode);
      this.#recordEvent(name, effectiveArgs, false, writeBeforeReadResult.result);
      return writeBeforeReadResult;
    }

    const unsafeOverwriteResult = this.#checkUnsafeFullFileOverwrite(name, effectiveArgs, context);
    if (unsafeOverwriteResult) {
      options.emitObservation?.(id, name, unsafeOverwriteResult.result, resultMode);
      this.#recordEvent(name, effectiveArgs, false, unsafeOverwriteResult.result);
      return unsafeOverwriteResult;
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
        !isWorkspaceRootObservation(name, effectiveArgs, context) &&
        !isWorkspaceContextRead(name, effectiveArgs, {
          ...context,
          toolEventsSnapshot: this.#events,
        }) &&
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

    // ============ 文件作用域强制（工程级：硬拦截越界写入） ============
    if (SCOPE_WRITE_TOOLS.has(name) && context.scopeFiles && context.scopeFiles.length > 0) {
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
          `SCOPE_BLOCKED_WRITE: "${targetPath}" 不在当前子任务的作用域内 [${scopeList}]。\n` +
          `当前执行计划已限定修改范围，不允许创建或编辑此文件。\n` +
          `如果这是计划内的修改，请先推进计划到对应的子任务阶段。`;
        options.emitObservation?.(id, name, blockedMsg, resultMode);
        this.#recordEvent(name, effectiveArgs, false, blockedMsg);
        this.#ui.warn?.(`Scope blocked write: ${name} → ${targetPath}`);
        return {
          name,
          result: blockedMsg,
          skipped: true,
          scopeBlocked: true,
          errorCode: ObservationErrorCode.SCOPE_BLOCKED,
        };
      }
    }

    // ============ 执行工具 ============
    const planContextExtension =
      context.activePlanManager &&
      typeof context.activePlanManager.buildToolContextExtension === 'function'
        ? context.activePlanManager.buildToolContextExtension()
        : null;

    const executionContext = {
      workingDirectory: this.#config.workingDirectory || process.cwd(),
      memoryManager: context.memoryManager,
      sessionManager: context.sessionManager,
      modelProvider: context.modelProvider,
      debug: context.debug || false,
      ui: this.#ui,
      toolName: name,
      subAgent: context.subAgent,
      activePlanManager: context.activePlanManager,
      planner: context.planner,
      activePlan: context.activePlan,
      currentTask: context.currentTask,
      contentStore: this.#contentStore,
      fileAnalyzer: this.#fileAnalyzer,
      snapshotStore: this.#snapshotStore,
      hashlinePatcher: this.#hashlinePatcher,
      lspManager: this.#lspManager,
      editOrchestrator: this.#editOrchestrator,
      toolEventsSnapshot: this.#events.map((e) => ({ ...e })),
      ...(planContextExtension || {}),
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
                const state = context.workspaceState || this.#config.workspaceState;
                if (state && typeof state.recordToolResult === 'function') {
                  state.recordToolResult('list_dir', { path: fallbackDir }, dirResult, true);
                }
                if (state && typeof state.recordPathNotFound === 'function') {
                  state.recordPathNotFound(targetPath, `File not found: ${targetPath}`);
                }
                const alternatives =
                  state && typeof state.getPathAlternatives === 'function'
                    ? state.getPathAlternatives(targetPath)
                    : [];
                const fallbackDesc = fallbackDir === '.' ? 'workspace root' : `"${fallbackDir}"`;
                const currentPhase = String(
                  executionContext.currentTask?.phase || '',
                ).toLowerCase();
                const currentTaskText = String(
                  `${executionContext.currentTask?.id || ''} ${executionContext.currentTask?.name || ''} ${executionContext.currentTask?.description || ''}`,
                ).toLowerCase();
                const shouldCreateInstead =
                  currentPhase === 'implementation' ||
                  /\b(create|new|setup|implement|write|skeleton|scaffold|from scratch)\b|创建|新建|搭建|实现|工程化/.test(
                    currentTaskText,
                  );
                const correctionHint = shouldCreateInstead
                  ? `\n\nCorrection: this task is in implementation/create mode. Do not retry guessed reads for "${targetPath}". If this file is needed, create it with write_file (or mkdir/shell for directories) and continue building the project.`
                  : `\n\nCorrection: use the directory listing above to choose an existing path before retrying. If the user asked you to create this file from scratch, switch to write_file instead of read_file.`;
                const observation = buildMissingReadObservation({
                  targetPath,
                  reason: `The file does not exist on disk. Fallback listed ${fallbackDesc}.`,
                  alternatives,
                  directoryListing: `Directory listing for ${fallbackDesc}:\n${dirResult}`,
                  correction: correctionHint,
                });
                options.emitObservation?.(id, name, observation, resultMode);
                this.#recordEvent('list_dir', { path: fallbackDir }, true, dirResult);
                this.#recordEvent(name, effectiveArgs, false, observation);
                this.#ui.debugEvent?.('read_file fallback listed directory', {
                  missingPath: targetPath,
                  fallbackDir,
                  alternatives: alternatives.map((item) => item.path),
                });
                this.#ui.toolResult?.(name, observation, effectiveArgs);
                return {
                  name,
                  result: observation,
                  args: effectiveArgs,
                  success: false,
                  error: `File not found: ${targetPath}`,
                  skipped: true,
                  fallbackToDir: true,
                  errorCode: ObservationErrorCode.MISSING_FILE,
                };
              } catch (e) {
                // 目录列表也失败，继续执行原始 read_file 返回错误
              }
            }
          }
        }
      }
    }

    this.#checkReadOnlyStagnation(name, args, context);

    let finalResult;
    try {
      const rawResult = await withTimeout(
        () => tool.handler(effectiveArgs, executionContext),
        60000,
        `Tool ${name}`,
      );
      finalResult = this.#applySecurityResultPolicy(name, rawResult);
      const normalizedResult = normalizeToolResult(finalResult);
      this.#recordEvent(name, effectiveArgs, normalizedResult.success, finalResult);

      if (normalizedResult.success && MUTATION_TOOLS.has(name)) {
        this.#invalidateReadOnlyHistory();
        // 工作区发生变更，清空所有失败指纹（之前的失败可能因代码改变而不再适用）
        this.#failureFingerprints.clear();
      }

      // 成功调用：如果之前有相同指纹的失败记录，清除它（状态改变了）
      if (normalizedResult.success) {
        this.#failureFingerprints.delete(failureFingerprint);
      } else {
        // 失败调用：记录失败指纹
        const errorFingerprint = extractFailureFingerprint(name, effectiveArgs, finalResult);
        const prev = this.#failureFingerprints.get(failureFingerprint);
        if (prev && prev.errorPattern === errorFingerprint) {
          prev.count += 1;
          prev.lastError = String(finalResult ?? '').substring(0, 500);
        } else {
          this.#failureFingerprints.set(failureFingerprint, {
            count: 1,
            errorPattern: errorFingerprint,
            lastError: String(finalResult ?? '').substring(0, 500),
          });
        }
        // 限制失败指纹缓存大小
        if (this.#failureFingerprints.size > 100) {
          const firstKey = this.#failureFingerprints.keys().next().value;
          this.#failureFingerprints.delete(firstKey);
        }
      }

      // 仅成功执行的调用才加入历史，避免失败后无法重试
      if (normalizedResult.success && canUseCache) {
        this.#callHistory.add(callSignature);
        if (this.#callHistory.size > 50) {
          const oldest = this.#callHistory.values().next().value;
          this.#callHistory.delete(oldest);
        }
      }
      // 写工具写持久化缓存，读工具写内存缓存（通过 snapshotStore.head 比对文件 hash）
      if (normalizedResult.success && canUseCache && !isReadOnly) {
        const cachedValue =
          typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);
        this.#resultCache.set(callSignature, cachedValue);
        this.#flushCacheEntry(callSignature, cachedValue);

        // 写工具成功后更新文件新鲜度缓存
        const mutationTarget = getScopeTargetPath(name, effectiveArgs);
        if (
          mutationTarget &&
          this.#snapshotStore &&
          typeof this.#snapshotStore.head === 'function'
        ) {
          const newTag = this.#snapshotStore.head(mutationTarget);
          if (newTag) {
            this.#fileFreshnessCache.set(mutationTarget, newTag);
          }
        }

        // 写文件后预填充读缓存，避免立即重复读取
        const writeTools = [
          'write_file',
          'write_file_with_hashline',
          'edit_file',
          'update_file',
          'rename_file',
          'apply_hashline_patch',
        ];
        if (writeTools.includes(name)) {
          const targetPath = getScopeTargetPath(name, effectiveArgs);
          if (targetPath && this.#snapshotStore) {
            const fileTag = this.#snapshotStore.head(targetPath);
            if (fileTag) {
              // 尝试从参数中获取内容（如果可用）
              let content = effectiveArgs.content || effectiveArgs.text;

              // 如果参数中没有内容，从磁盘读取
              if (content === undefined || content === null) {
                try {
                  content = await readFile(
                    path.resolve(executionContext.workingDirectory, targetPath),
                    'utf-8',
                  );
                } catch (e) {
                  // 文件可能还未创建或无法读取
                }
              }

              if (content !== undefined && content !== null) {
                // 预填充带行号的结果缓存（模拟 read_file 的输出格式）
                const lines = content.split('\n');
                const numberedResult = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
                const readSignature = `read_file:${JSON.stringify({ path: effectiveArgs.path || effectiveArgs.file })}`;
                this.#resultCache.set(readSignature, { result: numberedResult, fileTag });
              }
            }
          }
        }
      } else if (normalizedResult.success && canUseCache) {
        // 读工具：存储结果和当前文件 tag 到内存缓存，供后续 hash 比对
        const targetPath = getScopeTargetPath(name, effectiveArgs);
        const fileTag =
          targetPath && this.#snapshotStore ? this.#snapshotStore.head(targetPath) : null;
        this.#resultCache.set(callSignature, { result: finalResult, fileTag });

        // 更新文件新鲜度缓存
        if (targetPath && fileTag) {
          this.#fileFreshnessCache.set(targetPath, fileTag);
        }

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
      return {
        name,
        result: finalResult,
        args: effectiveArgs,
        success: normalizedResult.success,
        ...(normalizedResult.error ? { error: normalizedResult.error } : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.#recordEvent(name, effectiveArgs, false, `Error: ${errorMsg}`);
      this.#ui.toolError?.(name, errorMsg, effectiveArgs);
      options.emitObservation?.(id, name, `Error: ${errorMsg}`, resultMode);
      return { name, result: `Error: ${errorMsg}`, args: effectiveArgs, error: errorMsg };
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
      const args = this.#parseArgs(toolCall.arguments);
      return { ...toolCall, arguments: normalizeToolArgumentAliases(toolCall.name, args) };
    }
    if (toolCall.function?.name) {
      const args = this.#parseArgs(toolCall.function.arguments);
      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: normalizeToolArgumentAliases(toolCall.function.name, args),
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

  #checkReadOnlyStagnation(name, args, context) {
    if (!READ_ONLY_TOOLS.has(name)) {
      return;
    }

    const activePlanManager = context.activePlanManager;
    if (!activePlanManager || typeof activePlanManager.checkReadOnlyStagnation !== 'function') {
      return;
    }

    const readOnlyLoop = activePlanManager.checkReadOnlyStagnation(5);
    if (!readOnlyLoop.isReadOnlyLoop) {
      return;
    }

    const sessionManager = context.sessionManager;
    if (!sessionManager || typeof sessionManager.addSystemMessage !== 'function') {
      return;
    }

    const overExplored = readOnlyLoop.overExploredTargets
      .map((t) => `  - ${t.key}: ${t.count} times`)
      .join('\n');
    const recentActions = readOnlyLoop.recentReadOnlyActions.map((a) => a.toolName).join(', ');

    const message =
      `[READ-ONLY LOOP CHECK] Detected ${readOnlyLoop.streak} consecutive read-only actions without decisive progress.\n\n` +
      `Recent actions: ${recentActions}\n\n` +
      `Over-explored targets:\n${overExplored || '  None'}\n\n` +
      `Stop repeating the same read-only loop. Choose one concrete evidence-based step:\n` +
      `1. Apply the smallest scoped edit if the target is clear\n` +
      `2. Gather the single missing fact with a focused read/search/diagnostic\n` +
      `3. Run a targeted verification command\n` +
      `4. Replan, ask_user, or provide FINAL_ANSWER with the blocker`;

    sessionManager.addSystemMessage(message);
  }

  #checkWriteBeforeRead(name, args, context) {
    const WRITE_TOOLS_REQUIRING_READ = new Set([
      'write_file',
      'edit_file',
      'update_file',
      'apply_hashline_patch',
      'write_file_with_hashline',
    ]);

    if (!WRITE_TOOLS_REQUIRING_READ.has(name)) {
      return null;
    }

    const targetPath = getScopeTargetPath(name, args);
    if (!targetPath) {
      return null;
    }

    const workingDirectory = this.#config.workingDirectory || process.cwd();
    if (name === 'write_file') {
      const absPath = path.resolve(workingDirectory, targetPath);
      if (!existsSync(absPath)) {
        return null;
      }
    }

    const workspaceState = context.workspaceState || this.#config.workspaceState;
    if (
      workspaceState &&
      typeof workspaceState.isWorkspaceEmpty === 'function' &&
      workspaceState.isWorkspaceEmpty() === true &&
      isCreateOrImplementationTask(context.currentTask, context.activePlan)
    ) {
      return null;
    }

    const actionHistory = context.actionHistory;
    const historyHasRead =
      actionHistory && typeof actionHistory.hasReadFile === 'function'
        ? actionHistory.hasReadFile(targetPath)
        : false;
    const eventHasRead = this.#events.some((event) => {
      if (!event || event.success === false || event.name !== 'read_file') {
        return false;
      }
      return getScopeTargetPath(event.name, event.args || event.arguments || {}) === targetPath;
    });

    if (!historyHasRead && !eventHasRead) {
      const sessionManager = context.sessionManager;
      if (sessionManager && typeof sessionManager.addSystemMessage === 'function') {
        sessionManager.addSystemMessage(
          `[WRITE-BEFORE-READ GUARDRAIL] "${targetPath}" needs current-file evidence before editing. Read the relevant section first, then make the scoped change.`,
        );
      }
      return {
        name,
        success: false,
        result: `Error: Cannot ${name} "${targetPath}" without first reading it. Please call read_file to examine the current content before making changes.`,
        error: `Cannot ${name} "${targetPath}" without first reading it.`,
        skipped: true,
        writeBeforeReadRequired: true,
      };
    }

    // 文件新鲜度检查：对比当前文件内容 hash 与上次读取时的 hash
    if (this.#snapshotStore && typeof this.#snapshotStore.head === 'function') {
      const currentTag = this.#snapshotStore.head(targetPath);
      const cachedTag = this.#fileFreshnessCache.get(targetPath);
      if (cachedTag && currentTag && cachedTag !== currentTag) {
        const sessionManager = context.sessionManager;
        if (sessionManager && typeof sessionManager.addSystemMessage === 'function') {
          sessionManager.addSystemMessage(
            `[STALE FILE DETECTED] "${targetPath}" was modified since you last read it. Read it again to see the current content before editing.`,
          );
        }
        return {
          name,
          success: false,
          result: `Error: "${targetPath}" has been modified since you last read it. Read the file again to see the current content before making changes.`,
          error: `Stale file: "${targetPath}" modified since last read`,
          skipped: true,
          staleFile: true,
        };
      }
    }

    return null;
  }

  #checkUnsafeFullFileOverwrite(name, args, context) {
    if (name !== 'write_file') {
      return null;
    }

    const targetPath = getScopeTargetPath(name, args);
    if (!targetPath) {
      return null;
    }

    const workingDirectory = this.#config.workingDirectory || process.cwd();
    const absPath = path.resolve(workingDirectory, targetPath);
    if (!existsSync(absPath)) {
      return null;
    }

    const overwriteReason =
      typeof args?.overwrite_reason === 'string' ? args.overwrite_reason.trim() : '';
    if (args?.overwrite === true && overwriteReason.length > 0) {
      return null;
    }

    const sessionManager = context.sessionManager;
    if (sessionManager && typeof sessionManager.addSystemMessage === 'function') {
      sessionManager.addSystemMessage(
        `[FULL-FILE OVERWRITE GUARDRAIL] Replacing existing file "${targetPath}" needs an explicit overwrite decision. Prefer edit_file/apply_hashline_patch for incremental edits, or retry write_file with overwrite=true and overwrite_reason for an intentional full-file replacement.`,
      );
    }

    return {
      name,
      success: false,
      result: `Error: Refusing write_file overwrite of existing file "${targetPath}". Use edit_file/apply_hashline_patch for incremental changes, or pass overwrite=true with overwrite_reason for an intentional full-file replacement.`,
      error: `Refusing write_file overwrite of existing file "${targetPath}".`,
      skipped: true,
      fullOverwriteBlocked: true,
    };
  }
}

export default ToolExecutor;
