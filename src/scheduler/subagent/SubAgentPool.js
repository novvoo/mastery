/**
 * SubAgentPool.js
 * 子代理池实现 - 管理多个子代理的生命周期
 * 增强版：支持自动清理、记忆共享、嵌套创建
 */

import { SubAgent, SubAgentStatus } from './SubAgent.js';
import { MemoryManager } from '../../memory/memory-manager.js';
import { rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const TEMP_DIR_CLEANUP_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24小时后清理旧临时目录

/**
 * 子代理池类
 * 管理多个SubAgent实例的创建、执行和清理
 * 增强功能：
 * 1. 自动定时清理已完成代理
 * 2. 支持记忆共享配置
 * 3. 支持SubAgent嵌套创建
 * 4. 自动清理过期临时目录
 */
export class SubAgentPool {
  // 私有字段
  #agents;
  #modelProvider;
  #toolRegistry;
  #memoryManager;
  #config;
  #messageBus;
  #maxAgents;
  #autoCleanupInterval;    // 自动清理定时器
  #autoCleanupEnabled;     // 是否启用自动清理
  #autoCleanupIntervalMs;  // 自动清理间隔
  #enableMemoryShare;      // 是否启用记忆共享
  #tempDirs;               // 跟踪创建的临时目录

  /**
   * 创建子代理池实例
   * @param {Object} modelProvider - 模型提供者实例
   * @param {Object} toolRegistry - 工具注册表实例
   * @param {Object} memoryManager - 内存管理器实例
   * @param {Object} config - 配置对象
   * @param {Object} options - 可选参数
   * @param {number} [options.maxAgents=10] - 最大代理数量
   * @param {MessageBus} [options.messageBus] - 消息总线实例
   * @param {boolean} [options.autoCleanup=true] - 是否启用自动清理
   * @param {number} [options.autoCleanupIntervalMs=30000] - 自动清理间隔（默认30秒）
   * @param {boolean} [options.enableMemoryShare=true] - 是否启用父子记忆共享
   */
  constructor(modelProvider, toolRegistry, memoryManager, config, options = {}) {
    this.#agents = new Map();
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#memoryManager = memoryManager;
    this.#config = config;
    this.#maxAgents = options.maxAgents || 10;
    this.#messageBus = options.messageBus || null;
    this.#autoCleanupEnabled = options.autoCleanup !== false; // 默认启用
    this.#autoCleanupIntervalMs = options.autoCleanupIntervalMs || 30000; // 默认30秒
    this.#enableMemoryShare = options.enableMemoryShare !== false; // 默认启用
    this.#autoCleanupInterval = null;
    this.#tempDirs = new Map(); // 跟踪临时目录: dirPath -> creationTimestamp

    // 如果启用自动清理，启动定时器
    if (this.#autoCleanupEnabled) {
      this.#startAutoCleanup();
    }
  }

  /**
   * 启动自动清理定时器
   * @private
   */
  #startAutoCleanup() {
    if (this.#autoCleanupInterval) {
      return; // 已经在运行
    }

    this.#autoCleanupInterval = setInterval(() => {
      this.cleanup().then(count => {
        if (count > 0) {
          console.log(`Auto-cleanup: removed ${count} completed/failed/stopped agents`);
        }
      }).catch(error => {
        console.error('Auto-cleanup error:', error);
      });
    }, this.#autoCleanupIntervalMs);

    console.log(`Auto-cleanup enabled (interval: ${this.#autoCleanupIntervalMs}ms)`);
  }

  /**
   * 停止自动清理定时器
   * @private
   */
  #stopAutoCleanup() {
    if (this.#autoCleanupInterval) {
      clearInterval(this.#autoCleanupInterval);
      this.#autoCleanupInterval = null;
      console.log('Auto-cleanup stopped');
    }
  }

  /**
   * 创建新的子代理
   * @param {Object} options - 创建选项
   * @param {string} [options.id] - 代理ID（自动生成如果没有提供）
   * @param {string} [options.parentId] - 父代理ID
   * @param {string} [options.workingDir] - 工作目录（用于创建独立的MemoryManager）
   * @param {Object} [options.parentMemory] - 父代理记忆（用于共享）
   * @param {Object} [options.sharedContext] - 共享上下文数据
   * @returns {SubAgent} 创建的子代理
   * @throws {Error} 如果达到最大代理数量限制
   */
  create(options = {}) {
    // 检查最大代理数量限制
    if (this.#agents.size >= this.#maxAgents) {
      throw new Error(
        `Maximum number of agents (${this.#maxAgents}) reached. ` +
        `Please remove some agents before creating new ones.`
      );
    }

    // 生成代理ID
    const agentId = options.id || this.#generateId();

    // 检查ID是否已存在
    if (this.#agents.has(agentId)) {
      throw new Error(`Agent with ID '${agentId}' already exists`);
    }

    // 创建独立的MemoryManager
    const subMemoryManager = this.#createSubMemoryManager(options.workingDir);

    // 准备父记忆（如果启用记忆共享且提供了父记忆）
    let parentMemory = null;
    if (this.#enableMemoryShare) {
      // 优先使用传入的parentMemory
      if (options.parentMemory) {
        parentMemory = options.parentMemory;
      } else if (options.parentId) {
        // 尝试从父代理获取记忆快照
        const parentAgent = this.#agents.get(options.parentId);
        if (parentAgent && parentAgent.memoryManager) {
          const ctx = parentAgent.memoryManager.context;
          parentMemory = {
            keyDecisions: ctx?.keyDecisions || [],
            constraints: ctx?.constraints || [],
            fileMap: ctx?.fileMap || {},
            currentTask: ctx?.currentTask
          };
        }
      }
    }

    // 创建子代理配置
    const subConfig = {
      ...this.#config,
      workingDirectory: options.workingDir || this.#config.workingDirectory
    };

    // 创建子代理（传递SubAgentPool引用以支持嵌套创建）
    const subAgent = new SubAgent(
      agentId,
      this.#modelProvider,
      this.#toolRegistry,
      subMemoryManager,
      subConfig,
      {
        parentId: options.parentId || null,
        messageBus: this.#messageBus,
        subAgentPool: this,  // 传递pool以支持嵌套创建
        parentMemory: parentMemory,
        sharedContext: options.sharedContext || {}
      }
    );

    // 存储到池中
    this.#agents.set(agentId, subAgent);

    // 如果消息总线存在，订阅消息
    if (this.#messageBus) {
      this.#messageBus.subscribe(agentId, (message) => {
        subAgent.receiveMessage(message);
      });
    }

    return subAgent;
  }

  /**
   * 根据ID获取子代理
   * @param {string} id - 代理ID
   * @returns {SubAgent|undefined} 子代理实例或undefined
   */
  get(id) {
    return this.#agents.get(id);
  }

  /**
   * 列出所有代理的统计信息
   * @returns {Array<Object>} 代理统计信息数组
   */
  list() {
    return Array.from(this.#agents.values()).map(agent => agent.getStats());
  }

  /**
   * 移除子代理
   * @param {string} id - 代理ID
   * @returns {Promise<boolean>} 是否成功移除
   */
  async remove(id) {
    const agent = this.#agents.get(id);

    if (!agent) {
      return false;
    }

    // 停止代理
    await agent.stop();

    // 释放资源
    agent.dispose();

    // 从池中移除
    this.#agents.delete(id);

    return true;
  }

  /**
   * 停止所有代理
   * @returns {Promise<void>}
   */
  async stopAll() {
    const stopPromises = [];

    for (const agent of this.#agents.values()) {
      stopPromises.push(agent.stop());
    }

    await Promise.all(stopPromises);
  }

  /**
   * 清理已完成的代理
   * @param {Object} options - 清理选项
   * @param {boolean} [options.includeFailed=true] - 是否包含失败的代理
   * @param {boolean} [options.includeStopped=true] - 是否包含停止的代理
   * @returns {Promise<number>} 清理的代理数量
   */
  async cleanup(options = {}) {
    const { includeFailed = true, includeStopped = true } = options;
    const toRemove = [];

    for (const [id, agent] of this.#agents.entries()) {
      const status = agent.status;
      if (
        status === SubAgentStatus.COMPLETED ||
        (includeFailed && status === SubAgentStatus.FAILED) ||
        (includeStopped && status === SubAgentStatus.STOPPED)
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.remove(id);
    }

    // 同时清理过期临时目录
    await this.#cleanupExpiredTempDirs();

    return toRemove.length;
  }

  /**
   * 获取统计信息
   * @returns {Object} 各状态的代理数量
   */
  getStats() {
    const stats = {
      total: this.#agents.size,
      idle: 0,
      running: 0,
      completed: 0,
      failed: 0,
      stopped: 0
    };

    for (const agent of this.#agents.values()) {
      const status = agent.status;
      if (stats[status] !== undefined) {
        stats[status]++;
      }
    }

    return stats;
  }

  /**
   * 获取自动清理状态
   * @returns {Object}
   */
  getAutoCleanupStatus() {
    return {
      enabled: this.#autoCleanupEnabled,
      running: this.#autoCleanupInterval !== null,
      intervalMs: this.#autoCleanupIntervalMs
    };
  }

  /**
   * 启用/禁用自动清理
   * @param {boolean} enabled - 是否启用
   * @param {number} [intervalMs] - 可选的新间隔时间
   */
  setAutoCleanup(enabled, intervalMs) {
    if (intervalMs && intervalMs > 0) {
      this.#autoCleanupIntervalMs = intervalMs;
    }

    if (enabled && !this.#autoCleanupInterval) {
      this.#autoCleanupEnabled = true;
      this.#startAutoCleanup();
    } else if (!enabled && this.#autoCleanupInterval) {
      this.#autoCleanupEnabled = false;
      this.#stopAutoCleanup();
    }
  }

  /**
   * 创建子内存管理器
   * @private
   * @param {string} workingDir - 工作目录
   * @returns {MemoryManager} 新的内存管理器实例
   */
  #createSubMemoryManager(workingDir) {
    const dir = workingDir || this.#config.workingDirectory;
    
    // 创建子目录用于隔离
    const subDir = `${dir}/.subagents/${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 跟踪临时目录
    this.#tempDirs.set(subDir, Date.now());
    
    return new MemoryManager(subDir);
  }

  /**
   * 清理过期的临时目录
   * @private
   */
  async #cleanupExpiredTempDirs() {
    const now = Date.now();
    const toRemove = [];
    
    for (const [dirPath, createdAt] of this.#tempDirs) {
      if (now - createdAt > TEMP_DIR_CLEANUP_THRESHOLD_MS) {
        toRemove.push(dirPath);
      }
    }
    
    for (const dirPath of toRemove) {
      try {
        if (existsSync(dirPath)) {
          await rm(dirPath, { recursive: true, force: true });
          console.log(`SubAgentPool: cleaned up expired temp dir ${dirPath}`);
        }
        this.#tempDirs.delete(dirPath);
      } catch (error) {
        console.warn(`SubAgentPool: failed to clean up temp dir ${dirPath}:`, error);
      }
    }
  }

  /**
   * 生成唯一ID
   * @private
   * @returns {string}
   */
  #generateId() {
    return `subagent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 释放所有资源
   */
  dispose() {
    // 停止自动清理
    this.#stopAutoCleanup();

    // 停止所有代理
    this.stopAll();

    // 释放所有代理资源
    for (const agent of this.#agents.values()) {
      agent.dispose();
    }

    // 清空池
    this.#agents.clear();
  }
}

export default SubAgentPool;
