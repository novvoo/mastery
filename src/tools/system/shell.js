/**
 * Shell Command Tool
 */

import { spawn } from 'child_process';
import { ToolCategory } from '../../core/types/index.js';
import { classifyLongRunningCommand } from '../../core/runtime/long-running-command.js';
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

function looksLikeNaturalLanguage(command) {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;

  const hasCapitalStart = /^[A-Z\u4e00-\u9fa5]/.test(trimmed);
  const hasPeriodEnd = trimmed.endsWith('.');
  const hasQuestionMark = trimmed.includes('?');
  const hasSentencePattern =
    /^(?:To|The|This|That|We|I|You|They|It|He|She|Let|Can|Should|Would|Could|May|Must|Need|Want)\s/.test(
      trimmed,
    );
  const hasChinesePattern =
    /(?:处理|解决|搞定|弄好|修一下|改好|检查|看看|分析|研究|实现|添加|删除|修改|优化|创建|编写)\b/.test(
      trimmed,
    );
  const hasNoExecutablePattern = !/^\s*(?:\w[\w.-]*|["'][^"']+["']|\`[^`]+\`)\s*(?:\||&&|;|\n|\$|\(|\{)/.test(
    trimmed,
  );

  return (
    (hasCapitalStart && (hasPeriodEnd || hasQuestionMark)) ||
    hasSentencePattern ||
    hasChinesePattern ||
    (hasCapitalStart && hasNoExecutablePattern && trimmed.length > 20)
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

// 剥除 ANSI 转义码，避免模型读到 \x1B[31m 等噪音
function stripAnsi(text) {
  return text.replace(/\x1B\[[\d;]*[A-Za-z]/g, '').replace(/\x1B\][0-9;]*\x1B\\/g, '');
}

// 测试输出精简：检测常见测试框架，只保留失败详情 + 摘要
function summarizeTestOutput(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split('\n');

  // 检测是否为测试框架输出
  const isTestOutput = lines.some((l) =>
    /FAIL|Tests|Test Files|Test Suites|test result|RUNS|❯|failed|Error|not defined/.test(l),
  );
  if (!isTestOutput) return null;

  // 保留失败测试行 + 错误上下文 + 摘要
  const kept = [];
  let summaryLines = [];
  let failuresCount = 0;
  const MAX_FAILURES = 15;
  const MAX_CONTEXT_LINES = 20;

  // 错误行特征：包含错误类型名或堆栈帧
  const isErrorLine = (l) =>
    /\b(Error|Exception|ReferenceError|TypeError|SyntaxError|RangeError|AssertionError|expected|received|not defined|is not a function|is not defined)\b/i.test(
      l,
    ) || /^\s+at\s/.test(l) || /^\s+✗|^\s+●|^\s+→/.test(l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 摘要行 — 始终保留
    if (
      /^\s*(Test Files|Tests|Test Suites|Test Files:|Snapshots|Time:|Duration|test result)/.test(
        line,
      )
    ) {
      summaryLines.push(line.trim());
      continue;
    }

    // 失败测试标题 — 保留
    // 检测条件：行包含 ❯/FAILED 失败标记，且要么行自身含失败关键词，要么后续行有错误详情
    const looksLikeFailureHeader =
      (/❯|✗|✕|●|×|FAIL/.test(line) &&
        (/failed|Error|not defined|is not/.test(line) ||
          lines.slice(i + 1, i + 6).some((l) => isErrorLine(l)))) ||
      /FAIL(ED)?\s/.test(line);

    if (looksLikeFailureHeader) {
      if (failuresCount < MAX_FAILURES) {
        kept.push(line.trimEnd());
        // 保留后续错误上下文：最多 MAX_CONTEXT_LINES 行，直到遇到下一个失败标题或摘要行
        let foundRealError = false;
        for (let j = i + 1; j < Math.min(i + MAX_CONTEXT_LINES, lines.length); j++) {
          const ctx = lines[j].trimEnd();
          const isNextHeader =
            /❯|✗|✕|●|×|FAIL/.test(ctx) ||
            /^\s*(Test Files|Tests|Test Suites|Snapshots|Time:|Duration)/.test(ctx);
          if (isNextHeader) break;
          if (isErrorLine(ctx)) foundRealError = true;
          // 空行也保留（除非是开头连续空行），但不因为空行而停止
          if (ctx.trim() === '' && kept[kept.length - 1]?.trim() === '') continue;
          kept.push(ctx);
        }
        // 如果没找到真实错误，再往下多找一些（最多 30 行），专门找错误
        if (!foundRealError) {
          for (
            let j = i + MAX_CONTEXT_LINES;
            j < Math.min(i + 40, lines.length);
            j++
          ) {
            const ctx = lines[j].trimEnd();
            const isNextHeader =
              /❯|✗|✕|●|×|FAIL/.test(ctx) ||
              /^\s*(Test Files|Tests|Test Suites|Snapshots|Time:|Duration)/.test(ctx);
            if (isNextHeader) break;
            if (isErrorLine(ctx)) {
              kept.push(ctx);
              foundRealError = true;
              // 找到错误后，再保留几行堆栈
              for (
                let k = j + 1;
                k < Math.min(j + 8, lines.length);
                k++
              ) {
                const stackLine = lines[k].trimEnd();
                if (/^\s+at\s/.test(stackLine) || isErrorLine(stackLine)) {
                  kept.push(stackLine);
                } else if (stackLine.trim() === '') {
                  continue;
                } else {
                  break;
                }
              }
              break;
            }
          }
        }
        kept.push('---');
        failuresCount++;
      }
      continue;
    }

    // 保留 stderr 中的编译/构建错误
    if (!stdout && line.includes('Error:')) {
      kept.push(line.trimEnd());
    }
  }

  if (kept.length === 0 && summaryLines.length === 0) return null;
  if (summaryLines.length > 0) kept.push('', '── 摘要 ──', ...summaryLines);
  return kept.join('\n');
}

export { stripAnsi, summarizeTestOutput };

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

      if (looksLikeNaturalLanguage(cmd)) {
        if (ctx.debug && ctx.ui?.debugEvent) {
          ctx.ui.debugEvent('Shell command rejected', {
            command: cmd,
            reason: 'looks like natural language, not a shell command',
          });
        }
        return [
          'Error: This looks like natural language, not a shell command.',
          '',
          'Please provide a valid shell command. For example:',
          '- `ls -la` to list files',
          '- `npm test` to run tests',
          '- `cat package.json` to read a file',
          '',
          'If you need to understand the project structure first, use:',
          '- `list_dir({\"path\": \".\"})`',
          '- `read_file({\"filePath\": \"package.json\"})`',
          '- `project_profile()`',
        ].join('\n');
      }

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
          const stderr = stripAnsi(result.stderr.trim());
          const stdout = stripAnsi(result.stdout.trim());
          let msg = `Command failed with exit code ${result.exitCode}`;
          if (result.wasInteractive) {
            msg +=
              '\nNote: This command appeared to be waiting for input. If it requires interactive prompts, consider running it with pty_start.';
          }
          // 测试输出精简：失败时优先展示失败摘要
          const summary = stdout ? summarizeTestOutput(stdout, stderr) : null;
          if (summary) {
            msg += `\n${summary}`;
          } else {
            if (stdout) msg += `\nstdout: ${stdout}`;
            if (stderr) msg += `\nstderr: ${stderr}`;
          }
          return msg;
        }

        const rawOutput = stripAnsi(result.stdout.trim());
        // 测试输出精简：成功时也精简（可能部分失败或全部通过）
        const summary = rawOutput ? summarizeTestOutput(rawOutput, '') : null;
        if (summary) return `Command completed.\n${summary}`;
        if (!rawOutput) {
          return result.wasInteractive
            ? '(command produced no output; it may have been waiting for input)'
            : '(command produced no output)';
        }
        if (rawOutput.length > 5000) {
          return (
            rawOutput.substring(0, 5000) + '\n... (truncated, ' + rawOutput.length + ' chars total)'
          );
        }
        return rawOutput;
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
