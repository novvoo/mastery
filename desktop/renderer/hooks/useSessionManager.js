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
  readAgentSession,
  saveAgentSession,
  deleteAgentSession,
  clearAllSessions,
  renameAgentSession,
  forkAgentSession,
  searchAgentSessions,
  migrateLocalStorageSessions,
  upsertAgentSession,
} from '../app/session/session-storage.js';

const PAGE_SIZE = 20;

function extractOmpMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
    .map((part) => part?.text || '')
    .join('');
}

export function normalizeOmpSessionMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => {
    if (message?.type && typeof message?.content === 'string') return message;
    const role = message?.role || 'assistant';
    const content = extractOmpMessageText(message?.content) || String(message?.text || '');
    return {
      id: message?.id || `omp_session_${index}_${Date.now()}`,
      type: role === 'user' ? 'input' : role === 'assistant' ? 'result' : 'event',
      content: role === 'user' ? `用户输入: ${content}` : content,
      timestamp: Date.parse(message?.timestamp || '') || Date.now() + index,
      role,
    };
  }).filter((message) => message.content.trim());
}

export function useSessionManager(runtime, workingDirectory) {
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(
    () => localStorage.getItem(ACTIVE_AGENT_SESSION_STORAGE_KEY) || createAgentSessionId(),
  );
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [migrated, setMigrated] = useState(false);

  const skipNextSessionPersistRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(ACTIVE_AGENT_SESSION_STORAGE_KEY, activeAgentSessionId);
  }, [activeAgentSessionId]);

  const loadSessions = useCallback(async (opts = {}) => {
    const { reset = false, search = searchQuery } = opts;
    setLoading(true);
    try {
      const currentOffset = reset ? 0 : offset;
      let result;
      if (search) {
        result = await searchAgentSessions(search, PAGE_SIZE + currentOffset);
      } else {
        result = await readAgentSessions({ limit: PAGE_SIZE, offset: currentOffset });
      }
      const sessionList = Array.isArray(result) ? result : (result?.sessions || []);

      // 按 session id 去重，防止同一会话出现多次
      const dedupedList = [];
      const seenIds = new Set();
      for (const session of sessionList) {
        const id = session?.id || session?.sessionId;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        dedupedList.push(session);
      }

      if (reset) {
        setSessions(dedupedList.slice(0, PAGE_SIZE));
        setOffset(PAGE_SIZE);
        setHasMore(dedupedList.length > PAGE_SIZE);
      } else {
        setSessions((prev) => {
          const merged = [...prev];
          const existingIds = new Set(merged.map((s) => s?.id || s?.sessionId));
          for (const session of dedupedList) {
            const id = session?.id || session?.sessionId;
            if (id && !existingIds.has(id)) {
              existingIds.add(id);
              merged.push(session);
            }
          }
          return merged;
        });
        setHasMore(dedupedList.length > PAGE_SIZE);
        setOffset(currentOffset + PAGE_SIZE);
      }
    } catch (err) {
      console.warn('loadSessions failed:', err);
    } finally {
      setLoading(false);
    }
  }, [offset, searchQuery]);

  const handleRefreshSessions = useCallback(() => {
    return loadSessions({ reset: true });
  }, [loadSessions]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    return loadSessions({ reset: false });
  }, [hasMore, loading, loadSessions]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!migrated) {
        try {
          await migrateLocalStorageSessions();
        } catch (e) {
          console.warn('migrate failed:', e);
        }
        if (!cancelled) {
          setMigrated(true);
        }
      }
      await loadSessions({ reset: true, search: '' });
    };
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSessions({ reset: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const syncSessions = () => loadSessions({ reset: true });
    window.addEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
    window.addEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    return () => {
      window.removeEventListener(AGENT_SESSIONS_UPDATED_EVENT, syncSessions);
      window.removeEventListener(AGENT_HISTORY_UPDATED_EVENT, syncSessions);
    };
  }, [loadSessions]);

  useEffect(() => {
    if (!activeAgentSessionId || runtime.messages.length === 0) return;
    if (skipNextSessionPersistRef.current) {
      skipNextSessionPersistRef.current = false;
      return;
    }
    const firstInput = runtime.messages
      .find((m) => typeof m?.content === 'string' && m.content.startsWith('用户输入:'))
      ?.content?.replace(/^用户输入:\s*/, '');
    saveAgentSession({
      id: activeAgentSessionId,
      title: getAgentSessionTitle(firstInput, runtime.messages),
      workingDirectory,
      messages: runtime.messages,
      updatedAt: Date.now(),
    });
  }, [activeAgentSessionId, runtime.messages, workingDirectory]);

  const handleNewSession = useCallback(async (clearInputCallback) => {
    let nextSessionId = createAgentSessionId();
    if (window.electronAPI) {
      try {
        const created = await window.electronAPI.invoke('session:create', {});
        nextSessionId = created?.sessionId || created?.result?.sessionId || nextSessionId;
      } catch (err) {
        console.warn('session:create failed:', err);
      }
    }
    skipNextSessionPersistRef.current = true;
    setActiveAgentSessionId(nextSessionId);
    runtime.clearMessages();
    await runtime.refreshState();
    await loadSessions({ reset: true, search: '' });
    clearInputCallback?.();
  }, [loadSessions, runtime]);

  const handleClearHistory = useCallback((confirmFn, clearInputCallback) => {
    return async () => {
      if (!(await confirmFn({
        title: '清空历史记录',
        message: '确定要清空所有会话和历史记录吗？此操作无法撤销。',
        confirmText: '清空',
        danger: true,
      }))) return;

      await clearAllSessions();
      skipNextSessionPersistRef.current = true;
      setActiveAgentSessionId(createAgentSessionId());
      runtime.clearMessages();
      setSessions([]);
      clearInputCallback?.();
      window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, { detail: [] }));
    };
  }, [runtime]);

  const handleSelectSession = useCallback(async (sessionId, clearInputCallback) => {
    const session = await readAgentSession(sessionId);
    if (!session?.messages?.length) {
      clearInputCallback?.('');
      setActiveAgentSessionId(session?.id || sessionId);
      await runtime.refreshState();
      return;
    }
    setActiveAgentSessionId(session.id);
    runtime.restoreMessages(normalizeOmpSessionMessages(session.messages));
    await runtime.refreshState();
    clearInputCallback?.('');
  }, [runtime]);

  const handleDeleteSession = useCallback(async (sessionId) => {
    await deleteAgentSession(sessionId);
    if (sessionId === activeAgentSessionId) {
      skipNextSessionPersistRef.current = true;
      setActiveAgentSessionId(createAgentSessionId());
      runtime.clearMessages();
    }
  }, [activeAgentSessionId, runtime]);

  const handleDeleteSessions = useCallback(async (sessionIds) => {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return;
    for (const sessionId of sessionIds) {
      await deleteAgentSession(sessionId);
    }
    if (sessionIds.includes(activeAgentSessionId)) {
      skipNextSessionPersistRef.current = true;
      setActiveAgentSessionId(createAgentSessionId());
      runtime.clearMessages();
    }
  }, [activeAgentSessionId, runtime]);

  const handleRenameSession = useCallback(async (sessionId, title) => {
    await renameAgentSession(sessionId, title);
  }, []);

  const handleForkSession = useCallback(async (sessionId, options = {}) => {
    const result = await forkAgentSession(sessionId, options);
    return result;
  }, []);

  const handleRestoreHistory = useCallback((item, clearInputCallback) => {
    handleSelectSession(item?.sessionId, clearInputCallback);
  }, [handleSelectSession]);

  return {
    activeAgentSessionId,
    setActiveAgentSessionId,
    sessions,
    loading,
    searchQuery,
    setSearchQuery,
    hasMore,
    loadMore,
    handleNewSession,
    handleNewTask: handleNewSession,
    handleClearHistory,
    handleSelectSession,
    handleRestoreHistory,
    handleDeleteSession,
    handleDeleteSessions,
    handleRenameSession,
    handleForkSession,
    handleRefreshSessions,
  };
}
