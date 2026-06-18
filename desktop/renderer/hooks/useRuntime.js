/**
 * Runtime Hook
 * 提供 Agent Runtime 的状态管理和操作方法
 */

/* global window */

import { useState, useCallback, useEffect, useRef } from 'react';

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
  const [stats, setStats] = useState({
    messageCount: 0,
    toolCalls: 0,
    startTime: null,
    endTime: null
  });
  
  // 引用
  const messageBufferRef = useRef([]);
  const statsRef = useRef(stats);
  const lastAnswerRef = useRef('');
  const completedByEventRef = useRef(false);
  const streamingMessageIdRef = useRef(null);     // 追踪当前流式文本消息
  const streamingTextRef = useRef('');            // 同步记录当前 assistant 文本，避免最终结果重复入列
  const streamingReasoningIdRef = useRef(null);  // 追踪当前 reasoning 消息
  const recentRuntimeEventSignaturesRef = useRef(new Map());
  const pendingMessageDeltasRef = useRef(new Map());
  const pendingMessageDeltaTimerRef = useRef(null);

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

    setMessages(prev => prev.map(msg => {
      const delta = pending.get(msg.id);
      if (!delta) return msg;
      return {
        ...msg,
        type: delta.type || msg.type,
        content: (msg.content || '') + delta.text,
        ...(delta.toolName ? { toolName: delta.toolName } : {}),
      };
    }));
  }, []);

  const queueMessageDelta = useCallback((messageId, textToAppend, updates = {}) => {
    if (!messageId || !textToAppend) return;

    if (messageId === streamingMessageIdRef.current) {
      streamingTextRef.current += textToAppend;
    }

    const existing = pendingMessageDeltasRef.current.get(messageId) || { text: '' };
    pendingMessageDeltasRef.current.set(messageId, {
      ...existing,
      ...updates,
      text: existing.text + textToAppend,
    });

    if (!pendingMessageDeltaTimerRef.current) {
      pendingMessageDeltaTimerRef.current = setTimeout(flushMessageDeltas, 32);
    }
  }, [flushMessageDeltas]);

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
    const newMessage = {
      ...message,
      timestamp: message.timestamp || Date.now(),
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    // 更新消息缓冲
    messageBufferRef.current = [...messageBufferRef.current, newMessage];
    
    // 更新状态
    setMessages(prev => [...prev, newMessage]);
    
    // 更新统计
    setStats(prev => ({
      ...prev,
      messageCount: prev.messageCount + 1
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
    setStats(prev => ({
      ...prev,
      messageCount: 0
    }));
  }, []);

  const restoreMessages = useCallback((nextMessages = []) => {
    pendingMessageDeltasRef.current = new Map();
    if (pendingMessageDeltaTimerRef.current) {
      clearTimeout(pendingMessageDeltaTimerRef.current);
      pendingMessageDeltaTimerRef.current = null;
    }
    recentRuntimeEventSignaturesRef.current = new Map();
    const restoredMessages = Array.isArray(nextMessages)
      ? nextMessages.map((message) => ({
        ...message,
        timestamp: message.timestamp || Date.now(),
        id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }))
      : [];

    messageBufferRef.current = restoredMessages;
    setMessages(restoredMessages);
    setStatus(restoredMessages.length > 0 ? 'completed' : 'idle');
    setStats(prev => ({
      ...prev,
      messageCount: restoredMessages.length,
      endTime: restoredMessages.length > 0 ? Date.now() : prev.endTime
    }));

    const lastResult = [...restoredMessages].reverse().find(message => ['result', 'success'].includes(message.type));
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
        content: `加载工具失败: ${error.message}`
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
        setStatus(state.status || 'idle');
        setStats(prev => ({
          ...prev,
          ...state.stats
        }));
      }
    } catch (error) {
      console.error('[useRuntime] 刷新状态失败:', error);
    }
  }, []);
  
  // 追加到指定消息内容（流式增量）
  const appendToMessage = useCallback((messageId, textToAppend, newType) => {
    if (!textToAppend) return;
    queueMessageDelta(messageId, textToAppend, newType ? { type: newType } : {});
  }, [queueMessageDelta]);

  // 处理用户输入
  const processInput = useCallback(async (input, options = {}) => {
    if (!input) {
      addMessage({
        type: 'warning',
        content: '请输入任务描述'
      });
      return;
    }
    
    // 设置运行状态
    setStatus('running');
    setStats(prev => ({
      ...prev,
      startTime: Date.now(),
      endTime: null
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
      content: input
    });
    
    try {
      // 创建一个"占位"流式消息（收到第一个增量时会显示）
      const now = Date.now();
      const placeholderId = `msg_stream_${now}_${Math.random().toString(36).substr(2, 9)}`;
      streamingMessageIdRef.current = placeholderId;
      streamingTextRef.current = '';
      setMessages(prev => [...prev, {
        id: placeholderId,
        type: 'assistant_stream',
        content: '',
        timestamp: now,
        isStreaming: true,
      }]);
      
      // 通过 IPC 发送输入
      if (typeof window !== 'undefined' && window != null && window.electronAPI) {
        const result = await window.electronAPI.processInput(input, options);
        const answer = extractAgentAnswer(result);
        const needsUserInput = result?.status === 'needs_user_input';
        const shouldAddFinalAnswer = answer && answer !== lastAnswerRef.current;
        
        // 收口流式消息：优先复用同一个气泡，避免“生成中 + 最终结果”重复出现
        // 注意：agent:complete 事件订阅者也可能已经提前收口并设置了 lastAnswerRef
        const streamMsgId = streamingMessageIdRef.current;
        const eventAlreadyHandled = completedByEventRef.current;
        const answerUnchanged = answer && answer === lastAnswerRef.current;

        if (streamMsgId) {
          flushMessageDeltas();
          const streamedText = streamingTextRef.current.trim();
          const finalText = answer || streamedText;
          setMessages(prev => {
            if (!finalText) {
              return prev.filter(msg => msg.id !== streamMsgId);
            }
            return prev.map(msg =>
              msg.id === streamMsgId
                ? {
                  ...msg,
                  type: needsUserInput ? 'warning' : 'agent',
                  content: finalText,
                  isStreaming: false,
                  streamComplete: true,
                  ...(result && typeof result === 'object' ? { resultMeta: result } : {}),
                }
                : msg
            );
          });
          streamingMessageIdRef.current = null;
          streamingTextRef.current = '';
        }

        if (answer) {
          lastAnswerRef.current = answer;
        }

        // 只有当流消息没有被事件订阅者处理过、且答案不是重复值时，才添加新的结果消息
        if (!streamMsgId && !eventAlreadyHandled && shouldAddFinalAnswer) {
          addMessage({
            type: needsUserInput ? 'warning' : 'result',
            content: answer,
            ...result
          });
        } else if (!answer && !streamMsgId && !eventAlreadyHandled) {
          // 需要用户输入时，添加“需要你补充信息后继续”的消息
          addMessage({
            type: needsUserInput ? 'warning' : 'success',
            content: needsUserInput ? '需要你补充信息后继续' : '执行完成',
            ...result
          });
        }
        
        setStatus(needsUserInput ? 'needs_user_input' : 'completed');
        setStats(prev => ({
          ...prev,
          endTime: Date.now()
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
        setMessages(prev => prev.map(msg =>
          msg.id === streamMsgId ? { ...msg, isStreaming: false } : msg
        ));
        streamingMessageIdRef.current = null;
        streamingTextRef.current = '';
      }
      
      addMessage({
        type: 'error',
        content: `执行失败: ${error.message}`
      });
      
      setStatus('error');
      setStats(prev => ({
        ...prev,
        endTime: Date.now()
      }));
      
      throw error;
    }
  }, [addMessage, appendToMessage, flushMessageDeltas]);
  
  // 停止执行
  const stop = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window != null && window.electronAPI) {
        await window.electronAPI.stop();
      }
      
      setStatus('idle');
      setStats(prev => ({
        ...prev,
        endTime: Date.now()
      }));
      
      addMessage({
        type: 'warning',
        content: '执行已停止'
      });
    } catch (error) {
      console.error('[useRuntime] 停止失败:', error);
      addMessage({
        type: 'error',
        content: `停止失败: ${error.message}`
      });
    }
  }, [addMessage]);
  
  // 订阅 IPC 事件
  useEffect(() => {
    if (!(typeof window !== 'undefined' && window != null && window.electronAPI)) return;

    // ===== 切断当前流式消息（让下一个 delta 创建新的消息气泡）=====
    const cutoffStream = (messageIdRef, newType) => {
      const msgId = messageIdRef.current;
      if (!msgId) return null;

      // flush 已有增量
      if (pendingMessageDeltasRef.current.size > 0) {
        const pending = pendingMessageDeltasRef.current;
        pendingMessageDeltasRef.current = new Map();
        setMessages(prev => prev.map(msg => {
          const delta = pending.get(msg.id);
          if (!delta) return msg;
          return {
            ...msg,
            type: delta.type || msg.type,
            content: (msg.content || '') + delta.text,
            ...(delta.toolName ? { toolName: delta.toolName } : {}),
          };
        }));
      }

      const isTextStream = messageIdRef === streamingMessageIdRef;
      const streamText = isTextStream ? streamingTextRef.current : '';
      const hasContent = streamText?.trim()?.length > 0;

      if (hasContent) {
        // 有内容：关闭 isStreaming 标记，并更新类型（如从 assistant_stream -> agent）
        setMessages(prev => prev.map(msg => {
          if (msg.id !== msgId) return msg;
          return {
            ...msg,
            isStreaming: false,
            ...(newType ? { type: newType } : {}),
          };
        }));
      } else {
        // 空内容：直接删除这条消息，避免出现空的 Agent 气泡
        setMessages(prev => prev.filter(msg => msg.id !== msgId));
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
      const eventName = data?.metadata?.eventName || data?.payload?.event || data?.payload?.name || 'ipc:event';
      const payload = data?.payload ?? data;

      // ===== 1) 切断事件：在处理这些事件前先关闭当前流 =====
      const isCutoffEvent = eventName === 'tool:call'
        || eventName === 'tool:result'
        || eventName === 'tool:error'
        || eventName === 'agent:complete'
        || eventName === 'agent:stop'
        || eventName === 'agent:error'
        || eventName === 'agent:thinking';

      let closedTextStream = null;
      if (isCutoffEvent) {
        closedTextStream = cutoffStream(streamingMessageIdRef, 'agent');
        cutoffStream(streamingReasoningIdRef, 'thinking');
      }

      // ===== 2) 流式增量事件（打字机效果）=====
      if (eventName === 'agent:text_delta') {
        const msgId = streamingMessageIdRef.current;
        if (payload?.text) {
          if (!msgId) {
            // 当前没有活跃的流消息 → 创建新的消息气泡
            const now = Date.now();
            const newId = `msg_stream_${now}_${Math.random().toString(36).substr(2, 9)}`;
            streamingMessageIdRef.current = newId;
            streamingTextRef.current = payload.text;
            setMessages(prev => [...prev, {
              id: newId,
              type: 'assistant_stream',
              content: payload.text,
              timestamp: now,
              isStreaming: true,
            }]);
          } else {
            queueMessageDelta(msgId, payload.text, { type: 'assistant_stream' });
          }
        }
        return;
      }
      if (eventName === 'agent:reasoning_delta') {
        const reasonId = streamingReasoningIdRef.current;
        if (payload?.text) {
          if (!reasonId) {
            const now = Date.now();
            const newId = `msg_reason_${now}_${Math.random().toString(36).substr(2, 9)}`;
            streamingReasoningIdRef.current = newId;
            setMessages(prev => [...prev, {
              id: newId,
              type: 'thinking',
              content: payload.text,
              timestamp: now,
              isStreaming: true,
            }]);
          } else {
            queueMessageDelta(reasonId, payload.text);
          }
        }
        return;
      }
      if (eventName === 'agent:tool_call_delta') {
        // Tool-call deltas are partial protocol frames. The formal tool:call event
        // renders the visible card, so showing deltas here creates duplicate tools.
        return;
      }

      const normalized = normalizeRuntimeEventMessage(eventName, payload);
      if (isDuplicateRuntimeEvent(eventName, payload)) {
        return;
      }
      if (normalized.stats?.toolCall) {
        setStats(prev => ({
          ...prev,
          toolCalls: prev.toolCalls + 1
        }));
      }
      if (normalized.message) {
        if (eventName === 'agent:start') {
          setStatus('running');
        } else if (eventName === 'agent:complete') {
          setStatus(payload?.result?.status === 'needs_user_input' ? 'needs_user_input' : 'completed');
        } else if (eventName === 'agent:error') {
          setStatus('error');
        } else if (eventName === 'agent:stop') {
          setStatus('idle');
        } else if (eventName === 'status:update' && typeof payload?.status === 'string') {
          setStatus(payload.status);
        }

        if (eventName === 'agent:complete') {
          const answer = extractAgentAnswer(payload);
          // 场景A：有流式消息 + 有答案 → 原地收口为 agent 消息（不额外添加 result 消息）
          if (answer && closedTextStream?.id) {
            completedByEventRef.current = true;
            lastAnswerRef.current = answer;
            setMessages(prev => prev.map(msg =>
              msg.id === closedTextStream.id
                ? {
                  ...msg,
                  type: 'agent',
                  content: answer,
                  isStreaming: false,
                  streamComplete: true,
                }
                : msg
            ));
            return;
          }
          // 场景B：有流式消息 + 无答案 + 无内容 → 删除空的流式消息
          if (!answer && closedTextStream?.id && !closedTextStream.text?.trim()) {
            setMessages(prev => prev.filter(msg => msg.id !== closedTextStream.id));
            return;
          }
          // 场景C：重复答案 → 忽略
          if (answer && answer === lastAnswerRef.current) {
            return;
          }
          // 场景D：无流式消息（流式消息已被 tool:call 等事件切断）
          // 不设置 completedByEventRef，也不设置 lastAnswerRef
          // 让 processInput 的 await 分支来添加独立的 result 消息
          return;
        }

        // status:update 事件仅更新状态，不添加消息（避免与 agent:complete/processInput 的 result 消息重复）
        if (eventName === 'status:update') {
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
  
  return {
    // 状态
    status,
    messages,
    tools,
    loading,
    stats,
    
    // 方法
    addMessage,
    clearMessages,
    restoreMessages,
    loadTools,
    refreshState,
    processInput,
    stop
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
    eventMessage: true
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
      const needsUserInput = payload?.result?.status === 'needs_user_input' || payload?.status === 'needs_user_input';
      return {
        message: {
          ...base,
          type: needsUserInput ? 'warning' : (answer ? 'result' : 'success'),
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
          content: payload?.activity?.statusText || `调用工具: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          args: payload?.args,
          activity: payload?.activity,
        },
      };
    case 'tool:result':
      return {
        message: {
          ...base,
          type: 'tool_result',
          content: payload?.activity?.statusText || `工具结果: ${payload?.toolName || payload?.name || 'unknown'}`,
          toolName: payload?.toolName || payload?.name,
          args: payload?.args,
          result: payload?.result,
          activity: payload?.activity,
        },
      };
    case 'tool:error':
      return {
        message: {
          ...base,
          type: 'error',
          content: payload?.activity?.statusText || `工具错误: ${payload?.toolName || payload?.name || 'unknown'} ${payload?.error || ''}`.trim(),
          toolName: payload?.toolName || payload?.name,
          args: payload?.args,
          activity: payload?.activity,
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
          toolName: payload?.toolName,
          activity: {
            kind: 'tool_activity',
            id: payload?.id || `progress:${payload?.toolName}`,
            phase: 'running',
            intent: 'tool',
            toolName: payload?.toolName,
            progress: payload?.progress,
            statusText: payload?.statusText || `进度: ${payload?.progress ?? 0}%`,
            target: payload?.target,
            detail: payload?.detail,
            timestamp: Date.now(),
          },
        },
      };
    case 'plan:created':
    case 'plan:updated': {
      const plan = payload?.plan || payload;
      const tasks = normalizePlanTasks(plan?.tasks);
      const completed = tasks.filter(task => task.status === 'completed').length;
      const running = tasks.filter(task => task.status === 'running').length;
      const failed = tasks.filter(task => task.status === 'failed').length;
      const total = tasks.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      return {
        message: {
          ...base,
          type: 'plan',
          content: eventName === 'plan:created' ? '执行计划已创建' : '执行计划已更新',
          plan,
          planTasks: tasks,
          planSummary: payload?.summary || payload?.update?.after || '',
          planUpdate: payload?.update || null,
          planProgress: { total, completed, running, failed, progress },
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

function normalizePlanTasks(tasks) {
  if (!tasks) {
    return [];
  }
  if (Array.isArray(tasks)) {
    return tasks;
  }
  if (tasks && typeof tasks === 'object') {
    return Object.entries(tasks).map(([id, task]) => ({
      id,
      ...(task && typeof task === 'object' ? task : { name: String(task) }),
    }));
  }
  return [];
}

export function safeStringify(value, { space = 0, maxChars = 20000 } = {}) {
  let text;
  try {
    if (typeof value === 'string') {
      text = value;
    } else {
      const seen = new WeakSet();
      text = JSON.stringify(value, (key, current) => {
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
      }, space);
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
  if (!data) return '';

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data.answer === 'string' && data.answer.trim()) {
    return data.answer;
  }

  if (typeof data.content === 'string' && data.content.trim()) {
    return data.content;
  }

  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text;
  }

  if (typeof data.response === 'string' && data.response.trim()) {
    return data.response;
  }

  if (typeof data.message?.content === 'string' && data.message.content.trim()) {
    return data.message.content;
  }

  if (typeof data.choices?.[0]?.message?.content === 'string' && data.choices[0].message.content.trim()) {
    return data.choices[0].message.content;
  }

  if (typeof data.choices?.[0]?.delta?.content === 'string' && data.choices[0].delta.content.trim()) {
    return data.choices[0].delta.content;
  }

  if (data.localCommand && typeof data.content === 'string' && data.content.trim()) {
    return data.content;
  }

  if (typeof data.result === 'string' && data.result.trim()) {
    return data.result;
  }

  if (typeof data.result?.answer === 'string' && data.result.answer.trim()) {
    return data.result.answer;
  }

  if (typeof data.result?.response === 'string' && data.result.response.trim()) {
    return data.result.response;
  }

  if (typeof data.result?.text === 'string' && data.result.text.trim()) {
    return data.result.text;
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
        path: { type: 'string', description: '文件路径' }
      },
      required: ['path']
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      category: 'filesystem',
      parameters: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    },
    {
      name: 'execute_shell',
      description: '执行 Shell 命令',
      category: 'shell',
      parameters: {
        command: { type: 'string', description: 'Shell 命令' }
      },
      required: ['command']
    },
    {
      name: 'brainstorm',
      description: '头脑风暴工具',
      category: 'skills',
      parameters: {
        topic: { type: 'string', description: '主题' }
      },
      required: ['topic']
    },
    {
      name: 'git_status',
      description: '查看 Git 状态',
      category: 'git',
      parameters: {},
      required: []
    }
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
    content: '正在分析任务...'
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 模拟工具调用
  addMessage({
    type: 'tool',
    content: '调用工具: read_file',
    toolName: 'read_file'
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  addMessage({
    type: 'result',
    content: '工具结果: read_file',
    toolName: 'read_file',
    result: '文件内容已读取'
  });
  
  // 模拟完成
  addMessage({
    type: 'success',
    content: '任务执行完成'
  });
  
  setStatus('completed');
  setStats(prev => ({
    ...prev,
    endTime: Date.now(),
    toolCalls: prev.toolCalls + 1
  }));
}

export default useRuntime;
