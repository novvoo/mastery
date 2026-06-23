/**
 * Agent Experience Memory
 * Agent 经验记忆系统
 *
 * 核心理念：Agent 从成功/失败中学习，在后续对话中复用经验
 * 类似于 Hermes 风格的程序化经验记忆
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ExperienceOutcome } from '../types/index.js';

const DEFAULT_MAX_EXPERIENCES = 500;
const DEFAULT_MAX_RELEVANT = 10;

export class ExperienceMemory {
  #experiences;
  #maxExperiences;
  #filePath;
  #dirty;

  constructor(options = {}) {
    this.#maxExperiences = options.maxExperiences || DEFAULT_MAX_EXPERIENCES;
    this.#filePath = options.filePath || null;
    this.#dirty = false;
    this.#experiences = [];

    if (this.#filePath) {
      this.#load();
    }
  }

  /**
   * 记录一条经验
   * @param {object} experience
   */
  record(experience) {
    const entry = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      task: experience.task || '',
      tool: experience.tool || '',
      outcome: experience.outcome || ExperienceOutcome.PARTIAL,
      lesson: experience.lesson || '',
      context: experience.context || '',
      tags: experience.tags || [],
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
    };

    this.#experiences.unshift(entry);

    // 限制总数
    if (this.#experiences.length > this.#maxExperiences) {
      this.#experiences = this.#experiences.slice(0, this.#maxExperiences);
    }

    this.#dirty = true;
    this.#save();

    return entry;
  }

  /**
   * 记录成功经验
   */
  recordSuccess(task, tool, lesson, context = '', tags = []) {
    return this.record({
      task,
      tool,
      outcome: ExperienceOutcome.SUCCESS,
      lesson,
      context,
      tags,
    });
  }

  /**
   * 记录失败经验
   */
  recordFailure(task, tool, lesson, context = '', tags = []) {
    return this.record({
      task,
      tool,
      outcome: ExperienceOutcome.FAILURE,
      lesson,
      context,
      tags,
    });
  }

  /**
   * 根据当前任务查找相关经验
   * @param {string} task - 当前任务描述
   * @param {object} options - 选项
   * @returns {Array<object>} 相关经验列表
   */
  recall(task, options = {}) {
    if (!task) {
      return [];
    }

    const maxResults = options.maxResults || DEFAULT_MAX_RELEVANT;
    const keywords = task
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // 计算每条经验的相关性分数
    const scored = this.#experiences.map((exp) => {
      let score = 0;
      const taskLower = task.toLowerCase();
      const expText =
        `${exp.task} ${exp.lesson} ${exp.context} ${exp.tags.join(' ')}`.toLowerCase();

      // 关键词匹配
      for (const kw of keywords) {
        if (expText.includes(kw)) {
          score += 2;
        }
      }

      // 工具名匹配
      if (exp.tool && taskLower.includes(exp.tool.toLowerCase())) {
        score += 3;
      }

      // 时间衰减（越新越相关）
      const ageHours = (Date.now() - exp.timestamp) / (1000 * 60 * 60);
      const timeDecay = Math.max(0, 1 - ageHours / (24 * 30)); // 30天衰减
      score *= timeDecay;

      // 成功经验加权
      if (exp.outcome === ExperienceOutcome.SUCCESS) {
        score *= 1.2;
      }

      // 使用频率加权
      score *= 1 + exp.usageCount * 0.1;

      return { ...exp, score };
    });

    // 排序并返回 top N
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * 标记经验被使用
   */
  markUsed(experienceId, success = true) {
    const exp = this.#experiences.find((e) => e.id === experienceId);
    if (exp) {
      exp.usageCount++;
      if (success) {
        exp.successCount++;
      } else {
        exp.failureCount++;
      }
      this.#dirty = true;
      this.#save();
    }
  }

  /**
   * 生成经验提示词片段
   * @param {string} currentTask - 当前任务
   * @returns {string} 经验提示词
   */
  buildExperiencePrompt(currentTask) {
    const relevant = this.recall(currentTask);
    if (relevant.length === 0) {
      return '';
    }

    const lines = ['[PAST EXPERIENCES - Learn from previous interactions:]'];

    for (const exp of relevant.slice(0, 5)) {
      const icon = exp.outcome === ExperienceOutcome.SUCCESS ? '✅' : '❌';
      lines.push(`- ${icon} [${exp.tool || 'general'}] ${exp.lesson}`);
      if (exp.context) {
        lines.push(`  Context: ${exp.context.substring(0, 100)}`);
      }
    }

    lines.push(
      '[Use these experiences to avoid repeating mistakes and leverage successful approaches.]',
    );
    return lines.join('\n');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.#experiences.length;
    const successes = this.#experiences.filter(
      (e) => e.outcome === ExperienceOutcome.SUCCESS,
    ).length;
    const failures = this.#experiences.filter(
      (e) => e.outcome === ExperienceOutcome.FAILURE,
    ).length;
    const used = this.#experiences.filter((e) => e.usageCount > 0).length;

    return {
      total,
      successes,
      failures,
      partial: total - successes - failures,
      used,
      unused: total - used,
    };
  }

  /**
   * 清除所有经验
   */
  clear() {
    this.#experiences = [];
    this.#dirty = true;
    this.#save();
  }

  /**
   * 从文件加载
   */
  #load() {
    try {
      if (this.#filePath && existsSync(this.#filePath)) {
        const data = readFileSync(this.#filePath, 'utf-8');
        this.#experiences = JSON.parse(data);
      }
    } catch (error) {
      console.error(`Failed to load experience memory: ${error.message}`);
      this.#experiences = [];
    }
  }

  /**
   * 保存到文件
   */
  #save() {
    if (!this.#filePath || !this.#dirty) {
      return;
    }

    try {
      const dir = resolve(this.#filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.#filePath, JSON.stringify(this.#experiences, null, 2), 'utf-8');
      this.#dirty = false;
    } catch (error) {
      console.error(`Failed to save experience memory: ${error.message}`);
    }
  }

  /**
   * 获取所有经验（用于调试）
   */
  getAll() {
    return [...this.#experiences];
  }
}

export default ExperienceMemory;
