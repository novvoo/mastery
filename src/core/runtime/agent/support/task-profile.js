/**
 * TaskProfile - 结构化任务分类系统
 *
 * 核心思想：用 TaskIntent 替代一堆松散的布尔字段，
 * 让策略决策只认这个 profile，不再到处自己判断。
 *
 * 问题背景：
 * - 把"项目相关"误当成"编码任务"
 * - isCodingTask 被赋予了太多含义
 * - Plan blacklist 被算出来了，但没有成为强约束
 * - Plan 和方法论绑定得太死
 * - 硬编码正则无法稳定表达用户意图
 */

export const TaskMode = {
  ANSWER: 'answer', // 回答型：解释、总结、运行说明
  INSPECT: 'inspect', // 观察型：读/搜/分析，只读
  DIAGNOSE: 'diagnose', // 诊断型：定位原因，默认不改
  MUTATE: 'mutate', // 修改型：plan → edit → verify
  VERIFY: 'verify', // 验证型：测试、验证
};

export const TaskIntent = {
  PROJECT_INFO: 'project_info',
  HOW_TO_RUN: 'how_to_run',
  READ_ONLY_ANALYSIS: 'read_only_analysis',
  DIAGNOSIS: 'diagnosis',
  CODE_MODIFICATION: 'code_modification',
  FEATURE_IMPLEMENTATION: 'feature_implementation',
  TEST_OR_VERIFY: 'test_or_verify',
  DOCUMENTATION: 'documentation',
  GENERAL_CHAT: 'general_chat',
  NEW_PROJECT: 'new_project',
};

// ============== 强信号正则（确定性分类）==============

const EXPLICIT_MUTATION_PATTERNS = [
  /(修复|修改|实现|添加|删除|重构|优化|改成|创建|新建|写|开发|生成|制作)/i,
  /(更新|调整|配置|部署|安装|升级|降级|完|确)/i,
  /\b(fix|modify|implement|add|remove|refactor|change|create|write|develop|build|generate|update)\b/i,
  /\b(configure|deploy|install|upgrade|downgrade|setup)\b/i,
];

const PROJECT_INFO_PATTERNS = [
  /(是什么|做什么|介绍|说明|解释|what is|what does|explain|introduce|describe)/i,
  /(怎么运行|怎么用|如何运行|怎么启动|如何启动|how to run|how to use|usage|start|launch)/i,
];

const DIAGNOSTIC_PATTERNS = [
  /(为什么|原因|报错|错误|失败|bug|error|why|root cause|fails?|failing|broken|hang|stuck|crash)/i,
];

const VERIFY_PATTERNS = [
  /(验证|测试|跑测试|检查结果|确认|构建|编译|运行一下|启动一下|预览)/i,
  /\b(verify|validate|run tests?|test|check result|confirm|build|compile|preview)\b/i,
];

const HOW_TO_RUN_PATTERNS = [
  /(怎么运行|如何运行|怎么启动|如何启动|启动项目|运行项目)/i,
  /\b(how to run|how to start|start this project|run this project)\b/i,
];

const READ_ONLY_PATTERNS = [
  /(查看|检查|看下|分析|阅读|统计|列出|浏览)/,
  /\b(inspect|check|view|read|list|show|analyze|review)\b/,
];

const NEW_PROJECT_PATTERNS = [
  /(创建项目|新建项目|初始化项目|搭建项目|工程化)/i,
  /(创建.*游戏|开发.*游戏|制作.*游戏)/i,
  /\b(create project|new project|init project|setup project|build project)\b/i,
  /\b(engineering|project structure|src\/|package\.json)\b/i,
];

const PLAN_TRIGGER_PATTERNS = [
  /\.(js|ts|jsx|tsx|py|go|java|cpp|c|rs|vue|html|css|json|yaml|yml|md|sql)\b/i,
  /\/[\w.-]+\/[\w.-]+\./,
  /步骤|流程|任务|方案|计划|策略/i,
  /\b(step|task|plan|strategy|approach|method)\b/i,
];

// ============== 分类函数 ==============

/**
 * 结构化任务分类
 * @param {string} userInput - 用户输入
 * @param {object|null} llmIntent - LLM 意图分析结果（可选）
 * @returns {object} TaskProfile
 */
