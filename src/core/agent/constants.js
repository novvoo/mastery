import {
  TERMINATION_KEYWORDS,
  SEMANTIC_RISK_DOMAINS,
  RUNTIME_VERIFICATION_COMMAND_PATTERNS,
} from '../../utils/patterns.js';

export { TERMINATION_KEYWORDS, SEMANTIC_RISK_DOMAINS, RUNTIME_VERIFICATION_COMMAND_PATTERNS };

export const MAX_ITERATIONS_DEFAULT = 120;

export const ITERATION_BUDGET = {
  trivial: 0.25,
  simple: 0.5,
  normal: 0.8,
  intensive: 1.0,
  exploration: 1.0,
};

export const STAGNATION_LOOKBACK = 8;
export const STAGNATION_SAME_TOOL_LIMIT = 3;
export const STAGNATION_NO_MUTATION_LIMIT = 5;
export const PROGRESS_CHECKPOINT_INTERVAL = 8;
export const MAX_STAGNATION_NUDGES = 3;

export const EXPLORATION_BUDGET = 10;
export const FORCE_ACTION_GRACE_TURNS = 3;
export const METHODOLOGY_TOOLS = new Set([
  'coverage_check',
  'ask_user',
  'brainstorm',
  'grill',
  'zoom_out',
  'tdd',
  'review',
  'verify',
  'diagnose',
  'architect',
  'to_prd',
  'to_issues',
  'setup',
  'impact_map',
  'project_profile',
  'risk_check',
  'test_strategy',
  'migration_plan',
  'release_checklist',
  'ui_acceptance',
  'data_contract_check',
  'security_review',
]);
export const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'shell',
  'pty_start',
  'pty_write',
  'git_apply_patch',
  'git_commit',
  'git_push',
]);
export const VERIFICATION_TOOLS = new Set([
  'verify',
  'review',
  'read_file',
  'list_dir',
  'glob',
  'search',
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
  'semantic_search',
]);
export const INSPECTION_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'search',
  'semantic_search',
  'review',
]);
export const RUNTIME_VERIFICATION_TOOLS = new Set([
  'verify',
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
]);
