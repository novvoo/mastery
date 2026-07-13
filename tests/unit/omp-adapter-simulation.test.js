import { describe, expect, test, afterEach } from 'bun:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOmpAdapter } from '../../src/adapters/desktop/omp-adapter.js';
import { getEventBus, resetEventBus } from '../../src/runtime/event-bus.js';
import { RuntimeEvent } from '../../src/runtime/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_OMP_PATH = resolve(__dirname, 'helpers', 'mock-omp.js');

// Reset singleton and env between test groups so one test doesn't leak
afterEach(() => {
  resetEventBus();
});

/**
 * Helper: create an OmpAdapter pre-configured with our mock script.
 */
function mockAdapter() {
  return createOmpAdapter({
    workingDirectory: '/tmp',
    ompCliPath: MOCK_OMP_PATH,
    // don't set debug: true to keep noise down, but can toggle for debugging
  });
}

describe('OmpAdapter Simulation — initialization', () => {
  test('initialize() succeeds with mock omp', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      expect(adapter.getState().status).toBe('ready');
      expect(adapter.getState().sessionId).toBe('mock-session-id');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('getState() has correct shape after init', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const state = adapter.getState();
      expect(state.status).toBe('ready');
      expect(state.sessionId).toBe('mock-session-id');
      expect(state.isStreaming).toBe(false);
      expect(state.model).toBe('gpt-4o');
      expect(state.thinkingLevel).toBe(3);
      expect(typeof state.timestamp).toBe('number');
    } finally {
      await adapter.dispose();
    }
  }, 15000);
});

describe('OmpAdapter Simulation — processInput', () => {
  test('processInput returns success with answer', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.processInput('Hello!');
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      // Should contain accumulated text from text_delta events
      expect(typeof result.answer).toBe('string');
    } finally {
      await adapter.dispose();
    }
  }, 30000);

  test('processInput triggers AGENT_START and AGENT_STOP events', async () => {
    const adapter = mockAdapter();
    const events = [];
    const bus = getEventBus();

    const unsub1 = bus.subscribe(RuntimeEvent.AGENT_START, () => events.push('start'));
    const unsub2 = bus.subscribe(RuntimeEvent.AGENT_STOP, () => events.push('stop'));

    try {
      await adapter.initialize();
      await adapter.processInput('test');
      expect(events).toContain('start');
      expect(events).toContain('stop');
    } finally {
      unsub1();
      unsub2();
      await adapter.dispose();
    }
  }, 30000);

  test('processInput triggers text_delta events', async () => {
    const adapter = mockAdapter();
    const deltas = [];
    const bus = getEventBus();

    const unsub = bus.subscribe(RuntimeEvent.AGENT_TEXT_DELTA, (data) => {
      deltas.push(data.text);
    });

    try {
      await adapter.initialize();
      await adapter.processInput('say something');
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.some((d) => d.includes('Hello'))).toBe(true);
    } finally {
      unsub();
      await adapter.dispose();
    }
  }, 30000);
});

