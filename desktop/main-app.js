/**
 * Electron 主进程入口
 * 负责初始化 Runtime、IPC 通信、窗口管理等
 */

import electron from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { APP_COPYRIGHT, APP_CREDITS, APP_NAME } from './app-metadata.js';
import { commandCatalog } from '../src/core/command-catalog.js';
import { metricsSink } from '../src/core/metrics-sink.js';

// 获取当前目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导入 Desktop Core 和 IPC 适配器
import {
  createDesktopCore,
} from '../src/adapters/desktop/desktop-core.js';
import {
  getMissingRequiredConfig,
  getProviderBaseUrl,
  getProviderModel,
  getProviderRequirement,
  getUserEnvPath,
  loadRuntimeEnv,
  writeUserEnv,
  applyRuntimeValues
} from '../src/core/runtime-config.js';
import { createConfiguredModelProvider } from '../src/cli/model-provider-factory.js';
import { createWorkspaceWatcher, listWorkspaceDirectory } from './workspace.js';
import { createApplicationMenu } from './menu.js';
import { listPreviews, startPreview, stopAllPreviews, stopPreview } from '../src/core/preview-server.js';

const { app, BrowserWindow, ipcMain, dialog, Notification, Menu, Tray, shell } = electron;

// CORS 白名单：允许本地文件服务器响应的 Origin
const ALLOWED_LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;
function isAllowedFileServerOrigin(origin) {
  if (!origin) return true;
  if (origin === 'null' || origin === 'file://') return true;
  if (ALLOWED_LOCALHOST_PATTERN.test(origin)) return true;
  return false;
}
app?.setName?.(APP_NAME);

/**
 * Electron 主进程应用类
 */

