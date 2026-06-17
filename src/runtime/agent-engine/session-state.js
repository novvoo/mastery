/**
 * AgentEngine 会话与状态管理
 *
 * 职责：
 *   - processInput：主执行入口，管理任务生命周期
 *   - stop / clearSession / setDebugMode
 *   - 调试模式切换
 */

import { ReActAgent } from '../../core/agent.js';
import { HOOKS } from '../plugin-system.js';
import { RuntimeEvent } from '../types.js';

/**
 * 用户输入处理主流程。负责：
 *   1. 状态初始化/检查
 *   2. 触发 BEFORE/AFTER 钩子
 *   3. 创建 ReActAgent 实例并运行
 *   4. 错误捕获与持久化状态同步
 *   5. 发射相应 RuntimeEvent
 */
export async function processInput(ctx, input, options = {}) {
  if (!ctx.isInitialized) {
    throw new Error('AgentEngine 未初始化');
  }
  if (!ctx.modelProvider) {
    throw new Error('模型提供者未附加。请先使用 attachModelProvider() 方法。');
  }

  if (typeof options.debug === 'boolean') {
    ctx.config.debug = options.debug;
  }

  ctx.state.status = 'running';
  ctx.state.currentTask = input;
  ctx.state.startTime = Date.now();
  ctx.state.iteration = 0;

  // State sync: 记录当前任务描述
  try {
    await ctx.memoryManager.updateTask(input.substring(0, 500), 'execution');
  } catch (err) {
    try { console.warn('[MemoryManager] updateTask 失败:', err.message); } catch {}
  }

  await ctx.pluginManager.triggerHook(HOOKS.ON_INPUT_RECEIVED, input);
  await ctx.pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, input);

  ctx.eventBus.emit(RuntimeEvent.AGENT_START, {
    task: input,
    timestamp: ctx.state.startTime
  });

  // 高级图规划（可选）
  try {
    const taskName = input.substring(0, 48).trim();
    ctx.graphPlanner.createPlan(taskName, input, { workingDirectory: ctx.config.workingDirectory });

    const lowerInput = input.toLowerCase();
    let template = 'default';
    if (lowerInput.includes('review') || lowerInput.includes('审查')) template = 'code_review';
    else if (lowerInput.includes('refactor') || lowerInput.includes('重构')) template = 'refactor';

    const subtasks = ctx.graphPlanner.decomposeTask(
      null, input, { template }
    );
    ctx.state.currentPlanId = ctx.graphPlanner._latestPlanId || null;

    ctx.eventBus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
      planId: ctx.state.currentPlanId,
      taskCount: subtasks.length
    });

    if (ctx.config.debug) {
      console.log(`[GraphPlanner] 创建执行计划, ${subtasks.length} 个子任务`);
    }
  } catch (planError) {
    try { console.warn('[GraphPlanner] 任务规划失败，降级为线性执行:', planError.message); } catch {}
    ctx.state.currentPlanId = null;
  }

  // 创建 Agent 实例
  const agent = new ReActAgent(
    ctx.modelProvider,
    ctx.toolRegistry,
    ctx.memoryManager,
    {
      maxIterations: ctx.config.maxIterations,
      workingDirectory: ctx.config.workingDirectory,
      debug: ctx.config.debug,
      securityPolicy: ctx.securityPolicy,
      tokenJuice: ctx.tokenJuice,
      tokenScope: ctx.tokenScope,
      model: ctx.config.model,
      intentClassification: ctx.config.intentClassification !== false,
      toolResultCacheEnabled: ctx.config.toolResultCacheEnabled,
      session: ctx.sessionManager
    },
    ctx.uiAdapter || createDefaultUIFacade(ctx)
  );
  ctx.agent = agent;

  let result;
  try {
    result = await agent.run(input);
    ctx.state.status = result?.status === 'needs_user_input' ? 'needs_user_input' : 'completed';
    ctx.eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result });

    if (ctx.state.status === 'completed') {
      try { await ctx.memoryManager.completeTask(); } catch (err) {
        try { console.warn('[MemoryManager] completeTask 失败:', err.message); } catch {}
      }
    }

    const tokenStats = ctx.tokenScope.getStats();
    if (tokenStats.totalRequests > 0) {
      const cost = tokenStats.totalCost ? `$${tokenStats.totalCost.toFixed(4)}` : 'N/A (未配置模型价格)';
      console.log(
        `[TokenScope] 本次任务: ${tokenStats.totalRequests} 请求, ${tokenStats.totalInputTokens}+${tokenStats.totalOutputTokens} tokens, ${cost} (${Math.round(tokenStats.duration / 1000)}s)`
      );
    }

    await ctx.pluginManager.triggerHook(HOOKS.ON_OUTPUT_GENERATED, result);
    await ctx.pluginManager.triggerHook(HOOKS.AFTER_AGENT_COMPLETE, result);

    return result;
  } catch (error) {
    ctx.state.setError(error);
    ctx.eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: error.message });
    await ctx.pluginManager.triggerHook(HOOKS.ON_TOOL_ERROR, null, error);
    throw error;
  } finally {
    try { await ctx.memoryManager.save(); } catch (err) {
      try { console.warn('[MemoryManager] save 失败:', err.message); } catch {}
    }
    ctx.state.lastActivity = Date.now();
  }
}

