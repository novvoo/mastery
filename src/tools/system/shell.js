/**
 * Shell Command Tool
 */

import { spawn } from 'child_process';
import { ToolCategory } from '../../core/types.js';
import { classifyLongRunningCommand } from '../../core/long-running-command.js';
import { createShellSandbox, shellSandboxConfigFromEnv } from '../../sandbox/shell-sandbox.js';
import { startPtyCommand } from './pty.js';
import { DANGEROUS_SHELL_PATTERNS } from '../../utils/patterns.js';

const MAX_COMMAND_LENGTH = 8192;
const HARD_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_MS = 30000;
const INTERACTIVE_TIMEOUT_MS = 60000;
const NO_OUTPUT_TIMEOUT_MS = 30000;

function normalizeTimeout(timeout) {
  if (timeout === undefined || timeout === null || timeout === '') {
    return { timeoutMs: DEFAULT_TIMEOUT_MS, normalizedFromSeconds: false, originalTimeout: null };
  }
  const numeric = Number(timeout);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      normalizedFromSeconds: false,
      originalTimeout: timeout,
    };
  }
  if (numeric < 1000) {
    return {
      timeoutMs: Math.min(Math.round(numeric * 1000), HARD_TIMEOUT_MS),
      normalizedFromSeconds: true,
      originalTimeout: numeric,
    };
  }
  return {
    timeoutMs: Math.min(Math.round(numeric), HARD_TIMEOUT_MS),
    normalizedFromSeconds: false,
    originalTimeout: numeric,
  };
}

function isInteractiveCommand(command) {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test)\b|\b(npx\s+)?(jest|vitest|mocha)\b|\b(inquirer|ora|chalk|prompt)\b/i.test(
    command,
  );
}

function addNonInteractiveFlags(command) {
  const normalized = command.toLowerCase();

  if (
    normalized.includes('jest') &&
    !normalized.includes('--watchall') &&
    !normalized.includes('--watch')
  ) {
    return command + ' --watchAll=false';
  }

  if (
    normalized.includes('vitest') &&
    !normalized.includes('--run') &&
    !normalized.includes('--watch=false')
  ) {
    return command + ' --run';
  }

  if (normalized.includes('mocha') && !normalized.includes('--watch')) {
    return command;
  }

  if (/npm\s+test/i.test(normalized)) {
    return command;
  }

  return command;
}

function isFiniteVerificationCommand(command) {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|check|typecheck)\b|\b(npx\s+)?(jest|vitest|eslint|tsc|playwright|cypress)\b|\b(pytest|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test)\b/i.test(
    command,
  );
}

function buildTimeoutRecoveryMessage(command, timeoutInfo, longRunning) {
  const commandLabel = command.length > 160 ? command.slice(0, 157) + '...' : command;
  const finiteVerification = isFiniteVerificationCommand(command);
  const retryTimeout = Math.min(Math.max(timeoutInfo.timeoutMs * 2, 60000), HARD_TIMEOUT_MS);
  const lines = [
    'STEP_ABNORMAL: shell_timeout',
    `Command: ${commandLabel}`,
    `Timeout: ${timeoutInfo.timeoutMs}ms`,
  ];

  if (timeoutInfo.normalizedFromSeconds) {
    lines.push(
      `Note: received timeout=${timeoutInfo.originalTimeout}; interpreted it as seconds (${timeoutInfo.timeoutMs}ms) because values below 1000 are usually accidental second-based inputs.`,
    );
  }

  if (finiteVerification && !longRunning?.isLongRunning) {
    lines.push('Likely cause: finite verification command exceeded the allotted time.');
    lines.push('Recovery plan:');
    lines.push(`1. Retry once with shell using timeout ${retryTimeout}ms.`);
    lines.push(
      '2. If it times out again, inspect the package scripts/config and run a narrower test/build command.',
    );
    lines.push('3. Do not mark verification complete until a finite command exits successfully.');
    return lines.join('\n');
  }

  lines.push(
    longRunning?.isLongRunning
      ? `Likely cause: command behaves like a long-running process (${longRunning.reason || 'classifier match'}).`
      : 'Likely cause: command exceeded the allotted time or is waiting for input.',
  );
  lines.push('Recovery plan:');
  lines.push(
    '1. If it is a dev server, watcher, REPL, TUI, game loop, or interactive prompt, run it with pty_start.',
  );
  lines.push(
    '2. Inspect progress with pty_read, provide input with pty_write if needed, and stop it with pty_stop.',
  );
  lines.push(
    `3. If it should be finite, retry shell with a larger timeout such as ${retryTimeout}ms or narrow the command.`,
  );
  return lines.join('\n');
}

