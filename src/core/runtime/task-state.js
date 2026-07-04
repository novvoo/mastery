/**
 * Task State Message — 标准化任务状态消息
 *
 * 参考 claude-code 的 task_state 消息 + TaskStateItem 设计理念：
 * - 任务有明确的状态流转（pending/running/completed/failed/skipped/killed）
 * - 每个任务有 activeForm 进行时描述，UI 可直接展示
 * - 支持任务依赖图（blocks / blockedBy）
 * - 纯数据结构，可序列化，可在消息中传递
 *
 * 使用场景：
 * - 执行计划的任务列表状态同步
 * - UI 任务列表展示
 * - LLM 与 agent 之间的结构化任务交互
 */

// ============================================================================
// 任务状态枚举
// ============================================================================

export const TaskStatus = {
  /** 等待中 */
  PENDING: 'pending',
  /** 运行中 */
  RUNNING: 'running',
  /** 已完成 */
  COMPLETED: 'completed',
  /** 失败 */
  FAILED: 'failed',
  /** 已跳过 */
  SKIPPED: 'skipped',
  /** 已中止 */
  KILLED: 'killed',
};

/**
 * 检查状态是否为终态（不会再变化）
 * @param {string} status
 * @returns {boolean}
 */
export function isTerminalTaskStatus(status) {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.SKIPPED ||
    status === TaskStatus.KILLED
  );
}

/**
 * 检查状态是否为活跃状态
 * @param {string} status
 * @returns {boolean}
 */
export function isActiveTaskStatus(status) {
  return status === TaskStatus.PENDING || status === TaskStatus.RUNNING;
}

// ============================================================================
// 任务类型
// ============================================================================

export const TaskType = {
  /** 研究/信息收集 */
  RESEARCH: 'research',
  /** 代码探索 */
  EXPLORATION: 'exploration',
  /** 实现/编码 */
  IMPLEMENTATION: 'implementation',
  /** 测试/验证 */
  TESTING: 'testing',
  /** 代码审查 */
  REVIEW: 'review',
  /** 重构 */
  REFACTOR: 'refactor',
  /** 文档 */
  DOCUMENTATION: 'documentation',
  /** 构建/发布 */
  BUILD: 'build',
  /** 通用 */
  GENERAL: 'general',
};

// ============================================================================
// TaskState — 单个任务状态
// ============================================================================

/**
 * @typedef {object} TaskState
 * @property {string} id - 任务唯一 ID
 * @property {string} type - 任务类型（TaskType）
 * @property {string} subject - 任务标题（简短）
 * @property {string} description - 任务详细描述
 * @property {string} status - 任务状态（TaskStatus）
 * @property {string} activeForm - 进行时描述（如 "Reading files"）
 * @property {string} [owner] - 执行者（agent / user / tool_name）
 * @property {string[]} blocks - 此任务阻塞的其他任务 ID 列表
 * @property {string[]} blockedBy - 阻塞此任务的其他任务 ID 列表
 * @property {number} [priority] - 优先级（0-100）
 * @property {number} [progress] - 进度（0-100）
 * @property {number} [startTime] - 开始时间戳
 * @property {number} [endTime] - 结束时间戳
 * @property {number} [estimatedDurationMs] - 预估耗时
 * @property {object} [metadata] - 扩展元数据
 */

// ============================================================================
// TaskStateMessage — 任务列表状态消息
// ============================================================================

/**
 * @typedef {object} TaskStateMessage
 * @property {string} type - 消息类型，固定为 'task_state'
 * @property {string} taskListId - 任务列表 ID（如 plan_xxx）
 * @property {TaskState[]} tasks - 任务列表
 * @property {number} timestamp - 时间戳
 */

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建一个任务状态对象
 * @param {object} options
 * @param {string} options.id
 * @param {string} [options.subject]
 * @param {string} [options.description]
 * @param {string} [options.status]
 * @param {string} [options.type]
 * @param {string} [options.activeForm]
 * @param {string} [options.owner]
 * @param {string[]} [options.blocks]
 * @param {string[]} [options.blockedBy]
 * @param {number} [options.priority]
 * @param {number} [options.progress]
 * @param {object} [options.metadata]
 * @returns {TaskState}
 */
