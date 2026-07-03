/**
 * PolicyRegistry - 策略注册表
 *
 * 核心思想：方法论工具改成"策略插件"，不要写死在 prompt。
 * 运行时只做：policy = policyRegistry.resolve(taskProfile)
 *
 * 策略矩阵：
 * | intent                 | mode     | plan | 方法论 | 写文件 | force-action |
 * | ---------------------- | -------- | ---: | ----- | -----: | -----------: |
 * | project_info           | answer   |    否 |     否 |    禁止 |         禁止 |
 * | how_to_run             | answer   |    否 |     否 |    禁止 |         禁止 |
 * | read_only_analysis     | inspect  |   可选 |     否 |    禁止 |         禁止 |
 * | diagnosis              | diagnose |   可选 |    可选 |  默认禁止 |         禁止 |
 * | code_modification      | mutate   |    是 |    可选 |    允许 |         禁止 |
 * | feature_implementation | mutate   |    是 |    可选 |    允许 |         禁止 |
 * | test_or_verify         | verify   |    否 |     否 |  禁止或受限 |         禁止 |
 */

import { TaskIntent, TaskMode } from './task-profile.js';

export const ToolClass = {
  READ: 'read',
  SEARCH: 'search',
  EDIT: 'edit',
  SHELL: 'shell',
  SHELL_READONLY: 'shell_readonly',
  GIT: 'git',
  MUTATION: 'mutation',
};

const POLICIES = {
  [TaskIntent.PROJECT_INFO]: {
    prompt:
      'Answer from repository evidence. Read necessary files (README, package.json, docs) to provide accurate information. Do not modify files.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH],
    forbiddenToolClasses: [ToolClass.EDIT, ToolClass.MUTATION],
    plan: false,
    methodology: false,
    forceAction: false,
    verificationGate: false,
  },

  [TaskIntent.HOW_TO_RUN]: {
    prompt:
      'Answer how to run the project from configuration evidence (package.json scripts, README, Makefile, docker-compose, etc.). Do not execute commands unless user explicitly asks to run.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH, ToolClass.SHELL_READONLY],
    forbiddenToolClasses: [ToolClass.EDIT, ToolClass.MUTATION],
    plan: false,
    methodology: false,
    forceAction: false,
    verificationGate: false,
  },

  [TaskIntent.READ_ONLY_ANALYSIS]: {
    prompt:
      'Inspect and analyze code/repository. Provide insights, architecture understanding, or code review. Do not modify unless explicitly asked.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH, ToolClass.SHELL_READONLY],
    forbiddenToolClasses: [ToolClass.EDIT, ToolClass.MUTATION],
    plan: 'optional', // 复杂分析任务可能需要计划
    methodology: false,
    forceAction: false,
    verificationGate: false,
  },

  [TaskIntent.DIAGNOSIS]: {
    prompt:
      'Find root cause with evidence. Read logs, diagnostics, and relevant code. Do not modify unless explicitly asked to fix.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH, ToolClass.SHELL_READONLY],
    forbiddenToolClasses: [ToolClass.EDIT, ToolClass.MUTATION],
    plan: 'optional', // 复杂诊断任务可能需要计划
    methodology: 'optional',
    forceAction: false,
    verificationGate: false,
  },

  [TaskIntent.CODE_MODIFICATION]: {
    prompt:
      'Use repository evidence to identify the target, make focused code changes, and verify the fix with tests or runtime evidence before finishing. Use methodology tools only when they add useful planning, review, or verification evidence.',
    allowedToolClasses: [
      ToolClass.READ,
      ToolClass.SEARCH,
      ToolClass.EDIT,
      ToolClass.SHELL,
      ToolClass.GIT,
    ],
    forbiddenToolClasses: [],
    plan: true,
    methodology: 'optional',
    forceAction: false,
    verificationGate: true,
  },

  [TaskIntent.FEATURE_IMPLEMENTATION]: {
    prompt:
      'Use repository evidence to design the smallest complete feature change, implement it, and verify behavior with tests or runtime evidence before finishing. Use methodology tools only when they clarify risk, scope, or acceptance.',
    allowedToolClasses: [
      ToolClass.READ,
      ToolClass.SEARCH,
      ToolClass.EDIT,
      ToolClass.SHELL,
      ToolClass.GIT,
    ],
    forbiddenToolClasses: [],
    plan: true,
    methodology: 'optional',
    forceAction: false,
    verificationGate: true,
  },

  [TaskIntent.TEST_OR_VERIFY]: {
    prompt:
      'Run tests, builds, or verification commands. Report results accurately. Do not modify code unless explicitly asked.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH, ToolClass.SHELL],
    forbiddenToolClasses: [ToolClass.EDIT, ToolClass.MUTATION],
    plan: false,
    methodology: false,
    forceAction: false,
    verificationGate: true,
  },

  [TaskIntent.DOCUMENTATION]: {
    prompt: 'Update documentation files. Keep changes focused and accurate.',
    allowedToolClasses: [ToolClass.READ, ToolClass.SEARCH, ToolClass.EDIT],
    forbiddenToolClasses: [],
    plan: false,
    methodology: false,
    forceAction: false,
    verificationGate: false,
  },

  [TaskIntent.GENERAL_CHAT]: {
    prompt: 'Respond to general conversation. No file operations required.',
    allowedToolClasses: [],
    forbiddenToolClasses: [
      ToolClass.READ,
      ToolClass.SEARCH,
      ToolClass.EDIT,
      ToolClass.SHELL,
      ToolClass.GIT,
      ToolClass.MUTATION,
    ],
    plan: false,
    methodology: false,
    forceAction: false,
    verificationGate: false,
  },
};

export class PolicyRegistry {
  #policies = POLICIES;

  /**
   * 根据 TaskProfile 解析执行策略
   * @param {object} profile - TaskProfile
   * @returns {object} Policy
   */
  resolve(profile) {
    if (!profile || !profile.intent) {
      return POLICIES[TaskIntent.GENERAL_CHAT];
    }
    return this.#policies[profile.intent] || POLICIES[TaskIntent.GENERAL_CHAT];
  }

  /**
   * 获取特定 intent 的策略
   */
  getPolicy(intent) {
    return this.#policies[intent] || null;
  }

  /**
   * 获取所有可用策略
   */
  getAllPolicies() {
    return { ...this.#policies };
  }

  /**
   * 获取工具类的中文标签
   */
  static getToolClassLabel(toolClass) {
    const labels = {
      [ToolClass.READ]: '读文件',
      [ToolClass.SEARCH]: '搜索',
      [ToolClass.EDIT]: '编辑',
      [ToolClass.SHELL]: 'Shell',
      [ToolClass.SHELL_READONLY]: '只读Shell',
      [ToolClass.GIT]: 'Git',
      [ToolClass.MUTATION]: '文件修改',
    };
    return labels[toolClass] || toolClass;
  }
}

export default new PolicyRegistry();
