/**
 * Tool Timeout Configuration System
 *
 * Provides centralized timeout management for all tools,
 * with per-tool default/min/max limits and clamping logic.
 */

export const TOOL_TIMEOUTS = {
  shell: { default: 30, min: 1, max: 3600, unit: 'seconds' },
  pty: { default: 60, min: 1, max: 3600, unit: 'seconds' },
  eval: { default: 30, min: 1, max: 3600, unit: 'seconds' },
  browser: { default: 30, min: 1, max: 300, unit: 'seconds' },
  web_search: { default: 20, min: 1, max: 45, unit: 'seconds' },
  web_fetch: { default: 20, min: 1, max: 45, unit: 'seconds' },
  lsp_diagnostics: { default: 20, min: 5, max: 60, unit: 'seconds' },
  git_status: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_diff: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_log: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_add: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_commit: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_push: { default: 30, min: 1, max: 120, unit: 'seconds' },
  git_pull: { default: 30, min: 1, max: 120, unit: 'seconds' },
  git_branch: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_reset: { default: 10, min: 1, max: 60, unit: 'seconds' },
  git_stash: { default: 10, min: 1, max: 60, unit: 'seconds' },
  checkpoint: { default: 30, min: 1, max: 120, unit: 'seconds' },
  rewind: { default: 30, min: 1, max: 120, unit: 'seconds' },
  list_checkpoints: { default: 5, min: 1, max: 30, unit: 'seconds' },
  preview: { default: 10, min: 1, max: 60, unit: 'seconds' },
  subagent_spawn: { default: 60, min: 1, max: 600, unit: 'seconds' },
  subagent_get_result: { default: 10, min: 1, max: 60, unit: 'seconds' },
  subagent_list: { default: 5, min: 1, max: 30, unit: 'seconds' },
  subagent_stop: { default: 10, min: 1, max: 60, unit: 'seconds' },
  semantic_search: { default: 15, min: 1, max: 60, unit: 'seconds' },
  document_rag: { default: 20, min: 1, max: 120, unit: 'seconds' },
};

const DEFAULT_TIMEOUT = { default: 30, min: 1, max: 3600, unit: 'seconds' };

/**
 * Clamp a raw timeout to the allowed range for a tool.
 * If rawTimeout is undefined, returns the tool's default.
 * @param {string} toolName - Tool name
 * @param {number|undefined} rawTimeout - Raw timeout value in seconds
 * @returns {number} Clamped timeout in seconds
 */
export function clampTimeout(toolName, rawTimeout) {
  const config = TOOL_TIMEOUTS[toolName] || DEFAULT_TIMEOUT;
  const timeout = rawTimeout ?? config.default;
  return Math.max(config.min, Math.min(config.max, timeout));
}

/**
 * Get timeout configuration for a tool
 * @param {string} toolName - Tool name
 * @returns {Object} Timeout config { default, min, max, unit }
 */
export function getTimeoutConfig(toolName) {
  return TOOL_TIMEOUTS[toolName] || DEFAULT_TIMEOUT;
}

/**
 * Convert timeout to milliseconds
 * @param {number} seconds - Timeout in seconds
 * @returns {number} Timeout in milliseconds
 */
export function toMilliseconds(seconds) {
  return seconds * 1000;
}

/**
 * ToolTimeoutManager - manages timeout configuration with runtime overrides
 */
export class ToolTimeoutManager {
  constructor(overrides = {}) {
    this.#overrides = { ...overrides };
  }

  #overrides;

  setOverride(toolName, config) {
    this.#overrides[toolName] = { ...config };
  }

  removeOverride(toolName) {
    delete this.#overrides[toolName];
  }

  getConfig(toolName) {
    return this.#overrides[toolName] || TOOL_TIMEOUTS[toolName] || DEFAULT_TIMEOUT;
  }

  clampTimeout(toolName, rawTimeout) {
    const config = this.getConfig(toolName);
    const timeout = rawTimeout ?? config.default;
    return Math.max(config.min, Math.min(config.max, timeout));
  }

  toJSON() {
    return { ...this.#overrides };
  }
}
