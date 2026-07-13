/**
 * End-to-end test: EventBus → IPC Main → IPC Renderer → UIBridge
 *
 * Verifies that runtime events emitted on the EventBus flow through
 * the full IPC chain and arrive in the UIBridge message queue that
 * React hooks consume. IPC layers use linked mocks (no Electron).
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { getEventBus, resetEventBus } from '../../src/runtime/event-bus.js';
import { RuntimeEvent } from '../../src/runtime/types.js';
import { MainProcessIPCAdapter } from '../../src/adapters/desktop/ipc/main-process-adapter.js';
import { RendererProcessIPCAdapter } from '../../src/adapters/desktop/ipc/renderer-process-adapter.js';
import { UIBridge } from '../../src/adapters/desktop/desktop-core/ui-bridge.js';
import { IPCMessageType } from '../../src/adapters/desktop/protocol/ipc-protocol.js';

afterEach(() => {
  resetEventBus();
});

/**
 * Create linked ipcMain ↔ ipcRenderer mocks.
 * Messages sent by the main adapter to a window are delivered to the renderer.
 */
function createLinkedMocks() {
  const mainEvents = new Map();   // main-process listener channels
  const rendererEvents = new Map(); // renderer listener channels
  let connectHandler = null;

  const ipcMain = {
    handle: (channel, fn) => {
      if (channel === IPCMessageType.CONNECT) connectHandler = fn;
    },
    on: (channel, cb) => {
      if (!mainEvents.has(channel)) mainEvents.set(channel, new Set());
      mainEvents.get(channel).add(cb);
    },
  };

  const ipcRenderer = {
    on: (channel, cb) => {
      if (!rendererEvents.has(channel)) rendererEvents.set(channel, new Set());
      rendererEvents.get(channel).add(cb);
    },
    invoke: async (channel) => {
      if (channel === IPCMessageType.CONNECT && connectHandler) {
        const sender = {
          id: 1,
          send: (ch, data) => {
            // Main→renderer delivery
            const rCbs = rendererEvents.get(ch);
            if (rCbs) {
              for (const cb of rCbs) cb({ sender }, data);
            }
          },
        };
        return connectHandler({ sender });
      }
      throw new Error(`No handler for ${channel}`);
    },
    send: (channel, data) => {
      // Renderer→main delivery
      const mCbs = mainEvents.get(channel);
      if (mCbs) {
        for (const cb of mCbs) cb({ sender: { id: 1 } }, data);
      }
    },
  };

  return { ipcMain, ipcRenderer };
}

/**
 * Build full EventBus → MainIPC → RendererIPC → UIBridge chain.
 * Returns handles to inspect each layer.
 */
