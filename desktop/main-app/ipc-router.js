/**
 * Electron 主应用 — IPC 路由器模块
 *
 * 职责：
 *   - 初始化 IPC 适配器
 *   - 注册窗口管理处理器（window:minimize/maximize/getState/close/show/hide）
 *   - 对话框处理器（dialog:openFile/saveFile/openDirectory）
 *   - 通知处理器（notification:show）
 *   - 应用信息处理器（app:getInfo/getPath/openExternal）
 *   - 工作目录处理器（workspace:setWorkingDirectory/listDirectory）
 *   - 预览处理器（preview:start/list/stop）
 *   - LLM 配置处理器（llm:getConfigStatus/saveConfig）
 *   - ⌘K 命令面板（command:list/run + metrics:snapshot）
 *   - IPC 事件监听（window-connected/disconnected/error）
 */

import { commandCatalog } from '../../src/core/command-catalog.js';
import { metricsSink } from '../../src/core/metrics-sink.js';
import { getMissingRequiredConfig } from '../../src/core/runtime-config.js';
import { createConfiguredModelProvider } from '../../src/cli/model-provider-factory.js';
import fs from 'fs';
import { exec } from 'child_process';

async function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

export async function initializeIPCAdapter(ctx) {
  console.log('🔗 初始化 IPC 适配器...');

  ctx.ipcAdapter = ctx.desktopCore.attachIPCAdapter(ctx.electron.ipcMain);
  await ctx.ipcAdapter.initialize();

  registerCustomHandlers(ctx);
  registerCommandPalette(ctx);
  setupIPCListeners(ctx);

  if (typeof ctx.startWorkspaceWatcher === 'function') {
    ctx.startWorkspaceWatcher();
  }

  console.log('✅ IPC 适配器初始化完成');
}

