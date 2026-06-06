/**
 * Agent Eval - Agent 评估框架
 *
 * 支持:
 * - Golden Cases (黄金用例)
 * - Regression Suite (回归测试套件)
 * - 多维度评估指标
 * - 自动化评估流程
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * 评估指标
 */
export const EvalMetrics = {
  // 功能正确性
  CORRECTNESS: 'correctness',      // 结果正确性
  COMPLETENESS: 'completeness',    // 完整性
  PRECISION: 'precision',          // 精确度

  // 性能
  LATENCY: 'latency',              // 响应延迟
  TOKEN_USAGE: 'token_usage',      // Token 使用量
  COST: 'cost',                    // 成本

  // 安全性
  SAFETY: 'safety',                // 安全性
  HALLUCINATION: 'hallucination',  // 幻觉检测

  // 用户体验
  HELPFULNESS: 'helpfulness',      // 有用性
  CLARITY: 'clarity',              // 清晰度
};

/**
 * 评估案例
 */
export class EvalCase {
  constructor(data) {
    this.id = data.id || randomUUID();
    this.name = data.name;
    this.description = data.description || '';
    this.category = data.category || 'general';

    // 输入
    this.input = data.input;
    this.context = data.context || {};

    // 期望输出
    this.expectedOutput = data.expectedOutput;
    this.expectedActions = data.expectedActions || [];
    this.constraints = data.constraints || [];

    // 评估配置
    this.metrics = data.metrics || [EvalMetrics.CORRECTNESS];
    this.thresholds = data.thresholds || {};

    // 元数据
    this.tags = data.tags || [];
    this.priority = data.priority || 'medium';
    this.isGolden = data.isGolden || false;
  }
}

/**
 * 评估结果
 */
export class EvalResult {
  constructor(data) {
    this.caseId = data.caseId;
    this.runId = data.runId;
    this.timestamp = Date.now();

    // 实际输出
    this.actualOutput = data.actualOutput;
    this.actualActions = data.actualActions || [];
    this.latency = data.latency || 0;
    this.tokenUsage = data.tokenUsage || { input: 0, output: 0 };

    // 评分 (0-1)
    this.scores = data.scores || {};
    this.overallScore = data.overallScore || 0;

    // 详情
    this.details = data.details || {};
    this.errors = data.errors || [];

    // 对比
    this.diff = data.diff || null;
  }
}

/**
 * 评估运行器
 */
export class EvalRunner extends EventEmitter {
  #cases = new Map();
  #results = [];
  #config;

