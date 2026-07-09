import { createSessionFileStore } from '../../../../core/session/session-file-store.js';
import {
  listSessions,
  countSessions,
  searchSessions,
  getSessionPreview,
} from '../../../../core/session/session-listing.js';
import { deriveSessionStatus } from '../../../../core/session/session-status.js';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

function generateSessionId() {
  return crypto.randomUUID();
}

function sessionToMeta(session) {
  if (!session) return null;
  return {
    id: session.sessionId || session.id,
    title: session.title || '未命名会话',
    createdAt: session.createdAt || 0,
    updatedAt: session.updatedAt || 0,
    status: session.status || 'unknown',
    messageCount: session.messageCount || 0,
    workingDirectory: session.workingDirectory || '',
    forkedFrom: session.forkedFrom || null,
    parentSession: session.parentSession || null,
  };
}

function formatSessionObject(loaded, workingDirectory) {
  if (!loaded) return null;
  const meta = loaded.meta || {};
  const messages = loaded.messages || [];
  const status = deriveSessionStatus(messages, meta);
  return {
    id: loaded.sessionId,
    title: meta.title || '未命名会话',
    createdAt: meta.createdAt || 0,
    updatedAt: meta.updatedAt || meta.createdAt || 0,
    status,
    messages,
    workingDirectory: workingDirectory || meta.workingDirectory || '',
    forkedFrom: meta.forkedFrom || null,
    parentSession: meta.parentSession || null,
  };
}

async function forkSessionFromStore(
  store,
  sessionId,
  workingDirectory,
  forkAtMessageIndex,
  newTitle,
) {
  const loaded = await store.loadSession(sessionId, workingDirectory);
  if (!loaded) {
    throw new Error('Session not found');
  }

  const newSessionId = generateSessionId();
  const now = Date.now();
  const originalMeta = loaded.meta || {};

  const messages = loaded.messages || [];
  const forkIndex =
    forkAtMessageIndex != null ? Math.min(forkAtMessageIndex, messages.length) : messages.length;
  const forkedMessages = messages.slice(0, forkIndex);

  const newMeta = {
    sessionId: newSessionId,
    title: newTitle || `${originalMeta.title || '未命名会话'} (副本)`,
    createdAt: now,
    updatedAt: now,
    workingDirectory: workingDirectory || originalMeta.workingDirectory || '',
    status: 'pending',
    forkedFrom: sessionId,
    parentSession: sessionId,
  };

  await store.appendMeta(newSessionId, newMeta, workingDirectory);

  for (const msg of forkedMessages) {
    await store.appendMessage(newSessionId, msg, workingDirectory);
  }

  const newLoaded = await store.loadSession(newSessionId, workingDirectory);
  return {
    sessionId: newSessionId,
    meta: sessionToMeta({
      sessionId: newSessionId,
      title: newMeta.title,
      createdAt: newMeta.createdAt,
      updatedAt: newMeta.updatedAt,
      status: newMeta.status,
      messageCount: forkedMessages.length,
      workingDirectory: newMeta.workingDirectory,
      forkedFrom: newMeta.forkedFrom,
      parentSession: newMeta.parentSession,
    }),
  };
}

async function getSessionLineageFromStore(store, sessionId, workingDirectory) {
  const lineage = [];
  let currentId = sessionId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const meta = await store.getSessionMeta(currentId, workingDirectory);
    if (!meta) break;

    lineage.unshift({
      sessionId: currentId,
      title: meta.title || '未命名会话',
      createdAt: meta.createdAt || 0,
      forkedFrom: meta.forkedFrom || null,
    });

    currentId = meta.forkedFrom || meta.parentSession || null;
  }

  return lineage;
}

async function getSessionChildrenFromStore(store, sessionId, workingDirectory) {
  const sessionsDir = workingDirectory
    ? store.getProjectSessionsDir(workingDirectory)
    : store.getSessionsDir();

  const allSessions = await listSessions({ sessionsDir, limit: 1000, offset: 0 });
  const children = allSessions.filter(
    (s) => s.meta?.forkedFrom === sessionId || s.meta?.parentSession === sessionId,
  );

  return children.map((s) =>
    sessionToMeta({
      sessionId: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      status: s.status,
      messageCount: 0,
      workingDirectory: s.workingDirectory,
      forkedFrom: s.meta?.forkedFrom || null,
      parentSession: s.meta?.parentSession || null,
    }),
  );
}