export function registerCustomHandlers(ctx) {
  const ipc = ctx.ipcAdapter;
  const { BrowserWindow, dialog, Notification, shell, app } = ctx.electron;

  ipc.registerHandler('ipc:diagnose', async (_payload, sender) => {
    const preloadPath = ctx.config.window?.webPreferences?.preload;
    const senderWindow = sender ? BrowserWindow.fromWebContents(sender) : null;
    const handlerStats = ctx.ipcAdapter?.getStats?.() || null;
    return {
      success: true,
      timestamp: new Date().toISOString(),
      main: {
        pid: process.pid,
        platform: process.platform,
        node: process.versions?.node,
        electron: process.versions?.electron,
        chrome: process.versions?.chrome,
        cwd: process.cwd(),
        debug: ctx.config.debug
      },
      preload: {
        path: preloadPath,
        exists: preloadPath ? await fileExists(preloadPath) : false
      },
      window: {
        windowCount: BrowserWindow.getAllWindows().length,
        senderId: sender?.id,
        senderUrl: sender?.getURL?.(),
        mainWindowId: ctx.mainWindow?.webContents?.id,
        mainWindowUrl: ctx.mainWindow?.webContents?.getURL?.(),
        senderMatchesMainWindow: Boolean(sender && ctx.mainWindow?.webContents === sender),
        senderWindowDestroyed: senderWindow?.isDestroyed?.() || false
      },
      ipc: handlerStats,
      workingDirectory: ctx.config.workingDirectory
    };
  });

  ipc.registerHandler('window:minimize', async () => {
    if (ctx.mainWindow) ctx.mainWindow.minimize();
    return { success: true };
  });

  ipc.registerHandler('window:maximize', async () => {
    if (ctx.mainWindow) {
      if (ctx.mainWindow.isMaximized()) ctx.mainWindow.unmaximize();
      else ctx.mainWindow.maximize();
    }
    // 同步窗口状态广播
    if (typeof ctx.broadcastWindowState === 'function') ctx.broadcastWindowState();
    return { success: true, ...(typeof ctx.getWindowState ? ctx.getWindowState() : {}) };
  });

  ipc.registerHandler('window:getState', async () => {
    return typeof ctx.getWindowState ? ctx.getWindowState() : {};
  });

  ipc.registerHandler('window:close', async () => {
    if (ctx.mainWindow && typeof ctx.handleWindowClose === 'function') {
      ctx.handleWindowClose();
    }
    return { success: true };
  });

  ipc.registerHandler('window:show', async () => {
    if (ctx.mainWindow) {
      ctx.mainWindow.show();
      ctx.mainWindow.focus();
    }
    return { success: true };
  });

  ipc.registerHandler('window:hide', async () => {
    if (ctx.mainWindow) ctx.mainWindow.hide();
    return { success: true };
  });

  // 文件对话框
  ipc.registerHandler('dialog:openFile', async (options) => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: options?.title || '选择文件',
      defaultPath: options?.defaultPath || ctx.config.workingDirectory,
      filters: options?.filters || [
        { name: '所有文件', extensions: ['*'] },
        { name: 'JavaScript', extensions: ['js', 'jsx', 'ts', 'tsx'] },
        { name: '文本文件', extensions: ['txt', 'md', 'json'] }
      ],
      properties: options?.properties || ['openFile', 'multiSelections']
    });
    return result;
  });

  ipc.registerHandler('dialog:saveFile', async (options) => {
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: options?.title || '保存文件',
      defaultPath: options?.defaultPath || ctx.config.workingDirectory,
      filters: options?.filters || [{ name: '所有文件', extensions: ['*'] }]
    });
    return result;
  });

  ipc.registerHandler('dialog:openDirectory', async (options) => {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: options?.title || '选择目录',
      defaultPath: options?.defaultPath || ctx.config.workingDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    return result;
  });

  // 通知
  ipc.registerHandler('notification:show', async (options) => {
    if (ctx.config.notifications) {
      const notification = new Notification({
        title: options?.title || 'AI Agent',
        body: options?.body || '',
        icon: typeof ctx.getIconPath === 'function' ? ctx.getIconPath() : undefined,
        silent: options?.silent || false
      });
      notification.show();
      notification.on('click', () => {
        if (ctx.mainWindow) {
          ctx.mainWindow.show();
          ctx.mainWindow.focus();
        }
      });
    }
    return { success: true };
  });

  // 应用信息
  ipc.registerHandler('app:getInfo', async () => {
    return {
      name: app.name,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      workingDirectory: ctx.config.workingDirectory,
      fileServerUrl: ctx.fileServerUrl,
      electronVersion: process.versions.electron
    };
  });

  ipc.registerHandler('app:getPath', async (name) => {
    return app.getPath(name || 'userData');
  });

  ipc.registerHandler('app:openExternal', async (url) => {
    const href = String(url || '');
    if (!/^https?:\/\//i.test(href)) {
      return { success: false, error: '只允许打开 http(s) 链接' };
    }
    await shell.openExternal(href);
    return { success: true };
  });

  // 工作目录
  ipc.registerHandler('workspace:setWorkingDirectory', async (directory) => {
    return typeof ctx.setWorkingDirectory === 'function'
      ? await ctx.setWorkingDirectory(directory)
      : { success: false, error: 'setWorkingDirectory 未实现' };
  });

  ipc.registerHandler('workspace:listDirectory', async (options = {}) => {
    return typeof ctx.listWorkspaceDirectory
      ? ctx.listWorkspaceDirectory(ctx.config.workingDirectory, options)
      : { success: false, error: 'listWorkspaceDirectory 未实现' };
  });

  // 终端命令执行
  ipc.registerHandler('terminal:execute', async ({ command, cwd }) => {
    return new Promise((resolve) => {
      exec(command, {
        cwd: cwd || ctx.config.workingDirectory,
        timeout: 30000,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        },
      }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error?.code || 0,
        });
      });
    });
  });

  // 预览服务
  ipc.registerHandler('preview:start', async (options = {}) => {
    const preview = await ctx.startPreview({
      workingDirectory: ctx.config.workingDirectory,
      ...options
    });
    ctx.ipcAdapter?.broadcast?.('preview:started', preview);
    return preview;
  });

  ipc.registerHandler('preview:list', async () => {
    return { success: true, previews: typeof ctx.listPreviews ? ctx.listPreviews() : [] };
  });

  ipc.registerHandler('preview:stop', async (sessionId) => {
    const result = typeof ctx.stopPreview === 'function'
      ? await ctx.stopPreview(typeof sessionId === 'object' ? sessionId?.session_id : sessionId)
      : undefined;
    ctx.ipcAdapter?.broadcast?.('preview:stopped', result);
    return result;
  });

  // LLM 配置
  ipc.registerHandler('llm:getConfigStatus', async () => {
    return typeof ctx.getLLMConfigStatus ? ctx.getLLMConfigStatus() : {};
  });

  ipc.registerHandler('llm:saveConfig', async (config) => {
    return typeof ctx.saveLLMConfig ? await ctx.saveLLMConfig(config) : { success: false };
  });

  // 多模型管理
  ipc.registerHandler('llm:list-models', async () => {
    return typeof ctx.readAllModelConfigs ? ctx.readAllModelConfigs() : [];
  });

  ipc.registerHandler('llm:save-model', async (config) => {
    return typeof ctx.saveSingleModelConfig ? ctx.saveSingleModelConfig(config) : { success: false };
  });

  ipc.registerHandler('llm:save-all-models', async (configs) => {
    return typeof ctx.saveAllModelConfigs ? ctx.saveAllModelConfigs(configs) : { success: false };
  });

  ipc.registerHandler('llm:delete-model', async (id) => {
    return typeof ctx.deleteModelConfig ? ctx.deleteModelConfig(id) : { success: false };
  });

  ipc.registerHandler('llm:toggle-model', async ({ id, enabled }) => {
    return typeof ctx.toggleModelConfig ? ctx.toggleModelConfig(id, enabled) : { success: false };
  });

  if (ctx.config.debug) {
    console.log('   注册了自定义 IPC 处理器');
  }
}

