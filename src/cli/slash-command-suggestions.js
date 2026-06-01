const BUILTIN_COMMANDS = [
  { name: '/help', description: 'Show help', source: 'builtin' },
  { name: '/clear', description: 'Clear the screen', source: 'builtin' },
  { name: '/menu', description: 'Open interactive menu', source: 'builtin' },
  { name: '/task', description: 'Manage tasks', source: 'builtin' },
  { name: '/tasks', description: 'List tasks', source: 'builtin' },
  { name: '/schedule', description: 'Manage schedules', source: 'builtin' },
  { name: '/schedules', description: 'List schedules', source: 'builtin' },
  { name: '/subagent', description: 'Manage subagents', source: 'builtin' },
  { name: '/subagents', description: 'List subagents', source: 'builtin' },
  { name: '/git', description: 'Run git helpers', source: 'builtin' },
  { name: '/mcp', description: 'Manage MCP servers', source: 'builtin' },
  { name: '/security', description: 'Inspect security policy', source: 'builtin' },
  { name: '/experience', description: 'Search experience memory', source: 'builtin' },
  { name: '/context', description: 'Show project memory context', source: 'builtin' },
  { name: '/memory', description: 'Show project memory context', source: 'builtin' },
  { name: '/compress', description: 'Compress text', source: 'builtin' },
  { name: '/reason', description: 'Inspect reasoning candidates', source: 'builtin' },
  { name: '/auto', description: 'Manage automations', source: 'builtin' },
  { name: '/stats', description: 'Show statistics', source: 'builtin' },
  { name: '/status', description: 'Show status', source: 'builtin' },
  { name: '/tools', description: 'List tools', source: 'builtin' },
  { name: '/list', description: 'List tools', source: 'builtin' },
  { name: '/debug', description: 'Toggle debug logging', source: 'builtin' },
  { name: '/model', description: 'Switch model', source: 'builtin' },
];

export function toolNameToSlashCommand(name) {
  return `/${name.replace(/_/g, '-')}`;
}

export function buildSlashCommandSuggestions(skillTools = []) {
  const seen = new Set();
  const commands = [];

  for (const command of BUILTIN_COMMANDS) {
    seen.add(command.name);
    commands.push(command);
  }

  for (const tool of skillTools) {
    const name = toolNameToSlashCommand(tool.name);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    commands.push({
      name,
      description: tool.description || `Run ${tool.name}`,
      source: 'skill',
    });
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSlashCommandSuggestions(commands, input, limit = 8) {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) {
    return [];
  }

  return commands
    .filter(command => command.name.startsWith(trimmed))
    .sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === 'skill' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function formatSlashCommandSuggestions(commands, theme = {}) {
  const primary = theme.primary || (text => text);
  const dim = theme.dim || (text => text);
  const names = commands.map(command => primary(command.name));
  return `${dim('Commands:')} ${names.join(dim('  '))}`;
}
