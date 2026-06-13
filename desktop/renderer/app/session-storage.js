import { normalizePreviewUrlInput } from '../preview-url.js';
import { LAYOUT } from './config.js';

export const REPOSITORY_URL = 'https://github.com/novvoo/ai-engineering-mastery-agent';
export const PROJECT_TREE_REFRESH_CONCURRENCY = 12;
export const AGENT_HISTORY_STORAGE_KEY = 'agentHistory';
export const AGENT_HISTORY_UPDATED_EVENT = 'agent-history-updated';
export const AGENT_SESSIONS_STORAGE_KEY = 'agentConversationSessions';
export const ACTIVE_AGENT_SESSION_STORAGE_KEY = 'activeAgentConversationSessionId';
export const DESKTOP_LAYOUT_STORAGE_KEY = 'desktopWorkbenchLayout';
export const AGENT_SESSIONS_UPDATED_EVENT = 'agent-sessions-updated';
export const PREVIEW_URL_STORAGE_KEY = 'desktopPreviewUrl';
export const MAX_AGENT_HISTORY_ITEMS = 50;
export const MAX_AGENT_SESSIONS = 50;

export function readDesktopLayout() {
  try {
    const raw = localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
    if (!raw) return {};
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

export function createAgentErrorPrompt(message) {
  const content = String(message?.content || message?.message || message?.details || '').trim();
  const payload = message?.payload || message?.raw;
  const payloadText = payload
    ? `\n\n附加上下文:\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`
    : '';
  return `请帮我分析并修复下面这个错误。请先判断信息是否足够；如果不够，明确说明还缺什么；如果足够，请给出原因、修复步骤和需要验证的命令。\n\n错误信息:\n${content || '(无错误文本)'}${payloadText}`;
}

export function readAgentHistory() {
  try {
    const rawHistory = localStorage.getItem(AGENT_HISTORY_STORAGE_KEY);
    if (!rawHistory) return [];
    const parsed = JSON.parse(rawHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[App] 读取输入历史失败:', error);
    return [];
  }
}

export function createAgentSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readAgentSessions() {
  try {
    const rawSessions = localStorage.getItem(AGENT_SESSIONS_STORAGE_KEY);
    if (!rawSessions) return [];
    const parsed = JSON.parse(rawSessions);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[App] 读取会话历史失败:', error);
    return [];
  }
}

export function writeAgentSessions(sessions) {
  const normalizedSessions = Array.isArray(sessions) ? sessions.slice(0, MAX_AGENT_SESSIONS) : [];
  localStorage.setItem(AGENT_SESSIONS_STORAGE_KEY, JSON.stringify(normalizedSessions));
}

export function findAgentSession(sessionId) {
  if (!sessionId) return null;
  return readAgentSessions().find(session => session?.id === sessionId) || null;
}

export function getAgentSessionTitle(input, messages = []) {
  const fromInput = String(input || '').trim();
  if (fromInput) return fromInput.slice(0, 80);

  const firstMessage = messages.find(message => typeof message?.content === 'string' && message.content.trim());
  return firstMessage?.content?.replace(/^用户输入:\s*/, '').slice(0, 80) || '未命名会话';
}

export function upsertAgentSession(session) {
  if (!session?.id) return;
  const now = Date.now();
  const nextSession = {
    ...session,
    updatedAt: session.updatedAt || now,
    createdAt: session.createdAt || now,
    messages: Array.isArray(session.messages) ? session.messages : []
  };
  const nextSessions = [
    nextSession,
    ...readAgentSessions().filter(item => item?.id !== nextSession.id)
  ].slice(0, MAX_AGENT_SESSIONS);
  writeAgentSessions(nextSessions);
}

export function saveAgentInputHistory(input, sessionId) {
  const normalizedInput = String(input || '').trim();
  if (!normalizedInput) return;

  const nextHistory = [
    {
      input: normalizedInput,
      sessionId,
      timestamp: Date.now()
    },
    ...readAgentHistory().filter(item => item?.input !== normalizedInput)
  ].slice(0, MAX_AGENT_HISTORY_ITEMS);

  localStorage.setItem(AGENT_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
  window.dispatchEvent(new CustomEvent(AGENT_HISTORY_UPDATED_EVENT, {
    detail: nextHistory
  }));
}

export function getDocumentDisplayName(pathOrTitle = '') {
  const text = String(pathOrTitle || '').trim();
  if (!text) return '未命名文档';
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

export function normalizeRagDocuments(documents = []) {
  return (documents || []).map(doc => ({
    id: doc.id,
    name: doc.title || getDocumentDisplayName(doc.source),
    path: doc.source || '',
    kind: doc.kind,
    chunks: doc.chunks,
    chars: doc.chars,
    indexed: true,
  }));
}

export function mergeRagDocuments(currentDocs = [], nextDocs = []) {
  const merged = new Map();
  for (const doc of currentDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) merged.set(key, doc);
  }
  for (const doc of nextDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) merged.set(key, doc);
  }
  return Array.from(merged.values());
}


