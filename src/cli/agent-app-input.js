#!/usr/bin/env bun
/**
 * Agent App - Input Loop & Readline Management
 * Extracted from agent-app.js
 */

import { clearLine, createInterface, cursorTo, emitKeypressEvents } from 'readline';
import { enhancedUI } from './enhanced-ui.js';
import {
  buildSlashCommandSuggestions,
  completeSlashCommand,
  filterSlashCommandSuggestions,
  formatSlashCommandSuggestions,
} from './slash-command-suggestions.js';

/**
 * Create a readline interface with slash-command tab completion
 */
export function createReadlineInterface(slashCommandSuggestions) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => completeSlashCommand(slashCommandSuggestions, line),
  });
  return rl;
}

/**
 * Set up the SIGINT (Ctrl+C) handler
 * Returns the handler function so it can be removed later
 */
export function setupSigintHandler(agent) {
  let sigintCount = 0;
  let sigintTimer = null;

  const handler = () => {
    if (agent.isProcessingInput) {
      sigintCount++;
      if (sigintCount === 1) {
        enhancedUI.warning('\n⚠️  正在请求中断 Agent...（再按一次 Ctrl+C 强制退出）');
        agent.engine.stop().catch(() => {});
        sigintTimer = setTimeout(() => {
          sigintCount = 0;
        }, 3000);
      } else if (sigintCount >= 2) {
        enhancedUI.error('\n强制退出');
        process.exit(130);
      }
    } else {
      agent.shutdown().then(() => process.exit(0));
    }
  };

  process.on('SIGINT', handler);
  return {
    handler,
    clearTimer: () => {
      if (sigintTimer) {
        clearTimeout(sigintTimer);
      }
    },
  };
}

/**
 * Remove a previously installed SIGINT handler
 */
export function removeSigintHandler(handler) {
  process.removeListener('SIGINT', handler);
}

/**
 * Install slash command suggestion keypress listeners
 */
export function installSlashCommandSuggestions(agent) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.SLASH_SUGGESTIONS === 'false') {
    return;
  }
  if (agent.slashSuggestionsInstalled) {
    return;
  }

  emitKeypressEvents(process.stdin, agent.rl);
  agent.slashSuggestionsInstalled = true;
  armSlashCommandSuggestions();
  process.stdin.on('keypress', (_str, key = {}) => {
    if (
      agent.rlClosed ||
      agent.isProcessingInput ||
      key.name === 'return' ||
      key.name === 'enter'
    ) {
      return;
    }

    setImmediate(() => renderSlashCommandSuggestions(agent));
  });
}

/**
 * Enable raw mode for slash command suggestions
 */
export function armSlashCommandSuggestions() {
  if (
    !process.stdin.isTTY ||
    !process.stdin.setRawMode ||
    process.env.SLASH_SUGGESTIONS === 'false'
  ) {
    return;
  }

  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch (error) {
    enhancedUI.debugEvent('Slash command suggestions could not enable raw input mode', {
      error: error.message,
    });
  }
}

/**
 * Disable raw mode for slash command suggestions
 */
export function disarmSlashCommandSuggestions() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    return;
  }

  try {
    process.stdin.setRawMode(false);
  } catch (error) {
    enhancedUI.debugEvent('Slash command suggestions could not restore cooked input mode', {
      error: error.message,
    });
  }
}

/**
 * Render slash command suggestions below the current prompt line
 */
export function renderSlashCommandSuggestions(agent) {
  if (!agent.rl || agent.rlClosed || agent.isProcessingInput) {
    return;
  }

  const line = agent.rl.line || '';
  const suggestions = filterSlashCommandSuggestions(agent.slashCommandSuggestions, line, 6);
  const suggestionKey = `${line}::${suggestions.map((command) => command.name).join('|')}`;

  if (!suggestions.length) {
    agent.lastSlashSuggestionKey = '';
    return;
  }

  if (suggestionKey === agent.lastSlashSuggestionKey) {
    return;
  }

  agent.lastSlashSuggestionKey = suggestionKey;
  process.stdout.write('\n');
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0);
  process.stdout.write(`${formatSlashCommandSuggestions(suggestions, enhancedUI.theme)}\n`);
  agent.rl.prompt(true);
}

/**
 * Get user input from the readline interface
 */
export async function getInput(agent) {
  if (!agent.rl || agent.rlClosed || !agent.isRunning) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      agent.rl.question(enhancedUI.prompt(), (input) => {
        resolve(input.trim());
      });
    } catch (error) {
      if (error?.code === 'ERR_USE_AFTER_CLOSE') {
        agent.rlClosed = true;
        agent.isRunning = false;
        resolve(null);
        return;
      }
      throw error;
    }
  });
}

/**
 * Drain the input queue, processing each input sequentially
 */
export async function drainInputQueue(agent) {
  if (agent.isProcessingInput || !agent.isRunning || agent.rlClosed) {
    return;
  }

  agent.isProcessingInput = true;

  try {
    while (agent.inputQueue.length > 0 && agent.isRunning && !agent.rlClosed) {
      const rawInput = agent.inputQueue.shift();
      const input = rawInput.trim();
      agent.lastSlashSuggestionKey = '';

      enhancedUI.debugEvent('CLI line received', {
        rawChars: rawInput.length,
        trimmedChars: input.length,
        preview: input.length > 240 ? input.substring(0, 240) + '... (truncated)' : input,
        queuedInputs: agent.inputQueue.length,
      });

      agent.rl.pause();
      const shouldContinue = await agent.processCommand(input);

      if (!shouldContinue) {
        await agent.shutdown();
        return;
      }

      if (agent.isRunning && !agent.rlClosed) {
        agent.rl.resume();
        agent.lastSlashSuggestionKey = '';
        armSlashCommandSuggestions();
        agent.rl.prompt();
      }
    }
  } catch (error) {
    enhancedUI.error(`Input loop error: ${error.message}`);
    console.error(error);
  } finally {
    agent.isProcessingInput = false;

    if (agent.inputQueue.length > 0 && agent.isRunning && !agent.rlClosed) {
      drainInputQueue(agent);
    } else if (agent.isRunning && !agent.rlClosed) {
      armSlashCommandSuggestions();
    }
  }
}

/**
 * Rebuild slash command suggestions (e.g. after MCP tools are registered)
 */
export function rebuildSlashCommandSuggestions(engine) {
  try {
    return buildSlashCommandSuggestions(engine.getTools() || []);
  } catch (err) {
    enhancedUI.debugEvent('Failed to rebuild slash command suggestions', { error: String(err) });
    return [];
  }
}
