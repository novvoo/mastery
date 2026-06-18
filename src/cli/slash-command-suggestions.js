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
  { name: '/git', description: 'Show git status', source: 'builtin' },
  { name: '/mcp', description: 'Show MCP status', source: 'builtin' },
  { name: '/security', description: 'Show security report', source: 'builtin' },
  { name: '/experience', description: 'Show experience stats', source: 'builtin' },
  { name: '/context', description: 'Show project memory context', source: 'builtin' },
  { name: '/memory', description: 'Show project memory context', source: 'builtin' },
  { name: '/doc', description: 'Manage document RAG context', source: 'builtin' },
  { name: '/docs', description: 'Manage document RAG context', source: 'builtin' },
  { name: '/document', description: 'Manage document RAG context', source: 'builtin' },
  { name: '/documents', description: 'Manage document RAG context', source: 'builtin' },
  { name: '/doc add', description: 'Index a local document or URL', source: 'builtin_subcommand' },
  { name: '/doc init', description: 'Initialize and diagnose document RAG runtime', source: 'builtin_subcommand' },
  { name: '/doc search', description: 'Search indexed documents', source: 'builtin_subcommand' },
  { name: '/doc list', description: 'List indexed documents', source: 'builtin_subcommand' },
  { name: '/doc clear', description: 'Clear indexed document context', source: 'builtin_subcommand' },
  { name: '/doc help', description: 'Show document RAG help', source: 'builtin_subcommand' },
  { name: '/preview', description: 'Preview generated HTML or Node projects', source: 'builtin' },
  { name: '/preview list', description: 'List active previews', source: 'builtin_subcommand' },
  { name: '/preview stop', description: 'Stop an active preview', source: 'builtin_subcommand' },
  { name: '/compress', description: 'Compress text', source: 'builtin' },
  { name: '/reason', description: 'Show reasoning usage', source: 'builtin' },
  { name: '/auto', description: 'Show automation status', source: 'builtin' },
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
    // tool 可能是对象 { name, description } 或字符串
    const toolName = typeof tool === 'string' ? tool : (tool?.name || tool?.fullName || '');
    if (!toolName) continue;

    const name = toolNameToSlashCommand(toolName);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    commands.push({
      name,
      description: tool.description || `Run ${toolName}`,
      source: 'skill',
    });
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSlashCommandSuggestions(commands, input, limit = 8) {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) {
    return [];
  }

  const hasSpace = /\s/.test(trimmed);

  return commands
    .filter(command => {
      if (!command.name.startsWith(trimmed)) {
        return false;
      }
      return hasSpace ? command.source === 'builtin_subcommand' : !command.name.includes(' ');
    })
    .sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === 'skill' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function completeSlashCommand(commands, line) {
  const trimmed = String(line || '').trimStart();
  if (!trimmed.startsWith('/')) {
    return [[], line];
  }

  const suggestions = filterSlashCommandSuggestions(commands, trimmed, 50);
  const hits = suggestions.map(command => `${command.name} `);
  return [hits.length > 0 ? hits : [], trimmed];
}

function compactDescription(description = '') {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > 56 ? `${text.slice(0, 53)}...` : text;
}

export function formatSlashCommandSuggestions(commands, theme = {}) {
  const primary = theme.primary || (text => text);
  const dim = theme.dim || (text => text);
  const lines = commands.map(command => {
    const description = compactDescription(command.description);
    return description
      ? `${primary(command.name)} ${dim('-')} ${dim(description)}`
      : primary(command.name);
  });
  return `${dim('Commands:')} ${lines.join(dim('  '))}`;
}