function executeAsync(command, options = {}) {
  return new Promise((resolve, reject) => {
    const isInteractive = isInteractiveCommand(command);
    const finalCommand = isInteractive ? addNonInteractiveFlags(command) : command;
    const effectiveTimeout =
      options.timeout || (isInteractive ? INTERACTIVE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

    const child = spawn(options.executable || finalCommand, options.args || [], {
      cwd: options.cwd,
      shell: options.shell !== false,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: effectiveTimeout,
      env: {
        ...process.env,
        CI: 'true',
        CI_ENVIRONMENT: 'true',
        ...(options.env || {}),
      },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let lastOutputTime = Date.now();
    let wasInteractive = false;

    const resetOutputTimer = () => {
      lastOutputTime = Date.now();
    };

    child.stdout.on('data', (data) => {
      resetOutputTimer();
      stdout += data.toString();
      if (stdout.length > 5 * 1024 * 1024) {
        child.kill();
      }
    });

    child.stderr.on('data', (data) => {
      resetOutputTimer();
      stderr += data.toString();
    });

    const noOutputTimer = setInterval(() => {
      const elapsed = Date.now() - lastOutputTime;
      if (elapsed > NO_OUTPUT_TIMEOUT_MS) {
        if (isInteractive && !wasInteractive) {
          wasInteractive = true;
          child.stdin.write('\n');
          resetOutputTimer();
        } else if (elapsed > effectiveTimeout) {
          killed = true;
          child.kill('SIGTERM');
          clearInterval(noOutputTimer);
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      }
    }, 1000);

    child.on('close', (exitCode, signal) => {
      clearInterval(noOutputTimer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        killed: killed || signal === 'SIGTERM' || signal === 'SIGKILL',
        wasInteractive,
        originalCommand: command,
        finalCommand,
      });
    });

    child.on('error', (error) => {
      clearInterval(noOutputTimer);
      reject(error);
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      clearInterval(noOutputTimer);
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, effectiveTimeout);

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
      const timeoutInfo = normalizeTimeout(timeout);
      const ms = timeoutInfo.timeoutMs;
      const startedAt = Date.now();

      if (ctx.debug && ctx.ui?.debugEvent) {
        ctx.ui.debugEvent('Shell command prepared', {
          command: cmd,
          cwd: ctx.workingDirectory,
          timeoutMs: ms,
          originalTimeout: timeoutInfo.originalTimeout,
          normalizedFromSeconds: timeoutInfo.normalizedFromSeconds,
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
        if (longRunning.compoundWithLongRunning) {
          return [
            `BLOCKED: This shell command mixes a long-running command with other commands.`,
            `Detected long-running segment: ${longRunning.longRunningSegment || cmd}`,
            'Run setup, tests, and build commands separately with shell. Start the long-running dev server by itself with pty_start or a single shell command so it can be observed and stopped explicitly.',
          ].join('\n');
        }

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
            wasInteractive: result.wasInteractive,
            stdoutPreview: result.stdout.trim().substring(0, 500),
            stderrPreview: result.stderr.trim().substring(0, 500),
          });
        }

        if (result.wasInteractive) {
          ctx.ui?.debugEvent?.('Shell command was interactive', {
            command: cmd,
            finalCommand: result.finalCommand,
          });
        }

        if (result.killed) {
          return buildTimeoutRecoveryMessage(cmd, timeoutInfo, longRunning);
        }

        if (result.exitCode !== 0) {
          const stderr = result.stderr.trim();
          const stdout = result.stdout.trim();
          let msg = `Command failed with exit code ${result.exitCode}`;
          if (result.wasInteractive) {
            msg +=
              '\nNote: This command appeared to be waiting for input. If it requires interactive prompts, consider running it with pty_start.';
          }
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
          return result.wasInteractive
            ? '(command produced no output; it may have been waiting for input)'
            : '(command produced no output)';
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
