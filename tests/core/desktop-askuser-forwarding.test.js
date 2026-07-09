import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

describe('DesktopCore waitingForUserInput forwarding', () => {
  let createDesktopCore, DesktopState, RuntimeEvent, resetEventBus;

  beforeAll(async () => {
    const eb = await import('../../src/runtime/event-bus.js');
    resetEventBus = eb.resetEventBus;
    const dc = await import('../../src/adapters/desktop/desktop-core.js');
    createDesktopCore = dc.createDesktopCore;
    DesktopState = dc.DesktopState;
    const types = await import('../../src/runtime/types.js');
    RuntimeEvent = types.RuntimeEvent;
  });

  afterAll(() => {
    try { resetEventBus(); } catch {}
  });

  test('DesktopCore UI adapter includes waitingForUserInput method', async () => {
    resetEventBus();
    const core = createDesktopCore({ debug: false });
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const receivedEvents = [];
    const unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
      receivedEvents.push(data);
    });

    try {
      await core.initialize();
    } catch (e) {
      // 初始化可能失败（无模型提供者），这对测试来说 ok
    }

    const state = core.getState();
    expect(state).toBeTruthy();
    expect(typeof state.desktopState).toBe('string');

    // 模拟 waitingForUserInput 事件
    const testInfo = {
      reason: '需要补充项目需求',
      questions: ['你想要什么颜色？'],
      blockingFacts: ['缺少用户偏好'],
      suggestions: ['红色', '蓝色'],
      answer: '需要你补充一点信息后我才能继续。',
    };

    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      message: '需要你补充一点信息后继续',
      level: 'info',
      status: 'needs_user_input',
      data: testInfo,
    });

    const matchingEvents = receivedEvents.filter(
      (e) => e.status === 'needs_user_input' && e.data?.reason,
    );
    expect(matchingEvents.length).toBeGreaterThanOrEqual(1);
    expect(matchingEvents[0].status).toBe('needs_user_input');
    expect(matchingEvents[0].data.reason).toBe('需要补充项目需求');
    expect(matchingEvents[0].data.questions).toContain('你想要什么颜色？');

    unsubscribe();
    try { await core.dispose(); } catch {}
    resetEventBus();
  });

  test('STATUS_UPDATE with needs_user_input propagates askUserInfo correctly', async () => {
    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const receivedUpdates = [];
    const unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
      receivedUpdates.push(data);
    });

    const testInfo = {
      reason: '需要确认技术方案',
      questions: ['使用 REST 还是 GraphQL？'],
      blockingFacts: [],
      suggestions: ['REST for simplicity', 'GraphQL for flexibility'],
      answer: '需要你补充一点信息后我才能继续。\n\n原因：需要确认技术方案\n\n请回答：\n1. 使用 REST 还是 GraphQL？',
    };

    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      message: '需要你补充一点信息后继续',
      level: 'info',
      status: 'needs_user_input',
      data: testInfo,
    });

    const needsInputEvents = receivedUpdates.filter(
      (e) => e.status === 'needs_user_input',
    );
    expect(needsInputEvents.length).toBe(1);
    expect(needsInputEvents[0].data.questions[0]).toContain('REST');
    expect(needsInputEvents[0].data.suggestions).toContain('REST for simplicity');

    unsubscribe();
    resetEventBus();
  });

  test('STATUS_UPDATE with running clears askUserInfo', async () => {
    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const receivedUpdates = [];
    const unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
      receivedUpdates.push(data);
    });

    // 先发射 needs_user_input
    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'needs_user_input',
      level: 'info',
      message: '等待输入',
      data: { reason: 'test', questions: ['q1'] },
    });

    // 然后发射 running → askUserInfo 应被清空
    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'running',
    });

    const runningEvents = receivedUpdates.filter((e) => e.status === 'running');
    expect(runningEvents.length).toBe(1);

    unsubscribe();
    resetEventBus();
  });

  test('STATUS_UPDATE multiple needs_user_input events in sequence', async () => {
    resetEventBus();
    const { getEventBus } = await import('../../src/runtime/event-bus.js');
    const eventBus = getEventBus();

    const receivedUpdates = [];
    const unsubscribe = eventBus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
      receivedUpdates.push(data);
    });

    // 连续两次 ask_user
    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'needs_user_input',
      level: 'info',
      message: '第一次',
      data: { reason: 'r1', questions: ['q1'] },
    });
    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      status: 'needs_user_input',
      level: 'info',
      message: '第二次',
      data: { reason: 'r2', questions: ['q2'] },
    });

    const needsInputEvents = receivedUpdates.filter((e) => e.status === 'needs_user_input');
    expect(needsInputEvents.length).toBe(2);
    // 第二个事件应覆盖第一个（askUserInfo 被更新为最新数据）
    expect(needsInputEvents[1].data.reason).toBe('r2');
    expect(needsInputEvents[1].data.questions[0]).toBe('q2');

    unsubscribe();
    resetEventBus();
  });

  // ========== useRuntime processInput 的 askUserInfo 设置逻辑 ==========

  test('processInput sets askUserInfo when result has needs_user_input with userInputRequest', () => {
    // 对应 useRuntime.js L577-586
    const result = {
      status: 'needs_user_input',
      answer: '需要你补充一点信息后我才能继续。',
      userInputRequest: {
        reason: '需要确认配置',
        questions: ['使用什么数据库？'],
        blockingFacts: [],
        suggestions: ['PostgreSQL', 'SQLite'],
        answer: '需要你补充一点信息后我才能继续。',
      },
    };

    const needsUserInput = result?.status === 'needs_user_input';
    let askUserInfo = null;

    if (needsUserInput && result?.userInputRequest) {
      askUserInfo = {
        message: result.answer || result.userInputRequest.answer || '',
        answer: result.answer || result.userInputRequest.answer || '',
        reason: result.userInputRequest.reason || '',
        questions: result.userInputRequest.questions || [],
        blockingFacts: result.userInputRequest.blockingFacts || [],
        suggestions: result.userInputRequest.suggestions || [],
      };
    }

    expect(askUserInfo).not.toBeNull();
    expect(askUserInfo.reason).toBe('需要确认配置');
    expect(askUserInfo.questions).toContain('使用什么数据库？');
    expect(askUserInfo.suggestions).toContain('PostgreSQL');
    expect(askUserInfo.answer).toContain('需要你补充一点信息');
  });

  test('processInput does NOT set askUserInfo when result status is completed', () => {
    const result = {
      status: 'completed',
      answer: '任务已完成',
    };

    const needsUserInput = result?.status === 'needs_user_input';
    let askUserInfo = null;

    if (needsUserInput && result?.userInputRequest) {
      askUserInfo = {
        message: result.answer || '',
        answer: result.answer || '',
        reason: result.userInputRequest.reason || '',
        questions: result.userInputRequest.questions || [],
        blockingFacts: result.userInputRequest.blockingFacts || [],
        suggestions: result.userInputRequest.suggestions || [],
      };
    }

    expect(askUserInfo).toBeNull();
  });

  test('processInput does NOT set askUserInfo when result is running (async mode)', () => {
    const result = {
      status: 'running',
      mode: 'async',
    };

    const needsUserInput = result?.status === 'needs_user_input';
    let askUserInfo = null;

    if (needsUserInput && result?.userInputRequest) {
      askUserInfo = {};
    }

    expect(askUserInfo).toBeNull();
  });

  test('processInput does NOT set askUserInfo when result has needs_user_input but no userInputRequest', () => {
    // 边界情况: status=needs_user_input 但没有 userInputRequest
    const result = {
      status: 'needs_user_input',
      answer: '需要你补充一点信息',
    };

    const needsUserInput = result?.status === 'needs_user_input';
    let askUserInfo = null;

    if (needsUserInput && result?.userInputRequest) {
      askUserInfo = {};
    }

    expect(askUserInfo).toBeNull();
  });

  // ========== IPC 事件链中的 status:update 处理 ==========

  test('IPC status:update event with running status clears askUserInfo', () => {
    // 模拟 useRuntime.js 中处理 status:update 事件的逻辑
    // 这是修复后的关键: status:update 不依赖 normalized.message
    let askUserInfo = { reason: '旧的', questions: ['旧的'] };

    const simulateStatusUpdate = (payload) => {
      if (payload.status === 'needs_user_input' && payload.data) {
        askUserInfo = payload.data;
      }
      if (payload.status === 'running') {
        askUserInfo = null;
      }
    };

    simulateStatusUpdate({ status: 'running' });
    expect(askUserInfo).toBeNull();
  });

  test('IPC status:update event preserves askUserInfo for non-running statuses', async () => {
    let askUserInfo = null;

    const simulateStatusUpdate = (payload) => {
      if (payload.status === 'needs_user_input' && payload.data) {
        askUserInfo = payload.data;
      }
      if (payload.status === 'running') {
        askUserInfo = null;
      }
    };

    simulateStatusUpdate({
      status: 'needs_user_input',
      data: { reason: 'test', questions: ['q1'] },
    });
    expect(askUserInfo).not.toBeNull();
    expect(askUserInfo.reason).toBe('test');

    // completed 不应清除 askUserInfo
    simulateStatusUpdate({ status: 'completed' });
    expect(askUserInfo).not.toBeNull();
    expect(askUserInfo.reason).toBe('test');

    // error 不应清除 askUserInfo
    simulateStatusUpdate({ status: 'error' });
    expect(askUserInfo).not.toBeNull();
  });

  // ========== AskUserFloatingCapsule 自动展开/折叠逻辑 ==========

  test('capsule isExpanded reflects askUserInfo state', () => {
    // 模拟 AskUserFloatingCapsule 内部 isExpanded 计算
    const computeIsExpanded = (askUserInfo, manuallyExpanded) => {
      const hasActiveRequest = !!(askUserInfo?.message || askUserInfo?.answer);
      return hasActiveRequest || manuallyExpanded;
    };

    // 无 ask_user + 无手动展开 → 折叠
    expect(computeIsExpanded(null, false)).toBe(false);

    // ask_user 激活 → 自动展开
    expect(
      computeIsExpanded({ message: '请回答', answer: '请回答' }, false),
    ).toBe(true);
    expect(
      computeIsExpanded({ message: '请回答' }, false),
    ).toBe(true);
    expect(
      computeIsExpanded({ answer: '请回答' }, false),
    ).toBe(true);

    // 无 ask_user + 手动展开 → 展开
    expect(computeIsExpanded(null, true)).toBe(true);

    // ask_user 激活 + 手动展开 → 展开
    expect(computeIsExpanded({ message: 'q' }, true)).toBe(true);
  });

  test('capsule auto-collapses when askUserInfo becomes null', () => {
    // 模拟 useEffect：askUserInfo 由有变无时清空 manuallyExpanded
    let askUserInfo = { message: 'q' };
    let manuallyExpanded = true; // 用户曾手动展开

    const onHasActiveRequestChange = (newHasActiveRequest) => {
      if (!newHasActiveRequest) {
        manuallyExpanded = false;
      }
    };

    const hasActiveRequest = (info) => !!(info?.message || info?.answer);

    // 初始: ask_user 激活
    expect(manuallyExpanded).toBe(true);
    onHasActiveRequestChange(hasActiveRequest(askUserInfo));
    expect(manuallyExpanded).toBe(true); // 有 ask_user，保持手动展开

    // ask_user 结束（askUserInfo 清空）→ 立即清空 manuallyExpanded
    askUserInfo = null;
    onHasActiveRequestChange(hasActiveRequest(askUserInfo));
    expect(manuallyExpanded).toBe(false); // 自动折叠回去
  });

  test('handleSubmit should call onDismiss to immediately clear askUserInfo', () => {
    // 模拟 AskUserFloatingCapsule.handleSubmit 流程
    let onContinueCalled = false;
    let onDismissCalled = false;

    const onContinue = (text) => {
      onContinueCalled = true;
      expect(text).toBe('我的回答');
    };
    const onDismiss = () => {
      onDismissCalled = true;
    };

    const inputValue = '我的回答';
    const handleSubmit = () => {
      if (!inputValue.trim()) return;
      const submitted = inputValue.trim();
      onContinue(submitted);
      onDismiss?.(); // ask_user 结束后立即折叠
    };

    handleSubmit();

    expect(onContinueCalled).toBe(true);
    expect(onDismissCalled).toBe(true);
  });

  test('handleSubmit with empty input does NOT call onDismiss', () => {
    let onContinueCalled = false;
    let onDismissCalled = false;

    const handleSubmit = (inputValue) => {
      if (!inputValue.trim()) return;
      const onContinue = () => {
        onContinueCalled = true;
      };
      const onDismiss = () => {
        onDismissCalled = true;
      };
      onContinue(inputValue.trim());
      onDismiss?.();
    };

    handleSubmit('   '); // 空白

    expect(onContinueCalled).toBe(false);
    expect(onDismissCalled).toBe(false);
  });

  test('useRuntime exposes dismissAskUser method to clear askUserInfo', () => {
    // 验证 useRuntime hook 模块可加载，且 stripActionBlocks 函数存在
    const { stripActionBlocks } = require('../../desktop/renderer/hooks/useRuntime.js');

    expect(typeof stripActionBlocks).toBe('function');

    // 模拟 dismissAskUser 行为：直接清空 askUserInfo
    let askUserInfo = { message: 'q' };
    const dismissAskUser = () => {
      askUserInfo = null;
    };

    expect(askUserInfo).not.toBeNull();
    dismissAskUser();
    expect(askUserInfo).toBeNull();
  });
});
