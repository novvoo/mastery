/**
 * Termination Detector — 终止响应检测与停滞检测
 *
 * 职责：
 *   - 检测 LLM 是否已输出最终答案（FINAL_ANSWER 等关键字）
 *   - 提取与规范化最终答案（处理 JSON 包装形式）
 *   - 停滞检测滑动窗口：工具类型重复、零修改停滞
 *   - 进度检查点：定期注入进度总结
 *
 * 原为 agent.js 内联的 #isTermination/#normalizeFinalAnswer/#injectStagnationNudge 等方法。
 */

import { TERMINATION_KEYWORDS } from '../../../utils/patterns.js';
import {
  STAGNATION_LOOKBACK,
  STAGNATION_SAME_TOOL_LIMIT,
  STAGNATION_NO_MUTATION_LIMIT,
  MAX_STAGNATION_NUDGES,
  PROGRESS_CHECKPOINT_INTERVAL,
} from '../../agent/constants.js';

// ============== 终止检测 ==============

export function isTermination(response) {
  if (!response) {
    return false;
  }
  if (TERMINATION_KEYWORDS.some((keyword) => response.includes(keyword))) {
    return true;
  }
  if (response.trim().length === 0) {
    return true;
  }
  return false;
}

export function extractFinalAnswer(response) {
  if (!response) {
    return '';
  }
  for (const keyword of TERMINATION_KEYWORDS) {
    const idx = response.indexOf(keyword);
    if (idx !== -1) {
      return response.substring(idx + keyword.length).trim();
    }
  }
  return response.trim();
}

