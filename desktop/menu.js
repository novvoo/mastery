import electron from 'electron';
import { APP_NAME } from './app-metadata.js';

const { BrowserWindow, Menu, shell } = electron;

export function createApplicationMenu({
  onOpenProject,
  onShowAboutDialog,
}) {
  const sendMenuAction = (command, payload) => {
    const win = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
    if (win) {
      win.webContents.send('app:menuAction', { command, ...payload });
    }
  };

  const template = [
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        { label: `关于 ${APP_NAME}`, click: onShowAboutDialog },
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
    {
      label: '文件',
      submenu: [
        { label: '新建任务', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('newTask') },
        { label: '切换工作目录...', accelerator: 'CmdOrCtrl+O', click: onOpenProject },
        { type: 'separator' },
        { label: '保存会话快照', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('saveSession') },
        { label: '导出对话', accelerator: 'CmdOrCtrl+E', click: () => sendMenuAction('exportConversation') },
        { type: 'separator' },
        { role: 'quit', label: process.platform === 'darwin' ? `退出 ${APP_NAME}` : '退出' }
      ]
    },
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
    {
      label: 'Agent',
      submenu: [
        { label: '聚焦输入', accelerator: 'CmdOrCtrl+Enter', click: () => sendMenuAction('focusInput') },
        { label: '停止执行', accelerator: 'CmdOrCtrl+.', click: () => sendMenuAction('stopAgent') },
        { type: 'separator' },
        { label: '清除对话', click: () => sendMenuAction('clearConversation') },
        { label: '文档搜索', click: () => sendMenuAction('insertDocSearch') },
        { type: 'separator' },
        { label: '模型配置...', accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('openModelConfig') }
      ]
    },
    {
      label: '技能',
      submenu: [
        { label: '诊断', click: () => sendMenuAction('insertCommand', { value: '/diagnose symptom=' }) },
        { label: '代码审查', click: () => sendMenuAction('insertCommand', { value: '/review scope=' }) },
        { label: 'TDD', click: () => sendMenuAction('insertCommand', { value: '/tdd phase=red component=' }) },
        { label: '架构设计', click: () => sendMenuAction('insertCommand', { value: '/architect goal=' }) },
        { label: '交接总结', click: () => sendMenuAction('insertCommand', { value: '/handoff session_summary=' }) }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换侧边栏', accelerator: 'CmdOrCtrl+B', click: () => sendMenuAction('toggleSidebar') },
        { label: '切换 Inspector', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('toggleSummary') },
        { label: 'Agent 面板', click: () => sendMenuAction('showAgent') },
        { label: '工具面板', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('showTools') },
        { type: 'separator' },
        { label: '刷新项目文件', click: () => sendMenuAction('refreshProjectTree') },
        { label: '刷新 RAG 文档', click: () => sendMenuAction('refreshRagDocs') },
        { label: '预览当前项目', click: () => sendMenuAction('startPreview') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
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
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }])
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '文档',
          click: async () => {
            await shell.openExternal('https://github.com/novvoo/mastery#readme');
          }
        },
        {
          label: '报告问题',
          click: async () => {
            await shell.openExternal('https://github.com/novvoo/mastery/issues');
          }
        },
        { type: 'separator' },
        { label: '关于', click: onShowAboutDialog }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}