export function classifyTask(userInput, llmIntent = null) {
  const text = String(userInput || '')
    .toLowerCase()
    .trim();

  const hasExplicitMutationIntent = EXPLICIT_MUTATION_PATTERNS.some((p) => p.test(text));
  const hasQuestionIntent = PROJECT_INFO_PATTERNS.some((p) => p.test(text));
  const hasDiagnosticIntent = DIAGNOSTIC_PATTERNS.some((p) => p.test(text));
  const hasVerifyIntent = VERIFY_PATTERNS.some((p) => p.test(text));
  const hasHowToRunIntent = HOW_TO_RUN_PATTERNS.some((p) => p.test(text));
  const hasReadOnlyIntent = READ_ONLY_PATTERNS.some((p) => p.test(text));
  const hasPlanTrigger = PLAN_TRIGGER_PATTERNS.some((p) => p.test(text));

  // === 确定性规则校验 LLM 输出 ===
  if (llmIntent && typeof llmIntent === 'object') {
    // 如果确定性规则说这是纯信息查询，强制覆盖
    if (hasQuestionIntent && !hasExplicitMutationIntent) {
      return buildProfile(TaskIntent.PROJECT_INFO, TaskMode.ANSWER, {
        requiresRepoRead: true,
        allowsMutation: false,
        requiresPlan: false,
        requiresMethodology: false,
        expectedDeliverable: 'answer',
      });
    }
  }

  // 修改型任务（最高优先级）
  if (hasExplicitMutationIntent) {
    const hasNewProjectIntent = NEW_PROJECT_PATTERNS.some((p) => p.test(text));
    if (hasNewProjectIntent) {
      return buildProfile(TaskIntent.NEW_PROJECT, TaskMode.MUTATE, {
        requiresRepoRead: true,
        allowsMutation: true,
        requiresPlan: true,
        requiresMethodology: true,
        requiresVerification: true,
        expectedDeliverable: 'project_structure',
      });
    }
    if (hasDiagnosticIntent) {
      return buildProfile(TaskIntent.CODE_MODIFICATION, TaskMode.MUTATE, {
        requiresRepoRead: true,
        allowsMutation: true,
        requiresPlan: true,
        requiresMethodology: true,
        requiresVerification: true,
        expectedDeliverable: 'patch',
      });
    }
    return buildProfile(TaskIntent.FEATURE_IMPLEMENTATION, TaskMode.MUTATE, {
      requiresRepoRead: true,
      allowsMutation: true,
      requiresPlan: true,
      requiresMethodology: true,
      requiresVerification: true,
      expectedDeliverable: 'patch',
    });
  }

  // 诊断型任务 - 有文件路径时需要计划
  if (hasDiagnosticIntent) {
    const needsPlan = hasPlanTrigger;
    return buildProfile(TaskIntent.DIAGNOSIS, TaskMode.DIAGNOSE, {
      requiresRepoRead: true,
      allowsMutation: false,
      requiresPlan: needsPlan ? true : 'optional',
      requiresMethodology: 'optional',
      requiresVerification: false,
      expectedDeliverable: 'report',
    });
  }

  if (hasVerifyIntent) {
    return buildProfile(TaskIntent.TEST_OR_VERIFY, TaskMode.VERIFY, {
      requiresRepoRead: true,
      allowsMutation: false,
      requiresPlan: 'optional',
      requiresMethodology: false,
      requiresVerification: true,
      expectedDeliverable: 'verification',
    });
  }

  // 项目信息型任务 - 不需要计划
  if (hasQuestionIntent) {
    return buildProfile(
      hasHowToRunIntent ? TaskIntent.HOW_TO_RUN : TaskIntent.PROJECT_INFO,
      TaskMode.ANSWER,
      {
        requiresRepoRead: true,
        allowsMutation: false,
        requiresPlan: hasHowToRunIntent ? 'optional' : false,
        requiresMethodology: false,
        expectedDeliverable: 'answer',
      },
    );
  }

  // 只读分析型 - 有文件路径时需要计划
  if (hasReadOnlyIntent) {
    const needsPlan = hasPlanTrigger;
    return buildProfile(TaskIntent.READ_ONLY_ANALYSIS, TaskMode.INSPECT, {
      requiresRepoRead: true,
      allowsMutation: false,
      requiresPlan: needsPlan,
      requiresMethodology: false,
      expectedDeliverable: 'report',
    });
  }

  // 默认：通用对话
  return buildProfile(TaskIntent.GENERAL_CHAT, TaskMode.ANSWER, {
    requiresRepoRead: false,
    allowsMutation: false,
    requiresPlan: false,
    requiresMethodology: false,
    expectedDeliverable: 'answer',
  });
}