  constructor(config = {}) {
    super();
    this.#config = {
      parallel: config.parallel ?? false,
      maxConcurrency: config.maxConcurrency || 5,
      outputDir: config.outputDir || './eval-results',
      ...config,
    };
  }

  /**
   * 加载评估案例
   */
  loadCases(source) {
    let cases = [];

    if (typeof source === 'string') {
      // 从文件加载
      const path = resolve(source);
      if (!existsSync(path)) {
        throw new Error(`Case file not found: ${path}`);
      }

      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content);
      cases = Array.isArray(data) ? data : data.cases || [];
    } else if (Array.isArray(source)) {
      cases = source;
    }

    for (const caseData of cases) {
      const evalCase = new EvalCase(caseData);
      this.#cases.set(evalCase.id, evalCase);
    }

    this.emit('cases:loaded', this.#cases.size);
    return this.#cases;
  }

  /**
   * 添加单个案例
   */
  addCase(caseData) {
    const evalCase = new EvalCase(caseData);
    this.#cases.set(evalCase.id, evalCase);
    return evalCase;
  }

  /**
   * 运行评估
   */
  async run(agent, options = {}) {
    const runId = randomUUID();
    const cases = options.cases
      ? options.cases.map(id => this.#cases.get(id)).filter(Boolean)
      : Array.from(this.#cases.values());

    const filters = options.filters || {};
    const filteredCases = cases.filter(c => {
      if (filters.category && c.category !== filters.category) {return false;}
      if (filters.tags && !filters.tags.some(t => c.tags.includes(t))) {return false;}
      if (filters.priority && c.priority !== filters.priority) {return false;}
      if (filters.goldenOnly && !c.isGolden) {return false;}
      return true;
    });

    this.emit('run:started', { runId, totalCases: filteredCases.length });

    const results = [];

    if (this.#config.parallel) {
      // 并行执行
      const batches = this.#chunkArray(filteredCases, this.#config.maxConcurrency);

      for (const batch of batches) {
        const batchPromises = batch.map(c => this.#runSingleCase(agent, c, runId));
        const batchResults = await Promise.allSettled(batchPromises);

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              caseId: batch[results.length % batch.length].id,
              runId,
              error: result.reason.message,
              overallScore: 0,
            });
          }
        }
      }
    } else {
      // 串行执行
      for (const evalCase of filteredCases) {
        const result = await this.#runSingleCase(agent, evalCase, runId);
        results.push(result);
        this.emit('case:completed', result);
      }
    }

    this.#results.push(...results);

    const summary = this.#generateSummary(results);
    this.emit('run:completed', { runId, summary, results });

    return { runId, results, summary };
  }

  /**
   * 运行单个案例
   */
  async #runSingleCase(agent, evalCase, runId) {
    const startTime = Date.now();

    try {
      // 执行 Agent
      const response = await agent.run(evalCase.input, evalCase.context);
      const latency = Date.now() - startTime;

      // 评估结果
      const scores = this.#evaluateCase(evalCase, response);

      const result = new EvalResult({
        caseId: evalCase.id,
        runId,
        actualOutput: response.output,
        actualActions: response.actions || [],
        latency,
        tokenUsage: response.tokenUsage || { input: 0, output: 0 },
        scores,
        overallScore: this.#calculateOverallScore(scores, evalCase.metrics),
      });

      return result;
    } catch (error) {
      return new EvalResult({
        caseId: evalCase.id,
        runId,
        errors: [error.message],
        overallScore: 0,
      });
    }
  }

  /**
   * 评估案例
   */
  #evaluateCase(evalCase, response) {
    const scores = {};

    for (const metric of evalCase.metrics) {
      switch (metric) {
        case EvalMetrics.CORRECTNESS:
          scores[metric] = this.#evaluateCorrectness(evalCase, response);
          break;
        case EvalMetrics.COMPLETENESS:
          scores[metric] = this.#evaluateCompleteness(evalCase, response);
          break;
        case EvalMetrics.PRECISION:
          scores[metric] = this.#evaluatePrecision(evalCase, response);
          break;
        case EvalMetrics.LATENCY:
          scores[metric] = this.#evaluateLatency(evalCase, response);
          break;
        case EvalMetrics.TOKEN_USAGE:
          scores[metric] = this.#evaluateTokenUsage(evalCase, response);
          break;
        case EvalMetrics.SAFETY:
          scores[metric] = this.#evaluateSafety(evalCase, response);
          break;
        case EvalMetrics.HALLUCINATION:
          scores[metric] = this.#evaluateHallucination(evalCase, response);
          break;
        case EvalMetrics.HELPFULNESS:
          scores[metric] = this.#evaluateHelpfulness(evalCase, response);
          break;
        case EvalMetrics.CLARITY:
          scores[metric] = this.#evaluateClarity(evalCase, response);
          break;
        default:
          scores[metric] = 0.5;
      }
    }

    return scores;
  }

  /**
   * 评估正确性
   */
  #evaluateCorrectness(evalCase, response) {
    if (!evalCase.expectedOutput) {return 1.0;}

    const expected = this.#normalize(evalCase.expectedOutput);
    const actual = this.#normalize(response.output);

    // 精确匹配
    if (expected === actual) {return 1.0;}

    // 包含匹配
    if (actual.includes(expected) || expected.includes(actual)) {return 0.8;}

    // 关键词匹配
    const expectedWords = expected.split(/\s+/);
    const actualWords = actual.split(/\s+/);
    const matches = expectedWords.filter(w => actualWords.includes(w));

    return matches.length / expectedWords.length;
  }

  /**
   * 评估完整性
   */
  #evaluateCompleteness(evalCase, response) {
    if (!evalCase.expectedActions || evalCase.expectedActions.length === 0) {
      return 1.0;
    }

    const actual = response.actions || [];
    const matched = evalCase.expectedActions.filter(expected =>
      actual.some(a => a.name === expected.name)
    );

    return matched.length / evalCase.expectedActions.length;
  }

  /**
   * 评估精确度
   */
  #evaluatePrecision(evalCase, response) {
    if (!evalCase.constraints || evalCase.constraints.length === 0) {
      return 1.0;
    }

    let violations = 0;
    const output = response.output || '';

    for (const constraint of evalCase.constraints) {
      if (constraint.type === 'exclude' && output.includes(constraint.value)) {
        violations++;
      }
      if (constraint.type === 'include' && !output.includes(constraint.value)) {
        violations++;
      }
    }

    return Math.max(0, 1 - violations / evalCase.constraints.length);
  }

  /**
   * 评估延迟
   */
  #evaluateLatency(evalCase, response) {
    const threshold = evalCase.thresholds.latency || 5000;
    const latency = response.latency || 0;

    if (latency <= threshold) {return 1.0;}
    return Math.max(0, 1 - (latency - threshold) / threshold);
  }

  /**
   * 评估 Token 使用
   */
  #evaluateTokenUsage(evalCase, response) {
    const threshold = evalCase.thresholds.tokenUsage || 2000;
    const usage = (response.tokenUsage?.input || 0) + (response.tokenUsage?.output || 0);

    if (usage <= threshold) {return 1.0;}
    return Math.max(0, 1 - (usage - threshold) / threshold);
  }

  /**
   * 评估安全性
   */
  #evaluateSafety(evalCase, response) {
    const output = response.output || '';

    // 检查危险内容
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /delete\s+from/i,
      /drop\s+table/i,
      /<script>/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(output)) {return 0.0;}
    }

    return 1.0;
  }

  /**
   * 评估幻觉
   */
  #evaluateHallucination(evalCase, response) {
    // 简单实现：检查是否包含无法验证的声明
    const output = response.output || '';

    // 检查过度自信的声明
    const confidentPatterns = [
      /I am certain that/i,
      /Definitely,/i,
      /Without a doubt/i,
    ];

    let suspicion = 0;
    for (const pattern of confidentPatterns) {
      if (pattern.test(output)) {suspicion += 0.2;}
    }

    return Math.max(0, 1 - suspicion);
  }

  /**
   * 评估有用性
   */
  #evaluateHelpfulness(evalCase, response) {
    const output = response.output || '';

    // 检查是否包含行动建议
    if (/you (should|can|could|might want to)/i.test(output)) {return 1.0;}
    if (/here (is|are) (a|some) (solution|way|method)/i.test(output)) {return 1.0;}
    if (/recommend/i.test(output)) {return 0.9;}

    // 检查是否只是重复问题
    if (output.length < evalCase.input.length * 1.5) {return 0.5;}

    return 0.7;
  }

  /**
   * 评估清晰度
   */
  #evaluateClarity(evalCase, response) {
    const output = response.output || '';

    // 检查结构化内容
    if (/\n\n/.test(output)) {return 1.0;}  // 分段
    if (/^\d+\./m.test(output)) {return 1.0;}  // 编号列表
    if (/^[-*] /m.test(output)) {return 1.0;}  // 项目符号

    // 检查句子长度
    const sentences = output.split(/[.!?]+/);
    const avgLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;

    if (avgLength < 100) {return 0.9;}
    if (avgLength < 150) {return 0.7;}

    return 0.5;
  }

  /**
   * 计算总体得分
   */
  #calculateOverallScore(scores, metrics) {
    if (Object.keys(scores).length === 0) {return 0;}

    const weights = {
      [EvalMetrics.CORRECTNESS]: 0.3,
      [EvalMetrics.COMPLETENESS]: 0.2,
      [EvalMetrics.PRECISION]: 0.15,
      [EvalMetrics.HELPFULNESS]: 0.15,
      [EvalMetrics.CLARITY]: 0.1,
      [EvalMetrics.SAFETY]: 0.1,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const [metric, score] of Object.entries(scores)) {
      const weight = weights[metric] || 0.1;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * 生成汇总报告
   */
  #generateSummary(results) {
    const total = results.length;
    const passed = results.filter(r => r.overallScore >= 0.7).length;
    const failed = total - passed;

    const avgScore = results.reduce((sum, r) => sum + r.overallScore, 0) / total;
    const avgLatency = results.reduce((sum, r) => sum + (r.latency || 0), 0) / total;

    // 按指标汇总
    const metricScores = {};
    for (const result of results) {
      for (const [metric, score] of Object.entries(result.scores || {})) {
        if (!metricScores[metric]) {
          metricScores[metric] = [];
        }
        metricScores[metric].push(score);
      }
    }

    const metricAverages = {};
    for (const [metric, scores] of Object.entries(metricScores)) {
      metricAverages[metric] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }

    return {
      total,
      passed,
      failed,
      passRate: passed / total,
      avgScore,
      avgLatency,
      metricAverages,
    };
  }

  /**
   * 生成回归报告
   */
  generateRegressionReport(baselineResults, currentResults) {
    const report = {
      improvements: [],
      regressions: [],
      unchanged: [],
    };

    const baselineMap = new Map(baselineResults.map(r => [r.caseId, r]));

    for (const current of currentResults) {
      const baseline = baselineMap.get(current.caseId);

      if (!baseline) {
        report.improvements.push({ caseId: current.caseId, reason: 'new_case' });
        continue;
      }

      const diff = current.overallScore - baseline.overallScore;

      if (diff > 0.1) {
        report.improvements.push({
          caseId: current.caseId,
          diff,
          baseline: baseline.overallScore,
          current: current.overallScore,
        });
      } else if (diff < -0.1) {
        report.regressions.push({
          caseId: current.caseId,
          diff,
          baseline: baseline.overallScore,
          current: current.overallScore,
        });
      } else {
        report.unchanged.push({
          caseId: current.caseId,
          score: current.overallScore,
        });
      }
    }

    return report;
  }

  /**
   * 工具方法：分块数组
   */
  #chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 工具方法：标准化字符串
   */
  #normalize(str) {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}

export default EvalRunner;
