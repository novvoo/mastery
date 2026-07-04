/**
 * Lifecycle Events — 标准化的四层生命周期事件
 *
 * 参考 oh-my-pi / claude-code 的设计理念：
 * - 分层清晰：Agent → Turn → Message → Tool
 * - 每层都有 start / update / end 生命周期
 * - 事件是纯数据对象，安全可序列化/持久化
 * - 向后兼容：旧 RuntimeEvent 仍可使用，新事件逐步迁移
 *
 * 四层模型：
 *   Agent (整个运行)
 *     └─ Turn (一轮 LLM 调用 + 工具执行)
 *         ├─ Message (流式消息)
 *         └─ Tool (工具调用)
 */

// ============================================================================
// 事件类型常量
// ============================================================================

export const LifecycleEvent = {
  // ── Agent 层 ──────────────────────────────────────────────────────────
  /** Agent 开始运行 */
  AGENT_START: 'lifecycle:agent_start',
  /** Agent 运行结束（成功/失败/停止） */
  AGENT_END: 'lifecycle:agent_end',

  // ── Turn 层 ──────────────────────────────────────────────────────────
  /** 开始一轮迭代（LLM 调用 + 工具执行） */
  TURN_START: 'lifecycle:turn_start',
  /** 一轮迭代结束 */
  TURN_END: 'lifecycle:turn_end',

  // ── Message 层 ────────────────────────────────────────────────────────
  /** 消息开始生成 */
  MESSAGE_START: 'lifecycle:message_start',
  /** 消息流式增量更新 */
  MESSAGE_DELTA: 'lifecycle:message_delta',
  /** 消息生成完成 */
  MESSAGE_END: 'lifecycle:message_end',

  // ── Tool 层 ──────────────────────────────────────────────────────────
  /** 工具开始执行 */
  TOOL_START: 'lifecycle:tool_start',
  /** 工具执行进度更新 */
  TOOL_PROGRESS: 'lifecycle:tool_progress',
  /** 工具执行完成 */
  TOOL_END: 'lifecycle:tool_end',

  // ── 阶段/状态 ────────────────────────────────────────────────────────
  /** 阶段变更（规划/探索/实现/验证/审阅） */
  PHASE_CHANGE: 'lifecycle:phase_change',
  /** 状态更新（通用） */
  STATUS_UPDATE: 'lifecycle:status_update',
};

// ============================================================================
// 阶段类型
// ============================================================================

export const AgentPhase = {
  /** 初始化 */
  INITIALIZING: 'initializing',
  /** 规划任务分解 */
  PLANNING: 'planning',
  /** 探索代码库/上下文 */
  EXPLORING: 'exploring',
  /** 实施修改 */
  IMPLEMENTING: 'implementing',
  /** 验证/测试 */
  VERIFYING: 'verifying',
  /** 审阅/总结 */
  REVIEWING: 'reviewing',
  /** 完成 */
  COMPLETING: 'completing',
  /** 已结束 */
  FINISHED: 'finished',
};

/**
 * 阶段的进行时描述（用于 UI 展示）
 * 参考 claude-code 的 activeForm 模式
 */
export const PhaseActiveForm = {
  [AgentPhase.INITIALIZING]: 'Initializing',
  [AgentPhase.PLANNING]: 'Planning task decomposition',
  [AgentPhase.EXPLORING]: 'Exploring codebase',
  [AgentPhase.IMPLEMENTING]: 'Implementing changes',
  [AgentPhase.VERIFYING]: 'Running tests and verification',
  [AgentPhase.REVIEWING]: 'Reviewing changes',
  [AgentPhase.COMPLETING]: 'Completing',
  [AgentPhase.FINISHED]: 'Finished',
};

/**
 * 阶段中文名（用于中文 UI）
 */
export const PhaseLabelZh = {
  [AgentPhase.INITIALIZING]: '初始化',
  [AgentPhase.PLANNING]: '规划中',
  [AgentPhase.EXPLORING]: '探索中',
  [AgentPhase.IMPLEMENTING]: '实现中',
  [AgentPhase.VERIFYING]: '验证中',
  [AgentPhase.REVIEWING]: '审阅中',
  [AgentPhase.COMPLETING]: '完成中',
  [AgentPhase.FINISHED]: '已完成',
};

