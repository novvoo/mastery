/**
 * Security Policy — 显式安全策略系统
 *
 * 核心设计原则:
 *  1. 默认拒绝 (deny-by-default)：未显式注册的工具走只读策略
 *  2. 分级权限模型 (PermissionLevel)：NONE < READ_ONLY < WRITE < EXECUTE < DANGEROUS
 *  3. 可审计决策 (audit trail)：每次工具调用都有策略决策记录
 *  4. 显式审批门控 (approval gate)：危险操作需明确确认
 *  5. 可插拔策略 (pluggable policies)：允许运行时替换/组合策略
 */

import { PermissionLevel, ToolScope } from '../../../types/index.js';

// ==================== 决策结果枚举 ====================
export const Decision = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
  RATE_LIMITED: 'rate_limited',
});

// ==================== 拒绝原因枚举 ====================
export const DenyReason = Object.freeze({
  PERMISSION_MISMATCH: 'permission_mismatch',
  EXTERNAL_EFFECT_BLOCKED: 'external_effect_blocked',
  CONCURRENCY_UNSAFE: 'concurrency_unsafe',
  GLOBAL_APPROVAL_REQUIRED: 'global_approval_required',
  TOOL_POLICY_REQUIRES_APPROVAL: 'tool_policy_requires_approval',
  VALIDATION_FAILED: 'validation_failed',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SCOPE_MISMATCH: 'scope_mismatch',
});

// ==================== 内置默认工具白名单 ====================
const DEFAULT_READ_ONLY_TOOLS = new Set([
  'list_dir',
  'read_file',
  'glob',
  'search',
  'semantic_search',
  'check_file',
  'pwd',
  'ls',
  'cat',
  'find',
  'rg',
  'grep',
  'tree',
  'git_status',
  'git_log',
  'git_diff',
  'git_branch',
  'git_show',
]);

const DEFAULT_WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'delete_file',
  'mkdir',
  'rename_file',
  'git_add',
  'git_commit',
  'git_apply_patch',
]);

const DEFAULT_EXECUTE_TOOLS = new Set([
  'shell',
  'pty_run',
  'exec',
  'run_command',
  'npm',
  'bun',
  'node',
  'python',
  'go',
  'cargo',
]);

const DEFAULT_DANGEROUS_TOOLS = new Set([
  'git_push',
  'git_push_force',
  'git_reset_hard',
  'git_rebase',
  'shell_dangerous',
  'rm_rf',
  'format_disk',
]);

// ==================== 辅助：权限级别排序 ====================
const PERMISSION_ORDER = {
  [PermissionLevel.NONE]: 0,
  [PermissionLevel.READ_ONLY]: 1,
  [PermissionLevel.WRITE]: 2,
  [PermissionLevel.EXECUTE]: 3,
  [PermissionLevel.DANGEROUS]: 4,
};

function permissionGte(required, actual) {
  return (PERMISSION_ORDER[actual] ?? -1) >= (PERMISSION_ORDER[required] ?? 99);
}

// ==================== 安全策略类 ====================
export class SecurityPolicy {
  #toolPolicies;
  #globalPolicy;
  #rateLimits;
  #auditLog;
  #hooks;
  #pendingApprovals;