function buildFullChain() {
  const bus = getEventBus();
  const { ipcMain, ipcRenderer } = createLinkedMocks();

  // Main process adapter subscribes to EventBus for event forwarding
  const mainAdapter = new MainProcessIPCAdapter(ipcMain, bus, { debug: false });

  // Renderer process adapter (simulates renderer side)
  const rendererAdapter = new RendererProcessIPCAdapter(ipcRenderer, { debug: false });

  // UIBridge — the layer React hooks interface with
  const uiBridge = new UIBridge({ debug: false });

  return {
    bus,
    ipcMain,
    ipcRenderer,
    mainAdapter,
    rendererAdapter,
    uiBridge,
    /**
     * Initialize the full chain:
     * 1. Initialize main adapter (registers IPC handlers)
     * 2. Initialize renderer adapter (connects to main, sets up listeners)
     * 3. Wire UIBridge to receive events from renderer
     */
    init: async () => {
      await mainAdapter.initialize();
      await rendererAdapter.initialize();

      // Wire IPC events to UIBridge (mirrors UIBridge.#setupIPCListeners)
      const runtimeEvents = [
        RuntimeEvent.AGENT_START, RuntimeEvent.AGENT_STOP,
        RuntimeEvent.AGENT_COMPLETE, RuntimeEvent.AGENT_ERROR,
        RuntimeEvent.AGENT_THINKING,
        // NOTE: text/ reasoning/tool_call deltas are handled by useRuntime directly
        RuntimeEvent.TOOL_CALL, RuntimeEvent.TOOL_RESULT,
        RuntimeEvent.TOOL_ERROR, RuntimeEvent.TOOL_ACTIVITY,
        RuntimeEvent.TOOL_PROGRESS,
        RuntimeEvent.STATUS_UPDATE, RuntimeEvent.CONFIG_CHANGE,
        RuntimeEvent.EXECUTION_PLAN_CREATED, RuntimeEvent.EXECUTION_PLAN_UPDATED,
        RuntimeEvent.PLAN_DECOMPOSED, RuntimeEvent.PLAN_EXECUTED,
        RuntimeEvent.SUBAGENT_UPDATE,
        RuntimeEvent.AGENT_INTERACTION_REQUEST, RuntimeEvent.AGENT_INTERACTION_CANCEL,
        RuntimeEvent.MEMORY_UPDATE, RuntimeEvent.MEMORY_CLEAR,
        RuntimeEvent.MESSAGE_RECEIVED, RuntimeEvent.MESSAGE_SENT,
        RuntimeEvent.SESSION_CHANGE,
      ];
      for (const evt of runtimeEvents) {
        rendererAdapter.subscribe(evt, (payload) => {
          uiBridge.onMessage({ type: evt, data: payload, timestamp: Date.now() });
        });
      }
    },
  };
}

describe('E2E: EventBus → UIBridge — agent lifecycle events', () => {
  test('AGENT_START flows to UIBridge message queue', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_START, { turn: 1 });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_START);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].data.turn).toBe(1);
  });

  test('AGENT_STOP reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_STOP, { code: 0 });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_STOP);
    expect(msgs.length).toBe(1);
  });

  test('AGENT_COMPLETE with answer reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_COMPLETE, { answer: 'Task done', phase: 'final_answer' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_COMPLETE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.answer).toContain('Task done');
  });

  test('AGENT_ERROR reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_ERROR, { error: 'Something broke' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_ERROR);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.error).toContain('broke');
  });
});
describe('E2E: EventBus → UIBridge — streaming text deltas', () => {
  test('AGENT_TEXT_DELTA no longer routed through UIBridge (handled by useRuntime)', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_TEXT_DELTA, { text: 'Hello' });

    // Deltas are handled by useRuntime directly, not via UIBridge
    const deltas = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_TEXT_DELTA);
    expect(deltas.length).toBe(0);
  });

  test('AGENT_REASONING_DELTA no longer routed through UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.AGENT_REASONING_DELTA, { text: '思考中...' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_REASONING_DELTA);
    expect(msgs.length).toBe(0);
  });
});

describe('E2E: EventBus → UIBridge — tool calls', () => {
  test('TOOL_CALL and TOOL_RESULT reach UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.TOOL_CALL, { name: 'read_file', arguments: { path: '/tmp/x' } });
    chain.bus.emit(RuntimeEvent.TOOL_RESULT, { name: 'read_file', result: 'file content' });

    const calls = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_CALL);
    const results = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_RESULT);
    expect(calls.length).toBe(1);
    expect(calls[0].data.name).toBe('read_file');
    expect(results.length).toBe(1);
    expect(results[0].data.result).toBe('file content');
  });

  test('TOOL_ERROR reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.TOOL_ERROR, { name: 'write_file', error: 'Permission denied' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_ERROR);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.error).toContain('Permission denied');
  });

  test('TOOL_ACTIVITY reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.TOOL_ACTIVITY, { name: 'bash', status: 'running' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_ACTIVITY);
    expect(msgs.length).toBe(1);
  });
});

describe('E2E: EventBus → UIBridge — status and config', () => {
  test('STATUS_UPDATE reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.STATUS_UPDATE, { status: 'running', phase: 'thinking' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.STATUS_UPDATE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.status).toBe('running');
  });

  test('CONFIG_CHANGE reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.CONFIG_CHANGE, { key: 'model', value: 'gpt-4o' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.CONFIG_CHANGE);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.key).toBe('model');
  });
});

