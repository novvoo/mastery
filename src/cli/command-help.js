export const COMMAND_HELP = {
  help: {
    title: '/help',
    description: 'Show command documentation. Use it with a command name to get detailed help.',
    usage: ['/help', '/help tdd', '/help git', '/help skills'],
    effects: ['Prints documentation only.', 'Does not call the LLM and does not modify files.'],
    examples: ['/help skills', '/help auto', '/help memory'],
  },
  clear: {
    title: '/clear',
    description: 'Clear the terminal screen and redraw the welcome panel.',
    usage: ['/clear', '/reset'],
    effects: ['Only affects the terminal display.', 'Does not clear project memory or files.'],
    examples: ['/clear'],
  },
  menu: {
    title: '/menu',
    description:
      'Open the interactive menu for users who prefer picking actions instead of typing subcommands.',
    usage: ['/menu'],
    effects: ['Starts an interactive prompt.', 'Does not call the LLM by itself.'],
    examples: ['/menu'],
  },
  task: {
    title: '/task',
    description: 'Inspect and manage the local scheduler task queue.',
    usage: [
      '/task',
      '/task list [--status=<status>] [--limit=<n>]',
      '/task status <id>',
      '/task cancel <id>',
    ],
    effects: ['Reads task queue state.', 'cancel/retry subcommands can change task state.'],
    examples: ['/task', '/task status task_123', '/task cancel task_123'],
  },
  schedule: {
    title: '/schedule',
    description: 'Inspect and manage scheduled tasks.',
    usage: ['/schedule', '/schedule list [--enabled]', '/schedule toggle <id>'],
    effects: ['Reads scheduler state.', 'toggle can enable or disable a schedule.'],
    examples: ['/schedule', '/schedule toggle daily-review'],
  },
  subagent: {
    title: '/subagent',
    description: 'Inspect and manage active subagents spawned by the scheduler/subagent pool.',
    usage: ['/subagent', '/subagent list', '/subagent stop <id>'],
    effects: ['Reads subagent state.', 'stop can terminate a running subagent.'],
    examples: ['/subagent', '/subagent stop subagent_123'],
  },
  git: {
    title: '/git',
    description:
      'Convenience Git commands for status, diff, staging, commit, branch, sync, and stash operations.',
    usage: [
      '/git',
      '/git status',
      '/git diff [--staged] [--stat] [file...]',
      '/git add [-A | files...]',
      '/git commit <message>',
      '/git push [remote] [branch]',
      '/git menu',
    ],
    effects: [
      'status/diff/log/list are read-only.',
      'add/commit/push/pull/stash/reset can change repository state or remote state.',
    ],
    examples: [
      '/git',
      '/git diff --stat',
      '/git add src/index.js test-integration.mjs',
      '/git commit "fix cli help"',
    ],
  },
  mcp: {
    title: '/mcp',
    description:
      'Manage Model Context Protocol servers and tools. Connected MCP tools become callable by the agent.',
    usage: [
      '/mcp',
      '/mcp status',
      '/mcp list',
      '/mcp tools',
      '/mcp connect <name> <command> [args...]',
      '/mcp call <server/tool>',
      '/mcp menu',
    ],
    effects: [
      'status/list/tools are read-only.',
      'connect/disconnect changes runtime MCP connections.',
      'call executes a tool exposed by an MCP server.',
    ],
    examples: [
      '/mcp status',
      '/mcp tools',
      '/mcp connect filesystem npx @modelcontextprotocol/server-filesystem .',
    ],
  },
  security: {
    title: '/security',
    description:
      'Inspect tool permission policy, approval requirements, concurrency safety, and external effects.',
    usage: [
      '/security',
      '/security report',
      '/security policy <tool>',
      '/security list',
      '/security menu',
    ],
    effects: ['Read-only inspection of security policy.', 'Does not change tool permissions.'],
    examples: ['/security', '/security policy shell', '/security list'],
  },
  experience: {
    title: '/experience',
    description:
      'Inspect the local experience memory: learned successes, failures, and reusable lessons.',
    usage: [
      '/experience',
      '/experience stats',
      '/experience list [n]',
      '/experience search <query>',
      '/experience clear',
      '/experience menu',
    ],
    effects: ['stats/list/search are read-only.', 'clear deletes stored experience memory.'],
    examples: ['/experience', '/experience list 5', '/experience search "web_search weather"'],
  },
  memory: {
    title: '/memory',
    description:
      'Show project CONTEXT.md-derived memory: current task, decisions, constraints, file map, and notes.',
    usage: ['/memory', '/context', '/memory full', '/context full'],
    effects: [
      'Read-only project memory display.',
      'Does not call the LLM and does not modify files.',
    ],
    examples: ['/memory', '/memory full'],
  },
  doc: {
    title: '/doc',
    description:
      'Manage user-provided document RAG context for local files, PDFs, DOCX files, URLs, and pasted text.',
    usage: [
      '/doc',
      '/doc init',
      '/doc add [path-or-url]',
      '/doc search <query>',
      '/doc list',
      '/doc clear [document-id]',
      'Ask naturally with @path or @"path with spaces.pdf"',
    ],
    effects: [
      'init preflights the embedding runtime and shows model/download status.',
      'add indexes a document in the current in-memory RAG index.',
      'search retrieves relevant chunks without calling the LLM.',
      'clear removes indexed document context for this CLI session.',
    ],
    examples: [
      '/doc init',
      '/doc add ./docs/spec.pdf',
      '/doc add https://example.com/runbook',
      '根据 @./docs/spec.pdf 总结风险',
      '/doc search "rollback policy"',
      '/doc clear',
    ],
  },
  preview: {
    title: '/preview',
    description: 'Start, list, or stop a local preview for generated HTML or Node projects.',
    usage: [
      '/preview [path]',
      '/preview node [path] [command]',
      '/preview list',
      '/preview stop <session-id>',
    ],
    effects: [
      'Serves workspace HTML over localhost.',
      'Starts Node dev servers with PORT/HOST when requested.',
    ],
    examples: [
      '/preview index.html',
      '/preview .',
      '/preview node . "npm run dev"',
      '/preview list',
    ],
  },
  compress: {
    title: '/compress',
    description: 'Compress text with TokenJuice and show token/character savings.',
    usage: ['/compress <text>'],
    effects: [
      'Transforms the provided text and prints the compressed result.',
      'Does not modify files.',
    ],
    examples: ['/compress This is a long paragraph that should be shortened.'],
  },
  reason: {
    title: '/reason',
    description:
      'Use the local intelligent reasoning helper to analyze intent, recommend tools, or decompose tasks.',
    usage: [
      '/reason',
      '/reason intent <text>',
      '/reason tools <task>',
      '/reason decompose <task>',
      '/reason menu',
    ],
    effects: ['Runs local reasoning heuristics.', 'Does not modify files.'],
    examples: [
      '/reason intent "上海天气"',
      '/reason tools "review this CLI command router"',
      '/reason decompose "ship a standalone binary"',
    ],
  },
  auto: {
    title: '/auto',
    description:
      'Inspect and control the automation engine for triggers, workflows, and background tasks.',
    usage: [
      '/auto',
      '/auto status',
      '/auto start',
      '/auto stop',
      '/auto triggers',
      '/auto workflows',
      '/auto background',
      '/auto menu',
    ],
    effects: [
      'status/triggers/workflows/background are read-only.',
      'start/stop changes whether automation runs.',
    ],
    examples: ['/auto', '/auto start', '/auto triggers'],
  },
  stats: {
    title: '/stats',
    description: 'Show system statistics for scheduler, task queue, subagents, and runtime state.',
    usage: ['/stats', '/status'],
    effects: ['Read-only status report.', 'Does not call the LLM.'],
    examples: ['/stats'],
  },
  tools: {
    title: '/tools',
    description: 'List tools currently registered for the agent, grouped by category.',
    usage: ['/tools', '/list'],
    effects: [
      'Read-only tool registry display.',
      'Use slash skill commands directly, e.g. /tdd --help.',
    ],
    examples: ['/tools', '/help skills'],
  },
  debug: {
    title: '/debug',
    description:
      'Inspect or toggle debug logging for model requests, tool calls, shell execution, and agent lifecycle.',
    usage: ['/debug', '/debug status', '/debug on', '/debug off'],
    effects: ['Changes runtime debug verbosity.', 'Does not modify files.'],
    examples: ['/debug status', '/debug on', '/debug off'],
  },
  model: {
    title: '/model',
    description: 'Inspect or switch the active model provider/model for the current CLI session.',
    usage: ['/model', '/model switch', '/model <provider>:<model>'],
    effects: ['Shows or changes the runtime model selection.', 'Does not edit persisted config.'],
    examples: ['/model', '/model switch', '/model openai:gpt-4.1'],
  },
  skills: {
    title: '/help skills',
    description:
      'List methodology slash commands such as /tdd, /review, /brainstorm, /verify, and /architect.',
    usage: ['/help skills', '/help <skill-name>', '/<skill-name> --help'],
    effects: ['Read-only command discovery.', 'Does not call the LLM.'],
    examples: ['/help skills', '/help tdd', '/review --help'],
  },
};

export const COMMAND_HELP_ALIASES = {
  '?': 'help',
  reset: 'clear',
  tasks: 'task',
  schedules: 'schedule',
  subagents: 'subagent',
  docs: 'doc',
  document: 'doc',
  documents: 'doc',
  preview: 'preview',
  context: 'memory',
  status: 'stats',
  list: 'tools',
};
