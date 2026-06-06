/**
 * CronScheduler.js
 * 调度计划类和Cron调度器实现
 */

import { CronExpression } from './CronExpression.js';

/**
 * 调度计划类
 * 表示一个定时执行的计划
 */
export class Schedule {
  /**
   * 创建调度计划实例
   * @param {Object} data - 计划数据
   * @param {string} [data.id] - 计划唯一标识
   * @param {string} data.name - 计划名称
   * @param {string} data.cron - Cron表达式
   * @param {string} data.taskType - 任务类型
   * @param {Object} [data.taskPayload={}] - 任务载荷
   * @param {boolean} [data.enabled=true] - 是否启用
   * @param {number} [data.maxRuns=null] - 最大执行次数（null表示无限制）
   * @param {number} [data.runCount=0] - 已执行次数
   * @param {number} [data.lastRunAt=null] - 上次执行时间
   * @param {number} [data.nextRunAt=null] - 下次执行时间
   * @param {number} [data.createdAt] - 创建时间
   * @param {number} [data.updatedAt] - 更新时间
   */
  constructor(data) {
    const now = Date.now();

    this.id = data.id || this.#generateId();
    this.name = data.name;
    this.cron = data.cron;
    this.taskType = data.taskType;
    this.taskPayload = data.taskPayload || {};
    this.enabled = data.enabled !== undefined ? data.enabled : true;
    this.maxRuns = data.maxRuns !== undefined ? data.maxRuns : null;
    this.runCount = data.runCount || 0;
    this.lastRunAt = data.lastRunAt || null;
    this.nextRunAt = data.nextRunAt || null;
    this.createdAt = data.createdAt || now;
    this.updatedAt = data.updatedAt || now;

    // 初始化cron表达式解析器
    this.#cronExpression = new CronExpression(this.cron);

    // 如果没有下次执行时间，计算一个
    if (this.enabled && this.nextRunAt === null) {
      this.calculateNextRun();
    }
  }

  #cronExpression;

  /**
   * 生成唯一ID
   * @private
   * @returns {string}
   */
  #generateId() {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 计算下次执行时间
   * @param {Date} [fromDate] - 起始日期
   * @returns {number|null} 下次执行时间戳，如果没有则返回null
   */
  calculateNextRun(fromDate = new Date()) {
    if (!this.enabled) {
      this.nextRunAt = null;
      return null;
    }

    // 检查是否已达到最大执行次数
    if (this.maxRuns !== null && this.runCount >= this.maxRuns) {
      this.nextRunAt = null;
      return null;
    }

    const nextDate = this.#cronExpression.getNextDate(fromDate);
    this.nextRunAt = nextDate ? nextDate.getTime() : null;
    return this.nextRunAt;
  }

  /**
   * 检查是否应该在指定时间执行
   * @param {Date} now - 当前时间
   * @returns {boolean}
   */
  shouldRun(now = new Date()) {
    if (!this.enabled) {
      return false;
    }

    // 检查是否已达到最大执行次数
    if (this.maxRuns !== null && this.runCount >= this.maxRuns) {
      return false;
    }

    // 检查是否到达执行时间
    if (this.nextRunAt === null) {
      return false;
    }

    return now.getTime() >= this.nextRunAt;
  }

  /**
   * 记录执行
   * @returns {void}
   */
  recordRun() {
    const now = Date.now();
    this.lastRunAt = now;
    this.runCount++;
    this.updatedAt = now;

    // 重新计算下次执行时间
    this.calculateNextRun(new Date(now));
  }

  /**
   * 序列化为普通对象
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      cron: this.cron,
      taskType: this.taskType,
      taskPayload: this.taskPayload,
      enabled: this.enabled,
      maxRuns: this.maxRuns,
      runCount: this.runCount,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 从普通对象反序列化
   * @param {Object} json - 序列化的计划数据
   * @returns {Schedule}
   */
  static fromJSON(json) {
    return new Schedule(json);
  }
}

/**
 * Cron调度器类
 * 管理调度计划的增删改查和执行
 */
export class CronScheduler {
  /**
   * 创建调度器实例
   * @param {ScheduleStore} store - 调度计划存储实例
   */
  constructor(store) {
    this.store = store;
    this.#schedules = new Map();
    this.#listeners = new Map();
  }

  #schedules;
  #listeners;

  /**
   * 初始化调度器，从存储加载计划
   * @returns {Promise<void>}
   */
  async initialize() {
    const scheduleData = await this.store.load();

    for (const data of scheduleData) {
      const schedule = Schedule.fromJSON(data);
      // 重新计算下次执行时间
      if (schedule.enabled) {
        schedule.calculateNextRun();
      }
      this.#schedules.set(schedule.id, schedule);
    }
  }

