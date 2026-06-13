export const MAIN_MENU_CHOICES = [
  { name: '📋 Task Management', value: 'tasks' },
  { name: '⏰ Schedule Management', value: 'schedules' },
  { name: '🤖 SubAgent Management', value: 'subagents' },
  { name: '🌿 Git Operations', value: 'git' },
  { name: '🔗 MCP Management', value: 'mcp' },
  { name: '🔒 Security', value: 'security' },
  { name: '🧠 Experience Memory', value: 'experience' },
  { name: '🎯 Intelligent Reasoning', value: 'reasoning' },
  { name: '⚙️  Automation', value: 'automation' },
  { name: '📊 View Statistics', value: 'stats' },
  { name: '💬 Message Bus', value: 'messages' },
  { name: '❌ Exit', value: 'exit' },
];

export const TASK_MENU_CHOICES = [
  { name: '📋 List Tasks', value: 'list' },
  { name: '➕ Create Task', value: 'create' },
  { name: '🔍 View Task Details', value: 'detail' },
  { name: '🗑️  Cancel Task', value: 'cancel' },
  { name: '🔁 Retry Failed Task', value: 'retry' },
  { name: '⬅️  Back', value: 'back' },
];

export const TASK_PRIORITY_CHOICES = [
  { name: '🔴 Critical', value: 0 },
  { name: '🟠 High', value: 1 },
  { name: '🔵 Normal', value: 2 },
  { name: '🟢 Low', value: 3 },
  { name: '⚪ Background', value: 4 },
];

export const SCHEDULE_MENU_CHOICES = [
  { name: '📋 List Schedules', value: 'list' },
  { name: '➕ Create Schedule', value: 'create' },
  { name: '🔍 View Schedule Details', value: 'detail' },
  { name: '⏯️  Toggle Schedule', value: 'toggle' },
  { name: '⬅️  Back', value: 'back' },
];

export const GIT_MENU_CHOICES = [
  { name: '📋 Status', value: 'status' },
  { name: '📝 Diff', value: 'diff' },
  { name: '➕ Add', value: 'add' },
  { name: '💾 Commit', value: 'commit' },
  { name: '🌿 Branch', value: 'branch' },
  { name: '📜 Log', value: 'log' },
  { name: '⬆️  Push', value: 'push' },
  { name: '⬇️  Pull', value: 'pull' },
  { name: '📦 Stash', value: 'stash' },
  { name: '↩️  Reset', value: 'reset' },
  { name: '⬅️  Back', value: 'back' },
];

export const MCP_MENU_CHOICES = [
  { name: '📊 Status', value: 'status' },
  { name: '🌐 List Servers', value: 'list' },
  { name: '🔧 List Tools', value: 'tools' },
  { name: '📂 List Resources', value: 'resources' },
  { name: '🔗 Connect Server', value: 'connect' },
  { name: '✂️  Disconnect Server', value: 'disconnect' },
  { name: '⚡ Call Tool', value: 'call' },
  { name: '⬅️  Back', value: 'back' },
];

export const SECURITY_MENU_CHOICES = [
  { name: '📊 Security Report', value: 'report' },
  { name: '🔍 Tool Policy Detail', value: 'policy' },
  { name: '📋 List Tools by Permission', value: 'list' },
  { name: '⬅️  Back', value: 'back' },
];

export const EXPERIENCE_MENU_CHOICES = [
  { name: '📊 Statistics', value: 'stats' },
  { name: '📋 List Recent', value: 'list' },
  { name: '🔍 Search', value: 'search' },
  { name: '🗑️  Clear All', value: 'clear' },
  { name: '⬅️  Back', value: 'back' },
];

export const REASON_MENU_CHOICES = [
  { name: '🎯 Analyze Intent', value: 'intent' },
  { name: '🔧 Recommend Tools', value: 'tools' },
  { name: '📋 Decompose Task', value: 'decompose' },
  { name: '⬅️  Back', value: 'back' },
];

export function automationMenuChoices(isRunning) {
  return [
    { name: isRunning ? '⏹️  Stop Engine' : '▶️  Start Engine', value: 'toggle' },
    { name: '📊 Status', value: 'status' },
    { name: '🔗 Triggers', value: 'triggers' },
    { name: '📋 Workflows', value: 'workflows' },
    { name: '🔄 Background Tasks', value: 'background' },
    { name: '⬅️  Back', value: 'back' },
  ];
}

export async function runGit(args) {
  const { spawnSync } = await import('child_process');
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(output.trim() || `git exited with status ${result.status}`);
  }
  return output;
}
