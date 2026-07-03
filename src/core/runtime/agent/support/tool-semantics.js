/**
 * 统一工具语义分类模块
 *
 * 解决问题：
 * 1. agent-engine.js、execution-plan-manager.js、evidence-verifier.js、constants.js
 *    各自维护独立的 mutation/inspection/verification 定义，存在语义漂移
 * 2. exploration budget 只看"有没有 mutation"，不区分有价值的探索 vs 无效探索
 *
 * 使用方式：所有模块统一调用 getToolEffect() 获取工具的语义效果，
 * 而非各自内联判断。
 *
 * @module tool-semantics
 */

// ============================================================
// 工具效果枚举
// ============================================================

/** 工具对任务进度的语义效果 */
export const ToolEffect = {
  /** 文件修改 / 写入操作 — 直接改变代码状态 */
  MUTATION: 'mutation',
  /** 验证操作（test / lint / typecheck）— 确认变更正确性，但不是写代码 */
  VERIFICATION: 'verification',
  /** 有目标的检查（读取 plan scope 内文件、命中搜索、diagnostics 等）— 有价值的探索 */
  TARGETED_INSPECTION: 'targeted_inspection',
  /** 广泛探索（无范围的 list_dir / 模糊搜索等）— 可能是必要的，但不直接推动进展 */
  BROAD_EXPLORATION: 'broad_exploration',
  /** 无进展 / 无法判断 */
  NO_PROGRESS: 'no_progress',
};

// ============================================================
// 核心分类函数
// ============================================================

/**
 * 根据工具名称和参数，返回该工具调用的语义效果。
 *
 * @param {string} toolName - 工具名称
 * @param {object} [args={}] - 工具参数
 * @returns {string} ToolEffect 枚举值之一
 */
export function getToolEffect(toolName, args = {}) {
  const name = (toolName || '').toLowerCase().trim();

  // ---- 显式文件写入 / 编辑工具 ----
  if (isExplicitMutationTool(name)) {
    return ToolEffect.MUTATION;
  }

  // ---- Hashline / Harness 编辑工具 ----
  if (isHarnessMutationTool(name)) {
    return ToolEffect.MUTATION;
  }

  // ---- LSP 编辑工具 ----
  if (isLspEditTool(name)) {
    return ToolEffect.MUTATION;
  }

  // ---- Git 变更工具 ----
  if (isGitMutationTool(name)) {
    return ToolEffect.MUTATION;
  }

  // ---- Shell 命令：需要根据命令内容进一步区分 ----
  if (name === 'shell') {
    return classifyShellCommand(args);
  }

  // ---- 方法论工具 ----
  if (isMethodologyTool(name)) {
    return ToolEffect.VERIFICATION;
  }

  // ---- 只读 / 检查工具 ----
  if (isInspectionTool(name)) {
    return ToolEffect.TARGETED_INSPECTION;
  }

  return ToolEffect.NO_PROGRESS;
}

// ============================================================
// 便捷谓词函数（兼容旧接口）
// ============================================================

/**
 * 判断是否为 mutation 工具（会修改代码/文件）
 * 宽松定义：mutation + verification 都算（verification 说明有代码在验证）
 * @param {string} toolName
 * @param {object} [args={}]
 * @returns {boolean}
 */
export function isMutation(toolName, args = {}) {
  const effect = getToolEffect(toolName, args);
  return effect === ToolEffect.MUTATION || effect === ToolEffect.VERIFICATION;
}

/**
 * 严格判断：只有真正修改了文件才算 mutation
 * @param {string} toolName
 * @param {object} [args={}]
 * @returns {boolean}
 */
export function isStrictMutation(toolName, args = {}) {
  return getToolEffect(toolName, args) === ToolEffect.MUTATION;
}

/**
 * 判断是否为验证类工具
 * @param {string} toolName
 * @param {object} [args={}]
 * @returns {boolean}
 */
export function isVerification(toolName, args = {}) {
  return getToolEffect(toolName, args) === ToolEffect.VERIFICATION;
}

/**
 * 判断是否为检查类工具（读文件、搜索等）
 * @param {string} toolName
 * @returns {boolean}
 */
export function isInspection(toolName) {
  const effect = getToolEffect(toolName);
  return effect === ToolEffect.TARGETED_INSPECTION || effect === ToolEffect.BROAD_EXPLORATION;
}

/**
 * 判断工具调用是否产生了"有意义的进展"
 *
 * 用于 progress-aware exploration budget：
 * - MUTATION: 直接改了代码 → true
 * - VERIFICATION: 运行了测试/lint/typecheck → true
 * - TARGETED_INSPECTION + isInScope/hasSearchHit: 在范围内操作 → true
 * - TARGETED_INSPECTION (无上下文): 算部分进展 → 'partial'
 * - 其他 → false
 *
 * @param {string} toolName
 * @param {object} [args={}]
 * @param {object} [context={}] - 可选上下文
 * @param {boolean} [context.isInScope=false] - 是否在当前子任务文件范围
 * @param {boolean} [context.hasSearchHit=false] - 搜索是否有效命中
 * @returns {boolean|string} true=有进展, false=无进展, 'partial'=部分进展
 */
