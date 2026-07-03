import { useState, useCallback, useRef } from 'react';
import {
  canEditComposerDraft,
  createComposerInteractionState,
  getComposerSubmitTransition,
  handleComposerKey,
} from '../app/interaction/interaction-model.js';
import { readAgentHistory, saveAgentInputHistory, createAgentSessionId } from '../app/session/session-storage.js';

/**
 * 聊天输入管理 — 输入状态/快捷键/历史/提交
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

  const composerInteractionRef = useRef(createComposerInteractionState());

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
    [activeAgentSessionId, agentOptions, followPreviewUrl, runtime, setPreviewFrameKey, setPreviewSession, setPreviewStatus, showPreviewPanel],
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

  return {
    chatInput,
    inputNotice,
    inputFocused,
    showSuggestions,
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
