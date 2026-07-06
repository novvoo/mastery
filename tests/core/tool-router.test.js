import { describe, test, expect } from 'bun:test';
import {
  selectToolsForRequest,
  shouldUseIntentClassifier,
  PHASE,
} from '../../src/core/runtime/agent/tool-router.js';

function makeTool(name) {
  return { name, description: `${name} tool` };
}

const ALL_TOOL_NAMES = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'web_search',
  'web_fetch',
  'write_file',
  'edit_file',
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
  'pty_stop',
  'browser_open',
  'preview_start',
  'preview_stop',
  'preview_list',
  'ask_user',
  'review',
  'verify',
  'diagnose',
  'brainstorm',
  'grill',
  'zoom_out',
  'architect',
  'tdd',
  'coverage_check',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_add',
  'git_commit',
  'git_push',
  'git_pull',
  'git_stash',
  'git_reset',
  'harness_analyze',
  'harness_replace',
  'harness_insert',
  'harness_delete',
  'harness_query',
  'harness_rollback',
  'to_prd',
  'to_issues',
  'setup',
  'task_create',
  'task_list',
  'task_status',
  'task_cancel',
  'schedule_create',
  'schedule_list',
  'schedule_delete',
  'schedule_toggle',
  'subagent_spawn',
  'subagent_get_result',
  'subagent_list',
  'subagent_stop',
  'subagent_create_nested',
  'mcp_connect',
  'mcp_disconnect',
  'mcp_list_servers',
  'mcp_list_tools',
  'mcp_list_resources',
  'mcp_call_tool',
  'mcp_read_resource',
  'mcp_status',
  'caveman',
  'handoff',
  'change_plan',
  'impact_map',
  'risk_check',
  'test_strategy',
  'migration_plan',
  'release_checklist',
  'ui_acceptance',
  'data_contract_check',
  'security_review',
];

const ALL_TOOLS = ALL_TOOL_NAMES.map(makeTool);

const namesOf = (tools) => tools.map((t) => t.name).sort();

describe('selectToolsForRequest', () => {
  test('coding task gets core read, write, terminal, and git read tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { taskProfile: { isCodingTask: true } });
    const names = namesOf(selected);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('shell');
    expect(names).toContain('git_status');
    expect(names).toContain('change_plan');
    expect(names).toContain('ask_user');
    expect(names).toContain('diagnose');
    expect(names).not.toContain('impact_map');
    expect(names).not.toContain('risk_check');
    expect(names).not.toContain('test_strategy');
  });

  test('current task allowedTools exposes execution substrate without ceremonial methodology', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      currentTask: { allowedTools: ['read_file'] },
    });
    const names = namesOf(selected);
    expect(names).toContain('read_file');
    expect(names).toContain('change_plan');
    expect(names).toContain('write_file');
    expect(names).toContain('shell');
    expect(names).not.toContain('risk_check');
    expect(names).not.toContain('verify');
    expect(names).not.toContain('review');
    expect(names).not.toContain('brainstorm');
  });

  test('current task allowedTools preserves safe context tools for plan execution', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      currentTask: { allowedTools: ['ask_user'] },
    });
    const names = namesOf(selected);
    expect(names).toContain('ask_user');
    expect(names).toContain('change_plan');
    expect(names).toContain('list_dir');
    expect(names).toContain('read_file');
    expect(names).toContain('search');
    expect(names).toContain('write_file');
    expect(names).toContain('shell');
    expect(names).not.toContain('git_commit');
  });

  test('coding task with EXPLORATION phase gets brainstorm and architect', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.EXPLORATION,
    });
    const names = namesOf(selected);
    expect(names).toContain('brainstorm');
    expect(names).toContain('architect');
    expect(names).toContain('impact_map');
    expect(names).toContain('risk_check');
    // Should NOT have verify or review
    expect(names).not.toContain('verify');
    expect(names).not.toContain('review');
  });

  test('coding task with VERIFICATION phase gets verify and review', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.VERIFICATION,
    });
    const names = namesOf(selected);
    expect(names).toContain('verify');
    expect(names).toContain('review');
    expect(names).toContain('test_strategy');
    // Should NOT have brainstorm or architect
    expect(names).not.toContain('brainstorm');
    expect(names).not.toContain('architect');
  });

  test('coding task with PLANNING phase includes tdd', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.PLANNING,
    });
    const names = namesOf(selected);
    expect(names).toContain('tdd');
  });

  test('coding task with IMPLEMENTATION phase includes diagnose', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.IMPLEMENTATION,
    });
    const names = namesOf(selected);
    expect(names).toContain('diagnose');
  });

  test('coding task with INSPECTION phase includes review and diagnose', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.INSPECTION,
    });
    const names = namesOf(selected);
    expect(names).toContain('review');
    expect(names).toContain('diagnose');
  });

  test('non-coding task gets core tools and terminal tools (no methodology)', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: 'hello world' });
    const names = namesOf(selected);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('shell');
    expect(names).toContain('ask_user');
    expect(names).not.toContain('brainstorm');
  });

  test('non-coding task requesting fresh data gets web tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: '今天天气怎么样' });
    const names = namesOf(selected);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
  });

  test('user input about git adds git tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: 'commit and push my changes' });
    const names = namesOf(selected);
    expect(names).toContain('git_commit');
    expect(names).toContain('git_push');
    expect(names).toContain('git_status');
  });

  test('user input about browser opens browser tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: '打开浏览器截图' });
    const names = namesOf(selected);
    expect(names).toContain('browser_open');
  });

  test('user input about MCP adds MCP tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: 'connect to mcp server' });
    const names = namesOf(selected);
    expect(names).toContain('mcp_connect');
    expect(names).toContain('mcp_list_tools');
  });

  test('user input about scheduling adds task and schedule tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: '创建定时任务' });
    const names = namesOf(selected);
    expect(names).toContain('task_create');
    expect(names).toContain('schedule_create');
  });

  test('user input about compression adds compress tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: '压缩上下文 handoff' });
    const names = namesOf(selected);
    expect(names).toContain('caveman');
    expect(names).toContain('handoff');
  });

  test('intent recommendedTools are added', () => {
    const intent = { recommendedTools: ['search', 'glob'] };
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: 'find something', intent });
    const names = namesOf(selected);
    expect(names).toContain('search');
    expect(names).toContain('glob');
  });

  test('intent firstActionHint tool is added', () => {
    const intent = { firstActionHint: { tool: 'semantic_search' } };
    const selected = selectToolsForRequest(ALL_TOOLS, { userInput: 'look for code', intent });
    const names = namesOf(selected);
    expect(names).toContain('semantic_search');
  });

  test('bug-related coding task gets coverage_check', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true, isBugTask: true },
      currentPhase: PHASE.VERIFICATION,
    });
    const names = namesOf(selected);
    expect(names).toContain('coverage_check');
  });

  test('bug-related user input gets coverage_check', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      userInput: 'fix the failing test bug',
      currentPhase: PHASE.VERIFICATION,
    });
    const names = namesOf(selected);
    expect(names).toContain('coverage_check');
  });

  test('user input about docs adds DOC_PRODUCT_TOOLS', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      userInput: 'generate a PRD document',
    });
    const names = namesOf(selected);
    expect(names).toContain('to_prd');
    expect(names).toContain('to_issues');
  });

  test('maxTools limits the number of returned tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      maxTools: 5,
    });
    expect(selected.length).toBeLessThanOrEqual(5);
  });

  test('empty input returns default tool set', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {});
    expect(selected.length).toBeGreaterThan(0);
    const names = namesOf(selected);
    expect(names).toContain('read_file');
  });

  test('coding task without currentPhase gets minimal methodology tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
    });
    const names = namesOf(selected);
    expect(names).toContain('ask_user');
    expect(names).toContain('diagnose');
    expect(names).not.toContain('review');
    expect(names).not.toContain('verify');
    expect(names).not.toContain('brainstorm');
  });

  test('only selects tools that exist in allTools', () => {
    const partialTools = [makeTool('read_file'), makeTool('write_file')];
    const selected = selectToolsForRequest(partialTools, {
      taskProfile: { isCodingTask: true },
    });
    const names = namesOf(selected);
    // Should only contain tools from the provided list
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    // shell is not in partialTools, so should not be selected
    expect(names).not.toContain('shell');
  });

  test('non-coding fresh data request also gets review and verify', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      userInput: 'what is the latest news',
    });
    const names = namesOf(selected);
    expect(names).toContain('review');
    expect(names).toContain('verify');
  });

  test('coding task does not include deprecated harness state tools', () => {
    const selected = selectToolsForRequest(ALL_TOOLS, {
      taskProfile: { isCodingTask: true },
      currentPhase: PHASE.EXPLORATION,
    });
    const names = namesOf(selected);
    expect(names).not.toContain('harness_analyze');
    expect(names).not.toContain('harness_replace');
    expect(names).not.toContain('harness_rollback');
  });
});

