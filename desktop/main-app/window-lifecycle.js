/**
 * Electron 主应用 — 窗口生命周期模块
 *
 * 职责：
 *   - 主窗口创建、页面加载、窗口事件
 *   - 窗口状态广播（maximize/minimize/fullscreen）
 *   - 托盘图标与上下文菜单
 *   - 应用属性设置、应用菜单、关于对话框
 *   - 全局事件监听（activate/window-all-closed/web-contents-created）
 *   - 资源清理与退出
 */

import path from 'path';
import fs from 'fs';
import { APP_NAME, APP_COPYRIGHT, APP_CREDITS } from '../app-metadata.js';
import { createApplicationMenu } from '../menu.js';

export function setupAppProperties(ctx) {
  const { app } = ctx.electron;
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: APP_COPYRIGHT,
    credits: APP_CREDITS
  });
  app.setAppUserModelId('com.ai-agent.desktop');
  if (process.platform === 'win32') {
    app.setAppUserModelId('AI Agent Desktop');
  }
}

export function createMenu(ctx) {
  createApplicationMenu({
    onOpenProject: () => {
      // 延迟注入：由主类提供的 handleOpenProject 回调
      if (typeof ctx.handleOpenProject === 'function') ctx.handleOpenProject();
    },
    onShowAboutDialog: () => showAboutDialog(ctx),
  });
}

export function createMainWindow(ctx) {
  console.log('📦 创建主窗口...');
  const { BrowserWindow } = ctx.electron;

  ctx.mainWindow = new BrowserWindow({
    width: ctx.config.window.width,
    height: ctx.config.window.height,
    minWidth: ctx.config.window.minWidth,
    minHeight: ctx.config.window.minHeight,
    webPreferences: ctx.config.window.webPreferences,
    title: APP_NAME,
    icon: getIconPath(ctx),
    show: false,
    frame: true,
    backgroundColor: '#1a1a2e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

  loadPage(ctx);

  ctx.mainWindow.once('ready-to-show', () => {
    ctx.mainWindow.show();
    console.log('✅ 主窗口已显示');
    if (ctx.config.debug) {
      ctx.mainWindow.webContents.openDevTools();
    }
  });

  setupWindowEvents(ctx);
}

export function loadPage(ctx) {
  if (ctx.config.debug) {
    const devServerUrl = process.env.DEV_SERVER_URL || 'http://127.0.0.1:5173';
    ctx.mainWindow.loadURL(devServerUrl).catch(err => {
      console.error('加载开发服务器失败:', err);
    });
  } else {
    const rendererEntry = path.join(ctx.__dirname, 'renderer', 'dist', 'index.html');
    if (!fs.existsSync(rendererEntry)) {
      throw new Error(`找不到渲染进程入口文件: ${rendererEntry}。请先运行 bun run desktop:renderer:build。`);
    }
    ctx.mainWindow.loadFile(rendererEntry);
  }
}

export function getWindowState(ctx) {
  return {
    isFullScreen: Boolean(ctx.mainWindow?.isFullScreen?.()),
    isMaximized: Boolean(ctx.mainWindow?.isMaximized?.()),
    platform: process.platform
  };
}

export function broadcastWindowState(ctx) {
  if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) {
    return;
  }
  ctx.mainWindow.webContents.send('window:state', getWindowState(ctx));
}

export function setupWindowEvents(ctx) {
  const { shell, BrowserWindow } = ctx.electron;

  ctx.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const urlLower = String(url || '').toLowerCase();
    const isDevServer = urlLower.startsWith('http://localhost:5173') ||
      urlLower.startsWith('http://127.0.0.1:5173');
    const isLocalPreview = /^http:\/\/(localhost|127\.0\.0\.1):/i.test(urlLower);
    const isSafeScheme = /^(file:|about:|data:|blob:)/i.test(urlLower);

    if (isDevServer || isLocalPreview || isSafeScheme) {
      return { action: 'allow', overrideBrowserWindowOptions: { show: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  ctx.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const urlLower = String(navigationUrl || '').toLowerCase();
    const isDevServer = urlLower.startsWith('http://localhost:5173') ||
      urlLower.startsWith('http://127.0.0.1:5173');
    const isLocalPreview = /^http:\/\/(localhost|127\.0\.0\.1):/i.test(urlLower);
    const isFile = /^file:/i.test(urlLower);

    if (!isDevServer && !isFile && !isLocalPreview) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  ctx.mainWindow.on('close', (event) => {
    if (!ctx.isQuitting) {
      event.preventDefault();
      handleWindowClose(ctx);
    }
  });

  ctx.mainWindow.on('closed', () => {
    ctx.mainWindow = null;
  });

  ctx.mainWindow.on('maximize', () => broadcastWindowState(ctx));
  ctx.mainWindow.on('unmaximize', () => broadcastWindowState(ctx));
  ctx.mainWindow.on('enter-full-screen', () => broadcastWindowState(ctx));
  ctx.mainWindow.on('leave-full-screen', () => broadcastWindowState(ctx));
  ctx.mainWindow.on('restore', () => broadcastWindowState(ctx));
  ctx.mainWindow.once('ready-to-show', () => broadcastWindowState(ctx));
}

export function handleWindowClose(ctx) {
  if (process.platform === 'darwin') {
    ctx.mainWindow.hide();
    return;
  }

  const { dialog } = ctx.electron;
  const choice = dialog.showMessageBoxSync(ctx.mainWindow, {
    type: 'question',
    buttons: ['最小化到托盘', '退出应用', '取消'],
    title: '确认',
    message: '您想要最小化到托盘还是退出应用？',
    defaultId: 0,
    cancelId: 2
  });

  if (choice === 0) {
    ctx.mainWindow.hide();
  } else if (choice === 1) {
    ctx.isQuitting = true;
    ctx.electron.app.quit();
  }
}

export function createTray(ctx) {
  console.log('🎯 创建托盘图标...');
  const { Tray, Menu, app } = ctx.electron;

  try {
    const iconPath = getIconPath(ctx);
    if (iconPath) {
      ctx.tray = new Tray(iconPath);
    } else {
      console.warn('⚠️  找不到图标文件，跳过托盘图标创建');
      return;
    }
  } catch (error) {
    console.warn('⚠️  创建托盘图标失败:', error.message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (ctx.mainWindow) {
          ctx.mainWindow.show();
          ctx.mainWindow.focus();
        }
      }
    },
    {
      label: '新建任务',
      click: () => {
        if (ctx.mainWindow) {
          ctx.mainWindow.show();
          ctx.mainWindow.focus();
          ctx.ipcAdapter?.broadcast?.('app:newTask', {});
        }
      }
    },
    { type: 'separator' },
    {
      label: '状态',
      submenu: [
        { label: '就绪', enabled: false },
        { label: `工作目录: ${ctx.config.workingDirectory}`, enabled: false }
      ]
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        ctx.isQuitting = true;
        app.quit();
      }
    }
  ]);

  ctx.tray.setToolTip('AI Agent Desktop');
  ctx.tray.setContextMenu(contextMenu);

  ctx.tray.on('click', () => {
    if (ctx.mainWindow) {
      if (ctx.mainWindow.isVisible()) {
        ctx.mainWindow.hide();
      } else {
        ctx.mainWindow.show();
        ctx.mainWindow.focus();
      }
    }
  });

  ctx.tray.on('double-click', () => {
    if (ctx.mainWindow) {
      ctx.mainWindow.show();
      ctx.mainWindow.focus();
    }
  });
}

export function setupAppEvents(ctx) {
  const { app, shell, BrowserWindow } = ctx.electron;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(ctx);
    } else if (ctx.mainWindow) {
      ctx.mainWindow.show();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      quitApp(ctx);
    }
  });

  app.on('before-quit', async () => {
    ctx.isQuitting = true;
    await cleanup(ctx);
  });

  app.on('will-quit', async () => {
    await cleanup(ctx);
  });

  // 全局 webContents 安全拦截
  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const parsed = new URL(url);
      const devOrigins = new Set([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]);
      const isLocalPreview = parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname);
      const isSafeScheme = ['file:', 'about:', 'data:', 'blob:'].includes(parsed.protocol);

      if (devOrigins.has(parsed.origin) || isLocalPreview || isSafeScheme) {
        return { action: 'allow', overrideBrowserWindowOptions: { show: true } };
      }

      shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      const allowedDevOrigins = new Set([
        'http://localhost:5173',
        'http://127.0.0.1:5173'
      ]);
      const isLocalPreview = parsedUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);

      if (!allowedDevOrigins.has(parsedUrl.origin) && parsedUrl.protocol !== 'file:' && !isLocalPreview) {
        event.preventDefault();
        shell.openExternal(navigationUrl);
      }
    });
  });
}