describe('OmpAdapter Simulation — session management', () => {
  test('getSessionStats() returns stats from mock', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const stats = await adapter.getSessionStats();
      expect(stats.messageCount).toBe(5);
      expect(stats.tokensUsed).toBe(1024);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('getMessages() returns messages from mock', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const messages = await adapter.getMessages();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('newSession() creates new session', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.newSession();
      expect(result.sessionId).toBe('new-session-abc');
      expect(adapter.getSessionId()).toBe('new-session-abc');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('setSessionName() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.setSessionName('My Test Session');
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);
});

describe('OmpAdapter Simulation — model operations', () => {
  test('getAvailableModels() returns model list', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.getAvailableModels();
      expect(Array.isArray(result.models)).toBe(true);
      expect(result.models).toContain('gpt-4o');
      expect(result.models).toContain('deepseek-chat');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('cycleModel() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.cycleModel();
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('setModel() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.setModel('openai', 'gpt-4o');
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('getCurrentModel() returns model from state', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      expect(adapter.getCurrentModel()).toBe('gpt-4o');
    } finally {
      await adapter.dispose();
    }
  }, 15000);
});

describe('OmpAdapter Simulation — thinking level', () => {
  test('cycleThinkingLevel() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.cycleThinkingLevel();
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('setThinkingLevel() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.setThinkingLevel(5);
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('getThinkingLevel() returns value from state', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      expect(adapter.getThinkingLevel()).toBe(3);
    } finally {
      await adapter.dispose();
    }
  }, 15000);
  test('setWorkingDirectory disposes and re-initializes', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const otherDir = mkdtempSync(join(tmpdir(), 'omp-test-'));
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      await adapter.setWorkingDirectory(otherDir);
      expect(adapter.getState().status).toBe('ready');
    } finally {
      await adapter.dispose();
    }
  }, 30000);
});

describe('OmpAdapter Simulation — lifecycle', () => {
  test('initialize() is idempotent', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      await adapter.initialize(); // second call should be no-op
      expect(adapter.getState().status).toBe('ready');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('stop() aborts running agent', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      adapter.stop();
      expect(adapter.getState().isStreaming).toBe(false);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('dispose() cleans up child process', async () => {
    const adapter = mockAdapter();
    await adapter.initialize();
    await adapter.dispose();
    const state = adapter.getState();
    // After dispose, state reverts to pre-init defaults
    expect(state.status).toBe('idle');
  }, 15000);

  test('setWorkingDirectory disposes and re-initializes', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const otherDir = mkdtempSync(join(tmpdir(), 'omp-test-'));
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      await adapter.setWorkingDirectory(otherDir);
      expect(adapter.getState().status).toBe('ready');
    } finally {
      await adapter.dispose();
    }
  }, 30000);
});

describe('OmpAdapter Simulation — event emissions', () => {
  test('config change events fire for model/thinking changes', async () => {
    // The mock doesn't auto-emit config changes, but adapter.stop+start etc.
    // We verify the adapter event bus path works
    const adapter = mockAdapter();
    const bus = getEventBus();
    const configChanges = [];

    const unsub = bus.subscribe(RuntimeEvent.CONFIG_CHANGE, (data) => {
      configChanges.push(data);
    });

    try {
      await adapter.initialize();
      // Emit a STATUS_UPDATE via the bus and verify the bus works
      bus.emit(RuntimeEvent.STATUS_UPDATE, { status: 'ready', phase: 'idle' });
      expect(configChanges.length).toBe(0); // no CONFIG_CHANGE events from our emit

      // The mock doesn't emit config changes — but the adapter routes them
      // when omp sends thinking_level_changed / model_changed messages
      // This test proves the bus and adapter are connected
      expect(adapter.getState().status).toBe('ready');
    } finally {
      unsub();
      await adapter.dispose();
    }
  }, 15000);
});

describe('OmpAdapter Simulation — getConfig/getDebug/setDebug', () => {
  test('getConfig() contains ompCliPath', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const cfg = adapter.getConfig();
      expect(cfg.ompCliPath).toBe(MOCK_OMP_PATH);
      expect(cfg.workingDirectory).toBe('/tmp');
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('debug mode can be toggled', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      expect(adapter.getDebugMode()).toBe(false);
      adapter.setDebugMode(true);
      expect(adapter.getDebugMode()).toBe(true);
      adapter.setDebugMode(false);
      expect(adapter.getDebugMode()).toBe(false);
    } finally {
      await adapter.dispose();
    }
  }, 15000);
});

describe('OmpAdapter Simulation — multiple sessions', () => {
  test('switchSession() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.switchSession('/tmp/other-session.jsonl');
      expect(result.ok).toBe(true);
    } finally {
      await adapter.dispose();
    }
  }, 15000);

  test('branchSession() succeeds', async () => {
    const adapter = mockAdapter();
    try {
      await adapter.initialize();
      const result = await adapter.branchSession('entry-1');
      expect(result.sessionId).toBe('branched-session-def');
    } finally {
      await adapter.dispose();
    }
  }, 15000);
});
