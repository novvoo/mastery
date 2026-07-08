/**
 * Approval Mode Configuration System
 *
 * Provides a user-friendly configuration layer on top of SecurityPolicy,
 * supporting global modes (always-ask, write, yolo) and per-tool overrides.
 */

export const ApprovalMode = {
  ALWAYS_ASK: 'always-ask',
  WRITE: 'write',
  YOLO: 'yolo',
};

export const ToolTier = {
  READ: 'read',
  WRITE: 'write',
  EXEC: 'exec',
};

export const ToolPolicy = {
  ALLOW: 'allow',
  DENY: 'deny',
  PROMPT: 'prompt',
};

/**
 * Default tier mapping for common tools
 */
const DEFAULT_TOOL_TIERS = {
  // Read-tier tools
  read_file: ToolTier.READ,
  list_dir: ToolTier.READ,
  grep: ToolTier.READ,
  search_codebase: ToolTier.READ,
  web_search: ToolTier.READ,
  web_fetch: ToolTier.READ,
  semantic_search: ToolTier.READ,
  document_rag: ToolTier.READ,
  git_status: ToolTier.READ,
  git_log: ToolTier.READ,
  git_diff: ToolTier.READ,
  list_checkpoints: ToolTier.READ,
  preview: ToolTier.READ,
  lsp_diagnostics: ToolTier.READ,

  // Write-tier tools
  write_file: ToolTier.WRITE,
  edit_file: ToolTier.WRITE,
  apply_hashline_patch: ToolTier.WRITE,
  git_add: ToolTier.WRITE,
  git_commit: ToolTier.WRITE,
  git_push: ToolTier.WRITE,
  git_branch: ToolTier.WRITE,
  checkpoint: ToolTier.WRITE,

  // Exec-tier tools
  shell: ToolTier.EXEC,
  pty: ToolTier.EXEC,
  git_reset: ToolTier.EXEC,
  git_stash: ToolTier.EXEC,
  rewind: ToolTier.EXEC,
};

/**
 * Get the effective policy for a tool based on approval mode and overrides
 */
export function getEffectivePolicy(toolName, mode, perToolConfig = {}, toolTierMap = DEFAULT_TOOL_TIERS) {
  // Per-tool override takes highest precedence
  if (perToolConfig[toolName]) {
    return perToolConfig[toolName];
  }

  const tier = toolTierMap[toolName] || ToolTier.READ;

  switch (mode) {
    case ApprovalMode.ALWAYS_ASK:
      return ToolPolicy.PROMPT;
    case ApprovalMode.WRITE:
      return tier === ToolTier.EXEC ? ToolPolicy.PROMPT : ToolPolicy.ALLOW;
    case ApprovalMode.YOLO:
      return ToolPolicy.ALLOW;
    default:
      return ToolPolicy.PROMPT;
  }
}

/**
 * Check if a tool execution should be blocked based on policy
 */
export function shouldBlockTool(toolName, mode, perToolConfig = {}, toolTierMap = DEFAULT_TOOL_TIERS) {
  const policy = getEffectivePolicy(toolName, mode, perToolConfig, toolTierMap);
  return policy === ToolPolicy.DENY;
}

/**
 * Check if a tool execution requires user approval
 */
export function requiresApproval(toolName, mode, perToolConfig = {}, toolTierMap = DEFAULT_TOOL_TIERS) {
  const policy = getEffectivePolicy(toolName, mode, perToolConfig, toolTierMap);
  return policy === ToolPolicy.PROMPT;
}

/**
 * Parse approval mode from user input or config string
 */
export function parseApprovalMode(input) {
  if (!input || typeof input !== 'string') return ApprovalMode.WRITE;

  const normalized = input.toLowerCase().trim();

  if (normalized.includes('always') || normalized.includes('ask') || normalized.includes('prompt')) {
    return ApprovalMode.ALWAYS_ASK;
  }
  if (normalized.includes('yolo') || normalized.includes('auto') || normalized.includes('full')) {
    return ApprovalMode.YOLO;
  }
  if (normalized.includes('write') || normalized.includes('default')) {
    return ApprovalMode.WRITE;
  }

  return ApprovalMode.WRITE;
}

/**
 * Parse per-tool config from a config string like "shell:deny,git_push:prompt"
 */
export function parsePerToolConfig(configString) {
  if (!configString || typeof configString !== 'string') return {};

  const config = {};
  const pairs = configString.split(',');

  for (const pair of pairs) {
    const [toolName, policy] = pair.trim().split(':');
    if (toolName && policy) {
      const normalizedPolicy = policy.toLowerCase().trim();
      if (Object.values(ToolPolicy).includes(normalizedPolicy)) {
        config[toolName.trim()] = normalizedPolicy;
      }
    }
  }

  return config;
}

/**
 * ApprovalModeManager - manages approval configuration with persistence
 */
export class ApprovalModeManager {
  constructor(initialMode = ApprovalMode.WRITE, initialPerToolConfig = {}) {
    this.#mode = initialMode;
    this.#perToolConfig = { ...initialPerToolConfig };
    this.#toolTierMap = { ...DEFAULT_TOOL_TIERS };
    this.#onChange = null;
  }

  #mode;
  #perToolConfig;
  #toolTierMap;
  #onChange;

  get mode() {
    return this.#mode;
  }

  set mode(newMode) {
    if (this.#mode !== newMode) {
      this.#mode = newMode;
      this.#notifyChange();
    }
  }

  get perToolConfig() {
    return { ...this.#perToolConfig };
  }

  setPerToolPolicy(toolName, policy) {
    if (this.#perToolConfig[toolName] !== policy) {
      this.#perToolConfig[toolName] = policy;
      this.#notifyChange();
    }
  }

  removePerToolPolicy(toolName) {
    if (toolName in this.#perToolConfig) {
      delete this.#perToolConfig[toolName];
      this.#notifyChange();
    }
  }

  getEffectivePolicy(toolName) {
    return getEffectivePolicy(toolName, this.#mode, this.#perToolConfig, this.#toolTierMap);
  }

  shouldBlock(toolName) {
    return shouldBlockTool(toolName, this.#mode, this.#perToolConfig, this.#toolTierMap);
  }

  requiresApproval(toolName) {
    return requiresApproval(toolName, this.#mode, this.#perToolConfig, this.#toolTierMap);
  }

  registerToolTier(toolName, tier) {
    this.#toolTierMap[toolName] = tier;
  }

  onChange(callback) {
    this.#onChange = callback;
  }

  #notifyChange() {
    if (this.#onChange) {
      this.#onChange({
        mode: this.#mode,
        perToolConfig: { ...this.#perToolConfig },
      });
    }
  }

  toJSON() {
    return {
      mode: this.#mode,
      perToolConfig: { ...this.#perToolConfig },
    };
  }

  fromJSON(data) {
    if (data.mode) this.#mode = data.mode;
    if (data.perToolConfig) this.#perToolConfig = { ...data.perToolConfig };
    this.#notifyChange();
  }
}
