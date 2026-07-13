/**
 * Runtime Hook
 * 提供 Agent Runtime 的状态管理和操作方法
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

/**
 * 过滤掉内部控制 JSON 块（工具协议文本不应作为用户可见内容展示）
 *
 * 支持过滤：
 *   1. <action>...</action> 标签
 *   2. XML/DSML 工具调用标签
 *   3. 代码块中的 JSON/tool 工具调用
 *   4. 裸 ReAct JSON：{"action": {...}} / {"evaluation_previous_goal": ...} / {"next_goal": ...}
 *
 * @param {string} text - 原始文本
 * @returns {string} 过滤后的文本
 */
export function stripActionBlocks(text = '') {
  if (typeof text !== 'string') {
    return text;
  }

  let out = text
    // 1) <action> 标签包裹的工具调用
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    // 2) XML / DSML 工具协议
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+tool_calls\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+tool_calls\s*>/gi,
      '',
    )
    .replace(/<[|｜]+\s*DSML\s*[|｜]+invoke\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+invoke\s*>/gi, '')
    .replace(
      /<[|｜]+\s*DSML\s*[|｜]+parameter\b[^>]*>[\s\S]*?<[|｜]+\s*DSML\s*[|｜]+parameter\s*>/gi,
      '',
    )
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, '')
    .replace(/<function=[^>]+>[\s\S]*?<\/function>/gi, '')
    .replace(/<function\b[^>]*>[\s\S]*?<\/function>/gi, '')
    .replace(/<tool=[^>]+>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool\b[^>]*>[\s\S]*?<\/tool>/gi, '')
    .replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '')
    .replace(/<output\b[^>]*>\s*<\/output>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
    .replace(/<arguments>[\s\S]*?<\/arguments>/gi, '')
    .replace(/<args\b[^>]*>[\s\S]*?<\/args>/gi, '')
    // 3) ```json / ```tool / ``` 代码块中的工具 JSON
    .replace(/```(?:json|tool)?\s*\{[\s\S]*?\}\s*```/gi, '');

  out = out
    .split('\n')
    .filter((line) => !/^\s*CALL\s+[A-Za-z_][\w.-]*\s*\(/.test(line))
    .join('\n');

  // 4) 裸 ReAct JSON（完整匹配）：{"action": ...} 或含 evaluation_previous_goal / next_goal / memory 的对象
  const trimmed = out.trim();
  if (
    trimmed.startsWith('{') &&
    (trimmed.endsWith('}') || trimmed.endsWith('}\n')) &&
    /"action"\s*:|"evaluation_previous_goal"\s*:|"next_goal"\s*:|"memory"\s*:/.test(trimmed)
  ) {
    return '';
  }

  return out.trimEnd();
}

/**
 * 判断一段累积的流式文本是否看起来像是工具协议的开头。
 * 用于流式 buffer 判断是否应该延迟显示。
 */
function looksLikeProtocolStart(text) {
  const t = text.trim();
  if (!t.startsWith('{')) {
    return false;
  }
  // 检查前 200 字符内是否有协议特征字段
  const head = t.slice(0, Math.min(t.length, 200));
  return (
    /"action"\s*:/.test(head) ||
    /"evaluation_previous_goal"\s*:/.test(head) ||
    /"next_goal"\s*:/.test(head) ||
    /"memory"\s*:/.test(head)
  );
}

function getPlanMessageKey(message = {}) {
  return (
    message.planKey ||
    message.plan?.id ||
    message.planId ||
    message.payload?.planId ||
    message.payload?.plan?.id ||
    null
  );
}

function isSyntheticPlanMessageKey(key) {
  return typeof key === 'string' && key.startsWith('plan_synthetic_');
}

function findLatestPlanMessageIndex(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === 'user') {
      break;
    }
    if (messages[index]?.type === 'plan') {
      return index;
    }
  }
  return -1;
}

