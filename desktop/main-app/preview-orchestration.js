/**
 * Electron 主应用 — 预览编排模块
 *
 * 职责：
 *   - startPreview/stopPreview/stopAllPreviews
 *   - listPreviews
 *   - 将预览服务的方法暴露到 ctx 中，供 IPC 处理器调用
 */

const previews = new Map();

export function listPreviews() {
  return [...previews.values()];
}

export async function startPreview(options) {
  return { success: false, error: '旧预览运行器已移除，请让 OMP 启动开发服务器后在预览栏输入本地 URL', options };
}

export async function stopPreview(sessionId) {
  const stopped = previews.delete(sessionId);
  return { success: stopped, sessionId };
}

export function stopAllPreviews() {
  previews.clear();
  return { success: true };
}

/**
 * 将预览服务方法绑定到 ctx 对象上，供其他子模块（如 ipc-router）调用。
 * 用法：在主类 initialize 中调用 `bindPreviewFuncs(ctx);`
 */
export function bindPreviewFuncs(ctx) {
  ctx.listPreviews = listPreviews;
  ctx.startPreview = startPreview;
  ctx.stopPreview = stopPreview;
  ctx.stopAllPreviews = stopAllPreviews;
}
