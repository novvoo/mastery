/**
 * AgentEngine 会话与状态管理
 *
 * 职责：
 *   - processInput：主执行入口，管理任务生命周期
 *   - stop / clearSession / setDebugMode
 *   - 调试模式切换
 */

import { ReActAgent } from '../../core/runtime/agent/agent.js';
import { IntentClassifier } from '../../core/intent-classifier.js';
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

  // 检测是否为 ask_user 延续：agent 正在挂起等待用户输入
  // 跳过所有初始化流程（计划/事件/钩子），直接恢复执行
  if (
    ctx.agent &&
    typeof ctx.agent.isWaitingForUserInput === 'boolean' &&
    ctx.agent.isWaitingForUserInput
  ) {
    return await continueUserInput(ctx, input);
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
    try {
      console.warn('[MemoryManager] updateTask 失败:', err.message);
    } catch {}
  }

  await ctx.pluginManager.triggerHook(HOOKS.ON_INPUT_RECEIVED, input);
  await ctx.pluginManager.triggerHook(HOOKS.BEFORE_AGENT_START, input);

  ctx.eventBus.emit(RuntimeEvent.AGENT_START, {
    task: input,
    timestamp: ctx.state.startTime,
  });

  // 先进行意图分析，然后根据意图分析的结果来创建 plan
  let taskProfile = {
    isCodingTask: false,
    isModificationTask: false,
    riskLevel: 'low',
    semanticRiskDomains: [],
    requiresSemanticRiskReview: false,
  };

  try {
    // ReActAgent 内部会做真正的 LLM 意图识别；这里仅做本地任务画像，
    // 避免 runtime 外壳和 agent 内核重复消费同一个 modelProvider。
    const intentClassifier = new IntentClassifier(null, ctx.toolRegistry);
    taskProfile = intentClassifier.classifyTask(input, null) || taskProfile;

    if (ctx.config.debug) {
      console.log('[IntentClassifier] 任务分类结果:', JSON.stringify(taskProfile));
    }
  } catch (err) {
    if (ctx.config.debug) {
      console.warn('[IntentClassifier] 本地任务分类失败:', err.message);
    }
  }

  // 高级图规划（旧 runtime 外壳路径）。
  // 默认关闭，避免和 ReActAgent 内核自己的 planner/IntentClassifier 重复消费 modelProvider。
  let planContext = null;
  let executionPlan = null;
  if (ctx.config.enableRuntimePreplanning === true) {
    try {
      const taskName = input.substring(0, 48).trim();
      executionPlan = ctx.graphPlanner.createPlan(taskName, input, {
        workingDirectory: ctx.config.workingDirectory,
      });
      ctx.state.currentPlanId = executionPlan.id;

      let subtaskDefs;
      let decompositionMethod = 'template';

      if (ctx.modelProvider && typeof ctx.modelProvider.chat === 'function') {
        try {
          const availableTools = ctx.toolRegistry
            ? ctx.toolRegistry.getAll().map((t) => t.name)
            : [];

          ctx.eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
            message: 'AI 正在分析任务并生成执行计划...',
            level: 'info',
          });

          subtaskDefs = await ctx.graphPlanner.decomposeTaskLLM(input, ctx.modelProvider, {
            availableTools,
            workingDirectory: ctx.config.workingDirectory,
            taskProfile,
          });
          decompositionMethod = 'llm';
        } catch (llmErr) {
          subtaskDefs = ctx.graphPlanner.decomposeTask(null, input, { template: 'default' });
        }
      } else {
        const lowerInput = input.toLowerCase();
        let template = 'default';
        // 根据意图分析的结果选择模板，而不是简单的关键词匹配
        if (taskProfile.isBugTask) {
          template = 'default';
        } else if (lowerInput.includes('review') || lowerInput.includes('审查')) {
          template = 'code_review';
        } else if (lowerInput.includes('refactor') || lowerInput.includes('重构')) {
          template = 'refactor';
        }
        subtaskDefs = ctx.graphPlanner.decomposeTask(null, input, { template });
      }

      if (decompositionMethod === 'llm') {
        for (const def of subtaskDefs) {
          executionPlan.addTask(def);
        }
      }

      executionPlan.status = 'running';
      executionPlan.startedAt = Date.now();
      const firstReadyTask = Array.from(executionPlan.tasks.values()).find(
        (t) => t.status === 'pending' && t.dependencies.size === 0,
      );
      if (firstReadyTask) {
        firstReadyTask.updateStatus('running');
      }

      if (ctx.config.debug) {
        console.log(
          `[GraphPlanner] 创建执行计划 (${decompositionMethod}), ${Array.from(executionPlan.tasks.values()).length} 个子任务`,
        );
      }
    } catch (planError) {
      try {
        console.warn('[GraphPlanner] 任务规划失败，降级为线性执行:', planError.message);
      } catch {}
      ctx.state.currentPlanId = null;
      executionPlan = null;
    }
  }

  // 创建 Agent 实例（注入 onPlanAdvance 用于实时推送 plan 进度）
  const uIFacade = ctx.uiAdapter || createDefaultUIFacade(ctx);
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
      session: ctx.sessionManager,
      onPlanAdvance: (progress) => {
        if (progress.planCreated) {
          ctx.eventBus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
            planId: progress.planId,
            taskCount: progress.total,
            plan: progress.plan,
            summary: `AI 已分析并分解为 ${progress.total} 个子任务`,
          });
          ctx.state.currentPlanId = progress.planId;

          const taskLines = progress.tasks
            .map((t) => {
              const scopeStr =
                t.scopeFiles && t.scopeFiles.length > 0 ? ` 📁 [${t.scopeFiles.join(', ')}]` : '';
              return `- ${t.id}: ${t.name} [${t.status}]${scopeStr} - ${t.description}${t.dependencies.length > 0 ? ` (依赖: ${t.dependencies.join(', ')})` : ''}`;
            })
            .join('\n');

          planContext = {
            planId: progress.planId,
            taskCount: progress.total,
            method: progress.plan.decompositionMethod,
            text:
              `## 执行计划 (${progress.plan.decompositionMethod === 'auto' ? '自动生成' : progress.plan.decompositionMethod === 'external' ? '外部生成' : '模板生成'})\n` +
              `任务: ${input.substring(0, 200)}\n\n` +
              `子任务 DAG (${progress.total} 个):\n${taskLines}\n\n` +
              `📋 整体任务文件范围: 待确定\n` +
              `文件作用域由引擎强制执行。编码变更必须在完成前做运行时验证（test/lint/build）。`,
          };

          if (ctx.sessionManager) {
            try {
              ctx.sessionManager.addSystemMessage(
                `[PlanContext] planId=${planContext.planId} method=${planContext.method}\n${planContext.text}`,
              );
            } catch {}
          }
        }

        ctx.eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
          plan: {
            id: progress.planId,
            name: progress.plan?.name,
            description: progress.plan?.description,
            tasks: progress.tasks.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              description: t.description,
              dependencies: t.dependencies || [],
              scopeFiles: t.scopeFiles || [],
            })),
            status: progress.planStatus,
            createdAt: progress.plan?.createdAt,
            decompositionMethod: progress.plan?.decompositionMethod,
          },
          summary: `进度: ${progress.completed}/${progress.total}`,
          update: { after: `${progress.completed}/${progress.total} 完成` },
        });
      },
    },
    uIFacade,
  );
  ctx.agent = agent;

  // 将 GraphPlanner 创建的 plan 传递给 Agent
  if (executionPlan) {
    agent.setPlan(executionPlan);
  }

  // 启动 agent.run() 但不 await —— suspend/resume 模式下 ask_user 会挂起 Promise
  // 启动 agent.run() 作为后台任务
  const runPromise = agent
    .run(input)
    .then(async (result) => {
      ctx.state.status = result?.status === 'needs_user_input' ? 'needs_user_input' : 'completed';
      ctx.eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result });

      if (ctx.state.status === 'completed') {
        try {
          await ctx.memoryManager.completeTask();
        } catch (err) {
          try {
            console.warn('[MemoryManager] completeTask 失败:', err.message);
          } catch {}
        }
      }

      const tokenStats = ctx.tokenScope.getStats();
      if (tokenStats.totalRequests > 0) {
        const cost = tokenStats.totalCost
          ? `$${tokenStats.totalCost.toFixed(4)}`
          : 'N/A (未配置模型价格)';
        console.log(
          `[TokenScope] 本次任务: ${tokenStats.totalRequests} 请求, ${tokenStats.totalInputTokens}+${tokenStats.totalOutputTokens} tokens, ${cost} (${Math.round(tokenStats.duration / 1000)}s)`,
        );
      }

      await ctx.pluginManager.triggerHook(HOOKS.ON_OUTPUT_GENERATED, result);
      await ctx.pluginManager.triggerHook(HOOKS.AFTER_AGENT_COMPLETE, result);

      return result;
    })
    .catch(async (error) => {
      ctx.state.setError(error);
      ctx.eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: error.message });
      await ctx.pluginManager.triggerHook(HOOKS.ON_TOOL_ERROR, null, error);
      throw error;
    })
    .finally(async () => {
      try {
        await ctx.memoryManager.save();
      } catch (err) {
        try {
          console.warn('[MemoryManager] save 失败:', err.message);
        } catch {}
      }
      ctx.state.lastActivity = Date.now();
    });

  // 存储 run promise 供 continueUserInput 等待
  ctx._currentRunPromise = runPromise;

  // 等待 agent 到达 ask_user 挂起点，然后返回 needs_user_input 状态
  // 否则如果 agent 完成，直接返回结果
  const waitForUserInputOrComplete = new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (!ctx.agent) {
        clearInterval(checkInterval);
        resolve({ status: 'running', mode: 'async' });
        return;
      }
      // 检测 ask_user 挂起状态
      if (ctx.agent.isWaitingForUserInput) {
        clearInterval(checkInterval);
        ctx.state.status = 'needs_user_input';
        const pendingRequest = ctx.agent.pendingUserInputRequest;
        resolve({
          success: true,
          status: 'needs_user_input',
          answer: pendingRequest?.answer || '',
          userInputRequest: pendingRequest || null,
        });
        return;
      }
    }, 50);

    // 同时监听 agent 完成事件
    runPromise
      .then((result) => {
        clearInterval(checkInterval);
        // 只有在尚未返回 needs_user_input 时才解析最终结果
        resolve(result);
      })
      .catch((error) => {
        clearInterval(checkInterval);
        resolve({ status: 'error', error: error.message });
      });
  });

  return waitForUserInputOrComplete;
}