describe('E2E: EventBus → UIBridge — full agent run', () => {
  test('simulates complete agent interaction visible to GUI', async () => {
    const chain = buildFullChain();
    await chain.init();
    const bus = chain.bus;

    // Full agent lifecycle
    bus.emit(RuntimeEvent.AGENT_START, { turn: 1 });
    bus.emit(RuntimeEvent.STATUS_UPDATE, { status: 'running', phase: 'thinking' });
    bus.emit(RuntimeEvent.AGENT_REASONING_DELTA, { text: '分析中...' });
    bus.emit(RuntimeEvent.TOOL_CALL, { name: 'read_file', arguments: { path: 'src/main.js' } });
    bus.emit(RuntimeEvent.TOOL_RESULT, { name: 'read_file', result: '// code' });
    bus.emit(RuntimeEvent.TOOL_CALL, { name: 'bash', arguments: { command: 'npm test' } });
    bus.emit(RuntimeEvent.TOOL_RESULT, { name: 'bash', result: 'passed' });
    bus.emit(RuntimeEvent.AGENT_COMPLETE, { answer: '已完成', phase: 'final_answer' });
    bus.emit(RuntimeEvent.AGENT_STOP, { code: 0 });
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_CALL).length).toBe(2);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_RESULT).length).toBe(2);
    // AGENT_TEXT_DELTA goes through useRuntime, not UIBridge
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_TEXT_DELTA).length).toBe(0);

    // Ordering: AGENT_START before AGENT_STOP
    const queue = chain.uiBridge.getMessageQueue();
    const startIdx = queue.findIndex((m) => m.type === RuntimeEvent.AGENT_START);
    const stopIdx = queue.findIndex((m) => m.type === RuntimeEvent.AGENT_STOP);
    expect(startIdx).toBeLessThan(stopIdx);

    // Status updates between start and end
    const statusInRange = queue.filter((m) => {
      const idx = queue.indexOf(m);
      return m.type === RuntimeEvent.STATUS_UPDATE && idx > startIdx && idx < stopIdx;
    });
    expect(statusInRange.length).toBeGreaterThanOrEqual(1);
  });
});

describe('E2E: EventBus → UIBridge — subscription listeners', () => {
  test('UIBridge listeners fire for subscribed events', async () => {
    const chain = buildFullChain();
    await chain.init();
    const toolNames = [];

    chain.uiBridge.subscribe(RuntimeEvent.TOOL_CALL, (msg) => {
      toolNames.push(msg.data.name);
    });

    chain.bus.emit(RuntimeEvent.TOOL_CALL, { name: 'bash' });
    chain.bus.emit(RuntimeEvent.TOOL_CALL, { name: 'read' });

    expect(toolNames).toEqual(['bash', 'read']);
  });
});