export function getIconPath(ctx) {
  const iconName = process.platform === 'win32' ? 'icon.ico' :
    process.platform === 'darwin' ? 'icon.icns' : 'icon.png';
  const iconPath = path.join(ctx.__dirname, 'build', iconName);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

export function showAboutDialog(ctx) {
  const { dialog, shell, app } = ctx.electron;
  dialog.showMessageBox(ctx.mainWindow, {
    type: 'info',
    title: '关于 AI Agent Desktop',
    message: `AI Agent Desktop v${app.getVersion()}`,
    detail: `AI Engineering Mastery Agent 桌面应用\n\n平台: ${process.platform}\n架构: ${process.arch}\n运行时: ${process.versions.node}`,
    buttons: ['确定', '查看文档']
  }).then(result => {
    if (result.response === 1) {
      shell.openExternal('https://github.com/novvoo/ai-engineering-mastery-agent#readme');
    }
  });
}

export async function cleanup(ctx) {
  try { console.log('🧹 清理资源...'); } catch { /* EIO during shutdown */ }

  if (ctx.workspaceWatcher) {
    ctx.workspaceWatcher.close();
    ctx.workspaceWatcher = null;
  }

  if (typeof ctx.stopAllPreviews === 'function') {
    try { ctx.stopAllPreviews(); } catch (_) {}
  }

  if (ctx.desktopCore) {
    try { await ctx.desktopCore.dispose(); } catch (_) {}
    ctx.desktopCore = null;
  }

  if (ctx.ipcAdapter) {
    try { ctx.ipcAdapter.disconnect(); } catch (_) {}
    ctx.ipcAdapter = null;
  }

  if (ctx.tray) {
    try { ctx.tray.destroy(); } catch (_) {}
    ctx.tray = null;
  }

  try { console.log('✅ 资源清理完成'); } catch { /* EIO during shutdown */ }
}

export async function quitApp(ctx) {
  await cleanup(ctx);
  ctx.electron.app.quit();
}
