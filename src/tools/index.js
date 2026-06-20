import { createFileSystemTools } from './filesystem/filesystem-tools.js';
import { createShellTool } from './system/shell.js';
import { createPtyTools } from './system/pty.js';
import { createWorkspaceKnowledgeTools } from './system/workspace-knowledge.js';
import { createStateCentricTools } from './harness/state-centric-tools.js';
import { createStateGraphTools } from './harness/state-graph-tools.js';
import { createContextExpansionTools } from './harness/context-expansion.js';
import { createSemanticSearchTool } from './memory/semantic-search.js';
import { createDocumentRagTools } from './memory/document-rag.js';
import { createStructuredMemoryTools } from './memory/structured-memory-tools.js';
import { createGitTools } from './git/git-tools.js';
import { createWebTools } from './web/web-tools.js';
import { createPreviewTools } from './web/preview-tools.js';
import { createMCPTools } from './mcp/mcp-tools.js';
import { createTaskTools } from './scheduler/task-tools.js';
import { createScheduleTools } from './scheduler/schedule-tools.js';
import { createSubAgentTools } from './scheduler/subagent-tools.js';

import createBrainstormTool from './skills/brainstorm.js';
import createGrillTool from './skills/grill.js';
import createTddTool from './skills/tdd.js';
import createDiagnoseTool from './skills/diagnose.js';
import createVerifyTool from './skills/verify.js';
import createCoverageCheckTool from './skills/coverage_check.js';
import createAskUserTool from './skills/ask_user.js';
import createReviewTool from './skills/review.js';
import createArchitectTool from './skills/architect.js';
import createZoomOutTool from './skills/zoom_out.js';
import createCavemanTool from './skills/caveman.js';
import createHandoffTool from './skills/handoff.js';
import createToPrdTool from './skills/to_prd.js';
import createToIssuesTool from './skills/to_issues.js';
import createSetupTool from './skills/setup.js';

export const SKILL_TOOL_CREATORS = [
  createBrainstormTool,
  createGrillTool,
  createTddTool,
  createDiagnoseTool,
  createVerifyTool,
  createCoverageCheckTool,
  createAskUserTool,
  createReviewTool,
  createArchitectTool,
  createZoomOutTool,
  createCavemanTool,
  createHandoffTool,
  createToPrdTool,
  createToIssuesTool,
  createSetupTool,
];

export function createCoreTools({
  workingDirectory = null,
  mcpClient = null,
  includeExperimentalTools = false,
} = {}) {
  const tools = [
    ...createFileSystemTools(),
    createShellTool(),
    ...createWorkspaceKnowledgeTools(null),
    ...createContextExpansionTools(workingDirectory),
    ...createPtyTools(),
    createSemanticSearchTool(),
    ...createDocumentRagTools(),
    ...createStructuredMemoryTools(),
    ...createGitTools(),
    ...createWebTools(),
    ...createPreviewTools(),
    ...(mcpClient ? createMCPTools(mcpClient) : []),
  ];

  if (includeExperimentalTools) {
    tools.push(
      ...createStateCentricTools(),
      ...createStateGraphTools(),
    );
  }

  return tools;
}

export function createSchedulerTools(schedulerEngine) {
  if (!schedulerEngine) return [];
  return [
    ...createTaskTools(schedulerEngine),
    ...createScheduleTools(schedulerEngine),
    ...createSubAgentTools(schedulerEngine),
  ];
}