// ============================================================================
// 事件工厂函数 — 生成标准化的事件数据
// ============================================================================

/**
 * 创建 agent_start 事件数据
 * @param {object} options
 * @param {string} options.runId
 * @param {string} [options.inputPreview]
 * @param {string} [options.workingDirectory]
 * @param {number} [options.maxIterations]
 * @returns {object}
 */
export function createAgentStartEvent(options = {}) {
  return {
    type: LifecycleEvent.AGENT_START,
    runId: options.runId || '',
    inputPreview: options.inputPreview || '',
    workingDirectory: options.workingDirectory || '',
    maxIterations: options.maxIterations || 0,
    timestamp: Date.now(),
  };
}

/**
 * 创建 agent_end 事件数据
 * @param {object} options
 * @param {string} options.runId
 * @param {boolean} options.success
 * @param {string} [options.status] - completed / failed / stopped
 * @param {string} [options.answer]
 * @param {string} [options.reason]
 * @param {number} [options.iterations]
 * @param {number} [options.durationMs]
 * @param {object} [options.summary] - RunSummary 聚合统计
 * @returns {object}
 */
export function createAgentEndEvent(options = {}) {
  return {
    type: LifecycleEvent.AGENT_END,
    runId: options.runId || '',
    success: options.success || false,
    status: options.status || (options.success ? 'completed' : 'failed'),
    answer: options.answer || '',
    reason: options.reason || null,
    iterations: options.iterations || 0,
    durationMs: options.durationMs || 0,
    summary: options.summary || null,
    timestamp: Date.now(),
  };
}

/**
 * 创建 turn_start 事件数据
 * @param {object} options
 * @param {number} options.iteration
 * @param {number} options.maxIterations
 * @param {string} [options.phase] - 当前阶段
 * @returns {object}
 */
export function createTurnStartEvent(options = {}) {
  return {
    type: LifecycleEvent.TURN_START,
    iteration: options.iteration || 0,
    maxIterations: options.maxIterations || 0,
    phase: options.phase || '',
    timestamp: Date.now(),
  };
}

/**
 * 创建 turn_end 事件数据
 * @param {object} options
 * @param {number} options.iteration
 * @param {string} [options.stopReason]
 * @param {number} [options.toolCallCount]
 * @param {number} [options.durationMs]
 * @returns {object}
 */
export function createTurnEndEvent(options = {}) {
  return {
    type: LifecycleEvent.TURN_END,
    iteration: options.iteration || 0,
    stopReason: options.stopReason || '',
    toolCallCount: options.toolCallCount || 0,
    durationMs: options.durationMs || 0,
    timestamp: Date.now(),
  };
}

/**
 * 创建 message_start 事件数据
 * @param {object} options
 * @param {string} [options.messageId]
 * @param {string} [options.role] - assistant / user / system
 * @returns {object}
 */
export function createMessageStartEvent(options = {}) {
  return {
    type: LifecycleEvent.MESSAGE_START,
    messageId: options.messageId || '',
    role: options.role || 'assistant',
    timestamp: Date.now(),
  };
}

/**
 * 创建 message_delta 事件数据
 * @param {object} options
 * @param {string} [options.text]
 * @param {string} [options.type] - text / reasoning / tool_call
 * @param {object} [options.toolCall]
 * @returns {object}
 */
export function createMessageDeltaEvent(options = {}) {
  return {
    type: LifecycleEvent.MESSAGE_DELTA,
    text: options.text || '',
    deltaType: options.type || 'text',
    toolCall: options.toolCall || null,
    timestamp: Date.now(),
  };
}

/**
 * 创建 message_end 事件数据
 * @param {object} options
 * @param {string} [options.messageId]
 * @param {string} [options.role]
 * @param {string} [options.content]
 * @param {number} [options.tokenCount]
 * @returns {object}
 */
export function createMessageEndEvent(options = {}) {
  return {
    type: LifecycleEvent.MESSAGE_END,
    messageId: options.messageId || '',
    role: options.role || 'assistant',
    content: options.content || '',
    tokenCount: options.tokenCount || 0,
    timestamp: Date.now(),
  };
}

