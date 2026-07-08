/**
 * AgentEngine — 真正的内核 API 层
 *
 * 架构目标：让 CLI、Desktop、Web 只 import 这一个文件，
 * 不再直接依赖 src/core/* 的内部实现。
 *
 * Runtime Layer (agent-engine.js)
 *   ├─ TaskClassifier        — 任务类型 / 语义风险 / 迭代预算
 *   ├─ AgentPlanner          — plan facade → ExecutionPlanManager core
 *   ├─ ToolExecutor          — 工具规范化执行 / 安全策略 / 缓存
 *   ├─ ContextManager        — 上下文窗口裁剪 / 工作区摘要
 *   └─ StagnationDetector    — 停滞 nudge / 进度检查点
 *
 * 对外 API：
 *   engine.run(userInput)      — 主循环入口
 *   engine.stop()              — 中断当前 run
 *   engine.getRunResult()      — 返回最近一次 run 的结构化结果
 *   engine.dispose()           — 释放资源
 */

import { SessionManager } from '../../session/session-manager.js';
import { buildSystemPrompt } from '../../../prompts/system-prompt.js';
import { RetryStrategy, withTimeout } from '../../../errors/error-handler.js';
import { TextToolParser } from '../../parsing/text-tool-parser.js';
import { IntentClassifier } from '../../intent-classifier.js';
import { DynamicContextPruning } from '../../dynamic-context-pruning.js';
import { WorkspaceIndex } from '../../workspace/workspace-index.js';
import { selectToolsForRequest, shouldUseIntentClassifier } from './tool-router.js';
import { WorkspaceState } from '../../workspace/workspace-state.js';
import { ObservationSummarizer } from '../../observation-summarizer.js';
import { ContentAddressableStore, FileAnalyzer } from '../../harness/content-addressing.js';
import {
  Patcher,
  InMemorySnapshotStore,
  HashlineBridge,
  DiskFilesystem,
} from '../../harness/hashline.js';
import { ServerManager } from '../../../lsp/lsp-manager.js';
import { registerCodeTools } from './tools/index.js';
import { EditOrchestrator } from '../../edit-orchestrator.js';
import { ModuleResolver } from '../../harness/module-resolver.js';
import { ImportGraph } from '../../harness/import-graph.js';
import { BarrelManager } from '../../harness/barrel-manager.js';
import { ConversationJournal } from '../../../memory/conversation-journal.js';
import { SessionPersistence } from '../../session/session-persistence.js';
import { ContextProjectionGenerator } from '../../harness/context-projection.js';
import { StateGraph } from '../../harness/state-graph-core.js';
import { OnDemandContextExpansion } from '../../harness/on-demand-context.js';
import { SymbolIndex } from '../../harness/symbol-index.js';
import { DependencyGraph } from '../../harness/dependency-graph.js';
import { withRoutedToolContext } from '../../tools/routed-tool-context.js';
import { TokenScope } from './support/token-scope.js';
import { quickAssess, computeIterationBudget } from './support/risk-budget.js';
import { AgentPlanner } from './agent-planner.js';
import { ExecutionFeedbackLoop } from './execution-feedback.js';
import { ToolExecutor } from './tool-executor.js';
import { ContextManager } from './context-manager.js';
import { metricsSink } from '../metrics-sink.js';
import { MemoryManager } from '../../../memory/memory-manager.js';
import { AgentMemory } from '../../../memory/agent-memory.js';
import {
  buildToolSyntaxCorrectionPrompt,
  buildToolUseCorrectionPrompt,
  buildCodingTaskOperatingPrompt,
  buildCodingCompletionGatePrompt,
  buildSemanticRiskGuidance,
  suggestVerificationStrategy,
  isTermination as isTerminationResponse,
  extractFinalAnswer,
  normalizeFinalAnswer,
  containsUnparsedToolSyntax as containsUnparsedSyntax,
  shouldCorrectToolRefusal as shouldCorrectRefusal,
  shouldBlockCodingFinal,
} from './support/prompt-builder.js';
import { StagnationDetector } from './termination-detector.js';
import { verifyCompletion } from './support/verification-engine.js';
import { TaskStatus } from '../../../planner/graph-planner.js';
import {
  MAX_ITERATIONS_DEFAULT,
  EXPLORATION_BUDGET,
  FORCE_ACTION_GRACE_TURNS,
} from '../../agent/constants.js';

const MAX_PAUSED_TURN_CONTINUATIONS = 8;
import { getToolEffect, isMeaningfulProgress, isProgressFromResult, isLandedMutation, ToolEffect } from './support/tool-semantics.js';
import { analyzeHashlinePatchResult } from './support/hashline-plan-policy.js';
import { loadRuntimeEnv } from '../runtime-config.js';
import { createConfiguredModelProvider } from '../../../cli/model-provider-factory.js';

/**
 * AgentEngine 工厂函数。供 CLI/Desktop 调用。
 *
 * @param {object} options
 * @param {object} options.modelProvider     — 必须。实现 chat(messages, opts)
 * @param {object} options.toolRegistry      — 必须。实现 get(name) / getAll() / toFunctionDefinitions()
 * @param {object} [options.memoryManager]   — 可选。记忆管理器
 * @param {object} [options.config]          — { workingDirectory, maxIterations, maxTokens, securityPolicy, intentClassification }
 * @param {object} [options.ui]              — UI 回调。默认无输出（quiet）。
 * @returns {AgentEngine}
 */
export function createAgentEngine({
  modelProvider,
  toolRegistry,
  memoryManager = null,
  config = {},
  ui = null,
}) {
  return new AgentEngine({ modelProvider, toolRegistry, memoryManager, config, ui });
}

function createEmptyToolRegistry() {
  return {
    size: 0,
    get() {
      return null;
    },
    getAll() {
      return [];
    },
    toFunctionDefinitions() {
      return [];
    },
  };
}

export function stripActionBlocks(text = '', { toolRegistry } = {}) {
  if (typeof text !== 'string') {
    return text;
  }

  let out = text
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+tool_calls\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+tool_calls\s*>/gi,
      '',
    )
    .replace(/<[|｜]+\s*DSML\s*[|｜]+invoke\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+invoke\s*>/gi, '')
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+parameter\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+parameter\s*>/gi,
      '',
    )
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, '')
    // 处理带属性的工具标签，如 <function=list_dir>...</function>
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<function\b[^>]*>[\s\S]*?<\/function>/gi, '')
    // 处理带属性的工具标签，如 <tool=list_dir>...</tool>
    .replace(/<tool=[^>]+>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool\b[^>]*>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
    .replace(/<output\b[^>]*>\s*<\/output>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    // 处理 parameter 标签
    .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
    // 处理其他常见的工具相关标签
    .replace(/<arguments>[\s\S]*?<\/arguments>/gi, '')
    .replace(/<args\b[^>]*>[\s\S]*?<\/args>/gi, '')
    .replace(/```(?:json|tool)?\s*\n?\s*\{[\s\S]*?\}\s*```/gi, '');

  if (toolRegistry) {
    const tools = toolRegistry.getAll?.() || [];
    for (const tool of tools) {
      const escapedName = tool.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 处理两种格式：<toolName>...</toolName> 和 <function=toolName>...</function>
      const tagRegex1 = new RegExp(`<${escapedName}>\\s*[\\s\\S]*?\\s*<\\/${escapedName}>`, 'gi');
      const tagRegex2 = new RegExp(
        `<\\w*=${escapedName}\\b[^>]*>\\s*[\\s\\S]*?\\s*<\\/\\w*>`,
        'gi',
      );
      out = out.replace(tagRegex1, '');
      out = out.replace(tagRegex2, '');
    }
  }

  const trimmed = out.trim();
  if (
    trimmed.startsWith('{') &&
    (trimmed.endsWith('}') || trimmed.endsWith('}\n')) &&
    /"action"\s*:|"evaluation_previous_goal"\s*:|"next_goal"\s*:|"memory"\s*:/.test(trimmed)
  ) {
    return '';
  }

  return out.trim();
}

// ============================================================
// ToolProtocolStreamFilter — 流式协议文本过滤
//
// 问题：模型输出的工具调用 JSON（如 {"action": {"list_dir": {...}}}）
// 会通过 text_delta 直接进入 UI 聊天气泡，在 parser 识别为工具调用前
// 就已经显示给用户了。
//
// 解决：在流式管道中扫描 JSON / XML / fenced JSON 候选片段，
// 只抑制识别为工具协议的结构，普通 JSON / XML / 文本照常显示。
// ============================================================

const PROTOCOL_FIELD_PATTERN =
  /"action"\s*:|"evaluation_previous_goal"\s*:|"next_goal"\s*:|"memory"\s*:/;
// 更新：支持带属性的标签格式，如 <function=list_dir>
const TOOL_XML_TAG_PATTERN =
  /<(tool|tool_call|function|function_call|invoke|tool_code|parameter|arguments|args|output)\b[^>]*>/i;
const TOOL_XML_CLOSE_PATTERN =
  /<\/(tool|tool_call|function|function_call|invoke|tool_code|parameter|arguments|args|output)\s*>/i;
const DSML_PIPE_OPEN_PATTERN = /<[|｜]+\s*DSML\s*[|｜]+[^>]*>/i;
const DSML_PIPE_CLOSE_PATTERN = /<\/[|｜]+\s*DSML\s*[|｜]+[^>]*>/i;
const DSML_PIPE_TOOL_CALLS_END_PATTERN = /<[|｜]+\s*DSML\s*[|｜]+tool_calls\s*>/i;
const FENCED_JSON_PROTOCOL_PATTERN = /```(?:json|tool)?\s*\{/i;
const MAX_PROTO_BUFFER_SIZE = 8192;

function findProtocolCandidateIndex(text) {
  const indexes = [
    text.indexOf('{'),
    text.indexOf('<'),
    (() => {
      const match = text.match(FENCED_JSON_PROTOCOL_PATTERN);
      return match ? match.index : -1;
    })(),
  ].filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function jsonObjectEndIndex(text, startIndex = 0) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

function classifyProtocolBuffer(buffer, bufferingType) {
  if (buffer.length > MAX_PROTO_BUFFER_SIZE) {
    return { status: 'emit', length: buffer.length };
  }

  if (bufferingType === 'fenced_json') {
    const closeIndex = buffer.indexOf('```', 3);
    if (closeIndex === -1) {
      return { status: 'pending' };
    }
    return PROTOCOL_FIELD_PATTERN.test(buffer)
      ? { status: 'suppress', length: closeIndex + 3 }
      : { status: 'emit', length: closeIndex + 3 };
  }

  if (bufferingType === 'json') {
    const endIndex = jsonObjectEndIndex(buffer);
    if (endIndex === -1) {
      return { status: 'pending' };
    }
    return PROTOCOL_FIELD_PATTERN.test(buffer.slice(0, endIndex))
      ? { status: 'suppress', length: endIndex }
      : { status: 'emit', length: endIndex };
  }

  if (bufferingType === 'xml') {
    const trimmed = buffer.trimStart();
    if (!/^<[/A-Za-z_|｜]/.test(trimmed)) {
      return { status: 'emit', length: buffer.length };
    }
    if (!TOOL_XML_TAG_PATTERN.test(trimmed) && !DSML_PIPE_OPEN_PATTERN.test(trimmed)) {
      const tagEnd = buffer.indexOf('>');
      return tagEnd === -1 ? { status: 'pending' } : { status: 'emit', length: tagEnd + 1 };
    }
    if (/^<[^>]+\/>/.test(trimmed)) {
      return { status: 'suppress', length: buffer.indexOf('>') + 1 };
    }
    const dsmlToolCallsEnvelope = trimmed.match(/^<[|｜]+\s*DSML\s*[|｜]+tool_calls\b[^>]*>/i);
    const dsmlEnvelopeEnd = dsmlToolCallsEnvelope
      ? buffer.slice(dsmlToolCallsEnvelope[0].length).match(DSML_PIPE_TOOL_CALLS_END_PATTERN)
      : null;
    if (dsmlEnvelopeEnd) {
      return {
        status: 'suppress',
        length: dsmlToolCallsEnvelope[0].length + dsmlEnvelopeEnd.index + dsmlEnvelopeEnd[0].length,
      };
    }

    const closeMatch =
      buffer.match(TOOL_XML_CLOSE_PATTERN) || buffer.match(DSML_PIPE_CLOSE_PATTERN);
    if (!closeMatch) {
      return { status: 'pending' };
    }
    return { status: 'suppress', length: closeMatch.index + closeMatch[0].length };
  }

  return { status: 'emit', length: buffer.length };
}

/**
 * 创建一个流式协议过滤器实例。
 * @returns {{ push: (text: string) => { visibleText: string, protocolDetected: boolean, protocolPreview?: string } }}
 */
export function createProtocolStreamFilter() {
  let buffer = '';
  let isBuffering = false;
  let bufferingType = null;

  function push(text) {
    if (!text || typeof text !== 'string') {
      return { visibleText: '', protocolDetected: false };
    }

    let input = text;
    let visibleText = '';
    let protocolDetected = false;
    let protocolPreview = '';

    while (input) {
      if (!isBuffering) {
        const candidateIndex = findProtocolCandidateIndex(input);
        if (candidateIndex === -1) {
          visibleText += input;
          break;
        }

        visibleText += input.slice(0, candidateIndex);
        buffer = input.slice(candidateIndex);
        isBuffering = true;
        bufferingType = FENCED_JSON_PROTOCOL_PATTERN.test(buffer)
          ? 'fenced_json'
          : buffer.trimStart().startsWith('{')
            ? 'json'
            : 'xml';
        input = '';
      } else {
        buffer += input;
        input = '';
      }

      const decision = classifyProtocolBuffer(buffer, bufferingType);
      if (decision.status === 'pending') {
        break;
      }

      const consumed = buffer.slice(0, decision.length);
      input = buffer.slice(decision.length);
      if (decision.status === 'suppress') {
        protocolDetected = true;
        protocolPreview ||= consumed.length <= 200 ? consumed : consumed.slice(0, 200) + '...';
      } else {
        visibleText += consumed;
      }
      buffer = '';
      isBuffering = false;
      bufferingType = null;
    }

    return { visibleText, protocolDetected, protocolPreview: protocolPreview || undefined };
  }

  function flush() {
    if (!isBuffering || !buffer) {
      return { visibleText: '', protocolDetected: false };
    }
    const decision = classifyProtocolBuffer(buffer, bufferingType);
    if (decision.status === 'suppress') {
      const preview = buffer.length <= 200 ? buffer : buffer.slice(0, 200) + '...';
      buffer = '';
      isBuffering = false;
      bufferingType = null;
      return { visibleText: '', protocolDetected: true, protocolPreview: preview };
    }
    const visibleText = buffer;
    buffer = '';
    isBuffering = false;
    bufferingType = null;
    return { visibleText, protocolDetected: false };
  }

  return { push, flush };
}
function normalizeModelResponse(response = {}) {
  const text =
    typeof response.text === 'string'
      ? response.text
      : typeof response.content === 'string'
        ? response.content
        : typeof response.answer === 'string'
          ? response.answer
          : '';

  // 支持两种字段命名：toolCalls (camelCase) 和 tool_calls (OpenAI snake_case)
  const rawToolCalls =
    Array.isArray(response.toolCalls) && response.toolCalls.length > 0
      ? response.toolCalls
      : Array.isArray(response.tool_calls) && response.tool_calls.length > 0
        ? response.tool_calls
        : [];

  // 统一归一化：将 OpenAI 原生格式 { id, type, function: { name, arguments } }
  // 转换为简化格式 { name, arguments }，便于下游 ToolExecutor 统一处理
  const toolCalls = rawToolCalls
    .map((call) => {
      if (!call || typeof call !== 'object') {
        return call;
      }

      // 简化格式：已有 name 字段
      if (call.name) {
        let args = call.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        return { ...call, arguments: args || {} };
      }

      // OpenAI 原生格式：function.name + function.arguments
      if (call.function?.name) {
        let args = {};
        if (call.function.arguments) {
          if (typeof call.function.arguments === 'object') {
            args = call.function.arguments;
          } else if (typeof call.function.arguments === 'string') {
            try {
              args = JSON.parse(call.function.arguments);
            } catch {
              args = {};
            }
          }
        }
        return {
          id: call.id,
          name: call.function.name,
          arguments: args,
          source: call.type || 'native_tool_call',
          raw: call,
        };
      }

      return call;
    })
    .filter((call) => call && (call.name || (call.function && call.function.name)));

  return {
    ...response,
    text,
    content: typeof response.content === 'string' ? response.content : text,
    toolCalls,
    finishReason: response.finishReason || response.finish_reason || 'stop',
  };
}