describe('shouldUseIntentClassifier', () => {
  test('returns false for CLI commands', () => {
    expect(shouldUseIntentClassifier('/help')).toBe(false);
    expect(shouldUseIntentClassifier('/status')).toBe(false);
  });

  test('returns false for explicitly modifying tasks without read-only keywords', () => {
    expect(shouldUseIntentClassifier('写一个python游戏')).toBe(false);
    expect(shouldUseIntentClassifier('create a new file')).toBe(false);
    expect(shouldUseIntentClassifier('implement the login module')).toBe(false);
  });

  test('returns true when modifying verbs co-occur with read-only keywords', () => {
    expect(shouldUseIntentClassifier('查看index.html，如果没有init()就添加一个')).toBe(true);
    expect(shouldUseIntentClassifier('check the code and fix the bug')).toBe(true);
  });

  test('returns true for fresh data requests', () => {
    expect(shouldUseIntentClassifier('今天天气怎么样')).toBe(true);
    expect(shouldUseIntentClassifier('what is the latest news')).toBe(true);
  });

  test('returns true for ambiguous coding context', () => {
    expect(shouldUseIntentClassifier('我需要处理一下这个python脚本')).toBe(true);
  });

  test('returns true for general non-coding queries', () => {
    expect(shouldUseIntentClassifier('你好')).toBe(true);
    expect(shouldUseIntentClassifier('tell me a joke')).toBe(true);
  });

  test('returns true for inspection-only coding tasks', () => {
    expect(shouldUseIntentClassifier('检查一下代码是否有问题')).toBe(true);
    expect(shouldUseIntentClassifier('inspect the code for bugs')).toBe(true);
  });

  test('handles empty and null-like inputs', () => {
    expect(shouldUseIntentClassifier('')).toBe(true);
    expect(shouldUseIntentClassifier(null)).toBe(true);
    expect(shouldUseIntentClassifier(undefined)).toBe(true);
  });
});

describe('PHASE', () => {
  test('has all expected phase values', () => {
    expect(PHASE.EXPLORATION).toBe('exploration');
    expect(PHASE.PLANNING).toBe('planning');
    expect(PHASE.IMPLEMENTATION).toBe('implementation');
    expect(PHASE.INSPECTION).toBe('inspection');
    expect(PHASE.VERIFICATION).toBe('verification');
  });

  test('has exactly 5 phases', () => {
    expect(Object.keys(PHASE).length).toBe(5);
  });
});
