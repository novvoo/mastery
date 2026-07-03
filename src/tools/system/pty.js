/**
 * PTY tools for interactive and long-running terminal sessions.
 */

import os from 'os';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { ToolCategory } from '../../core/types/index.js';

const MAX_BUFFER_CHARS = 200000;
const DEFAULT_SETTLE_MS = 300;

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+~/,
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\//,
  /chmod\s+777\s+\//,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  /:()\s*{.*};:/,
];

const sessions = new Map();

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function getShell() {
  if (os.platform() === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

function getShellArgs(command) {
  if (os.platform() === 'win32') {
    return ['/d', '/s', '/c', command];
  }
  return ['-lc', command];
}

function appendOutput(session, data) {
  session.output += data;
  if (session.output.length > MAX_BUFFER_CHARS) {
    session.output = session.output.slice(-MAX_BUFFER_CHARS);
  }
}

function createSessionId() {
  return `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function previewOutput(session, maxChars = 6000, since = 0) {
  const output = session.output.slice(since);
  if (output.length <= maxChars) {
    return output;
  }
  return output.slice(-maxChars);
}

function serializeSession(session, maxChars, since) {
  return JSON.stringify(
    {
      session_id: session.id,
      mode: session.mode,
      status: session.exitCode === null ? 'running' : 'exited',
      exit_code: session.exitCode,
      signal: session.signal,
      output: previewOutput(session, maxChars, since),
      output_cursor: session.output.length,
    },
    null,
    2,
  );
}

function blockIfDangerous(command) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `BLOCKED: Command matches dangerous pattern. If you really need to run this, ask the user for confirmation.\nPattern: ${pattern.toString()}`;
    }
  }
  return null;
}

function requireSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`PTY session not found: ${sessionId}`);
  }
  return session;
}

function spawnHelperSession(command, workingDirectory, cols, rows) {
  const helperCommand = process.env.AGENT_PTY_HELPER;
  if (!helperCommand) {
    return null;
  }

  return spawn(helperCommand, [], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      AGENT_PTY_COMMAND: command,
      AGENT_PTY_CWD: workingDirectory,
      AGENT_PTY_COLS: String(cols || 120),
      AGENT_PTY_ROWS: String(rows || 30),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function spawnPipeSession(command, workingDirectory) {
  return spawn(getShell(), getShellArgs(command), {
    cwd: workingDirectory,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function startPtyCommand({ command, cwd, cols, rows, wait_ms, max_chars }, ctx = {}) {
  const blocked = blockIfDangerous(command);
  if (blocked) {
    return blocked;
  }

  const id = createSessionId();
  const workingDirectory = cwd ? resolve(ctx.workingDirectory, cwd) : ctx.workingDirectory;
  if (!existsSync(workingDirectory)) {
    mkdirSync(workingDirectory, { recursive: true });
  }

  const session = {
    id,
    command,
    cwd: workingDirectory,
    mode: 'pty',
    process: null,
    output: '',
    exitCode: null,
    signal: null,
    startedAt: Date.now(),
  };

  const helper = spawnHelperSession(command, workingDirectory, cols, rows);
  const child = helper || spawnPipeSession(command, workingDirectory);

  session.mode = helper ? 'pty_helper' : 'pipe_fallback';
  if (!helper) {
    appendOutput(session, '[PTY helper unavailable. Using interactive pipe fallback.]\n');
  }
  session.process = {
    write: (input) => child.stdin.write(input),
    kill: (signal) => child.kill(signal),
  };
  child.stdout.on('data', (data) => appendOutput(session, data.toString()));
  child.stderr.on('data', (data) => appendOutput(session, data.toString()));
  child.on('close', (exitCode, signal) => {
    session.exitCode = exitCode;
    session.signal = signal;
  });
  child.on('error', (childError) => {
    appendOutput(session, `[process error: ${childError.message}]\n`);
    session.exitCode = 1;
  });

  sessions.set(id, session);

  if (ctx.debug && ctx.ui?.debugEvent) {
    ctx.ui.debugEvent('PTY session started', {
      sessionId: id,
      command,
      cwd: workingDirectory,
      mode: session.mode,
    });
  }

  await delay(wait_ms || DEFAULT_SETTLE_MS);
  return serializeSession(session, max_chars || 6000, 0);
}

export function createPtyTools() {
  return [
    {
      name: 'pty_start',
      description:
        'Start a command in a persistent pseudo-terminal. Use this instead of shell for interactive commands, REPLs, prompts, watch/dev servers, TUIs, or long-running processes that need incremental output or stdin.',
      category: ToolCategory.SYSTEM,
      params: {
        command: { type: 'string', description: 'Command to start inside the PTY' },
        cwd: {
          type: 'string',
          description: 'Optional working directory relative to the agent working directory',
        },
        cols: { type: 'number', description: 'Terminal columns (default 120)' },
        rows: { type: 'number', description: 'Terminal rows (default 30)' },
        wait_ms: {
          type: 'number',
          description: 'Milliseconds to wait before returning initial output (default 300)',
        },
        max_chars: {
          type: 'number',
          description: 'Maximum output characters to return (default 6000)',
        },
      },
      required: ['command'],
      handler: async ({ command, cwd, cols, rows, wait_ms, max_chars }, ctx) => {
        return startPtyCommand({ command, cwd, cols, rows, wait_ms, max_chars }, ctx);
      },
    },
    {
      name: 'pty_write',
      description:
        'Write input to an existing PTY session. Use for answering prompts, sending REPL commands, pressing Enter, or interrupting with control characters such as \\u0003.',
      category: ToolCategory.SYSTEM,
      params: {
        session_id: { type: 'string', description: 'PTY session id returned by pty_start' },
        input: { type: 'string', description: 'Text to write. Include \\n for Enter.' },
        wait_ms: {
          type: 'number',
          description: 'Milliseconds to wait after writing before returning output (default 300)',
        },
        max_chars: {
          type: 'number',
          description: 'Maximum output characters to return (default 6000)',
        },
      },
      required: ['session_id', 'input'],
      handler: async ({ session_id, input, wait_ms, max_chars }) => {
        const session = requireSession(session_id);
        const cursor = session.output.length;
        session.process.write(input);
        await delay(wait_ms || DEFAULT_SETTLE_MS);
        return serializeSession(session, max_chars || 6000, cursor);
      },
    },
    {
      name: 'pty_read',
      description:
        'Read buffered output from an existing PTY session without writing input. Use to check progress of dev servers, watch commands, tests, or interactive programs.',
      category: ToolCategory.SYSTEM,
      params: {
        session_id: { type: 'string', description: 'PTY session id returned by pty_start' },
        cursor: {
          type: 'number',
          description:
            'Optional output_cursor from a previous PTY response to read only new output',
        },
        wait_ms: { type: 'number', description: 'Milliseconds to wait before reading (default 0)' },
        max_chars: {
          type: 'number',
          description: 'Maximum output characters to return (default 6000)',
        },
      },
      required: ['session_id'],
      handler: async ({ session_id, cursor, wait_ms, max_chars }) => {
        const session = requireSession(session_id);
        if (wait_ms) {
          await delay(wait_ms);
        }
        return serializeSession(session, max_chars || 6000, cursor || 0);
      },
    },
    {
      name: 'pty_stop',
      description:
        'Stop an existing PTY session. Use when a long-running command or dev server is no longer needed.',
      category: ToolCategory.SYSTEM,
      params: {
        session_id: { type: 'string', description: 'PTY session id returned by pty_start' },
        signal: {
          type: 'string',
          description: 'Signal to send on POSIX systems (default SIGTERM)',
        },
      },
      required: ['session_id'],
      handler: async ({ session_id, signal }, ctx) => {
        const session = requireSession(session_id);
        session.process.kill(signal || 'SIGTERM');
        await delay(100);
        sessions.delete(session_id);

        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('PTY session stopped', {
            sessionId: session_id,
            command: session.command,
          });
        }

        return `PTY session stopped: ${session_id}`;
      },
    },
  ];
}

export function stopAllPtySessions() {
  for (const [id, session] of sessions) {
    try {
      session.process.kill('SIGTERM');
    } catch {
      // Session may already have exited.
    }
    sessions.delete(id);
  }
}
