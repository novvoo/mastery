import {
  createLocalStorageAdapter,
  createAgentSessionId as _createAgentSessionId,
  getAgentSessionTitle as _getAgentSessionTitle,
  findAgentSession as _findAgentSession,
  upsertAgentSession as _upsertAgentSession,
  saveAgentInputHistory as _saveAgentInputHistory,
  normalizeRagDocuments,
  mergeRagDocuments,
  getDocumentDisplayName,
  createAgentErrorPrompt,
  MAX_AGENT_HISTORY_ITEMS,
  MAX_AGENT_SESSIONS,
} from '../../../../src/core/session/session-store.js';
import { normalizePreviewUrlInput } from '../../../../src/core/runtime/preview-url.js';
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
export { MAX_AGENT_HISTORY_ITEMS, MAX_AGENT_SESSIONS };

const adapter = createLocalStorageAdapter(null, AGENT_SESSIONS_STORAGE_KEY, AGENT_HISTORY_STORAGE_KEY);

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
  return ['plan', 'history', 'rag', 'preview'].includes(tab) ? tab : 'plan';
}

export function clampInspectorWidth(width) {
  const viewportLimit = typeof window === 'undefined'
    ? LAYOUT.inspectorMaxWidth
    : Math.max(LAYOUT.inspectorMinWidth, Math.min(LAYOUT.inspectorMaxWidth, Math.floor(window.innerWidth * 0.72)));
  const numericWidth = Number(width) || LAYOUT.inspectorPanelWidth;
  return Math.max(LAYOUT.inspectorMinWidth, Math.min(viewportLimit, numericWidth));
}

export {
  createAgentErrorPrompt, normalizeRagDocuments, mergeRagDocuments, getDocumentDisplayName,
};

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
