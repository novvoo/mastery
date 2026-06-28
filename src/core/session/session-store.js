/**
 * Session storage - pure logic layer for session CRUD and RAG document management.
 * 存储层通过 adapter 注入，Desktop 用 localStorage，CLI 用文件系统。
 * 不依赖 React/Electron，可被 Desktop 和 CLI 共享。
 */

export const MAX_AGENT_HISTORY_ITEMS = 50;
export const MAX_AGENT_SESSIONS = 50;

/**
 * 创建会话 ID
 */
export function createAgentSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 获取会话标题
 */
export function getAgentSessionTitle(input, messages = []) {
  const fromInput = String(input || '').trim();
  if (fromInput) {
    return fromInput.slice(0, 80);
  }

  const firstMessage = messages.find(
    (message) => typeof message?.content === 'string' && message.content.trim(),
  );
  return firstMessage?.content?.replace(/^用户输入:\s*/, '').slice(0, 80) || '未命名会话';
}

/**
 * 查找会话
 */
export function findAgentSession(sessions, sessionId) {
  if (!sessionId || !Array.isArray(sessions)) {
    return null;
  }
  return sessions.find((session) => session?.id === sessionId) || null;
}

/**
 * 插入或更新会话
 */
export function upsertAgentSession(sessions, session) {
  if (!session?.id) {
    return sessions;
  }
  const now = Date.now();
  const existingSession = sessions.find((item) => item?.id === session.id);
  const nextSession = {
    ...session,
    updatedAt: session.updatedAt || now,
    createdAt: session.createdAt || existingSession?.createdAt || now,
    messages: Array.isArray(session.messages) ? session.messages : [],
  };
  return [nextSession, ...sessions.filter((item) => item?.id !== nextSession.id)].slice(
    0,
    MAX_AGENT_SESSIONS,
  );
}

/**
 * 保存输入历史
 */
export function saveAgentInputHistory(history, input, sessionId) {
  const normalizedInput = String(input || '').trim();
  if (!normalizedInput) {
    return history;
  }

  return [
    {
      input: normalizedInput,
      sessionId,
      timestamp: Date.now(),
    },
    ...history.filter((item) => item?.input !== normalizedInput),
  ].slice(0, MAX_AGENT_HISTORY_ITEMS);
}

/**
 * 规范化 RAG 文档
 */
export function normalizeRagDocuments(documents = []) {
  return (documents || []).map((doc) => ({
    id: doc.id,
    name: doc.title || getDocumentDisplayName(doc.source),
    path: doc.source || '',
    kind: doc.kind,
    chunks: doc.chunks,
    chars: doc.chars,
    indexed: true,
  }));
}

/**
 * 合并 RAG 文档（按 id/path/name 去重）
 */
export function mergeRagDocuments(currentDocs = [], nextDocs = []) {
  const merged = new Map();
  for (const doc of currentDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) {
      merged.set(key, doc);
    }
  }
  for (const doc of nextDocs) {
    const key = doc.id || doc.path || doc.name;
    if (key) {
      merged.set(key, doc);
    }
  }
  return Array.from(merged.values());
}

/**
 * 获取文档显示名称
 */
export function getDocumentDisplayName(pathOrTitle = '') {
  const text = String(pathOrTitle || '').trim();
  if (!text) {
    return '未命名文档';
  }
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

/**
 * 构建错误提示词
 */
export function createAgentErrorPrompt(message) {
  const content = String(message?.content || message?.message || message?.details || '').trim();
  const payload = message?.payload || message?.raw;
  const payloadText = payload
    ? `\n\n附加上下文:\n${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`
    : '';
  return `请帮我分析并修复下面这个错误。请先判断信息是否足够；如果不够，明确说明还缺什么；如果足够，请给出原因、修复步骤和需要验证的命令。\n\n错误信息:\n${content || '(无错误文本)'}${payloadText}`;
}

// ===== 存储适配器 =====

/**
 * 创建基于 localStorage 的存储适配器（Desktop 渲染进程用）
 */
export function createLocalStorageAdapter(storageKey, sessionsKey, historyKey) {
  const SESSIONS_KEY = sessionsKey || 'agentConversationSessions';
  const HISTORY_KEY = historyKey || 'agentHistory';
  const storage = storageKey || globalThis.localStorage;

  return {
    readSessions() {
      try {
        const raw = storage?.getItem(SESSIONS_KEY);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    writeSessions(sessions) {
      storage?.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    },
    readHistory() {
      try {
        const raw = storage?.getItem(HISTORY_KEY);
        if (!raw) {
          return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    writeHistory(history) {
      storage?.setItem(HISTORY_KEY, JSON.stringify(history));
    },
  };
}

/**
 * 创建基于文件系统的存储适配器（CLI 用）
 */
export function createFileSystemStorageAdapter(configDir, fs, path) {
  const SESSIONS_FILE = path.join(configDir, 'sessions.json');
  const HISTORY_FILE = path.join(configDir, 'history.json');

  const readJsonFile = (filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeJsonFile = (filePath, data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  };

  return {
    readSessions() {
      return readJsonFile(SESSIONS_FILE);
    },
    writeSessions(sessions) {
      writeJsonFile(SESSIONS_FILE, sessions);
    },
    readHistory() {
      return readJsonFile(HISTORY_FILE);
    },
    writeHistory(history) {
      writeJsonFile(HISTORY_FILE, history);
    },
  };
}
