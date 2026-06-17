/**
 * Electron 主应用 — 预览编排模块
 *
 * 职责：
 *   - startPreview/stopPreview/stopAllPreviews
 *   - listPreviews
 *   - 将预览服务的方法暴露到 ctx 中，供 IPC 处理器调用
 */

import {
  listPreviews as _listPreviews,
  startPreview as _startPreview,
  stopAllPreviews as _stopAllPreviews,
  stopPreview as _stopPreview
} from '../../src/core/preview-server.js';

export function listPreviews() {
  return _listPreviews();
}

export async function startPreview(options) {
  return _startPreview(options);
}

export async function stopPreview(sessionId) {
  return _stopPreview(sessionId);
}

export function stopAllPreviews() {
  return _stopAllPreviews();
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
