export const TOOL_CODE_CALL_NAMES = [
  'ls',
  'list',
  'list_files',
  'list_dir',
  'list_directory',
  'inspect_workspace',
  'cat',
  'read',
  'read_file',
  'write',
  'write_file',
  'shell',
  'bash',
  'run',
  'run_command',
  'web_search',
  'search_web',
  'browser_search',
  'web_fetch',
  'fetch_url',
];

export const NAMED_XML_TOOL_ALIASES = {
  list_files: 'list_dir',
  list_directory: 'list_dir',
  ls: 'list_dir',
  inspect_workspace: 'list_dir',
  read: 'read_file',
  cat: 'read_file',
  write: 'write_file',
  save_file: 'write_file',
  run_command: 'shell',
  execute_command: 'shell',
  run_in_terminal: 'shell',
  terminal: 'shell',
  exec: 'shell',
  bash: 'shell',
  search_web: 'web_search',
  browser_search: 'web_search',
  google: 'web_search',
  internet_search: 'web_search',
  fetch_url: 'web_fetch',
  browser_fetch: 'web_fetch',
};

const TOOL_CODE_ALIASES = {
  ls: 'list_dir',
  list: 'list_dir',
  list_files: 'list_dir',
  list_dir: 'list_dir',
  list_directory: 'list_dir',
  inspect_workspace: 'list_dir',
  cat: 'read_file',
  read: 'read_file',
  read_file: 'read_file',
  write: 'write_file',
  write_file: 'write_file',
  shell: 'shell',
  bash: 'shell',
  run: 'shell',
  run_command: 'shell',
  execute_command: 'shell',
  run_in_terminal: 'shell',
  terminal: 'shell',
  exec: 'shell',
  search_web: 'web_search',
  browser_search: 'web_search',
  web_search: 'web_search',
  google: 'web_search',
  internet_search: 'web_search',
  fetch_url: 'web_fetch',
  browser_fetch: 'web_fetch',
  web_fetch: 'web_fetch',
};

const RUNTIME_COMMAND_ALIASES = {
  list_files: 'list_dir',
  list_directory: 'list_dir',
  list: 'list_dir',
  inspect_workspace: 'list_dir',
  ls: 'list_dir',
  read: 'read_file',
  cat: 'read_file',
  write: 'write_file',
  write_file: 'write_file',
  save_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  // shell 别名：映射为 'shell' 后，裸命令格式会将其整体作为 shell 命令执行
  // （避免 'run_command npm test' 被拆解为不存在的 'run_command' 命令）
  shell: 'shell',
  bash: 'shell',
  run: 'shell',
  run_command: 'shell',
  execute_command: 'shell',
  run_in_terminal: 'shell',
  terminal: 'shell',
  exec: 'shell',
  search_web: 'web_search',
  browser_search: 'web_search',
  internet_search: 'web_search',
  fetch_url: 'web_fetch',
  browser_fetch: 'web_fetch',
};

export function stripShellTokenQuotes(value) {
  return String(value || '').replace(/^['"]|['"]$/g, '');
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function normalizeToolName(value) {
  return String(value || '')
    .replace(/^\//, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

export function mapRuntimeToolCommandName(rawName, resolveToolName) {
  const snakeName = normalizeToolName(rawName);
  return RUNTIME_COMMAND_ALIASES[snakeName] || resolveToolName(snakeName);
}

export function mapToolCodeName(rawName, resolveToolName) {
  const name = String(rawName || '').replace(/^\//, '');
  return TOOL_CODE_ALIASES[name] || resolveToolName(name);
}

export function normalizeToolArgumentAliases(toolName, args) {
  if (!args || typeof args !== 'object') {
    return args;
  }

  if (
    (toolName === 'read_file' ||
      toolName === 'write_file' ||
      toolName === 'edit_file' ||
      toolName === 'list_dir') &&
    !args.path &&
    (args.file_path || args.file || args.filename)
  ) {
    return { ...args, path: args.file_path || args.file || args.filename };
  }
  if (toolName === 'project_profile' && args.task === undefined) {
    const taskParts = [
      args.issue,
      args.problem,
      args.finding,
      args.solution,
      args.goal,
      args.request,
      args.description,
    ].filter((part) => typeof part === 'string' && part.trim());
    if (taskParts.length > 0) {
      return { ...args, task: taskParts.join('\n') };
    }
  }
  return args;
}