export function isMeaningfulProgress(toolName, args = {}, context = {}) {
  const effect = getToolEffect(toolName, args);

  switch (effect) {
    case ToolEffect.MUTATION:
      return true;

    case ToolEffect.VERIFICATION:
      return true;

    case ToolEffect.TARGETED_INSPECTION:
      if (context.isInScope || context.hasSearchHit) {
        return true;
      }
      return 'partial';

    case ToolEffect.BROAD_EXPLORATION:
    case ToolEffect.NO_PROGRESS:
    default:
      return false;
  }
}

// ============================================================
// 内部：工具分类集合
// ============================================================

const EXPLICIT_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'delete_file',
  'rename_file',
  'mkdir',
]);

const HARNESS_MUTATION_TOOLS = new Set([
  'apply_hashline_patch',
  'harness_replace',
  'harness_insert',
  'harness_delete',
  'harness_rollback',
]);

const LSP_EDIT_TOOLS = new Set(['lsp_rename', 'lsp_workspace_edit', 'lsp_code_action']);

const GIT_MUTATION_TOOLS = new Set([
  'git_apply_patch',
  'git_commit',
  'git_add',
  'git_push',
  'git_pull',
  'git_stash',
  'git_reset',
]);

const METHOD_TOOLS = new Set(['verify', 'review']);

const INSPECTION_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'search',
  'semantic_search',
  'check_file',
  'lsp_symbols',
  'lsp_diagnostics',
  'lsp_references',
  'lsp_definition',
  'lsp_type_definition',
  'lsp_hover',
  'lsp_document_symbol',
  'lsp_workspace_symbol',
  'web_fetch',
  'web_search',
]);

function isExplicitMutationTool(name) {
  return EXPLICIT_MUTATION_TOOLS.has(name);
}
function isHarnessMutationTool(name) {
  return HARNESS_MUTATION_TOOLS.has(name);
}
function isLspEditTool(name) {
  return LSP_EDIT_TOOLS.has(name);
}
function isGitMutationTool(name) {
  return GIT_MUTATION_TOOLS.has(name);
}
function isMethodologyTool(name) {
  return METHOD_TOOLS.has(name);
}
function isInspectionTool(name) {
  return INSPECTION_TOOLS.has(name);
}

// ============================================================
// 内部：Shell 命令分类
// ============================================================

/**
 * Shell 命令语义分类：
 * - verification: test/lint/typecheck 类
 * - mutation: 文件写入/包安装/构建
 * - inspection: ls/cat/grep/find 等只读
 * - unknown: 其他 → NO_PROGRESS
 */
function classifyShellCommand(args) {
  const cmd = String(args?.command || args?.input || args?.text || args?.cmd || '').toLowerCase();

  if (!cmd) {
    return ToolEffect.NO_PROGRESS;
  }

  // 验证类命令
  if (
    /\b(test|lint|typecheck|tsc|jest|vitest|pytest|eslint|prettier|biome|rustfmt|clippy)\b/.test(
      cmd,
    )
  ) {
    return ToolEffect.VERIFICATION;
  }

  // 写入类命令
  if (
    /(^|\s)(touch|cp|mv|rm|sed|perl|tee|install|create|generate|patch)\b/.test(cmd) ||
    />|>>/.test(cmd) ||
    /apply_patch/.test(cmd)
  ) {
    return ToolEffect.MUTATION;
  }

  // 包管理器安装依赖 = mutation
  if (/(^|\s)(bun|npm|pnpm|yarn|npx)(\s+(install|add|update|remove|uninstall))/.test(cmd)) {
    return ToolEffect.MUTATION;
  }

  // 包管理器运行脚本：test/build/lint 等 → verification；其他 → mutation
  if (/(^|\s)(bun|npm|pnpm|yarn|npx)\s+/.test(cmd)) {
    if (/\s+(test|build|start|dev|run|lint|check|typecheck)\b/.test(cmd)) {
      return ToolEffect.VERIFICATION;
    }
    return ToolEffect.MUTATION;
  }

  // 只读命令 → inspection
  if (/\b(ls|cat|grep|rg|find|pwd|tree|stat|head|tail|wc|which|whereis|echo|print)\b/.test(cmd)) {
    return ToolEffect.TARGETED_INSPECTION;
  }

  // 解释器执行脚本：含 test 路径 → verification；否则保守算 mutation
  if (/(^|\s)(node|python|python3|go|java|ruby|php|bash|sh|zsh)\s+/.test(cmd)) {
    if (/\b(test|spec|__tests__|tests?\/)/.test(cmd)) {
      return ToolEffect.VERIFICATION;
    }
    return ToolEffect.MUTATION;
  }

  // git 只读子命令 → inspection
  if (
    /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--list|remote\s+-v)\b/.test(cmd)
  ) {
    return ToolEffect.TARGETED_INSPECTION;
  }
  // git 其他子命令 → mutation
  if (/^git\b/.test(cmd)) {
    return ToolEffect.MUTATION;
  }

  // 默认未知
  return ToolEffect.NO_PROGRESS;
}

// ============================================================
// 导出常量（供需要白名单的场景使用）
// ============================================================

export const FORCE_ACTION_ALLOWED_EFFECTS = new Set([ToolEffect.MUTATION, ToolEffect.VERIFICATION]);