function createPlanSnapshot(message = {}) {
  return {
    id: `plan_snapshot_${message.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event: message.event,
    content: message.content,
    timestamp: message.timestamp || Date.now(),
    plan: message.plan || {},
    planTasks: Array.isArray(message.planTasks) ? message.planTasks : [],
    planProgress: message.planProgress || {},
    planSummary: message.planSummary || '',
    planUpdate: message.planUpdate || null,
    toolName: message.toolName,
  };
}

export function mergePlanMessageList(prevMessages, incomingMessage) {
  const timestamp = incomingMessage.timestamp || Date.now();
  const incoming = {
    ...incomingMessage,
    timestamp,
  };
  const incomingPlanKey = getPlanMessageKey(incoming);
  let existingIndex = incomingPlanKey
    ? prevMessages.findIndex(
        (msg) => msg.type === 'plan' && getPlanMessageKey(msg) === incomingPlanKey,
      )
    : -1;

  if (existingIndex < 0) {
    const latestIndex = findLatestPlanMessageIndex(prevMessages);
    if (latestIndex >= 0) {
      const latestPlanKey = getPlanMessageKey(prevMessages[latestIndex]);
      if (!incomingPlanKey || !latestPlanKey || isSyntheticPlanMessageKey(latestPlanKey)) {
        existingIndex = latestIndex;
      }
    }
  }

  if (existingIndex < 0) {
    const planKey =
      incomingPlanKey || `plan_synthetic_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
    const firstSnapshot = createPlanSnapshot({ ...incoming, planKey });
    return [
      ...prevMessages,
      {
        ...incoming,
        id: incoming.id || `msg_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
        planKey,
        planSnapshots: [firstSnapshot],
      },
    ];
  }

  const existing = prevMessages[existingIndex];
  const existingPlanKey = getPlanMessageKey(existing);
  const planKey =
    incomingPlanKey && (!existingPlanKey || isSyntheticPlanMessageKey(existingPlanKey))
      ? incomingPlanKey
      : existingPlanKey || incomingPlanKey || `plan_synthetic_${existing.timestamp || timestamp}`;
  const snapshot = createPlanSnapshot({ ...incoming, planKey });
  const updated = {
    ...existing,
    ...incoming,
    id: existing.id,
    timestamp: existing.timestamp,
    planKey,
    planId: incoming.planId || existing.planId,
    planSnapshots: [...(existing.planSnapshots || [createPlanSnapshot(existing)]), snapshot],
  };
  const next = [...prevMessages];
  next[existingIndex] = updated;
  return next;
}

/**
 * Runtime Hook
 * 管理 Agent 的状态、消息、工具等
 * @returns {Object} Runtime 状态和方法
 */
export function useRuntime() {
  // 状态
  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [askUserInfo, setAskUserInfo] = useState(null);
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [stats, setStats] = useState({
    messageCount: 0,
    toolCalls: 0,
    startTime: null,
    endTime: null,
  });

  // 引用
  const messageBufferRef = useRef([]);
  const statsRef = useRef(stats);
  const lastAnswerRef = useRef('');
  const completedByEventRef = useRef(false);
  const streamingMessageIdRef = useRef(null); // 追踪当前流式文本消息
  const streamingTextRef = useRef(''); // 同步记录当前 assistant 文本，避免最终结果重复入列
  const streamingReasoningIdRef = useRef(null); // 追踪当前 reasoning 消息
  const recentRuntimeEventSignaturesRef = useRef(new Map());
  const pendingMessageDeltasRef = useRef(new Map());
  const pendingMessageDeltaTimerRef = useRef(null);
  /**
   * 当 tool:result 比 tool:call 先到达 React commit 时，暂存结果数据。
   * Map<toolName, { result, exitCode, duration, isError }>
   */
  const pendingToolResultsRef = useRef(new Map());
  // 连续重复 delta 去重：OMP 有时会发送重复的 text_delta
  const lastDeltaTextRef = useRef('');
  const lastReasoningDeltaRef = useRef('');

  const flushMessageDeltas = useCallback(() => {
    if (pendingMessageDeltaTimerRef.current) {
      clearTimeout(pendingMessageDeltaTimerRef.current);
      pendingMessageDeltaTimerRef.current = null;
    }

    if (pendingMessageDeltasRef.current.size === 0) {
      return;
    }

    const pending = pendingMessageDeltasRef.current;
    pendingMessageDeltasRef.current = new Map();

    setMessages((prev) =>
      prev.map((msg) => {
        const delta = pending.get(msg.id);
        if (!delta) {
          return msg;
        }
        return {
          ...msg,
          type: delta.type || msg.type,
          content: (msg.content || '') + delta.text,
          ...(delta.toolName ? { toolName: delta.toolName } : {}),
        };
      }),
    );
  }, []);

  const queueMessageDelta = useCallback(
    (messageId, textToAppend, updates = {}) => {
      if (!messageId || !textToAppend) {
        return;
      }

      // 过滤掉内部控制 JSON 块
      const filteredText = stripActionBlocks(textToAppend);
      if (!filteredText) {
        return;
      }

      if (messageId === streamingMessageIdRef.current) {
        streamingTextRef.current += filteredText;
      }

      const existing = pendingMessageDeltasRef.current.get(messageId) || { text: '' };
      pendingMessageDeltasRef.current.set(messageId, {
        ...existing,
        ...updates,
        text: existing.text + filteredText,
      });

      if (!pendingMessageDeltaTimerRef.current) {
        pendingMessageDeltaTimerRef.current = setTimeout(flushMessageDeltas, 32);
      }
    },
    [flushMessageDeltas],
  );

  const isDuplicateRuntimeEvent = useCallback((eventName, payload = {}) => {
    if (!['tool:call', 'tool:result', 'tool:error'].includes(eventName)) {
      return false;
    }

    const activityId = payload?.activity?.id || payload?.id || '';
    const signature = [
      eventName,
      activityId,
      payload?.toolName || payload?.name || '',
      safeStringify(payload?.args || payload?.arguments || '', { maxChars: 500 }),
      safeStringify(payload?.result || payload?.error || '', { maxChars: 500 }),
    ].join('|');
    const now = Date.now();
    const recent = recentRuntimeEventSignaturesRef.current;

    for (const [key, timestamp] of recent.entries()) {
      if (now - timestamp > 1500) {
        recent.delete(key);
      }
    }

    if (recent.has(signature)) {
      return true;
    }
    recent.set(signature, now);
    return false;
  }, []);

  // 添加消息
  const addMessage = useCallback((message) => {
    if (!message || typeof message !== 'object') {
      return null;
    }

    // 检查是否有暂存的 tool:result 待合并（处理 tool:result 先于 tool:call commit 问题）
    let mergedMessage = { ...message };
    if (message.type === 'tool' && message.toolName) {
      const pendingKey = message.toolCallId || message.toolName;
      const pending = pendingToolResultsRef.current.get(pendingKey);
      if (pending) {
        mergedMessage = {
          ...mergedMessage,
          result: pending.result,
          toolResult: true,
          exitCode: pending.exitCode,
          duration: pending.duration,
          isError: pending.isError,
          error: pending.error,
          completedAt: pending.completedAt,
        };
        pendingToolResultsRef.current.delete(pendingKey);
      }
    }

    const newMessage = {
      ...mergedMessage,
      timestamp: mergedMessage.timestamp || Date.now(),
      id: mergedMessage.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    // 更新消息缓冲
    messageBufferRef.current = [...messageBufferRef.current, newMessage];

    // 更新状态
    setMessages((prev) => [...prev, newMessage]);

    // 更新统计
    setStats((prev) => ({
      ...prev,
      messageCount: prev.messageCount + 1,
    }));

    return newMessage;
  }, []);

  // 清空消息
  const clearMessages = useCallback(() => {
    pendingMessageDeltasRef.current = new Map();
    if (pendingMessageDeltaTimerRef.current) {
      clearTimeout(pendingMessageDeltaTimerRef.current);
      pendingMessageDeltaTimerRef.current = null;
    }
    recentRuntimeEventSignaturesRef.current = new Map();
    messageBufferRef.current = [];
    setMessages([]);
    setStats((prev) => ({
      ...prev,
      messageCount: 0,
    }));
  }, []);

  const restoreMessages = useCallback((nextMessages = []) => {
    pendingMessageDeltasRef.current = new Map();
    if (pendingMessageDeltaTimerRef.current) {
      clearTimeout(pendingMessageDeltaTimerRef.current);
      pendingMessageDeltaTimerRef.current = null;
    }
    recentRuntimeEventSignaturesRef.current = new Map();

    // 清理历史会话中的重复消息：合并 tool_result 到前一个 tool 消息
    // （旧版本 race condition 导致 tool + tool_result 两条消息）
    const deduplicated = [];
    if (Array.isArray(nextMessages)) {
      for (const msg of nextMessages) {
        if (msg.type === 'tool_result' && deduplicated.length > 0) {
          const prev = deduplicated[deduplicated.length - 1];
          if (prev.type === 'tool' && prev.toolName === msg.toolName) {
            prev.result = msg.result || msg.content;
            prev.toolResult = true;
            prev.exitCode = msg.exitCode ?? null;
            prev.duration = msg.duration ?? null;
            prev.isError = msg.isError ?? false;
            continue;
          }
        }
        deduplicated.push({ ...msg });
      }
    }

    const restoredMessages = deduplicated.map((message) => ({
      ...message,
      timestamp: message.timestamp || Date.now(),
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }));

    messageBufferRef.current = restoredMessages;
    setMessages(restoredMessages);
    setStatus(restoredMessages.length > 0 ? 'completed' : 'idle');
    setStats((prev) => ({
      ...prev,
      messageCount: restoredMessages.length,
      endTime: restoredMessages.length > 0 ? Date.now() : prev.endTime,
    }));

    const lastResult = [...restoredMessages]
      .reverse()
      .find((message) => ['result', 'success'].includes(message.type));
    lastAnswerRef.current = lastResult?.content || '';
  }, []);

  // 加载工具列表
  const loadTools = useCallback(async () => {
    setLoading(true);

    try {
      // 通过 IPC 获取工具列表
      if (typeof window !== 'undefined' && window != null && window.electronAPI) {
        const toolList = await window.electronAPI.getTools();
        setTools(toolList || []);
      } else {
        // 如果没有 electronAPI，使用模拟数据
        setTools(getMockTools());
      }
    } catch (error) {
      console.error('[useRuntime] 加载工具失败:', error);
      addMessage({
        type: 'error',
        content: `加载工具失败: ${error.message}`,
      });
    } finally {
      setLoading(false);
    }
  }, [addMessage]);

  // 刷新状态
  const refreshState = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window != null && window.electronAPI) {
        const state = await window.electronAPI.getState();
        setRuntimeInfo(state);
        setStatus(state.status || 'idle');
        if (state.pendingInteraction) {
          setAskUserInfo({
            ...state.pendingInteraction,
            requestId: state.pendingInteraction.id,
            message: state.pendingInteraction.message || state.pendingInteraction.placeholder || state.pendingInteraction.title,
            suggestions: state.pendingInteraction.options || [],
          });
          setStatus('needs_user_input');
        }
        setStats((prev) => ({
          ...prev,
          ...state.stats,
        }));
      }
    } catch (error) {
      console.error('[useRuntime] 刷新状态失败:', error);
    }
  }, []);

  // 追加到指定消息内容（流式增量）
  const appendToMessage = useCallback(
    (messageId, textToAppend, newType) => {
      if (!textToAppend) {
        return;
      }
      queueMessageDelta(messageId, textToAppend, newType ? { type: newType } : {});
    },
    [queueMessageDelta],
  );

  // 处理用户输入
  const processInput = useCallback(
    async (input, options = {}) => {
      if (!input) {
        addMessage({
          type: 'warning',
          content: '请输入任务描述',
        });
        return;
      }

      if (options?.continuation) {
        if (typeof window !== 'undefined' && window != null && window.electronAPI) {
          return await window.electronAPI.processInput(input, options);
        }
        return {
          success: false,
          status: 'error',
          error: 'Continuation requires electronAPI',
          continuation: true,
        };
      }

      // 设置运行状态
      setStatus('running');
      setStats((prev) => ({
        ...prev,
        startTime: Date.now(),
        endTime: null,
      }));

      // 重置流式消息追踪
      completedByEventRef.current = false;
      recentRuntimeEventSignaturesRef.current = new Map();
      streamingMessageIdRef.current = null;
      streamingTextRef.current = '';
      streamingReasoningIdRef.current = null;

      // 添加用户输入消息
      lastAnswerRef.current = '';
      addMessage({
        type: 'user',
        content: input,
      });

      try {
        // 创建一个"占位"流式消息（收到第一个增量时会显示）
        const now = Date.now();
        const placeholderId = `msg_stream_${now}_${Math.random().toString(36).substr(2, 9)}`;
        streamingMessageIdRef.current = placeholderId;
        streamingTextRef.current = '';
        setMessages((prev) => [
          ...prev,
          {
            id: placeholderId,
            type: 'assistant_stream',
            content: '',
            timestamp: now,
            isStreaming: true,
          },
        ]);

        // 通过 IPC 发送输入
        if (typeof window !== 'undefined' && window != null && window.electronAPI) {
          const result = await window.electronAPI.processInput(input, options);

          // suspend/resume 模式：processInput 立即返回 { status: 'running', mode: 'async' }
          // agent 在后台执行，通过 event bus (IPC 事件) 驱动 UI 更新
          // agent:complete 事件由 useEffect 中的 IPC 订阅者处理
          if (result && result.mode === 'async') {
            return result;
          }

          // 兼容旧模式：同步返回完整结果（非编码任务、无 ask_user 等快速场景）
          const answer = extractAgentAnswer(result);
          const needsUserInput = result?.status === 'needs_user_input';
          const shouldAddFinalAnswer = answer && answer !== lastAnswerRef.current;

          // 收口流式消息：优先复用同一个气泡，避免"生成中 + 最终结果"重复出现
          const streamMsgId = streamingMessageIdRef.current;
          const eventAlreadyHandled = completedByEventRef.current;
          const answerUnchanged = answer && answer === lastAnswerRef.current;

          if (streamMsgId) {
            flushMessageDeltas();
            const streamedText = streamingTextRef.current.trim();
            const finalText = answer || streamedText;
            setMessages((prev) => {
              if (!finalText) {
                return prev.filter((msg) => msg.id !== streamMsgId);
              }
              return prev.map((msg) =>
                msg.id === streamMsgId
                  ? {
                      ...msg,
                      type: needsUserInput ? 'warning' : 'agent',
                      content: finalText,
                      isStreaming: false,
                      streamComplete: true,
                      ...(result && typeof result === 'object' ? { resultMeta: result } : {}),
                    }
                  : msg,
              );
            });
            streamingMessageIdRef.current = null;
            streamingTextRef.current = '';
          }

          if (answer) {
            lastAnswerRef.current = answer;
          }

          if (!streamMsgId && !eventAlreadyHandled && shouldAddFinalAnswer) {
            addMessage({
              type: needsUserInput ? 'warning' : 'result',
              content: answer,
              ...result,
            });
          } else if (!answer && !streamMsgId && !eventAlreadyHandled) {
            addMessage({
              type: needsUserInput ? 'warning' : 'success',
              content: needsUserInput ? '需要你补充信息后继续' : '执行完成',
              ...result,
            });
          }

          setStatus(needsUserInput ? 'needs_user_input' : 'completed');
          if (needsUserInput) {
            setAskUserInfo(
              result?.userInputRequest
                ? {
                    message: result.answer || result.userInputRequest.answer || '',
                    answer: result.answer || result.userInputRequest.answer || '',
                    reason: result.userInputRequest.reason || '',
                    questions: result.userInputRequest.questions || [],
                    blockingFacts: result.userInputRequest.blockingFacts || [],
                    suggestions: result.userInputRequest.suggestions || [],
                  }
                : { message: result.answer || '需要你的回答', answer: '' },
            );
          }
          setStats((prev) => ({
            ...prev,
            endTime: Date.now(),
          }));

          return result;
        } else {
          // 模拟执行
          await simulateExecution(input, addMessage, setStatus, setStats);
        }
      } catch (error) {
        console.error('[useRuntime] 执行失败:', error);

        // 清理流式标记
        const streamMsgId = streamingMessageIdRef.current;
        if (streamMsgId) {
          flushMessageDeltas();
          setMessages((prev) =>
            prev.map((msg) => (msg.id === streamMsgId ? { ...msg, isStreaming: false } : msg)),
          );
          streamingMessageIdRef.current = null;
          streamingTextRef.current = '';
        }

        addMessage({
          type: 'error',
          content: `执行失败: ${error.message}`,
        });

        setStatus('error');
        setStats((prev) => ({
          ...prev,
          endTime: Date.now(),
        }));

        throw error;
      }
    },
    [addMessage, appendToMessage, flushMessageDeltas],
  );

  // 停止执行
  const stop = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window != null && window.electronAPI) {
        await window.electronAPI.stop();
      }

      setStatus('idle');
      setStats((prev) => ({
        ...prev,
        endTime: Date.now(),
      }));

      addMessage({
        type: 'warning',
        content: '执行已停止',
      });
    } catch (error) {
      console.error('[useRuntime] 停止失败:', error);
      addMessage({
        type: 'error',
        content: `停止失败: ${error.message}`,
      });
    }
  }, [addMessage]);

  // 订阅 IPC 事件
  useEffect(() => {
    if (!(typeof window !== 'undefined' && window != null && window.electronAPI)) {
      return;
    }

    // ===== 切断当前流式消息（让下一个 delta 创建新的消息气泡）=====
    const cutoffStream = (messageIdRef, newType) => {
      const msgId = messageIdRef.current;
      if (!msgId) {
        return null;
      }

      // flush 已有增量
      if (pendingMessageDeltasRef.current.size > 0) {
        const pending = pendingMessageDeltasRef.current;
        pendingMessageDeltasRef.current = new Map();
        setMessages((prev) =>
          prev.map((msg) => {
            const delta = pending.get(msg.id);
            if (!delta) {
              return msg;
            }
            return {
              ...msg,
              type: delta.type || msg.type,
              content: (msg.content || '') + delta.text,
              ...(delta.toolName ? { toolName: delta.toolName } : {}),
            };
          }),
        );
      }

      const isTextStream = messageIdRef === streamingMessageIdRef;
      const streamText = isTextStream ? streamingTextRef.current : '';
      const hasContent = streamText?.trim()?.length > 0;

      if (hasContent) {
        // 有内容：关闭 isStreaming 标记，并更新类型（如从 assistant_stream -> agent）
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== msgId) {
              return msg;
            }
            return {
              ...msg,
              isStreaming: false,
              ...(newType ? { type: newType } : {}),
            };
          }),
        );
      } else {
        // 空内容：直接删除这条消息，避免出现空的 Agent 气泡
        setMessages((prev) => prev.filter((msg) => msg.id !== msgId));
      }

      // 清空 ID，下一个 delta 将创建新消息
      messageIdRef.current = null;
      if (isTextStream) {
        const closed = {
          id: msgId,
          text: streamText,
          hasContent,
        };
        streamingTextRef.current = '';
        return closed;
      }
      return { id: msgId, text: '', hasContent: false };
    };

    // 订阅通用 IPC 事件
    const unsubIpcEvent = window.electronAPI.on('ipc:event', (data) => {
      // IPCMessage shape: { id, type, payload, timestamp, status, correlationId, metadata }
      const eventName =
        data?.metadata?.eventName || data?.payload?.event || data?.payload?.name || 'ipc:event';
      const payload = data?.payload ?? data;

      // ===== 1) 切断事件：在处理这些事件前先关闭当前流 =====
      const isCutoffEvent =
        eventName === 'tool:call' ||
        eventName === 'tool:result' ||
        eventName === 'tool:error' ||
        eventName === 'agent:complete' ||
        eventName === 'agent:stop' ||
        eventName === 'agent:error' ||
        eventName === 'agent:thinking' ||
        eventName === 'agent:stream_reset';

      let closedTextStream = null;
      if (isCutoffEvent) {
        closedTextStream = cutoffStream(streamingMessageIdRef, 'agent');
        cutoffStream(streamingReasoningIdRef, 'thinking');
      }

      // ===== stream_reset：工具调用确认后，删除已被误显示的协议文本气泡 =====
      if (eventName === 'agent:stream_reset' && streamingMessageIdRef.current) {
        const msgId = streamingMessageIdRef.current;
        flushMessageDeltas();
        setMessages((prev) => prev.filter((msg) => msg.id !== msgId));
        streamingMessageIdRef.current = null;
        streamingTextRef.current = '';
        return;
      }

      // ===== 2) 流式增量事件（打字机效果）=====
      if (eventName === 'agent:text_delta') {
        const msgId = streamingMessageIdRef.current;
        if (completedByEventRef.current && !msgId) {
          return;
        }
        if (payload?.text) {
          // 过滤掉内部控制 JSON 块
          const filteredText = stripActionBlocks(payload.text);
          if (!filteredText) {
            return;
          }

          // 连续重复 delta 去重：跳过与上一次完全相同的文本
          if (filteredText === lastDeltaTextRef.current) {
            return;
          }
          lastDeltaTextRef.current = filteredText;

          if (!msgId) {
            // 当前没有活跃的流消息 → 创建新的消息气泡
            const now = Date.now();
            const newId = `msg_stream_${now}_${Math.random().toString(36).substr(2, 9)}`;
            streamingMessageIdRef.current = newId;
            streamingTextRef.current = filteredText;
            setMessages((prev) => [
              ...prev,
              {
                id: newId,
                type: 'assistant_stream',
                content: filteredText,
                timestamp: now,
                isStreaming: true,
              },
            ]);
          } else {
            queueMessageDelta(msgId, filteredText, { type: 'assistant_stream' });
          }
        }
        return;
      }
      if (eventName === 'agent:reasoning_delta') {
        const reasonId = streamingReasoningIdRef.current;
        if (payload?.text) {
          const filteredText = stripActionBlocks(payload.text);
          if (!filteredText) return;

          if (filteredText === lastReasoningDeltaRef.current) return;
          lastReasoningDeltaRef.current = filteredText;

          if (!reasonId) {
            const now = Date.now();
            const newId = `msg_reason_${now}_${Math.random().toString(36).substr(2, 9)}`;
            streamingReasoningIdRef.current = newId;
            setMessages((prev) => [
              ...prev,
              {
                id: newId,
                type: 'thinking',
                content: filteredText,
                timestamp: now,
                isStreaming: true,
              },
            ]);
          } else {
            queueMessageDelta(reasonId, filteredText, { type: 'thinking' });
          }
        }
        return;
      }
      if (eventName === 'agent:tool_call_delta') {
        // Tool-call deltas are partial protocol frames. The formal tool:call event
        // renders the visible card, so showing deltas here creates duplicate tools.
        return;
      }

      if (eventName === 'agent:interaction_request') {
        setAskUserInfo({
          ...payload,
          requestId: payload?.requestId || payload?.id,
          message: payload?.message || payload?.placeholder || payload?.title || '需要你的回答',
          suggestions: payload?.options || payload?.suggestions || [],
        });
        setStatus('needs_user_input');
        return;
      }

      if (eventName === 'agent:interaction_cancel') {
        setAskUserInfo((current) => {
          const cancelledId = payload?.requestId || payload?.targetId;
          return !cancelledId || current?.requestId === cancelledId ? null : current;
        });
        setStatus('running');
        return;
      }

      const normalized = normalizeRuntimeEventMessage(eventName, payload);
      if (isDuplicateRuntimeEvent(eventName, payload)) {
        return;
      }
      if (normalized.stats?.toolCall) {
        setStats((prev) => ({
          ...prev,
          toolCalls: prev.toolCalls + 1,
        }));
      }

      // status:update 事件不依赖 normalized.message，必须放在守卫外
      if (eventName === 'status:update' && typeof payload?.status === 'string') {
        setStatus(payload.status);
        if (payload.status === 'needs_user_input') {
          // 无论 payload.data 是否存在，都设置 askUserInfo 以展开浮动胶囊
          setAskUserInfo(payload.data || { message: '需要你的回答', answer: '' });
        }
        if (payload.status === 'running') {
          setAskUserInfo(null);
        }
      }

      if (normalized.message) {
        if (eventName === 'agent:start') {
          setStatus('running');
        } else if (eventName === 'agent:error') {
          setStatus('error');
        } else if (eventName === 'agent:stop') {
          setStatus('idle');
        }

        if (eventName === 'agent:complete') {
          const answer = extractAgentAnswer(payload);
          const needsUserInput =
            payload?.result?.status === 'needs_user_input' ||
            payload?.status === 'needs_user_input';
          const completeStatus = needsUserInput ? 'needs_user_input' : 'completed';
          const isTerminalCompletion = isTerminalAgentCompletePayload(payload);
          const markComplete = () => {
            completedByEventRef.current = true;
            setStatus(completeStatus);
            setStats((prev) => ({
              ...prev,
              endTime: Date.now(),
            }));
          };
          const recordAnswerOnly = () => {
            if (!answer || answer === lastAnswerRef.current) {
              return;
            }
            lastAnswerRef.current = answer;
            addMessage({
              type: needsUserInput ? 'warning' : 'result',
              content: answer,
              resultMeta: payload,
            });
          };
          // 场景A：有流式消息 + 有答案 → 原地收口为 agent 消息（不额外添加 result 消息）
          if (answer && closedTextStream?.id) {
            lastAnswerRef.current = answer;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === closedTextStream.id
                  ? {
                      ...msg,
                      type: 'agent',
                      content: answer,
                      isStreaming: false,
                      streamComplete: true,
                    }
                  : msg,
              ),
            );
            if (isTerminalCompletion) {
              markComplete();
            }
            return;
          }
          // 场景B：有流式消息 + 无答案 + 无内容 → 删除空的流式消息
          if (!answer && closedTextStream?.id && !closedTextStream.text?.trim()) {
            setMessages((prev) => prev.filter((msg) => msg.id !== closedTextStream.id));
            if (isTerminalCompletion) {
              markComplete();
            }
            return;
          }
          // 场景C：重复答案 → 忽略
          if (answer && answer === lastAnswerRef.current) {
            if (isTerminalCompletion) {
              markComplete();
            }
            return;
          }
          // 场景D：answer-only agent:complete 只是最终答案收口事件，run/processInput 完成事件稍后到达。
          if (!isTerminalCompletion) {
            recordAnswerOnly();
            return;
          }
          // 场景E：terminal completion（通常来自 processInput/runPromise result）才设置 completed。
          if (answer) {
            lastAnswerRef.current = answer;
            addMessage({
              type: needsUserInput ? 'warning' : 'result',
              content: answer,
              resultMeta: payload,
            });
          }
          markComplete();
        }

        // status:update 事件仅更新状态，不添加消息（避免与 agent:complete/processInput 的 result 消息重复）
        if (eventName === 'status:update') {
          if (normalized.message?.event === 'agent:complete') {
            const answer = normalized.message.content || extractAgentAnswer(payload);
            if (answer && answer !== lastAnswerRef.current) {
              lastAnswerRef.current = answer;
              addMessage({
                type: normalized.message.type || 'result',
                content: answer,
                resultMeta: payload,
              });
              completedByEventRef.current = true;
              setStats((prev) => ({
                ...prev,
                endTime: Date.now(),
              }));
            }
          }
          return;
        }

        // plan 事件：合并为一个动态 plan 消息，并保留每次更新的历史快照
        if (
          eventName === 'plan:created' ||
          eventName === 'plan:decomposed' ||
          eventName === 'plan:updated'
        ) {
          setMessages((prev) => mergePlanMessageList(prev, normalized.message));
          return;
        }

        // OMP tool lifecycle → 按 toolCallId 合并成一个视觉单元。
        if (['tool:result', 'tool:error', 'tool:progress'].includes(eventName)) {
          if (normalized.message) {
            const resultMsg = normalized.message;
            setMessages((prev) => {
              const idx = findLastToolCall(prev, resultMsg.toolName, resultMsg.toolCallId);
              if (idx === -1) {
                if (eventName !== 'tool:progress') {
                  const pendingKey = resultMsg.toolCallId || resultMsg.toolName;
                  pendingToolResultsRef.current.set(pendingKey, {
                    result: resultMsg.result || resultMsg.content,
                    error: resultMsg.error,
                    exitCode: resultMsg.exitCode ?? payload?.exitCode ?? null,
                    duration: payload?.duration ?? resultMsg.duration ?? null,
                    isError: eventName === 'tool:error' || resultMsg.isError === true,
                    completedAt: resultMsg.timestamp || Date.now(),
                  });
                }
                return prev;
              }
              const updated = [...prev];
              updated[idx] = mergeToolLifecycleMessage(updated[idx], resultMsg, eventName, payload);
              return updated;
            });
          }
          return;
        }

        addMessage(normalized.message);
      }
    });

    // 清理订阅
    return () => {
      flushMessageDeltas();
      unsubIpcEvent?.();
    };
  }, [addMessage, flushMessageDeltas, isDuplicateRuntimeEvent, queueMessageDelta]);

  const dismissAskUser = useCallback(() => {
    setAskUserInfo(null);
  }, []);

  const respondToInteraction = useCallback(async (value, extra = {}) => {
    const requestId = askUserInfo?.requestId;
    if (!requestId) return false;
    await window.electronAPI.invoke('agent:respondInteraction', {
      requestId,
      response: askUserInfo.method === 'confirm'
        ? { confirmed: extra.confirmed ?? /^(y|yes|是|确认|同意)$/i.test(String(value).trim()) }
        : { value, ...extra },
    });
    setAskUserInfo(null);
    setStatus('running');
    return true;
  }, [askUserInfo]);

  const cancelInteraction = useCallback(async () => {
    const requestId = askUserInfo?.requestId;
    if (!requestId || !window.electronAPI) return false;
    await window.electronAPI.invoke('agent:respondInteraction', {
      requestId,
      response: { cancelled: true },
    });
    setAskUserInfo(null);
    setStatus('running');
    return true;
  }, [askUserInfo]);

  const getAvailableModels = useCallback(async () => {
    if (!window.electronAPI) return [];
    const result = await window.electronAPI.invoke('omp:getAvailableModels');
    return Array.isArray(result) ? result : (result?.models || []);
  }, []);

  const setModel = useCallback(async (provider, modelId) => {
    if (!window.electronAPI || !modelId) return false;
    await window.electronAPI.invoke('omp:setModel', { provider, modelId });
    await refreshState();
    return true;
  }, [refreshState]);

  const setThinkingLevel = useCallback(async (level) => {
    if (!window.electronAPI || !level) return false;
    await window.electronAPI.invoke('omp:setThinkingLevel', { level });
    await refreshState();
    return true;
  }, [refreshState]);

  return {
    // 状态
    status,
    messages,
    tools,
    loading,
    stats,
    askUserInfo,
    runtimeInfo,

    // 方法
    addMessage,
    clearMessages,
    restoreMessages,
    loadTools,
    refreshState,
    processInput,
    stop,
    dismissAskUser,
    respondToInteraction,
    cancelInteraction,
    getAvailableModels,
    setModel,
    setThinkingLevel,
  };
}

export function normalizeRuntimeEventMessage(eventName, payload = {}) {
  const payloadSummary = safeStringify(payload, { maxChars: 500 });
  const base = {
    raw: payload,
    details: safeStringify(payload, { space: 2, maxChars: 20000 }),
    event: eventName,
    payload,
    payloadSummary,
    eventMessage: true,
  };

  switch (eventName) {
    case 'agent:start':
      return {
        message: {
          ...base,
          type: 'agent',
          content: `任务开始${payload?.task ? `: ${payload.task}` : ''}`,
        },
      };
    case 'agent:complete': {
      const answer = extractAgentAnswer(payload);
      const needsUserInput =
        payload?.result?.status === 'needs_user_input' || payload?.status === 'needs_user_input';
      return {
        message: {
          ...base,
          type: needsUserInput ? 'warning' : answer ? 'result' : 'success',
          runtimeDetail: true,
          content: answer || (needsUserInput ? '需要你补充信息后继续' : '任务执行完成'),
        },
      };
    }
    case 'agent:error':
      return {
        message: {
          ...base,
          type: 'error',
          runtimeDetail: true,
          content: `运行错误: ${payload?.error || payload?.message || '未知错误'}`,
        },
      };
    case 'agent:stop':
      return {
        message: {
          ...base,
          type: 'warning',
          runtimeDetail: true,
          content: '任务已停止',
        },
      };
    case 'tool:call':
      return {
        stats: { toolCall: true },
        message: {
          ...base,
          type: 'tool',
          content:
            payload?.activity?.statusText ||
            `调用工具: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          toolCallId: payload?.toolCallId || payload?.id,
          args: payload?.args || payload?.arguments,
          activity: payload?.activity,
          startedAt: payload?.timestamp || Date.now(),
          depth: 0,
          collapsible: true,
          collapsed: false,
        },
      };
    case 'tool:result':
      return {
        message: {
          ...base,
          type: 'tool_result',
          content:
            payload?.activity?.statusText ||
            `工具结果: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          toolCallId: payload?.toolCallId || payload?.id,
          args: payload?.args || payload?.arguments,
          result: payload?.result,
          activity: payload?.activity,
          completedAt: payload?.timestamp || Date.now(),
          depth: 1,
          parentType: 'tool',
          collapsible: false,
        },
      };
    case 'tool:error':
      return {
        message: {
          ...base,
          type: 'error',
          content:
            payload?.activity?.statusText ||
            `工具错误: ${payload?.toolName || payload?.name || 'unknown'} ${payload?.error || ''}`.trim(),
          toolName: payload?.toolName || payload?.name,
          toolCallId: payload?.toolCallId || payload?.id,
          args: payload?.args || payload?.arguments,
          activity: payload?.activity,
          error: payload?.error || payload?.message,
          isError: true,
          completedAt: payload?.timestamp || Date.now(),
          depth: 1,
          parentType: 'tool',
          collapsible: false,
        },
      };
    case 'tool:activity':
      return {
        message: {
          ...base,
          type: 'event',
          runtimeDetail: true,
          content: payload?.statusText || payload?.title || '工具活动更新',
          toolName: payload?.toolName,
          activity: payload,
        },
      };
    case 'tool:progress':
      return {
        message: {
          ...base,
          type: 'event',
          runtimeDetail: true,
          content: payload?.statusText || `进度: ${payload?.progress ?? 0}%`,
          toolName: payload?.toolName || payload?.name,
          toolCallId: payload?.toolCallId || payload?.id,
          activity: {
            kind: 'tool_activity',
            id: payload?.id || `progress:${payload?.toolName}`,
            phase: 'running',
            intent: 'tool',
            toolName: payload?.toolName || payload?.name,
            progress: payload?.progress,
            statusText: payload?.statusText || `进度: ${payload?.progress ?? 0}%`,
            target: payload?.target,
            detail: payload?.detail,
            timestamp: Date.now(),
          },
          depth: 2,
          parentType: 'tool_result',
          collapsible: false,
        },
      };
    case 'plan:created':
    case 'plan:decomposed':
    case 'plan:updated': {
      const plan = payload?.plan || payload;
      const planId = payload?.planId || plan?.id || payload?.plan?.id;
      const tasks = normalizePlanTasks(plan?.tasks);
      const completed = tasks.filter((task) => task.displayStatus === 'completed').length;
      const running = tasks.filter((task) => task.displayStatus === 'running').length;
      const failed = tasks.filter((task) => task.displayStatus === 'failed').length;
      const needsRepair = tasks.filter((task) => task.displayStatus === 'needs_repair').length;
      const total = tasks.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      return {
        message: {
          ...base,
          type: 'plan',
          content:
            eventName === 'plan:created'
              ? '执行计划已创建'
              : eventName === 'plan:decomposed'
                ? '计划已分解为子任务'
                : '执行计划已更新',
          plan,
          planId,
          planKey: planId || payload?.runId || null,
          planTasks: tasks,
          planSummary: payload?.summary || payload?.update?.after || '',
          planUpdate: payload?.update || null,
          planProgress: { total, completed, running, failed, needsRepair, progress },
          toolName: payload?.toolName,
        },
      };
    }
    case 'agent:stream':
      return {
        message: {
          ...base,
          type: 'agent',
          runtimeDetail: true,
          content: payload?.chunk || payload?.text || '',
          streamId: payload?.streamId,
          isStream: true,
        },
      };
    case 'agent:thinking': {
      const thinkingText = payload?.text || payload?.reasoning || payload?.content || '';
      const summary = payload?.summary || createThinkingSummary(thinkingText);
      return {
        message: {
          ...base,
          type: 'thinking',
          runtimeDetail: true,
          content: summary || '正在分析上下文',
          thinkingText,
          summary,
          details: payload?.details || [],
          iteration: payload?.iteration,
          maxIterations: payload?.maxIterations,
          finishReason: payload?.finishReason,
        },
      };
    }
    case 'status:update':
      if (typeof payload?.answer === 'string' && payload.answer.trim()) {
        return {
          message: {
            ...base,
            event: 'agent:complete',
            type: 'result',
            runtimeDetail: true,
            content: payload.answer,
          },
        };
      }
      return {
        message: {
          ...base,
          type: payload?.level || 'info',
          content: payload?.message || '状态更新',
        },
      };
    case 'workspace:changed':
      return {
        message: null,
      };
    default:
      return {
        message: {
          ...base,
          type: 'event',
          content: `事件: ${eventName}`,
        },
      };
  }
}

/**
 * 在消息列表中查找最后一个与指定工具名匹配的 tool 消息。
 * 用于 tool:result 合并到 tool:call。
 */
function findLastToolCall(messages, toolName, toolCallId) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const idMatches = toolCallId && msg.toolCallId === toolCallId;
    const fallbackMatches = !toolCallId && msg.toolName === toolName && !msg.toolResult;
    if (msg.type === 'tool' && (idMatches || fallbackMatches)) {
      return i;
    }
  }
  return -1;
}

export function mergeToolLifecycleMessage(toolMessage, lifecycleMessage, eventName, payload = {}) {
  const completedAt = lifecycleMessage.completedAt || lifecycleMessage.timestamp || Date.now();
  const startedAt = toolMessage.startedAt || toolMessage.timestamp || completedAt;
  const duration = payload?.duration ?? lifecycleMessage.duration ?? Math.max(0, completedAt - startedAt);

  if (eventName === 'tool:progress') {
    return {
      ...toolMessage,
      progress: lifecycleMessage.activity?.progress ?? payload?.progress,
      progressText: lifecycleMessage.activity?.statusText || lifecycleMessage.content,
      partialResult: payload?.result,
      phase: 'running',
      statusText: lifecycleMessage.activity?.statusText || lifecycleMessage.content,
      activity: { ...toolMessage.activity, ...lifecycleMessage.activity, phase: 'running' },
    };
  }

  const isError = eventName === 'tool:error' || lifecycleMessage.isError === true;
  return {
    ...toolMessage,
    result: lifecycleMessage.result || lifecycleMessage.error || lifecycleMessage.content,
    error: isError ? (lifecycleMessage.error || lifecycleMessage.content) : null,
    toolResult: true,
    exitCode: lifecycleMessage.exitCode ?? payload?.exitCode ?? (isError ? 1 : 0),
    duration,
    durationMs: duration,
    completedAt,
    isError,
    phase: isError ? 'failed' : 'completed',
    statusText: isError ? '执行失败' : '执行完成',
    progress: 100,
    progressText: isError ? '执行失败' : '执行完成',
    activity: {
      ...toolMessage.activity,
      ...lifecycleMessage.activity,
      phase: isError ? 'failed' : 'completed',
      durationMs: duration,
      error: isError ? (lifecycleMessage.error || lifecycleMessage.content) : null,
    },
  };
}

function normalizePlanTasks(tasks) {
  if (!tasks) {
    return [];
  }
  if (Array.isArray(tasks)) {
    return tasks.map(normalizePlanTask);
  }
  if (tasks && typeof tasks === 'object') {
    return Object.entries(tasks).map(([id, task]) =>
      normalizePlanTask({
        id,
        ...(task && typeof task === 'object' ? task : { name: String(task) }),
      }),
    );
  }
  return [];
}

function normalizePlanTask(task) {
  const status = String(task?.status || 'pending').toLowerCase();
  const displayStatus = String(
    task?.displayStatus || task?.result?.displayStatus || status,
  ).toLowerCase();
  return {
    ...task,
    status,
    displayStatus,
    statusReason: task?.statusReason || task?.result?.statusReason || '',
    cycleLabel: task?.cycleLabel || '',
  };
}

export function safeStringify(value, { space = 0, maxChars = 20000 } = {}) {
  let text;
  try {
    if (typeof value === 'string') {
      text = value;
    } else {
      const seen = new WeakSet();
      text = JSON.stringify(
        value,
        (key, current) => {
          if (typeof current === 'bigint') {
            return current.toString();
          }
          if (typeof current === 'function') {
            return `[Function ${current.name || 'anonymous'}]`;
          }
          if (current && typeof current === 'object') {
            if (seen.has(current)) {
              return '[Circular]';
            }
            seen.add(current);
          }
          return current;
        },
        space,
      );
    }
  } catch (error) {
    text = String(value);
  }

  if (text == null) {
    text = '';
  }

  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}… [truncated ${text.length - maxChars} chars]`;
  }
  return text;
}

export function isTerminalAgentCompletePayload(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (data.terminal === true) {
    return true;
  }
  if (data.terminal === false || data.phase === 'final_answer') {
    return false;
  }
  return Boolean(data.result);
}

function createThinkingSummary(text = '') {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) {
    return '';
  }
  if (clean.length <= 160) {
    return clean;
  }
  return `${clean.slice(0, 157)}...`;
}

function extractAgentAnswer(data) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return stripActionBlocks(data);
  }

  if (typeof data.answer === 'string' && data.answer.trim()) {
    return stripActionBlocks(data.answer);
  }

  if (typeof data.finalAnswer === 'string' && data.finalAnswer.trim()) {
    return stripActionBlocks(data.finalAnswer);
  }

  if (typeof data.content === 'string' && data.content.trim()) {
    return stripActionBlocks(data.content);
  }

  if (typeof data.text === 'string' && data.text.trim()) {
    return stripActionBlocks(data.text);
  }

  if (typeof data.response === 'string' && data.response.trim()) {
    return stripActionBlocks(data.response);
  }

  if (typeof data.message?.content === 'string' && data.message.content.trim()) {
    return stripActionBlocks(data.message.content);
  }

  if (
    typeof data.choices?.[0]?.message?.content === 'string' &&
    data.choices[0].message.content.trim()
  ) {
    return stripActionBlocks(data.choices[0].message.content);
  }

  if (
    typeof data.choices?.[0]?.delta?.content === 'string' &&
    data.choices[0].delta.content.trim()
  ) {
    return stripActionBlocks(data.choices[0].delta.content);
  }

  if (data.localCommand && typeof data.content === 'string' && data.content.trim()) {
    return stripActionBlocks(data.content);
  }

  if (typeof data.result === 'string' && data.result.trim()) {
    return stripActionBlocks(data.result);
  }

  if (typeof data.result?.answer === 'string' && data.result.answer.trim()) {
    return stripActionBlocks(data.result.answer);
  }

  if (typeof data.result?.finalAnswer === 'string' && data.result.finalAnswer.trim()) {
    return stripActionBlocks(data.result.finalAnswer);
  }

  if (typeof data.result?.response === 'string' && data.result.response.trim()) {
    return stripActionBlocks(data.result.response);
  }

  if (typeof data.result?.text === 'string' && data.result.text.trim()) {
    return stripActionBlocks(data.result.text);
  }

  return '';
}