export function registerSessionHandlers(ctx) {
  const ipc = ctx.ipcAdapter;
  const { app } = ctx.electron;

  if (!ctx.sessionStore) {
    let appDataDir;
    if (app && typeof app.getPath === 'function') {
      appDataDir = app.getPath('userData');
    } else if (process.env.MASTERY_DATA_DIR) {
      appDataDir = process.env.MASTERY_DATA_DIR;
    } else {
      const home = os.homedir();
      appDataDir = path.join(home, '.mastery-agent');
    }
    ctx.sessionStore = createSessionFileStore({ appDataDir });
  }

  const store = ctx.sessionStore;

  ipc.registerHandler(
    'session:list',
    async ({ limit, offset, sortBy, sortOrder, workingDirectory } = {}) => {
      try {
        const wd = workingDirectory || ctx.config.workingDirectory;
        const sessionsDir = store.getProjectSessionsDir(wd);
        const sessions = await listSessions({ sessionsDir, limit, offset, sortBy, sortOrder });
        const total = await countSessions({ sessionsDir });
        return {
          success: true,
          sessions: sessions.map((s) =>
            sessionToMeta({
              sessionId: s.sessionId,
              title: s.title,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              status: s.status,
              messageCount: 0,
              workingDirectory: s.workingDirectory,
              forkedFrom: s.meta?.forkedFrom || null,
              parentSession: s.meta?.parentSession || null,
            }),
          ),
          total,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  ipc.registerHandler('session:load', async ({ sessionId, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const loaded = await store.loadSession(sessionId, wd);
      if (!loaded) {
        return { success: false, error: 'Session not found' };
      }
      return {
        success: true,
        ...formatSessionObject(loaded, wd),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler('session:meta', async ({ sessionId, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const meta = await store.getSessionMeta(sessionId, wd);
      if (!meta) {
        return { success: false, error: 'Session not found' };
      }
      return {
        success: true,
        ...sessionToMeta({
          sessionId,
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt || meta.createdAt,
          status: meta.status,
          messageCount: 0,
          workingDirectory: meta.workingDirectory,
          forkedFrom: meta.forkedFrom || null,
          parentSession: meta.parentSession || null,
        }),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler('session:delete', async ({ sessionId, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const success = await store.deleteSession(sessionId, wd);
      return { success: true, deleted: success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler('session:rename', async ({ sessionId, title, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const success = await store.saveSessionTitle(sessionId, title, wd);
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler(
    'session:fork',
    async ({ sessionId, workingDirectory, forkAtMessageIndex, newTitle } = {}) => {
      try {
        const wd = workingDirectory || ctx.config.workingDirectory;
        const result = await forkSessionFromStore(
          store,
          sessionId,
          wd,
          forkAtMessageIndex,
          newTitle,
        );
        return {
          success: true,
          sessionId: result.sessionId,
          meta: result.meta,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  ipc.registerHandler('session:search', async ({ query, workingDirectory, limit } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const sessionsDir = store.getProjectSessionsDir(wd);
      const sessions = await searchSessions({ sessionsDir, query, limit });
      return {
        success: true,
        sessions: sessions.map((s) =>
          sessionToMeta({
            sessionId: s.sessionId,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            status: s.status,
            messageCount: 0,
            workingDirectory: s.workingDirectory,
            forkedFrom: s.meta?.forkedFrom || null,
            parentSession: s.meta?.parentSession || null,
          }),
        ),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler(
    'session:preview',
    async ({ sessionId, workingDirectory, previewLength } = {}) => {
      try {
        const wd = workingDirectory || ctx.config.workingDirectory;
        const sessionsDir = store.getProjectSessionsDir(wd);
        const preview = await getSessionPreview(sessionId, { sessionsDir, previewLength });
        return {
          success: true,
          preview: preview?.preview || '',
          hasMore: preview?.hasMore || false,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );

  ipc.registerHandler('session:lineage', async ({ sessionId, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const lineage = await getSessionLineageFromStore(store, sessionId, wd);
      return { success: true, lineage };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler('session:children', async ({ sessionId, workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const children = await getSessionChildrenFromStore(store, sessionId, wd);
      return { success: true, children };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler('session:count', async ({ workingDirectory } = {}) => {
    try {
      const wd = workingDirectory || ctx.config.workingDirectory;
      const sessionsDir = store.getProjectSessionsDir(wd);
      const count = await countSessions({ sessionsDir });
      return { success: true, count };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.registerHandler(
    'session:create',
    async ({ sessionId, title, messages, workingDirectory, forkedFrom, parentSession } = {}) => {
      try {
        const wd = workingDirectory || ctx.config.workingDirectory;
        if (sessionId) {
          const existing = await store.loadSession(sessionId, wd);
          if (existing) {
            return {
              success: true,
              sessionId,
              skipped: true,
              reason: 'session_already_exists',
              meta: sessionToMeta(formatSessionObject(existing, wd)),
            };
          }
        }

        const now = Date.now();

        const newMeta = {
          sessionId: sessionId || generateSessionId(),
          title: title || '未命名会话',
          createdAt: now,
          updatedAt: now,
          workingDirectory: wd,
          status: 'pending',
          forkedFrom: forkedFrom || null,
          parentSession: parentSession || null,
        };

        await store.appendMeta(newMeta.sessionId, newMeta, wd);

        if (messages && Array.isArray(messages)) {
          for (const msg of messages) {
            await store.appendMessage(newMeta.sessionId, msg, wd);
          }
        }

        return {
          success: true,
          sessionId: newMeta.sessionId,
          meta: sessionToMeta({
            sessionId: newMeta.sessionId,
            title: newMeta.title,
            createdAt: newMeta.createdAt,
            updatedAt: newMeta.updatedAt,
            status: newMeta.status,
            messageCount: messages?.length || 0,
            workingDirectory: newMeta.workingDirectory,
            forkedFrom: newMeta.forkedFrom,
            parentSession: newMeta.parentSession,
          }),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  );
}