  /**
   * 添加新计划
   * @param {Object} data - 计划数据
   * @returns {Promise<Schedule>}
   */
  async add(data) {
    // 验证cron表达式
    try {
      new CronExpression(data.cron);
    } catch (error) {
      throw new Error(`Invalid cron expression: ${error.message}`);
    }

    const schedule = new Schedule(data);

    // 存储计划
    this.#schedules.set(schedule.id, schedule);

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('schedule:added', schedule);

    return schedule;
  }

  /**
   * 根据ID获取计划
   * @param {string} id - 计划ID
   * @returns {Schedule|undefined}
   */
  get(id) {
    return this.#schedules.get(id);
  }

  /**
   * 更新计划
   * @param {string} id - 计划ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Schedule|null>}
   */
  async update(id, updates) {
    const schedule = this.#schedules.get(id);

    if (!schedule) {
      return null;
    }

    // 如果更新cron表达式，验证其有效性
    if (updates.cron && updates.cron !== schedule.cron) {
      try {
        new CronExpression(updates.cron);
      } catch (error) {
        throw new Error(`Invalid cron expression: ${error.message}`);
      }
      schedule.cron = updates.cron;
      // 重新计算下次执行时间
      schedule.calculateNextRun();
    }

    // 更新其他字段
    if (updates.name !== undefined) {
      schedule.name = updates.name;
    }

    if (updates.taskType !== undefined) {
      schedule.taskType = updates.taskType;
    }

    if (updates.taskPayload !== undefined) {
      schedule.taskPayload = { ...schedule.taskPayload, ...updates.taskPayload };
    }

    if (updates.maxRuns !== undefined) {
      schedule.maxRuns = updates.maxRuns;
    }

    schedule.updatedAt = Date.now();

    // 重新计算下次执行时间
    schedule.calculateNextRun();

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('schedule:updated', schedule);

    return schedule;
  }

  /**
   * 删除计划
   * @param {string} id - 计划ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const schedule = this.#schedules.get(id);

    if (!schedule) {
      return false;
    }

    this.#schedules.delete(id);

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('schedule:deleted', { id });

    return true;
  }

  /**
   * 启用/禁用计划
   * @param {string} id - 计划ID
   * @returns {Promise<Schedule|null>}
   */
  async toggle(id) {
    const schedule = this.#schedules.get(id);

    if (!schedule) {
      return null;
    }

    schedule.enabled = !schedule.enabled;
    schedule.updatedAt = Date.now();

    // 重新计算下次执行时间
    if (schedule.enabled) {
      schedule.calculateNextRun();
    } else {
      schedule.nextRunAt = null;
    }

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit(schedule.enabled ? 'schedule:enabled' : 'schedule:disabled', schedule);

    return schedule;
  }

  /**
   * 列出计划
   * @param {Object} options - 过滤选项
   * @param {boolean} [options.enabled] - 按启用状态过滤
   * @param {number} [options.limit] - 返回数量限制
   * @returns {Array<Schedule>}
   */
  list(options = {}) {
    let schedules = Array.from(this.#schedules.values());

    // 按启用状态过滤
    if (options.enabled !== undefined) {
      schedules = schedules.filter(s => s.enabled === options.enabled);
    }

    // 按下次执行时间排序（null排在最后）
    schedules.sort((a, b) => {
      if (a.nextRunAt === null && b.nextRunAt === null) {return 0;}
      if (a.nextRunAt === null) {return 1;}
      if (b.nextRunAt === null) {return -1;}
      return a.nextRunAt - b.nextRunAt;
    });

    // 限制数量
    if (options.limit && options.limit > 0) {
      schedules = schedules.slice(0, options.limit);
    }

    return schedules;
  }

  /**
   * 获取到期的计划
   * @param {Date} now - 当前时间
   * @returns {Array<Schedule>}
   */
  getDueSchedules(now = new Date()) {
    return Array.from(this.#schedules.values()).filter(schedule => schedule.shouldRun(now));
  }

  /**
   * 记录计划执行
   * @param {string} id - 计划ID
   * @returns {Promise<Schedule|null>}
   */
  async recordRun(id) {
    const schedule = this.#schedules.get(id);

    if (!schedule) {
      return null;
    }

    schedule.recordRun();

    // 持久化
    await this.#persist();

    // 触发事件
    this.#emit('schedule:executed', schedule);

    return schedule;
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }

    this.#listeners.get(event).add(callback);

    // 返回取消订阅函数
    return () => {
      this.#listeners.get(event)?.delete(callback);
    };
  }

  /**
   * 触发事件（私有方法）
   * @private
   * @param {string} event - 事件名称
   * @param {*} data - 事件数据
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event);

    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for '${event}':`, error);
        }
      }
    }
  }

  /**
   * 持久化计划数据（私有方法）
   * @private
   * @returns {Promise<void>}
   */
  async #persist() {
    const schedules = Array.from(this.#schedules.values()).map(s => s.toJSON());
    await this.store.save(schedules);
  }
}

export default CronScheduler;