export function createTaskState(options = {}) {
  const now = Date.now();
  const status = options.status || TaskStatus.PENDING;
  const type = options.type || TaskType.GENERAL;

  return {
    id: options.id || `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    subject: options.subject || '',
    description: options.description || '',
    status,
    activeForm: options.activeForm || options.subject || '',
    owner: options.owner || 'agent',
    blocks: options.blocks || [],
    blockedBy: options.blockedBy || [],
    priority: options.priority ?? 50,
    progress: options.progress ?? (status === TaskStatus.COMPLETED ? 100 : 0),
    startTime: status === TaskStatus.RUNNING ? now : undefined,
    endTime: isTerminalTaskStatus(status) ? now : undefined,
    estimatedDurationMs: options.estimatedDurationMs || 0,
    metadata: options.metadata || {},
  };
}

/**
 * 创建任务状态消息
 * @param {string} taskListId
 * @param {TaskState[]} tasks
 * @returns {TaskStateMessage}
 */
export function createTaskStateMessage(taskListId, tasks = []) {
  return {
    type: 'task_state',
    task_list_id: taskListId,
    tasks: tasks.map(normalizeTaskState),
    timestamp: Date.now(),
  };
}

/**
 * 更新任务状态
 * @param {TaskState} task
 * @param {object} updates
 * @returns {TaskState} 新的任务对象（不可变更新）
 */
export function updateTaskState(task, updates = {}) {
  const now = Date.now();
  const updated = { ...task, ...updates };

  // 状态变更时自动更新时间戳
  if (updates.status && updates.status !== task.status) {
    if (updates.status === TaskStatus.RUNNING && !task.startTime) {
      updated.startTime = now;
    }
    if (isTerminalTaskStatus(updates.status)) {
      updated.endTime = now;
      if (updates.status === TaskStatus.COMPLETED) {
        updated.progress = 100;
      }
    }
  }

  return updated;
}

/**
 * 规范化任务状态对象（确保所有字段存在）
 * @param {object} task
 * @returns {TaskState}
 */
export function normalizeTaskState(task) {
  return createTaskState({ ...task, id: task.id });
}

// ============================================================================
// 任务列表操作工具
// ============================================================================

/**
 * 在任务列表中查找任务
 * @param {TaskState[]} tasks
 * @param {string} taskId
 * @returns {TaskState|undefined}
 */
export function findTask(tasks, taskId) {
  return tasks.find((t) => t.id === taskId);
}

/**
 * 更新任务列表中的某个任务
 * @param {TaskState[]} tasks
 * @param {string} taskId
 * @param {object} updates
 * @returns {TaskState[]} 新的任务列表
 */
export function updateTaskInList(tasks, taskId, updates) {
  return tasks.map((t) => (t.id === taskId ? updateTaskState(t, updates) : t));
}

/**
 * 获取可运行的任务（pending 且没有未完成的依赖）
 * @param {TaskState[]} tasks
 * @returns {TaskState[]}
 */
export function getRunnableTasks(tasks) {
  const completedIds = new Set(
    tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
  );
  return tasks.filter((t) => {
    if (t.status !== TaskStatus.PENDING) return false;
    return t.blockedBy.every((depId) => completedIds.has(depId));
  });
}

/**
 * 计算整体进度
 * @param {TaskState[]} tasks
 * @returns {number} 0-100
 */
export function calculateOverallProgress(tasks) {
  if (tasks.length === 0) return 0;
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
  const running = tasks.filter((t) => t.status === TaskStatus.RUNNING);
  const runningProgress = running.reduce((sum, t) => sum + (t.progress || 0), 0) / 100;
  return Math.round(((completed + runningProgress) / total) * 100);
}

/**
 * 按状态分组任务
 * @param {TaskState[]} tasks
 * @returns {Record<string, TaskState[]>}
 */
export function groupTasksByStatus(tasks) {
  const groups = {};
  for (const status of Object.values(TaskStatus)) {
    groups[status] = [];
  }
  for (const task of tasks) {
    if (!groups[task.status]) {
      groups[task.status] = [];
    }
    groups[task.status].push(task);
  }
  return groups;
}

/**
 * 比较两个任务状态快照是否有变化
 * 用于决定是否需要发出新的 task_state 消息
 *
 * @param {TaskStateMessage} a
 * @param {TaskStateMessage} b
 * @returns {boolean} true 表示有变化
 */
export function hasTaskStateChanged(a, b) {
  if (!a || !b) return true;
  if (a.task_list_id !== b.task_list_id) return true;
  if (a.tasks.length !== b.tasks.length) return true;

  const taskMapA = new Map(a.tasks.map((t) => [t.id, t]));
  for (const taskB of b.tasks) {
    const taskA = taskMapA.get(taskB.id);
    if (!taskA) return true;
    if (
      taskA.status !== taskB.status ||
      taskA.progress !== taskB.progress ||
      taskA.activeForm !== taskB.activeForm
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 生成任务状态消息的稳定 key（用于去重）
 * @param {string} taskListId
 * @param {TaskState[]} tasks
 * @returns {string}
 */
export function getTaskStateSnapshotKey(taskListId, tasks) {
  const simplified = tasks
    .map((t) => `${t.id}:${t.status}:${t.progress}:${t.activeForm}`)
    .sort()
    .join('|');
  return `${taskListId}:${simplified}`;
}

export default {
  TaskStatus,
  TaskType,
  isTerminalTaskStatus,
  isActiveTaskStatus,
  createTaskState,
  createTaskStateMessage,
  updateTaskState,
  normalizeTaskState,
  findTask,
  updateTaskInList,
  getRunnableTasks,
  calculateOverallProgress,
  groupTasksByStatus,
  hasTaskStateChanged,
  getTaskStateSnapshotKey,
};