export function registerCommandPalette(ctx) {
  const { BrowserWindow } = ctx.electron;

  commandCatalog.register({
    id: 'app.window.minimize', title: '最小化窗口', category: '窗口',
    handler: async () => { ctx.mainWindow?.minimize(); return { success: true }; },
  });
  commandCatalog.register({
    id: 'app.window.toggle-max', title: '切换最大化', category: '窗口',
    handler: async () => {
      const w = ctx.mainWindow;
      if (!w) return { success: false, message: 'no-window' };
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
      return { success: true };
    },
  });
  commandCatalog.register({
    id: 'app.window.toggle-devtools', title: '开发者工具', category: '调试',
    keywords: ['devtools', 'inspect'],
    handler: async () => {
      const w = ctx.mainWindow;
      if (!w) return { success: false, message: 'no-window' };
      if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
      else w.webContents.openDevTools({ mode: 'detach' });
      return { success: true };
    },
  });

  commandCatalog.register({
    id: 'app.session.clear', title: '清空会话', category: '会话',
    keywords: ['reset', 'clear', 'session'],
    handler: async () => {
      const core = ctx.desktopCore;
      if (core?.agent?.reset) await core.agent.reset(true);
      return { success: true, message: 'session cleared' };
    },
  });
  commandCatalog.register({
    id: 'app.session.stop', title: '停止 Agent 执行', category: '会话',
    keywords: ['stop', 'cancel', 'abort'],
    handler: async () => {
      const core = ctx.desktopCore;
      if (core?.agent?.requestStop) core.agent.requestStop();
      return { success: true, message: 'stop requested' };
    },
  });

  commandCatalog.register({
    id: 'app.preview.list', title: '列出正在运行的预览', category: '预览',
    handler: async () => {
      const previews = typeof ctx.listPreviews === 'function' ? ctx.listPreviews() : [];
      return { success: true, data: previews };
    },
  });
  commandCatalog.register({
    id: 'app.preview.stop-all', title: '停止所有预览服务器', category: '预览',
    handler: async () => {
      if (typeof ctx.stopAllPreviews === 'function') ctx.stopAllPreviews();
      return { success: true, message: 'all previews stopped' };
    },
  });

  commandCatalog.register({
    id: 'app.workspace.reload', title: '重新扫描工作区', category: '工作区',
    keywords: ['reload', 'refresh', 'scan'],
    handler: async () => {
      const core = ctx.desktopCore;
      if (core?.agent?.workspaceState) core.agent.workspaceState.clear();
      return { success: true, message: 'workspace state reloaded' };
    },
  });
  commandCatalog.register({
    id: 'app.workspace.status', title: '显示工作区状态', category: '工作区',
    handler: async () => {
      const core = ctx.desktopCore;
      const ws = core?.agent?.workspaceState;
      if (!ws) return { success: false, message: 'no-workspace-state' };
      return { success: true, data: ws.getSummary() };
    },
  });

  if (ctx.ipcAdapter && typeof ctx.ipcAdapter.registerHandler === 'function') {
    ctx.ipcAdapter.registerHandler('command:list', async (payload) => {
      const q = payload?.query || '';
      return { success: true, commands: commandCatalog.filter(q).map(cmd => ({
      id: cmd.id, title: cmd.title, category: cmd.category,
      description: cmd.description, shortcut: cmd.shortcut,
      })) };
    });
    ctx.ipcAdapter.registerHandler('command:run', async (payload) => {
      if (!payload?.id) return { success: false, message: 'missing id' };
      const r = await commandCatalog.run(payload.id, payload.payload || null);
      return r;
    });
    ctx.ipcAdapter.registerHandler('metrics:snapshot', async () => {
      try {
        return { success: true, data: metricsSink.latestSnapshot() };
      } catch (e) {
        return { success: false, message: e.message };
      }
    });
  }
}

export function setupIPCListeners(ctx) {
  const { Notification } = ctx.electron;

  ctx.ipcAdapter.on('window-connected', ({ windowId }) => {
    console.log(`📥 窗口已连接: ${windowId}`);
  });

  ctx.ipcAdapter.on('window-disconnected', ({ windowId }) => {
    console.log(`📤 窗口已断开: ${windowId}`);
  });

  ctx.ipcAdapter.on('error', (error) => {
    console.error('IPC 错误:', error);
    if (ctx.config.notifications) {
      new Notification({
        title: 'AI Agent 错误',
        body: error.message || '发生未知错误',
        icon: typeof ctx.getIconPath ? ctx.getIconPath() : undefined
      }).show();
    }
  });
}
