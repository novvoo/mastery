export function registerSessionHandlers(ctx) {
  const ipc = ctx.ipcAdapter;
  const engine = () => ctx.desktopCore?.getEngine?.();

  ipc.registerHandler('session:create', async (payload = {}) => {
    const result = await engine()?.newSession?.();
    if (payload.title) await engine()?.setSessionName?.(payload.title);
    return { success: true, sessionId: engine()?.getSessionId?.(), result };
  });
  ipc.registerHandler('session:rename', async ({ title } = {}) => {
    await engine()?.setSessionName?.(title || '未命名会话');
    return { success: true };
  });
  ipc.registerHandler('session:stats', async () => engine()?.getSessionStats?.() || {});
  ipc.registerHandler('session:list', async () => ({ sessions: engine()?.listSessions?.() || [] }));
  ipc.registerHandler('session:load', async ({ sessionId, sessionPath } = {}) => {
    const session = (engine()?.listSessions?.() || []).find((item) => item.id === sessionId || item.sessionPath === sessionPath);
    if (!session) return null;
    await engine().switchSession(session.sessionPath);
    return { ...session, messages: await engine().getMessages() };
  });
  ipc.registerHandler('session:meta', async ({ sessionId } = {}) => (engine()?.listSessions?.() || []).find((item) => item.id === sessionId) || null);
  ipc.registerHandler('session:search', async ({ query = '', limit = 20 } = {}) => ({ sessions: (engine()?.listSessions?.() || []).filter((item) => item.title.toLowerCase().includes(String(query).toLowerCase())).slice(0, limit) }));
  ipc.registerHandler('session:delete', async ({ sessionId, sessionPath } = {}) => {
    const session = (engine()?.listSessions?.() || []).find((item) => item.id === sessionId || item.sessionPath === sessionPath);
    return session ? engine().deleteSession(session.sessionPath) : { success: false, error: '会话不存在' };
  });
  ipc.registerHandler('session:fork', async ({ entryId } = {}) => engine()?.branchSession?.(entryId));
}
