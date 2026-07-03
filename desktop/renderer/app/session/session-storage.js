// Session storage - Desktop renderer implementation using localStorage adapter
// 纯逻辑已下沉到 src/core/session-store.js，此处仅提供 localStorage 桥接
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

// 创建 localStorage 适配器实例
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
  return ['rag', 'preview'].includes(tab) ? tab : 'rag';
}

export function clampInspectorWidth(width) {
  const viewportLimit = typeof window === 'undefined'
    ? LAYOUT.inspectorMaxWidth
    : Math.max(LAYOUT.inspectorMinWidth, Math.min(LAYOUT.inspectorMaxWidth, Math.floor(window.innerWidth * 0.72)));
  const numericWidth = Number(width) || LAYOUT.inspectorPanelWidth;
  return Math.max(LAYOUT.inspectorMinWidth, Math.min(viewportLimit, numericWidth));
}

export { createAgentErrorPrompt, normalizeRagDocuments, mergeRagDocuments, getDocumentDisplayName };

export function createAgentSessionId() {
  return _createAgentSessionId();
}

export function readAgentSessions() {
  return adapter.readSessions();
}

export function writeAgentSessions(sessions) {
  adapter.writeSessions(sessions);
}

export function findAgentSession(sessionId) {
  return _findAgentSession(readAgentSessions(), sessionId);
}

export function getAgentSessionTitle(input, messages = []) {
  return _getAgentSessionTitle(input, messages);
}

export function upsertAgentSession(session) {
  const sessions = _upsertAgentSession(readAgentSessions(), session);
  writeAgentSessions(sessions);
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
