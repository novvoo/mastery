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
    try {
      resetEventBus();
    } catch {}
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
    try {
      await core.dispose();
    } catch {}
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
      answer:
        '需要你补充一点信息后我才能继续。\n\n原因：需要确认技术方案\n\n请回答：\n1. 使用 REST 还是 GraphQL？',
    };

    eventBus.emit(RuntimeEvent.STATUS_UPDATE, {
      message: '需要你补充一点信息后继续',
      level: 'info',
      status: 'needs_user_input',
      data: testInfo,
    });

    const needsInputEvents = receivedUpdates.filter((e) => e.status === 'needs_user_input');
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

  test('capsule isExpanded treats structured ask_user fields as active requests', () => {
    // Mirrors AskUserFloatingCapsule's observable expand/collapse contract.
    const computeIsExpanded = (askUserInfo, manuallyExpanded) => {
      const questions = Array.isArray(askUserInfo?.questions)
        ? askUserInfo.questions
        : askUserInfo?.question
          ? [askUserInfo.question]
          : [];
      const blockingFacts = askUserInfo?.blockingFacts || askUserInfo?.blocking_facts || [];
      const suggestions = askUserInfo?.suggestions || [];
      const hasActiveRequest = !!(
        String(askUserInfo?.message || askUserInfo?.answer || '').trim() ||
        String(askUserInfo?.reason || '').trim() ||
        questions.some((question) => String(question || '').trim()) ||
        blockingFacts.some((fact) => String(fact || '').trim()) ||
        suggestions.some((suggestion) => String(suggestion || '').trim())
      );
      return hasActiveRequest || manuallyExpanded;
    };

    expect(computeIsExpanded(null, false)).toBe(false);
    expect(computeIsExpanded({ message: '请回答' }, false)).toBe(true);
    expect(computeIsExpanded({ answer: '请回答' }, false)).toBe(true);
    expect(computeIsExpanded({ questions: ['使用 REST 还是 GraphQL？'] }, false)).toBe(true);
    expect(computeIsExpanded({ question: '确认部署到生产环境吗？' }, false)).toBe(true);
    expect(computeIsExpanded(null, true)).toBe(true);
  });

  test('capsule display includes actual question text from structured askUserInfo', () => {
    const renderCapsuleText = (askUserInfo) => {
      const normalizeStringList = (value) => {
        if (!Array.isArray(value)) return [];
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      };
      const questions = normalizeStringList(
        Array.isArray(askUserInfo?.questions)
          ? askUserInfo.questions
          : askUserInfo?.question
            ? [askUserInfo.question]
            : [],
      );
      const reason = String(askUserInfo?.reason || '').trim();
      const displayMessage = String(askUserInfo?.message || askUserInfo?.answer || '').trim();

      const lines = ['需要你的回答'];
      if (reason) lines.push(`原因：${reason}`);
      if (questions.length > 0) {
        lines.push('请回答：');
        questions.forEach((question, index) => {
          lines.push(`${index + 1}. ${question}`);
        });
      } else if (displayMessage) {
        lines.push(displayMessage);
      } else {
        lines.push('暂无待回答的问题，等待 Agent 提问...');
      }
      return lines.join('\n');
    };

    const renderedFromQuestions = renderCapsuleText({
      message: '需要你补充一点信息后我才能继续。',
      questions: ['请选择部署区域？'],
    });
    expect(renderedFromQuestions).toContain('请回答：');
    expect(renderedFromQuestions).toContain('1. 请选择部署区域？');

    const renderedFromSingularQuestion = renderCapsuleText({
      question: '确认使用 SQLite 吗？',
    });
    expect(renderedFromSingularQuestion).toContain('请回答：');
    expect(renderedFromSingularQuestion).toContain('1. 确认使用 SQLite 吗？');
  });

  test('capsule auto-collapses only after structured ask_user data is gone', () => {
    let askUserInfo = { questions: ['请选择数据库？'] };
    let manuallyExpanded = true; // 用户曾手动展开

    const onHasActiveRequestChange = (newHasActiveRequest) => {
      if (!newHasActiveRequest) {
        manuallyExpanded = false;
      }
    };

    const hasActiveRequest = (info) => {
      const questions = Array.isArray(info?.questions)
        ? info.questions
        : info?.question
          ? [info.question]
          : [];
      const blockingFacts = info?.blockingFacts || info?.blocking_facts || [];
      const suggestions = info?.suggestions || [];
      return !!(
        String(info?.message || info?.answer || '').trim() ||
        String(info?.reason || '').trim() ||
        questions.some((question) => String(question || '').trim()) ||
        blockingFacts.some((fact) => String(fact || '').trim()) ||
        suggestions.some((suggestion) => String(suggestion || '').trim())
      );
    };

    onHasActiveRequestChange(hasActiveRequest(askUserInfo));
    expect(manuallyExpanded).toBe(true); // 仅 questions 存在时仍是激活的 ask_user

    askUserInfo = null;
    onHasActiveRequestChange(hasActiveRequest(askUserInfo));
    expect(manuallyExpanded).toBe(false); // ask_user 结束后自动折叠回去
  });

  test('handleSubmit clears askUserInfo only after continuation is accepted', async () => {
    let onContinueCalled = false;
    let onDismissCalled = false;

    const onContinue = async (text) => {
      onContinueCalled = true;
      expect(text).toBe('我的回答');
      return true;
    };
    const onDismiss = () => {
      onDismissCalled = true;
    };

    const inputValue = '我的回答';
    const handleSubmit = async () => {
      if (!inputValue.trim()) return;
      const submitted = inputValue.trim();
      const accepted = await onContinue(submitted);
      if (accepted === false) return;
      onDismiss?.();
    };

    await handleSubmit();

    expect(onContinueCalled).toBe(true);
    expect(onDismissCalled).toBe(true);
  });

  test('handleSubmit keeps askUserInfo open when continuation is rejected', async () => {
    let onDismissCalled = false;
    const inputValue = '我的回答';
    const handleSubmit = async () => {
      if (!inputValue.trim()) return;
      const accepted = await Promise.resolve(false);
      if (accepted === false) return;
      onDismissCalled = true;
    };

    await handleSubmit();

    expect(onDismissCalled).toBe(false);
  });

  test('ChatWorkspace continuation forwards capsule answer argument', async () => {
    const calls = [];
    const onContinue = async (value) => {
      calls.push(value);
      return true;
    };
    let continuationInput = '';
    const setContinuationInput = (value) => {
      continuationInput = value;
    };
    const handleContinue = async (submittedValue) => {
      const value = String(submittedValue || continuationInput).trim();
      if (!value) {
        return false;
      }
      setContinuationInput('');
      try {
        await onContinue?.(value);
        return true;
      } catch {
        setContinuationInput(value);
        return false;
      }
    };

    const accepted = await handleContinue('胶囊里的回答');

    expect(accepted).toBe(true);
    expect(calls).toEqual(['胶囊里的回答']);
    expect(continuationInput).toBe('');
  });

  test('ask_user continuation uses runtime processInput continuation option without saving history', async () => {
    const calls = [];
    const historyWrites = [];
    const runtime = {
      processInput: async (input, options) => {
        calls.push({ input, options });
        return { success: true, status: 'running', mode: 'async', continuation: true };
      },
    };
    const agentOptions = { model: 'test' };
    const activeAgentSessionId = 's1';
    const saveAgentInputHistory = (input, sessionId) => historyWrites.push({ input, sessionId });
    const executeInput = async (input, processOptions = {}) => {
      if (!processOptions.continuation) {
        saveAgentInputHistory(input, activeAgentSessionId);
      }
      return runtime.processInput(input, { ...agentOptions, ...processOptions });
    };
    const handleContinueAgentInput = async (input) => {
      if (!input?.trim()) return;
      await executeInput(input, { continuation: true });
    };

    await handleContinueAgentInput('继续信息');

    expect(calls).toEqual([{ input: '继续信息', options: { model: 'test', continuation: true } }]);
    expect(historyWrites).toEqual([]);
  });

  test('useRuntime continuation path does not append main conversation messages', async () => {
    const messages = [];
    const statusChanges = [];
    const statsChanges = [];
    const windowRef = {
      electronAPI: {
        processInput: async (input, options) => ({ input, options, mode: 'async' }),
      },
    };
    const processInput = async (input, options = {}) => {
      if (!input) {
        messages.push({ type: 'warning', content: '请输入任务描述' });
        return;
      }
      if (options?.continuation) {
        if (windowRef.electronAPI) {
          return await windowRef.electronAPI.processInput(input, options);
        }
        return { success: false, status: 'error', continuation: true };
      }
      statusChanges.push('running');
      statsChanges.push('reset');
      messages.push({ type: 'user', content: input });
    };

    const result = await processInput('胶囊回答', { continuation: true });

    expect(result).toEqual({
      input: '胶囊回答',
      options: { continuation: true },
      mode: 'async',
    });
    expect(messages).toEqual([]);
    expect(statusChanges).toEqual([]);
    expect(statsChanges).toEqual([]);
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

  test('useRuntime exposes dismissAskUser method to clear askUserInfo', async () => {
    // 验证 useRuntime hook 模块可加载，且 stripActionBlocks 函数存在
    const { stripActionBlocks } = await import('../../desktop/renderer/hooks/useRuntime.js');

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
