/**
 * Shell Command Tool
 */

import { spawn } from 'child_process';
import { ToolCategory } from '../../core/types.js';
import { classifyLongRunningCommand } from '../../core/long-running-command.js';
import { createShellSandbox, shellSandboxConfigFromEnv } from '../../sandbox/shell-sandbox.js';
import { startPtyCommand } from './pty.js';
import { DANGEROUS_SHELL_PATTERNS, isDangerousCommand } from '../../utils/patterns.js';

const MAX_COMMAND_LENGTH = 8192;
const HARD_TIMEOUT_MS = 120000;

function executeAsync(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable || command, options.args || [], {
      cwd: options.cwd,
      shell: options.shell !== false,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout || 30000,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > 5 * 1024 * 1024) {
        child.kill();
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode, killed });
    });

    child.on('error', (error) => {
      reject(error);
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, options.timeout || 30000);

    child.on('close', () => clearTimeout(timer));
  });
}

export function createShellTool(options = {}) {
  const sandbox = createShellSandbox(options.sandbox || shellSandboxConfigFromEnv());

  return {
    name: 'shell',
    description:
      'Execute a shell command in the working directory. Returns stdout and stderr. Supports optional sandboxed execution for filesystem/network isolation.',
    category: ToolCategory.SYSTEM,
    params: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
      foreground: {
        type: 'boolean',
        description:
          'Force foreground shell execution even if the command looks long-running (default false)',
      },
    },
    required: ['command'],
    handler: async ({ command, timeout, foreground }, ctx) => {
      if (typeof command !== 'string' || command.trim().length === 0) {
        return 'Error: command must be a non-empty string.';
      }
      if (command.length > MAX_COMMAND_LENGTH) {
        return `Error: command exceeds max length (${command.length} > ${MAX_COMMAND_LENGTH} chars).`;
      }

      const cmd = command;
      const ms = Math.min(timeout || 30000, HARD_TIMEOUT_MS);
      const startedAt = Date.now();

      if (ctx.debug && ctx.ui?.debugEvent) {
        ctx.ui.debugEvent('Shell command prepared', {
          command: cmd,
          cwd: ctx.workingDirectory,
          timeoutMs: ms,
          tool: ctx.toolName || 'shell',
          foregroundBypass: !!foreground,
        });
      }

      for (const pattern of DANGEROUS_SHELL_PATTERNS) {
        if (pattern.test(cmd)) {
          if (ctx.debug && ctx.ui?.debugEvent) {
            ctx.ui.debugEvent('Shell command blocked', {
              command: cmd,
              pattern: pattern.toString(),
            });
          }
          return `BLOCKED: Command matches dangerous pattern. If you really need to run this, ask the user for confirmation.\nPattern: ${pattern.toString()}`;
        }
      }

      const longRunning = await classifyLongRunningCommand(cmd, {
        cwd: ctx.workingDirectory,
        modelProvider: ctx.modelProvider,
      });
      if (longRunning.isLongRunning && !foreground) {
        const sessionJson = await startPtyCommand(
          {
            command: cmd,
            wait_ms: Math.min(ms, 1500),
            max_chars: 6000,
          },
          ctx,
        );
        return [
          `Long-running command detected: ${longRunning.reason}.`,
          'Started it as a PTY session instead of waiting for shell completion.',
          'Use pty_read with the returned output_cursor to observe progress, and call pty_stop when verification is done. Do not retry this command with shell just because it is still running.',
          sessionJson,
        ].join('\n');
      }

      if (foreground) {
        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('Shell: foreground bypass active', {
            command: cmd,
            reason: longRunning.reason || 'long-running detection bypass',
          });
        }
      }

      try {
        const sandboxPlan = sandbox.prepare(cmd, {
          cwd: ctx.workingDirectory,
        });

        if (sandboxPlan.blocked) {
          if (ctx.debug && ctx.ui?.debugEvent) {
            ctx.ui.debugEvent('Shell command blocked by sandbox', {
              command: cmd,
              cwd: ctx.workingDirectory,
              reason: sandboxPlan.message,
            });
          }
          return sandboxPlan.message;
        }

        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('Shell sandbox resolved', {
            enabled: sandbox.config.enabled,
            sandboxed: sandboxPlan.sandboxed,
            backend: sandboxPlan.backend || null,
            reason: sandboxPlan.reason || null,
            warning: sandboxPlan.warning || null,
          });
        }

        const result = await executeAsync(cmd, {
          cwd: ctx.workingDirectory,
          timeout: ms,
          executable: sandboxPlan.executable,
          args: sandboxPlan.args,
          shell: sandboxPlan.shell,
          env: sandboxPlan.env,
        });

        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('Shell command finished', {
            command: cmd,
            cwd: ctx.workingDirectory,
            durationMs: Date.now() - startedAt,
            exitCode: result.exitCode,
            killed: result.killed,
            stdoutPreview: result.stdout.trim().substring(0, 500),
            stderrPreview: result.stderr.trim().substring(0, 500),
          });
        }

        if (result.killed) {
          return [
            `Command timed out after ${ms}ms and was killed.`,
            'If this command was expected to keep running (pygame window, game loop, dev server, watcher, REPL, or TUI), do not retry it with shell.',
            'Run it with pty_start, inspect with pty_read, then stop it with pty_stop when finished.',
          ].join('\n');
        }

        if (result.exitCode !== 0) {
          const stderr = result.stderr.trim();
          const stdout = result.stdout.trim();
          let msg = `Command failed with exit code ${result.exitCode}`;
          if (stdout) {
            msg += `\nstdout: ${stdout}`;
          }
          if (stderr) {
            msg += `\nstderr: ${stderr}`;
          }
          return msg;
        }

        const output = result.stdout.trim();
        if (!output) {
          return '(command produced no output)';
        }
        if (output.length > 5000) {
          return output.substring(0, 5000) + '\n... (truncated, ' + output.length + ' chars total)';
        }
        return output;
      } catch (error) {
        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('Shell command errored', {
            command: cmd,
            cwd: ctx.workingDirectory,
            durationMs: Date.now() - startedAt,
            error: error.message,
          });
        }
        return `Command execution error: ${error.message}`;
      }
    },
  };
}