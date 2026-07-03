/**
 * IntentClassifier — 统一路由入口（合并了原 TaskClassifier）
 *
 * 职责：
 *   1. LLM 意图识别 → intent（recommendedTools, firstActionHint 等）
 *   2. 任务分类 → taskProfile（isCodingTask, isModificationTask, riskLevel 等）
 *
 * 原先两步路由：Intent → TaskClassifier → toolRouter
 * 现在一步：IntentClassifier.classify() + .classifyTask()
 */

import {
  quickAssess,
  deepAssess,
  mergeIntentProfile,
  computeIterationBudget,
  getCompletionGates,
} from './runtime/agent/support/risk-budget.js';
import { SEMANTIC_RISK_DOMAINS } from '../utils/patterns.js';
import { MAX_ITERATIONS_DEFAULT } from './agent/constants.js';
import {
  extractExplicitPlanType,
  getPlanTypeSelection,
  inferTaskSignals,
  PLAN_TYPE_OPTIONS,
  selectPlanType,
} from './runtime/agent/support/plan-types.js';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

export class IntentClassifier {
  #modelProvider;
  #toolRegistry;
  #config;

  constructor(modelProvider, toolRegistry, config = {}) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry;
    this.#config = {
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
      maxTools: 32,
      maxTokens: 700,
      ...config,
    };
  }

  async classify(userInput, context = {}) {
    if (!this.#modelProvider?.chat || !userInput || typeof userInput !== 'string') {
      return null;
    }
    if (!this.shouldClassify(userInput)) {
      return null;
    }

    // ==== 反馈闭环：根据历史分类准确度动态调整置信度阈值 ====
    const feedbackContext = context.feedbackContext || null;
    const adjustedThreshold =
      feedbackContext?.automationConfidenceAdjustment != null
        ? this.#config.confidenceThreshold + feedbackContext.automationConfidenceAdjustment
        : this.#config.confidenceThreshold;

    const systemPrompt = this.#buildSystemPrompt(feedbackContext);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: this.#buildUserPrompt(userInput, context) },
    ];

    try {
      const response = await this.#modelProvider.chat(messages, {
        maxTokens: this.#config.maxTokens,
        temperature: 0,
      });
      const parsed = this.#parseJSON(response?.text || '');
      const intent = this.#normalizeIntent(parsed);
      // 使用调整后的阈值判断是否走回退
      return this.#shouldUseFallback(intent, adjustedThreshold)
        ? this.#fallbackIntent(userInput)
        : intent;
    } catch {
      return this.#fallbackIntent(userInput);
    }
  }

  buildRoutingPrompt(intent, feedbackContext) {
    if (!intent || intent.confidence < this.#config.confidenceThreshold) {
      return '';
    }

    const lines = [
      'Intent routing hint for the previous user message:',
      `- intent: ${intent.intent}`,
      `- confidence: ${intent.confidence}`,
      `- normalized task: ${intent.normalizedTask || 'none'}`,
      `- isCodingRelated: ${intent.isCodingRelated ? 'true' : 'false'}`,
      `- requiresCodeModification: ${intent.requiresCodeModification ? 'true' : 'false'}`,
      `- requires fresh data: ${intent.requiresFreshData ? 'true' : 'false'}`,
    ];

    if (intent.slots && Object.keys(intent.slots).length > 0) {
      lines.push(`- slots: ${JSON.stringify(intent.slots)}`);
    }
    if (intent.recommendedTools.length > 0) {
      lines.push(`- recommended tools: ${intent.recommendedTools.join(', ')}`);
    }
    if (intent.firstActionHint?.tool) {
      lines.push(
        `- recommended first action: CALL ${intent.firstActionHint.tool}(${JSON.stringify(intent.firstActionHint.arguments || {})})`,
      );
    }

    // ==== 反馈闭环：附加工具有效性提示 ====
    if (feedbackContext?.toolEffectiveness?.length > 0) {
      const effectiveTools = feedbackContext.toolEffectiveness
        .filter((te) => te.hitRate > 0.5 && te.used >= 2)
        .map((te) => te.tool);
      if (effectiveTools.length > 0) {
        lines.push(
          `- historically effective tools for similar tasks: ${effectiveTools.join(', ')}`,
        );
      }
    }

    lines.push(
      '',
      'Use this only as a routing hint. If the intent requires fresh/current data, do not answer from memory; call an appropriate tool first.',
    );

    return lines.join('\n');
  }

  shouldClassify(userInput) {
    const input = String(userInput || '').trim();
    if (!input) {
      return false;
    }

    const explicitDirectReply = [
      /只回复|只回答|不要解释|不用解释|直接回复|直接回答/,
      /\b(just reply|only reply|answer only|no explanation|respond only)\b/i,
    ].some((pattern) => pattern.test(input));
    const memoryOnly = [/记住|记一下|remember this|keep this in mind/i].some((pattern) =>
      pattern.test(input),
    );
    if (explicitDirectReply || memoryOnly) {
      return false;
    }

    return true;
  }

  #buildSystemPrompt(feedbackContext) {
    const basePrompt = [
      'You are an intent classifier for an agent runtime.',
      'Classify the latest user message into structured JSON only.',
      'Do not answer the user. Do not call tools. Do not include markdown.',
      '',
      'Return this JSON shape:',
      '{',
      '  "intent": "weather_query | web_research | local_file_task | terminal_task | coding_task | git_task | schedule_task | explanation | general_chat | unknown",',
      '  "confidence": 0.0,',
      '  "normalizedTask": "clear task in the user language",',
      '  "isCodingRelated": true,',
      '  "requiresCodeModification": false,',
      '  "slots": {},',
      '  "requiresFreshData": false,',
      '  "recommendedTools": [],',
      '  "firstActionHint": {"tool": "tool_name", "arguments": {}}',
      '}',
      '',
      'Important:',
      '- Set isCodingRelated=true if the message asks about source code, programming, scripts, files containing code, tests, builds, code quality, or any programming-related topic.',
      '- Set requiresCodeModification=true only if the message explicitly asks to CREATE, EDIT, MODIFY, FIX, REFACTOR, OPTIMIZE, ADD, REMOVE, DELETE, INSERT, REPLACE, UPDATE, WRITE, DEVELOP, IMPLEMENT, BUILD, or otherwise CHANGE source code, files, programs, scripts, functions, modules, features, or components. Pure reading, checking, viewing, inspecting, or asking about existing code does NOT require modification.',
      '',
      'Important examples:',
      '- "上海天气" means a weather_query for location 上海, likely today/current weather.',
      '- "明天北京会下雨吗" means a weather_query for 北京 with date 明天.',
      '- "最新汇率" and "今天新闻" require fresh public data.',
      '- "帮我看下 index.html 中有没有 init()" → local_file_task, isCodingRelated=true, requiresCodeModification=false (reading only)',
      '- "index.html 中 init() 没有调用，帮我修复" → coding_task, isCodingRelated=true, requiresCodeModification=true',
      '- "创建一个 index.html 页面" → coding_task, isCodingRelated=true, requiresCodeModification=true',
      '- "检查一下项目的 js 文件是否正确" → local_file_task or coding_task, isCodingRelated=true, requiresCodeModification=false (reading only)',
      '- File, terminal, coding, git, and schedule requests should be routed to the matching tool family when available.',
    ];

    // ==== 反馈闭环：注入历史分类准确度信息 ====
    if (feedbackContext?.intentHitRates?.length > 0) {
      const poorIntents = feedbackContext.intentHitRates
        .filter((ih) => ih.accuracy < 0.5 && ih.total >= 3)
        .map((ih) => ih.intent);
      const strongIntents = feedbackContext.intentHitRates
        .filter((ih) => ih.accuracy > 0.85 && ih.total >= 3)
        .map((ih) => ih.intent);

      const feedbackLines = [];
      if (poorIntents.length > 0) {
        feedbackLines.push(
          `Historical note: intent types [${poorIntents.join(', ')}] have had lower classification accuracy recently. Double-check before classifying as one of these.`,
        );
      }
      if (strongIntents.length > 0) {
        feedbackLines.push(
          `Historical note: intent types [${strongIntents.join(', ')}] have been classified accurately. Confidence can be slightly higher for these.`,
        );
      }
      if (feedbackLines.length > 0) {
        basePrompt.push('');
        basePrompt.push(feedbackLines.join('\n'));
      }
    }

    return basePrompt.join('\n');
  }

  #buildUserPrompt(userInput, context) {
    const availableTools = this.#summarizeTools();
    const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : [];
    const recent = recentMessages
      .slice(-6)
      .map((message) => `${message.role}: ${String(message.content || '').slice(0, 240)}`)
      .join('\n');

    return [
      `User message:\n${userInput}`,
      '',
      `Available tools:\n${availableTools || 'none'}`,
      recent ? `\nRecent conversation context:\n${recent}` : '',
      '',
      'Return JSON only.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  #summarizeTools() {
    const tools = this.#toolRegistry?.getAll?.() || [];
    return tools
      .slice(0, this.#config.maxTools)
      .map((tool) => `- ${tool.name}: ${String(tool.description || '').slice(0, 180)}`)
      .join('\n');
  }

  #parseJSON(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return null;
    }

    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

    try {
      return JSON.parse(candidate);
    } catch {
      const firstBrace = candidate.indexOf('{');
      const lastBrace = candidate.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace <= firstBrace) {
        return null;
      }
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  #normalizeIntent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const intent = typeof value.intent === 'string' ? value.intent.trim() : 'unknown';
    const confidence = Number.isFinite(Number(value.confidence))
      ? Math.max(0, Math.min(1, Number(value.confidence)))
      : 0;
    const recommendedTools = Array.isArray(value.recommendedTools)
      ? value.recommendedTools.filter(
          (tool) => typeof tool === 'string' && this.#toolRegistry?.has?.(tool),
        )
      : [];
    const firstActionHint = this.#normalizeFirstActionHint(value.firstActionHint);
    const isCodingRelated = Boolean(value.isCodingRelated);
    const requiresCodeModification = Boolean(value.requiresCodeModification);

    if (firstActionHint?.tool && !recommendedTools.includes(firstActionHint.tool)) {
      recommendedTools.unshift(firstActionHint.tool);
    }

    return {
      intent,
      confidence,
      normalizedTask: typeof value.normalizedTask === 'string' ? value.normalizedTask.trim() : '',
      slots:
        value.slots && typeof value.slots === 'object' && !Array.isArray(value.slots)
          ? value.slots
          : {},
      requiresFreshData: Boolean(value.requiresFreshData),
      isCodingRelated,
      requiresCodeModification,
      recommendedTools,
      firstActionHint,
    };
  }

  #shouldUseFallback(intent, threshold) {
    if (!intent) {
      return true;
    }
    const effectiveThreshold = threshold ?? this.#config.confidenceThreshold;
    return intent.intent === 'unknown' || intent.confidence < effectiveThreshold;
  }

  #fallbackIntent(userInput) {
    const input = String(userInput || '').trim();
    const weatherIntent = this.#fallbackWeatherIntent(input);
    if (weatherIntent) {
      return weatherIntent;
    }
    return null;
  }

  #fallbackWeatherIntent(input) {
    if (!this.#toolRegistry?.has?.('web_search')) {
      return null;
    }

    const weatherLike =
      /天气|气温|温度|降雨|下雨|雨吗|带伞|预报|weather|temperature|forecast|rain/i.test(input);
    if (!weatherLike) {
      return null;
    }

    const location = this.#inferWeatherLocation(input);
    const query = location ? `${location}天气` : input;

    const recommendedTools = ['web_search'];
    if (this.#toolRegistry?.has?.('web_fetch')) {
      recommendedTools.push('web_fetch');
    }

    return {
      intent: 'weather_query',
      confidence: 0.86,
      normalizedTask: `查询${query}`,
      isCodingRelated: false,
      requiresCodeModification: false,
      slots: {
        ...(location ? { location } : {}),
        date: this.#inferDateSlot(input),
      },
      requiresFreshData: true,
      recommendedTools,
      firstActionHint: {
        tool: 'web_search',
        arguments: { query, max_results: 5 },
      },
    };
  }

  #inferWeatherLocation(input) {
    const quoted = input.match(/[“"']([^“”"']{1,30}?)(?:天气|气温|温度|预报)[”"']?/);
    if (quoted?.[1]) {
      return quoted[1].trim();
    }

    const beforeKeyword = input.match(
      /([\p{Script=Han}A-Za-z\s·.-]{1,30}?)(?:天气|气温|温度|预报)/u,
    );
    if (beforeKeyword?.[1]) {
      return beforeKeyword[1]
        .replace(/^(查询|查|看|搜索|搜|今天|明天|后天|本周|这周|当前|现在)/, '')
        .trim();
    }

    const afterKeyword = input.match(
      /(?:天气|气温|温度|预报).*?(?:在|查询|查|看)?\s*([\p{Script=Han}A-Za-z\s·.-]{1,30})/u,
    );
    if (afterKeyword?.[1]) {
      return afterKeyword[1].trim();
    }

    return '';
  }

  #inferDateSlot(input) {
    if (/后天/.test(input)) {
      return 'day_after_tomorrow';
    }
    if (/明天/.test(input)) {
      return 'tomorrow';
    }
    if (/昨天/.test(input)) {
      return 'yesterday';
    }
    if (/本周|这周|一周|7天|七天/.test(input)) {
      return 'week';
    }
    return 'today';
  }

  #normalizeFirstActionHint(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const tool = typeof value.tool === 'string' ? value.tool.trim() : '';
    if (!tool || !this.#toolRegistry?.has?.(tool)) {
      return null;
    }
    const args =
      value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)
        ? value.arguments
        : {};
    return { tool, arguments: args };
  }

  // ============================================================
  // 原 TaskClassifier 功能（合并进来，消除一层路由）
  // ============================================================

  /**
   * 任务分类 → taskProfile
   * 接受可选的 LLM 意图识别结果，用于覆盖或增强硬编码判断。
   */
  classifyTask(userInput, intent = null, feedbackContext = null) {
    const risk = intent
      ? mergeIntentProfile(quickAssess(userInput), intent, userInput)
      : quickAssess(userInput);

    // ==== 反馈闭环：根据历史成功率调整自动化规划置信度 ====
    let requiresPlanning = risk.requiresPlanning;
    if (feedbackContext?.automationConfidenceAdjustment != null) {
      const adjustment = feedbackContext.automationConfidenceAdjustment;
      // 如果历史反馈显示自动化规划不可靠，降低要求
      if (adjustment < -0.2 && risk.isCodingTask) {
        // 仍然需要 plan，但降低语义审查的门槛
        requiresPlanning = risk.isModificationTask; // 只有确实在修改时才强制 plan
      }
    }

    const explicitPlanType = extractExplicitPlanType(userInput);
    const taskSignals = inferTaskSignals(userInput);
    const profile = {
      isCodingTask: risk.isCodingTask,
      isModificationTask: risk.isModificationTask,
      isBugTask: risk.isBugTask,
      isDocumentationTask: risk.isDocumentationTask,
      isAnalysisTask: risk.isAnalysisTask,
      isResearchTask: risk.isResearchTask,
      isLikelyTrivial: risk.isLikelyTrivial,
      isInformationalQuery: risk.isInformationalQuery ?? !risk.isCodingTask,
      requiresAutomaticPlanning: requiresPlanning,
      requiresSemanticRiskReview: risk.semanticDomains.length > 0 && risk.isModificationTask,
      semanticRiskDomains: risk.semanticDomains,
      riskLevel: risk.riskLevel,
      riskScore: risk.score,
      riskReasons: risk.reasons,
      input: String(userInput || ''),
      taskSignals,
      explicitPlanType,
      availablePlanTypes: PLAN_TYPE_OPTIONS,
    };
    profile.planType = selectPlanType(profile, userInput);
    profile.planSelection = getPlanTypeSelection(profile, userInput);
    return profile;
  }

  /** 基于任务 profile 计算自适应迭代预算 */
  budgetFor(profile) {
    if (!profile || profile.isLikelyTrivial) {
      return Math.min(8, this.#config.maxIterations || MAX_ITERATIONS_DEFAULT);
    }
    if (profile.isBugTask) {
      return Math.min(40, this.#config.maxIterations || MAX_ITERATIONS_DEFAULT);
    }
    if (profile.isModificationTask) {
      return Math.min(25, this.#config.maxIterations || MAX_ITERATIONS_DEFAULT);
    }
    return this.#config.maxIterations || MAX_ITERATIONS_DEFAULT;
  }

  /** 从用户输入推断语义风险域 */
  inferSemanticRiskDomains(userInput) {
    const text = String(userInput || '');
    return SEMANTIC_RISK_DOMAINS.filter((domain) => domain.pattern.test(text)).map(
      ({ id, label, checklist }) => ({ id, label, checklist }),
    );
  }

  /** 深度评估（较慢，对高风险任务启用） */
  deepAssess(userInput) {
    return deepAssess(userInput);
  }

  /** completion gates — 对编码完成的证据门控策略 */
  completionGates(profile) {
    if (!profile?.isModificationTask) {
      return [];
    }
    return getCompletionGates?.() ?? [];
  }

  /** 用于计划任务的迭代预算 */
  iterationBudget(profile) {
    return computeIterationBudget
      ? computeIterationBudget({
          isCodingTask: profile?.isCodingTask,
          isModificationTask: profile?.isModificationTask,
          isBugTask: profile?.isBugTask,
          riskScore: profile?.riskScore ?? 0,
        })
      : this.budgetFor(profile);
  }
}

export default IntentClassifier;