/**
 * 获取模拟工具列表
 * @returns {Array} 模拟工具列表
 */
function getMockTools() {
  return [
    {
      name: 'read_file',
      description: '读取文件内容',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', description: '文件路径' },
      },
      required: ['path'],
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
    {
      name: 'execute_shell',
      description: '执行 Shell 命令',
      category: 'shell',
      parameters: {
        command: { type: 'string', description: 'Shell 命令' },
      },
      required: ['command'],
    },
    {
      name: 'brainstorm',
      description: '头脑风暴工具',
      category: 'skills',
      parameters: {
        topic: { type: 'string', description: '主题' },
      },
      required: ['topic'],
    },
    {
      name: 'git_status',
      description: '查看 Git 状态',
      category: 'git',
      parameters: {},
      required: [],
    },
  ];
}

/**
 * 模拟执行过程
 * @param {string} input - 用户输入
 * @param {Function} addMessage - 添加消息函数
 * @param {Function} setStatus - 设置状态函数
 * @param {Function} setStats - 设置统计函数
 */
async function simulateExecution(input, addMessage, setStatus, setStats) {
  // 模拟思考过程
  addMessage({
    type: 'info',
    content: '正在分析任务...',
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 模拟工具调用
  addMessage({
    type: 'tool',
    content: '调用工具: read_file',
    toolName: 'read_file',
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  addMessage({
    type: 'result',
    content: '工具结果: read_file',
    toolName: 'read_file',
    result: '文件内容已读取',
  });

  // 模拟完成
  addMessage({
    type: 'success',
    content: '任务执行完成',
  });

  setStatus('completed');
  setStats((prev) => ({
    ...prev,
    endTime: Date.now(),
    toolCalls: prev.toolCalls + 1,
  }));
}

export default useRuntime;

// ─── Tree Structure Utilities ─────────────────────────────────────────

/**
 * Build a tree structure from a flat messages array.
 * Groups messages by parent-child relationships based on depth/parentType.
 *
 * Tree hierarchy:
 *   depth=0: Agent turn, plan, tool call  ← collapsible root nodes
 *   depth=1: Tool result/error            ← children of tool call
 *   depth=2: Progress updates             ← children of tool result
 *
 * @param {Array} messages - Flat message list
 * @returns {Array} Tree nodes with `children` arrays
 */
export function buildMessageTree(messages) {
  if (!Array.isArray(messages)) return [];

  const tree = [];
  // stack tracks { depth, children } for nesting.
  // Root frame at depth=-1.
  const stack = [{ depth: -1, children: tree }];

  for (const msg of messages) {
    const node = { ...msg, children: [] };
    const depth = msg.depth ?? 0;

    // Pop stack until we find a frame at a shallower depth
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    // Attach to current stack top
    stack[stack.length - 1].children.push(node);

    // Push node as a new frame if it can have children (depth 0 or 1)
    if (depth < 2) {
      stack.push({ depth, children: node.children });
    }
  }

  return tree;
}

/**
 * Get the total count of all nodes in a tree (including children).
 */
export function countTreeNodes(nodes) {
  if (!Array.isArray(nodes)) return 0;
  let count = 0;
  for (const node of nodes) {
    count += 1 + countTreeNodes(node.children || []);
  }
  return count;
}

/**
 * Flatten a tree back to an ordered list (DFS pre-order).
 * Each node gets a `treeDepth` reflecting its nesting level.
 */
export function flattenTree(nodes, options = {}) {
  const { collapsed = new Set() } = options;
  const result = [];

  for (const node of nodes) {
    const treeDepth = node.depth ?? 0;
    result.push({ ...node, treeDepth, children: undefined });

    if (!collapsed.has(node.id) && node.children?.length > 0) {
      result.push(...flattenTree(node.children, { collapsed }));
    }
  }

  return result;
}

/**
 * React hook: manage message tree collapse/expand state.
 *
 * @param {Array} messages - Flat message list
 * @returns {{ tree, collapsed, toggleCollapse, expandAll, collapseAll }}
 */
export function useMessageTree(messages = []) {
  const [collapsed, setCollapsed] = useState(new Set());

  const tree = useMemo(() => buildMessageTree(messages), [messages]);

  const toggleCollapse = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => {
    const allCollapsible = new Set();
    const collect = (nodes) => {
      for (const node of nodes) {
        if (node.collapsible && node.id) allCollapsible.add(node.id);
        if (node.children) collect(node.children);
      }
    };
    collect(tree);
    setCollapsed(allCollapsible);
  }, [tree]);

  // Auto-collapse tool calls when they accumulate
  useEffect(() => {
    const toolCalls = messages.filter((m) => m.type === 'tool' && m.id);
    if (toolCalls.length > 3) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (let i = 0; i < toolCalls.length - 1; i++) {
          next.add(toolCalls[i].id);
        }
        return next;
      });
    }
  }, [messages]);

  const flattened = useMemo(
    () => flattenTree(tree, { collapsed }),
    [tree, collapsed],
  );

  return { tree, flattened, collapsed, toggleCollapse, expandAll, collapseAll };
}
