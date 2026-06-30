import { t } from '../../../i18n.js';

export const PLAN_TYPE_LABELS = {
  standard: 'Standard',
  bug_fix: 'Debug',
  documentation: 'Docs',
  analysis: 'Analysis',
  research: 'Research',
  verification: 'Verify',
  quick: 'Quick',
  refactor: 'Refactor',
  testing: 'Testing',
  code_review: 'Review',
  migration: 'Migration',
  setup: 'Setup',
  release: 'Release',
  security: 'Security',
  data: 'Data',
  ui: 'UI',
};

export const PLAN_PHASE_ORDER = [
  'exploration',
  'planning',
  'implementation',
  'inspection',
  'verification',
];

export const PLAN_PHASE_LABELS = {
  exploration: () => t('plan.phase.exploration'),
  planning: () => t('plan.phase.planning'),
  implementation: () => t('plan.phase.implementation'),
  inspection: () => t('plan.phase.inspection'),
  verification: () => t('plan.phase.verification'),
};

export function getPlanPhaseLabel(phase) {
  const key = `plan.phase.${phase}`;
  return t(key);
}

export const PLAN_ARCHITECTURE_LABELS = {
  react: 'ReAct',
  plan_execute: 'Plan-and-Execute',
  rewoo: 'ReWOO',
  dag: 'DAG 编排',
  tree_search: 'Tree Search',
  reflexion: 'Reflective Repair',
  'plan-and-execute': 'Plan-and-Execute',
  'dag-orchestration': 'DAG 编排',
  'diagnose-act-verify': '诊断-修复-验证',
  'slice-and-verify': '切片验证',
  'coverage-driven': '覆盖率驱动',
  'read-only audit': '只读审查',
  'inventory-plan-rollout': '盘点-迁移-验证',
  'bootstrap-validate': '初始化-验证',
  'checklist-gated': '门禁清单',
  'threat-aware': '威胁感知',
  'contract-validation': '契约验证',
  'preview-and-acceptance': '预览验收',
  'outline-draft-review': '大纲-撰写-复核',
  'evidence-synthesis': '证据综合',
  'context-synthesis': '上下文综合',
  'check-and-report': '检查报告',
  'plan-execute-verify': '规划-执行-验证',
  linear: '线性执行',
};

export function getPlanModeLabel(plan) {
  const strategy = plan?.strategy || plan?.context?.strategy || {};
  if (strategy.label) return strategy.label;
  const planType = String(
    strategy.type || plan?.context?.planType || plan?.metadata?.planType || 'standard',
  ).toLowerCase();
  return PLAN_TYPE_LABELS[planType] || planType.replace(/_/g, ' ');
}

export function getPlanShapeLabel(plan, tasks) {
  const strategy = plan?.strategy || plan?.context?.strategy || {};
  if (strategy.shape) return strategy.shape === 'dag' ? 'DAG' : strategy.shape;
  const decomposition = String(plan?.context?.decomposition || '').toLowerCase();
  if (decomposition === 'llm') return 'LLM 分解';
  const hasFanIn = tasks.some(
    (task) => Array.isArray(task.dependencies) && task.dependencies.length > 1,
  );
  const dependencyCounts = new Map();
  tasks.forEach((task) => {
    (Array.isArray(task.dependencies) ? task.dependencies : []).forEach((dep) => {
      dependencyCounts.set(dep, (dependencyCounts.get(dep) || 0) + 1);
    });
  });
  const hasFanOut = Array.from(dependencyCounts.values()).some((count) => count > 1);
  return hasFanIn || hasFanOut ? 'DAG' : '线性';
}

export function groupPlanTasksByPhase(tasks) {
  const groups = new Map();
  for (const task of tasks || []) {
    const phase = String(task.phase || 'planning').toLowerCase();
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase).push(task);
  }

  // 在每个 phase 内把已经执行/开始执行的任务排在未执行任务前面。
  const statusOrder = {
    completed: 0,
    success: 0,
    failed: 0,
    error: 0,
    needs_repair: 0,
    running: 1,
    in_progress: 1,
    pending: 2,
    queued: 2,
    waiting: 2,
    blocked: 2,
  };
  for (const [, phaseTasks] of groups) {
    phaseTasks.sort((a, b) => {
      const statusA = (a.displayStatus || a.status || 'pending').toLowerCase();
      const statusB = (b.displayStatus || b.status || 'pending').toLowerCase();
      const orderA = statusOrder[statusA] ?? 1;
      const orderB = statusOrder[statusB] ?? 1;
      return orderA - orderB;
    });
  }

  return Array.from(groups.entries()).sort(([phaseA], [phaseB]) => {
    const indexA = PLAN_PHASE_ORDER.indexOf(phaseA);
    const indexB = PLAN_PHASE_ORDER.indexOf(phaseB);
    return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
  });
}

export function formatPlanStrategyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).replace(/_/g, ' ');
}
