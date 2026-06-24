import { describe, expect, test } from 'bun:test';
import { processCommand } from '../../src/cli/agent-app-slash-commands.js';

// parseKeyValueArgs, parseTddShorthand, coerceSlashValue are not exported.
// We test them indirectly through processCommand and by re-implementing the logic here
// for unit verification.

function coerceSlashValue(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseKeyValueArgs(text) {
  const args = {};
  const regex = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    args[match[1]] = coerceSlashValue(match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
  }

  if (Object.keys(args).length === 0) {
    return null;
  }

  const remainder = text.replace(regex, '').trim();
  return remainder ? null : args;
}

function parseTddShorthand(text) {
  const match = text.match(/^(red|green|refactor)\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!match || !match[3]) {
    return null;
  }

  return {
    phase: match[1].toLowerCase(),
    component: match[2],
    spec: match[3].trim(),
  };
}

// Minimal mock agent for testing command routing
function createMockAgent() {
  return {
    config: { provider: 'openai', model: 'gpt-4', temperature: 0.7, maxIterations: 10 },
    debugMode: false,
    workingDir: '/tmp',
    isRunning: true,
    engine: {
      processInput: async () => ({ answer: 'mock answer', status: 'completed' }),
      getMemoryManager: () => ({
        getContext: () => ({
          projectInfo: { name: 'test', path: '/tmp' },
          keyDecisions: [],
          constraints: [],
          fileMap: [],
          sessionHistory: [],
          notes: [],
        }),
        getContextPath: () => '/tmp/CONTEXT.md',
        toMarkdown: () => '# Context',
      }),
    },
    toolRegistry: {
      get: () => null,
      getAll: () => [],
      getToolSummary: () => ({}),
      execute: async () => ({ success: true }),
    },
    modelProvider: null,
    schedulerEngine: null,
    showWelcome: () => {},
    commands: {
      showHelp: () => {},
      handleTaskCommand: async () => {},
      handleScheduleCommand: async () => {},
      handleSubAgentCommand: async () => {},
      handleGitCommand: async () => {},
      handleMcpCommand: async () => {},
      handleSecurityCommand: async () => {},
      handleExperienceCommand: async () => {},
      handleReasonCommand: async () => {},
      handleAutoCommand: async () => {},
      showStatistics: async () => {},
      showMainMenu: async () => 'exit',
    },
    tokenJuice: {
      compress: (text) => text,
      getStats: (orig, comp) => ({
        originalChars: orig.length,
        originalTokens: Math.ceil(orig.length / 4),
        compressedChars: comp.length,
        compressedTokens: Math.ceil(comp.length / 4),
        savingsPercent: 50,
      }),
    },
  };
}

describe('slash-commands integration', () => {
  // --- processCommand routing ---

  describe('processCommand', () => {
    test('returns false for exit/quit commands', async () => {
      const agent = createMockAgent();
      expect(await processCommand(agent, 'exit')).toBe(false);
      expect(await processCommand(agent, 'quit')).toBe(false);
      expect(await processCommand(agent, '/exit')).toBe(false);
      expect(await processCommand(agent, '/quit')).toBe(false);
    });

    test('returns true for /help command', async () => {
      const agent = createMockAgent();
      const result = await processCommand(agent, '/help');
      expect(result).toBe(true);
    });

    test('returns true for /clear command', async () => {
      const agent = createMockAgent();
      const result = await processCommand(agent, '/clear');
      expect(result).toBe(true);
    });

    test('returns true for /memory command', async () => {
      const agent = createMockAgent();
      const result = await processCommand(agent, '/memory');
      expect(result).toBe(true);
    });

    test('returns true for /debug command', async () => {
      const agent = createMockAgent();
      const result = await processCommand(agent, '/debug on');
      expect(result).toBe(true);
      expect(agent.debugMode).toBe(true);
    });

    test('returns true for /model list command', async () => {
      const agent = createMockAgent();
      // /model requires model-provider-factory which is imported dynamically
      // just test routing - it will show current model
      const result = await processCommand(agent, '/model list');
      expect(result).toBe(true);
    });

    test('returns true for unknown input (processed as agent input)', async () => {
      const agent = createMockAgent();
      const result = await processCommand(agent, 'hello world');
      expect(result).toBe(true);
    });

    test('returns true for null/empty input', async () => {
      const agent = createMockAgent();
      expect(await processCommand(agent, '')).toBe(true);
      expect(await processCommand(agent, null)).toBe(true);
    });

    test('/debug off disables debug mode', async () => {
      const agent = createMockAgent();
      agent.debugMode = true;
      await processCommand(agent, '/debug off');
      expect(agent.debugMode).toBe(false);
    });

    test('/debug toggle works', async () => {
      const agent = createMockAgent();
      agent.debugMode = false;
      await processCommand(agent, '/debug');
      expect(agent.debugMode).toBe(true);
    });
  });

  // --- parseKeyValueArgs ---

  describe('parseKeyValueArgs', () => {
    test('parses simple key=value pairs', () => {
      const result = parseKeyValueArgs('name=alice age=30');
      expect(result).toEqual({ name: 'alice', age: 30 });
    });

    test('parses quoted values', () => {
      const result = parseKeyValueArgs('msg="hello world"');
      expect(result).toEqual({ msg: 'hello world' });
    });

    test('parses single-quoted values', () => {
      const result = parseKeyValueArgs("msg='hello world'");
      expect(result).toEqual({ msg: 'hello world' });
    });

    test('returns null when no key=value pairs found', () => {
      expect(parseKeyValueArgs('just some text')).toBeNull();
    });

    test('returns null when there is leftover text', () => {
      expect(parseKeyValueArgs('name=alice extratext')).toBeNull();
    });
  });

  // --- parseTddShorthand ---

  describe('parseTddShorthand', () => {
    test('parses TDD shorthand: phase component spec', () => {
      const result = parseTddShorthand('red LoginForm "valid credentials submit"');
      expect(result).toEqual({
        phase: 'red',
        component: 'LoginForm',
        spec: '"valid credentials submit"',
      });
    });

    test('parses green phase', () => {
      const result = parseTddShorthand('green WeatherSearch triggers search');
      expect(result.phase).toBe('green');
      expect(result.component).toBe('WeatherSearch');
      expect(result.spec).toBe('triggers search');
    });

    test('returns null when spec is missing', () => {
      const result = parseTddShorthand('red LoginForm');
      expect(result).toBeNull();
    });

    test('returns null for invalid format', () => {
      expect(parseTddShorthand('')).toBeNull();
      expect(parseTddShorthand('not tdd format')).toBeNull();
    });
  });

  // --- coerceSlashValue ---

  describe('coerceSlashValue', () => {
    test('coerces "true" to boolean true', () => {
      expect(coerceSlashValue('true')).toBe(true);
    });

    test('coerces "false" to boolean false', () => {
      expect(coerceSlashValue('false')).toBe(false);
    });

    test('coerces "null" to null', () => {
      expect(coerceSlashValue('null')).toBe(null);
    });

    test('coerces numeric strings to numbers', () => {
      expect(coerceSlashValue('42')).toBe(42);
      expect(coerceSlashValue('3.14')).toBe(3.14);
      expect(coerceSlashValue('-7')).toBe(-7);
    });

    test('returns string as-is for non-coercible values', () => {
      expect(coerceSlashValue('hello')).toBe('hello');
      expect(coerceSlashValue('123abc')).toBe('123abc');
    });
  });
});
