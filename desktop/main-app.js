/**
 * Electron 主进程入口
 * 负责初始化 Runtime、IPC 通信、窗口管理等。
 *
 * 架构：Facade 模式
 *   主类 ElectronMainApp 作为状态容器与协调器。
 *   每个关注点由独立的子模块实现：
 *     - ./main-app/window-lifecycle.js
 *     - ./main-app/ipc-router.js
 *     - ./main-app/workspace-file-server.js
 *     - ./main-app/preview-orchestration.js
 *     - ./main-app/llm-config-and-persistence.js
 *
 * 对外 API：
 *   - electronApp.initialize() — 完整初始化
 *   - electronApp.getDesktopCore() / getIPCAdapter() / getMainWindow()
 *   - electronApp.getState() — 应用状态快照
 *   - electronApp.attachModelProvider(modelProvider)
 *   - electronApp.dispose() — 释放资源
 *
 * 主函数 main() — 应用启动入口
 */

import electron from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getUserEnvPath, loadRuntimeEnv } from '../src/core/runtime-config.js';

import {
  setupAppProperties,
  createMenu,
  createMainWindow,
  createTray,
  setupAppEvents,
  handleWindowClose,
  getWindowState,
  broadcastWindowState,
  getIconPath,
  showAboutDialog,
  cleanup,
  quitApp,
} from './main-app/window-lifecycle.js';

import {
  initializeIPCAdapter,
} from './main-app/ipc-router.js';

import {
  getDefaultWorkingDirectory,
  startFileServer,
  stopFileServer,
  startWorkspaceWatcher,
  setWorkingDirectory,
  handleNewProject,
  handleOpenProject,
  listWorkspaceDirectory,
} from './main-app/workspace-file-server.js';

import { bindPreviewFuncs } from './main-app/preview-orchestration.js';

import {
  initializeDesktopCore,
  createDesktopCore as _createDesktopCore,
  attachConfiguredModelProvider,
  attachModelProvider,
  getLLMConfigStatus,
  saveLLMConfig,
  handleSaveConfig,
  readAppConfig,
  readAllModelConfigs,
  saveAllModelConfigs,
  saveSingleModelConfig,
  deleteModelConfig,
  toggleModelConfig,
} from './main-app/llm-config-and-persistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ElectronMainApp {
  #desktopCore = null;
  #ipcAdapter = null;
  #mainWindow = null;
  #tray = null;
  #config = null;
  #isQuitting = false;
  #userEnvPath = null;
  #workspaceWatcher = null;
  #fileServer = null;
  #fileServerUrl = null;

  constructor(config = {}) {
    this.#userEnvPath = config.userEnvPath || getUserEnvPath();

    // 解析传入 window 配置（来自 savedConfig 等）——深层合并以避免覆盖安全设置
    const inputWindow = config.window || {};
    const inputWebPrefs = inputWindow.webPreferences || {};

    this.#config = {
      workingDirectory: config.workingDirectory || this.#getDefaultWorkingDirectory(),
      debug: config.debug || process.env.NODE_ENV === 'development' || process.argv.includes('--dev'),

      window: {
        width: inputWindow.width || config.windowWidth || 1400,
        height: inputWindow.height || config.windowHeight || 900,
        minWidth: inputWindow.minWidth || config.minWindowWidth || 800,
        minHeight: inputWindow.minHeight || config.minWindowHeight || 600,
        webPreferences: {
          // 允许外部传入覆盖额外字段，但安全项会在下面强制固定。
          ...inputWebPrefs,
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.cjs'),
          sandbox: true,
          webSecurity: true,
        }
      },

      runtime: {
        maxIterations: config.maxIterations || 60,
        autoDownloadModels: config.autoDownloadModels !== false,
        hookTimeout: config.hookTimeout || 5000
      },

      ipc: {
        enabled: true,
        requestTimeout: 30000,
        heartbeatInterval: 30000,
        validateMessages: true
      },

      tray: config.tray !== false,
      notifications: config.notifications !== false,
      autoStart: config.autoStart || false,

      ...config
    };

    // 再次确保 window.webPreferences 的安全设置不被 ...config 覆盖
    this.#config.window.webPreferences = {
      ...(this.#config.window.webPreferences || {}),
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      webSecurity: true
    };
  }

  #getDefaultWorkingDirectory() {
    return getDefaultWorkingDirectory({ electron });
  }

  /**
   * 构建 ctx，让子模块函数可以通过同一引用读写主类状态。
   */
  #ctx() {
    const ctx = {
      electron,
      __dirname,
      __filename,
      config: this.#config,
      userEnvPath: this.#userEnvPath,
      desktopCore: this.#desktopCore,
      ipcAdapter: this.#ipcAdapter,
      mainWindow: this.#mainWindow,
      tray: this.#tray,
      isQuitting: this.#isQuitting,
      workspaceWatcher: this.#workspaceWatcher,
      fileServer: this.#fileServer,
      fileServerUrl: this.#fileServerUrl,
    };

    // 将工具函数绑定到 ctx，供其他子模块（例如 IPC 处理器）调用
    ctx.getWindowState = () => getWindowState(ctx);
    ctx.broadcastWindowState = () => broadcastWindowState(ctx);
    ctx.getIconPath = () => getIconPath(ctx);
    ctx.handleWindowClose = () => handleWindowClose(ctx);
    ctx.handleOpenProject = () => handleOpenProject(ctx);
    ctx.setWorkingDirectory = (dir) => setWorkingDirectory(ctx, dir);
    ctx.startWorkspaceWatcher = () => startWorkspaceWatcher(ctx);
    ctx.createDesktopCore = (opts) => _createDesktopCore(opts);
    ctx.listWorkspaceDirectory = (p, opts) => listWorkspaceDirectory(ctx, p, opts);
    ctx.getLLMConfigStatus = () => getLLMConfigStatus(ctx);
    ctx.saveLLMConfig = (cfg) => saveLLMConfig(ctx, cfg);
    ctx.readAllModelConfigs = () => readAllModelConfigs(ctx);
    ctx.saveAllModelConfigs = (configs) => saveAllModelConfigs(ctx, configs);
    ctx.saveSingleModelConfig = (config) => saveSingleModelConfig(ctx, config);
    ctx.deleteModelConfig = (id) => deleteModelConfig(ctx, id);
    ctx.toggleModelConfig = (id, enabled) => toggleModelConfig(ctx, id, enabled);

    // 预览服务绑定
    bindPreviewFuncs(ctx);

    return new Proxy(ctx, {
      set: (target, prop, value) => {
        target[prop] = value;
        // 同步回主类私有字段
        if (prop === 'desktopCore') this.#desktopCore = value;
        else if (prop === 'ipcAdapter') this.#ipcAdapter = value;
        else if (prop === 'mainWindow') this.#mainWindow = value;
        else if (prop === 'tray') this.#tray = value;
        else if (prop === 'isQuitting') this.#isQuitting = value;
        else if (prop === 'workspaceWatcher') this.#workspaceWatcher = value;
        else if (prop === 'fileServer') this.#fileServer = value;
        else if (prop === 'fileServerUrl') this.#fileServerUrl = value;
        else if (prop === 'config') this.#config = value;
        return true;
      },
    });
  }

  /**
   * 主初始化流程
   */
  async initialize() {
    console.log('🚀 初始化 Electron 主进程应用...');

    const ctx = this.#ctx();

    setupAppProperties(ctx);
    await electron.app.whenReady();

    createMenu(ctx);
    startFileServer(ctx);

    await initializeDesktopCore(ctx);
    await attachConfiguredModelProvider(ctx);
    await initializeIPCAdapter(ctx);

    createMainWindow(ctx);

    if (this.#config.tray) {
      createTray(ctx);
    }

    setupAppEvents(ctx);

    console.log('✅ Electron 主进程应用初始化完成');
    console.log(`   工作目录: ${this.#config.workingDirectory}`);
    console.log(`   状态: ${this.getState().desktopState ? 'running' : 'initializing'}`);
    console.log(`   工具数量: ${this.#desktopCore?.getTools?.()?.length || 0}`);
  }

  attachModelProvider(modelProvider) {
    const ctx = this.#ctx();
    attachModelProvider(ctx, modelProvider);
  }

  getDesktopCore() {
    return this.#desktopCore;
  }

  getIPCAdapter() {
    return this.#ipcAdapter;
  }

  getMainWindow() {
    return this.#mainWindow;
  }

  getState() {
    return {
      desktopState: this.#desktopCore ? (typeof this.#desktopCore.getState === 'function' ? this.#desktopCore.getState() : 'running') : null,
      ipcStats: this.#ipcAdapter?.getStats?.() || null,
      windowVisible: this.#mainWindow?.isVisible?.() || false,
      windowCount: electron.BrowserWindow.getAllWindows().length,
      workingDirectory: this.#config.workingDirectory
    };
  }

  async dispose() {
    return cleanup(this.#ctx());
  }
}