// 全局处理关闭期间的 EIO 错误（stdout/stderr 管道已关闭时 console 输出会抛出）
process.on('uncaughtException', (err) => {
  if (err?.code === 'EIO' && err?.syscall === 'write') {
    return;
  }
  console.error('Uncaught Exception:', err);
});

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
    this.#config = {
      workingDirectory: config.workingDirectory || this.#getDefaultWorkingDirectory(),
      debug: config.debug || process.env.NODE_ENV === 'development' || process.argv.includes('--dev'),
      
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
        maxIterations: config.maxIterations || 60,
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
    if (process.env.WORKING_DIRECTORY) {
      const envWorkingDirectory = path.resolve(process.env.WORKING_DIRECTORY);
      if (!fs.existsSync(envWorkingDirectory)) {
        fs.mkdirSync(envWorkingDirectory, { recursive: true });
      }
      return envWorkingDirectory;
    }

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
   * 启动工作目录静态文件服务器
   * 用于在渲染进程中通过 HTTP 加载本地图片（绕过 Electron webSecurity 对 file:// 的限制）
   */
  #startFileServer() {
    try {
      this.#stopFileServer();

      const root = path.resolve(this.#config.workingDirectory);
      const server = http.createServer((req, res) => {
        if (req.method === 'OPTIONS') {
          const origin = req.headers.origin;
          if (!isAllowedFileServerOrigin(origin)) {
            res.writeHead(403); res.end('Forbidden'); return;
          }
          res.writeHead(204, {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          });
          res.end();
          return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405); res.end('Method Not Allowed'); return;
        }

        // 来源校验：仅允许 app origin / localhost / null (file://)
        const origin = req.headers.origin;
        if (!isAllowedFileServerOrigin(origin)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }

        try {
          const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
          const safePath = urlPath.replace(/\.\.\//g, '').replace(/^\//, '');
          const candidate = path.join(root, safePath);

          const normalizedRoot = path.resolve(root);
          const normalizedCandidate = path.resolve(candidate);
          if (!normalizedCandidate.startsWith(normalizedRoot + path.sep) && normalizedCandidate !== normalizedRoot) {
            res.writeHead(403); res.end('Forbidden'); return;
          }

          if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
            res.writeHead(404); res.end('Not Found'); return;
          }

          const ext = path.extname(candidate).toLowerCase();
          const mime = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp', '.ico': 'image/x-icon',
            '.txt': 'text/plain', '.md': 'text/markdown',
            '.html': 'text/html', '.htm': 'text/html',
            '.json': 'application/json',
            '.pdf': 'application/pdf',
          }[ext] || 'application/octet-stream';

          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': origin || 'null',
            Vary: 'Origin',
          });

          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(candidate).pipe(res);
        } catch (err) {
          res.writeHead(500); res.end('Internal Server Error');
        }
      });

      server.on('error', (err) => {
        console.error('⚠️ 文件服务器错误:', err.message);
      });

      // 使用 41730~42730 范围的端口，从 41730 开始尝试
      let port = 41730;
      const tryListen = () => {
        server.listen(port, '127.0.0.1', () => {
          const actualPort = server.address().port;
          this.#fileServerUrl = `http://127.0.0.1:${actualPort}`;
          console.log(`📁 文件服务器已启动: ${this.#fileServerUrl} (root=${root})`);
        }).on('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < 42730) {
            port++;
            server.removeAllListeners('error');
            tryListen();
          } else {
            console.error('❌ 无法启动文件服务器:', err.message);
          }
        });
      };
      tryListen();
      this.#fileServer = server;
    } catch (err) {
      console.error('❌ 文件服务器启动失败:', err.message);
    }
  }

  #stopFileServer() {
    if (this.#fileServer) {
      try { this.#fileServer.close(); } catch {}
      this.#fileServer = null;
      this.#fileServerUrl = null;
    }
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

    // 启动工作目录静态文件服务器（用于渲染 Markdown 中的本地图片）
    this.#startFileServer();

    // 先初始化 Desktop Core 和 IPC，再创建窗口
    // 确保 ipc:connect 等处理器在渲染进程连接前已注册
    await this.#initializeDesktopCore();
    await this.#attachConfiguredModelProvider();
    await this.#initializeIPCAdapter();

    // 创建主窗口
    this.#createMainWindow();

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
    app.setName(APP_NAME);
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: APP_COPYRIGHT,
      credits: APP_CREDITS
    });

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
    createApplicationMenu({
      onOpenProject: () => this.#handleOpenProject(),
      onShowAboutDialog: () => this.#showAboutDialog(),
    });
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
      title: APP_NAME,
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
      const devServerUrl = process.env.DEV_SERVER_URL || 'http://127.0.0.1:5173';
      this.#mainWindow.loadURL(devServerUrl).catch(err => {
        console.error('加载开发服务器失败:', err);
      });
    } else {
      // 生产模式：加载打包后的文件
      const rendererEntry = path.join(__dirname, 'renderer', 'dist', 'index.html');
      if (!fs.existsSync(rendererEntry)) {
        throw new Error(`找不到渲染进程入口文件: ${rendererEntry}。请先运行 bun run desktop:renderer:build。`);
      }
      this.#mainWindow.loadFile(rendererEntry);
    }
  }

  /**
   * 设置窗口事件
   */
  #setupWindowEvents() {
    const broadcastWindowState = () => {
      this.#broadcastWindowState();
    };

    // 安全性：拦截所有 window.open / target="_blank" 的新建窗口请求
    // 统一在用户的默认浏览器中打开外部链接，防止在应用窗口内导航
    this.#mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const urlLower = String(url || '').toLowerCase();
      const isDevServer = urlLower.startsWith('http://localhost:5173') ||
        urlLower.startsWith('http://127.0.0.1:5173');
      const isLocalPreview = /^http:\/\/(localhost|127\.0\.0\.1):/i.test(urlLower);
      const isSafeScheme = /^(file:|about:|data:|blob:)/i.test(urlLower);

      // 允许开发服务器和本地预览在应用内新开窗口，其他交给系统浏览器
      if (isDevServer || isLocalPreview || isSafeScheme) {
        return { action: 'allow', overrideBrowserWindowOptions: { show: true } };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 阻止主窗口 webContents 导航到非允许的外部 URL
    // 这是最后一道防线：即便 React 层的点击拦截被绕过，此处也会阻止导航
    this.#mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
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

    this.#mainWindow.on('maximize', broadcastWindowState);
    this.#mainWindow.on('unmaximize', broadcastWindowState);
    this.#mainWindow.on('enter-full-screen', broadcastWindowState);
    this.#mainWindow.on('leave-full-screen', broadcastWindowState);
    this.#mainWindow.on('restore', broadcastWindowState);
    this.#mainWindow.once('ready-to-show', broadcastWindowState);
  }

  #getWindowState() {
    return {
      isFullScreen: Boolean(this.#mainWindow?.isFullScreen()),
      isMaximized: Boolean(this.#mainWindow?.isMaximized()),
      platform: process.platform
    };
  }

  #broadcastWindowState() {
    if (!this.#mainWindow || this.#mainWindow.isDestroyed()) {
      return;
    }

    this.#mainWindow.webContents.send('window:state', this.#getWindowState());
  }

  /**
   * 处理窗口关闭
   */
  #handleWindowClose() {
    // macOS: 点击红绿灯关闭按钮时直接隐藏窗口（macOS 标准行为）
    if (process.platform === 'darwin') {
      this.#mainWindow.hide();
      return;
    }

    // Windows/Linux: 显示退出确认对话框
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

    // —— write_file 审批：通过 IPC 让用户在写文件前预览 diff ——
    // 若 IPC 尚未连接或未注册，默认允许写入（避免阻塞 CLI / 无头场景）。
    const writeFileApproval = async ({ args, workingDirectory }) => {
      const ipc = this.#ipcAdapter;
      if (!ipc || typeof ipc.request !== 'function') return true;

      const path = args?.path || args?.file_path || '';
      const newContent = typeof args?.content === 'string' ? args.content : '';

      // 先尝试从已连接的 renderer 拿旧内容（若无，则认为是新文件）
      let oldContent = '';
      try {
        const fs = await import('node:fs');
        const full = path && path.startsWith('/') ? path : `${workingDirectory}/${path}`;
        if (fs.existsSync(full)) oldContent = fs.readFileSync(full, 'utf8');
      } catch (_) {}

      try {
        const resp = await ipc.request('write-file:approve', {
          path,
          oldContent,
          newContent,
        });
        if (resp && resp.apply === false) return false;
        if (resp && typeof resp.content === 'string') return { content: resp.content };
        return true;
      } catch (_) {
        // 没有 renderer 订阅 -> 默认通过
        return true;
      }
    };

    this.#desktopCore = createDesktopCore({
      workingDirectory: this.#config.workingDirectory,
      debug: this.#config.debug,
      maxIterations: this.#config.runtime.maxIterations,
      autoDownloadModels: this.#config.runtime.autoDownloadModels,
      hookTimeout: this.#config.runtime.hookTimeout,
      ipc: this.#config.ipc,
      writeFileApproval,
    });

    await this.#desktopCore.initialize();

    console.log('✅ Desktop Core 初始化完成');
  }

  async #attachConfiguredModelProvider() {
    const missingVars = getMissingRequiredConfig();
    if (missingVars.length > 0) {
      console.warn(`⚠️  未配置 LLM: 缺少 ${missingVars.join(', ')}。可在 ${this.#userEnvPath || getUserEnvPath()} 或项目 .env 中配置。`);
      return this.#getLLMConfigStatus();
    }

    const provider = process.env.MODEL_PROVIDER || 'openai';
    const model = getProviderModel(provider);
    const baseURL = getProviderBaseUrl(provider);

    const modelProvider = await createConfiguredModelProvider({
      provider,
      model,
      apiUrl: baseURL,
      apiKey: process.env.OPENAI_API_KEY,
      temperature: Number(process.env.TEMPERATURE || 0.7)
    }, { debug: this.#config.debug });

    this.attachModelProvider(modelProvider);
    console.log(`✅ LLM 已配置: ${provider}:${model}`);
    return this.#getLLMConfigStatus();
  }

  #getLLMConfigStatus() {
    const provider = process.env.MODEL_PROVIDER || 'openai';
    const requirement = getProviderRequirement(provider);
    const missingVars = getMissingRequiredConfig();

    return {
      configured: missingVars.length === 0,
      provider,
      model: getProviderModel(provider),
      baseUrl: getProviderBaseUrl(provider),
      missingVars,
      userEnvPath: this.#userEnvPath || getUserEnvPath(),
      keyVar: requirement?.keyVar || 'OPENAI_API_KEY',
      modelVar: requirement?.modelVar || 'OPENAI_MODEL',
      baseUrlVar: requirement?.baseUrlVar || 'OPENAI_BASE_URL'
    };
  }

  async #saveLLMConfig(config = {}) {
    const provider = config.provider || 'openai';
    const requirement = getProviderRequirement(provider);
    if (!requirement) {
      return {
        success: false,
        error: `不支持的模型提供商: ${provider}`,
        status: this.#getLLMConfigStatus()
      };
    }

    const apiKey = String(config.apiKey || '').trim();
    const model = String(config.model || requirement.defaultModel || '').trim();
    const baseUrl = String(config.baseUrl || requirement.defaultBaseUrl || '').trim();

    if (!apiKey) {
      return {
        success: false,
        error: `${requirement.keyVar} 不能为空`,
        status: this.#getLLMConfigStatus()
      };
    }

    if (!model) {
      return {
        success: false,
        error: `${requirement.modelVar} 不能为空`,
        status: this.#getLLMConfigStatus()
      };
    }

    const values = {
      MODEL_PROVIDER: provider,
      [requirement.keyVar]: apiKey,
      [requirement.modelVar]: model
    };

    if (baseUrl) {
      values[requirement.baseUrlVar] = baseUrl;
    }

    const envPath = writeUserEnv(values, {
      envPath: this.#userEnvPath || getUserEnvPath()
    });
    applyRuntimeValues(values);
    const status = await this.#attachConfiguredModelProvider();

    return {
      success: true,
      envPath,
      status
    };
  }

  /**
   * 初始化 IPC 适配器
   */
  async #initializeIPCAdapter() {
    console.log('🔗 初始化 IPC 适配器...');

    // 附加 IPC 适配器到 Desktop Core
    this.#ipcAdapter = this.#desktopCore.attachIPCAdapter(ipcMain);
    await this.#ipcAdapter.initialize();

    // 注册自定义 IPC 处理器
    this.#registerCustomHandlers();

    // 注册 ⌘K 命令面板（跨进程共享的 CommandCatalog）
    this.#registerCommandPalette();

    // 监听 IPC 事件
    this.#setupIPCListeners();

    this.#startWorkspaceWatcher();

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
        this.#broadcastWindowState();
      }
      return { success: true, ...this.#getWindowState() };
    });

    this.#ipcAdapter.registerHandler('window:getState', async () => {
      return this.#getWindowState();
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
        fileServerUrl: this.#fileServerUrl,
        electronVersion: process.versions.electron
      };
    });

    this.#ipcAdapter.registerHandler('app:getPath', async (name) => {
      return app.getPath(name || 'userData');
    });

    this.#ipcAdapter.registerHandler('app:openExternal', async (url) => {
      const href = String(url || '');
      if (!/^https?:\/\//i.test(href)) {
        return { success: false, error: '只允许打开 http(s) 链接' };
      }

      await shell.openExternal(href);
      return { success: true };
    });

    // 工作目录处理器
    this.#ipcAdapter.registerHandler('workspace:setWorkingDirectory', async (directory) => {
      return this.#setWorkingDirectory(directory);
    });

    this.#ipcAdapter.registerHandler('workspace:listDirectory', async (options = {}) => {
      return listWorkspaceDirectory(this.#config.workingDirectory, options);
    });

    this.#ipcAdapter.registerHandler('preview:start', async (options = {}) => {
      const preview = await startPreview({
        workingDirectory: this.#config.workingDirectory,
        ...options
      });
      this.#ipcAdapter?.broadcast('preview:started', preview);
      return preview;
    });

    this.#ipcAdapter.registerHandler('preview:list', async () => {
      return { success: true, previews: listPreviews() };
    });

    this.#ipcAdapter.registerHandler('preview:stop', async (sessionId) => {
      const result = stopPreview(typeof sessionId === 'object' ? sessionId?.session_id : sessionId);
      this.#ipcAdapter?.broadcast('preview:stopped', result);
      return result;
    });

    // LLM 配置处理器
    this.#ipcAdapter.registerHandler('llm:getConfigStatus', async () => {
      return this.#getLLMConfigStatus();
    });

    this.#ipcAdapter.registerHandler('llm:saveConfig', async (config) => {
      return this.#saveLLMConfig(config);
    });

    if (this.#config.debug) {
      console.log('   注册了自定义 IPC 处理器');
    }
  }

  /**
   * ⌘K 命令面板 — 把 Desktop 常见操作注册到共享的 CommandCatalog。
   * 渲染侧通过 IPC 调用 `command:list` / `command:run` 来读写命令并执行。
   */
  #registerCommandPalette() {
    const app = this;

    // —— 窗口 & UI ——
    commandCatalog.register({
      id: 'app.window.minimize', title: '最小化窗口', category: '窗口',
      handler: async () => { app.#mainWindow?.minimize(); return { success: true }; },
    });
    commandCatalog.register({
      id: 'app.window.toggle-max', title: '切换最大化', category: '窗口',
      handler: async () => {
        const w = app.#mainWindow;
        if (!w) return { success: false, message: 'no-window' };
        if (w.isMaximized()) w.unmaximize(); else w.maximize();
        return { success: true };
      },
    });
    commandCatalog.register({
      id: 'app.window.toggle-devtools', title: '开发者工具', category: '调试',
      keywords: ['devtools', 'inspect'],
      handler: async () => {
        const w = app.#mainWindow;
        if (!w) return { success: false, message: 'no-window' };
        if (w.webContents.isDevToolsOpened()) w.webContents.closeDevTools();
        else w.webContents.openDevTools({ mode: 'detach' });
        return { success: true };
      },
    });

    // —— 会话 & 运行 ——
    commandCatalog.register({
      id: 'app.session.clear', title: '清空会话', category: '会话',
      keywords: ['reset', 'clear', 'session'],
      handler: async () => {
        const core = app.#desktopCore;
        if (core?.agent?.reset) await core.agent.reset(true);
        return { success: true, message: 'session cleared' };
      },
    });
    commandCatalog.register({
      id: 'app.session.stop', title: '停止 Agent 执行', category: '会话',
      keywords: ['stop', 'cancel', 'abort'],
      handler: async () => {
        const core = app.#desktopCore;
        if (core?.agent?.requestStop) core.agent.requestStop();
        return { success: true, message: 'stop requested' };
      },
    });

    // —— 预览服务 ——
    commandCatalog.register({
      id: 'app.preview.list', title: '列出正在运行的预览', category: '预览',
      handler: async () => {
        const previews = await listPreviews();
        return { success: true, data: previews };
      },
    });
    commandCatalog.register({
      id: 'app.preview.stop-all', title: '停止所有预览服务器', category: '预览',
      handler: async () => {
        await stopAllPreviews();
        return { success: true, message: 'all previews stopped' };
      },
    });

    // —— 工作区 ——
    commandCatalog.register({
      id: 'app.workspace.reload', title: '重新扫描工作区', category: '工作区',
      keywords: ['reload', 'refresh', 'scan'],
      handler: async () => {
        const core = app.#desktopCore;
        if (core?.agent?.workspaceState) core.agent.workspaceState.clear();
        return { success: true, message: 'workspace state reloaded' };
      },
    });
    commandCatalog.register({
      id: 'app.workspace.status', title: '显示工作区状态', category: '工作区',
      handler: async () => {
        const core = app.#desktopCore;
        const ws = core?.agent?.workspaceState;
        if (!ws) return { success: false, message: 'no-workspace-state' };
        return { success: true, data: ws.getSummary() };
      },
    });

    // —— 通过 IPC 把 CommandCatalog + MetricsSink 暴露给渲染进程 ——
    if (this.#ipcAdapter && typeof this.#ipcAdapter.registerHandler === 'function') {
      this.#ipcAdapter.registerHandler('command:list', async (payload) => {
        const q = payload?.query || '';
        return { success: true, commands: commandCatalog.filter(q).map(cmd => ({
          id: cmd.id, title: cmd.title, category: cmd.category,
          description: cmd.description, shortcut: cmd.shortcut,
        })) };
      });
      this.#ipcAdapter.registerHandler('command:run', async (payload) => {
        if (!payload?.id) return { success: false, message: 'missing id' };
        const r = await commandCatalog.run(payload.id, payload.payload || null);
        return r;
      });
      this.#ipcAdapter.registerHandler('metrics:snapshot', async () => {
        try {
          return { success: true, data: metricsSink.latestSnapshot() };
        } catch (e) {
          return { success: false, message: e.message };
        }
      });
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

  #startWorkspaceWatcher() {
    this.#workspaceWatcher?.close();
    this.#workspaceWatcher = null;

    try {
      this.#workspaceWatcher = createWorkspaceWatcher(this.#config.workingDirectory, (change) => {
        this.#broadcastWorkspaceChange(change);
      });
    } catch (error) {
      console.warn(`⚠️  工作目录监听失败: ${error.message}`);
    }
  }

  #broadcastWorkspaceChange(change) {
    this.#ipcAdapter?.broadcast('workspace:changed', change);

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('workspace:changed', change);
      }
    }
  }

  async #setWorkingDirectory(directory) {
    if (!directory || !fs.existsSync(directory)) {
      return { success: false, error: '目录不存在' };
    }

    this.#config.workingDirectory = directory;
    this.#startFileServer();

    if (this.#desktopCore) {
      await this.#desktopCore.dispose();
    }

    this.#desktopCore = createDesktopCore({
      workingDirectory: directory,
      debug: this.#config.debug,
      ...this.#config.runtime
    });

    await this.#desktopCore.initialize();
    this.#startWorkspaceWatcher();

    return { success: true, workingDirectory: directory, fileServerUrl: this.#fileServerUrl };
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

    // 安全性：全局拦截所有 webContents 的导航和新窗口请求
    // 这确保主窗口 webContents 以及任何后续创建的 webContents（如 <webview>）
    // 都不会意外导航到外部 URL，而是把外部链接交给系统默认浏览器
    app.on('web-contents-created', (event, contents) => {
      // 1. 拦截所有新窗口请求（window.open / target="_blank" 等）
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

        // 其他所有外部 URL → 在系统默认浏览器打开
        shell.openExternal(url);
        return { action: 'deny' };
      });

      // 2. 阻止导航到非允许的外部 URL（最后一道防线）
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
      await this.#setWorkingDirectory(newProjectPath);
      
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
      await this.#setWorkingDirectory(projectPath);
      
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
      detail: `AI Engineering Mastery Agent 桌面应用\n\n平台: ${process.platform}\n架构: ${process.arch}\n运行时: ${process.versions.node}`,
      buttons: ['确定', '查看文档']
    }).then(result => {
      if (result.response === 1) {
        shell.openExternal('https://github.com/novvoo/ai-engineering-mastery-agent#readme');
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
    try { console.log('🧹 清理资源...'); } catch { /* EIO during shutdown */ }

    if (this.#workspaceWatcher) {
      this.#workspaceWatcher.close();
      this.#workspaceWatcher = null;
    }

    stopAllPreviews();

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

    try { console.log('✅ 资源清理完成'); } catch { /* EIO during shutdown */ }
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
    const desktopEnv = { ...process.env };
    delete desktopEnv.AGENT_CONFIG_DIR;
    const desktopUserEnvPath = getUserEnvPath({ env: desktopEnv });
    const { userEnvPath, cwdEnvPath } = loadRuntimeEnv({
      cwd: process.cwd(),
      userEnvPath: desktopUserEnvPath
    });
    console.log(`🔐 已加载运行配置: ${userEnvPath}, ${cwdEnvPath}`);

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
      ...(process.env.WORKING_DIRECTORY ? {
        workingDirectory: path.resolve(process.env.WORKING_DIRECTORY)
      } : {}),
      userEnvPath,
      debug: process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
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

export { ElectronMainApp, main };
