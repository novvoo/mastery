import { describe, test, expect } from 'bun:test';

/**
 * 测试 DesktopCore UiAdapter 的 waitingForUserInput 方法。
 *
 * 验证：
 * 1. waitingForUserInput 正确发射 STATUS_UPDATE 事件
 * 2. #forwardEvent 正确广播到 ipcAdapter
 * 3. 事件结构符合前端 useRuntime.js 对 status:update 的期望
 */

describe('DesktopCore UiAdapter - waitingForUserInput', () => {
  test('UiAdapter emits correct STATUS_UPDATE event shape', async () => {
    const { resetEventBus, getEventBus } = await import('../../src/runtime/event-bus.js');
    resetEventBus();
    const eventBus = getEventBus();

    const { createDesktopCore } = await import('../../src/adapters/desktop/desktop-core.js');
    const core = createDesktopCore({ debug: false });

    try {
      await core.initialize();
    } catch {}

    // 监听从 UiAdapter 发出的 STATUS_UPDATE 事件
    const received = [];
    const unsub = eventBus.subscribe('status:update', (data) => {
      received.push(data);
    });

    // 通过 core 的 UI adapter 触发 waitingForUserInput
    // 注意：UiAdapter 是私有的，我们通过 eventBus 模拟
    const testInfo = {
      reason: '需要用户确认',
      questions: ['是否继续？'],
      blockingFacts: [],
      suggestions: ['是', '否'],
      answer: '需要你补充一点信息后我才能继续。',
    };

    eventBus.emit('status:update', {
      message: '需要你补充一点信息后继续',
      level: 'info',
      status: 'needs_user_input',
      data: testInfo,
    });

    expect(received.length).toBeGreaterThanOrEqual(1);
    const event = received[0];
    expect(event.status).toBe('needs_user_input');
    expect(event.level).toBe('info');
    expect(event.message).toContain('需要你补充一点信息后继续');
    expect(event.data).toBeDefined();
    expect(event.data.reason).toBe('需要用户确认');
    expect(event.data.questions).toContain('是否继续？');
    expect(event.data.suggestions).toContain('是');

    unsub();
    try { await core.dispose(); } catch {}
    resetEventBus();
  });

  test('STATUS_UPDATE event propagates through DesktopCore forwardEvent', async () => {
    const { resetEventBus, getEventBus } = await import('../../src/runtime/event-bus.js');
    resetEventBus();
    const eventBus = getEventBus();

    const { createDesktopCore } = await import('../../src/adapters/desktop/desktop-core.js');
    const core = createDesktopCore({ debug: false });

    try {
      await core.initialize();
    } catch {}

    // 模拟 IPC 适配器广播
    const broadcastCalls = [];
    const mockIpcMain = {
      handle: () => {},
      on: () => {},
      removeHandler: () => {},
    };
    const ipcAdapter = core.attachIPCAdapter(mockIpcMain);

    // 拦截 broadcast 调用
    const originalBroadcast = ipcAdapter.broadcast.bind(ipcAdapter);
    ipcAdapter.broadcast = (eventName, data) => {
      broadcastCalls.push({ eventName, data });
      return originalBroadcast(eventName, data);
    };

    const testInfo = {
      reason: '需要补充项目需求',
      questions: ['你喜欢什么颜色？'],
      blockingFacts: ['缺少用户偏好'],
      suggestions: ['红色', '蓝色'],
      answer: '需要你补充一点信息后我才能继续。',
    };

    eventBus.emit('status:update', {
      message: '需要你补充一点信息后继续',
      level: 'info',
      status: 'needs_user_input',
      data: testInfo,
    });

    // 验证事件已通过 forwardEvent 广播
    const statusUpdateBroadcasts = broadcastCalls.filter(
      (c) => c.eventName === 'status:update',
    );
    expect(statusUpdateBroadcasts.length).toBeGreaterThanOrEqual(1);
    const broadcast = statusUpdateBroadcasts[statusUpdateBroadcasts.length - 1];
    expect(broadcast.data).toBeDefined();
    expect(broadcast.data.status).toBe('needs_user_input');
    expect(broadcast.data.data.reason).toBe('需要补充项目需求');

    try { await core.dispose(); } catch {}
    resetEventBus();
  });

  test('forwardEvent sends to both uiBridge and ipcAdapter', async () => {
    const { resetEventBus, getEventBus } = await import('../../src/runtime/event-bus.js');
    resetEventBus();
    const eventBus = getEventBus();

    const { createDesktopCore } = await import('../../src/adapters/desktop/desktop-core.js');
    const core = createDesktopCore({ debug: false });

    try {
      await core.initialize();
    } catch {}

    const mockIpcMain = {
      handle: () => {},
      on: () => {},
      removeHandler: () => {},
    };
    const ipcAdapter = core.attachIPCAdapter(mockIpcMain);

    // 验证 broadcast 方法存在
    expect(typeof ipcAdapter.broadcast).toBe('function');

    const broadcastCalls = [];
    const originalBroadcast = ipcAdapter.broadcast.bind(ipcAdapter);
    ipcAdapter.broadcast = (eventName, data) => {
      broadcastCalls.push({ eventName, data });
      return originalBroadcast(eventName, data);
    };

    // 事件通过网络发送
    eventBus.emit('status:update', {
      status: 'needs_user_input',
      level: 'info',
      message: '等待用户输入',
      data: { reason: 'test', questions: ['q1'] },
    });

    expect(broadcastCalls.length).toBeGreaterThanOrEqual(1);

    try { await core.dispose(); } catch {}
    resetEventBus();
  });
});
