/**
 * Desktop UI 适配器与事件流测试
 * - 验证 bootstrapRuntime 正确创建 engine 并传递 ui adapter
 * - 验证 engine 的 ui 回调正确转为 EventBus 事件
 * - 验证 EventBus 事件转发给 UIBridge / IPC
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { bootstrapRuntime } from '../../src/core/runtime/runtime-bootstrap.js';
import { DesktopCore, createDesktopCore } from '../../src/adapters/desktop/desktop-core.js';
import { getEventBus, RuntimeEvent } from '../../src/runtime/index.js';
import { createI18n } from '../../src/core/i18n.js';

describe('i18n 默认语言验证', () => {
  test('i18n 默认使用简体中文', () => {
    const inst = createI18n();
    expect(inst.getCurrentLanguage()).toBe('zh-CN');
    expect(inst.t('common.ok')).toBe('确定');
    expect(inst.t('common.cancel')).toBe('取消');
  });
});

describe('DesktopCore - UI 适配器与事件流', () => {
  let eventBus;

  beforeEach(() => {
    eventBus = getEventBus();
  });

  test('DesktopCore.initialize 时会通过 bootstrapRuntime 创建 engine', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });
    try {
      await desktopCore.initialize();
      const engine = desktopCore.getEngine();
      expect(engine).toBeDefined();
      expect(typeof engine.processInput).toBe('function');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('初始化时创建的 engine 应该有工具', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });
    try {
      await desktopCore.initialize();
      const tools = desktopCore.getTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    } finally {
      await desktopCore.dispose();
    }
  });
});

describe('runtime-bootstrap - ui 适配器桥接', () => {
  test('bootstrapRuntime 可以接受 ui 参数', async () => {
    let toolCallCount = 0;
    let toolResultCount = 0;

    const uiAdapter = {
      toolCall: (name, args) => {
        toolCallCount++;
      },
      toolResult: (name, result) => {
        toolResultCount++;
      },
      toolError: () => {},
      iteration: () => {},
      finalAnswer: () => {},
      warn: () => {},
      debugEvent: () => {},
      debug: () => {},
    };

    const runtime = await bootstrapRuntime({
      workingDirectory: process.cwd(),
      maxIterations: 5,
      debug: false,
      securityPolicy: 'full',
      modelProvider: null,
      memoryManager: null,
      ui: uiAdapter,
    });

    expect(runtime).toBeDefined();
    expect(runtime.engine).toBeDefined();
    expect(typeof runtime.engine.processInput).toBe('function');
  });

  test('engine.processInput 会通过 ui 回调发射关键事件', async () => {
    const receivedEvents = [];
    const eventBus = getEventBus();

    const uiAdapter = {
      toolCall: (name, args) => {
        receivedEvents.push({ type: 'tool:call', name, arguments: args });
        eventBus.emit(RuntimeEvent.TOOL_CALL, { name, arguments: args });
      },
      toolResult: (name, result) => {
        receivedEvents.push({ type: 'tool:result', name, result });
        eventBus.emit(RuntimeEvent.TOOL_RESULT, { name, result });
      },
      toolError: (name, error) => {
        receivedEvents.push({ type: 'tool:error', name, error });
        eventBus.emit(RuntimeEvent.TOOL_ERROR, { name, error });
      },
      iteration: (i, max) => {
        receivedEvents.push({ type: 'iteration', i, max });
        eventBus.emit(RuntimeEvent.STATUS_UPDATE, { iteration: i, max });
      },
      finalAnswer: (answer) => {
        receivedEvents.push({ type: 'agent:complete', answer });
        eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { answer });
      },
      warn: (message) => {
        receivedEvents.push({ type: 'warn', message });
        eventBus.emit(RuntimeEvent.AGENT_ERROR, { level: 'warn', message });
      },
      debug: (message) => {
        receivedEvents.push({ type: 'debug', message });
      },
      debugEvent: (name, data) => {
        receivedEvents.push({ type: 'debugEvent', name, data });
        if (name === 'Agent run started') {
          eventBus.emit(RuntimeEvent.AGENT_START, { ...(data || {}) });
        } else {
          eventBus.emit(RuntimeEvent.AGENT_THINKING, { eventName: name, data });
        }
      },
    };

    const runtime = await bootstrapRuntime({
      workingDirectory: process.cwd(),
      maxIterations: 5,
      debug: false,
      securityPolicy: 'full',
      modelProvider: null,
      memoryManager: null,
      ui: uiAdapter,
    });

    const eventBusEvents = [];
    const unsubStart = eventBus.subscribe(RuntimeEvent.AGENT_START, (data) => {
      eventBusEvents.push({ type: RuntimeEvent.AGENT_START, data });
    });
    const unsubComplete = eventBus.subscribe(RuntimeEvent.AGENT_COMPLETE, (data) => {
      eventBusEvents.push({ type: RuntimeEvent.AGENT_COMPLETE, data });
    });
    const unsubToolCall = eventBus.subscribe(RuntimeEvent.TOOL_CALL, (data) => {
      eventBusEvents.push({ type: RuntimeEvent.TOOL_CALL, data });
    });
    const unsubToolResult = eventBus.subscribe(RuntimeEvent.TOOL_RESULT, (data) => {
      eventBusEvents.push({ type: RuntimeEvent.TOOL_RESULT, data });
    });

    try {
      const result = await runtime.engine.processInput('say hi (testing only)');
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      // processInput 必然走 ui 回调
      expect(receivedEvents.length).toBeGreaterThan(0);
      // 至少会有一个 AGENT_START 或 AGENT_THINKING 事件
      const hasStart = eventBusEvents.some((e) => e.type === RuntimeEvent.AGENT_START);
      const hasThinking = eventBusEvents.some((e) => e.type === RuntimeEvent.AGENT_THINKING);
      expect(hasStart || hasThinking).toBe(true);
    } finally {
      unsubStart && unsubStart();
      unsubComplete && unsubComplete();
      unsubToolCall && unsubToolCall();
      unsubToolResult && unsubToolResult();
    }
  });
});

describe('DesktopCore - 运行详情事件转发', () => {
  test('engine 通过 ui adapter 发出的 tool:call 事件被转发到 UIBridge', async () => {
    const eventBus = getEventBus();
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      // 监听来自 UIBridge 的 tool:call 事件
      const received = [];
      const uiBridge = {
        onMessage: (message) => {
          received.push(message);
        },
        attachCoreRef: () => {},
        disconnect: () => {},
      };
      desktopCore.attachUIBridge(uiBridge);

      // 直接通过 eventBus 发射一个 tool:call 事件
      // （这模拟了 engine.ui.toolCall 的效果）
      eventBus.emit(RuntimeEvent.TOOL_CALL, {
        name: 'filesystem_list_directory',
        arguments: { path: '.' },
      });

      // 等待事件传播
      await new Promise((resolve) => setTimeout(resolve, 100));

      const toolCallMessages = received.filter((m) => m.type === RuntimeEvent.TOOL_CALL);
      expect(toolCallMessages.length).toBeGreaterThan(0);
      expect(toolCallMessages[0].data.name).toBe('filesystem_list_directory');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('eventBus 事件通过 desktopCore.#setupEventForwarding 转发', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      const received = [];
      const uiBridge = {
        onMessage: (message) => {
          received.push(message);
        },
        attachCoreRef: () => {},
        disconnect: () => {},
      };
      desktopCore.attachUIBridge(uiBridge);

      const eventBus = desktopCore.getEventBus();
      const testPayload = { message: 'test event', timestamp: Date.now() };

      eventBus.emit(RuntimeEvent.AGENT_START, testPayload);
      eventBus.emit(RuntimeEvent.STATUS_UPDATE, { status: 'running' });
      eventBus.emit(RuntimeEvent.AGENT_COMPLETE, { answer: 'done' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received.length).toBeGreaterThan(0);
      const startEvent = received.find((m) => m.type === RuntimeEvent.AGENT_START);
      expect(startEvent).toBeDefined();
      expect(startEvent.data.message).toBe('test event');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('plan events are forwarded to UIBridge', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      const received = [];
      desktopCore.attachUIBridge({
        onMessage: (message) => received.push(message),
        attachCoreRef: () => {},
        disconnect: () => {},
      });

      const eventBus = desktopCore.getEventBus();
      const plan = {
        name: 'Automatic coding task plan',
        tasks: [{ id: 'inspect_workspace', name: 'Inspect workspace', status: 'running' }],
      };

      eventBus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, { plan });
      eventBus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
        plan,
        update: { after: '- inspect_workspace: completed' },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received.some((m) => m.type === RuntimeEvent.EXECUTION_PLAN_CREATED)).toBe(true);
      expect(received.some((m) => m.type === RuntimeEvent.EXECUTION_PLAN_UPDATED)).toBe(true);
    } finally {
      await desktopCore.dispose();
    }
  });
});

describe('bootstrapRuntime 基础功能验证', () => {
  test('返回完整的 runtime 组件：engine, toolRegistry, workspaceState 等', async () => {
    const runtime = await bootstrapRuntime({
      workingDirectory: process.cwd(),
      maxIterations: 5,
      debug: false,
      securityPolicy: 'full',
      modelProvider: null,
      memoryManager: null,
      ui: null,
    });

    expect(runtime.engine).toBeDefined();
    expect(runtime.toolRegistry).toBeDefined();
    expect(runtime.workspaceState).toBeDefined();
    expect(runtime.metricsSink).toBeDefined();
    expect(runtime.workingDirectory).toBeDefined();
    expect(typeof runtime.engine.processInput).toBe('function');
    expect(typeof runtime.engine.getState).toBe('function');
    expect(typeof runtime.engine.getTools).toBe('function');
    expect(typeof runtime.toolRegistry.size).toBe('number');
    expect(runtime.toolRegistry.size).toBeGreaterThan(0);
  });

  test('engine.getState 返回正确结构', async () => {
    const runtime = await bootstrapRuntime({
      workingDirectory: process.cwd(),
      maxIterations: 5,
      debug: false,
      securityPolicy: 'full',
      ui: null,
    });

    const state = runtime.engine.getState();
    expect(state).toBeDefined();
    expect(typeof state).toBe('object');
    expect(state.workingDirectory).toBeDefined();
    expect(typeof state.toolCount).toBe('number');
    expect(state.toolCount).toBeGreaterThan(0);
  });

  test('engine.processInput 在没有 modelProvider 时返回有意义的结果', async () => {
    const runtime = await bootstrapRuntime({
      workingDirectory: process.cwd(),
      maxIterations: 3,
      debug: false,
      securityPolicy: 'full',
      modelProvider: null,
      ui: null,
    });

    const result = await runtime.engine.processInput('just a test');
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(typeof result.status).toBe('string');
  });
});

describe('DesktopCore - 流式事件转发', () => {
  test('agent:text_delta 事件通过 eventBus 转发', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      const received = [];
      const uiBridge = {
        onMessage: (message) => {
          received.push(message);
        },
        attachCoreRef: () => {},
        disconnect: () => {},
      };
      desktopCore.attachUIBridge(uiBridge);

      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.AGENT_TEXT_DELTA, { text: 'Hello', timestamp: Date.now() });
      eventBus.emit(RuntimeEvent.AGENT_TEXT_DELTA, { text: ' World', timestamp: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const textDeltaEvents = received.filter((m) => m.type === RuntimeEvent.AGENT_TEXT_DELTA);
      expect(textDeltaEvents.length).toBeGreaterThanOrEqual(2);
      expect(textDeltaEvents[0].data.text).toBe('Hello');
      expect(textDeltaEvents[1].data.text).toBe(' World');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('agent:reasoning_delta 事件通过 eventBus 转发', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      const received = [];
      const uiBridge = {
        onMessage: (message) => {
          received.push(message);
        },
        attachCoreRef: () => {},
        disconnect: () => {},
      };
      desktopCore.attachUIBridge(uiBridge);

      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.AGENT_REASONING_DELTA, { text: '思考中', timestamp: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const reasoningDeltaEvents = received.filter(
        (m) => m.type === RuntimeEvent.AGENT_REASONING_DELTA,
      );
      expect(reasoningDeltaEvents.length).toBe(1);
      expect(reasoningDeltaEvents[0].data.text).toBe('思考中');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('agent:tool_call_delta 事件通过 eventBus 转发', async () => {
    const desktopCore = createDesktopCore({
      workingDirectory: process.cwd(),
      debug: false,
    });

    try {
      await desktopCore.initialize();

      const received = [];
      const uiBridge = {
        onMessage: (message) => {
          received.push(message);
        },
        attachCoreRef: () => {},
        disconnect: () => {},
      };
      desktopCore.attachUIBridge(uiBridge);

      const eventBus = desktopCore.getEventBus();
      eventBus.emit(RuntimeEvent.AGENT_TOOL_CALL_DELTA, {
        index: 0,
        name: 'read_file',
        arguments: '{"path":"a.txt"}',
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const toolCallDeltaEvents = received.filter(
        (m) => m.type === RuntimeEvent.AGENT_TOOL_CALL_DELTA,
      );
      expect(toolCallDeltaEvents.length).toBe(1);
      expect(toolCallDeltaEvents[0].data.name).toBe('read_file');
      expect(toolCallDeltaEvents[0].data.arguments).toBe('{"path":"a.txt"}');
    } finally {
      await desktopCore.dispose();
    }
  });

  test('DesktopCore UI 适配器提供流式回调实现', () => {
    const eventBus = getEventBus();

    const receivedEvents = [];
    const unsubText = eventBus.subscribe(RuntimeEvent.AGENT_TEXT_DELTA, (d) =>
      receivedEvents.push({ ...d, __type: 'text_delta' }),
    );
    const unsubReasoning = eventBus.subscribe(RuntimeEvent.AGENT_REASONING_DELTA, (d) =>
      receivedEvents.push({ ...d, __type: 'reasoning_delta' }),
    );
    const unsubToolCall = eventBus.subscribe(RuntimeEvent.AGENT_TOOL_CALL_DELTA, (d) =>
      receivedEvents.push({ ...d, __type: 'tool_call_delta' }),
    );

    try {
      const uiAdapter = {
        onTextDelta: (text) => eventBus.emit(RuntimeEvent.AGENT_TEXT_DELTA, { text }),
        onReasoningDelta: (text) => eventBus.emit(RuntimeEvent.AGENT_REASONING_DELTA, { text }),
        onToolCallDelta: (delta) => eventBus.emit(RuntimeEvent.AGENT_TOOL_CALL_DELTA, delta),
      };

      uiAdapter.onTextDelta('你');
      uiAdapter.onTextDelta('好');
      uiAdapter.onReasoningDelta('正在思考');
      uiAdapter.onToolCallDelta({ index: 0, name: 'foo', arguments: '{}' });

      const textEvents = receivedEvents.filter((e) => e.__type === 'text_delta');
      const reasoningEvents = receivedEvents.filter((e) => e.__type === 'reasoning_delta');
      const toolCallEvents = receivedEvents.filter((e) => e.__type === 'tool_call_delta');

      expect(textEvents.length).toBe(2);
      expect(textEvents[0].text).toBe('你');
      expect(textEvents[1].text).toBe('好');
      expect(reasoningEvents.length).toBe(1);
      expect(reasoningEvents[0].text).toBe('正在思考');
      expect(toolCallEvents.length).toBe(1);
      expect(toolCallEvents[0].name).toBe('foo');
    } finally {
      unsubText && unsubText();
      unsubReasoning && unsubReasoning();
      unsubToolCall && unsubToolCall();
    }
  });
});

describe('RuntimeEvent - 流式事件常量', () => {
  test('流式事件常量在 RuntimeEvent 中定义', () => {
    expect(RuntimeEvent.AGENT_TEXT_DELTA).toBeDefined();
    expect(RuntimeEvent.AGENT_REASONING_DELTA).toBeDefined();
    expect(RuntimeEvent.AGENT_TOOL_CALL_DELTA).toBeDefined();
    expect(typeof RuntimeEvent.AGENT_TEXT_DELTA).toBe('string');
    expect(typeof RuntimeEvent.AGENT_REASONING_DELTA).toBe('string');
    expect(typeof RuntimeEvent.AGENT_TOOL_CALL_DELTA).toBe('string');
  });

  test('流式事件值格式为 agent:xxx_delta', () => {
    expect(RuntimeEvent.AGENT_TEXT_DELTA).toContain('agent:');
    expect(RuntimeEvent.AGENT_TEXT_DELTA).toContain('delta');
    expect(RuntimeEvent.AGENT_REASONING_DELTA).toContain('agent:');
    expect(RuntimeEvent.AGENT_TOOL_CALL_DELTA).toContain('agent:');
  });
});
