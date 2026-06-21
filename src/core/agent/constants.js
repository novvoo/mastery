export const MAX_ITERATIONS_DEFAULT = 120;

export const TERMINATION_KEYWORDS = ['FINAL_ANSWER:', 'Answer:', 'TASK_COMPLETE'];

// 自适应迭代预算（占 maxIterations 的比例）
export const ITERATION_BUDGET = {
  trivial: 0.25,
  simple: 0.5,
  normal: 0.8,
  intensive: 1.0,
  exploration: 1.0,
};

// 停滞检测
export const STAGNATION_LOOKBACK = 10;
export const STAGNATION_SAME_TOOL_LIMIT = 6;
export const STAGNATION_NO_MUTATION_LIMIT = 8;
export const PROGRESS_CHECKPOINT_INTERVAL = 12;
export const MAX_STAGNATION_NUDGES = 2;
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
  'pty_read',
  'semantic_search',
]);
// Inspection-only tools (read back your own edits is NOT a runtime test).
export const INSPECTION_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'search',
  'semantic_search',
  'review',
]);
// True runtime verification: shell/pty that runs test/lint/build commands, or verify tool.
export const RUNTIME_VERIFICATION_TOOLS = new Set([
  'verify',
  'shell',
  'pty_start',
  'pty_write',
  'pty_read',
]);
// Shell sub-command patterns that count as real runtime verification.
export const RUNTIME_VERIFICATION_COMMAND_PATTERNS = [
  /\b(test|tests|testing)\b/i,
  /\b(lint|linting|eslint|prettier)\b/i,
  /\b(build|compile|bundle|tsc|webpack|rollup|vite build|babel)\b/i,
  /\b(type.?check|typecheck|check)\b/i,
  /\b(npm|pnpm|yarn|bun|node|python|pytest|vitest|jest|mocha|cargo|go test|dotnet test|mvn test|gradle test)\b/i,
];
export const SEMANTIC_RISK_DOMAINS = [
  {
    id: 'units_timing',
    label: 'units/time/animation semantics',
    pattern: /时间|速度|帧|毫秒|秒|定时|计时|循环|动画|游戏|物理|实时|fps|frame|clock|tick|speed|interval|timeout|timer|animation|game|physics|realtime|real-time/i,
    checklist: 'track units in variable names and API arguments; separate render FPS from simulation/update intervals; verify user-visible timing or movement behavior',
  },
  {
    id: 'api_semantics',
    label: 'third-party API semantics',
    pattern: /api|sdk|库|框架|pygame|three\.js|react|vue|express|fastapi|requestanimationframe|setinterval|settimeout|websocket|http|fetch/i,
    checklist: 'confirm parameter meanings, return values, lifecycle constraints, and error behavior before treating a call as correct',
  },
  {
    id: 'state_transitions',
    label: 'state transition invariants',
    pattern: /状态|状态机|胜负|分数|移动|碰撞|合并|撤销|重试|缓存|session|state|fsm|transition|score|collision|merge|retry|cache/i,
    checklist: 'verify state invariants, edge transitions, reset behavior, and repeated-action behavior',
  },
  {
    id: 'concurrency_io',
    label: 'async/concurrency/io semantics',
    pattern: /并发|异步|队列|锁|流|文件|网络|超时|重试|async|await|promise|concurrent|parallel|queue|lock|stream|file|network|timeout|retry/i,
    checklist: 'check ordering, cancellation, timeout/retry behavior, idempotency, and partial failure handling',
  },
  {
    id: 'security_boundary',
    label: 'security/input boundary semantics',
    pattern: /安全|权限|认证|登录|密钥|token|注入|沙箱|secret|password|auth|permission|sanitize|injection|sandbox|xss|csrf/i,
    checklist: 'validate trust boundaries, secrets handling, escaping/sanitization, and permission checks',
  },
];