/**
 * 创建默认 UI facade — 当外部未提供 uiAdapter 时使用。
 * 将所有 UI 操作桥接到事件总线。
 */
export function createDefaultUIFacade(ctx) {
  const eventBus = ctx.eventBus;
  return {
    info: (message) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'info' }),
    success: (message) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'success' }),
    error: (message) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'error' }),
    warn: (message) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'warn' }),
    debug: (message) => {
      if (ctx.config.debug) eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'debug' });
    },
    debugEvent: (eventName, data) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      message: `[${eventName}]`, level: 'debug', data
    }),
    thinking: (thinking) => eventBus.emit(RuntimeEvent.AGENT_THINKING, thinking),
    toolCall: (name, args) => {
      const activity = describeToolActivityLocal(name, args, 'running');
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: name, args, activity });
      eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
    },
    toolResult: (name, result, args = {}) => {
      const activity = describeToolActivityLocal(name, args, 'completed', result);
      eventBus.emit(RuntimeEvent.TOOL_RESULT, { toolName: name, args, result, activity });
      eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
    },
    toolError: (name, error, args = {}) => {
      const activity = describeToolActivityLocal(name, args, 'failed', error);
      eventBus.emit(RuntimeEvent.TOOL_ERROR, { toolName: name, args, error, activity });
      eventBus.emit(RuntimeEvent.TOOL_ACTIVITY, activity);
    },
    finalAnswer: (answer) => eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { answer }),
    iteration: (current, max) => eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      message: `迭代 ${current}/${max}`, level: 'info'
    }),
    theme: {
      dim: (t) => t, success: (t) => t, error: (t) => t, info: (t) => t, warn: (t) => t
    },
    isDebugEnabled: () => ctx.config.debug === true
  };
}

function describeToolActivityLocal(name, args, status, resultOrError) {
  return {
    toolName: name,
    status,
    args: typeof args === 'object' && args ? Object.keys(args).length : 0,
    result: resultOrError ? String(resultOrError).substring(0, 120) : null,
    timestamp: Date.now()
  };
}

export async function stopAgent(ctx) {
  await ctx.pluginManager.triggerHook(HOOKS.BEFORE_AGENT_STOP);
  if (ctx.agent && typeof ctx.agent.stop === 'function') {
    ctx.agent.stop();
  }
  ctx.state.status = 'idle';
  ctx.eventBus.emit(RuntimeEvent.AGENT_STOP, {});
  await ctx.pluginManager.triggerHook(HOOKS.AFTER_AGENT_STOP);
}

export function clearSession(ctx) {
  if (ctx.agent && typeof ctx.agent.clearSession === 'function') {
    ctx.agent.clearSession();
  }
}

export function setDebugMode(ctx, enabled) {
  ctx.config.debug = Boolean(enabled);
  if (ctx.modelProvider && typeof ctx.modelProvider.setDebugMode === 'function') {
    ctx.modelProvider.setDebugMode(enabled);
  }
  if (ctx.agent && typeof ctx.agent.setDebugMode === 'function') {
    ctx.agent.setDebugMode(enabled);
  }
}

export function getDebugMode(ctx) {
  return ctx.config.debug === true;
}
