#!/usr/bin/env bun
/**
 * Electron 主进程入口示例
 * 展示如何在 Electron 主进程中初始化 Runtime 和 IPC
 * 
 * 注意：这是一个示例文件，实际使用需要安装 Electron
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

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

// 获取当前目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Electron 主进程应用类
 */
class ElectronMainApp {
  #desktopCore;
  #ipcAdapter;
  #mainWindow;
  #config;

  constructor(config = {}) {
    this.#config = {
      workingDirectory: config.workingDirectory || process.cwd(),
      debug: config.debug || true,
      windowConfig: {
        width: config.windowWidth || 1200,
        height: config.windowHeight || 800,
        webPreferences: {
          nodeIntegration: false, // 安全性：禁用 nodeIntegration
          contextIsolation: true, // 安全性：启用 contextIsolation
          preload: path.join(__dirname, 'preload.js')
        }
      },
      ...config
    };
  }

  /**
   * 初始化应用
   */
  async initialize() {
    console.log('🚀 初始化 Electron 主进程应用...');

    // 等待 Electron app 就绪
    await app.whenReady();

    // 创建主窗口
    this.#createMainWindow();

    // 初始化 Desktop Core
    await this.#initializeDesktopCore();

    // 初始化 IPC 适配器
    this.#initializeIPCAdapter();

    // 设置应用事件处理
    this.#setupAppEvents();

    console.log('✅ Electron 主进程应用初始化完成');
  }

  /**
   * 创建主窗口
   */
  #createMainWindow() {
    console.log('📦 创建主窗口...');

    this.#mainWindow = new BrowserWindow({
      width: this.#config.windowConfig.width,
      height: this.#config.windowConfig.height,
      webPreferences: this.#config.windowConfig.webPreferences,
      title: 'AI Agent Desktop',
      show: false // 先隐藏，加载完成后显示
    });

    // 加载页面
    if (this.#config.debug) {
      // 开发模式：加载本地开发服务器
      this.#mainWindow.loadURL('http://localhost:3000');
      this.#mainWindow.webContents.openDevTools();
    } else {
      // 生产模式：加载打包后的文件
      this.#mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 窗口准备好后显示
    this.#mainWindow.once('ready-to-show', () => {
      this.#mainWindow.show();
      console.log('✅ 主窗口已显示');
    });

    // 窗口关闭处理
    this.#mainWindow.on('closed', () => {
      this.#mainWindow = null;
    });
  }

  /**
   * 初始化 Desktop Core
   */
  async #initializeDesktopCore() {
    console.log('🔧 初始化 Desktop Core...');

    this.#desktopCore = createDesktopCore({
      workingDirectory: this.#config.workingDirectory,
      debug: this.#config.debug,
      maxIterations: 180,
      ipc: {
        enabled: true,
        requestTimeout: 30000,
        heartbeatInterval: 30000,
        validateMessages: true
      }
    });

    await this.#desktopCore.initialize();

    console.log('✅ Desktop Core 初始化完成');
    console.log(`   状态: ${this.#desktopCore.getState().desktopState}`);
    console.log(`   工具数量: ${this.#desktopCore.getTools().length}`);
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
    // 注册窗口管理处理器
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
        this.#mainWindow.close();
      }
      return { success: true };
    });

    // 注册文件对话框处理器
    this.#ipcAdapter.registerHandler('dialog:openFile', async (options) => {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(this.#mainWindow, options);
      return result;
    });

    this.#ipcAdapter.registerHandler('dialog:saveFile', async (options) => {
      const { dialog } = require('electron');
      const result = await dialog.showSaveDialog(this.#mainWindow, options);
      return result;
    });

    // 注册通知处理器
    this.#ipcAdapter.registerHandler('notification:show', async (options) => {
      const { Notification } = require('electron');
      const notification = new Notification(options);
      notification.show();
      return { success: true };
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
      await this.#cleanup();
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
      windowCount: BrowserWindow.getAllWindows().length
    };
  }

  /**
   * 清理资源
   */
  async #cleanup() {
    console.log('🧹 清理资源...');

    if (this.#desktopCore) {
      await this.#desktopCore.dispose();
    }

    if (this.#ipcAdapter) {
      this.#ipcAdapter.disconnect();
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
 * preload.js 示例内容
 * 用于在渲染进程中安全地暴露 IPC 接口
 */
const preloadExample = `
/**
 * Electron preload script
 * 安全地暴露 IPC 接口到渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

// 定义允许的 IPC 频道（安全性：白名单机制）
const ALLOWED_CHANNELS = {
  // 请求频道
  invoke: [
    'ipc:connect',
    'agent:processInput',
    'agent:stop',
    'agent:getState',
    'agent:getTools',
    'system:getStats',
    'window:minimize',
    'window:maximize',
    'window:close',
    'dialog:openFile',
    'dialog:saveFile',
    'notification:show'
  ],
  
  // 发送频道
  send: [
    'ipc:disconnect',
    'ipc:subscribe',
    'ipc:unsubscribe',
    'ipc:request',
    'ipc:heartbeat'
  ],
  
  // 接收频道
  receive: [
    'ipc:response',
    'ipc:error',
    'ipc:event',
    'ipc:heartbeat'
  ]
};

// 验证频道是否在白名单中
function isValidChannel(type, channel) {
  return ALLOWED_CHANNELS[type]?.includes(channel);
}

// 暴露安全的 IPC 接口
contextBridge.exposeInMainWorld('electronAPI', {
  // 连接
  connect: async () => {
    return await ipcRenderer.invoke('ipc:connect');
  },
  
  // 断开连接
  disconnect: () => {
    ipcRenderer.send('ipc:disconnect');
  },
  
  // 发送请求
  invoke: async (channel, ...args) => {
    if (!isValidChannel('invoke', channel)) {
      throw new Error(\`不允许的频道: \${channel}\`);
    }
    return await ipcRenderer.invoke(channel, ...args);
  },
  
  // 发送消息
  send: (channel, data) => {
    if (!isValidChannel('send', channel)) {
      console.error(\`不允许的频道: \${channel}\`);
      return;
    }
    ipcRenderer.send(channel, data);
  },
  
  // 订阅事件
  on: (channel, callback) => {
    if (!isValidChannel('receive', channel)) {
      console.error(\`不允许的频道: \${channel}\`);
      return () => {};
    }
    
    const listener = (event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    
    // 返回取消订阅函数
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  
  // 便捷方法
  processInput: async (input, options) => {
    return await ipcRenderer.invoke('agent:processInput', { input, options });
  },
  
  stop: async () => {
    return await ipcRenderer.invoke('agent:stop');
  },
  
  getState: async () => {
    return await ipcRenderer.invoke('agent:getState');
  },
  
  getTools: async () => {
    return await ipcRenderer.invoke('agent:getTools');
  },
  
  // 窗口控制
  minimizeWindow: async () => {
    return await ipcRenderer.invoke('window:minimize');
  },
  
  maximizeWindow: async () => {
    return await ipcRenderer.invoke('window:maximize');
  },
  
  closeWindow: async () => {
    return await ipcRenderer.invoke('window:close');
  },
  
  // 文件对话框
  openFileDialog: async (options) => {
    return await ipcRenderer.invoke('dialog:openFile', options);
  },
  
  saveFileDialog: async (options) => {
    return await ipcRenderer.invoke('dialog:saveFile', options);
  },
  
  // 通知
  showNotification: async (options) => {
    return await ipcRenderer.invoke('notification:show', options);
  }
});
`;

/**
 * 主函数
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Electron Main Process Example                         ║');
  console.log('║          Electron 主进程入口示例                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  try {
    // 创建应用实例
    const app = new ElectronMainApp({
      workingDirectory: process.cwd(),
      debug: true,
      windowWidth: 1400,
      windowHeight: 900
    });

    // 初始化应用
    await app.initialize();

    // 显示 preload.js 示例
    console.log('\n📝 preload.js 示例内容:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(preloadExample);
    console.log('─────────────────────────────────────────────────────────────\n');

    // 显示使用说明
    console.log('📚 使用说明:');
    console.log('   1. 在 Electron 主进程中创建 ElectronMainApp 实例');
    console.log('   2. 调用 initialize() 初始化应用');
    console.log('   3. 使用 preload.js 安全暴露 IPC 接口');
    console.log('   4. 在渲染进程中使用 electronAPI 进行通信\n');

    console.log('🔒 安全性注意事项:');
    console.log('   - 禁用 nodeIntegration');
    console.log('   - 启用 contextIsolation');
    console.log('   - 使用 preload.js 白名单机制');
    console.log('   - 验证 IPC 消息频道\n');

    console.log('✅ 示例完成！');

    // 注意：实际运行需要 Electron 环境
    // 这里只是展示代码结构
    console.log('\n⚠️  注意: 实际运行需要安装 Electron');
    console.log('   npm install electron');
    console.log('   然后使用 electron 命令运行此文件\n');

  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// 导出供其他模块使用
export { ElectronMainApp, preloadExample };