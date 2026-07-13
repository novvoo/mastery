import { normalizePreviewUrlInput } from '../../runtime/preview-url.js';
import { LAYOUT } from '../config/index.js';
import { hasElectronAPI, invokeElectronAPI } from '../../hooks/useIPC.js';

export const REPOSITORY_URL = 'https://github.com/novvoo/mastery';
export const PROJECT_TREE_REFRESH_CONCURRENCY = 12;
export const AGENT_HISTORY_STORAGE_KEY = 'agentHistory';
export const AGENT_HISTORY_UPDATED_EVENT = 'agent-history-updated';
export const AGENT_SESSIONS_STORAGE_KEY = 'agentConversationSessions';
export const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';
export const DESKTOP_LAYOUT_STORAGE_KEY = 'desktopWorkbenchLayout';
export const AGENT_SESSIONS_UPDATED_EVENT = 'agent-sessions-updated';
export const PREVIEW_URL_STORAGE_KEY = 'desktopPreviewUrl';
export const MAX_AGENT_HISTORY_ITEMS = 100;
export const MAX_AGENT_SESSIONS = 100;

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
};
const adapter = {
  readHistory: () => readJson(AGENT_HISTORY_STORAGE_KEY, []),
  writeHistory: (value) => localStorage.setItem(AGENT_HISTORY_STORAGE_KEY, JSON.stringify(value)),
  readSessions: () => readJson(AGENT_SESSIONS_STORAGE_KEY, []),
  writeSessions: (value) => localStorage.setItem(AGENT_SESSIONS_STORAGE_KEY, JSON.stringify(value)),
};
const _createAgentSessionId = () => `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const _findAgentSession = (sessions, id) => sessions.find((session) => session?.id === id) || null;
const _upsertAgentSession = (sessions, session) => [session, ...sessions.filter((item) => item?.id !== session.id)].slice(0, MAX_AGENT_SESSIONS);
const _saveAgentInputHistory = (history, input, sessionId) => [
  { input: String(input), sessionId, timestamp: Date.now() },
  ...history.filter((item) => item?.input !== input),
].slice(0, MAX_AGENT_HISTORY_ITEMS);
const _getAgentSessionTitle = (input, messages) => String(input || messages?.find((item) => item?.type === 'user')?.content || '新会话').trim().slice(0, 48);

export const normalizeRagDocuments = (documents = []) => documents.filter(Boolean).map((doc) => typeof doc === 'string' ? { path: doc, name: getDocumentDisplayName(doc) } : doc);
export const mergeRagDocuments = (current = [], incoming = []) => Array.from(new Map([...normalizeRagDocuments(current), ...normalizeRagDocuments(incoming)].map((doc) => [doc.path || doc.name, doc])).values());
export const getDocumentDisplayName = (document) => String(document?.name || document?.path || document || '').split(/[\\/]/).pop();
export const createAgentErrorPrompt = (error) => `请分析并修复这个错误：\n${error?.message || error}`;


export function readDesktopLayout() {
  try {
    const raw = localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
    if (!raw) {return {};}
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readStoredPreviewUrl() {
  try {
    return normalizePreviewUrlInput(localStorage.getItem(PREVIEW_URL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function readStoredInspectorTab() {
  const tab = readDesktopLayout().activeInspectorTab;
  if (tab === 'plan') return 'activity';
  if (tab === 'rag') return 'history';
  return ['activity', 'history', 'preview'].includes(tab) ? tab : 'activity';
}

export function clampInspectorWidth(width) {
  const viewportLimit = typeof window === 'undefined'
    ? LAYOUT.inspectorMaxWidth
    : Math.max(LAYOUT.inspectorMinWidth, Math.min(LAYOUT.inspectorMaxWidth, Math.floor(window.innerWidth * 0.72)));
  const numericWidth = Number(width) || LAYOUT.inspectorPanelWidth;
  return Math.max(LAYOUT.inspectorMinWidth, Math.min(viewportLimit, numericWidth));
}

export function createAgentSessionId() {
  return _createAgentSessionId();
}

export function getAgentSessionTitle(input, messages = []) {
  return _getAgentSessionTitle(input, messages);
}

export function readAgentHistory() {
  return adapter.readHistory();
}

export function saveAgentInputHistory(input, sessionId) {
  const history = _saveAgentInputHistory(readAgentHistory(), input, sessionId);
  adapter.writeHistory(history);
  window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, {
    detail: history
  }));
}

export async function readAgentSessions(options = {}) {
  if (hasElectronAPI()) {
    try {
      const result = await invokeElectronAPI('session:list', options);
      return result?.sessions || result || [];
    } catch (err) {
      console.warn('session:list failed, falling back to localStorage:', err);
      return adapter.readSessions();
    }
  }
  return adapter.readSessions();
}

export async function readAgentSession(sessionId) {
  if (!sessionId) return null;
  if (hasElectronAPI()) {
    try {
      const [session, meta] = await Promise.all([
        invokeElectronAPI('session:load', { sessionId }).catch(() => null),
        invokeElectronAPI('session:meta', { sessionId }).catch(() => null),
      ]);
      if (session) {
        return { ...session, ...(meta || {}) };
      }
      return null;
    } catch (err) {
      console.warn('session:load failed, falling back to localStorage:', err);
      return _findAgentSession(adapter.readSessions(), sessionId);
    }
  }
  return _findAgentSession(adapter.readSessions(), sessionId);
}

export async function saveAgentSession(session) {
  if (!session?.id) return;
  const sessions = _upsertAgentSession(adapter.readSessions(), session);
  adapter.writeSessions(sessions);
  window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
}

export async function deleteAgentSession(sessionId) {
  if (hasElectronAPI()) {
    try {
      await invokeElectronAPI('session:delete', { sessionId });
    } catch (err) {
      console.warn('session:delete failed:', err);
    }
  }
  const sessions = adapter.readSessions().filter((s) => s?.id !== sessionId);
  adapter.writeSessions(sessions);
  window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
}

export async function clearAllSessions() {
  // 先通过 IPC 删除文件系统侧的所有会话
  if (hasElectronAPI()) {
    const sessions = adapter.readSessions();
    for (const session of sessions) {
      if (session?.id) {
        try {
          await invokeElectronAPI('session:delete', { sessionId: session.id });
        } catch (err) {
          console.warn('clearAllSessions: delete failed for', session.id, err);
        }
      }
    }
  }
  // 清空 localStorage 侧
  localStorage.removeItem(AGENT_SESSIONS_STORAGE_KEY);
  localStorage.removeItem(AGENT_HISTORY_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_AGENT_SESSION_STORAGE_KEY);
  adapter.writeSessions([]);
  window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
}

export async function renameAgentSession(sessionId, title) {
  if (hasElectronAPI()) {
    try {
      await invokeElectronAPI('session:rename', { sessionId, title });
    } catch (err) {
      console.warn('session:rename failed:', err);
    }
  }
  const sessions = adapter.readSessions();
  const idx = sessions.findIndex((s) => s?.id === sessionId);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], title, updatedAt: Date.now() };
    adapter.writeSessions(sessions);
    window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
  }
}

export async function forkAgentSession(sessionId, options = {}) {
  if (hasElectronAPI()) {
    try {
      const result = await invokeElectronAPI('session:fork', { sessionId, ...options });
      return result;
    } catch (err) {
      console.warn('session:fork failed:', err);
    }
  }
  const session = _findAgentSession(adapter.readSessions(), sessionId);
  if (!session) return null;
  const newId = _createAgentSessionId();
  const newSession = {
    ...session,
    id: newId,
    title: (session.title || '未命名会话') + ' (副本)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentId: sessionId,
    ...options,
  };
  const sessions = _upsertAgentSession(adapter.readSessions(), newSession);
  adapter.writeSessions(sessions);
  window.dispatchEvent(new CustomEvent(AGENT_SESSIONS_UPDATED_EVENT));
  return { sessionId: newId, meta: newSession };
}

export async function searchAgentSessions(query, limit = 20) {
  if (hasElectronAPI()) {
    try {
      const result = await invokeElectronAPI('session:search', { query, limit });
      return result?.sessions || result || [];
    } catch (err) {
      console.warn('session:search failed, falling back to localStorage:', err);
    }
  }
  const sessions = adapter.readSessions();
  if (!query) return sessions.slice(0, limit);
  const lowerQuery = String(query).toLowerCase();
  return sessions
    .filter((s) => {
      const title = (s?.title || '').toLowerCase();
      const id = (s?.id || '').toLowerCase();
      return title.includes(lowerQuery) || id.includes(lowerQuery);
    })
    .slice(0, limit);
}

export async function migrateLocalStorageSessions() {
  if (!hasElectronAPI()) {
    const sessions = adapter.readSessions();
    return { migrated: 0, skipped: sessions.length, failed: 0, reason: 'no-ipc' };
  }

  const sessions = adapter.readSessions();
  const result = { migrated: 0, skipped: 0, failed: 0, total: sessions.length };

  for (const session of sessions) {
    try {
      const createResult = await invokeElectronAPI('session:create', session);
      if (createResult?.skipped) {
        result.skipped++;
      } else {
        result.migrated++;
      }
    } catch (err) {
      console.warn('migrate session failed:', session?.id, err);
      result.failed++;
    }
  }

  return result;
}

export function findAgentSession(sessionId) {
  return _findAgentSession(adapter.readSessions(), sessionId);
}

export function upsertAgentSession(session) {
  const sessions = _upsertAgentSession(adapter.readSessions(), session);
  adapter.writeSessions(sessions);
}

export function writeAgentSessions(sessions) {
  adapter.writeSessions(sessions);
}
