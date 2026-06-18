/**
 * Runtime Bootstrap — 平台无关的内核初始化层
 *
 * 设计目标：CLI / Desktop / 其他平台只调用这里的工厂函数，
 * 不再在各自目录中重复 runtime 组装逻辑。
 *
 * 典型用法：
 *   const { engine, toolRegistry, workspaceState, metricsSink, mcpClient } =
 *     await bootstrapRuntime({
 *       workingDirectory,
 *       maxIterations,
 *       debug: true,
 *       ui: { ... },           // UI 回调；不传则为 quiet
 *       metrics: { enabled: true, logDir: '/path/to/logs' },
 *       securityPolicy: 'full' | 'restricted' | 'readonly' | SecurityPolicy实例,
 *       modelProvider,         // 可传；传 null 的话随后 attach
 *     });
 *
 *  // 如需 MCP，随后执行：
 *  await initializeMCPServersFromEnv(mcpClient, toolRegistry, onLog);
 *  // 或显式注册：
 *  registerMCPTools(mcpClient, toolRegistry, serverName);
 */

import { existsSync, mkdirSync } from 'fs';
import { createAgentEngine } from './agent-engine.js';
import { ToolRegistry } from './tool-registry.js';
import {
  SecurityPolicy,
  createFullPolicy,
  createRestrictedPolicy,
  createReadOnlyPolicy,
} from './security-policy.js';
import { WorkspaceState } from './workspace-state.js';
import { metricsSink } from './metrics-sink.js';
import { MCPClient } from '../mcp/mcp-client.js';
import { createCoreTools, SKILL_TOOL_CREATORS } from '../tools/index.js';

// ====================================================================
// 安全策略工厂
// ====================================================================

/**
 * 根据字符串或实例规范化出 SecurityPolicy 对象
 */
export function resolveSecurityPolicy(policyInput, options = {}) {
  if (policyInput instanceof SecurityPolicy) {
    return policyInput;
  }
  if (typeof policyInput === 'object' && policyInput !== null) {
    return new SecurityPolicy({ ...options, ...policyInput });
  }
  const key = String(policyInput || 'full').toLowerCase();
  switch (key) {
    case 'readonly':
    case 'read_only':
    case 'read-only':
      return createReadOnlyPolicy(options);
    case 'restricted':
      return createRestrictedPolicy(options);
    case 'full':
    case 'allow_all':
    default:
      return createFullPolicy(options);
  }
}

// ====================================================================
// Metrics Sink 初始化
// ====================================================================

/**
 * 初始化 metricsSink（启用写盘 / 指定目录，或降级到 memory-only。
 * 幂等：对已初始化过的 sink 反复调用不会抛错。
 */
export function ensureMetricsSink({ enabled = true, logDir, workingDirectory } = {}) {
  const dir = logDir || (workingDirectory ? `${workingDirectory}/.agent-logs` : null) || null;
  // metricsSink 是单例，通过属性来配置
  metricsSink.enabled = !!enabled;
  metricsSink.logDir = dir;
  metricsSink._ensureDirCalled = false;
  return metricsSink;
}

// ====================================================================
// ToolRegistry 初始化（核心工具 + skills）
// ====================================================================

/**
 * 创建 ToolRegistry 并注册 core tools（文件读写 / shell / memory 等）
 */
export function createDefaultToolRegistry({
  workingDirectory = null,
  mcpClient = null,
  includeExperimentalTools = false,
} = {}) {
  const registry = new ToolRegistry();
  const coreTools = createCoreTools({ workingDirectory, mcpClient, includeExperimentalTools });
  for (const tool of coreTools) {
    try { registry.register(tool); } catch (_) { /* 重复注册忽略 */ }
  }
  // Skill 工具（architect/to_issues 等）——按需注册，避免依赖过重
  for (const creator of SKILL_TOOL_CREATORS) {
    try {
      const tool = typeof creator === 'function' ? creator() : creator;
      if (tool && tool.name) registry.register(tool);
    } catch (_) { /* 忽略 */ }
  }
  return registry;
}

// ====================================================================
// 主入口：bootstrapRuntime
// ====================================================================

/**
 * 统一创建一份可运行的 runtime：toolRegistry + securityPolicy +
 * workspaceState + metricsSink + agent-engine。
 *
 * 返回：{ engine, toolRegistry, securityPolicy, workspaceState, metricsSink, mcpClient }
 */
