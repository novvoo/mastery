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
import { buildWindowConfig } from './window-config.js';

export function setupAppProperties(ctx) {
  const { app } = ctx.electron;

  // 防御性 GPU 配置：在沙箱或受限环境下，GPU 进程可能崩溃导致整个应用退出
  const shouldDisableGpu =
    process.env.DISABLE_GPU === '1' ||
    process.env.ELECTRON_DISABLE_GPU === '1' ||
    process.argv.includes('--disable-gpu') ||
    process.env.TRAE_SANDBOX === '1' ||
    process.env.SANDBOX_INIT === '1' ||
    // 在某些 CI / 容器环境下默认禁用 GPU，避免 GPU 沙箱初始化失败
    (process.env.NODE_ENV === 'test');

  if (shouldDisableGpu) {
    try { app.commandLine.appendSwitch('disable-gpu'); } catch (_) {}
    try { app.commandLine.appendSwitch('disable-software-rasterizer'); } catch (_) {}
    try { app.commandLine.appendSwitch('disable-gpu-compositing'); } catch (_) {}
    console.log('🖥️  GPU 已禁用（避免 GPU 沙箱初始化失败）');
  } else {
    // 即便不禁用 GPU，也添加一些常见的容错开关
    try { app.commandLine.appendSwitch('disable-gpu-sandbox'); } catch (_) {}
  }

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
      if (typeof ctx.handleOpenProject === 'function') {ctx.handleOpenProject();}
    },
    onShowAboutDialog: () => showAboutDialog(ctx),
  });
}

export function createMainWindow(ctx) {
  console.log('📦 创建主窗口...');
  const { BrowserWindow } = ctx.electron;

  const preloadPath = ctx.config.window?.webPreferences?.preload;
  try {
    console.log(`🔍 preload 路径: ${preloadPath}`);
    console.log(`🔍 preload 文件存在: ${fs.existsSync(preloadPath)}`);
    console.log('[IPC-DIAG][main] expected preload entry active:', String(preloadPath || '').endsWith(path.join('preload-entry', 'index.js')));
    console.log('[IPC-DIAG][main] BrowserWindow webPreferences:', sanitizeWebPreferences(ctx.config.window?.webPreferences));
    if (preloadPath && fs.existsSync(preloadPath)) {
      const stat = fs.statSync(preloadPath);
      console.log('[IPC-DIAG][main] preload file stat:', {
        size: stat.size,
        mtime: stat.mtime?.toISOString?.()
      });
    }
  } catch (e) {
    console.log(`🔍 preload 路径检查失败: ${preloadPath}`, e.message);
  }

  ctx.mainWindow = new BrowserWindow({
    ...buildWindowConfig(process.platform, {
      width: ctx.config.window.width,
      height: ctx.config.window.height,
      minWidth: ctx.config.window.minWidth,
      minHeight: ctx.config.window.minHeight,
    }),
    webPreferences: ctx.config.window.webPreferences,
    title: APP_NAME,
    icon: getIconPath(ctx),
  });

  attachIpcDiagnostics(ctx);
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

function sanitizeWebPreferences(webPreferences = {}) {
  return {
    preload: webPreferences.preload,
    nodeIntegration: webPreferences.nodeIntegration,
    contextIsolation: webPreferences.contextIsolation,
    sandbox: webPreferences.sandbox,
    webSecurity: webPreferences.webSecurity,
    partition: webPreferences.partition,
    additionalArguments: webPreferences.additionalArguments
  };
}

function attachIpcDiagnostics(ctx) {
  const webContents = ctx.mainWindow?.webContents;
  if (!webContents) {
    return;
  }

  const logRendererSnapshot = async (stage) => {
    try {
      const snapshot = await webContents.executeJavaScript(`
        (() => ({
          href: location.href,
          readyState: document.readyState,
          hasElectronAPI: !!window.electronAPI,
          electronAPIType: typeof window.electronAPI,
          connectFn: typeof window.electronAPI?.connect,
          invokeFn: typeof window.electronAPI?.invoke,
          diag: window.electronAPI?.__diag || null,
          exposedDiag: window.__masteryPreloadDiag?.get?.() || null,
          userAgent: navigator.userAgent
        }))()
      `, true);
      console.log(`[IPC-DIAG][main] renderer snapshot @${stage}:`, snapshot);
    } catch (error) {
      console.warn(`[IPC-DIAG][main] renderer snapshot failed @${stage}:`, error?.message);
    }
  };

  webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[IPC-DIAG][main] preload-error:', {
      preloadPath,
      message: error?.message,
      stack: error?.stack
    });
  });

  webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const text = String(message || '');
    if (
      text.includes('[Preload]') ||
      text.includes('[IPC-DIAG]') ||
      text.includes('[useIPC]') ||
      text.includes('electronAPI')
    ) {
      console.log('[IPC-DIAG][renderer-console]', {
        level,
        message,
        line,
        sourceId
      });
    }
  });

  webContents.on('did-start-loading', () => {
    console.log('[IPC-DIAG][main] did-start-loading');
  });
  webContents.on('dom-ready', () => {
    console.log('[IPC-DIAG][main] dom-ready');
    logRendererSnapshot('dom-ready');
  });
  webContents.on('did-finish-load', () => {
    console.log('[IPC-DIAG][main] did-finish-load');
    logRendererSnapshot('did-finish-load');
  });
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[IPC-DIAG][main] did-fail-load:', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });
  webContents.on('render-process-gone', (_event, details) => {
    console.error('[IPC-DIAG][main] render-process-gone:', details);
  });
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
      shell.openExternal('https://github.com/novvoo/mastery#readme');
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
