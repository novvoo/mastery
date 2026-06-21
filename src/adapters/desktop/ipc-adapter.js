/**
 * Desktop IPC Adapter public entrypoint.
 *
 * Implementation is split by process role under ./ipc/ so runtime-facing
 * boundaries stay small while this legacy import path remains stable.
 */

export { IPCMessage, IPCMessageStatus, IPCMessageType, MessageQueue } from './protocol/ipc-protocol.js';
export { IPCAdapterBase } from './ipc/base-adapter.js';
export { MainProcessIPCAdapter } from './ipc/main-process-adapter.js';
export { RendererProcessIPCAdapter } from './ipc/renderer-process-adapter.js';

import { MainProcessIPCAdapter } from './ipc/main-process-adapter.js';
import { RendererProcessIPCAdapter } from './ipc/renderer-process-adapter.js';

/**
 * 创建主进程 IPC 适配器
 */
export function createMainProcessIPCAdapter(ipcMain, eventBus, config = {}) {
  return new MainProcessIPCAdapter(ipcMain, eventBus, config);
}

/**
 * 创建渲染进程 IPC 适配器
 */
export function createRendererProcessIPCAdapter(ipcRenderer, config = {}) {
  return new RendererProcessIPCAdapter(ipcRenderer, config);
}

/**
 * DesktopIPCAdapter - 兼容旧版本的适配器
 * @deprecated 使用 MainProcessIPCAdapter 替代
 */
export class DesktopIPCAdapter extends MainProcessIPCAdapter {
  constructor(eventBus, ipcMain) {
    super(ipcMain, eventBus);
    console.warn('[DEPRECATED] DesktopIPCAdapter 已弃用，请使用 MainProcessIPCAdapter');
  }
}