/**
 * 创建 tool_start 事件数据
 * @param {object} options
 * @param {string} options.toolCallId
 * @param {string} options.toolName
 * @param {object} [options.args]
 * @returns {object}
 */
export function createToolStartEvent(options = {}) {
  return {
    type: LifecycleEvent.TOOL_START,
    toolCallId: options.toolCallId || '',
    toolName: options.toolName || '',
    args: options.args || {},
    timestamp: Date.now(),
  };
}

/**
 * 创建 tool_progress 事件数据
 * @param {object} options
 * @param {string} options.toolCallId
 * @param {string} options.toolName
 * @param {*} [options.partialResult]
 * @param {number} [options.progress] - 0-100 进度百分比
 * @param {string} [options.statusText] - 状态描述
 * @returns {object}
 */
export function createToolProgressEvent(options = {}) {
  return {
    type: LifecycleEvent.TOOL_PROGRESS,
    toolCallId: options.toolCallId || '',
    toolName: options.toolName || '',
    partialResult: options.partialResult || null,
    progress: options.progress ?? null,
    statusText: options.statusText || '',
    timestamp: Date.now(),
  };
}

/**
 * 创建 tool_end 事件数据
 * @param {object} options
 * @param {string} options.toolCallId
 * @param {string} options.toolName
 * @param {*} [options.result]
 * @param {boolean} [options.isError]
 * @param {string} [options.errorMessage]
 * @param {number} [options.durationMs]
 * @returns {object}
 */
export function createToolEndEvent(options = {}) {
  return {
    type: LifecycleEvent.TOOL_END,
    toolCallId: options.toolCallId || '',
    toolName: options.toolName || '',
    result: options.result !== undefined ? options.result : null,
    isError: options.isError || false,
    errorMessage: options.errorMessage || '',
    durationMs: options.durationMs || 0,
    timestamp: Date.now(),
  };
}

/**
 * 创建 phase_change 事件数据
 * @param {object} options
 * @param {string} options.phase - AgentPhase 常量
 * @param {string} [options.activeForm] - 进行时描述
 * @param {string} [options.detail] - 详细描述
 * @returns {object}
 */
export function createPhaseChangeEvent(options = {}) {
  const phase = options.phase || '';
  return {
    type: LifecycleEvent.PHASE_CHANGE,
    phase,
    activeForm: options.activeForm || PhaseActiveForm[phase] || phase,
    detail: options.detail || '',
    timestamp: Date.now(),
  };
}

// ============================================================================
// 向后兼容映射：旧 RuntimeEvent → 新 LifecycleEvent
// ============================================================================

/**
 * 旧事件名到新事件名的映射
 * 用于平滑迁移，旧事件仍可通过新事件总线监听
 */
export const LegacyToLifecycleMap = {
  'agent:start': LifecycleEvent.AGENT_START,
  'agent:complete': LifecycleEvent.AGENT_END,
  'agent:error': LifecycleEvent.AGENT_END,
  'agent:stop': LifecycleEvent.AGENT_END,
  'tool:call': LifecycleEvent.TOOL_START,
  'tool:result': LifecycleEvent.TOOL_END,
  'tool:error': LifecycleEvent.TOOL_END,
  'agent:text_delta': LifecycleEvent.MESSAGE_DELTA,
  'agent:reasoning_delta': LifecycleEvent.MESSAGE_DELTA,
  'agent:tool_call_delta': LifecycleEvent.MESSAGE_DELTA,
  'status:update': LifecycleEvent.STATUS_UPDATE,
  'plan:created': LifecycleEvent.PHASE_CHANGE,
  'plan:updated': LifecycleEvent.PHASE_CHANGE,
};

export default {
  LifecycleEvent,
  AgentPhase,
  PhaseActiveForm,
  PhaseLabelZh,
  createAgentStartEvent,
  createAgentEndEvent,
  createTurnStartEvent,
  createTurnEndEvent,
  createMessageStartEvent,
  createMessageDeltaEvent,
  createMessageEndEvent,
  createToolStartEvent,
  createToolProgressEvent,
  createToolEndEvent,
  createPhaseChangeEvent,
  LegacyToLifecycleMap,
};
