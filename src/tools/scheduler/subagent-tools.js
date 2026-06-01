/**
 * subagent-tools.js
 * 子代理管理工具定义
 * 增强版：支持同步/异步模式、结果回调、超时控制
 */

import { ToolCategory } from '../../core/types.js';

/**
 * 创建子代理管理工具
 * @param {SchedulerEngine} schedulerEngine - 调度引擎实例
 * @returns {Array<Object>} 工具定义数组
 */
export function createSubAgentTools(schedulerEngine) {
  const subAgentPool = schedulerEngine.getSubAgentPool();
  const taskQueue = schedulerEngine.getTaskQueue();
  const messageBus = schedulerEngine.getMessageBus();

  // 存储等待结果的回调
  const pendingResults = new Map();

  // 监听任务完成事件
  taskQueue.on('task:updated', (task) => {
    if (task.status === 'completed' || task.status === 'failed') {
      const callbacks = pendingResults.get(task.id);
      if (callbacks) {
        if (task.status === 'completed') {
          callbacks.resolve({
            success: true,
            taskId: task.id,
            result: task.result
          });
        } else {
          callbacks.reject(new Error(task.error || 'Task failed'));
        }
        pendingResults.delete(task.id);
      }
    }
  });

  return [
    {
      name: 'subagent_spawn',
      description: `创建任务并生成子代理执行。支持同步/异步模式：
- 同步模式（waitForCompletion=true）：等待任务完成并返回结果
- 异步模式（waitForCompletion=false）：立即返回任务ID，后续通过subagent_get_result查询结果
- 支持超时控制和结果回调`,
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          taskType: {
            type: 'string',
            description: '任务类型'
          },
          taskPayload: {
            type: 'object',
            description: '任务载荷数据'
          },
          maxIterations: {
            type: 'number',
            description: '最大迭代次数',
            default: 10
          },
          waitForCompletion: {
            type: 'boolean',
            description: '是否等待任务完成（同步模式）',
            default: false
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），仅在同步模式下有效',
            default: 60000
          },
          priority: {
            type: 'number',
            description: '任务优先级（0-4，数值越小优先级越高）',
            default: 1
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: '依赖的任务ID列表，这些任务完成后才会执行',
            default: []
          },
          sharedContext: {
            type: 'object',
            description: '共享上下文数据，会传递给子代理',
            default: {}
          }
        },
        required: ['taskType', 'taskPayload']
      },
      handler: async ({ 
        taskType, 
        taskPayload, 
        maxIterations = 10, 
        waitForCompletion = false,
        timeout = 60000,
        priority = 1,
        dependsOn = [],
        sharedContext = {}
      }) => {
        try {
          // 创建任务（支持依赖）
          const task = await taskQueue.add({
            type: taskType,
            payload: taskPayload,
            priority: priority,
            dependsOn: dependsOn.length > 0 ? dependsOn : undefined
          });

          // 同步模式：等待任务完成
          if (waitForCompletion) {
            return new Promise((resolve, reject) => {
              // 存储回调
              pendingResults.set(task.id, { resolve, reject });

              // 设置超时
              const timeoutId = setTimeout(() => {
                pendingResults.delete(task.id);
                reject(new Error(`Task ${task.id} timeout after ${timeout}ms`));
              }, timeout);

              // 替换resolve/reject以清除超时
              const originalResolve = resolve;
              const originalReject = reject;
              pendingResults.set(task.id, {
                resolve: (result) => {
                  clearTimeout(timeoutId);
                  originalResolve(result);
                },
                reject: (error) => {
                  clearTimeout(timeoutId);
                  originalReject(error);
                }
              });

              // 启动子代理执行
              setImmediate(async () => {
                try {
                  // 创建子代理（传递共享上下文）
                  const subAgent = subAgentPool.create({
                    parentId: 'scheduler',
                    sharedContext: sharedContext
                  });

                  // 更新任务状态为运行中
                  await taskQueue.update(task.id, { status: 'running' });

                  // 运行任务
                  const result = await subAgent.run(task, { maxIterations, timeout });

                  // 清理子代理 before publishing completion so synchronous
                  // waiters observe a settled task and an already-clean pool.
                  await subAgentPool.remove(subAgent.id);

                  // 更新任务状态为完成
                  await taskQueue.update(task.id, {
                    status: 'completed',
                    result: result
                  });
                } catch (error) {
                  // 更新任务状态为失败
                  await taskQueue.update(task.id, {
                    status: 'failed',
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              });
            });
          }

          // 异步模式：立即返回任务信息
          setImmediate(async () => {
            try {
              // 创建子代理（传递共享上下文）
              const subAgent = subAgentPool.create({
                parentId: 'scheduler',
                sharedContext: sharedContext
              });

              // 更新任务状态为运行中
              await taskQueue.update(task.id, { status: 'running' });

              // 运行任务
              const result = await subAgent.run(task, { maxIterations, timeout });

              // 清理子代理 before publishing completion so get_result waiters
              // observe a settled task and an already-clean pool.
              await subAgentPool.remove(subAgent.id);

              // 更新任务状态为完成
              await taskQueue.update(task.id, {
                status: 'completed',
                result: result
              });

              // 发送消息通知（如果有消息总线）
              if (messageBus) {
                messageBus.broadcast('scheduler', 'task:completed', {
                  taskId: task.id,
                  type: taskType,
                  result: result
                });
              }
            } catch (error) {
              // 更新任务状态为失败
              await taskQueue.update(task.id, {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error)
              });

              // 发送失败通知
              if (messageBus) {
                messageBus.broadcast('scheduler', 'task:failed', {
                  taskId: task.id,
                  type: taskType,
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          });

          return {
            success: true,
            message: 'SubAgent spawned asynchronously',
            mode: 'async',
            task: task.toJSON()
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },
    {
      name: 'subagent_get_result',
      description: '获取异步任务的执行结果。如果任务未完成，可选择等待或立即返回当前状态',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '任务ID'
          },
          wait: {
            type: 'boolean',
            description: '如果任务未完成，是否等待',
            default: false
          },
          timeout: {
            type: 'number',
            description: '等待超时时间（毫秒）',
            default: 30000
          }
        },
        required: ['taskId']
      },
      handler: async ({ taskId, wait = false, timeout = 30000 }) => {
        try {
          const task = taskQueue.get(taskId);
          
          if (!task) {
            return {
              success: false,
              error: `Task ${taskId} not found`
            };
          }

          // 如果任务已完成或失败，直接返回结果
          if (task.status === 'completed') {
            return {
              success: true,
              status: 'completed',
              result: task.result
            };
          }

          if (task.status === 'failed') {
            return {
              success: false,
              status: 'failed',
              error: task.error
            };
          }

          // 如果不等待，返回当前状态
          if (!wait) {
            return {
              success: true,
              status: task.status,
              message: `Task is ${task.status}. Use wait=true to wait for completion.`
            };
          }

          // 等待任务完成
          return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              pendingResults.delete(taskId);
              reject(new Error(`Timeout waiting for task ${taskId} after ${timeout}ms`));
            }, timeout);

            pendingResults.set(taskId, {
              resolve: (result) => {
                clearTimeout(timeoutId);
                resolve(result);
              },
              reject: (error) => {
                clearTimeout(timeoutId);
                reject(error);
              }
            });
          });
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },
    {
      name: 'subagent_list',
      description: '列出所有活跃的子代理',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          includeStats: {
            type: 'boolean',
            description: '是否包含统计信息',
            default: true
          }
        }
      },
      handler: async ({ includeStats = true }) => {
        const agents = subAgentPool.list();
        const result = {
          success: true,
          count: agents.length,
          agents: agents
        };

        if (includeStats) {
          result.stats = subAgentPool.getStats();
          result.autoCleanup = subAgentPool.getAutoCleanupStatus?.();
        }

        return result;
      }
    },
    {
      name: 'subagent_stop',
      description: '停止并移除子代理',
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '子代理ID'
          }
        },
        required: ['id']
      },
      handler: async ({ id }) => {
        try {
          const result = await subAgentPool.remove(id);
          if (!result) {
            return {
              success: false,
              error: `SubAgent ${id} not found`
            };
          }
          return {
            success: true,
            message: `SubAgent ${id} stopped and removed successfully`
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },
    {
      name: 'subagent_create_nested',
      description: `在当前SubAgent中创建嵌套的子代理。支持多级嵌套（A创建B，B创建C）。
注意：此工具只能在SubAgent内部调用，需要SubAgent具有subAgentPool引用`,
      category: ToolCategory.SYSTEM,
      parameters: {
        type: 'object',
        properties: {
          taskType: {
            type: 'string',
            description: '任务类型'
          },
          taskPayload: {
            type: 'object',
            description: '任务载荷数据'
          },
          maxIterations: {
            type: 'number',
            description: '最大迭代次数',
            default: 10
          },
          inheritMemory: {
            type: 'boolean',
            description: '是否继承父代理的记忆',
            default: true
          },
          sharedContext: {
            type: 'object',
            description: '额外共享上下文',
            default: {}
          }
        },
        required: ['taskType', 'taskPayload']
      },
      handler: async ({ 
        taskType, 
        taskPayload, 
        maxIterations = 10,
        inheritMemory = true,
        sharedContext = {}
      }, ctx) => {
        try {
          // 检查是否在SubAgent上下文中
          if (!ctx || !ctx.subAgent) {
            return {
              success: false,
              error: 'This tool can only be called within a SubAgent context'
            };
          }

          const parentSubAgent = ctx.subAgent;

          // 使用SubAgent的原生嵌套API创建子代理
          const nestedSubAgent = parentSubAgent.createSubAgent({
            inheritMemory,
            sharedContext
          });

          // 创建任务
          const task = await taskQueue.add({
            type: taskType,
            payload: taskPayload,
            priority: 1,
            parentId: parentSubAgent.id
          });

          // 异步运行嵌套代理
          setImmediate(async () => {
            try {
              await taskQueue.update(task.id, { status: 'running' });
              const result = await nestedSubAgent.run(task, { maxIterations });
              await taskQueue.update(task.id, {
                status: 'completed',
                result: result
              });
            } catch (error) {
              await taskQueue.update(task.id, {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error)
              });
            }
          });

          return {
            success: true,
            message: 'Nested SubAgent created successfully',
            nestedAgentId: nestedSubAgent.id,
            task: task.toJSON()
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    }
  ];
}

export default createSubAgentTools;