  constructor(options = {}) {
    this.#toolPolicies = new Map();
    this.#globalPolicy = {
      requireApproval: options.requireApproval || false,
      maxPermissionLevel: options.maxPermissionLevel || PermissionLevel.DANGEROUS,
      allowExternalEffect: options.allowExternalEffect !== false,
      allowConcurrencyUnsafe: options.allowConcurrencyUnsafe !== false,
      defaultScope: options.defaultScope || ToolScope.ALL,
    };
    this.#rateLimits = new Map();
    this.#auditLog = [];
    this.#hooks = {
      beforeDecision: options.beforeDecision || null,
      afterDecision: options.afterDecision || null,
      onAudit: options.onAudit || null,
    };
    this.#pendingApprovals = new Set();
  }

  // ============== 策略注册 API ==============

  registerPolicy(toolName, policy = {}) {
    const normalized = {
      permissionLevel: policy.permissionLevel || PermissionLevel.READ_ONLY,
      scope: policy.scope || ToolScope.ALL,
      isConcurrencySafe: policy.isConcurrencySafe !== false,
      hasExternalEffect: policy.hasExternalEffect || false,
      maxResultChars: policy.maxResultChars || 100000,
      requiresApproval: policy.requiresApproval || false,
      description: policy.description || '',
      rateLimit: policy.rateLimit || null,
      validators: policy.validators || [],
    };
    this.#toolPolicies.set(toolName, normalized);
    this.#audit('policy_registered', { tool: toolName, policy: normalized });
    return this;
  }

  registerDefaultPolicies(tools = []) {
    for (const tool of tools) {
      if (!this.#toolPolicies.has(tool.name)) {
        this.registerPolicy(tool.name, this.#inferPolicy(tool));
      }
    }
    return this;
  }

  // ============== 核心决策 API ==============

  evaluate(toolName, args = {}, context = {}) {
    const policy = this.getPolicy(toolName);
    const before = this.#hooks.beforeDecision?.(toolName, args, policy, context);
    if (before && before.decision) {
      return this.#finalizeDecision(toolName, args, before, policy, context);
    }

    // 1. 全局权限上限检查
    if (!permissionGte(policy.permissionLevel, this.#globalPolicy.maxPermissionLevel)) {
      return this.#finalizeDecision(
        toolName,
        args,
        {
          decision: Decision.DENY,
          reason: DenyReason.PERMISSION_MISMATCH,
          detail: `Tool requires ${policy.permissionLevel} but global cap is ${this.#globalPolicy.maxPermissionLevel}`,
        },
        policy,
        context,
      );
    }

    // 2. 外部副作用检查
    if (policy.hasExternalEffect && !this.#globalPolicy.allowExternalEffect) {
      return this.#finalizeDecision(
        toolName,
        args,
        {
          decision: Decision.DENY,
          reason: DenyReason.EXTERNAL_EFFECT_BLOCKED,
          detail: 'External effects are disabled by global policy',
        },
        policy,
        context,
      );
    }

    // 3. 并发安全检查（当 context 表明是并发调用时）
    if (
      context.isConcurrent &&
      !policy.isConcurrencySafe &&
      !this.#globalPolicy.allowConcurrencyUnsafe
    ) {
      return this.#finalizeDecision(
        toolName,
        args,
        {
          decision: Decision.DENY,
          reason: DenyReason.CONCURRENCY_UNSAFE,
          detail: 'Tool is not safe for concurrent invocation',
        },
        policy,
        context,
      );
    }

    // 4. 范围匹配检查
    if (context.scope && policy.scope !== ToolScope.ALL && policy.scope !== context.scope) {
      return this.#finalizeDecision(
        toolName,
        args,
        {
          decision: Decision.DENY,
          reason: DenyReason.SCOPE_MISMATCH,
          detail: `Tool scoped to ${policy.scope}, requested ${context.scope}`,
        },
        policy,
        context,
      );
    }

    // 5. 参数验证器
    for (const validator of policy.validators) {
      const result = typeof validator === 'function' ? validator(args, context) : true;
      if (result === false || (result && result.valid === false)) {
        return this.#finalizeDecision(
          toolName,
          args,
          {
            decision: Decision.DENY,
            reason: DenyReason.VALIDATION_FAILED,
            detail: result?.reason || 'Argument validation failed',
          },
          policy,
          context,
        );
      }
    }

    // 6. 速率限制
    if (policy.rateLimit) {
      const { windowMs = 60000, maxCalls = 10 } = policy.rateLimit;
      const now = Date.now();
      const bucket = this.#rateLimits.get(toolName) || { calls: [] };
      bucket.calls = bucket.calls.filter((t) => now - t < windowMs);
      if (bucket.calls.length >= maxCalls) {
        return this.#finalizeDecision(
          toolName,
          args,
          {
            decision: Decision.DENY,
            reason: DenyReason.RATE_LIMIT_EXCEEDED,
            detail: `${bucket.calls.length} calls in last ${windowMs}ms, limit ${maxCalls}`,
          },
          policy,
          context,
        );
      }
      bucket.calls.push(now);
      this.#rateLimits.set(toolName, bucket);
    }

    // 7. 审批门控
    if (policy.requiresApproval || this.#globalPolicy.requireApproval) {
      const approvalKey = `${toolName}:${JSON.stringify(args ?? {}).substring(0, 80)}`;
      if (!this.#pendingApprovals.has(approvalKey)) {
        return this.#finalizeDecision(
          toolName,
          args,
          {
            decision: Decision.REQUIRE_APPROVAL,
            reason: policy.requiresApproval
              ? DenyReason.TOOL_POLICY_REQUIRES_APPROVAL
              : DenyReason.GLOBAL_APPROVAL_REQUIRED,
            detail: 'User approval required before execution',
            approvalKey,
          },
          policy,
          context,
        );
      }
    }

    return this.#finalizeDecision(
      toolName,
      args,
      {
        decision: Decision.ALLOW,
        reason: null,
        detail: 'Policy allows this tool call',
      },
      policy,
      context,
    );
  }

  // 便捷方法：布尔检查（保留向后兼容）
  requiresApproval(toolName) {
    const policy = this.getPolicy(toolName);
    return policy.requiresApproval || this.#globalPolicy.requireApproval;
  }

  // ============== 审批 API ==============

  approve(approvalKey) {
    this.#pendingApprovals.add(approvalKey);
    this.#audit('approval_granted', { approvalKey });
  }

  revokeApproval(approvalKey) {
    this.#pendingApprovals.delete(approvalKey);
    this.#audit('approval_revoked', { approvalKey });
  }

  clearApprovals() {
    this.#pendingApprovals.clear();
    this.#audit('approvals_cleared', {});
  }

  // ============== 结果裁剪 API ==============

  truncateResult(toolName, result) {
    const maxChars = this.getMaxResultChars(toolName);
    if (typeof result === 'string' && result.length > maxChars) {
      return result.substring(0, maxChars) + '\n\n... [result truncated by security policy]';
    }
    if (typeof result === 'object' && result !== null) {
      try {
        const json = JSON.stringify(result, null, 2);
        if (json.length > maxChars) {
          return json.substring(0, maxChars) + '\n\n... [result truncated by security policy]';
        }
      } catch {
        return result;
      }
    }
    return result;
  }

  // ============== 策略查询 API ==============

  getPolicy(toolName) {
    return this.#toolPolicies.get(toolName) || this.#getDefaultPolicy(toolName);
  }

  getMaxResultChars(toolName) {
    return this.getPolicy(toolName).maxResultChars;
  }

  isConcurrencySafe(toolName) {
    return this.getPolicy(toolName).isConcurrencySafe;
  }

  hasExternalEffect(toolName) {
    return this.getPolicy(toolName).hasExternalEffect;
  }

  listRegisteredTools() {
    return Array.from(this.#toolPolicies.keys());
  }

  // ============== 审计与报告 API ==============

  getAuditLog({ limit = 100, tool = null, decision = null } = {}) {
    let log = this.#auditLog.slice(-limit);
    if (tool) {
      log = log.filter((entry) => entry.tool === tool);
    }
    if (decision) {
      log = log.filter((entry) => entry.decision === decision);
    }
    return log;
  }

  getSecurityReport() {
    const byPermission = {};
    const byDecision = {
      [Decision.ALLOW]: 0,
      [Decision.DENY]: 0,
      [Decision.REQUIRE_APPROVAL]: 0,
      [Decision.RATE_LIMITED]: 0,
    };
    const approvalRequired = [];
    const notConcurrencySafe = [];
    const withExternalEffects = [];
    const dangerousTools = [];

    for (const [name, policy] of this.#toolPolicies) {
      const level = policy.permissionLevel;
      byPermission[level] = byPermission[level] || [];
      byPermission[level].push(name);

      if (policy.requiresApproval) {
        approvalRequired.push(name);
      }
      if (!policy.isConcurrencySafe) {
        notConcurrencySafe.push(name);
      }
      if (policy.hasExternalEffect) {
        withExternalEffects.push(name);
      }
      if (level === PermissionLevel.DANGEROUS) {
        dangerousTools.push(name);
      }
    }

    for (const entry of this.#auditLog) {
      if (entry.decision && byDecision[entry.decision] != null) {
        byDecision[entry.decision]++;
      }
    }

    return {
      totalTools: this.#toolPolicies.size,
      totalDecisions: this.#auditLog.length,
      byPermission,
      byDecision,
      approvalRequired,
      notConcurrencySafe,
      withExternalEffects,
      dangerousTools,
      globalPolicy: { ...this.#globalPolicy },
      pendingApprovals: this.#pendingApprovals.size,
    };
  }

  // ============== 内部：策略推断与默认值 ==============

  #inferPolicy(tool) {
    const name = tool.name?.toLowerCase() || '';
    const desc = (tool.description || '').toLowerCase();

    if (name.includes('reset') && (desc.includes('hard') || name.includes('hard'))) {
      return {
        permissionLevel: PermissionLevel.DANGEROUS,
        hasExternalEffect: true,
        requiresApproval: true,
      };
    }
    if (name.includes('force') && name.includes('push')) {
      return {
        permissionLevel: PermissionLevel.DANGEROUS,
        hasExternalEffect: true,
        requiresApproval: true,
      };
    }

    if (DEFAULT_DANGEROUS_TOOLS.has(name)) {
      return {
        permissionLevel: PermissionLevel.DANGEROUS,
        hasExternalEffect: true,
        requiresApproval: true,
      };
    }
    if (DEFAULT_EXECUTE_TOOLS.has(name) || /^(shell|exec|run|pty)/.test(name)) {
      return {
        permissionLevel: PermissionLevel.EXECUTE,
        hasExternalEffect: true,
        isConcurrencySafe: false,
      };
    }
    if (
      DEFAULT_WRITE_TOOLS.has(name) ||
      /^(write|edit|delete|create|rename|move|mkdir|remove)/.test(name)
    ) {
      return {
        permissionLevel: PermissionLevel.WRITE,
        hasExternalEffect: true,
        isConcurrencySafe: false,
      };
    }
    if (
      DEFAULT_READ_ONLY_TOOLS.has(name) ||
      /^(read|list|search|show|status|log|diff|check|get|find|ls|pwd|cat)/.test(name)
    ) {
      return { permissionLevel: PermissionLevel.READ_ONLY, isConcurrencySafe: true };
    }

    return { permissionLevel: PermissionLevel.READ_ONLY, isConcurrencySafe: true };
  }

  #getDefaultPolicy(toolName) {
    const inferred = this.#inferPolicy({ name: toolName, description: '' });
    return {
      permissionLevel: inferred.permissionLevel,
      scope: this.#globalPolicy.defaultScope,
      isConcurrencySafe: inferred.isConcurrencySafe ?? true,
      hasExternalEffect: inferred.hasExternalEffect ?? false,
      maxResultChars: 100000,
      requiresApproval: inferred.requiresApproval ?? false,
      description: '(default policy — tool was not explicitly registered)',
      rateLimit: null,
      validators: [],
    };
  }

  #finalizeDecision(toolName, args, decision, policy, context) {
    const record = {
      tool: toolName,
      decision: decision.decision,
      reason: decision.reason,
      detail: decision.detail,
      argsPreview: this.#preview(typeof args === 'string' ? args : JSON.stringify(args || {}), 160),
      permissionLevel: policy.permissionLevel,
      at: new Date().toISOString(),
    };
    this.#audit('decision', record);
    this.#hooks.afterDecision?.(toolName, args, decision, policy, context);
    return {
      ...decision,
      policy,
      approvalKey: decision.approvalKey || null,
      suggestedMessage: this.#suggestMessage(decision),
    };
  }

  #audit(type, payload) {
    const entry = { type, ...payload, at: new Date().toISOString() };
    this.#auditLog.push(entry);
    if (this.#auditLog.length > 2000) {
      this.#auditLog.splice(0, this.#auditLog.length - 2000);
    }
    this.#hooks.onAudit?.(entry);
  }

  #suggestMessage(decision) {
    switch (decision.decision) {
      case Decision.ALLOW:
        return null;
      case Decision.DENY:
        return `[Security] ${decision.reason}: ${decision.detail || 'blocked'}`;
      case Decision.REQUIRE_APPROVAL:
        return `[Security] User approval required: ${decision.detail || 'dangerous tool'}`;
      case Decision.RATE_LIMITED:
        return `[Security] Rate limited: ${decision.detail || 'too many calls'}`;
      default:
        return null;
    }
  }

  #preview(value, maxLength) {
    const text = value == null ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }
}

// ==================== 便捷工厂：创建受限策略 ====================
export function createReadOnlyPolicy(options = {}) {
  return new SecurityPolicy({
    maxPermissionLevel: PermissionLevel.READ_ONLY,
    allowExternalEffect: false,
    ...options,
  });
}

export function createRestrictedPolicy(options = {}) {
  return new SecurityPolicy({
    maxPermissionLevel: PermissionLevel.WRITE,
    allowExternalEffect: true,
    requireApproval: false,
    ...options,
  });
}

export function createFullPolicy(options = {}) {
  return new SecurityPolicy({
    maxPermissionLevel: PermissionLevel.DANGEROUS,
    ...options,
  });
}

export default SecurityPolicy;
