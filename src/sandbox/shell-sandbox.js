import { tmpdir, homedir } from 'os';
import { delimiter, resolve, sep } from 'path';
import { spawnSync } from 'child_process';

const NETWORK_COMMAND_PATTERN = /\b(curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet|ftp|git\s+clone|git\s+fetch|git\s+pull|npm\s+install|bun\s+install|pnpm\s+install|yarn\s+install|pip\s+install)\b/i;
const WRITE_COMMAND_PATTERN = /\b(>|>>|tee|touch|mkdir|rm|rmdir|mv|cp|install|chmod|chown|sed\s+-i|perl\s+-i)\b/i;

export class ShellSandboxConfig {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.backend = options.backend || 'auto';
    this.failIfUnavailable = Boolean(options.failIfUnavailable);
    this.autoAllowIfSandboxed = options.autoAllowIfSandboxed !== false;
    this.allowUnsandboxedCommands = options.allowUnsandboxedCommands !== false;
    this.excludedCommands = listOption(options, 'excludedCommands', []);
    this.filesystem = {
      allowRead: listOption(options.filesystem, 'allowRead', []),
      denyRead: listOption(options.filesystem, 'denyRead', ['~/.ssh', '~/.aws', '~/.config/gh', '~/.netrc']),
      allowWrite: listOption(options.filesystem, 'allowWrite', ['.']),
      denyWrite: listOption(options.filesystem, 'denyWrite', ['~', '/etc', '/usr', '/bin', '/sbin', '/System']),
    };
    this.network = {
      enabled: options.network?.enabled === true,
      allowedDomains: listOption(options.network, 'allowedDomains', []),
    };
  }
}

export function shellSandboxConfigFromEnv(env = process.env) {
  return new ShellSandboxConfig({
    enabled: env.AGENT_SHELL_SANDBOX === 'true',
    backend: env.AGENT_SHELL_SANDBOX_BACKEND || 'auto',
    failIfUnavailable: env.AGENT_SHELL_SANDBOX_FAIL_IF_UNAVAILABLE === 'true',
    autoAllowIfSandboxed: env.AGENT_SHELL_SANDBOX_AUTO_ALLOW !== 'false',
    allowUnsandboxedCommands: env.AGENT_SHELL_SANDBOX_ALLOW_UNSANDBOXED !== 'false',
    excludedCommands: splitList(env.AGENT_SHELL_SANDBOX_EXCLUDED_COMMANDS),
    filesystem: {
      allowRead: splitList(env.AGENT_SANDBOX_ALLOW_READ),
      denyRead: splitList(env.AGENT_SANDBOX_DENY_READ),
      allowWrite: splitList(env.AGENT_SANDBOX_ALLOW_WRITE),
      denyWrite: splitList(env.AGENT_SANDBOX_DENY_WRITE),
    },
    network: {
      enabled: env.AGENT_SANDBOX_NETWORK === 'true',
      allowedDomains: splitList(env.AGENT_SANDBOX_ALLOWED_DOMAINS),
    },
  });
}

export function createShellSandbox(config = {}) {
  return new ShellSandbox(config instanceof ShellSandboxConfig ? config : new ShellSandboxConfig(config));
}

export class ShellSandbox {
  constructor(config = new ShellSandboxConfig()) {
    this.config = config;
  }

  prepare(command, options = {}) {
    if (!this.config.enabled) {
      return {
        sandboxed: false,
        reason: 'disabled',
        executable: command,
        args: [],
        shell: true,
      };
    }

    if (this.#isExcluded(command)) {
      if (!this.config.allowUnsandboxedCommands) {
        return this.#blocked('Command is excluded from sandbox but unsandboxed commands are disabled.');
      }
      return {
        sandboxed: false,
        reason: 'excluded_command',
        executable: command,
        args: [],
        shell: true,
      };
    }

    const policyBlock = this.#checkPolicy(command, options.cwd);
    if (policyBlock) {
      return this.#blocked(policyBlock);
    }

    const backend = this.#selectBackend();
    if (!backend) {
      if (this.config.failIfUnavailable || !this.config.allowUnsandboxedCommands) {
        return this.#blocked('Shell sandbox is enabled but no sandbox backend is available.');
      }
      return {
        sandboxed: false,
        reason: 'sandbox_unavailable_fallback',
        warning: 'Shell sandbox unavailable; command is running unsandboxed.',
        executable: command,
        args: [],
        shell: true,
      };
    }

    if (backend === 'policy') {
      return {
        sandboxed: true,
        backend,
        executable: command,
        args: [],
        shell: true,
        env: { AGENT_SANDBOX: 'policy' },
      };
    }

    if (backend === 'seatbelt') {
      return this.#prepareSeatbelt(command, options.cwd);
    }

    if (backend === 'bubblewrap') {
      return this.#prepareBubblewrap(command, options.cwd);
    }

    return this.#blocked(`Unsupported shell sandbox backend: ${backend}`);
  }

