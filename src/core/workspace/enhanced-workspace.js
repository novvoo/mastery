/**
 * Enhanced Workspace Integration for ReAct Agent
 * 
 * 这个模块将 WorkspaceState 和 ObservationSummarizer 集成到 ReAct Agent 中
 * 解决 Agent "健忘" 的问题
 */

import { WorkspaceState } from './workspace-state.js';
import { ObservationSummarizer } from '../observation-summarizer.js';
import { createWorkspaceKnowledgeTools } from '../../tools/system/workspace-knowledge.js';

/**
 * 创建增强的工作区集成
 * @param {object} options
 * @returns {object}
 */
export function createEnhancedWorkspace(options = {}) {
  const {
    toolRegistry,
    includeToolsInRegistry = true,
  } = options;

  // 创建核心组件
  const workspaceState = new WorkspaceState();
  const observationSummarizer = new ObservationSummarizer(workspaceState);

  // 注册工具到工具注册表
  if (toolRegistry && includeToolsInRegistry) {
    const tools = createWorkspaceKnowledgeTools(workspaceState);
    for (const tool of tools) {
      // 包装 handler 以包含 summarizer 引用
      const wrappedTool = {
        ...tool,
        handler: async (args, context) => {
          return await tool.handler(args, {
            ...context,
            observationSummarizer,
            workspaceState,
          });
        },
      };
      toolRegistry.register(wrappedTool);
    }
  }

  let observationHistory = [];

  function addToObservationHistory(toolName, args, processed) {
    observationHistory.push({
      toolName,
      args,
      summary: processed.summary,
      facts: processed.facts,
      timestamp: Date.now(),
    });

    if (observationHistory.length > 100) {
      observationHistory = observationHistory.slice(-50);
    }
  }

  function generateSystemPromptAddition() {
    const hint = getContextPreservationHint();

    if (hint.knownNonExistent.length === 0) {
      return '';
    }

    return `
## 工作区探索状态
${hint.workspaceDescription}

### 已知不存在的路径（避免重复尝试读取）
${hint.knownNonExistent.map(p => `- ${p}`).join('\n')}

### 关键发现
${hint.preserveFacts.slice(-5).map(f => `- ${f.type}: ${JSON.stringify(f.value)}`).join('\n')}
`;
  }

  function getContextPreservationHint() {
    const summary = workspaceState.getSummary();
    const criticalFacts = workspaceState.getCriticalFacts();
    const workspaceDescription = observationSummarizer.generateWorkspaceDescription();

    return {
      preserveFacts: criticalFacts.map(f => ({
        type: f.type,
        value: f.value,
      })),
      workspaceSummary: summary,
      workspaceDescription,
      knownNonExistent: Array.from(
        new Set(
          criticalFacts
            .filter(f => f.type === 'path_not_found')
            .map(f => f.value?.path)
            .filter(Boolean)
        )
      ),
      systemPromptAddition: generateSystemPromptAddition(),
    };
  }

  return {
    workspaceState,
    observationSummarizer,

    processToolResult(toolName, args, result) {
      const processed = observationSummarizer.processToolResult(toolName, args, result);
      addToObservationHistory(toolName, args, processed);
      return processed;
    },

    checkToolPrediction(toolName, args) {
      return workspaceState.predictToolResult(toolName, args);
    },

    checkPathExists(path) {
      return workspaceState.checkPathExists(path);
    },

    getContextPreservationHint,

    getState() {
      return workspaceState.export();
    },

    restoreState(state) {
      if (state) {
        workspaceState.import(state);
      }
    },

    clear() {
      workspaceState.clear();
      observationHistory = [];
    },

    getToolAdvice(toolName, args) {
      const prediction = workspaceState.predictToolResult(toolName, args);

      return {
        prediction,
        recentObservations: observationHistory
          .filter(o => o.toolName === toolName)
          .slice(-3)
          .map(o => o.summary),
        suggestion: prediction.canSkip
          ? `⚠️  基于之前的观察，此操作很可能会失败: ${prediction.reason}`
          : prediction.type === 'will_succeed'
          ? `✅  此路径已确认存在，可以继续`
          : `ℹ️  建议使用 workspace_knowledge 工具查询后再决定`,
      };
    },
  };
}

export default createEnhancedWorkspace;