export function normalizeFinalAnswer(response) {
  const text = String(response || '').trim();
  if (!text) {
    return text;
  }

  const isToolCallFormat = /<action\b|<tool_call\b|<function_call\b|<tool_code\b|<invoke\b/i.test(
    text,
  );
  if (isToolCallFormat) {
    const trimmedNoTags = text
      .replace(/<\/?(?:action|tool_call|function_call|tool_code|invoke)\b[^>]*>/gi, '')
      .trim();
    if (trimmedNoTags.length < text.length * 0.5) {
      return '';
    }
  }

  const parsed = safeParseJSON(text);
  const doneText = parsed?.action?.done?.text || parsed?.done?.text;
  if (typeof doneText === 'string' && doneText.trim()) {
    return doneText.trim();
  }

  const directText = parsed?.text || parsed?.answer || parsed?.final_answer;
  if (typeof directText === 'string' && directText.trim()) {
    return directText.trim();
  }

  return text;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

// ============== 停滞检测器 ==============

export class StagnationDetector {
  #window = [];
  #lastMutationIteration = -1;
  #lastStagnationNudge = 0;
  #consecutiveSameTool = 0;
  #activeProgressCheckpoints = 0;

  reset() {
    this.#window = [];
    this.#lastMutationIteration = -1;
    this.#lastStagnationNudge = 0;
    this.#consecutiveSameTool = 0;
    this.#activeProgressCheckpoints = 0;
  }

  recordTool(toolName, args, iteration, isMutationPredicate) {
    const isMutation =
      typeof isMutationPredicate === 'function' ? isMutationPredicate(toolName, args) : false;
    this.#window.push({ toolName, iteration, isMutation });
    if (this.#window.length > STAGNATION_LOOKBACK) {
      this.#window.shift();
    }
    if (isMutation) {
      this.#lastMutationIteration = iteration;
    }
  }

  /** 检查并返回需要注入的 nudge 消息；返回 null 表示无需 nudge */
  nudge(iteration, maxIterations, { planSummary } = {}) {
    if (iteration < 3) {
      return null;
    }

    // 1. 进度检查点
    if (iteration % PROGRESS_CHECKPOINT_INTERVAL === 0) {
      this.#activeProgressCheckpoints++;
      const planStatus = planSummary || 'not available';
      const hasWritten = this.#window.some((t) => t.isMutation);
      return {
        type: 'progress_checkpoint',
        message:
          `[Progress checkpoint @iter ${iteration}/${maxIterations}]\n` +
          `Plan status:\n${planStatus}\n` +
          `${
            hasWritten
              ? 'You have made code changes — verify them and complete.'
              : 'No code modifications yet. If the target is clear, apply the smallest scoped edit; otherwise gather the single missing fact, replan, ask_user, or explain the blocker.'
          }`,
      };
    }

    // 2. 评估是否需要降级预算（超过最大 nudge 次数后）
    const shouldDegradeBudget =
      (this.#consecutiveSameTool >= STAGNATION_SAME_TOOL_LIMIT ||
        this.#window.length >= STAGNATION_LOOKBACK) &&
      this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT < iteration &&
      this.#lastStagnationNudge >= MAX_STAGNATION_NUDGES;

    // 3. 相同工具类型连续重复
    const window = this.#window;
    if (window.length >= STAGNATION_SAME_TOOL_LIMIT) {
      const recent = window.slice(-STAGNATION_SAME_TOOL_LIMIT);
      const uniqueTools = new Set(recent.map((t) => t.toolName));
      if (uniqueTools.size <= 2 && window.every((t) => !t.isMutation)) {
        this.#lastStagnationNudge++;
        const toolList = [...uniqueTools].join(', ');
        this.#consecutiveSameTool = 0;
        return {
          type: 'same_tool_repetition',
          message:
            `[Progress check] You have called ${toolList} repeatedly for ${STAGNATION_SAME_TOOL_LIMIT} consecutive iterations with zero code modifications.\n` +
            `Stop repeating the same exploration. Take one concrete evidence-based step: scoped edit, focused read/diagnostic for one missing fact, change_plan, ask_user, or FINAL_ANSWER with the blocker.`,
          shouldDegradeBudget,
        };
      }
    }

    // 4. 长时间无修改操作
    if (
      this.#lastMutationIteration > 0 &&
      this.#lastMutationIteration + STAGNATION_NO_MUTATION_LIMIT <= iteration &&
      window.length >= STAGNATION_NO_MUTATION_LIMIT
    ) {
      this.#lastStagnationNudge++;
      this.#lastMutationIteration = iteration;
      const planStatus = planSummary || 'not available';
      return {
        type: 'no_mutation_stagnation',
        message:
          `[Progress check] No file modifications in ${STAGNATION_NO_MUTATION_LIMIT}+ iterations.\n` +
          `Plan status:\n${planStatus}\n` +
          `Choose the next narrow action from the evidence: edit if ready, gather one missing fact, run a focused diagnostic, replan/ask_user, or FINAL_ANSWER with the blocker.`,
        shouldDegradeBudget,
      };
    }

    // 5. 探索阶段停滞检测：连续多次调用探索工具但未推进到验证阶段
    const explorationTools = new Set([
      'read_file',
      'list_dir',
      'glob',
      'search',
      'search_codebase',
      'semantic_search',
      'grep_search',
      'file_search',
    ]);
    const recent = window.slice(-5);
    const allExploration =
      recent.length >= 5 && recent.every((t) => explorationTools.has(t.toolName));
    if (allExploration) {
      this.#lastStagnationNudge++;
      return {
        type: 'exploration_stagnation',
        message:
          `[Progress check] You have been exploring for ${recent.length}+ consecutive iterations.\n` +
          `If this is a verification/validation task, you should now execute verification commands (e.g., npm test, npm run build).\n` +
          `If you have gathered sufficient context, either implement the fix or provide FINAL_ANSWER.\n` +
          `Plan status:\n${planSummary || 'not available'}`,
        shouldDegradeBudget,
      };
    }

    return null;
  }

  getState() {
    return {
      windowSize: this.#window.length,
      lastMutationIteration: this.#lastMutationIteration,
      lastStagnationNudge: this.#lastStagnationNudge,
      activeProgressCheckpoints: this.#activeProgressCheckpoints,
    };
  }
}

// ============== 导出工厂 ==============

export const Termination = {
  isTermination,
  extractFinalAnswer,
  normalizeFinalAnswer,
};

export default StagnationDetector;