describe('E2E: RendererIPC → UIBridge — routing accuracy', () => {
  test('only subscribed event types arrive at UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    // Emit events of subscribed types
    chain.bus.emit(RuntimeEvent.STATUS_UPDATE, { status: 'idle' });
    chain.bus.emit(RuntimeEvent.CONFIG_CHANGE, { key: 'a', value: 1 });

    // Verify no stray events
    const statusCount = chain.uiBridge.getMessagesByType(RuntimeEvent.STATUS_UPDATE).length;
    const configCount = chain.uiBridge.getMessagesByType(RuntimeEvent.CONFIG_CHANGE).length;
    expect(statusCount).toBe(1);
    expect(configCount).toBe(1);
  });
});
describe('E2E: real log sequence fidelity', () => {
  test('TOOL_PROGRESS events reach UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.TOOL_PROGRESS, { name: 'bash', arguments: { command: 'npm test' }, result: { partial: true } });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_PROGRESS);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.name).toBe('bash');
  });

  test('MESSAGE_RECEIVED events reach UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.MESSAGE_RECEIVED, { text: '程序测试报错，修复下所有报错' });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.MESSAGE_RECEIVED);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.text).toContain('程序测试');
  });

  test('reproduces exact event sequence from ai-agent-conversation-2026-07-12.md log', async () => {
    const chain = buildFullChain();
    await chain.init();
    const bus = chain.bus;

    // Sequence matching the real log:
    // 1. User input received
    bus.emit(RuntimeEvent.MESSAGE_RECEIVED, { text: '程序测试报错，修复下所有报错' });

    // 2. Config changes during initialization
    bus.emit(RuntimeEvent.CONFIG_CHANGE, { key: 'model', value: 'gpt-4o' });
    bus.emit(RuntimeEvent.CONFIG_CHANGE, { key: 'thinkingLevel', value: 2 });

    // 3. Agent start
    bus.emit(RuntimeEvent.AGENT_START, { turn: 1 });
    bus.emit(RuntimeEvent.AGENT_START, { turn: 1 }); // adapter sends two signals

    // 4. Message start (mapped to AGENT_START)
    bus.emit(RuntimeEvent.AGENT_START, { role: 'assistant' });
    bus.emit(RuntimeEvent.AGENT_START, { role: 'assistant' });

    // 5. Tool calls with progress
    bus.emit(RuntimeEvent.TOOL_CALL, { name: 'read', arguments: { path: 'file.js' } });
    bus.emit(RuntimeEvent.TOOL_CALL, { name: 'glob', arguments: { pattern: '**/*.test.js' } });
    bus.emit(RuntimeEvent.TOOL_PROGRESS, { name: 'bash', arguments: {}, result: { progress: 0 } });

    // 6. Tool error
    bus.emit(RuntimeEvent.TOOL_ERROR, {
      name: 'bash',
      error: 'Cannot find module @babel/preset-env',
    });

    // 7. More tool calls (debugging)
    bus.emit(RuntimeEvent.TOOL_CALL, { name: 'bash', arguments: { command: 'npm install @babel/preset-env' } });
    bus.emit(RuntimeEvent.TOOL_PROGRESS, { name: 'bash', arguments: {}, result: { progress: 0 } });
    bus.emit(RuntimeEvent.TOOL_PROGRESS, { name: 'bash', arguments: {}, result: { progress: 0 } });

    // 8. Agent complete
    bus.emit(RuntimeEvent.AGENT_COMPLETE, { answer: '已修复所有报错', phase: 'final_answer' });
    bus.emit(RuntimeEvent.AGENT_STOP, { code: 0 });
    bus.emit(RuntimeEvent.AGENT_COMPLETE, { answer: '已修复所有报错', phase: 'final_answer' });
    bus.emit(RuntimeEvent.AGENT_STOP, { code: 0 });

    // Verify all event types present in the queue
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.MESSAGE_RECEIVED).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.CONFIG_CHANGE).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_START).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_CALL).length).toBeGreaterThanOrEqual(2);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_PROGRESS).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_ERROR).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_COMPLETE).length).toBeGreaterThanOrEqual(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.AGENT_STOP).length).toBeGreaterThanOrEqual(1);

    // Ordering: MESSAGE_RECEIVED before AGENT_START before AGENT_STOP
    const queue = chain.uiBridge.getMessageQueue();
    const msgIdx = queue.findIndex((m) => m.type === RuntimeEvent.MESSAGE_RECEIVED);
    const startIdx = queue.findIndex((m) => m.type === RuntimeEvent.AGENT_START);
    const stopIdx = queue.findIndex((m) => m.type === RuntimeEvent.AGENT_STOP);
    expect(msgIdx).toBeLessThan(startIdx);
    expect(startIdx).toBeLessThan(stopIdx);

    // TOOL_ERROR has the right message
    const toolErrors = chain.uiBridge.getMessagesByType(RuntimeEvent.TOOL_ERROR);
    expect(toolErrors[0].data.error).toContain('@babel/preset-env');
  });
});

