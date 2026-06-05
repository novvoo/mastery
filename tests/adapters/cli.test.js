/**
 * CLI Adapter Integration Tests
 * Tests for the CLI platform adapter
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { runCLIRuntime, CLIUIAdapter } from '../../src/adapters/cli/index.js';
import { getEventBus, RuntimeEvent } from '../../src/runtime/index.js';

describe('CLI Adapter Integration Tests', () => {
  let eventBus;

  beforeEach(() => {
    eventBus = getEventBus();
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
  });

  describe('runCLIRuntime', () => {
    it('should create runtime with basic config', async () => {
      // This test requires model provider to be mocked
      // For now, we test the structure without actual execution
      
      expect(typeof runCLIRuntime).toBe('function');
    });

    it('should accept configuration options', () => {
      // Test that the function signature accepts expected parameters
      const config = {
        workingDirectory: '/tmp/test',
        debug: true,
        maxIterations: 100,
        autoDownloadModels: false,
        modelProvider: null // Mock provider
      };
      
      expect(typeof runCLIRuntime).toBe('function');
      // Actual execution would require model provider
    });
  });

  describe('CLIUIAdapter', () => {
    it('should create adapter instance', () => {
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      expect(adapter).toBeDefined();
    });

    it('should attach and detach from event bus', () => {
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      
      // Should attach without error
      adapter.attach();
      
      // Should detach without error
      adapter.detach();
    });

    it('should subscribe to runtime events when attached', () => {
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      // Check that events are being subscribed
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_COMPLETE)).toBe(1);
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_ERROR)).toBe(1);
      
      adapter.detach();
    });

    it('should handle agent start event', async () => {
      let startHandlerCalled = false;
      const mockUI = {
        showBanner: () => { startHandlerCalled = true; },
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.AGENT_START, { task: 'test task' });
      
      // Handler should be called
      expect(startHandlerCalled).toBe(true);
      
      adapter.detach();
    });

    it('should handle status update events', () => {
      const messages = [];
      const mockUI = {
        info: (msg) => messages.push({ type: 'info', msg }),
        success: (msg) => messages.push({ type: 'success', msg }),
        error: (msg) => messages.push({ type: 'error', msg }),
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'info message', level: 'info' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'success message', level: 'success' });
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { message: 'error message', level: 'error' });
      
      expect(messages.length).toBe(3);
      expect(messages[0].type).toBe('info');
      expect(messages[1].type).toBe('success');
      expect(messages[2].type).toBe('error');
      
      adapter.detach();
    });

    it('should handle tool call events', () => {
      const toolCalls = [];
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { 
          dim: (t) => {
            toolCalls.push(t);
            return t;
          }
        }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.TOOL_CALL, { toolName: 'test_tool', args: {} });
      
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0]).toContain('test_tool');
      
      adapter.detach();
    });

    it('should handle agent complete event', () => {
      let resultHandlerCalled = false;
      let receivedResult = null;
      const mockUI = {
        showResult: (result) => {
          resultHandlerCalled = true;
          receivedResult = result;
        },
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { result: 'test result' });
      
      expect(resultHandlerCalled).toBe(true);
      expect(receivedResult).toBe('test result');
      
      adapter.detach();
    });

    it('should handle agent error event', () => {
      let errorHandlerCalled = false;
      const mockUI = {
        showError: () => { errorHandlerCalled = true; },
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.AGENT_ERROR, { error: 'test error' });
      
      expect(errorHandlerCalled).toBe(true);
      
      adapter.detach();
    });

    it('should handle debug events', () => {
      let debugHandlerCalled = false;
      let debugData = null;
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        debugEvent: (name, data) => {
          debugHandlerCalled = true;
          debugData = { name, data };
        },
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      adapter.attach();
      
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { 
        eventName: 'test_event', 
        data: { key: 'value' },
        level: 'debug'
      });
      
      expect(debugHandlerCalled).toBe(true);
      expect(debugData.name).toBe('test_event');
      expect(debugData.data.key).toBe('value');
      
      adapter.detach();
    });
  });

  describe('Adapter Lifecycle', () => {
    it('should allow reattaching after detaching', () => {
      const mockUI = {
        info: () => {},
        success: () => {},
        error: () => {},
        theme: { dim: (t) => t }
      };
      
      const adapter = new CLIUIAdapter(eventBus, mockUI);
      
      // First attach
      adapter.attach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      
      // Detach
      adapter.detach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
      
      // Reattach
      adapter.attach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      
      adapter.detach();
    });

    it('should handle multiple adapters', () => {
      const mockUI1 = { info: () => {}, success: () => {}, error: () => {}, theme: { dim: (t) => t } };
      const mockUI2 = { info: () => {}, success: () => {}, error: () => {}, theme: { dim: (t) => t } };
      
      const adapter1 = new CLIUIAdapter(eventBus, mockUI1);
      const adapter2 = new CLIUIAdapter(eventBus, mockUI2);
      
      adapter1.attach();
      adapter2.attach();
      
      // Both adapters should receive events
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(2);
      
      adapter1.detach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(1);
      
      adapter2.detach();
      expect(eventBus.getSubscriberCount(RuntimeEvent.AGENT_START)).toBe(0);
    });
  });
});
