import { useState, useCallback, useRef, useEffect } from 'react';
import {
  canEditComposerDraft,
  createComposerInteractionState,
  getComposerSubmitTransition,
  handleComposerKey,
} from '../app/interaction/interaction-model.js';
import { readAgentHistory, saveAgentInputHistory, createAgentSessionId } from '../app/session/session-storage.js';
import {
  enqueueMessage,
  dequeueMessage,
  hasQueuedMessages,
  getQueueLength,
  subscribeQueue,
  peekNext,
} from '../app/message-queue.js';

/**
 * 聊天输入管理 — 输入状态/快捷键/历史/提交
 *
 * 运行中提交语义:消息入队等待,当前任务完成后自动消费下一条。
 * 不中断当前任务,也不创建并发 agent。
 *
 * @param {object} runtime - runtime 实例
 * @param {object} agentOptions - agent 选项 { debug, maxIterations, autoSave }
 * @param {string} activeAgentSessionId - 当前会话 ID
 * @param {object} previewCallbacks - 预览相关回调
 */
export function useChatComposer(runtime, agentOptions, activeAgentSessionId, previewCallbacks) {
  const { setPreviewSession, followPreviewUrl, showPreviewPanel, setPreviewStatus, setPreviewFrameKey } = previewCallbacks;

  const [chatInput, setChatInput] = useState('');
  const [inputNotice, setInputNotice] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [queueCount, setQueueCount] = useState(getQueueLength());

  const composerInteractionRef = useRef(createComposerInteractionState());
  const consumeLockRef = useRef(false);

  const handleChatInputChange = useCallback((value) => {
    setChatInput(value);
    setInputNotice(null);
    composerInteractionRef.current = { ...composerInteractionRef.current, historyIndex: -1, notice: null };
    setShowSuggestions(value.trimStart().startsWith('/'));
  }, []);

  const handleCommandSelect = useCallback((command) => {
    setChatInput(command);
    setShowSuggestions(false);
  }, []);

  const handleSuggestionsClose = useCallback(() => setShowSuggestions(false), []);

  const handleChatKeyDown = useCallback(
    (e, inputRef) => {
      const interaction = handleComposerKey(e, composerInteractionRef.current, {
        value: chatInput,
        status: runtime.status,
        history: readAgentHistory(),
        now: Date.now(),
      });

      composerInteractionRef.current = interaction.state;
      setInputNotice(interaction.state.notice);

      if (interaction.action === 'submit') {
        e.preventDefault();
        handleSendMessage();
        return;
      }
      if (interaction.action === 'clear') {
        e.preventDefault();
        setChatInput('');
        setShowSuggestions(false);
        return;
      }
      if (interaction.action === 'replace_input') {
        e.preventDefault();
        setChatInput(interaction.value || '');
        setShowSuggestions(String(interaction.value || '').trimStart().startsWith('/'));
        return;
      }
      if (interaction.action === 'notice') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.ctrlKey && !showSuggestions)) {
        setShowSuggestions(false);
      }
    },
    [chatInput, runtime.status, showSuggestions],
  );

  const handleInsertText = useCallback((text) => {
    setChatInput(text);
    setShowSuggestions(text.trimStart().startsWith('/'));
  }, []);

  const handleInsertDocSearch = useCallback(() => {
    setChatInput('/doc search ');
  }, []);

  const executeInput = useCallback(
    async (input) => {
      if (!input?.trim()) return;

      let sessionId = activeAgentSessionId;
      if (!sessionId) {
        sessionId = createAgentSessionId();
      }

      saveAgentInputHistory(input, sessionId);
      const result = await runtime.processInput(input, agentOptions);
      if (result?.command === '/debug' && typeof result.debug === 'boolean') {
        // debug 模式切换由外部 handleDebugToggle 处理
      }
      if (result?.command === '/preview' && result.url) {
        setPreviewSession(result);
        followPreviewUrl(result.url);
        showPreviewPanel();
        setPreviewStatus('ready');
        setPreviewFrameKey((prev) => prev + 1);
      }
    },
    [activeAgentSessionId, agentOptions, followPreviewUrl, runtime, setPreviewFrameKey, setPreviewSession, setPreviewStatus, showPreviewPanel],
  );

  const consumeQueue = useCallback(async () => {
    if (consumeLockRef.current) return;
    if (runtime.status === 'running') return;
    if (!hasQueuedMessages()) return;

    consumeLockRef.current = true;
    try {
      const next = dequeueMessage();
      if (next) {
        await executeInput(next.input);
      }
    } catch (error) {
      console.error('[useChatComposer] 队列消费失败:', error);
    } finally {
      consumeLockRef.current = false;
      // 还有队列则继续消费
      if (hasQueuedMessages() && runtime.status !== 'running') {
        consumeQueue();
      }
    }
  }, [executeInput, runtime.status]);

  const handleSubmitAgentInput = useCallback(
    async (rawInput, options = {}) => {
      const transition = getComposerSubmitTransition({
        value: rawInput,
        status: runtime.status,
        clearInput: options.clearInput !== false,
        keepWhenBusy: options.keepWhenBusy !== false,
      });
      const { input } = transition;

      if (!transition.accepted) {
        if (input && transition.focus && options.updateComposer !== false) {
          setChatInput(transition.nextValue);
          setShowSuggestions(transition.showSuggestions);
        }
        return;
      }

      if (options.updateComposer !== false) {
        setChatInput(transition.nextValue);
        setShowSuggestions(transition.showSuggestions);
      }

      try {
        // 运行中提交 = 入队等待，不中断当前任务
        if (runtime.status === 'running') {
          enqueueMessage(input);
          setInputNotice({
            tone: 'info',
            text: `已加入队列，等待当前任务完成后执行（队列 ${getQueueLength()} 条）`,
          });
          return;
        }

        // needs_user_input 状态下，底部输入框禁用，用户应在浮动胶囊中回答
        if (runtime.status === 'needs_user_input') {
          setInputNotice({
            tone: 'warning',
            text: '请在上方浮动胶囊中回答问题，当前不接受新任务',
          });
          return;
        }

        await executeInput(input);
        setInputNotice(null);
        composerInteractionRef.current = createComposerInteractionState();
      } catch (error) {
        console.error('[App] 发送消息失败:', error);
        if (options.updateComposer !== false) {
          setChatInput(transition.restoreValue);
          setShowSuggestions(transition.restoreValue.trimStart().startsWith('/'));
        }
      }
    },
    [executeInput, runtime.status],
  );

  const handleSendMessage = useCallback(async () => {
    await handleSubmitAgentInput(chatInput);
  }, [chatInput, handleSubmitAgentInput]);

  const handleContinueAgentInput = useCallback(
    async (input) => {
      await handleSubmitAgentInput(input, { clearInput: false, updateComposer: false });
    },
    [handleSubmitAgentInput],
  );

  const clearInput = useCallback((value = '') => {
    setChatInput(value);
    setShowSuggestions(false);
    setInputNotice(null);
    composerInteractionRef.current = createComposerInteractionState();
  }, []);

  // 订阅队列变化，更新 UI 上的队列计数
  useEffect(() => {
    const unsubscribe = subscribeQueue(() => {
      setQueueCount(getQueueLength());
    });
    return unsubscribe;
  }, []);

  // 监听 runtime status 变化，任务完成后自动消费队列
  useEffect(() => {
    if (runtime.status !== 'running' && runtime.status !== 'needs_user_input' && hasQueuedMessages()) {
      consumeQueue();
    }
  }, [runtime.status, consumeQueue]);

  return {
    chatInput,
    inputNotice,
    inputFocused,
    showSuggestions,
    queueCount,
    setInputFocused,
    handleChatInputChange,
    handleCommandSelect,
    handleSuggestionsClose,
    handleChatKeyDown,
    handleInsertText,
    handleInsertDocSearch,
    handleSendMessage,
    handleContinueAgentInput,
    handleSubmitAgentInput,
    clearInput,
    canEditComposer: canEditComposerDraft(runtime.status),
  };
}