// =========================================================================
// 编号条目语义评分：区分「可执行任务列表」与「知识描述列表」
// =========================================================================
// 设计原则:
//   不是简单数编号行，而是逐条评估语言学特征——
//   - 这条是在"发指令"（LLM 自己能执行的动作）？
//   - 还是在"做描述"（陈述一个事实/定义/概念）？
//   只有指令型条目占压倒性多数，才判为"有执行计划但未调用工具"。
//
// 单条评分:
//   +2  含强可执行动作词（create/write/build/run/创建/编写/构建...）
//   -2  含定义/描述标记（是/指/is/means/refers to...）
//   +1  含工程产物引用（file/function/class/component/module...）
//   +1  含未来意图词（will/need to/should/将/需要/要...）
//   -1  条目文本过长（>120 字符，解释型更啰嗦）
//   +1  前导句是计划声明（"Here's my plan" / "I will do the following"）
//
// 聚合阈值: 总分 >= items.length（平均每条 >= 1 分），且总分 >= 3
// =========================================================================

// ---------- 单条语义评分 ----------
function scoreNumberedItem(item) {
  let s = 0;

  // +2: 强可执行动作 —— LLM 通过工具调用实际能做的事
  if (
    /\b(?:create|write|build|run|execute|install|deploy|modify|edit|delete|remove|add|update|generate|compile|test|refactor|move|rename|copy|commit|push|configure|set\s*up|implement|replace|fix|patch|创建|编写|构建|运行|执行|安装|部署|修改|编辑|删除|移除|添加|更新|生成|编译|测试|重构|移动|重命名|复制|提交|推送|配置|实现|替换|修复|修补)\b/i.test(
      item,
    )
  ) {
    s += 2;
  }

  // -2: 定义/描述标记 —— 陈述事实而非发指令
  if (
    /(?:是指|指的是|即|意为|定义为|是[一种个项类]|属于|指代|称作|所谓|is\s+(?:a|an|the)\b|refers?\s+to|means?\b|is\s+defined\s+as|consists?\s+of|comprises?\b|stands?\s+for)/i.test(
      item,
    )
  ) {
    s -= 2;
  }

  // +1: 工程产物 —— 计划的直接产出
  if (
    /\b(?:file|function|class|component|module|route|endpoint|config|directory|repo|package|dependency|import|export|interface|type|hook|middleware|service|controller|model|schema|migration|seed|文档|文件|函数|类|组件|模块|路由|接口|配置|目录|包|依赖)\b/i.test(
      item,
    )
  ) {
    s += 1;
  }

  // +1: 未来/意图词 —— 表明之后要做
  if (
    /\b(?:will|shall|going\s+to|need\s+to|should|must|have\s+to|plan\s+to|intend\s+to|将|要|需要|应该|必须|打算|计划)\b/i.test(
      item,
    )
  ) {
    s += 1;
  }

  // -1: 条目过长 —— 解释型通常展开写，指令型通常简洁
  if (item.length > 120) {
    s -= 1;
  }

  return s;
}

// ---------- 聚合判断: 整体是否为可执行任务列表 ----------
function isActionableTaskList(text) {
  const items = text.match(/^\d+\.\s+.+/gm);
  if (!items || items.length < 3) {
    return false;
  }

  let totalScore = 0;
  for (const item of items) {
    totalScore += scoreNumberedItem(item);
  }

  // 要求: 总分 >= items 数（平均每条 >= 1）且绝对分 >= 3，确保多条目达成强共识
  return totalScore >= items.length && totalScore >= 3;
}

// ---------- 检测前导句是否为计划声明 ----------
function hasPlanLeadIn(text) {
  return /\b(?:Here(?:'s| is) (?:my|the) plan|I(?:'ll| will) do the following|Steps?(?:\s+to\s+\w+)?:|My approach:|Plan:|执行计划|实施方案|操作步骤|按以下步骤)\b/i.test(
    text,
  );
}