/**
 * ask_user 延续：用户提供了回答后，恢复 agent 循环并等待最终完成。
 * 不创建新 agent，保留所有内部状态（plan、workspace、session）。
 */
export async function continueUserInput(ctx, input) {
  if (!ctx.agent || typeof ctx.agent.resumeWithUserInput !== 'function') {
    throw new Error('Agent is not in a resumable state');
  }
  if (!ctx.agent.isWaitingForUserInput) {
    throw new Error('Agent is not waiting for user input');
  }

  ctx.state.status = 'running';
  ctx.eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
    message: '已收到补充信息，继续执行...',
    level: 'info',
    status: 'running',
  });

  // 注入用户回答，agent 循环恢复执行
  ctx.agent.resumeWithUserInput(input);

  // 等待 agent 最终完成
  try {
    const result = await ctx._currentRunPromise;
    ctx.state.status = 'completed';
    return result;
  } catch (error) {
    ctx.state.setError(error);
    throw error;
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
      if (ctx.config.debug) {
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message, level: 'debug' });
      }
    },
    debugEvent: (eventName, data) =>
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        message: `[${eventName}]`,
        level: 'debug',
        data,
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
    iteration: (current, max) =>
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        message: `迭代 ${current}/${max}`,
        level: 'info',
      }),
    // agent 挂起等待用户输入（suspend 机制替代硬中断）
    waitingForUserInput: (info) => {
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
        message: '需要你补充一点信息后继续',
        level: 'info',
        status: 'needs_user_input',
        data: info,
      });
    },
    // AgentPlanner 实时推送 plan 进度
    planProgress: (progress) => {
      const plan = progress.plan || {};
      const planId = progress.planId || plan.id;
      const tasks = progress.tasks || plan.tasks || [];
      eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
        planId,
        plan: {
          id: planId,
          name: plan.name,
          description: plan.description,
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.displayStatus || t.status,
            description: t.description,
          })),
          status: progress.planStatus || plan.status,
          createdAt: plan.createdAt,
          decompositionMethod: plan.decompositionMethod,
        },
        summary: `进度: ${progress.completed}/${progress.total}`,
      });
    },
    theme: {
      dim: (t) => t,
      success: (t) => t,
      error: (t) => t,
      info: (t) => t,
      warn: (t) => t,
    },
    isDebugEnabled: () => ctx.config.debug === true,
  };
}

function describeToolActivityLocal(name, args, status, resultOrError) {
  return {
    toolName: name,
    status,
    args: typeof args === 'object' && args ? Object.keys(args).length : 0,
    result: resultOrError ? String(resultOrError).substring(0, 120) : null,
    timestamp: Date.now(),
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
