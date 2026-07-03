/**
 * Electron 主应用 — 工作区与文件服务器模块
 *
 * 职责：
 *   - 静态文件服务器（用于 Markdown 中的本地图片）
 *   - 工作区变更监听与广播
 *   - 工作目录切换（重新初始化 Desktop Core）
 *   - 默认工作目录选择
 *   - 新建项目 / 打开项目对话框
 */

import path from 'path';
import fs from 'fs';
import http from 'http';
import { createWorkspaceWatcher, listWorkspaceDirectory as _listWorkspaceDirectory } from '../workspace.js';
import { saveAppConfig } from './llm-config-and-persistence.js';
import { writeUserEnv, applyRuntimeValues } from '../../src/core/runtime/runtime-config.js';

const ALLOWED_LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;

function isAllowedFileServerOrigin(origin) {
  if (!origin) {return true;}
  if (origin === 'null' || origin === 'file://') {return true;}
  if (ALLOWED_LOCALHOST_PATTERN.test(origin)) {return true;}
  return false;
}

export function getDefaultWorkingDirectory(ctx) {
  if (process.env.WORKING_DIRECTORY) {
    const envWorkingDirectory = path.resolve(process.env.WORKING_DIRECTORY);
    if (!fs.existsSync(envWorkingDirectory)) {
      fs.mkdirSync(envWorkingDirectory, { recursive: true });
    }
    return envWorkingDirectory;
  }

  const userDataPath = ctx.electron.app.getPath('userData');
  const projectsPath = path.join(userDataPath, 'projects');
  if (!fs.existsSync(projectsPath)) {
    fs.mkdirSync(projectsPath, { recursive: true });
  }
  return projectsPath;
}

export function startFileServer(ctx) {
  try {
    stopFileServer(ctx);

    const root = path.resolve(ctx.config.workingDirectory);
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

    let port = 41730;
    const tryListen = () => {
      server.listen(port, '127.0.0.1', () => {
        const actualPort = server.address().port;
        ctx.fileServerUrl = `http://127.0.0.1:${actualPort}`;
        console.log(`📁 文件服务器已启动: ${ctx.fileServerUrl} (root=${root})`);
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
    ctx.fileServer = server;
  } catch (err) {
    console.error('❌ 文件服务器启动失败:', err.message);
  }
}

export function stopFileServer(ctx) {
  if (ctx.fileServer) {
    try { ctx.fileServer.close(); } catch {}
    ctx.fileServer = null;
    ctx.fileServerUrl = null;
  }
}

export function startWorkspaceWatcher(ctx) {
  ctx.workspaceWatcher?.close();
  ctx.workspaceWatcher = null;
  try {
    ctx.workspaceWatcher = createWorkspaceWatcher(ctx.config.workingDirectory, (change) => {
      broadcastWorkspaceChange(ctx, change);
    });
  } catch (error) {
    console.warn(`⚠️  工作目录监听失败: ${error.message}`);
  }
}

export function broadcastWorkspaceChange(ctx, change) {
  ctx.ipcAdapter?.broadcast?.('workspace:changed', change);

  for (const window of ctx.electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('workspace:changed', change);
    }
  }
}

export async function setWorkingDirectory(ctx, directory) {
  const nextDirectory = directory ? path.resolve(directory) : '';
  if (!nextDirectory || !fs.existsSync(nextDirectory)) {
    return { success: false, error: '目录不存在' };
  }

  if (!fs.statSync(nextDirectory).isDirectory()) {
    return { success: false, error: '路径不是目录' };
  }

  ctx.config.workingDirectory = nextDirectory;
  let persistence = { success: true };
  let envPersistence = { success: true };
  try {
    persistence = saveAppConfig(ctx);
  } catch (error) {
    persistence = { success: false, error: error.message };
    console.warn(`⚠️  保存工作目录到 config.json 失败: ${error.message}`);
  }

  try {
    const envPath = writeUserEnv(
      { WORKING_DIRECTORY: nextDirectory },
      { envPath: ctx.userEnvPath }
    );
    applyRuntimeValues({ WORKING_DIRECTORY: nextDirectory });
    envPersistence = { success: true, envPath };
  } catch (error) {
    envPersistence = { success: false, error: error.message };
    console.warn(`⚠️  保存工作目录到 .env 失败: ${error.message}`);
  }

  startFileServer(ctx);

  if (ctx.desktopCore && typeof ctx.desktopCore.setWorkingDirectory === 'function') {
    ctx.desktopCore.setWorkingDirectory(nextDirectory);
  }

  if (ctx.ipcAdapter && typeof ctx.ipcAdapter.attachEngine === 'function' && ctx.desktopCore?.getEngine) {
    ctx.ipcAdapter.attachEngine(ctx.desktopCore.getEngine());
  }

  startWorkspaceWatcher(ctx);

  broadcastWorkspaceChange(ctx, { workingDirectory: nextDirectory, fileServerUrl: ctx.fileServerUrl });

  return {
    success: true,
    workingDirectory: nextDirectory,
    fileServerUrl: ctx.fileServerUrl,
    persisted: persistence.success && envPersistence.success,
    configPath: persistence.configPath,
    envPath: envPersistence.envPath,
    persistenceError: persistence.error || envPersistence.error
  };
}

export async function handleNewProject(ctx) {
  const { dialog } = ctx.electron;
  const result = await dialog.showOpenDialog(ctx.mainWindow, {
    title: '选择新项目目录',
    defaultPath: ctx.config.workingDirectory,
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const newProjectPath = result.filePaths[0];

    const subdirs = ['src', 'tests', 'docs', '.agent-data'];
    for (const subdir of subdirs) {
      const fullPath = path.join(newProjectPath, subdir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    await setWorkingDirectory(ctx, newProjectPath);

    ctx.ipcAdapter?.broadcast?.('app:projectCreated', { path: newProjectPath });
  }
}

export async function handleOpenProject(ctx) {
  const { dialog } = ctx.electron;
  const result = await dialog.showOpenDialog(ctx.mainWindow, {
    title: '选择项目目录',
    defaultPath: ctx.config.workingDirectory,
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const projectPath = result.filePaths[0];
    await setWorkingDirectory(ctx, projectPath);
    ctx.ipcAdapter?.broadcast?.('app:projectOpened', { path: projectPath });
  }
}

export function listWorkspaceDirectory(ctx, path_, options = {}) {
  return _listWorkspaceDirectory(path_ || ctx.config.workingDirectory, options);
}