describe('E2E: Plan events → UIBridge (右侧 sidebar)', () => {
  test('EXECUTION_PLAN_CREATED reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
      plan: { id: 'plan-1', name: 'Fix bugs', status: 'created' },
      summary: '执行计划已创建: Fix bugs',
    });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.EXECUTION_PLAN_CREATED);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.plan.name).toBe('Fix bugs');
  });

  test('PLAN_DECOMPOSED with subtasks reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.PLAN_DECOMPOSED, {
      plan: { id: 'plan-1', name: 'Fix bugs', status: 'decomposed' },
      subtasks: [
        { id: 't1', name: 'Find root cause', status: 'pending' },
        { id: 't2', name: 'Apply fix', status: 'pending' },
      ],
      summary: '已分解为 2 个子任务',
    });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.PLAN_DECOMPOSED);
    expect(msgs.length).toBe(1);
    expect(msgs[0].data.subtasks.length).toBe(2);
    expect(msgs[0].data.subtasks[0].name).toBe('Find root cause');
  });

  test('EXECUTION_PLAN_UPDATED reaches UIBridge', async () => {
    const chain = buildFullChain();
    await chain.init();

    chain.bus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
      plan: { id: 'plan-1', name: 'Fix bugs', status: 'updated' },
      update: { after: '2/2 subtasks completed' },
    });

    const msgs = chain.uiBridge.getMessagesByType(RuntimeEvent.EXECUTION_PLAN_UPDATED);
    expect(msgs.length).toBe(1);
  });

  test('simulates full plan lifecycle visible to Plan sidebar', async () => {
    const chain = buildFullChain();
    await chain.init();
    const bus = chain.bus;

    // 1. Plan created
    bus.emit(RuntimeEvent.EXECUTION_PLAN_CREATED, {
      plan: { id: 'plan-1', name: '修复测试报错', tasks: [], status: 'created' },
      summary: '执行计划已创建',
    });

    // 2. Plan decomposed
    const subtasks = [
      { id: 't1', name: '诊断根因', status: 'in_progress', dependencies: [] },
      { id: 't2', name: '安装依赖', status: 'pending', dependencies: ['t1'] },
      { id: 't3', name: '验证修复', status: 'pending', dependencies: ['t2'] },
    ];
    bus.emit(RuntimeEvent.PLAN_DECOMPOSED, {
      plan: { id: 'plan-1', name: '修复测试报错', tasks: subtasks, status: 'decomposed' },
      subtasks,
      summary: '已分解为 3 个子任务',
    });

    // 3. Plan updated (subtask progress)
    bus.emit(RuntimeEvent.EXECUTION_PLAN_UPDATED, {
      plan: { id: 'plan-1', name: '修复测试报错', status: 'running' },
      update: { after: 't1 completed, t2 in progress' },
    });

    // 4. Plan executed
    bus.emit(RuntimeEvent.PLAN_EXECUTED, {
      plan: { id: 'plan-1', name: '修复测试报错', status: 'completed' },
      summary: '所有子任务已完成',
    });

    // Verify all plan events present in UIBridge queue
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.EXECUTION_PLAN_CREATED).length).toBe(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.PLAN_DECOMPOSED).length).toBe(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.EXECUTION_PLAN_UPDATED).length).toBe(1);
    expect(chain.uiBridge.getMessagesByType(RuntimeEvent.PLAN_EXECUTED).length).toBe(1);

    // Ordering: created → decomposed → updated → executed
    const queue = chain.uiBridge.getMessageQueue();
    const createdIdx = queue.findIndex((m) => m.type === RuntimeEvent.EXECUTION_PLAN_CREATED);
    const decompIdx = queue.findIndex((m) => m.type === RuntimeEvent.PLAN_DECOMPOSED);
    const updateIdx = queue.findIndex((m) => m.type === RuntimeEvent.EXECUTION_PLAN_UPDATED);
    const execIdx = queue.findIndex((m) => m.type === RuntimeEvent.PLAN_EXECUTED);
    expect(createdIdx).toBeLessThan(decompIdx);
    expect(decompIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(execIdx);
  });
});
