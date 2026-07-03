import { PlanType } from './plan-types.js';

export const PlanningArchitecture = Object.freeze({
  REACT: 'react',
  PLAN_EXECUTE: 'plan_execute',
  REWOO: 'rewoo',
  DAG: 'dag',
  TREE_SEARCH: 'tree_search',
  REFLEXION: 'reflexion',
});

export const PLANNING_ARCHITECTURE_OPTIONS = Object.freeze({
  [PlanningArchitecture.REACT]: {
    label: 'ReAct loop',
    description: 'Interleave reasoning, tool action, and observation for adaptive execution.',
  },
  [PlanningArchitecture.PLAN_EXECUTE]: {
    label: 'Plan-and-Execute',
    description: 'Create an upfront plan, then execute and update it step by step.',
  },
  [PlanningArchitecture.REWOO]: {
    label: 'ReWOO-style planner',
    description: 'Separate planning from observations to reduce repeated reasoning work.',
  },
  [PlanningArchitecture.DAG]: {
    label: 'DAG orchestration',
    description: 'Represent task dependencies explicitly and expose parallel execution potential.',
  },
  [PlanningArchitecture.TREE_SEARCH]: {
    label: 'Tree-search planning',
    description: 'Explore and compare alternative branches before committing to a path.',
  },
  [PlanningArchitecture.REFLEXION]: {
    label: 'Reflective repair',
    description: 'Use failed verification or tool feedback to insert repair tasks and retry.',
  },
});

export function selectPlanningArchitecture({
  planType = PlanType.STANDARD,
  decomposition = 'template',
  shape = 'linear',
  taskProfile = {},
  dynamicReplanning = false,
  verificationRepairCount = 0,
} = {}) {
  if (dynamicReplanning || verificationRepairCount > 0) {
    return PlanningArchitecture.REFLEXION;
  }

  if (shape === 'dag') {
    return PlanningArchitecture.DAG;
  }

  if (decomposition === 'llm') {
    return PlanningArchitecture.PLAN_EXECUTE;
  }

  if (
    [PlanType.RESEARCH, PlanType.ANALYSIS, PlanType.CODE_REVIEW, PlanType.VERIFICATION].includes(
      planType,
    )
  ) {
    return PlanningArchitecture.REACT;
  }

  if (
    taskProfile?.riskLevel === 'high' ||
    Number(taskProfile?.riskScore || 0) >= 5 ||
    [PlanType.SECURITY, PlanType.MIGRATION, PlanType.RELEASE].includes(planType)
  ) {
    return PlanningArchitecture.PLAN_EXECUTE;
  }

  if ([PlanType.QUICK, PlanType.DOCUMENTATION].includes(planType)) {
    return PlanningArchitecture.REACT;
  }

  return PlanningArchitecture.PLAN_EXECUTE;
}

export function describePlanningArchitecture(architecture) {
  return PLANNING_ARCHITECTURE_OPTIONS[architecture] || PLANNING_ARCHITECTURE_OPTIONS.react;
}