/**
 * 全局未捕获异常处理（关闭期间 stdout/stderr 管道已关闭）
 */
process.on('uncaughtException', (err) => {
  if (err?.code === 'EIO' && err?.syscall === 'write') {
    return;
  }
  console.error('Uncaught Exception:', err);
});

/**
 * 主函数
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          AI Agent Desktop Application                          ║');
  console.log('║          AI Agent 桌面应用                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  try {
    const desktopEnv = { ...process.env };
    delete desktopEnv.AGENT_CONFIG_DIR;
    const desktopUserEnvPath = getUserEnvPath({ env: desktopEnv });
    const { userEnvPath } = loadRuntimeEnv({
      cwd: process.cwd(),
      userEnvPath: desktopUserEnvPath
    });
    console.log(`🔐 已加载运行配置: ${userEnvPath}, ${process.cwd()}`);

    const savedConfig = readAppConfig(electron);
    if (savedConfig.workingDirectory && !fs.existsSync(savedConfig.workingDirectory)) {
      console.warn(`⚠️  已保存的工作目录不存在，使用默认目录: ${savedConfig.workingDirectory}`);
      delete savedConfig.workingDirectory;
    }

    let envWorkingDirectory = null;
    if (process.env.WORKING_DIRECTORY) {
      envWorkingDirectory = path.resolve(process.env.WORKING_DIRECTORY);
      if (!fs.existsSync(envWorkingDirectory)) {
        fs.mkdirSync(envWorkingDirectory, { recursive: true });
      }
    }

    const electronApp = new ElectronMainApp({
      ...savedConfig,
      ...(envWorkingDirectory ? { workingDirectory: envWorkingDirectory } : {}),
      userEnvPath,
      debug: process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
    });

    await electronApp.initialize();
    global.electronApp = electronApp;

  } catch (error) {
    console.error('❌ 初始化失败:', error);
    electron.dialog.showErrorBox('初始化失败', error.message);
    process.exit(1);
  }
}

export { ElectronMainApp, main };
export default ElectronMainApp;
