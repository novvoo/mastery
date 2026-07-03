import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ACTIVE_AGENT_SESSION_STORAGE_KEY,
  AGENT_HISTORY_STORAGE_KEY,
  AGENT_HISTORY_UPDATED_EVENT,
  AGENT_SESSIONS_STORAGE_KEY,
  AGENT_SESSIONS_UPDATED_EVENT,
  createAgentSessionId,
  findAgentSession,
  getAgentSessionTitle,
  readAgentSessions,
  upsertAgentSession,
} from '../app/session/session-storage.js';

/**
 * 会话管理 — ID/列表/持久化/切换
 *
 * @param {object} runtime - runtime 实例
 * @param {string} workingDirectory - 当前工作目录
 */
export function useSessionManager(runtime, workingDirectory) {
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(
    () => localStorage.getItem(ACTIVE_AGENT_SESSION_STORAGE_KEY) || createAgentSessionId(),
  );
  const [sessions, setSessions] = useState([]);

  const skipNextSessionPersistRef = useRef(false);

  // ── 持久化 activeAgentSessionId ───────────────────────────
  useEffect(() => {
    localStorage.setItem(ACTIVE_AGENT_SESSION_STORAGE_KEY, activeAgentSessionId);
  }, [activeAgentSessionId]);

  // ── 初始化时恢复消息 ──────────────────────────────────────
  useEffect(() => {
    const activeSession = findAgentSession(activeAgentSessionId);
    if (activeSession?.messages?.length) {
      runtime.restoreMessages(activeSession.messages);
    }
  }, []);

  // ── 会话列表同步 ──────────────────────────────────────────
  useEffect(() => {
    const syncSessions = () => setSessions(readAgentSessions());
    syncSessions();
    window.addEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
    window.addEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    return () => {
      window.removeEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
      window.removeEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    };
  }, []);

  // ── 消息变化时持久化会话 ───────────────────────────────────
  useEffect(() => {
    if (!activeAgentSessionId || runtime.messages.length === 0) return;
    if (skipNextSessionPersistRef.current) {
      skipNextSessionPersistRef.current = false;
      return;
    }
    const firstInput = runtime.messages
      .find((m) => typeof m?.content === 'string' && m.content.startsWith('用户输入:'))
      ?.content?.replace(/^用户输入:\s*/, '');
    upsertAgentSession({
      id: activeAgentSessionId,
      title: getAgentSessionTitle(firstInput, runtime.messages),
      workingDirectory,
      messages: runtime.messages,
      updatedAt: Date.now(),
    });
    window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
  }, [activeAgentSessionId, runtime.messages, workingDirectory]);

  // ── 新建任务 ──────────────────────────────────────────────
  const handleNewTask = useCallback((clearInputCallback) => {
    setActiveAgentSessionId(createAgentSessionId());
    runtime.clearMessages();
    clearInputCallback?.();
  }, [runtime]);

  // ── 清空历史 ──────────────────────────────────────────────
  const handleClearHistory = useCallback((confirmFn, clearInputCallback) => {
    return async () => {
      if (!(await confirmFn({
        title: '清空历史记录',
        message: '确定要清空所有会话和历史记录吗？此操作无法撤销。',
        confirmText: '清空',
        danger: true,
      }))) return;

      localStorage.removeItem(AGENT_HISTORY_STORAGE_KEY);
      localStorage.removeItem(AGENT_SESSIONS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_AGENT_SESSION_STORAGE_KEY);
      skipNextSessionPersistRef.current = true;
      setActiveAgentSessionId(createAgentSessionId());
      runtime.clearMessages();
      setSessions([]);
      clearInputCallback?.();
      window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, { detail: [] }));
      window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
    };
  }, [runtime]);

  // ── 切换会话 ──────────────────────────────────────────────
  const handleRestoreHistory = useCallback((item, clearInputCallback) => {
    const session = findAgentSession(item?.sessionId);
    if (!session?.messages?.length) {
      clearInputCallback?.(item?.input || '');
      return;
    }
    setActiveAgentSessionId(session.id);
    runtime.restoreMessages(session.messages);
    clearInputCallback?.('');
  }, [runtime]);

  return {
    activeAgentSessionId,
    setActiveAgentSessionId,
    sessions,
    handleNewTask,
    handleClearHistory,
    handleRestoreHistory,
  };
}
