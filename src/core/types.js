/**
 * Core type definitions for AI Engineering Mastery Agent
 * (JSDoc-based types for plain JavaScript)
 */

// ============ Tool Types ============

export const ToolCategory = Object.freeze({
  FILESYSTEM: 'filesystem',
  SYSTEM: 'system',
  WEB: 'web',
  SKILL_ENGINEERING: 'skill_engineering',
  SKILL_PRODUCTIVITY: 'skill_productivity',
  SKILL_OUTPUT: 'skill_output',
  // Lowercase aliases for convenience
  filesystem: 'filesystem',
  system: 'system',
  web: 'web',
  skill_engineering: 'skill_engineering',
  skill_productivity: 'skill_productivity',
  skill_output: 'skill_output',
});

// ============ Error Types ============

export const ErrorCategory = Object.freeze({
  MODEL_ERROR: 'model_error',
  TOOL_ERROR: 'tool_error',
  CONTEXT_ERROR: 'context_error',
  FILESYSTEM_ERROR: 'filesystem_error',
  SHELL_ERROR: 'shell_error',
  VALIDATION_ERROR: 'validation_error',
  TIMEOUT_ERROR: 'timeout_error',
});

export const ErrorSeverity = Object.freeze({
  RECOVERABLE: 'recoverable',
  DEGRADED: 'degraded',
  FATAL: 'fatal',
});

// ============ Permission Types (inspired by OpenHuman) ============

export const PermissionLevel = Object.freeze({
  NONE: 'none',           // 无需权限（如 current_time）
  READ_ONLY: 'readonly',  // 只读操作（如 file_read, git_status）
  WRITE: 'write',         // 写入操作（如 file_write, git_commit）
  EXECUTE: 'execute',     // 执行命令（如 shell, git_push）
  DANGEROUS: 'dangerous',  // 危险操作（如 git_reset --hard）
});

export const ToolScope = Object.freeze({
  ALL: 'all',             // 所有场景可用
  AGENT_ONLY: 'agent',    // 仅 Agent 循环可用
  CLI_ONLY: 'cli',        // 仅 CLI 命令可用
});

// ============ Agent Experience Types ============

export const ExperienceOutcome = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  PARTIAL: 'partial',
});