// =========================================================================
// 检测模型是否只输出了计划/描述而没有执行任何工具调用
// =========================================================================
function looksLikePlanWithoutExecution(text) {
  if (!text?.trim()) {
    return false;
  }
  const t = text.trim();

  // -------- 强信号: 明确声明了文件创建清单 --------
  if (/\*\*Files to create\*\*|Files to create:|待创建文件/i.test(t)) {
    return true;
  }

  // -------- 核心判断: 编号条目是否为可执行任务列表 --------
  // 同时要求有"计划前导句"（Here's my plan...），提高置信度
  const items = t.match(/^\d+\.\s+.+/gm);
  if (items && items.length >= 3) {
    // 如果有明确的计划前导句 → 强信号，降低阈值
    if (hasPlanLeadIn(t)) {
      let score = 0;
      for (const item of items) {
        score += scoreNumberedItem(item);
      }
      if (score >= 1) {
        return true;
      } // 有计划声明时，微弱正评分即通过
    }
    // 否则用标准阈值
    if (isActionableTaskList(t)) {
      return true;
    }
  }

  // -------- "I will / I'll / I am going to" 创建/写/构建——明确执行意图 --------
  if (
    /\b(I will|I'll|I am going to)\s+(create|write|build|make|implement|创建|编写|构建|实现)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  // -------- "Let me first" —— 顺序执行意图 --------
  if (/\bLet me first\b/i.test(t) && !/CALL\s+\w+|action["<]/i.test(t)) {
    return true;
  }

  // -------- "Step by step / step-by-step" —— 步骤化解法声明 --------
  if (/\bstep[-\s]by[-\s]step\b/i.test(t) && !/CALL\s+\w+|action["<]/i.test(t)) {
    return true;
  }

  // -------- "Let me read/understand the codebase" —— 阅读意图未执行 --------
  if (
    /\b(?:Let me|I(?:'ll| will| need to)?)\s+(?:understand|read|examine|review|analyze|inspect|look (?:at|into)|check|explore|scan|study)\s+(?:the\s+)?(?:full\s+)?(?:codebase|project|files?|code|repository|source|directory|structure)/i.test(
      t,
    ) &&
    !/CALL\s+\w+|action["<]/i.test(t)
  ) {
    return true;
  }

  // -------- "在 X 之前先 Y" —— 顺序依赖声明 --------
  if (
    /\b(?:before|first|prior to)\s+(?:creating|writing|modifying|changing|editing|deleting|implementing|building)/i.test(
      t,
    ) &&
    /\b(?:let me|I(?:'ll| will)?|need to|should|must|going to)\s+(?:understand|read|examine|review|analyze|check|look|explore|scan)/i.test(
      t,
    ) &&
    !/CALL\s+\w+|action["<]/i.test(t)
  ) {
    return true;
  }

  return false;
}

// 通用 XML 标签剥离正则：匹配任何 <tagname...>content</tagname> 配对标签
// 以及 DSML 管道格式 <||DSML||invoke...>...</||DSML||invoke>
const ANY_XML_TAG = /<(\w+)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DSML_PIPE_TAG = /<[|｜]+\s*DSML\s*[|｜]+[^>]*>[\s\S]*?<\/[|｜]+\s*DSML\s*[|｜]+[^>]*>/gi;

// 检测模型输出了内部思考标签但未执行任何工具
// 注意：调用此函数时 allToolCalls.length === 0，parser 已确认无工具调用，
// 因此 text 中任何 XML 标签都不是合法工具调用格式，全部视为泄漏
// 场景: <dsml>, <info>, <thinking>, <plan>, <analysis>, <reasoning>, <reflection>, <note> 等
function looksLikeLeakedThinking(text) {
  if (!text?.trim()) {
    return false;
  }
  const t = text.trim();
  // 检测任何非工具 XML 标签（合法工具标签如 <action> 等已被 parser 消耗）
  if (!ANY_XML_TAG.test(t) && !DSML_PIPE_TAG.test(t)) {
    return false;
  }
  // 去掉所有 XML / DSML 标签后的剩余文本
  const withoutTags = t.replace(ANY_XML_TAG, '').replace(DSML_PIPE_TAG, '').trim();
  // 标签之外没有任何实质内容（没有 CALL、没有 tool call、没有 FINAL_ANSWER）
  if (!withoutTags || withoutTags.length < 20) {
    return true;
  }
  // 剩余内容只是 "Let me..." / "Thinking..." 之类无动作的声明
  if (
    /^(Let me|Thinking|I should|I need to|I'll)\b/i.test(withoutTags) &&
    !/CALL\s+\w+|action["<]/i.test(withoutTags)
  ) {
    return true;
  }
  return false;
}

// 检测模型是否在虚构工具执行结果（未调用任何工具，却声称"文件已创建""构建通过"等）
// 这是比 plan-only 更严重的问题：模型编造了完整的执行过程和虚构输出。
// 仅在 session 内实实在在未执行过任何工具时才判定为虚构。
function looksLikeFakeExecution(text, toolEventsInRun) {
  if (!text?.trim()) {
    return false;
  }
  // 如果 session 内已经执行过工具，可能是正常的总结描述，不拦截
  if (toolEventsInRun > 0) {
    return false;
  }
  const t = text.trim();
  let indicators = 0;

  // 标记 1：虚构的 "Files Created/Created files" 章节（过去时，非将来时）
  if (/\b(Files (C|c)reated|Created files|新增文件|已创建文件)/.test(t)) {
    indicators++;
  }

  // 标记 2：虚构的构建/验证输出（npm run build / yarn build 等 + 统计数字）
  if (
    /```\s*\n.*(?:build|vite|webpack|tsc|esbuild|rollup).*(?:\n|$)/.test(t) ||
    /(?:modules? transformed|bundle generated|built in \d|构建完成|编译成功|Production bundle)/i.test(
      t,
    )
  ) {
    indicators++;
  }

  // 标记 3：虚构的验证章节（Verification / 验证 / npm run build 带 ✅✓）
  if (
    /\b(Verification|验证|Test results?)\b/i.test(t) &&
    /(?:✅|✓|pass|success|成功|通过|No errors|zero errors)/i.test(t)
  ) {
    indicators++;
  }

  // 标记 4：虚构的错误诊断修正报告（"Root Cause" + "Fix" + 无工具执行）
  if (
    /\bRoot Cause\b/i.test(t) &&
    (/\bFiles? (C|c)reated\b/.test(t) || /\bFix\b/i.test(t) || /\bResolution\b/i.test(t)) &&
    !/CALL\s+\w+|action["<]/i.test(t)
  ) {
    indicators++;
  }

  // 标记 5：虚构的"错误已解决"开篇（The error is resolved / The issue is fixed）
  if (
    /^(?:The |这个)(?:error|issue|bug|problem|错误|问题)\b.{0,30}\b(?:resolved|fixed|solved|解决|修复)/im.test(
      t,
    )
  ) {
    indicators++;
  }

  // 标记 6：虚构的文件导出声明（"Exports XXX class" / "Exports XXX function"）
  if (/^###\s+\d+\.\s+`[^`]+`\s*\n(?:Exports|导出)/m.test(t) && !/CALL\s+\w+|action["<]/i.test(t)) {
    indicators++;
  }

  // 标记 7：详细虚构文件内容描述（列出了具体方法名如 humanAct/processNight 等）
  if (
    /\b(?:humanAct|processNight|processDay|processDayVote|checkVictory|performAction)\b/.test(t) &&
    /\b(class|method|function|array|stub)\b/i.test(t) &&
    !/CALL\s+\w+|action["<]/i.test(t)
  ) {
    indicators++;
  }

  // 至少 2 个信号同时命中才判定为虚构
  return indicators >= 2;
}

// 检测模型表达了"需要阅读代码/文件"的意图，但未实际发起任何读操作工具调用
// 这是比 plan-only 更具体的一类空轮次：模型声明要理解代码却不用 read_file / search_file 等工具
function looksLikeIntentToReadWithoutTools(text) {
  if (!text?.trim()) {
    return false;
  }
  const t = text.trim();
  // 表达了阅读/探索意图
  const readIntent =
    /\b(?:let me|I(?:'ll| will| need to| should| must)?|need to|going to)\s+(?:understand|read|examine|review|analyze|inspect|look\s+(?:at|into)|check\s+(?:out)?|explore|scan|study|get\s+(?:to\s+)?know|familiarize)\b/i;
  const readTarget =
    /\b(?:the\s+)?(?:full\s+)?(?:codebase|project|files?|code|repository|source|directory|structure|key\s+files?|relevant\s+(?:files?|code)|implementation|module|package)/i;
  if (readIntent.test(t) && readTarget.test(t) && !/CALL\s+\w+|action["<]/i.test(t)) {
    return true;
  }
  // "before X, let me Y" 模式 (Y 是阅读操作)
  if (
    /\b(?:before|first|prior to)\s+(?:creating|writing|modifying|changing|editing|deleting|implementing|building|fixing|adding|removing)/i.test(
      t,
    ) &&
    readIntent.test(t) &&
    !/CALL\s+\w+|action["<]/i.test(t)
  ) {
    return true;
  }
  return false;
}

export class AgentEngine {
  // ============ 子系统 ============
  #modelProvider;
  #toolRegistry;
  #memoryManager;
  #config;
  #ui;
  #sessionManager;
  #retryStrategy;
  #textToolParser;
  #intentClassifier;
  #executionPlanManager;
  #feedbackLoop;
  #lastIntent = null;
  #toolExecutor;
  #contextManager;
  #stagnationDetector;
  #workspaceIndex;
  #workspaceState;
  #observationSummarizer;
  #contentStore;
  #fileAnalyzer;
  #snapshotStore;
  #hashlinePatcher;
  #hashlineBridge;
  #lspManager;
  #moduleResolver;
  #importGraph;
  #barrelManager;
  #editOrchestrator;
  #contextPruner;
  #tokenScope;
  #contextProjection;
  #onDemandContext;

  // ============ 运行态 ============
  #stopRequested = false;
  #lastRunResult = null;
  #lastUserInput = null;
  #conversationJournal;
  #sessionPersistence;
  #systemPromptInitialized = false;
  #fileStore = null;
  #sessionId = null;
  #sessionMetaWritten = false;
  #softToolRequired = null; // { toolName: string, escalations: number }
  #toolEmptyArgFailures = new Map(); // toolName → consecutive failure count

  // ask_user suspend/resume: Promise 挂起机制，替代硬中断
  #userInputResolve = null;
  #pendingUserInputRequest = null;

  constructor({ modelProvider, toolRegistry, memoryManager, config, ui, fileStore, sessionId }) {
    this.#modelProvider = modelProvider;
    this.#toolRegistry = toolRegistry || createEmptyToolRegistry();
    // memoryManager 可选：没传时默认创建 AgentMemory（含结构化记忆、检索、校验），
    // fallback 到 MemoryManager 确保兼容性
    const cwd = config?.workingDirectory || process.cwd();
    this.#memoryManager =
      memoryManager ||
      (() => {
        try {
          return new AgentMemory(cwd, modelProvider);
        } catch {
          try {
            return new MemoryManager(cwd);
          } catch {
            return null;
          }
        }
      })();
    this.#conversationJournal = new ConversationJournal(cwd);
    this.#sessionPersistence = new SessionPersistence(cwd, {
      enabled: config?.sessionPersistence !== false,
      maxMessages: config?.sessionPersistenceMaxMessages ?? 80,
      filePath: config?.sessionPersistenceFile,
    });
    this.#config = {
      maxIterations: config.maxIterations || MAX_ITERATIONS_DEFAULT,
      workingDirectory: config.workingDirectory || process.cwd(),
      toolResultCacheEnabled: config.toolResultCacheEnabled !== false,
      securityPolicy: config.securityPolicy || null,
      intentClassification: config.intentClassification || false,
      tokenBudget: config.tokenBudget || null,
      tokenBudgetWarningThreshold: config.tokenBudgetWarningThreshold ?? 70,
      maxTokens: config.maxTokens || 2048,
      ...config,
    };
    this.#ui = ui || {
      toolCall: () => {},
      toolResult: () => {},
      toolError: () => {},
      iteration: () => {},
      finalAnswer: () => {},
      warn: () => {},
      debug: () => {},
      debugEvent: () => {},
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallDelta: () => {},
    };
    this.#fileStore = fileStore || null;
    this.#sessionId = sessionId || null;

    // ============ 子系统初始化 ============
    this.#sessionManager = new SessionManager({
      model: this.#config.session?.model,
      fileStore: this.#fileStore,
      sessionId: this.#sessionId,
      workingDirectory: this.#config.workingDirectory,
      autoPersist: config?.autoPersist !== false,
    });
    const restoredSession = this.#sessionPersistence.restoreInto(this.#sessionManager);
    this.#systemPromptInitialized = restoredSession && this.#sessionManager.getHistory().length > 0;
    if (restoredSession) {
      this.#ui.debugEvent?.('Session context restored', {
        messages: this.#sessionManager.getHistory().length,
        filePath: this.#sessionPersistence.filePath,
      });
    }
    this.#retryStrategy = new RetryStrategy();
    this.#textToolParser = new TextToolParser(this.#toolRegistry);
    this.#intentClassifier = this.#config.intentClassification
      ? new IntentClassifier(modelProvider, this.#toolRegistry, this.#config.intentClassifier || {})
      : null;
    this.#executionPlanManager = new AgentPlanner({
      debugEvent: (label, details) => this.#ui.debugEvent?.(label, details),
      sessionManager: this.#sessionManager,
      onPlanAdvance: (progress) => {
        if (typeof this.#ui.planProgress === 'function') {
          this.#ui.planProgress(progress);
        }
      },
    });
    this.#feedbackLoop = new ExecutionFeedbackLoop({ learnFromHistory: true });
    this.#contextPruner = new DynamicContextPruning();
    this.#tokenScope =
      this.#config.tokenScope ||
      new TokenScope({
        budgetLimits: this.#config.tokenBudget
          ? {
              global: {
                limit: this.#config.tokenBudget,
                warningThreshold: this.#config.tokenBudgetWarningThreshold,
              },
            }
          : null,
        onBudgetWarning: (info) => this.#ui.debugEvent?.('Token budget warning', info),
        onBudgetExceeded: (info) => {
          this.#ui.debugEvent?.('Token budget exceeded - stopping', info);
          this.#stopRequested = true;
        },
      });
    this.#workspaceState = new WorkspaceState();
    this.#observationSummarizer = new ObservationSummarizer(this.#workspaceState);
    this.#workspaceIndex = new WorkspaceIndex(this.#config.workingDirectory);
    this.#contentStore = new ContentAddressableStore();
    this.#fileAnalyzer = new FileAnalyzer(this.#contentStore);

    // ============ Hashline 子系统初始化 ============
    // SnapshotStore: 管理文件快照历史，支持 stale tag recovery
    this.#snapshotStore = new InMemorySnapshotStore();
    // HashlineBridge: 把 Patcher 的事件桥接到 ContentAddressableStore
    this.#hashlineBridge = new HashlineBridge(this.#contentStore, this.#fileAnalyzer);
    // Patcher: 完整的 Hashline patch 应用器（含 preflight / recovery / 3-way merge）
    this.#hashlinePatcher = new Patcher({
      fs: new DiskFilesystem(this.#config.workingDirectory),
      snapshots: this.#snapshotStore,
      autoRecord: true,
      allowRecovery: true,
      bridge: this.#hashlineBridge,
    });

    // ============ LSP 子系统初始化 ============
    // ServerManager: 管理多语言 LSP server 生命周期
    this.#lspManager = new ServerManager({
      workspaceRoot: this.#config.workingDirectory,
    });

    // ============ 模块解析 / 导入图 / Barrel 初始化 ============
    // ModuleResolver: 解析 tsconfig paths + package exports 别名
    this.#moduleResolver = new ModuleResolver({
      workingDirectory: this.#config.workingDirectory,
    });
    // ImportGraph: 项目级导入依赖图
    this.#importGraph = new ImportGraph({
      workingDirectory: this.#config.workingDirectory,
      resolver: this.#moduleResolver,
    });
    // BarrelManager: 发现多级 barrel (index.ts) re-export 链
    this.#barrelManager = new BarrelManager({
      workingDirectory: this.#config.workingDirectory,
      importGraph: this.#importGraph,
      moduleResolver: this.#moduleResolver,
    });

    // ============ EditOrchestrator: LSP → Hashline → Diagnostics 闭环 ============
    this.#editOrchestrator = new EditOrchestrator({
      hashlinePatcher: this.#hashlinePatcher,
      lspManager: this.#lspManager,
      memoryManager: this.#memoryManager,
      snapshotStore: this.#snapshotStore,
      contentStore: this.#contentStore,
      workingDirectory: this.#config.workingDirectory,
    });

    // ============ ContextProjection: 状态图局部投影 ============
    // 使用 ContextProjectionGenerator 真实执行投影，而非手写 WorkspaceIndex stats
    this.#contextProjection = this.#createProjectionGenerator();

    // ============ OnDemandContextExpansion: 按需上下文扩展 ============
    // 每轮迭代动态评估置信度，按需扩展上下文，避免幻觉
    this.#onDemandContext = new OnDemandContextExpansion({
      symbolIndex: new SymbolIndex(),
      dependencyGraph: new DependencyGraph(),
    });

    // ============ 统一工具注册 ============
    // 通过 registerCodeTools 注册文件系统、Hashline 和 LSP 工具
    // 传入增强的 barrel/alias 管线，使 LSP rename 可精确同步 barrel chain
    registerCodeTools(this.#toolRegistry, {
      lspManager: this.#lspManager,
      contentStore: this.#contentStore,
      hashlinePatcher: this.#hashlinePatcher,
      moduleResolver: this.#moduleResolver,
      importGraph: this.#importGraph,
      barrelManager: this.#barrelManager,
    });

    this.#toolExecutor = new ToolExecutor({
      toolRegistry: this.#toolRegistry,
      securityPolicy: this.#config.securityPolicy,
      textToolParser: this.#textToolParser,
      ui: this.#ui,
      config: this.#config,
      contentStore: this.#contentStore,
      fileAnalyzer: this.#fileAnalyzer,
      snapshotStore: this.#snapshotStore,
      hashlinePatcher: this.#hashlinePatcher,
      lspManager: this.#lspManager,
      editOrchestrator: this.#editOrchestrator,
    });
    this.#contextManager = null; // 在 run() 中懒创建（需要 sessionManager 就绪）
    this.#stagnationDetector = new StagnationDetector();

    // ============ 公共 getter ============
    this.getLSPManager = () => this.#lspManager;
    this.getEditOrchestrator = () => this.#editOrchestrator;
  }

  // ============== 软工具要求：检测 + 升级 + 强制 ==============

  #trackToolArgFailure(toolName) {
    const count = (this.#toolEmptyArgFailures.get(toolName) || 0) + 1;
    this.#toolEmptyArgFailures.set(toolName, count);
    if (count >= 2 && !this.#softToolRequired) {
      this.#softToolRequired = { toolName, escalations: 0 };
      this.#ui.debugEvent?.('Soft tool requirement set', { toolName, failures: count });
    }
  }

  /** 在 LLM 调用前注入软工具要求提示 */
  #injectSoftToolRequirement(messages) {
    if (!this.#softToolRequired) return;
    const sr = this.#softToolRequired;
    if (sr.escalations === 0) {
      messages.push({
        role: 'system',
        content:
          `[SOFT TOOL REQUIREMENT] The "${sr.toolName}" tool keeps failing with empty/insufficient arguments. ` +
          `Call "${sr.toolName}" with valid path and content parameters now. Other tools will still work, ` +
          `but "${sr.toolName}" must succeed before this task can proceed.`,
      });
    } else if (sr.escalations >= 1) {
      messages.push({
        role: 'system',
        content:
          `[ENFORCED TOOL REQUIREMENT] You MUST call "${sr.toolName}" with valid parameters in this response. ` +
          `No other tools will be accepted until "${sr.toolName}" succeeds. ` +
          `Re-read the tool's parameter schema and pass all required fields.`,
      });
    }
  }

  /** 在工具调用解析后检查是否调用了要求的工具，并处理强制升级 */
  #checkSoftToolRequirement(allToolCalls) {
    if (!this.#softToolRequired) return;
    const requiredName = this.#softToolRequired.toolName;
    const hasRequired = allToolCalls.some((tc) => (tc.name || tc.function?.name) === requiredName);
    
    if (hasRequired) {
      this.#softToolRequired = null;
      this.#toolEmptyArgFailures.delete(requiredName);
      this.#ui.debugEvent?.('Soft tool requirement satisfied', { toolName: requiredName });
      return { shouldExecute: true };
    }
    
    this.#softToolRequired.escalations++;
    
    if (this.#softToolRequired.escalations >= 3) {
      this.#ui.debugEvent?.('Soft tool requirement exceeded max escalations', {
        toolName: requiredName,
        escalations: this.#softToolRequired.escalations,
      });
      return { shouldExecute: false, skipReason: `Soft tool requirement '${requiredName}' was not satisfied after 3 forced turns; aborting to avoid an unbounded force loop.` };
    }
    
    if (this.#softToolRequired.escalations >= 1) {
      this.#ui.debugEvent?.('Soft tool requirement escalated', {
        toolName: requiredName,
        escalations: this.#softToolRequired.escalations,
      });
    } else {
      this.#ui.debugEvent?.('Soft tool requirement reminder sent', {
        toolName: requiredName,
      });
    }
    
    return { shouldExecute: true };
  }

  #resetSoftToolRequirement() {
    this.#softToolRequired = null;
    this.#toolEmptyArgFailures = new Map();
  }

  // ============================================================
  // 对外 API
  // ============================================================

  /**
   * 主入口：接受用户输入，运行完整的 ReAct 循环，返回最终答案或结构化错误。
   *
   * @param {string} userInput
   * @returns {Promise<{success:boolean,status:string,answer:string,reason:string|null,iterations:number,durationMs:number,toolEvents:object[],error?:string,userInputRequest?:string}>}
   */
  async run(userInput) {
    const runStartedAt = Date.now();
    // —— Metrics: 会话级标记（每次 run 都有独立的 runId）——
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    this.#lastUserInput = userInput;

    if (!this.#sessionId) {
      this.#sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      this.#sessionManager.setSessionId(this.#sessionId);
    }

    if (this.#fileStore && !this.#sessionMetaWritten) {
      this.#sessionMetaWritten = true;
      this.#fileStore
        .appendMeta(
          this.#sessionId,
          {
            title: String(userInput || '').slice(0, 80) || '未命名会话',
            createdAt: Date.now(),
            workingDirectory: this.#config.workingDirectory,
            status: 'running',
          },
          this.#config.workingDirectory,
        )
        .catch((error) => {
          console.error('[AgentEngine] Failed to write session meta:', error.message);
        });
    }
    // 用户输入后立刻写入 conversation journal
    if (this.#conversationJournal) {
      try {
        this.#conversationJournal.recordInput(userInput, runId);
      } catch {
        /* 不阻塞 */
      }
    }
    this.#lastRunResult = {
      runId,
      success: false,
      status: 'running',
      answer: '',
      reason: null,
      iterations: 0,
      durationMs: 0,
      toolEvents: [],
    };
    try {
      metricsSink.startRun(runId);
    } catch (_) {
      /* 忽略 */
    }
    this.#stopRequested = false;
    this.#ui.debugEvent?.('Agent run started', {
      inputPreview: this.#preview(userInput, 240),
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
    });

    // 首次 run：设置 system prompt
    if (!this.#systemPromptInitialized || this.#sessionManager.length === 0) {
      // 初始化结构化记忆（AgentMemory 异步加载并构建索引）
      if (this.#memoryManager && typeof this.#memoryManager.initialize === 'function') {
        try {
          await this.#memoryManager.initialize();
        } catch {
          /* 静默失败 */
        }
      }

      // 路径作用域懒加载：当前 workingDirectory 下的规则
      if (this.#memoryManager && typeof this.#memoryManager.ensureRulesForPath === 'function') {
        try {
          const cwd = this.#config.workingDirectory || process.cwd();
          const { hasNewRules } = this.#memoryManager.ensureRulesForPath(cwd);
          if (hasNewRules) {
            this.#ui.debugEvent?.('Path-scoped rules loaded', { cwd });
          }
        } catch {
          /* 静默 */
        }
      }

      // 生成记忆上下文：使用 token-budget 感知的上下文构建器，避免无限制注入
      let memoryContext = '';
      if (
        this.#memoryManager &&
        typeof this.#memoryManager.getBudgetedMemoryContext === 'function'
      ) {
        try {
          const inputPreview = typeof userInput === 'string' ? userInput.substring(0, 200) : '';
          memoryContext = this.#memoryManager.getBudgetedMemoryContext({
            currentTask: inputPreview,
            maxTokens: 1500,
            tokensPerChar: 0.25,
          });
        } catch {
          /* 静默失败 */
        }
      }

      const systemPrompt = buildSystemPrompt(
        this.#memoryManager,
        this.#toolRegistry,
        this.#config.workingDirectory,
        memoryContext,
      );

      // 注入自动记忆提示
      if (this.#memoryManager && typeof this.#memoryManager.getAutoMemoryPrompt === 'function') {
        try {
          const autoPrompt = this.#memoryManager.getAutoMemoryPrompt({
            toolEvents: this.#lastRunResult?.toolEvents || [],
          });
          if (autoPrompt) {
            this.#sessionManager.addSystemMessage(autoPrompt);
          }
        } catch {
          /* 静默 */
        }
      }

      this.#sessionManager.setSystemPrompt(systemPrompt);
      const toolInstructions = this.#textToolParser.generateToolPrompt([]);
      this.#sessionManager.addSystemMessage(toolInstructions);
      this.#systemPromptInitialized = true;
      this.#ui.debugEvent?.('Session initialized', {
        toolCount: this.#toolRegistry.size,
        systemPromptChars: systemPrompt.length,
        toolInstructionChars: toolInstructions.length,
      });

      // —— 注入初始工作区上下文（多文件聚合）——
      if (this.#workspaceState && typeof this.#workspaceState.aggregateContext === 'function') {
        const wsCtx = this.#workspaceState.aggregateContext({
          maxFiles: 5,
          maxCharsPerFile: 400,
          maxTotalChars: 2000,
        });
        if (wsCtx && wsCtx.files && wsCtx.files.length > 0) {
          const prefix = `<!-- workspace-context: files=${wsCtx.files.join(',')} -->\n${wsCtx.summary || ''}`;
          this.#sessionManager.addSystemMessage(prefix);
        }
      }
    }

    // ========== Step 1：意图识别（仅当显式开启时才调用 LLM 预分类） ==========
    // ==== 反馈闭环：注入历史分类经验到 IntentClassifier ====
    const classificationFeedback = this.#feedbackLoop?.enrichClassificationContext?.() || null;
    const intent =
      this.#intentClassifier && shouldUseIntentClassifier(userInput)
        ? await this.#intentClassifier.classify(userInput, {
            recentMessages: this.#sessionManager.getRecentExchanges(3),
            feedbackContext: classificationFeedback,
          })
        : null;

    if (intent) {
      this.#lastIntent = intent; // 存储供 feedback loop 使用
      this.#ui.debugEvent?.('Intent classified', {
        intent: intent.intent,
        confidence: intent.confidence,
        recommendedTools: intent.recommendedTools,
      });
    } else {
      this.#ui.debugEvent?.('Intent classifier skipped', { reason: 'local_task_router' });
    }

    // ========== Step 2：任务分类（合并进 IntentClassifier，消除一层路由） ==========
    const taskProfile =
      this.#intentClassifier?.classifyTask?.(userInput, intent, classificationFeedback) ??
      quickAssess(userInput);

    // ========== Step 3：准备运行上下文 ==========
    // 原始任务以 DECISION 优先级写入，确保上下文裁剪时不被丢弃
    this.#sessionManager.addMessage('user', userInput, undefined, SessionManager.PRIORITY.DECISION);
    // 同时注入 system prompt：system prompt 永不裁剪，防止模型读完大量文件后"遗忘"任务
    this.#sessionManager.addSystemMessage(
      `[CURRENT TASK] You MUST complete this user request: ${userInput}`,
    );

    // Eager Todo Write prelude: 对多步任务，提示模型先分解用户原始指令再用 TodoWrite 跟踪
    const hasMultipleSteps = /(?:then|after\s+(?:that|which)|next|and\s+then|首先|然后|接着|之后|第一步|第二步|步骤)/i.test(
      userInput,
    ) || /\d+\s*(?:step|phase|stage|阶段|步)/i.test(userInput) || /(?:\n|[,;、，；])\s*(?:implement|create|fix|add|write|test|build|run|deploy|实现|创建|修复|添加|编写|测试|构建|运行|部署)/i.test(
      userInput,
    );
    if (hasMultipleSteps) {
      this.#sessionManager.addSystemMessage(
        `[SYSTEM REMINDER] The user provided a multi-step request. Before beginning work, call TodoWrite to capture the full breakdown of ALL steps. This ensures you do not lose track of any requirement as you work. Each distinct step should be its own todo item. Mark the first actionable step as in_progress and execute it. Update the todo list as you progress.`,
      );
    }
    this.#persistSessionContext({
      phase: 'run_started',
      runId,
      lastUserInput: userInput,
    });
    const routingPrompt = this.#intentClassifier?.buildRoutingPrompt?.(
      intent,
      classificationFeedback,
    );
    if (routingPrompt) {
      this.#sessionManager.addUserMessage(routingPrompt);
    }

    this.#stagnationDetector.reset();
    this.#toolExecutor.reset();
    this.#resetSoftToolRequirement();

    // ==== 意图分析 → Plan 智能分解：编码任务强制走 plan，LLM 驱动子任务拆分 ====
    // ==== 反馈闭环：注入历史分解经验到 GraphPlanner.decomposeTaskLLM ====
    const decompositionFeedback =
      this.#feedbackLoop?.enrichDecompositionContext?.(
        taskProfile.isBugTask
          ? 'bug_fix'
          : taskProfile.isModificationTask
            ? 'modification'
            : 'coding',
      ) || null;
    const executionPlan = await this.#executionPlanManager.createIfNeeded(userInput, taskProfile, {
      modelProvider: this.#modelProvider,
      intent,
      availableTools: this.#toolRegistry?.getAll?.().map((t) => t.name) || [],
      feedbackContext: decompositionFeedback,
    });
    const maxIterations =
      this.#intentClassifier?.budgetFor?.(taskProfile) ??
      computeIterationBudget(taskProfile.riskLevel, this.#config.maxIterations);
    this.#contextManager = new ContextManager({
      sessionManager: this.#sessionManager,
      contextPruner: this.#contextPruner,
      tokenScope: this.#tokenScope,
      workspaceState: this.#workspaceState,
      observationSummarizer: this.#observationSummarizer,
      config: { maxTokens: this.#config.maxTokens },
    });

    // ========== Step 4：编码任务增强 ==========
    let toolUseCorrections = 0;
    let codingGateCorrections = 0;
    let lastResponseText = '';

    // 探索预算计数器（仅编码任务）
    let explorationIterations = 0; // 仅有探索性工具调用的连续回合数
    let forceActionTriggered = false; // 是否已触发强制行动命令
    let forceActionIgnored = 0; // 强制命令被忽略的次数
    let zeroToolCallStreak = 0; // 连续零工具调用回合数

    // 动态探索预算：引擎已通过 WorkspaceIndex + ImportGraph + AgentMemory +
    // LSP diagnostics + plan context 预计算并注入了上下文。agent 仅需少量余量。
    // 注意：过于激进（如 3）会在复杂项目中误杀正常探索。现在：
    //   - Hashline 模式: 5 轮 (预注入上下文 + 原子编辑足够快，但允许读少量目标文件)
    //   - 编码任务模式: 8 轮 (无 Hashline 时 agent 可能需要更多文件阅读)
    //   - 非编码任务: EXPLORATION_BUDGET (10)
    const hasHashline = Boolean(this.#hashlinePatcher && this.#lspManager);
    const hasPreExploredContext = taskProfile.isCodingTask;
    let effectiveExplorationBudget;
    if (hasPreExploredContext && hasHashline) {
      // 引擎已预注入上下文 + Hashline 原子编辑 → 少量余量
      effectiveExplorationBudget = 5;
    } else if (hasPreExploredContext) {
      // 引擎已预注入上下文 → 允许适度的文件阅读
      effectiveExplorationBudget = 8;
    } else {
      effectiveExplorationBudget = EXPLORATION_BUDGET;
    }

    if (hasPreExploredContext) {
      this.#ui.debugEvent?.(
        `Pre-explored context active: exploration budget ${effectiveExplorationBudget} ` +
          `(engine pre-computed workspace structure, diagnostics, memory, and import graph).`,
      );
    }

    if (taskProfile.isCodingTask) {
      this.#ui.debugEvent?.('Coding task mode enabled', taskProfile);
      const basePrompt = buildCodingTaskOperatingPrompt({
        userInput,
        profile: taskProfile,
        semanticRiskGuidance: taskProfile.requiresSemanticRiskReview
          ? buildSemanticRiskGuidance(taskProfile.semanticRiskDomains)
          : '',
      });
      const strategy = await suggestVerificationStrategy(userInput, {
        workingDirectory: this.#config.workingDirectory,
      });
      this.#sessionManager.addUserMessage(`${basePrompt}\n\nVerification strategy:\n${strategy}`);
    }

    if (executionPlan) {
      this.#ui.debugEvent?.('Automatic task orchestration enabled', {
        plan: executionPlan.toJSON(),
      });
      this.#ui.debugEvent?.('Execution plan created', {
        plan: executionPlan.toJSON(),
        summary: this.#planSummary(executionPlan),
      });
      this.#sessionManager.addUserMessage(this.#executionPlanManager.buildPrompt());
    }

    // ============================================================
    // 预探索上下文注入：引擎利用 WorkspaceIndex + ImportGraph +
    // AgentMemory + LSP 预计算任务相关上下文，消除 agent 的
    // "探索"阶段 —— agent 看到的第一个上下文就已经包含了
    // 项目结构、关键符号、依赖关系、历史记忆和 diagnostics。
    // ============================================================
    if (taskProfile.isCodingTask) {
      // 同步注入：利用已缓存的数据（WorkspaceIndex 磁盘缓存、
      // ImportGraph、AgentMemory），不阻塞首轮迭代
      this.#injectPreExploredContextSync(userInput, taskProfile);

      // 异步增强管道：warm 索引 → 触发 LSP diagnostics → 注入综合上下文
      this.#warmAndInjectFullContext(userInput);
      this.#workspaceIndex.startPeriodicSync();
    }

    // ============================================================
    // 主循环：Thought → Action → Observation
    // ============================================================
    let iteration = 0;
    let pausedTurnContinuations = 0;
    const deadline = this.#config.deadline;

    while (iteration < maxIterations) {
      iteration++;

      if (this.#stopRequested) {
        return this.#completeRun({
          success: false,
          status: 'cancelled',
          answer: '',
          reason: 'user_stop',
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }

      if (deadline && Date.now() >= deadline) {
        return this.#completeRun({
          success: false,
          status: 'error',
          answer: '',
          reason: 'deadline_exceeded',
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }
      this.#ui.iteration?.(iteration, maxIterations);

      // 停滞检测：注入 nudge 或进度检查点
      const planSummary = executionPlan ? this.#planSummary(executionPlan) : null;
      const nudge = this.#stagnationDetector.nudge(iteration, maxIterations, { planSummary });
      if (nudge?.message) {
        this.#sessionManager.addUserMessage(nudge.message);
      }

      this.#ui.debugEvent?.('Iteration started', {
        iteration,
        maxIterations,
        sessionMessages: this.#sessionManager.getHistory().length,
        estimatedTokens: this.#sessionManager.getTokenCount?.() ?? 0,
      });

      // ========== 上下文窗口管理 ==========
      this.#contextManager.manage(iteration, maxIterations);

      // ========== OnDemandContextExpansion: 每轮评估置信度，按需扩展 ==========
      this.#expandContextOnDemand(iteration, maxIterations, executionPlan);

      // ========== Step 5：2 层路由 (intent → tool-router) ==========
      const currentTask = this.#executionPlanManager.currentTask;
      const currentPhase =
        currentTask?.phase ||
        (this.#executionPlanManager.plan?.status === TaskStatus.RUNNING
          ? this.#phaseFromIteration(iteration, maxIterations)
          : null);

      // 扁平化：统一使用 tool-router 做最终工具选择
      let routedTools = selectToolsForRequest(this.#toolRegistry.getAll(), {
        userInput,
        taskProfile,
        intent,
        currentPhase,
        currentTask,
      });

      // Progress-check mode keeps the full routed tool set available. A stalled
      // coding task may still need one precise read, diagnostic command, plan
      // repair, or user-owned fact before a safe mutation.
      let progressCheckSystemNote = null;
      if (forceActionTriggered) {
        const usableNames = routedTools.map((t) => t.name).join(', ');
        progressCheckSystemNote =
          `<!-- IMPLEMENTATION PROGRESS CHECK: The task is stalling. ` +
          `Usable tools: ${usableNames}. ` +
          `Choose one concrete evidence-based step: apply the smallest scoped edit if ready; ` +
          `otherwise gather the single missing fact, run a focused diagnostic or verification command, ` +
          `or call change_plan/ask_user when the plan is wrong or blocked. ` +
          `Do not repeat broad exploration or create report files. -->`;
      }
      const activeRoutedToolNames = new Set(routedTools.map((tool) => tool.name));
      const functions = this.#toolRegistry.toFunctionDefinitions(routedTools);
      const routedToolPrompt = [
        this.#textToolParser.generateToolPrompt(routedTools),
        `Workspace: all relative paths resolve from ${this.#config.workingDirectory}. ` +
          `Shell cwd is ${this.#config.workingDirectory}.`,
      ].join('\n\n');
      const messages = withRoutedToolContext(
        this.#sessionManager.getMessages(),
        routedToolPrompt,
        currentPhase,
      );

      // Inject progress-check note after routed tool context.
      if (progressCheckSystemNote) {
        messages.push({ role: 'system', content: progressCheckSystemNote });
      }

      // Inject soft tool requirement reminder if a tool keeps failing with empty args.
      this.#injectSoftToolRequirement(messages);

      // —— 注入本轮工作区上下文（多文件聚合快照）——
      if (this.#workspaceState && typeof this.#workspaceState.aggregateContext === 'function') {
        const wsCtx = this.#workspaceState.aggregateContext({
          maxFiles: 6,
          maxCharsPerFile: 500,
          maxTotalChars: 2400,
        });
        if (wsCtx && wsCtx.files && wsCtx.files.length > 0) {
          messages.push({
            role: 'system',
            content: `<!-- workspace-context: files=${wsCtx.files.join(',')} -->\n${wsCtx.summary || ''}`,
          });
        }
      }

      // ========== Step 6：LLM 调用（带重试 + 超时） ==========
      if (!this.#modelProvider || typeof this.#modelProvider.chat !== 'function') {
        if (this.#modelProvider !== null) {
          this.#ui.debugEvent?.('ModelProvider missing', { attemptingAutoLoad: true });
          try {
            loadRuntimeEnv();
            const provider = this.#config.provider || process.env.MODEL_PROVIDER || 'openai';
            const model = this.#config.model || process.env.MODEL || undefined;
            const apiUrl = this.#config.apiUrl || undefined;
            const apiKey = this.#config.apiKey || undefined;
            const temperature = this.#config.temperature || undefined;

            const providerConfig = {
              provider,
              model,
              apiUrl,
              apiKey,
              temperature,
            };

            const loadedProvider = await createConfiguredModelProvider(providerConfig, {
              debug: this.#config.debug || false,
              env: process.env,
            });

            if (loadedProvider && typeof loadedProvider.chat === 'function') {
              this.#modelProvider = loadedProvider;
              this.#ui.debugEvent?.('ModelProvider loaded from env', { provider });
            }
          } catch (loadError) {
            this.#ui.debugEvent?.('ModelProvider auto-load failed', { error: loadError.message });
          }
        }
      }

      if (!this.#modelProvider || typeof this.#modelProvider.chat !== 'function') {
        this.#ui.warn?.(
          '缺少 modelProvider，请在初始化时传入。engine.attachModelProvider() 可在运行时绑定',
        );
        return this.#completeRun({
          success: false,
          status: 'error',
          answer: null,
          reason:
            '未配置 modelProvider — 无法调用 LLM。请在初始化时传入 modelProvider，或通过 engine.attachModelProvider() 注入。',
          iterations: 0,
          startedAt: runStartedAt,
          userInputRequest: userInput,
        });
      }
      const llmStartedAt = Date.now();
      const llmAttemptsStart = 0;
      let llmAttempts = 0;
      let llmError = null;
      this.#ui.debugEvent?.('LLM request', {
        modelProvider: this.#modelProvider.constructor?.name || 'unknown',
        messageCount: messages.length,
        toolDefinitions: functions.length,
        routedToolNames: functions.map((tool) => tool.name),
        currentPhase,
        maxTokens: this.#config.maxTokens,
      });

      let response;
      try {
        const supportsStreaming =
          typeof this.#modelProvider.chatStream === 'function' &&
          process.env.AGENT_DISABLE_STREAMING !== 'true';

        let streamResult = null;
        if (supportsStreaming) {
          try {
            streamResult = await this.#modelProvider.chatStream(messages, {
              functions,
              maxTokens: this.#config.maxTokens,
            });
          } catch (_) {
            streamResult = null;
          }
        }
        const hasValidStream =
          streamResult &&
          typeof streamResult.stream === 'function' &&
          typeof streamResult.finalize === 'function';

        if (hasValidStream) {
          // ===== 优先走流式分支：逐 token 推送增量到 UI =====
          // 使用 ToolProtocolStreamFilter 缓冲并过滤工具协议文本，
          // 避免裸 JSON（如 {"action": {"tool_name": {...}}}）被当作用户可见文本显示到 UI
          const protoFilter = createProtocolStreamFilter();

          response = await this.#retryStrategy.executeWithRetry(async () => {
            llmAttempts++;
            return await withTimeout(
              async () => {
                // 迭代增量事件，经协议过滤后转发到 UI
                for await (const evt of streamResult.stream()) {
                  if (!evt) {
                    continue;
                  }

                  if (evt.type === 'text_delta' && evt.text) {
                    const out = protoFilter.push(evt.text);
                    if (out.visibleText) {
                      this.#ui.onTextDelta?.(out.visibleText);
                    }
                    if (out.protocolDetected) {
                      this.#ui.debugEvent?.('Tool protocol text suppressed from stream', {
                        reason: 'tool_call_text_protocol',
                        preview: out.protocolPreview,
                      });
                    }
                  } else if (evt.type === 'reasoning_delta' && evt.text) {
                    this.#ui.onReasoningDelta?.(evt.text);
                  } else if (evt.type === 'tool_call_delta') {
                    this.#ui.onToolCallDelta?.({
                      index: evt.index,
                      name: evt.name,
                      arguments: evt.arguments,
                    });
                  }
                  // usage / finish 不转发 UI
                }
                const flushed = protoFilter.flush();
                if (flushed.visibleText) {
                  this.#ui.onTextDelta?.(flushed.visibleText);
                }
                if (flushed.protocolDetected) {
                  this.#ui.debugEvent?.('Tool protocol text suppressed from stream', {
                    reason: 'tool_call_text_protocol',
                    preview: flushed.protocolPreview,
                  });
                }
                // finalize() 返回 chat() 同结构的完整响应
                return await streamResult.finalize();
              },
              120000,
              'LLM streaming call',
            );
          });
        } else {
          // ===== 原有非流式分支 =====
          response = await this.#retryStrategy.executeWithRetry(async () => {
            llmAttempts++;
            return withTimeout(
              () =>
                this.#modelProvider.chat(messages, {
                  functions,
                  maxTokens: this.#config.maxTokens,
                }),
              120000,
              'LLM call',
            );
          });
        }
        response = normalizeModelResponse(response);
        // —— LLM 成功 metrics ——
        try {
          const modelName =
            this.#modelProvider.getModelName?.() ||
            this.#modelProvider.constructor?.name ||
            'unknown';
          metricsSink.recordLLMRequest({
            runId: this.#lastRunResult?.runId,
            model: modelName,
            durationMs: Date.now() - llmStartedAt,
            tokensIn: response.usage?.inputTokens,
            tokensOut: response.usage?.outputTokens,
            success: true,
            attempt: llmAttempts,
          });
        } catch (_) {
          /* 忽略 */
        }
      } catch (error) {
        llmError = error instanceof Error ? error.message : String(error);
        // —— LLM 失败 metrics ——
        try {
          metricsSink.recordLLMRequest({
            runId: this.#lastRunResult?.runId,
            model:
              this.#modelProvider.getModelName?.() ||
              this.#modelProvider.constructor?.name ||
              'unknown',
            durationMs: Date.now() - llmStartedAt,
            success: false,
            error: llmError,
            attempt: llmAttempts,
          });
        } catch (_) {
          /* 忽略 */
        }
        throw error;
      }
      lastResponseText = response?.text || '';

      this.#ui.debugEvent?.('LLM response', {
        durationMs: Date.now() - llmStartedAt,
        attempts: llmAttempts,
        failureReason: llmError,
        finishReason: response.finishReason,
        textPreview: this.#preview(response.text, 300),
        nativeToolCalls: response.toolCalls?.length || 0,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      });

      // TokenScope: 记录 token 成本
      try {
        const modelName =
          this.#modelProvider.getModelName?.() ||
          this.#modelProvider.constructor?.name ||
          'unknown';
        let inputTokens;
        let outputTokens;
        if (response.usage && response.usage.inputTokens != null) {
          inputTokens = response.usage.inputTokens;
          outputTokens = response.usage.outputTokens || Math.ceil((response.text || '').length / 4);
        } else {
          let inputChars = 0;
          for (const msg of messages) {
            inputChars += (
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '')
            ).length;
          }
          inputTokens = Math.ceil(inputChars / 4);
          outputTokens = Math.ceil((response.text || '').length / 4);
        }
        this.#tokenScope.recordRequest({
          model: modelName,
          inputTokens,
          outputTokens,
          userId: 'global',
          metadata: { source: 'agent-run', iteration: iteration },
        });
      } catch {
        /* Token accounting best-effort, 不影响主循环 */
      }

      this.#ui.debug?.(`Response: ${(response.text || '').substring(0, 200)}...`);

      // ========== Step 7：工具调用解析（native + text-based） ==========
      const nativeToolCalls = response.toolCalls || [];
      const parsedToolCalls =
        nativeToolCalls.length === 0 ? this.#textToolParser.parse(response.text) : [];
      const allToolCalls = [...nativeToolCalls, ...parsedToolCalls];

      // Check soft tool requirement: if a required tool was called, clear it; otherwise escalate.
      const softReqResult = this.#checkSoftToolRequirement(allToolCalls);
      if (softReqResult && !softReqResult.shouldExecute) {
        return this.#completeRun({
          success: false,
          status: 'error',
          answer: '',
          reason: softReqResult.skipReason,
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }

      if (allToolCalls.length > 0) {
        this.#ui.debugEvent?.('Tool calls detected', {
          native: nativeToolCalls.map((call) => ({ name: call.name, arguments: call.arguments })),
          parsed: parsedToolCalls.map((call) => ({
            name: call.name,
            arguments: call.arguments,
            source: call.source,
          })),
        });
      }

      // -------- 短路 1：工具语法纠正（LLM 返回不合法工具调用格式） --------
      // This must run before any "provider stop => final answer" shortcut.
      // Plan-action protocol can arrive inside plain text/fences, and if it is malformed
      // we should ask for a valid tool call instead of leaking it as the final answer.
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() &&
        toolUseCorrections < 2 &&
        containsUnparsedSyntax(this.#textToolParser, response.text)
      ) {
        toolUseCorrections++;
        this.#ui.debugEvent?.('Tool syntax correction requested', {
          iteration,
          correction: toolUseCorrections,
          responsePreview: this.#preview(response.text, 300),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          buildToolSyntaxCorrectionPrompt(this.#textToolParser, this.#toolRegistry, response.text),
        );
        continue;
      }

      // -------- 短路 2：移除（计划完成必须通过 FINAL_ANSWER 标记） --------
      // 计划任务结束只有一个条件：所有阶段性任务已经结束，并且已经对完成的任务做了总结
      // 因此移除这个直接结束的条件，确保必须通过 FINAL_ANSWER 标记才能结束

      // -------- 短路 3：工具使用纠正（LLM 说"我没有工具"） --------
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() &&
        toolUseCorrections < 2 &&
        shouldCorrectRefusal(this.#toolRegistry, userInput, response.text)
      ) {
        toolUseCorrections++;
        this.#ui.debugEvent?.('Tool use correction requested', {
          iteration,
          correction: toolUseCorrections,
          responsePreview: this.#preview(response.text, 300),
          userInputPreview: this.#preview(userInput, 160),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          buildToolUseCorrectionPrompt(this.#toolRegistry, userInput),
        );
        continue;
      }

      // -------- 短路 4：编码任务完成门（还没工具证据 / 没走完 plan 就说完成） --------
      const shouldBlockFinal =
        allToolCalls.length === 0 &&
        codingGateCorrections < 3 &&
        shouldBlockCodingFinal(userInput, response.text, {
          taskProfile,
          toolEvents: this.#toolExecutor.events,
          executionPlanIsCompleted: this.#executionPlanManager.isCompleted,
          planSummary,
        });

      if (shouldBlockFinal.block) {
        codingGateCorrections++;
        this.#ui.debugEvent?.('Coding completion gate requested', {
          iteration,
          correction: codingGateCorrections,
          reason: shouldBlockFinal.reason,
          evidence: shouldBlockFinal.evidence,
          responsePreview: this.#preview(response.text, 300),
        });
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          buildCodingCompletionGatePrompt(userInput, shouldBlockFinal),
        );
        continue;
      }

      // -------- 内部标签泄漏：模型输出 <dsml>/<info>/<thinking>/<plan> 等内部标签后停止，无工具调用 --------
      // 与 <action> 不同：<action> 是合法工具调用格式被 parser 解析消耗；
      // <dsml> / <info> / <thinking> / <plan> / <analysis> 等不是工具格式，parser 完全不理，
      // 原样留在 text 里。若直接 addAssistantMessage 进入 session 上下文，
      // 模型会被自己泄漏的标签污染，下一轮继续输出死循环。
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() &&
        looksLikeLeakedThinking(response.text)
      ) {
        // 剥离所有非工具 XML 标签再写入 session，防止污染上下文
        const cleanText = response.text.replace(ANY_XML_TAG, '').replace(DSML_PIPE_TAG, '').trim();
        const assistantMsg = cleanText || '(thinking)';
        this.#sessionManager.addAssistantMessage(assistantMsg);
        this.#sessionManager.addUserMessage(
          'You output internal thinking tags but did not execute any tools. ' +
            'Stop thinking out loud and ACT. Immediately call tools (write_file, shell, etc.) ' +
            'to perform the task. DO NOT emit any XML tags — just execute.',
        );
        this.#ui.debugEvent?.('Internal tag leak detected - nudge to execute', {
          iteration,
          preview: this.#preview(response.text, 200),
        });
        continue;
      }

      // -------- 短路 4.5：虚构工具执行（模型编造了完整执行过程，但实际零工具调用） --------
      if (
        allToolCalls.length === 0 &&
        response.text?.trim() &&
        looksLikeFakeExecution(response.text, this.#toolExecutor.events.length)
      ) {
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          'CRITICAL: You described completed work (files created, build passed, etc.) but you have ' +
            'NOT actually called any tools. This is hallucination. You MUST call the actual tools ' +
            '(write_file, shell, etc.) to do the real work. Do NOT fabricate builds, file contents, ' +
            'or verification results. Execute tools NOW — create the files and run the build yourself.',
        );
        this.#ui.debugEvent?.('Fake execution detected - nudge to execute', {
          iteration,
          preview: this.#preview(response.text, 200),
          toolEventsInSession: this.#toolExecutor.events.length,
        });
        this.#ui.warn?.('检测到模型虚构工具执行结果，已注入修正提示。');
        continue;
      }

      // -------- 短路 5：FINAL_ANSWER 标记终止 --------
      // 计划任务结束只有一个条件：所有阶段性任务已经结束，并且已经对完成的任务做了总结
      // 如果计划正在执行中，即使有FINAL_ANSWER标记也不允许结束
      if (
        isTerminationResponse(response.text) &&
        (!this.#executionPlanManager.isActive || this.#executionPlanManager.isCompleted)
      ) {
        const answer = normalizeFinalAnswer(extractFinalAnswer(response.text));

        // 程序化验证：检查测试是否真的通过
        const toolEvents =
          this.#executionPlanManager?.getToolEventHistory?.() ||
          this.#toolExecutor?.getToolEventHistory?.() ||
          [];
        const planSteps = this.#executionPlanManager?.getPlanSteps?.() || null;
        if (toolEvents.length > 0) {
          const vResult = verifyCompletion({ toolEvents, planSteps });
          if (!vResult.passed) {
            this.#ui.debugEvent?.('Verification blocked completion', {
              details: vResult.details,
              guidance: vResult.guidance,
            });
            this.#sessionManager.addAssistantMessage(response.text);
            this.#sessionManager.addSystemMessage(vResult.guidance);
            continue;
          }
        }

        this.#ui.debugEvent?.('Final answer emitted', {
          iteration,
          totalDurationMs: Date.now() - runStartedAt,
          answerPreview: this.#preview(answer, 300),
        });
        this.#ui.finalAnswer?.(answer);
        this.#sessionManager.addAssistantMessage(response.text);
        return this.#completeRun({
          success: true,
          status: 'completed',
          answer,
          reason: 'final_answer_marker',
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }

      // -------- intent-to-read detection: 模型说要阅读代码，但未实际发起工具调用 --------
      // 优先级高于 plan-only：当模型表达了阅读意图，应该提示 read 工具而非 write/shell
      if (
        allToolCalls.length === 0 &&
        response.finishReason === 'stop' &&
        response.text?.trim() &&
        looksLikeIntentToReadWithoutTools(response.text)
      ) {
        const currentTask = this.#executionPlanManager.currentTask;
        const createFromScratch = Boolean(executionPlan?.context?.createFromScratch);
        const shouldForceCreation =
          createFromScratch ||
          currentTask?.phase === 'implementation' ||
          /\b(create|new|setup|implement|write|skeleton|scaffold|from scratch)\b|创建|新建|搭建|实现|工程化/.test(
            `${currentTask?.id || ''} ${currentTask?.name || ''} ${currentTask?.description || ''}`,
          );
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addSystemMessage(
          shouldForceCreation
            ? '[EXECUTION CHECK] You expressed intent to inspect/read, but the current task is create/implementation work. If the workspace root has not been observed in this run, call list_dir on "."; otherwise read only the one relevant existing file/section needed before editing. If the target is already clear, create or edit the project files now. If information is missing, call ask_user; do not continue prose-only analysis.'
            : '[EXECUTION CHECK] You expressed intent to read / understand the codebase but did not execute any tool calls. Your next response should call a concrete read/search tool or explain the blocker with FINAL_ANSWER when no tool can help. Do not describe what you will read without doing it.',
        );
        this.#ui.debugEvent?.('Nudge: intent to read without tools', {
          iteration,
          preview: this.#preview(response.text, 200),
          forcedStrategy: shouldForceCreation ? 'create_or_edit' : 'read_tools',
        });
        continue;
      }

      // -------- 短路 5：暂停轮次保护（pause_turn）--------
      // 当 provider 返回 stop 但没有工具调用且是暂停轮次时，允许重新采样
      // 但限制连续暂停次数，防止无限循环
      if (
        allToolCalls.length === 0 &&
        response.finishReason === 'stop' &&
        response.text?.trim() &&
        response.stopDetails?.type === 'pause_turn' &&
        pausedTurnContinuations < MAX_PAUSED_TURN_CONTINUATIONS
      ) {
        pausedTurnContinuations++;
        this.#ui.debugEvent?.('Paused turn continuation', {
          iteration,
          continuations: pausedTurnContinuations,
          maxContinuations: MAX_PAUSED_TURN_CONTINUATIONS,
        });
        continue;
      }

      // -------- plan-only detection: 模型只列计划不执行 → nudge 继续 --------
      // 纯信息型问题（解释/聊天/知识查询）不拦截——文本回答本身就是完整交付物
      // isInformationalQuery 由 LLM 意图分类判定（语言无关），非响应文本关键词匹配
      if (
        allToolCalls.length === 0 &&
        response.finishReason === 'stop' &&
        response.text?.trim() &&
        !taskProfile.isInformationalQuery &&
        looksLikePlanWithoutExecution(response.text)
      ) {
        this.#sessionManager.addAssistantMessage(response.text);
        this.#sessionManager.addUserMessage(
          'You described what you will do but did not execute any tool calls. ' +
            'Immediately use the available tools (write_file, shell, etc.) to actually ' +
            'create the files or run the commands you listed. ' +
            'Do NOT repeat the plan — EXECUTE it now with tool calls.',
        );
        this.#ui.debugEvent?.('Nudge: plan without execution', {
          iteration,
          preview: this.#preview(response.text, 200),
        });
        continue;
      }

      // -------- 短路 6：无工具调用但 provider 说 stop → 视作最终回答 --------
      // 计划任务结束只有一个条件：所有阶段性任务已经结束，并且已经对完成的任务做了总结
      // 如果计划正在执行中，即使 provider 说 stop 也不能直接结束
      if (
        allToolCalls.length === 0 &&
        response.finishReason === 'stop' &&
        response.text?.trim() &&
        !this.#executionPlanManager.isActive
      ) {
        const answer = normalizeFinalAnswer(response.text);

        // 程序化验证：检查测试是否真的通过
        const toolEvents = this.#toolExecutor?.getToolEventHistory?.() || [];
        const planSteps = this.#executionPlanManager?.getPlanSteps?.() || null;
        if (toolEvents.length > 0) {
          const vResult = verifyCompletion({ toolEvents, planSteps });
          if (!vResult.passed) {
            this.#ui.debugEvent?.('Verification blocked completion', {
              details: vResult.details,
              guidance: vResult.guidance,
              reason: 'provider_stop_no_tools',
            });
            this.#sessionManager.addAssistantMessage(response.text);
            this.#sessionManager.addSystemMessage(vResult.guidance);
            continue;
          }
        }

        this.#ui.debugEvent?.('Final answer emitted', {
          iteration,
          totalDurationMs: Date.now() - runStartedAt,
          answerPreview: this.#preview(answer, 300),
          reason: 'provider_stop_no_tools',
        });
        this.#ui.finalAnswer?.(answer);
        this.#sessionManager.addAssistantMessage(response.text);
        return this.#completeRun({
          success: true,
          status: 'completed',
          answer,
          reason: 'provider_stop_no_tools',
          iterations: iteration,
          startedAt: runStartedAt,
        });
      }

      // ================================================================
      // Progress-Aware 探索预算 + 零调用硬约束（仅编码任务）
      //
      // 注意：有工具调用的进展判断移到工具执行之后（基于真实执行结果）。
      // 这里只处理零工具调用的情况。
      // ================================================================
      if (taskProfile.isCodingTask) {
        if (allToolCalls.length === 0) {
          zeroToolCallStreak++;
          explorationIterations++;
        } else {
          zeroToolCallStreak = 0;
        }

        // 连续 5+ 零工具调用回合：强打断
        // 计划任务结束只有一个条件：所有阶段性任务已经结束，并且已经对完成的任务做了总结
        // 如果计划正在执行中，不允许因为零工具调用而直接返回错误状态
        if (zeroToolCallStreak >= 5 && allToolCalls.length === 0) {
          this.#sessionManager.addAssistantMessage(response.text);
          this.#sessionManager.addUserMessage(
            `[HARD STOP] ${zeroToolCallStreak} consecutive responses with ZERO tool calls. ` +
              'You are stuck in an analysis loop. ' +
              `${zeroToolCallStreak >= 7 ? 'THIS IS YOUR LAST CHANCE. ' : `You will be TERMINATED in ${8 - zeroToolCallStreak} more zero-call response(s). `}` +
              'Take one concrete action now: edit if the target is clear, gather the one missing fact with a tool, replan/ask_user if blocked, OR provide FINAL_ANSWER with the actual blocker. ' +
              'No more prose-only analysis.',
          );
          if (zeroToolCallStreak >= 8 && !this.#executionPlanManager.isActive) {
            return this.#completeRun({
              success: false,
              status: 'error',
              answer: response.text?.trim() || '',
              reason: 'zero_tool_call_timeout',
              iterations: iteration,
              startedAt: runStartedAt,
            });
          }
          continue;
        }
      }

      // -------- 常规路径：执行工具调用 --------
      if (allToolCalls.length > 0) {
        pausedTurnContinuations = 0;
        const visibleText = stripActionBlocks(response.text, { toolRegistry: this.#toolRegistry });
        if (visibleText) {
          this.#sessionManager.addAssistantMessage(visibleText);
        }
      } else {
        this.#sessionManager.addAssistantMessage(response.text);
      }

      if (allToolCalls.length === 0) {
        // provider 没触发 stop，也没有工具调用 → 轻推一下避免死循环
        if (iteration >= maxIterations - 1) {
          const answer = response.text.trim();
          this.#ui.finalAnswer?.(answer);
          return this.#completeRun({
            success: true,
            status: 'completed',
            answer,
            reason: 'iteration_budget_exhausted',
            iterations: iteration,
            startedAt: runStartedAt,
          });
        }
        this.#sessionManager.addUserMessage(
          'Please either provide a FINAL_ANSWER or call a tool to continue.',
        );
        continue;
      }

      // 执行每个工具调用（ToolExecutor 统一处理：安全策略、缓存、规范化）
      const execResults = [];
      let userInputResolved = false;
      for (const toolCall of allToolCalls) {
        const toolStart = Date.now();
        const toolName = toolCall.name || toolCall.function?.name || 'unknown';
        let toolArgs = toolCall.arguments || toolCall.function?.arguments || {};

        if (this.#fileStore && this.#sessionId) {
          this.#fileStore
            .appendToolCall(this.#sessionId, toolName, toolArgs, this.#config.workingDirectory)
            .catch((error) => {
              console.error('[AgentEngine] Failed to write tool call:', error.message);
            });
        }

        const execResult = await this.#toolExecutor.execute(
          toolCall,
          {
            memoryManager: this.#memoryManager,
            sessionManager: this.#sessionManager,
            modelProvider: this.#modelProvider,
            debug: this.#config.debug || false,
            activePlanManager: this.#executionPlanManager,
            activePlan: this.#executionPlanManager.plan,
            currentTask: this.#executionPlanManager.currentTask,
            activeRoutedToolNames,
            scopeFiles: this.#executionPlanManager.currentTask?.scopeFiles || [],
            workspaceState: this.#workspaceState,
          },
          {
            resultMode: 'tool',
            emitObservation: (id, name, observation, _mode) => {
              this.#sessionManager.addUserMessage(`[Tool ${name}] ${observation}`);
            },
          },
        );
        const toolDuration = Date.now() - toolStart;
        if (typeof execResult === 'object' && execResult !== null) {
          execResult.durationMs = toolDuration;
        }
        this.#ui.debugEvent?.('tool_result', {
          toolName: execResult.name,
          success: !execResult.error && !execResult.skipped,
          durationMs: toolDuration,
          error: execResult.error ? String(execResult.error).substring(0, 200) : null,
        });

        // —— 工具调用 metrics ——
        try {
          metricsSink.recordToolCall({
            runId: this.#lastRunResult?.runId,
            toolName: execResult.name,
            durationMs: toolDuration,
            success: !execResult.error && !execResult.skipped,
            error: execResult.error ? String(execResult.error) : null,
            skipped: !!execResult.skipped,
          });
        } catch (_) {
          /* 忽略 */
        }

        // 将工具结果添加到对话历史，供 LLM 下一轮使用
        if (typeof execResult === 'object' && execResult !== null) {
          const toolResultContent =
            typeof execResult.result === 'string'
              ? execResult.result
              : JSON.stringify(execResult.result || '');
          this.#sessionManager.addToolResult(
            toolCall.id || `tool_${Date.now()}`,
            execResult.name,
            toolResultContent,
            execResult.error || execResult.skipped
              ? SessionManager.PRIORITY.EVIDENCE
              : SessionManager.PRIORITY.DECISION,
          );
        }

        // —— Supersede：写入后使旧的 read_file 结果失效 ——
        toolArgs = execResult.args || toolCall.arguments || {};
        const filePath = toolArgs.path || toolArgs.file_path || '';
        if (!execResult.error && !execResult.skipped) {
          if (execResult.name === 'read_file' && filePath && toolCall.id) {
            this.#sessionManager.trackReadFileResult(toolCall.id, filePath);
          }
          const mutationTools = new Set([
            'write_file',
            'edit_file',
            'delete_file',
            'rename_file',
            'apply_hashline_patch',
          ]);
          if (mutationTools.has(execResult.name) && filePath) {
            this.#sessionManager.supersedeFileReads(filePath);
          }
        }

        // 记录到停滞检测
        // 使用 isLandedMutation：只有执行成功且真正有内容变更的才算 mutation
        this.#stagnationDetector.recordTool(
          execResult.name,
          execResult.args || toolCall.arguments,
          iteration,
          () => isLandedMutation(execResult),
        );

        // 工具空参失败跟踪：为软工具要求机制积累证据
        if (!execResult.success && !execResult.skipped && !execResult.cached) {
          const errorText = String(execResult.error || execResult.result || '');
          if (
            /missing required param/i.test(errorText) ||
            /参数校验失败/i.test(errorText) ||
            /SCHEMA_VALIDATION/i.test(errorText)
          ) {
            this.#trackToolArgFailure(execResult.name);
          }
        }

        // 工作区状态更新
        if (this.#workspaceState) {
          if (typeof this.#workspaceState.onToolEvent === 'function') {
            this.#workspaceState.onToolEvent(execResult);
          } else if (typeof this.#workspaceState.recordToolResult === 'function') {
            const success =
              !execResult.error &&
              !execResult.skipped &&
              !String(execResult.result ?? '').startsWith('Error:') &&
              !String(execResult.result ?? '').startsWith('FACT_BLOCKED:');
            this.#workspaceState.recordToolResult(
              execResult.name,
              execResult.args || toolCall.arguments || {},
              execResult.result,
              success,
            );
          }
        }

        // 推进执行计划
        if (this.#executionPlanManager.plan) {
          const planUpdate = this.#executionPlanManager.advance(
            execResult.name,
            execResult.args || toolCall.arguments,
            execResult.result,
            execResult,
          );
          if (planUpdate) {
            this.#ui.debugEvent?.('Execution plan updated', {
              toolName: execResult.name,
              update: planUpdate,
              plan: this.#executionPlanManager.plan.toJSON(),
              summary: this.#planSummary(this.#executionPlanManager.plan),
            });
          }
        }

        // ========== 反馈闭环 L2: Hashline 冲突检测 → 动态重规划 ==========
        this.#detectAndHandleHashlineConflict(execResult);

        // ========== ask_user 挂起检测：如果工具返回需要用户输入，挂起主循环等待 ==========
        if (execResult.name === 'ask_user' && this.#isUserInputRequired(execResult.result)) {
          const userInput = await this.#suspendForUserInput(execResult.result);
          // 恢复后，将用户回答作为 observation 注入会话
          const answerText = typeof userInput === 'string' ? userInput : JSON.stringify(userInput);
          this.#sessionManager.addUserMessage(
            `[User input provided] ${answerText}\n\n(This is the answer to your previous ask_user call. Use this information and continue working on the task.)`,
          );
          this.#ui.debugEvent?.('User input received, resuming', {
            preview: this.#preview(answerText, 200),
          });
          // 标记用户输入已处理，跳过剩余工具调用，直接进入下一轮迭代
          userInputResolved = true;
          break;
        }

        execResults.push(execResult);
      }

      // 如果这一轮因为 ask_user 挂起后恢复了，直接进入下一轮迭代（不再做进展检查等）
      if (userInputResolved) {
        iteration++;
        continue;
      }

      // ================================================================
      // 基于真实执行结果的进展判断 + 探索预算检查（仅编码任务）
      //
      // 之前这里是基于工具名 + 参数的预判断（在执行前），现在移到执行后，
      // 依据真实的 execResult（成功/失败、结果内容）来判断，避免：
      // 1. 失败的编辑也被算作进展
      // 2. hasSearchHit 依赖尚不存在的 _result
      // ================================================================
      if (taskProfile.isCodingTask && execResults.length > 0) {
        const planTasks = executionPlan ? Array.from(executionPlan.tasks?.values() || []) : [];
        const runningTask = planTasks.find((t) => t.status === TaskStatus.RUNNING);
        const scopeFiles = new Set(runningTask?.scopeFiles || []);

        let hasMeaningfulProgress = false;
        let allPartial = true;

        for (const execResult of execResults) {
          const filePath =
            execResult.args?.filePath || execResult.args?.path || execResult.args?.file || '';
          const isInScope =
            scopeFiles.size > 0 &&
            (scopeFiles.has(filePath) ||
              Array.from(scopeFiles).some((sf) => filePath.includes(sf)));

          const progress = isProgressFromResult(execResult, { isInScope });

          if (progress === true) {
            hasMeaningfulProgress = true;
            allPartial = false;
          } else if (progress !== 'partial') {
            allPartial = false;
          }
        }

        if (hasMeaningfulProgress) {
          explorationIterations = 0;
          forceActionTriggered = false;
          forceActionIgnored = 0;
        } else if (allPartial) {
          // 保持当前计数
        } else {
          explorationIterations++;
        }

        // 中期作用域提醒：预算过半 + 有执行计划
        if (
          executionPlan &&
          explorationIterations >= Math.ceil(effectiveExplorationBudget * 0.5) &&
          !forceActionTriggered
        ) {
          const scopeHint =
            runningTask && runningTask.scopeFiles?.length
              ? `Current subtask scope: ${runningTask.scopeFiles.join(', ')}. Only read files within this scope.`
              : 'Focus on the CURRENT subtask only — do not pre-read files for future subtasks. The plan DAG shows which files belong to each subtask.';
          this.#sessionManager.addSystemMessage(
            `[SCOPE REMINDER] You have read for ${explorationIterations} round(s) without producing decisive progress. ` +
              `${scopeHint} The engine has pre-indexed the workspace — trust the pre-computed context. ` +
              `Prefer precise symbol/diagnostic/context tools over broad exploration. ` +
              `When ready to edit, read only the specific section with offset+limit or apply the scoped change.`,
          );
          this.#ui.debugEvent?.('Scope reminder injected', {
            iteration,
            explorationIterations,
            budget: effectiveExplorationBudget,
            runningTask: runningTask?.name,
            scopeFiles: runningTask?.scopeFiles,
          });
        }

        // 预算耗尽：触发 progress check
        if (explorationIterations >= effectiveExplorationBudget && !forceActionTriggered) {
          forceActionTriggered = true;
          this.#sessionManager.addUserMessage(
            `[IMPLEMENTATION PROGRESS CHECK] ` +
              `You have spent ${explorationIterations} iterations reading/exploring without producing decisive progress.\n` +
              `(Budget: ${effectiveExplorationBudget} iterations — the engine already pre-injected workspace structure, diagnostics, project memory, and execution plan for you)\n\n` +
              `No tools are blocked by this checkpoint; routing and security still decide what is callable. ` +
              `The next step must be narrow and evidence-based.\n\n` +
              `You have ${FORCE_ACTION_GRACE_TURNS} chances left. If you produce ${FORCE_ACTION_GRACE_TURNS} more rounds without decisive progress, ` +
              `you will be TERMINATED with reason "exploration_budget_exhausted".\n\n` +
              'Choose one: apply the scoped edit; gather the single missing fact; run a focused diagnostic/verification command; call change_plan/ask_user; or provide FINAL_ANSWER explaining the blocker.',
          );
          this.#ui.debugEvent?.('Force action triggered', {
            iteration,
            explorationIterations,
            budget: effectiveExplorationBudget,
          });
        } else if (forceActionTriggered && explorationIterations > effectiveExplorationBudget) {
          forceActionIgnored++;
          const remaining = FORCE_ACTION_GRACE_TURNS - forceActionIgnored;
          if (
            forceActionIgnored >= FORCE_ACTION_GRACE_TURNS &&
            !this.#executionPlanManager.isActive
          ) {
            return this.#completeRun({
              success: false,
              status: 'error',
              answer:
                `Agent spent ${explorationIterations} iterations exploring without decisive progress, ` +
                `and ignored the implementation progress checkpoint (${FORCE_ACTION_GRACE_TURNS} warnings given).`,
              reason: 'exploration_budget_exhausted',
              iterations: iteration,
              startedAt: runStartedAt,
            });
          }
          this.#sessionManager.addUserMessage(
            `[FINAL WARNING ${forceActionIgnored}/${FORCE_ACTION_GRACE_TURNS}] ` +
              `You have ignored the implementation progress checkpoint for ${forceActionIgnored} iteration(s). ` +
              `You will be TERMINATED in ${remaining} more iteration(s) without decisive progress. ` +
              `Take a concrete evidence-based step now: scoped edit, focused read/diagnostic, change_plan, ask_user, or FINAL_ANSWER with the blocker.`,
          );
        }
      }

      // ========== Closed-Loop Memory Refresh ==========
      // edit → addEpisodic() → refresh layer4_memory → 下一轮 LLM 看到更新后的记忆
      // 这修复了之前记忆闭环的断裂点：memory 在 run 内可见，而非仅跨 run 可见。
      this.#refreshMemoryAfterTools(execResults);
    }

    // 达到迭代上限仍未完成
    const lastText = lastResponseText.trim();
    const fallback = lastText || 'Agent 达到迭代上限仍未完成任务。';
    this.#ui.finalAnswer?.(fallback);
    return this.#completeRun({
      success: false,
      status: 'iteration_limit',
      answer: fallback,
      reason: 'max_iterations_exceeded',
      iterations: maxIterations,
      startedAt: runStartedAt,
    });
  }

  /** 中断当前 run（在下一次 while 循环检查时退出） */
  stop() {
    this.#stopRequested = true;
  }

  /** 挂载 modelProvider（支持两步初始化：先构造引擎，再连模型） */
  attachModelProvider(provider) {
    this.#modelProvider = provider;
  }

  /** 动态更新工作目录。下次 run/processInput 将使用新路径 */
  setWorkingDirectory(directory) {
    if (!this.#config || typeof directory !== 'string' || !directory.trim()) {
      return;
    }
    this.#config.workingDirectory = directory;
    this.#systemPromptInitialized = false;
    this.#workspaceState?.clear?.();
    this.#contextManager?.clear?.();

    // 同步更新依赖组件，确保目录切换后所有子系统都在新目录下工作
    if (typeof this.#workspaceIndex?.setWorkingDirectory === 'function') {
      this.#workspaceIndex.setWorkingDirectory(directory);
    }

    // 重置 ToolExecutor 缓存状态，确保下次工具调用从新目录加载缓存
    if (typeof this.#toolExecutor?.reset === 'function') {
      this.#toolExecutor.reset();
    }
  }

  /** 访问当前配置（只读，工作目录等信息可用于 UI 展示） */
  getConfig() {
    return this.#config;
  }

  /** 访问当前 ToolRegistry（用于调试 / 动态注册） */
  getToolRegistry() {
    return this.#toolRegistry;
  }

  /** 访问当前 SecurityPolicy（用于只读展示） */
  getSecurityPolicy() {
    return this.#config.securityPolicy || null;
  }

  /** 访问当前 WorkspaceState（用于外部订阅 / 聚和上下文） */
  getWorkspaceState() {
    return this.#workspaceState;
  }

  getSessionManager() {
    return this.#sessionManager;
  }

  getFileStore() {
    return this.#fileStore;
  }

  getSessionId() {
    return this.#sessionId;
  }

  setSessionId(sessionId) {
    this.#sessionId = sessionId;
    if (this.#sessionManager) {
      this.#sessionManager.setSessionId(sessionId);
    }
  }

  async flushSession() {
    if (this.#sessionManager && typeof this.#sessionManager.flush === 'function') {
      await this.#sessionManager.flush();
    }
  }

  /** 是否处于等待用户输入状态（ask_user 挂起中） */
  get isWaitingForUserInput() {
    return this.#pendingUserInputRequest !== null;
  }

  /** 获取待处理的用户输入请求（如果有） */
  get pendingUserInputRequest() {
    return this.#pendingUserInputRequest;
  }

  /**
   * 恢复被 ask_user 挂起的执行循环。
   * 注入用户回答作为 observation，继续下一轮迭代。
   */
  resumeWithUserInput(userInput) {
    if (!this.#userInputResolve) {
      return false;
    }
    const resolve = this.#userInputResolve;
    this.#userInputResolve = null;
    this.#pendingUserInputRequest = null;
    resolve(userInput);
    return true;
  }

  /** 最近一次 run 的结果 */
  getRunResult() {
    return this.#lastRunResult ? { ...this.#lastRunResult } : null;
  }

  /** 当前使用的路由工具名集合（用于调试 / UI 展示） */
  getActiveToolNames() {
    const profile = quickAssess('');
    return selectToolsForRequest(this.#toolRegistry.getAll(), {
      userInput: '',
      taskProfile: profile,
      currentPhase: this.#phaseFromIteration(0, this.#config.maxIterations),
    }).map((t) => t.name);
  }

  /** 工作区摘要（调试 / UI 展示） */
  getWorkspaceSummary() {
    return {
      state: this.#workspaceState.getSummary?.() ?? null,
      criticalFacts: this.#workspaceState.getCriticalFacts?.() ?? [],
      workspaceDescription: this.#observationSummarizer?.generateWorkspaceDescription?.() || '',
    };
  }

  // ============================================================
  // 兼容层：供 DesktopCore / CLI / IPC 调用
  // ============================================================

  /** 幂等初始化（DesktopCore 在 initialize() 中调用） */
  initialize() {
    return this;
  }

  /** 引擎是否已初始化（兼容旧 API） */
  isInitialized() {
    return true;
  }

  /** 返回引擎状态（idle / running / stopped / error） */
  getState() {
    const status = this.#stopRequested ? 'stopped' : this.#lastRunResult?.status || 'idle';
    return {
      state: status,
      status,
      workingDirectory: this.#config.workingDirectory,
      maxIterations: this.#config.maxIterations,
      toolCount: this.#toolRegistry.size,
    };
  }

  /** 返回所有已注册工具（name + description） */
  getTools() {
    try {
      const all = this.#toolRegistry.getAll?.() || [];
      return all.map((t) => ({
        name: t.name || String(t),
        description: t.description || '',
        category: t.category || 'general',
      }));
    } catch {
      return [];
    }
  }

  /** 注册单个工具（直接转发到 toolRegistry） */
  registerTool(tool) {
    try {
      this.#toolRegistry.register(tool);
    } catch (_) {}
    return this;
  }

  /** 批量注册工具 */
  registerTools(tools) {
    if (!Array.isArray(tools)) {
      return this;
    }
    for (const t of tools) {
      this.registerTool(t);
    }
    return this;
  }

  /** 与旧 API 兼容：processInput 等价于 run */
  async processInput(input, options = {}) {
    const text = typeof input === 'string' ? input : input?.text || JSON.stringify(input);
    return this.run(text);
  }

  /** 返回最近一次 modelProvider（可能为 null） */
  getModelProvider() {
    return this.#modelProvider || null;
  }

  /** 返回工具分组（兼容旧 API：按 tool name 的前缀分组） */
  getToolGroups() {
    try {
      const tools = this.#toolRegistry.getAll?.() || [];
      const groups = new Map();
      for (const t of tools) {
        const name = typeof t === 'string' ? t : t.name || 'tool';
        const prefix = name.includes('_') ? name.split('_')[0] : 'misc';
        if (!groups.has(prefix)) {
          groups.set(prefix, { group: prefix, tools: [] });
        }
        groups.get(prefix).tools.push(name);
      }
      return Array.from(groups.values());
    } catch (_) {
      return [];
    }
  }

  /** 释放资源 */
  dispose() {
    this.#persistSessionContext({ phase: 'dispose' });
    try {
      this.#modelProvider.dispose?.();
    } catch {}
    try {
      this.#workspaceIndex?.stopPeriodicSync?.();
    } catch {}
  }

  // ============================================================
  // 预探索上下文注入（工程化方案 — 引擎预计算上下文，消除 agent 探索阶段）
  // ============================================================

  /**
   * 分层注入预探索上下文：利用 WorkspaceIndex / ImportGraph /
   * AgentMemory / ContextProjection 数据，按层级注入结构化上下文。
   *
   * 上下文层次（从底层到上层）：
   *   Layer 0: 系统指令 (system prompt, 不变)
   *   Layer 1: 项目结构 (WorkspaceIndex summary)
   *   Layer 2: 诊断信息 (LSP diagnostics — 异步注入)
   *   Layer 3: 依赖关系 (ImportGraph + ContextProjection)
   *   Layer 4: 任务记忆 (AgentMemory, git-aware, token-budget 感知)
   *
   * 核心原则：不在 prompt 里教 agent 怎么探索，而是用引擎能力把
   * "探索"这一步直接吃掉。agent 看到的第一个上下文就是预计算好的。
   */
  #injectPreExploredContextSync(userInput, taskProfile) {
    // --- Layer 1: 项目结构 (WorkspaceIndex) ---
    try {
      const wsSummary = this.#workspaceIndex?.getSummary?.();
      if (wsSummary && wsSummary.length > 0) {
        this.#sessionManager.addLayer(
          'layer1_structure',
          `[WORKSPACE STRUCTURE — pre-indexed]\n${wsSummary}`,
          { priority: SessionManager.LAYER.STRUCTURE },
        );
      }
    } catch {
      /* 索引未就绪，跳过 */
    }

    // --- Layer 2: ContextProjection (状态图局部投影，按任务类型) ---
    try {
      const projection = this.#tryCreateProjection(taskProfile);
      if (projection) {
        this.#sessionManager.addLayer(
          'layer2_projection',
          `[CONTEXT PROJECTION for task]\n${projection}`,
          { priority: SessionManager.LAYER.PROJECTION },
        );
      }
    } catch {
      /* projection 失败不阻塞 */
    }

    // --- Layer 3: 依赖关系 (ImportGraph + 文件引用) ---
    try {
      if (this.#importGraph && typeof this.#importGraph.getDirectDependencies === 'function') {
        const hints = this.#extractFileReferences(userInput);
        if (hints.length > 0) {
          const graphLines = [];
          for (const hint of hints.slice(0, 5)) {
            try {
              const deps = this.#importGraph.getDirectDependencies(hint) || [];
              const dependents = this.#importGraph.getDependents?.(hint) || [];
              graphLines.push(
                `  - \`${hint}\`: imports ${deps.length} module(s), depended on by ${dependents.length} file(s)`,
              );
            } catch {
              /* 单个文件查图失败不阻塞 */
            }
          }
          if (graphLines.length > 0) {
            this.#sessionManager.addLayer(
              'layer3_dependencies',
              `[IMPORT GRAPH — file references in task]\n${graphLines.join('\n')}`,
              { priority: SessionManager.LAYER.DEPENDENCIES },
            );
          }
        }
      }
    } catch {
      /* 依赖图不可用 */
    }

    // --- Layer 4: 项目记忆 (AgentMemory, git-aware, token-budget 感知) ---
    this.#refreshMemoryLayer(userInput);

    this.#ui.debugEvent?.('Layered pre-explored context injected (4 layers)', {
      hasWorkspace: Boolean(this.#workspaceIndex?.getSummary?.()),
      hasProjection: Boolean(this.#contextProjection),
      hasImportGraph: Boolean(this.#importGraph),
      hasMemory: Boolean(this.#memoryManager),
    });
  }

  /**
   * 刷新 Layer 4（项目记忆）。被 injectPreExploredContextSync 和
   * 主循环中的 memory refresh hook 共用。
   */
  #refreshMemoryLayer(userInput) {
    try {
      if (this.#memoryManager) {
        const memCtx =
          typeof this.#memoryManager.getBudgetedMemoryContext === 'function'
            ? this.#memoryManager.getBudgetedMemoryContext({
                currentTask: typeof userInput === 'string' ? userInput.substring(0, 300) : '',
                maxTokens: 800,
                tokensPerChar: 0.25,
              })
            : '';
        if (memCtx && memCtx.trim()) {
          this.#sessionManager.refreshLayer(
            'layer4_memory',
            `[PROJECT MEMORY — git-aware, refreshed]\n${memCtx}`,
            { priority: SessionManager.LAYER.MEMORY },
          );
        }
      }
    } catch {
      /* 记忆不可用 */
    }
  }

  /**
   * 闭环记忆刷新：每轮工具执行后，检测是否有实际落地的突变操作，
   * 若有则刷新 layer4_memory，让下一轮 LLM 看到编辑产生的最新记忆。
   *
   * 这修复了记忆闭环的核心断裂点：
   *   编辑 → addEpisodic() ✅
   *   记忆 → refresh layer4_memory ✅ (NEW)
   *   下一轮 LLM → 读取更新后的 memory ✅
   *
   * 注意：使用 isLandedMutation 判断，只有成功执行且真正有内容变更的才算。
   */
  #refreshMemoryAfterTools(execResults) {
    if (!execResults || execResults.length === 0) {
      return;
    }

    const hasMutation = execResults.some((er) => isLandedMutation(er));

    if (hasMutation) {
      try {
        this.#refreshMemoryLayer(this.#lastUserInput);
        this.#ui.debugEvent?.('Memory layer refreshed after mutation', {
          layerId: 'layer4_memory',
        });
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * 创建 ContextProjectionGenerator，桥接 WorkspaceIndex 到 CompleteIndex 接口。
   * ContextProjectionGenerator 需要 StateGraph + CompleteIndex，这里用 WorkspaceIndex
   * 构建轻量 adaptor，通过 projectMinimal() 生成真正的上下文投影。
   */
  #createProjectionGenerator() {
    try {
      const wsIndex = this.#workspaceIndex;

      // 轻量 CompleteIndex adaptor：把 WorkspaceIndex 包装成 projection 需要的接口
      const projectionIndex = {
        getStats() {
          const stats = wsIndex?.getStats?.() || {};
          return {
            files: stats.files ?? stats.size ?? 0,
            symbols: stats.symbols ?? 0,
            dependencies: stats.dependencies ?? 0,
          };
        },
        symbols: {
          findInFile: () => [],
          findByName: () => [],
        },
        dependencies: {
          analyzeImpact: () => ({ directDeps: [], dependents: [], transitiveDependents: [] }),
        },
        store: {},
      };

      // 使用 StateGraph 创建投影引擎
      const graph = new StateGraph();

      return new ContextProjectionGenerator(graph, projectionIndex);
    } catch {
      return null;
    }
  }

  /**
   * 创建状态图局部投影。使用 ContextProjectionGenerator.projectMinimal()
   * 代替之前手写的 WorkspaceIndex stats 格式化。
   *
   * ContextProjectionGenerator 提供：
   *   - projectMinimal()     → 项目状态摘要
   *   - projectSmart()        → 根据任务类型自动选择投影策略
   *   - projectForEditing()   → 编辑任务的精确符号+依赖投影
   *   - projectForUnderstanding() → 理解任务的上下文投影
   *
   * 这里使用 projectMinimal() 作为初始注入，后续 OnDemandContextExpansion
   * 可在运行时请求更精确的 projectSmart() 投影。
   */
  #tryCreateProjection(taskProfile) {
    try {
      if (!taskProfile?.isCodingTask) {
        return null;
      }
      if (!this.#contextProjection) {
        return null;
      }

      const projection = this.#contextProjection.projectMinimal();

      // 补充任务类型提示
      const taskHint =
        `\nTask type: ${taskProfile.isBugTask ? 'bug fix' : 'coding'}, ` +
        `risk level: ${taskProfile.riskLevel || 'medium'}.\n` +
        `Strategy: use pre-computed context directly; read only specific code sections to edit.\n`;

      return projection + taskHint;
    } catch {
      // fallback: 投影引擎失败时降级为手写摘要
      try {
        const wsSummary = this.#workspaceIndex?.getSummary?.() || '';
        const stats = this.#workspaceIndex?.getStats?.() || {};
        const f = stats.files ?? stats.size ?? '?';
        const s = stats.symbols ?? '?';
        return (
          `Project overview: ~${f} files, ~${s} symbols indexed (projection engine fallback).\n` +
          (wsSummary ? `\nStructure:\n${wsSummary}` : '')
        );
      } catch {
        return null;
      }
    }
  }

  /**
   * OnDemandContextExpansion: 每轮迭代动态评估置信度，按需扩展上下文。
   *
   * 当 agent 探索过多、上下文置信度不足时，引擎自动注入相关上下文，
   * 避免 agent 继续逐文件阅读。
   */
  #expandContextOnDemand(iteration, maxIterations, _executionPlan) {
    try {
      // 仅在编码任务 + 迭代进入中后段时触发（前期让 agent 先尝试）
      if (iteration < 2) {
        return;
      }

      // 使用当前 userInput 评估：文件是否存在、符号是否可索引、依赖图是否覆盖
      const confidence = this.#onDemandContext?.assessConfidence?.({
        file: this.#lastUserInput ? this.#extractFileReferences(this.#lastUserInput)[0] : undefined,
        symbolName: undefined,
      });

      if (!confidence) {
        return;
      }

      // 置信度不足时注入提示，引导 agent 信任预计算上下文
      if (confidence.level === 'low' || confidence.level === 'unknown') {
        if (iteration > Math.floor(maxIterations * 0.5)) {
          // 迭代过半且置信度低：强制注入指导
          this.#sessionManager.addSystemMessage(
            '[ON-DEMAND CONTEXT EXPANSION] Context confidence is low. The engine has pre-indexed ' +
              'the workspace structure and import graph. Trust the pre-computed context rather ' +
              'than exploring file-by-file. If you need specific file content, read it directly ' +
              'with offset+limit — do not explore broadly.',
          );
          this.#ui.debugEvent?.('On-demand context expansion triggered', {
            iteration,
            confidenceLevel: confidence.level,
            reason: confidence.reason,
          });
        }
      }
    } catch {
      /* on-demand expansion best-effort */
    }
  }

  /**
   * 异步增强管道：warm WorkspaceIndex → 触发 LSP diagnostics →
   * 综合注入完整的预探索上下文。
   *
   * 当 warm + diagnostics 完成后，agent 拥有：
   * - 完整的项目文件/符号索引
   * - LSP 诊断结果（错误位置、类型错误等）
   * - 不再需要逐文件探索
   */
  async #warmAndInjectFullContext(userInput) {
    try {
      // Step 1: warm 工作区索引 → 刷新 layer1_structure
      const wsSummary = await this.#workspaceIndex?.warm?.();
      if (wsSummary && this.#sessionManager) {
        this.#sessionManager.refreshLayer(
          'layer1_structure',
          `[WORKSPACE STRUCTURE — fully warmed]\n${wsSummary}`,
          { priority: SessionManager.LAYER.STRUCTURE },
        );
      }
    } catch (err) {
      this.#ui.debugEvent?.('Workspace index warm failed', { error: err?.message || err });
    }

    // Step 2: 触发 LSP diagnostics → 新 layer（诊断层，priority 高于 structure）
    try {
      if (this.#lspManager) {
        const diagContext = await this.#collectLspDiagnostics();
        if (diagContext && this.#sessionManager) {
          this.#sessionManager.addLayer('layer_diagnostics', diagContext, {
            priority: SessionManager.LAYER.DIAGNOSTICS,
          });
        }
      }
    } catch (err) {
      this.#ui.debugEvent?.('LSP diagnostics pre-fetch failed', {
        error: err?.message || err,
      });
    }

    // Step 3: 通过 import graph 增强诊断上下文 → 刷新 layer3_dependencies
    try {
      if (this.#lspManager && this.#importGraph) {
        const enhancedDiags = await this.#enhanceDiagnosticsWithImportGraph();
        if (enhancedDiags && this.#sessionManager) {
          this.#sessionManager.refreshLayer('layer3_dependencies', enhancedDiags, {
            priority: SessionManager.LAYER.DEPENDENCIES,
          });
        }
      }
    } catch (err) {
      this.#ui.debugEvent?.('Diagnostics enhancement failed', {
        error: err?.message || err,
      });
    }
  }

  /**
   * 从 LSP 收集所有诊断信息，构建结构化上下文。
   * 在关键源文件上触发 didOpen 以获取实时 diagnostics。
   */
  async #collectLspDiagnostics() {
    const allDiags = this.#lspManager.getAllDiagnostics?.() || {};
    const errors = [];
    const warnings = [];

    for (const [uri, diags] of Object.entries(allDiags)) {
      if (!Array.isArray(diags) || diags.length === 0) {
        continue;
      }
      const filePath = uri.replace(/^file:\/\//, '');
      for (const d of diags) {
        const entry = {
          file: filePath,
          line: (d.range?.start?.line ?? 0) + 1,
          column: (d.range?.start?.character ?? 0) + 1,
          message: d.message || '',
          source: d.source || '',
          code: d.code || '',
        };
        if (d.severity === 1) {
          errors.push(entry);
        } else if (d.severity === 2) {
          warnings.push(entry);
        }
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      return null;
    }

    const lines = [];
    lines.push(
      '[LSP DIAGNOSTICS — pre-fetched by engine. You do NOT need to run lsp_diagnostics yourself.]',
    );

    if (errors.length > 0) {
      lines.push(`\n## Errors (${errors.length} total, showing first 12)`);
      for (const e of errors.slice(0, 12)) {
        const src = e.source ? ` [${e.source}${e.code ? `:${e.code}` : ''}]` : '';
        lines.push(`  - **\`${e.file}:${e.line}:${e.column}\`** — ${e.message}${src}`);
      }
    }

    if (warnings.length > 0) {
      lines.push(`\n## Warnings (${warnings.length} total, showing first 5)`);
      for (const w of warnings.slice(0, 5)) {
        lines.push(`  - \`${w.file}:${w.line}:${w.column}\` — ${w.message}`);
      }
    }

    this.#ui.debugEvent?.('LSP diagnostics pre-fetched', {
      errors: errors.length,
      warnings: warnings.length,
    });

    return lines.join('\n');
  }

  /**
   * 通过 ImportGraph 增强诊断上下文：对于每个有诊断错误的文件，
   * 追溯其直接导入者和被导入者，让 agent 了解修改的影响范围。
   */
  async #enhanceDiagnosticsWithImportGraph() {
    const allDiags = this.#lspManager.getAllDiagnostics?.() || {};
    const errorFiles = new Set();

    for (const [uri, diags] of Object.entries(allDiags)) {
      if (!Array.isArray(diags)) {
        continue;
      }
      if (diags.some((d) => d.severity === 1)) {
        errorFiles.add(uri.replace(/^file:\/\//, ''));
      }
    }

    if (errorFiles.size === 0) {
      return null;
    }

    const lines = [];
    lines.push(
      '[IMPORT GRAPH — files affected by diagnostics. Understanding these relationships helps scope your changes.]',
    );

    for (const file of errorFiles) {
      try {
        const deps = this.#importGraph.getDirectDependencies?.(file) || [];
        const dependents = this.#importGraph.getDependents?.(file) || [];
        if (deps.length > 0 || dependents.length > 0) {
          const parts = [];
          if (deps.length > 0) {
            parts.push(
              `imports: ${deps
                .slice(0, 5)
                .map((d) => `\`${typeof d === 'string' ? d : d.path || d}\``)
                .join(', ')}${deps.length > 5 ? ` +${deps.length - 5} more` : ''}`,
            );
          }
          if (dependents.length > 0) {
            parts.push(
              `depended on by: ${dependents
                .slice(0, 5)
                .map((d) => `\`${typeof d === 'string' ? d : d.path || d}\``)
                .join(', ')}${dependents.length > 5 ? ` +${dependents.length - 5} more` : ''}`,
            );
          }
          lines.push(`  - \`${file}\`: ${parts.join('; ')}`);
        }
      } catch {
        /* 单个文件查图失败不阻塞 */
      }
    }

    return lines.length > 1 ? lines.join('\n') : null;
  }

  /**
   * 从用户输入中提取可能的文件路径引用。
   * 用于在 import graph 中查找相关依赖。
   */
  #extractFileReferences(userInput) {
    if (typeof userInput !== 'string' || !userInput) {
      return [];
    }
    const refs = new Set();
    // 匹配反引号包裹的文件路径: `src/foo/bar.ts`
    const backtickPattern =
      /`([^`]+\.(?:js|ts|jsx|tsx|mjs|cjs|py|rs|go|java|vue|svelte|css|html))`/gi;
    let match;
    while ((match = backtickPattern.exec(userInput)) !== null) {
      refs.add(match[1]);
    }
    // 匹配常见的相对/绝对路径引用
    const pathPattern =
      /\b((?:\.{0,2}\/)?(?:src|lib|app|components|utils|services|hooks|pages|modules|core)\/[^\s,"'`()]+\.(?:js|ts|jsx|tsx))\b/gi;
    while ((match = pathPattern.exec(userInput)) !== null) {
      refs.add(match[1]);
    }
    return Array.from(refs);
  }

  // ============================================================
  // 反馈闭环 L2: Hashline 冲突检测 → 动态重规划
  // ============================================================

  /**
   * 检测工具执行结果中的 Hashline 冲突信号，触发动态重规划。
   * 当 EditOrchestrator 报告冲突/回滚时，在 plan 中插入诊断→重试→重验证子任务。
   */
  #detectAndHandleHashlineConflict(execResult) {
    if (!this.#executionPlanManager.isActive) {
      return;
    }

    const result = execResult?.result;
    const error = execResult?.error;
    const toolName = execResult?.name || '';

    // 仅关注 Hashline 编辑相关工具
    const hashRelatedTools = ['apply_hashline_patch', 'write_file', 'edit_file'];
    if (!hashRelatedTools.includes(toolName)) {
      return;
    }

    // 解析冲突信号
    let conflictType = null;
    let recovered = false;
    let repairTimeMs = 0;
    let affectedFile = '';

    // 尝试从 result 文本中提取冲突信息
    const resultText = typeof result === 'string' ? result : JSON.stringify(result || '');
    const errorText = error
      ? typeof error === 'string'
        ? error
        : error.message || JSON.stringify(error)
      : '';

    const hashline = analyzeHashlinePatchResult(toolName, execResult?.args || {}, result, error);
    if (hashline.isHashline) {
      conflictType = hashline.conflictType;
      recovered = hashline.recovered;
      affectedFile = hashline.affectedFiles[0] || '';
    }

    if (!conflictType) {
      if (
        resultText.includes('rollback') ||
        resultText.includes('ROLLBACK') ||
        resultText.includes('recovery failed') ||
        errorText.includes('rollback') ||
        errorText.includes('recovery failed')
      ) {
        conflictType = 'recovery_failed';
      } else if (
        resultText.includes('tag mismatch') ||
        resultText.includes('TAG_MISMATCH') ||
        errorText.includes('tag mismatch')
      ) {
        conflictType = 'tag_mismatch';
        recovered = resultText.includes('recovered') || resultText.includes('retry succeeded');
      } else if (
        resultText.includes('patch rejected') ||
        resultText.includes('PATCH_REJECTED') ||
        errorText.includes('patch rejected')
      ) {
        conflictType = 'patch_rejected';
        recovered = resultText.includes('recovered') || resultText.includes('retry succeeded');
      } else if (
        resultText.includes('diagnostics') &&
        (resultText.includes('new error') ||
          resultText.includes('新错误') ||
          resultText.includes('introduced'))
      ) {
        conflictType = 'diag_new_errors';
        recovered = resultText.includes('auto-repaired') || resultText.includes('自动修复');
      }
    }

    if (!conflictType) {
      return;
    } // 无冲突信号

    // 提取受影响的文件
    const fileMatch = resultText.match(
      /["'`]?([\w.\-/]+\.(?:js|ts|tsx|jsx|json|css|html|py|md))["'`]?/,
    );
    affectedFile = affectedFile || (fileMatch ? fileMatch[1] : '');

    // 记录到反馈循环
    this.#feedbackLoop?.recordConflict?.(conflictType, recovered, repairTimeMs, affectedFile);

    // 记录到当前计划任务
    this.#executionPlanManager.recordConflictSignal?.(toolName, conflictType, recovered);

    const planAlreadyOwnsHashlineRepair = Array.from(
      this.#executionPlanManager.plan?.tasks?.values?.() || [],
    ).some(
      (task) =>
        ['pending', 'running', 'ready', 'blocked'].includes(task.status) &&
        task.metadata?.source === 'hashline-repair',
    );

    // 如果冲突未恢复，触发动态重规划
    // apply_hashline_patch 失败时，ExecutionPlanManager 会优先插入可恢复任务链；
    // 这里保留旧的反馈循环作为兜底，避免重复插入两套修复任务。
    if (planAlreadyOwnsHashlineRepair) {
      return;
    }
    if (!recovered) {
      const replanHints = this.#feedbackLoop?.generateReplanHints?.(conflictType);
      if (replanHints) {
        const replanResult = this.#executionPlanManager.replan?.(replanHints);
        if (replanResult) {
          this.#ui.debugEvent?.('Hashline conflict → dynamic replan', {
            conflictType,
            affectedFile,
            insertedTasks: replanResult.insertedTasks,
          });
          // 注入 replan 上下文到下一轮 LLM 对话
          this.#sessionManager.addSystemMessage(
            `[HASHLINE CONFLICT] ${conflictType} detected on file: ${affectedFile || 'unknown'}. ` +
              `Dynamic replan activated: diagnose → retry → re-verify. ` +
              `Strategies: ${(replanHints.suggestedStrategies || []).join('; ')}`,
          );
        }
      }
    }
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /**
   * 检查工具结果是否表示需要用户输入（ask_user 挂起信号）
   */
  #isUserInputRequired(result) {
    if (!result) return false;
    if (typeof result === 'object') {
      return (
        result.requiresUserInput === true ||
        result.type === 'user_input_required' ||
        result.status === 'needs_user_input'
      );
    }
    return result === 'needs_user_input';
  }

  /**
   * 挂起主循环等待用户输入。
   * 通过 Promise + resolve 的方式，不退出循环，不丢失任何内部状态。
   */
  async #suspendForUserInput(askResult) {
    const normalized = this.#normalizeAskUserResult(askResult);
    const reason = normalized.reason || '需要用户补充信息';
    const questions = normalized.questions || [];
    const answer =
      normalized.answer ||
      questions.map((q, i) => `${i + 1}. ${q}`).join('\n') ||
      reason;

    // 存储待处理的用户输入请求，供外部（如 session-state / UI）获取
    this.#pendingUserInputRequest = {
      requiresUserInput: true,
      reason,
      questions,
      blockingFacts: normalized.blockingFacts || [],
      suggestions: normalized.suggestions || [],
      answer,
    };

    this.#ui.debugEvent?.('User input requested (suspended)', {
      reason,
      questions,
    });

    // 通知 UI 层（如果支持）
    this.#ui.userInputRequested?.(this.#pendingUserInputRequest);

    // 返回一个 Promise，等待外部调用 resumeWithUserInput 来 resolve
    return new Promise((resolve) => {
      this.#userInputResolve = resolve;
    });
  }

  /**
   * 规范化 ask_user 工具的返回结果
   */
  #normalizeAskUserResult(result) {
    if (!result || typeof result !== 'object') {
      return {
        reason: String(result || '需要用户补充信息'),
        questions: [],
        blockingFacts: [],
        suggestions: [],
        answer: String(result || ''),
      };
    }
    return {
      reason: result.reason || '',
      questions: Array.isArray(result.questions) ? result.questions : [],
      blockingFacts: Array.isArray(result.blocking_facts)
        ? result.blocking_facts
        : Array.isArray(result.blockingFacts)
          ? result.blockingFacts
          : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      answer: result.answer || '',
    };
  }

  async #completeRun({
    success,
    status,
    answer,
    reason,
    iterations,
    startedAt,
    error,
    userInputRequest,
  }) {
    // 让出当前 macrotask，给 UI 框架（React 等）一个渲染 tick
    // 把前面几轮迭代中累积的 toolCall/toolResult/toolError 事件
    // 在 "执行完成" 状态之前先渲染出来，避免 tool 结果比完成标记更晚显示
    await new Promise((r) => setTimeout(r, 0));

    try {
      this.#workspaceIndex?.stopPeriodicSync?.();
    } catch {}
    const durationMs = Date.now() - startedAt;
    const toolEvents = this.#toolExecutor.events.map((event) => ({ ...event }));
    const result = {
      runId: this.#lastRunResult?.runId,
      success,
      status,
      answer,
      reason,
      iterations,
      durationMs,
      toolEvents,
    };
    if (error) {
      result.error = error;
    }
    if (userInputRequest) {
      result.userInputRequest = userInputRequest;
    }
    this.#lastRunResult = result;

    // —— Metrics: 会话结束标记 ——
    try {
      metricsSink.finishRun(result.runId, {
        success,
        iterations,
        durationMs,
        reason: error ? String(error) : reason,
        toolCount: toolEvents.length,
      });
    } catch (_) {
      /* 忽略 */
    }

    // —— Auto-Memory: 分析本轮会话，自动沉淀高置信度记忆（fire-and-forget）——
    if (this.#memoryManager && typeof this.#memoryManager.autoWriteMemory === 'function') {
      // 不 await，避免阻塞 main loop
      (async () => {
        try {
          const errors = (toolEvents || [])
            .filter((e) => e.error || e.result?.error)
            .map((e) => (e.error || e.result?.error)?.toString())
            .filter(Boolean);
          const { written, deferred } = await this.#memoryManager.autoWriteMemory({
            finalAnswer: answer,
            corrections: success ? [] : error ? [String(error)] : [],
            toolEvents: toolEvents || [],
          });
          if (written.length > 0) {
            this.#ui.debugEvent?.('Auto-memory written', {
              count: written.length,
              topics: written.map((w) => w.topic),
            });
          }
          if (deferred.length > 0) {
            this.#ui.debugEvent?.('Auto-memory deferred', { count: deferred.length });
          }
        } catch {
          /* 静默 */
        }
      })();
    } else if (this.#memoryManager && typeof this.#memoryManager.autoSuggestMemory === 'function') {
      // fallback：旧版仅建议模式
      try {
        const errors = (toolEvents || [])
          .filter((e) => e.error || e.result?.error)
          .map((e) => (e.error || e.result?.error)?.toString())
          .filter(Boolean);
        const { shouldSuggest, suggestions } = this.#memoryManager.autoSuggestMemory({
          finalAnswer: answer,
          corrections: success ? [] : error ? [String(error)] : [],
          toolEvents: toolEvents || [],
        });
        if (shouldSuggest) {
          this.#ui.debugEvent?.('Auto-memory suggestions', { count: suggestions.length });
        }
      } catch {
        /* 静默 */
      }
    }

    // —— ConversationJournal: 记录本轮完整结果（#completeRun 已有 UI flush，时序已对齐）——
    if (this.#conversationJournal && result?.runId) {
      try {
        this.#conversationJournal.recordResult({
          answer,
          success,
          reason,
          durationMs,
          toolCount: (toolEvents || []).length,
          runId: result.runId,
        });
      } catch {
        /* 日志写入失败不阻塞主流程 */
      }
    }

    this.#persistSessionContext({
      phase: 'run_completed',
      runId: result.runId,
      status,
      success,
      reason,
    });

    // ========== 反馈闭环 L1 & L3: Plan 执行结果 → Methodology 调优 + 跨 run 模式学习 ==========
    try {
      const planSummary = this.#executionPlanManager?.generateExecutionSummary?.();
      if (planSummary && this.#feedbackLoop) {
        const toolEventsData = toolEvents || [];
        // 收集工具有效性
        const recommendedTools = this.#lastIntent?.recommendedTools || [];
        const actuallyUsedTools = toolEventsData.map((e) => e.name || '').filter(Boolean);
        this.#feedbackLoop.collectToolEffectiveness?.(recommendedTools, [
          ...new Set(actuallyUsedTools),
        ]);

        // 构建执行记录并收集到反馈循环
        this.#feedbackLoop.collect?.({
          runId: result.runId,
          taskType:
            planSummary.decompositionMode === 'llm'
              ? 'coding' // LLM 分解模式下的任务类型从 plan 推断
              : this.#executionPlanManager?.isBugTask
                ? 'bug_fix'
                : 'coding',
          decompositionMode: planSummary.decompositionMode,
          intent: this.#lastIntent?.intent || '',
          intentConfidence: this.#lastIntent?.confidence ?? 0,
          success,
          reason,
          durationMs,
          iterations,
          toolCount: toolEventsData.length,
          phasesCompleted: planSummary.phasesCompleted,
          phaseTimings: planSummary.phaseTimings,
          hashlineConflicts: planSummary.hashlineConflicts,
          hashlineRollbacks: planSummary.hashlineRollbacks,
          hashlineAutoRepairs: planSummary.hashlineAutoRepairs,
          totalSubtasks: planSummary.totalSubtasks,
          completedSubtasks: planSummary.completedSubtasks,
          failedSubtasks: planSummary.failedSubtasks,
          toolSuccessRate:
            toolEventsData.length > 0
              ? toolEventsData.filter((e) => !e.error && !e.result?.error).length /
                toolEventsData.length
              : 0,
        });
      }
    } catch {
      /* 反馈收集失败不阻塞主流程 */
    }

    return result;
  }

  #persistSessionContext(metadata = {}) {
    try {
      this.#sessionPersistence?.save?.(this.#sessionManager, {
        workingDirectory: this.#config.workingDirectory,
        ...metadata,
      });
    } catch {
      /* context persistence must not block execution */
    }
  }

  #preview(value, maxLength = 200) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
  }

  #phaseFromIteration(iteration, maxIterations) {
    if (!this.#executionPlanManager.plan) {
      return null;
    }
    const ratio = maxIterations > 0 ? iteration / maxIterations : 0;

    // Bug 修复任务：压缩探索/规划阶段，给实现更多时间
    // 避免 agent 在"审查模式"中耗费太多迭代
    if (this.#executionPlanManager.isBugTask) {
      if (ratio < 0.05) {
        return 'exploration';
      }
      if (ratio < 0.1) {
        return 'planning';
      }
      if (ratio < 0.7) {
        return 'implementation';
      }
      if (ratio < 0.85) {
        return 'inspection';
      }
      return 'verification';
    }

    if (ratio < 0.15) {
      return 'exploration';
    }
    if (ratio < 0.35) {
      return 'planning';
    }
    if (ratio < 0.65) {
      return 'implementation';
    }
    if (ratio < 0.85) {
      return 'inspection';
    }
    return 'verification';
  }

  #planSummary(plan) {
    const tasks = plan.toJSON().tasks;
    const byName = tasks.map((t) => `  - ${t.id}: ${t.status}`).join('\n');
    return `Tasks: ${tasks.length}\n${byName}`;
  }
}

// 兼容 ReActAgent 类名（老代码 import 不破坏）
export { AgentEngine as ReActAgent };
export default AgentEngine;
