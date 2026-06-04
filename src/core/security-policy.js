/**
 * Security Policy - 工具安全策略系统
 *
 * 功能：
 * - 工具权限分级（5级）
 * - 并发安全标注
 * - 外部副作用标记
 * - 结果大小限制
 * - 审批门控
 */

import { PermissionLevel, ToolScope } from './types.js';

export class SecurityPolicy {
  #toolPolicies;
  #globalApprovalRequired;
  #rateLimits;

  constructor(options = {}) {
    this.#toolPolicies = new Map();
    this.#globalApprovalRequired = options.requireApproval || false;
    this.#rateLimits = new Map();
  }

  /**
   * 注册工具安全策略
   * @param {string} toolName - 工具名
   * @param {object} policy - 策略配置
   */
  registerPolicy(toolName, policy = {}) {
    this.#toolPolicies.set(toolName, {
      permissionLevel: policy.permissionLevel || PermissionLevel.READ_ONLY,
      scope: policy.scope || ToolScope.ALL,
      isConcurrencySafe: policy.isConcurrencySafe !== false,
      hasExternalEffect: policy.hasExternalEffect || false,
      maxResultChars: policy.maxResultChars || 10000,
      requiresApproval: policy.requiresApproval || false,
      description: policy.description || '',
    });
  }

  /**
   * 获取工具策略
   */
  getPolicy(toolName) {
    return this.#toolPolicies.get(toolName) || this.#getDefaultPolicy();
  }

  /**
   * 检查工具是否需要审批
   */
  requiresApproval(toolName) {
    const policy = this.getPolicy(toolName);
    return policy.requiresApproval || this.#globalApprovalRequired;
  }

  /**
   * 检查工具是否可以并发执行
   */
  isConcurrencySafe(toolName) {
    const policy = this.getPolicy(toolName);
    return policy.isConcurrencySafe;
  }

  /**
   * 检查工具是否有外部副作用
   */
  hasExternalEffect(toolName) {
    const policy = this.getPolicy(toolName);
    return policy.hasExternalEffect;
  }

  /**
   * 获取工具结果大小限制
   */
  getMaxResultChars(toolName) {
    const policy = this.getPolicy(toolName);
    return policy.maxResultChars;
  }

  /**
   * 截断工具结果到允许的大小
   */
  truncateResult(toolName, result) {
    const maxChars = this.getMaxResultChars(toolName);
    if (typeof result === 'string' && result.length > maxChars) {
      return result.substring(0, maxChars) + '\n\n... [result truncated by security policy]';
    }
    if (typeof result === 'object') {
      const json = JSON.stringify(result, null, 2);
      if (json.length > maxChars) {
        return json.substring(0, maxChars) + '\n\n... [result truncated by security policy]';
      }
    }
    return result;
  }

  /**
   * 批量注册默认策略
   * @param {Array<object>} tools - 工具列表
   */
  registerDefaultPolicies(tools) {
    for (const tool of tools) {
      if (!this.#toolPolicies.has(tool.name)) {
        const inferred = this.#inferPolicy(tool);
        this.registerPolicy(tool.name, inferred);
      }
    }
  }

  /**
   * 根据工具特征推断安全策略
   */
  #inferPolicy(tool) {
    const name = tool.name.toLowerCase();
    const desc = (tool.description || '').toLowerCase();

    // 危险操作
    if (name.includes('reset') && desc.includes('hard')) {
      return { permissionLevel: PermissionLevel.DANGEROUS, hasExternalEffect: true, requiresApproval: true };
    }
    if (name.includes('push') && name.includes('force')) {
      return { permissionLevel: PermissionLevel.DANGEROUS, hasExternalEffect: true, requiresApproval: true };
    }

    // 执行操作
    if (name.startsWith('shell') || name.startsWith('exec') || name.includes('push') || name.includes('pull')) {
      return { permissionLevel: PermissionLevel.EXECUTE, hasExternalEffect: true, isConcurrencySafe: false };
    }
    if (name.includes('commit') || name.includes('write') || name.includes('add') || name.includes('delete')) {
      return { permissionLevel: PermissionLevel.WRITE, hasExternalEffect: true, isConcurrencySafe: false };
    }
    if (name.includes('mcp_call') || name.includes('mcp_connect')) {
      return { permissionLevel: PermissionLevel.EXECUTE, hasExternalEffect: true, isConcurrencySafe: false };
    }

    // 只读操作 - 默认并发安全
    if (name.includes('status') || name.includes('list') || name.includes('log') ||
        name.includes('diff') || name.includes('branch') || name.includes('get') ||
        name.includes('search') || name.includes('read') || name.includes('show')) {
      return { permissionLevel: PermissionLevel.READ_ONLY, isConcurrencySafe: true };
    }

    // 默认策略
    return { permissionLevel: PermissionLevel.READ_ONLY };
  }

  /**
   * 获取默认策略
   */
  #getDefaultPolicy() {
    return {
      permissionLevel: PermissionLevel.READ_ONLY,
      scope: ToolScope.ALL,
      isConcurrencySafe: true,
      hasExternalEffect: false,
      maxResultChars: 10000,
      requiresApproval: false,
    };
  }

  /**
   * 获取安全报告
   */
  getSecurityReport() {
    const report = {
      totalTools: this.#toolPolicies.size,
      byPermission: {},
      approvalRequired: [],
      notConcurrencySafe: [],
      withExternalEffects: [],
    };

    for (const [name, policy] of this.#toolPolicies) {
      const level = policy.permissionLevel;
      if (!report.byPermission[level]) report.byPermission[level] = [];
      report.byPermission[level].push(name);

      if (policy.requiresApproval) report.approvalRequired.push(name);
      if (!policy.isConcurrencySafe) report.notConcurrencySafe.push(name);
      if (policy.hasExternalEffect) report.withExternalEffects.push(name);
    }

    return report;
  }
}

export default SecurityPolicy;
