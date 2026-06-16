/**
 * Desktop IPC handler 权限 + 路径穿越 测试.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MainProcessIPCAdapter, IPCMessage, IPCMessageType } from '../../src/adapters/desktop/ipc-adapter.js';

function makeFakeIpcMain() {
  const handles = new Map();
  const listeners = new Map();
  return {
    handle(name, fn) { handles.set(name, fn); },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    handles,
    listeners,
  };
}

function makeFakeSender() {
  const sent = [];
  return {
    id: 99,
    send(channel, payload) { sent.push({ channel, payload }); },
    sent,
  };
}

describe('Desktop IPC: handler registration & validation', () => {
  let ipcMain;
  beforeEach(() => { ipcMain = makeFakeIpcMain(); });

  test('initialize() 注册 CONNECT / REQUEST handler', async () => {
    const adapter = new MainProcessIPCAdapter(ipcMain, { emit() {} });
    await adapter.initialize();
    expect(ipcMain.handles.has('ipc:connect')).toBe(true);
    expect(ipcMain.listeners.has('ipc:request')).toBe(true);
    expect(adapter.isConnected).toBe(true);
  });

  test('initialize() 是幂等的', async () => {
    const adapter = new MainProcessIPCAdapter(ipcMain, { emit() {} });
    await adapter.initialize();
    await adapter.initialize(); // 不应抛
    expect(adapter.isConnected).toBe(true);
  });
});

describe('Desktop IPC: message validation', () => {
  let ipcMain;
  let adapter;
  beforeEach(async () => {
    ipcMain = makeFakeIpcMain();
    adapter = new MainProcessIPCAdapter(ipcMain, { emit() {} });
    await adapter.initialize();
  });

  test('validateMessage 拒绝缺少 type 字段的消息', () => {
    const result = adapter.validateMessage({ payload: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('validateMessage 允许正确结构的 request 消息', () => {
    const result = adapter.validateMessage({ type: 'request', payload: {} });
    expect(result.valid).toBe(true);
  });

  test('request handler 对未注册 channel 返回错误响应 (不抛)', async () => {
    const sender = makeFakeSender();
    const handler = ipcMain.listeners.get('ipc:request')[0];
    const message = new IPCMessage(IPCMessageType.REQUEST, { path: 'foo' }, {
      metadata: { channel: 'unknown:channel' },
    });
    await handler({ sender }, message.toJSON());
    // 至少发送一条 ipc:response / ipc:error 消息
    expect(sender.sent.length).toBeGreaterThan(0);
    const anyResponse = sender.sent.find(s =>
      s.channel === 'ipc:response' || s.channel === 'ipc:error'
    );
    expect(anyResponse).toBeTruthy();
  });
});

describe('Desktop IPC: filesystem path traversal', () => {
  let ipcMain;
  let adapter;

  beforeEach(async () => {
    ipcMain = makeFakeIpcMain();
    adapter = new MainProcessIPCAdapter(ipcMain, { emit() {} });
    adapter.registerHandler('file:read', (payload) => {
      const path = String(payload?.path || '');
      if (path.includes('..') || path.startsWith('/')) {
        return { ok: false, error: 'Invalid path: traversal or absolute path' };
      }
      return { ok: true, content: 'fake_content_for_' + path };
    });
    await adapter.initialize();
  });

  function sendRequest(payload, channel = 'file:read') {
    const sender = makeFakeSender();
    const requestHandler = ipcMain.listeners.get('ipc:request')[0];
    const message = new IPCMessage(IPCMessageType.REQUEST, payload, {
      metadata: { channel },
    });
    return { sender, run: () => requestHandler({ sender }, message.toJSON()) };
  }

  test('自定义 handler 拒绝包含 .. 的 payload', async () => {
    const { sender, run } = sendRequest({ path: '../secret.txt' });
    await run();
    const allText = JSON.stringify(sender.sent);
    expect(allText).toMatch(/Invalid path|error/i);
    expect(allText).not.toMatch(/fake_content_for_\.\./);
  });

  test('合法相对路径 payload 返回内容', async () => {
    const { sender, run } = sendRequest({ path: 'foo.txt' });
    await run();
    const allText = JSON.stringify(sender.sent);
    expect(allText).toMatch(/fake_content_for_foo\.txt/);
  });

  test('绝对路径 payload 被拒绝', async () => {
    const { sender, run } = sendRequest({ path: '/etc/passwd' });
    await run();
    const allText = JSON.stringify(sender.sent);
    expect(allText).toMatch(/Invalid path|error/i);
    expect(allText).not.toMatch(/fake_content_for_\/etc/);
  });
});