/**
 * 构建 TaskProfile 对象
 */
function buildProfile(intent, mode, options = {}) {
  return {
    intent,
    mode,
    requiresRepoRead: options.requiresRepoRead ?? false,
    allowsMutation: options.allowsMutation ?? false,
    requiresPlan: options.requiresPlan ?? false,
    requiresMethodology: options.requiresMethodology ?? false,
    requiresVerification: options.requiresVerification ?? false,
    expectedDeliverable: options.expectedDeliverable ?? 'answer',
    confidence: options.confidence ?? 0.85,
  };
}

/**
 * 从旧的 risk-budget profile 兼容转换
 * @deprecated 仅用于迁移期，过渡后应删除
 */
export function fromLegacyProfile(legacyProfile = {}) {
  const {
    isCodingTask,
    isModificationTask,
    isBugTask,
    isDocumentationTask,
    isAnalysisTask,
    requiresPlanning,
  } = legacyProfile;

  // 编码 + 修改 → MUTATE
  if (isModificationTask || (isCodingTask && isBugTask)) {
    return buildProfile(
      isBugTask ? TaskIntent.CODE_MODIFICATION : TaskIntent.FEATURE_IMPLEMENTATION,
      TaskMode.MUTATE,
      {
        requiresRepoRead: true,
        allowsMutation: true,
        requiresPlan: true,
        requiresMethodology: true,
        requiresVerification: true,
        expectedDeliverable: 'patch',
      },
    );
  }

  // 编码但不需要修改 → INSPECT
  if (isCodingTask) {
    return buildProfile(TaskIntent.READ_ONLY_ANALYSIS, TaskMode.INSPECT, {
      requiresRepoRead: true,
      allowsMutation: false,
      requiresPlan: false,
      requiresMethodology: false,
      expectedDeliverable: 'report',
    });
  }

  // 文档任务
  if (isDocumentationTask) {
    return buildProfile(TaskIntent.DOCUMENTATION, TaskMode.MUTATE, {
      requiresRepoRead: true,
      allowsMutation: true,
      requiresPlan: requiresPlanning,
      requiresMethodology: false,
      expectedDeliverable: 'patch',
    });
  }

  // 分析任务
  if (isAnalysisTask) {
    return buildProfile(TaskIntent.READ_ONLY_ANALYSIS, TaskMode.INSPECT, {
      requiresRepoRead: true,
      allowsMutation: false,
      requiresPlan: false,
      requiresMethodology: false,
      expectedDeliverable: 'report',
    });
  }

  // 默认：通用对话
  return buildProfile(TaskIntent.GENERAL_CHAT, TaskMode.ANSWER, {
    requiresRepoRead: false,
    allowsMutation: false,
    requiresPlan: false,
    requiresMethodology: false,
    expectedDeliverable: 'answer',
  });
}

/**
 * 判断是否应该创建执行计划
 * 规则：
 * - MUTATE 模式必须创建 plan
 * - 其他模式的 plan 策略由 profile.requiresPlan 决定
 * - requiresPlan 可以是 boolean（强制）或 'optional'（可选）
 *
 * @param {object} profile - TaskProfile
 * @returns {boolean}
 */
export function shouldCreatePlan(profile) {
  if (!profile) {
    return false;
  }
  if (!profile.requiresPlan) {
    return false;
  }

  // 如果 requiresPlan 是字符串 'optional'，需要额外判断
  // 这里简单处理：返回 true，让调用方决定是否真的启用
  return true;
}

/**
 * 判断是否应该启用计划
 *
 * @param {object} profile - TaskProfile
 * @param {object} context - 额外上下文（保留兼容）
 * @returns {boolean}
 */
export function shouldEnablePlan(profile, context = {}) {
  if (!profile) {
    return false;
  }
  if (!profile.requiresPlan) {
    return false;
  }

  // MUTATE 模式强制启用
  if (profile.mode === TaskMode.MUTATE) {
    return true;
  }

  // 其他模式：requiresPlan 为 true 时启用
  return profile.requiresPlan === true;
}

/**
 * 判断是否允许工具进行文件修改
 */
export function allowsMutation(profile) {
  if (!profile) {
    return false;
  }
  return profile.allowsMutation && profile.mode === TaskMode.MUTATE;
}

export default {
  TaskMode,
  TaskIntent,
  classifyTask,
  fromLegacyProfile,
  shouldCreatePlan,
  shouldEnablePlan,
  allowsMutation,
};