export async function bootstrapRuntime(options = {}) {
  const workingDirectory = options.workingDirectory
    ? (() => {
        const p = String(options.workingDirectory);
        if (!existsSync(p)) {
          try { mkdirSync(p, { recursive: true }); } catch (_) {}
        }
        return p;
      })()
    : process.cwd();

  const debug = !!options.debug;
  const maxIterations = options.maxIterations || 60;

  // 1) SecurityPolicy
  const securityPolicy = resolveSecurityPolicy(options.securityPolicy, options.securityPolicyOptions || {});

  // 2) MCP client（空壳，随后调用 initializeMCPServersFromEnv 才会连接）
  const mcpClient = new MCPClient(options.mcp || {});

  // 3) ToolRegistry
  const toolRegistry = createDefaultToolRegistry({
    workingDirectory,
    mcpClient,
    includeExperimentalTools: options.includeExperimentalTools === true,
  });

  // 4) WorkspaceState & Metrics
  const workspaceState = new WorkspaceState();
  const ms = ensureMetricsSink({
    enabled: options.metrics?.enabled !== false,
    logDir: options.metrics?.logDir || null,
    workingDirectory,
  });

  // 5) AgentEngine（真正的内核）
  const modelProvider = options.modelProvider || null;
  const ui = options.ui || null;
  const engine = createAgentEngine({
    modelProvider,
    toolRegistry,
    memoryManager: options.memoryManager || null,
    ui,
    config: {
      workingDirectory,
      maxIterations,
      maxTokens: options.maxTokens,
      securityPolicy,
      toolResultCacheEnabled: options.toolResultCacheEnabled !== false,
      tokenBudget: options.tokenBudget || null,
      tokenBudgetWarningThreshold: options.tokenBudgetWarningThreshold ?? 70,
      temperature: options.temperature,
      ...(options.engineConfigOverrides || {}),
    },
  });

  // 暴露内部状态给外层（便于 CLI/Desktop 显示运行信息）
  return {
    engine,
    toolRegistry,
    securityPolicy,
    workspaceState,
    metricsSink: ms,
    mcpClient,
    workingDirectory,
  };
}

// ====================================================================
// MCP 工具发现与注册
// ====================================================================

/**
 * 解析 `MCP_<NAME>_ENABLED=true` 环境变量并连接服务器，
 * 注册其工具到 toolRegistry。与 CLI agent-app-config.js 的
 * `initializeMCPServers` 等价，但不依赖 CLI 专属 UI。
 */
export async function initializeMCPServersFromEnv(mcpClient, toolRegistry, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  const mcpConfigs = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('MCP_') && key.endsWith('_ENABLED') && value === 'true') {
      const prefix = key.replace('_ENABLED', '');
      const name = prefix.replace('MCP_', '').toLowerCase();
      const command = process.env[`${prefix}_COMMAND`];
      const argsStr = process.env[`${prefix}_ARGS`] || '';
      const envStr = process.env[`${prefix}_ENV`] || '{}';

      if (command) {
        try {
          const args = argsStr.split(',').filter(Boolean);
          const env = JSON.parse(envStr);
          mcpConfigs.push({ name, command, args, env });
        } catch (err) {
          log(`[mcp] 解析 ${name} 配置失败: ${err.message}`);
        }
      }
    }
  }

  if (mcpConfigs.length === 0) {
    return { connected: 0 };
  }

  log(`[mcp] 正在连接 ${mcpConfigs.length} 个 MCP 服务器...`);

  const onConnected = (name) => registerMCPTools(mcpClient, toolRegistry, name);
  mcpClient.on('serverConnected', onConnected);

  let connected = 0;
  for (const cfg of mcpConfigs) {
    try {
      const ok = await mcpClient.connect(cfg.name, {
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
      });
      if (ok) {
        connected++;
        registerMCPTools(mcpClient, toolRegistry, cfg.name);
        log(`[mcp] ✓ ${cfg.name}`);
      } else {
        log(`[mcp] ✗ ${cfg.name} 连接失败`);
      }
    } catch (err) {
      log(`[mcp] ✗ ${cfg.name} 异常: ${err.message}`);
    }
  }

  return { connected, total: mcpConfigs.length };
}

/**
 * 将某个 MCP 服务器暴露的工具一次性注册到 toolRegistry。
 * 幂等：已注册同名工具会被跳过。
 */
export function registerMCPTools(mcpClient, toolRegistry, serverName) {
  if (!mcpClient || !toolRegistry) return 0;
  const tools = Array.isArray(mcpClient.getTools)
    ? mcpClient.getTools().filter((t) => t.serverName === serverName)
    : [];
  let registered = 0;
  for (const mcpTool of tools) {
    if (toolRegistry.has?.(mcpTool.fullName)) continue;
    const tool = {
      name: mcpTool.fullName,
      description: mcpTool.description,
      params: mcpTool.inputSchema?.properties || {},
      required: mcpTool.inputSchema?.required || [],
      call: async (args, context) => {
        try {
          return await mcpClient.callTool(mcpTool.serverName, mcpTool.name, args);
        } catch (err) {
          return { success: false, reason: err.message, error: String(err) };
        }
      },
    };
    try {
      toolRegistry.register(tool);
      registered++;
    } catch (_) { /* 已注册 */ }
  }
  return registered;
}

// ====================================================================
// 运行辅助
// ====================================================================

/**
 * 在已有 engine 上挂载一个 modelProvider（用于延迟初始化 provider 的场景）。
 */
export function attachModelProvider(engine, provider) {
  if (!engine) return null;
  if (typeof engine.attachModelProvider === 'function') {
    engine.attachModelProvider(provider);
  }
  return provider;
}

/**
 * 销毁一份 runtime，释放 MCP 连接等资源。
 */
export function disposeRuntime({ engine, mcpClient }) {
  try { engine?.dispose?.(); } catch (_) {}
  try { mcpClient?.disconnect?.(); } catch (_) {}
}