  #selectBackend() {
    const backend = this.config.backend;
    if (backend === 'policy') {
      return 'policy';
    }
    if (backend === 'seatbelt') {
      return commandExists('sandbox-exec') ? 'seatbelt' : null;
    }
    if (backend === 'bubblewrap') {
      return commandExists('bwrap') ? 'bubblewrap' : null;
    }
    if (backend !== 'auto') {
      return null;
    }
    if (process.platform === 'darwin' && commandExists('sandbox-exec')) {
      return 'seatbelt';
    }
    if (process.platform === 'linux' && commandExists('bwrap')) {
      return 'bubblewrap';
    }
    return 'policy';
  }

  #prepareSeatbelt(command, cwd) {
    const profile = this.#buildSeatbeltProfile(cwd);
    return {
      sandboxed: true,
      backend: 'seatbelt',
      executable: 'sandbox-exec',
      args: ['-p', profile, '/bin/sh', '-lc', command],
      shell: false,
      env: { AGENT_SANDBOX: 'seatbelt' },
    };
  }

  #prepareBubblewrap(command, cwd) {
    const args = [
      '--ro-bind', '/', '/',
      '--bind', cwd, cwd,
      '--tmpfs', '/tmp',
      '--dev', '/dev',
      '--proc', '/proc',
      '--chdir', cwd,
    ];
    if (!this.config.network.enabled) {
      args.push('--unshare-net');
    }
    args.push('--', '/bin/sh', '-lc', command);
    return {
      sandboxed: true,
      backend: 'bubblewrap',
      executable: 'bwrap',
      args,
      shell: false,
      env: { AGENT_SANDBOX: 'bubblewrap' },
    };
  }

  #buildSeatbeltProfile(cwd) {
    const writePaths = this.#resolvePaths(this.config.filesystem.allowWrite, cwd, { includeDefaultCwd: true });
    const denyReadPaths = this.#resolvePaths(this.config.filesystem.denyRead, cwd);
    const denyWritePaths = this.#resolvePaths(this.config.filesystem.denyWrite, cwd);
    const pathRules = [];

    for (const path of denyReadPaths) {
      pathRules.push(`(deny file-read* (subpath "${escapeSeatbeltPath(path)}"))`);
    }
    for (const path of denyWritePaths) {
      pathRules.push(`(deny file-write* (subpath "${escapeSeatbeltPath(path)}"))`);
    }
    for (const path of writePaths) {
      pathRules.push(`(allow file-write* (subpath "${escapeSeatbeltPath(path)}"))`);
    }

    return [
      '(version 1)',
      '(allow default)',
      ...(this.config.network.enabled ? ['(allow network*)'] : ['(deny network*)']),
      ...pathRules,
    ].join('\n');
  }

  #checkPolicy(command, cwd) {
    if (!this.config.network.enabled && NETWORK_COMMAND_PATTERN.test(command)) {
      return 'Network-like command blocked by shell sandbox policy. Enable AGENT_SANDBOX_NETWORK=true or add an explicit excluded command.';
    }

    const deniedReads = this.#resolvePaths(this.config.filesystem.denyRead, cwd);
    const deniedWrites = this.#resolvePaths(this.config.filesystem.denyWrite, cwd);
    const allowedWrites = this.#resolvePaths(this.config.filesystem.allowWrite, cwd, { includeDefaultCwd: true });

    for (const deniedPath of [...deniedReads, ...deniedWrites]) {
      if (commandIncludesPath(command, deniedPath)) {
        return `Command references sandbox-denied path: ${deniedPath}`;
      }
    }

    if (WRITE_COMMAND_PATTERN.test(command)) {
      const absolutePaths = extractAbsolutePaths(command);
      const outsideAllowedWrite = absolutePaths.find(path =>
        !allowedWrites.some(allowedPath => isPathInside(path, allowedPath))
      );
      if (outsideAllowedWrite) {
        return `Write-like command targets path outside sandbox write allowlist: ${outsideAllowedWrite}`;
      }
    }

    return null;
  }

  #isExcluded(command) {
    return this.config.excludedCommands.some(pattern => matchCommandPattern(command, pattern));
  }

  #resolvePaths(paths, cwd, options = {}) {
    const values = paths.length > 0 ? paths : [];
    const resolved = values.map(path => resolveSandboxPath(path, cwd)).filter(Boolean);
    if (options.includeDefaultCwd && !resolved.some(path => path === cwd)) {
      resolved.unshift(cwd);
    }
    return Array.from(new Set(resolved));
  }

  #blocked(message) {
    return {
      blocked: true,
      message: `BLOCKED: ${message}`,
    };
  }
}

function splitList(value) {
  if (!value) {
    return undefined;
  }
  return String(value)
    .split(delimiter)
    .map(item => item.trim())
    .filter(Boolean);
}

function listOption(source, key, fallback) {
  if (
    !source ||
    !Object.prototype.hasOwnProperty.call(source, key) ||
    source[key] === null ||
    source[key] === undefined
  ) {
    return [...fallback];
  }
  return Array.isArray(source[key]) ? source[key] : [source[key]];
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(command)}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function resolveSandboxPath(path, cwd) {
  if (!path) {
    return null;
  }
  const value = String(path);
  if (value === '.') {
    return cwd;
  }
  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith('/')) {
    return resolve(value);
  }
  return resolve(cwd, value);
}

function extractAbsolutePaths(command) {
  const matches = String(command).match(/(?:^|[\s"'=])((?:\/|~\/)[^\s"';&|<>`$)]+)/g) || [];
  return matches
    .map(match => match.trim().replace(/^["'=]*/, ''))
    .map(path => path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(path))
    .filter(path => path !== resolve('/dev/null') && path !== tmpdir());
}

function commandIncludesPath(command, path) {
  const expanded = path.replace(homedir(), '~');
  return String(command).includes(path) || String(command).includes(expanded);
}

function isPathInside(path, parent) {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parent);
  return resolvedPath === resolvedParent || resolvedPath.startsWith(resolvedParent + sep);
}

function matchCommandPattern(command, pattern) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(command);
}

function escapeSeatbeltPath(path) {
  return String(path).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
