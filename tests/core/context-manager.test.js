import { describe, test, expect } from 'bun:test';
import { ContextManager } from '../../src/core/runtime/agent/context-manager.js';

/**
 * Helper: create a mock sessionManager for ContextManager tests.
 */
function createMockSessionManager(overrides = {}) {
  return {
    getHistory: overrides.getHistory || (() => []),
    getTokenCount: overrides.getTokenCount || (() => 0),
    getMaxTokens: overrides.getMaxTokens || (() => 8000),
    addSystemMessage: overrides.addSystemMessage || (() => {}),
    trimWithPruner: overrides.trimWithPruner || (() => null),
    trimToContextWindow: overrides.trimToContextWindow || (() => {}),
    ...overrides,
  };
}

function createMockTokenScope(limit = 8000) {
  return { getEffectiveLimit: () => limit };
}

function createMockWorkspaceState(overrides = {}) {
  return {
    getSummary: overrides.getSummary || (() => ({ trackedFiles: 5, trackedDirectories: 2 })),
    getCriticalFacts: overrides.getCriticalFacts || (() => []),
    ...overrides,
  };
}

function createMockObservationSummarizer(description = 'Workspace with 5 files') {
  return { generateWorkspaceDescription: () => description };
}

describe('ContextManager', () => {
  describe('constructor', () => {
    test('creates instance with all dependencies', () => {
      const cm = new ContextManager({
        sessionManager: createMockSessionManager(),
        contextPruner: {},
        tokenScope: createMockTokenScope(),
        workspaceState: createMockWorkspaceState(),
        observationSummarizer: createMockObservationSummarizer(),
        config: { maxTokens: 10000 },
      });
      expect(cm).toBeDefined();
    });

    test('creates instance with no dependencies (all optional)', () => {
      const cm = new ContextManager({});
      expect(cm).toBeDefined();
    });

    test('defaults config.maxTokens to 8000', () => {
      const cm = new ContextManager({ sessionManager: createMockSessionManager() });
      // Verified indirectly: manage() should work with default config
      const result = cm.manage(1, 10);
      // With 0 tokens, should not trim; result trimmed=false
      expect(result.trimmed).toBe(false);
    });
  });

  describe('manage', () => {
    test('returns null when sessionManager is not provided', () => {
      const cm = new ContextManager({});
      expect(cm.manage(1, 10)).toBeNull();
    });

    test('returns { trimmed: false } when current tokens below threshold', () => {
      const sm = createMockSessionManager({ getTokenCount: () => 100 });
      const cm = new ContextManager({ sessionManager: sm, config: { maxTokens: 8000 } });
      const result = cm.manage(1, 10);
      expect(result.trimmed).toBe(false);
      expect(result.currentTokens).toBe(100);
      expect(result.threshold).toBeDefined();
    });

    test('returns { trimmed: true } when current tokens exceed threshold', () => {
      const sm = createMockSessionManager({
        getTokenCount: () => 7000,
        getHistory: () =>
          Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `msg ${i}` })),
        trimWithPruner: () => ({ pruned: 5 }),
      });
      const cm = new ContextManager({
        sessionManager: sm,
        tokenScope: createMockTokenScope(8000),
        config: { maxTokens: 8000 },
      });
      const result = cm.manage(5, 10);
      expect(result.trimmed).toBe(true);
      expect(result.targetTokens).toBeDefined();
      expect(result.preserveRecentMessages).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    test('uses tokenScope.getEffectiveLimit when available', () => {
      const sm = createMockSessionManager({ getTokenCount: () => 100 });
      const cm = new ContextManager({
        sessionManager: sm,
        tokenScope: createMockTokenScope(4000),
      });
      const result = cm.manage(1, 10);
      // Threshold should be based on 4000, not 8000
      expect(result.threshold).toBeLessThanOrEqual(4000);
    });

    test('falls back to sessionManager.getMaxTokens when tokenScope absent', () => {
      const sm = createMockSessionManager({
        getTokenCount: () => 100,
        getMaxTokens: () => 6000,
      });
      const cm = new ContextManager({ sessionManager: sm });
      const result = cm.manage(1, 10);
      expect(result.threshold).toBeLessThanOrEqual(6000);
    });

    test('uses trimToContextWindow when trimWithPruner is not available', () => {
      let trimCalled = false;
      const sm = createMockSessionManager({
        getTokenCount: () => 7000,
        getHistory: () =>
          Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `msg ${i}` })),
        // Do NOT include trimWithPruner — only trimToContextWindow
      });
      delete sm.trimWithPruner;
      sm.trimToContextWindow = () => {
        trimCalled = true;
      };
      const cm = new ContextManager({
        sessionManager: sm,
        tokenScope: createMockTokenScope(8000),
      });
      cm.manage(5, 10);
      expect(trimCalled).toBe(true);
    });

    test('calls contextPruner.updateConfig when available', () => {
      let updateConfigCalled = false;
      const pruner = {
        updateConfig: () => {
          updateConfigCalled = true;
        },
      };
      const sm = createMockSessionManager({
        getTokenCount: () => 7000,
        getHistory: () =>
          Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `msg ${i}` })),
        trimWithPruner: () => null,
      });
      const cm = new ContextManager({
        sessionManager: sm,
        contextPruner: pruner,
        tokenScope: createMockTokenScope(8000),
      });
      cm.manage(5, 10);
      expect(updateConfigCalled).toBe(true);
    });

    test('adjusts preserveRecentMessages based on iteration progress', () => {
      const sm = createMockSessionManager({
        getTokenCount: () => 7000,
        getHistory: () =>
          Array.from({ length: 15 }, (_, i) => ({ role: 'user', content: `msg ${i}` })),
        trimWithPruner: () => null,
      });
      const cm = new ContextManager({
        sessionManager: sm,
        tokenScope: createMockTokenScope(8000),
      });
      // Early iteration: should preserve more messages
      const early = cm.manage(1, 10);
      // Late iteration: should preserve fewer messages
      const late = cm.manage(9, 10);
      expect(early.preserveRecentMessages).toBeGreaterThanOrEqual(late.preserveRecentMessages);
    });
  });

  describe('injectSummaryIfStale', () => {
    test('does nothing when workspaceState is null', () => {
      let addSystemMessageCalled = false;
      const sm = createMockSessionManager({
        addSystemMessage: () => {
          addSystemMessageCalled = true;
        },
      });
      const cm = new ContextManager({ sessionManager: sm, workspaceState: null });
      cm.injectSummaryIfStale();
      expect(addSystemMessageCalled).toBe(false);
    });

    test('does nothing when sessionManager is null', () => {
      const ws = createMockWorkspaceState();
      const cm = new ContextManager({ workspaceState: ws });
      // Should not throw
      cm.injectSummaryIfStale();
    });

    test('calls addSystemMessage when workspace summary is available', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState();
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toContain('工作区探索状态');
    });

    test('does not add message when summary has no tracked files or directories', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState({
        getSummary: () => ({ trackedFiles: 0, trackedDirectories: 0 }),
      });
      const cm = new ContextManager({ sessionManager: sm, workspaceState: ws });
      cm.injectSummaryIfStale();
      expect(messages.length).toBe(0);
    });

    test('uses cached hint within 30 seconds', () => {
      let callCount = 0;
      const sm = createMockSessionManager({
        addSystemMessage: () => {
          callCount++;
        },
      });
      const ws = createMockWorkspaceState();
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      const firstCallCount = callCount;
      cm.injectSummaryIfStale();
      // Second call should reuse cache, but still calls addSystemMessage
      // (the cache avoids re-generating hint, but addSystemMessage is still called)
      expect(callCount).toBeGreaterThan(firstCallCount);
    });
  });

  describe('refreshSummary', () => {
    test('clears cached hint so next injectSummaryIfStale regenerates', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState();
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      const firstMsg = messages[0];

      cm.refreshSummary();
      messages.length = 0;
      cm.injectSummaryIfStale();
      // After refresh, a new hint should be generated (same content but regenerated)
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    test('resets cache state', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState();
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      messages.length = 0;

      cm.clear();
      cm.injectSummaryIfStale();
      // After clear, hint is regenerated
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('workspace hint content', () => {
    test('includes known non-existent paths from critical facts', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState({
        getSummary: () => ({ trackedFiles: 3, trackedDirectories: 1 }),
        getCriticalFacts: () => [
          { type: 'path_not_found', value: { path: '/tmp/missing.js' } },
          { type: 'other_fact', value: 'some info' },
        ],
      });
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      expect(messages[0]).toContain('/tmp/missing.js');
      expect(messages[0]).toContain('已知不存在的路径');
    });

    test('includes important non-path-not-found facts', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState({
        getSummary: () => ({ trackedFiles: 3, trackedDirectories: 1 }),
        getCriticalFacts: () => [{ type: 'architecture', value: 'uses MVC pattern' }],
      });
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: createMockObservationSummarizer(),
      });
      cm.injectSummaryIfStale();
      expect(messages[0]).toContain('architecture');
      expect(messages[0]).toContain('关键发现');
    });

    test('uses observationSummarizer.generateWorkspaceDescription when available', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState();
      const customDesc = 'Custom workspace description from summarizer';
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        observationSummarizer: { generateWorkspaceDescription: () => customDesc },
      });
      cm.injectSummaryIfStale();
      expect(messages[0]).toContain(customDesc);
    });

    test('falls back to workspaceState.generateWorkspaceDescription', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState({
        generateWorkspaceDescription: () => 'Fallback workspace description',
      });
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        // No observationSummarizer
      });
      cm.injectSummaryIfStale();
      expect(messages[0]).toContain('Fallback workspace description');
    });

    test('falls back to trackedFiles/trackedDirectories count when no summarizer', () => {
      const messages = [];
      const sm = createMockSessionManager({
        addSystemMessage: (msg) => messages.push(msg),
      });
      const ws = createMockWorkspaceState({
        getSummary: () => ({ trackedFiles: 7, trackedDirectories: 3 }),
        // No generateWorkspaceDescription
      });
      const cm = new ContextManager({
        sessionManager: sm,
        workspaceState: ws,
        // No observationSummarizer
      });
      cm.injectSummaryIfStale();
      expect(messages[0]).toContain('Tracked files: 7');
      expect(messages[0]).toContain('tracked directories: 3');
    });
  });
});
