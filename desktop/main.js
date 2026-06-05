/**
 * Electron 主进程入口
 * 负责初始化 Runtime、IPC 通信、窗口管理等
 */

import { app, BrowserWindow, ipcMain, dialog, Notification, Menu, Tray } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 获取当前目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导入 Desktop Core 和 IPC 适配器
import {
  DesktopCore,
  createDesktopCore,
  DesktopState
} from '../src/adapters/desktop/desktop-core.js';
import {
  MainProcessIPCAdapter,
  createMainProcessIPCAdapter,
  IPCMessageType
} from '../src/adapters/desktop/ipc-adapter.js';
import { RuntimeEvent, getEventBus } from '../src/runtime/index.js';

/**
 * Electron 主进程应用类
 */
class ElectronMainApp {
  #desktopCore = null;
  #ipcAdapter = null;
  #mainWindow = null;
  #tray = null;
  #config = null;
  #isQuitting = false;

  constructor(config = {}) {
    this.#config = {
      workingDirectory: config.workingDirectory || this.#getDefaultWorkingDirectory(),
      debug: config.debug || process.env.NODE_ENV === 'development',
      
      // 窗口配置
      window: {
        width: config.windowWidth || 1400,
        height: config.windowHeight || 900,
        minWidth: config.minWindowWidth || 800,
        minHeight: config.minWindowHeight || 600,
        webPreferences: {
          nodeIntegration: false, // 安全性：禁用 nodeIntegration
          contextIsolation: true, // 安全性：启用 contextIsolation
          preload: path.join(__dirname, 'preload.js'),
          sandbox: true,
          webSecurity: true
        }
      },
      
      // Runtime 配置
      runtime: {
        maxIterations: config.maxIterations || 180,
        autoDownloadModels: config.autoDownloadModels !== false,
        hookTimeout: config.hookTimeout || 5000
      },
      
      // IPC 配置
      ipc: {
        enabled: true,
        requestTimeout: 30000,
        heartbeatInterval: 30000,
        validateMessages: true
      },
      
      // 其他配置
      tray: config.tray !== false,
      notifications: config.notifications !== false,
      autoStart: config.autoStart || false,
      
      ...config
    };
  }

  /**
   * 获取默认工作目录
   */
  #getDefaultWorkingDirectory() {
    // 在打包后的应用中，工作目录应该是用户数据目录
    const userDataPath = app.getPath('userData');
    const projectsPath = path.join(userDataPath, 'projects');
    
    // 确保目录存在
    if (!fs.existsSync(projectsPath)) {
      fs.mkdirSync(projectsPath, { recursive: true });
    }
    
    return projectsPath;
  }

  /**
   * 初始化应用
   */
  async initialize() {
    console.log('🚀 初始化 Electron 主进程应用...');

    // 设置应用属性
    this.#setupAppProperties();

    // 等待 Electron app 就绪
    await app.whenReady();

    // 创建菜单
    this.#createMenu();

    // 创建主窗口
    this.#createMainWindow();

    // 初始化 Desktop Core
    await this.#initializeDesktopCore();

    // 初始化 IPC 适配器
    this.#initializeIPCAdapter();

    // 创建托盘图标（如果启用）
    if (this.#config.tray) {
      this.#createTray();
    }

    // 设置应用事件处理
    this.#setupAppEvents();

    console.log('✅ Electron 主进程应用初始化完成');
    console.log(`   工作目录: ${this.#config.workingDirectory}`);
    console.log(`   状态: ${this.#desktopCore.getState().desktopState}`);
    console.log(`   工具数量: ${this.#desktopCore.getTools().length}`);
  }

  /**
   * 设置应用属性
   */
  #setupAppProperties() {
    // 设置应用 ID
    app.setAppUserModelId('com.ai-agent.desktop');
    
    // 设置应用名称
    if (process.platform === 'win32') {
      app.setAppUserModelId('AI Agent Desktop');
    }
    
    // 禁用硬件加速（可选，用于某些兼容性问题）
    // app.disableHardwareAcceleration();
  }

  /**
   * 创建应用菜单
   */
  #createMenu() {
    const template = [
      // 应用菜单（macOS）
      ...(process.platform === 'darwin' ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }] : []),
      
      // 文件菜单
      {
        label: '文件',
        submenu: [
          {
            label: '新建项目',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.#handleNewProject()
          },
          {
            label: '打开项目',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.#handleOpenProject()
          },
          { type: 'separator' },
          {
            label: '保存配置',
            accelerator: 'CmdOrCtrl+S',
            click: () => this.#handleSaveConfig()
          },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
        ]
      },
      
      // 编辑菜单
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      },
      
      // 视图菜单
      {
        label: '视图',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      
      // 窗口菜单
      {
        label: '窗口',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(process.platform === 'darwin' ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' }
          ] : [
            { role: 'close' }
          ])
        ]
      },
      
      // 帮助菜单
      {
        label: '帮助',
        submenu: [
          {
            label: '文档',
            click: async () => {
              const { shell } = require('electron');
              await shell.openExternal('https://github.com/ai-agent/docs');
            }
          },
          {
            label: '报告问题',
            click: async () => {
              const { shell } = require('electron');
              await shell.openExternal('https://github.com/ai-agent/issues');
            }
          },
          { type: 'separator' },
          {
            label: '关于',
            click: () => this.#showAboutDialog()
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  /**
   * 创建主窗口
   */
  #createMainWindow() {
    console.log('📦 创建主窗口...');

    this.#mainWindow = new BrowserWindow({
      width: this.#config.window.width,
      height: this.#config.window.height,
      minWidth: this.#config.window.minWidth,
      minHeight: this.#config.window.minHeight,
      webPreferences: this.#config.window.webPreferences,
      title: 'AI Agent Desktop',
      icon: this.#getIconPath(),
      show: false, // 先隐藏，加载完成后显示
      frame: true,
      backgroundColor: '#1a1a2e', // 深色背景
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
    });

    // 加载页面
    this.#loadPage();

    // 窗口准备好后显示
    this.#mainWindow.once('ready-to-show', () => {
      this.#mainWindow.show();
      console.log('✅ 主窗口已显示');
      
      // 开发模式下打开 DevTools
      if (this.#config.debug) {
        this.#mainWindow.webContents.openDevTools();
      }
    });

    // 窗口事件处理
    this.#setupWindowEvents();
  }

  /**
   * 加载页面
   */
  #loadPage() {
    if (this.#config.debug) {
      // 开发模式：加载本地开发服务器
      const devServerUrl = process.env.DEV_SERVER_URL || 'http://localhost:5173';
      this.#mainWindow.loadURL(devServerUrl).catch(err => {
        console.error('加载开发服务器失败:', err);
        // 回退到加载本地文件
        this.#mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
      });
    } else {
      // 生产模式：加载打包后的文件
      this.#mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    }
  }

  /**
   * 设置窗口事件
   */
  #setupWindowEvents() {
    // 窗口关闭处理
    this.#mainWindow.on('close', (event) => {
      if (!this.#isQuitting) {
        event.preventDefault();
        this.#handleWindowClose();
      }
    });

    // 窗口已关闭
    this.#mainWindow.on('closed', () => {
      this.#mainWindow = null;
    });

    // 窗口焦点变化
    this.#mainWindow.on('focus', () => {
      // 可以在这里处理窗口获得焦点时的逻辑
    });

    // 窗口失去焦点
    this.#mainWindow.on('blur', () => {
      // 可以在这里处理窗口失去焦点时的逻辑
    });
  }

  /**
   * 处理窗口关闭
   */
  #handleWindowClose() {
    const choice = dialog.showMessageBoxSync(this.#mainWindow, {
      type: 'question',
      buttons: ['最小化到托盘', '退出应用', '取消'],
      title: '确认',
      message: '您想要最小化到托盘还是退出应用？',
      defaultId: 0,
      cancelId: 2
    });

    if (choice === 0) {
      // 最小化到托盘
      this.#mainWindow.hide();
    } else if (choice === 1) {
      // 退出应用
      this.#isQuitting = true;
      app.quit();
    }
  }

  /**
   * 初始化 Desktop Core
   */
  async #initializeDesktopCore() {
    console.log('🔧 初始化 Desktop Core...');

    this.#desktopCore = createDesktopCore({
      workingDirectory: this.#config.workingDirectory,
      debug: this.#config.debug,
      maxIterations: this.#config.runtime.maxIterations,
      autoDownloadModels: this.#config.runtime.autoDownloadModels,
      hookTimeout: this.#config.runtime.hookTimeout,
      ipc: this.#config.ipc
    });

    await this.#desktopCore.initialize();

    console.log('✅ Desktop Core 初始化完成');
  }

  /**
   * 初始化 IPC 适配器
   */
  #initializeIPCAdapter() {
    console.log('🔗 初始化 IPC 适配器...');

    // 附加 IPC 适配器到 Desktop Core
    this.#ipcAdapter = this.#desktopCore.attachIPCAdapter(ipcMain);

    // 注册自定义 IPC 处理器
    this.#registerCustomHandlers();

    // 监听 IPC 事件
    this.#setupIPCListeners();

    console.log('✅ IPC 适配器初始化完成');
  }

  /**
   * 注册自定义 IPC 处理器
   */
  #registerCustomHandlers() {
    // 窗口管理处理器
    this.#ipcAdapter.registerHandler('window:minimize', async () => {
      if (this.#mainWindow) {
        this.#mainWindow.minimize();
      }
      return { success: true };
    });

    this.#ipcAdapter.registerHandler('window:maximize', async () => {
      if (this.#mainWindow) {
        if (this.#mainWindow.isMaximized()) {
          this.#mainWindow.unmaximize();
        } else {
          this.#mainWindow.maximize();
        }
      }
      return { success: true };
    });

    this.#ipcAdapter.registerHandler('window:close', async () => {
      if (this.#mainWindow) {
        this.#handleWindowClose();
      }
      return { success: true };
    });

    this.#ipcAdapter.registerHandler('window:show', async () => {
      if (this.#mainWindow) {
        this.#mainWindow.show();
        this.#mainWindow.focus();
      }
      return { success: true };
    });

    this.#ipcAdapter.registerHandler('window:hide', async () => {
      if (this.#mainWindow) {
        this.#mainWindow.hide();
      }
      return { success: true };
    });

    // 文件对话框处理器
    this.#ipcAdapter.registerHandler('dialog:openFile', async (options) => {
      const result = await dialog.showOpenDialog(this.#mainWindow, {
        title: options?.title || '选择文件',
        defaultPath: options?.defaultPath || this.#config.workingDirectory,
        filters: options?.filters || [
          { name: '所有文件', extensions: ['*'] },
          { name: 'JavaScript', extensions: ['js', 'jsx', 'ts', 'tsx'] },
          { name: '文本文件', extensions: ['txt', 'md', 'json'] }
        ],
        properties: options?.properties || ['openFile', 'multiSelections']
      });
      return result;
    });

    this.#ipcAdapter.registerHandler('dialog:saveFile', async (options) => {
      const result = await dialog.showSaveDialog(this.#mainWindow, {
        title: options?.title || '保存文件',
        defaultPath: options?.defaultPath || this.#config.workingDirectory,
        filters: options?.filters || [
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      return result;
    });

    this.#ipcAdapter.registerHandler('dialog:openDirectory', async (options) => {
      const result = await dialog.showOpenDialog(this.#mainWindow, {
        title: options?.title || '选择目录',
        defaultPath: options?.defaultPath || this.#config.workingDirectory,
        properties: ['openDirectory', 'createDirectory']
      });
      return result;
    });

    // 通知处理器
    this.#ipcAdapter.registerHandler('notification:show', async (options) => {
      if (this.#config.notifications) {
        const notification = new Notification({
          title: options?.title || 'AI Agent',
          body: options?.body || '',
          icon: this.#getIconPath(),
          silent: options?.silent || false
        });
        notification.show();
        
        notification.on('click', () => {
          if (this.#mainWindow) {
            this.#mainWindow.show();
            this.#mainWindow.focus();
          }
        });
      }
      return { success: true };
    });

    // 应用信息处理器
    this.#ipcAdapter.registerHandler('app:getInfo', async () => {
      return {
        name: app.name,
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        workingDirectory: this.#config.workingDirectory,
        electronVersion: process.versions.electron
      };
    });

    this.#ipcAdapter.registerHandler('app:getPath', async (name) => {
      return app.getPath(name || 'userData');
    });

    // 工作目录处理器
    this.#ipcAdapter.registerHandler('workspace:setWorkingDirectory', async (directory) => {
      if (fs.existsSync(directory)) {
        this.#config.workingDirectory = directory;
        
        // 重新初始化 Desktop Core
        if (this.#desktopCore) {
          await this.#desktopCore.dispose();
        }
        
        this.#desktopCore = createDesktopCore({
          workingDirectory: directory,
          debug: this.#config.debug,
          ...this.#config.runtime
        });
        
        await this.#desktopCore.initialize();
        
        return { success: true, workingDirectory: directory };
      }
      
      return { success: false, error: '目录不存在' };
    });

    if (this.#config.debug) {
      console.log('   注册了自定义 IPC 处理器');
    }
  }

  /**
   * 设置 IPC 监听器
   */
  #setupIPCListeners() {
    // 监听窗口连接
    this.#ipcAdapter.on('window-connected', ({ windowId }) => {
      console.log(`📥 窗口已连接: ${windowId}`);
    });

    // 监听窗口断开
    this.#ipcAdapter.on('window-disconnected', ({ windowId }) => {
      console.log(`📤 窗口已断开: ${windowId}`);
    });

    // 监听错误
    this.#ipcAdapter.on('error', (error) => {
      console.error('IPC 错误:', error);
      
      // 显示错误通知
      if (this.#config.notifications) {
        new Notification({
          title: 'AI Agent 错误',
          body: error.message || '发生未知错误',
          icon: this.#getIconPath()
        }).show();
      }
    });
  }

  /**
   * 创建托盘图标
   */
  #createTray() {
    console.log('🎯 创建托盘图标...');
    
    try {
      const iconPath = this.#getIconPath();
      if (iconPath) {
        this.#tray = new Tray(iconPath);
      } else {
        console.warn('⚠️  找不到图标文件，跳过托盘图标创建');
        return; // 跳过托盘创建
      }
    } catch (error) {
      console.warn('⚠️  创建托盘图标失败:', error.message);
      return; // 如果创建失败，继续运行而不崩溃
    }
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          if (this.#mainWindow) {
            this.#mainWindow.show();
            this.#mainWindow.focus();
          }
        }
      },
      {
        label: '新建任务',
        click: () => {
          if (this.#mainWindow) {
            this.#mainWindow.show();
            this.#mainWindow.focus();
            // 发送事件到渲染进程
            this.#ipcAdapter.broadcast('app:newTask', {});
          }
        }
      },
      { type: 'separator' },
      {
        label: '状态',
        submenu: [
          { label: '就绪', enabled: false },
          { label: `工作目录: ${this.#config.workingDirectory}`, enabled: false }
        ]
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.#isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.#tray.setToolTip('AI Agent Desktop');
    this.#tray.setContextMenu(contextMenu);

    // 点击托盘图标显示窗口
    this.#tray.on('click', () => {
      if (this.#mainWindow) {
        if (this.#mainWindow.isVisible()) {
          this.#mainWindow.hide();
        } else {
          this.#mainWindow.show();
          this.#mainWindow.focus();
        }
      }
    });

    // 双击托盘图标
    this.#tray.on('double-click', () => {
      if (this.#mainWindow) {
        this.#mainWindow.show();
        this.#mainWindow.focus();
      }
    });
  }

  /**
   * 设置应用事件处理
   */
  #setupAppEvents() {
    // macOS 激活应用
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.#createMainWindow();
      } else if (this.#mainWindow) {
        this.#mainWindow.show();
      }
    });

    // 所有窗口关闭
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.#quit();
      }
    });

    // 应用退出前
    app.on('before-quit', async () => {
      this.#isQuitting = true;
      await this.#cleanup();
    });

    // 应用将退出
    app.on('will-quit', async () => {
      await this.#cleanup();
    });

    // 安全性：阻止导航到外部 URL
    app.on('web-contents-created', (event, contents) => {
      contents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        if (parsedUrl.origin !== 'http://localhost:5173' && parsedUrl.protocol !== 'file:') {
          event.preventDefault();
        }
      });
    });
  }

  /**
   * 获取图标路径
   */
  #getIconPath() {
    const iconName = process.platform === 'win32' ? 'icon.ico' : 
                     process.platform === 'darwin' ? 'icon.icns' : 'icon.png';
    const iconPath = path.join(__dirname, 'build', iconName);
    // 如果图标不存在，返回 undefined，Electron 会使用默认图标
    return fs.existsSync(iconPath) ? iconPath : undefined;
  }

  /**
   * 处理新建项目
   */
  async #handleNewProject() {
    const result = await dialog.showOpenDialog(this.#mainWindow, {
      title: '选择新项目目录',
      defaultPath: this.#config.workingDirectory,
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const newProjectPath = result.filePaths[0];
      
      // 创建项目目录结构
      const subdirs = ['src', 'tests', 'docs', '.agent-data'];
      for (const subdir of subdirs) {
        const fullPath = path.join(newProjectPath, subdir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      }

      // 更新工作目录
      await this.#ipcAdapter.invoke('workspace:setWorkingDirectory', newProjectPath);
      
      // 通知渲染进程
      this.#ipcAdapter.broadcast('app:projectCreated', { path: newProjectPath });
    }
  }

  /**
   * 处理打开项目
   */
  async #handleOpenProject() {
    const result = await dialog.showOpenDialog(this.#mainWindow, {
      title: '选择项目目录',
      defaultPath: this.#config.workingDirectory,
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const projectPath = result.filePaths[0];
      
      // 更新工作目录
      await this.#ipcAdapter.invoke('workspace:setWorkingDirectory', projectPath);
      
      // 通知渲染进程
      this.#ipcAdapter.broadcast('app:projectOpened', { path: projectPath });
    }
  }

  /**
   * 处理保存配置
   */
  async #handleSaveConfig() {
    // 这里可以保存应用配置到文件
    const configPath = path.join(app.getPath('userData'), 'config.json');
    
    try {
      const configData = {
        workingDirectory: this.#config.workingDirectory,
        window: {
          width: this.#mainWindow?.getSize()[0] || this.#config.window.width,
          height: this.#mainWindow?.getSize()[1] || this.#config.window.height
        },
        runtime: this.#config.runtime
      };
      
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
      
      dialog.showMessageBox(this.#mainWindow, {
        type: 'info',
        title: '保存成功',
        message: '配置已保存',
        buttons: ['确定']
      });
    } catch (error) {
      dialog.showErrorBox('保存失败', error.message);
    }
  }

  /**
   * 显示关于对话框
   */
  #showAboutDialog() {
    dialog.showMessageBox(this.#mainWindow, {
      type: 'info',
      title: '关于 AI Agent Desktop',
      message: `AI Agent Desktop v${app.getVersion()}`,
      detail: `AI Engineering Mastery Agent - Electron 桌面应用\n\n平台: ${process.platform}\n架构: ${process.arch}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}`,
      buttons: ['确定', '查看文档']
    }).then(result => {
      if (result.response === 1) {
        const { shell } = require('electron');
        shell.openExternal('https://github.com/ai-agent/docs');
      }
    });
  }

  /**
   * 附加模型提供者
   */
  attachModelProvider(modelProvider) {
    if (this.#desktopCore) {
      this.#desktopCore.attachModelProvider(modelProvider);
      console.log('✅ 模型提供者已附加');
    }
  }

  /**
   * 获取 Desktop Core
   */
  getDesktopCore() {
    return this.#desktopCore;
  }

  /**
   * 获取 IPC 适配器
   */
  getIPCAdapter() {
    return this.#ipcAdapter;
  }

  /**
   * 获取主窗口
   */
  getMainWindow() {
    return this.#mainWindow;
  }

  /**
   * 获取应用状态
   */
  getState() {
    return {
      desktopState: this.#desktopCore ? this.#desktopCore.getState() : null,
      ipcStats: this.#ipcAdapter ? this.#ipcAdapter.getStats() : null,
      windowVisible: this.#mainWindow ? this.#mainWindow.isVisible() : false,
      windowCount: BrowserWindow.getAllWindows().length,
      workingDirectory: this.#config.workingDirectory
    };
  }

  /**
   * 清理资源
   */
  async #cleanup() {
    console.log('🧹 清理资源...');

    if (this.#desktopCore) {
      await this.#desktopCore.dispose();
      this.#desktopCore = null;
    }

    if (this.#ipcAdapter) {
      this.#ipcAdapter.disconnect();
      this.#ipcAdapter = null;
    }

    if (this.#tray) {
      this.#tray.destroy();
      this.#tray = null;
    }

    console.log('✅ 资源清理完成');
  }

  /**
   * 退出应用
   */
  async #quit() {
    await this.#cleanup();
    app.quit();
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          AI Agent Desktop Application                          ║');
  console.log('║          AI Agent 桌面应用                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  try {
    // 加载保存的配置（如果有）
    let savedConfig = {};
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (fs.existsSync(configPath)) {
        savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (err) {
      console.log('未找到保存的配置，使用默认配置');
    }

    // 创建应用实例
    const electronApp = new ElectronMainApp({
      ...savedConfig,
      debug: process.env.NODE_ENV === 'development'
    });

    // 初始化应用
    await electronApp.initialize();

    // 导出全局引用（用于调试）
    global.electronApp = electronApp;

  } catch (error) {
    console.error('❌ 初始化失败:', error);
    
    dialog.showErrorBox('初始化失败', error.message);
    
    process.exit(1);
  }
}

// 启动应用
main();

// 导出供其他模块使用
export { ElectronMainApp };