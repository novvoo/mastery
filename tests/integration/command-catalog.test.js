import { describe, it, expect, beforeEach } from 'bun:test';
import { CommandCatalog, commandCatalog } from '../../src/core/tools/command-catalog.js';

describe('CommandCatalog', () => {
  let catalog;
  beforeEach(() => {
    catalog = new CommandCatalog();
  });

  it('注册并运行一个同步命令', () => {
    catalog.register({
      id: 'ping',
      title: 'Ping',
      category: '调试',
      handler: () => ({ success: true, message: 'pong' }),
    });
    expect(catalog.has('ping')).toBe(true);
    expect(catalog.list().length).toBe(1);
  });

  it('运行时返回 handler 的结果', async () => {
    catalog.register({
      id: 'echo',
      title: 'Echo',
      category: '调试',
      keywords: ['回显'],
      handler: (payload) => ({ success: true, message: payload?.text || '' }),
    });
    const r = await catalog.run('echo', { text: 'hi' });
    expect(r.success).toBe(true);
    expect(r.message).toBe('hi');
  });

  it('未知命令返回失败', async () => {
    const r = await catalog.run('does-not-exist');
    expect(r.success).toBe(false);
  });

  it('模糊搜索按关键字匹配 category / keywords / title', () => {
    catalog.bulk({
      'toggle-debug': {
        title: '切换调试',
        category: '设置',
        keywords: ['debug'],
        handler: () => ({ success: true }),
      },
      'clear-session': {
        title: '清空会话',
        category: '会话',
        keywords: ['session'],
        handler: () => ({ success: true }),
      },
    });
    expect(catalog.filter('debug').length).toBe(1);
    expect(catalog.filter('会话').length).toBe(1);
    expect(catalog.filter('').length).toBe(2);
  });

  it('enabled=false 的命令在 list/filter 中隐藏', () => {
    catalog.register({
      id: 'beta',
      title: 'Beta',
      category: '其他',
      enabled: () => false,
      handler: () => ({ success: true }),
    });
    expect(catalog.list().length).toBe(0);
  });

  it('全局单例默认包含 core.* 命令', () => {
    const all = commandCatalog.filter('core');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('命令执行时 handler 抛异常被吞成 success:false', async () => {
    catalog.register({
      id: 'boom',
      title: 'Boom',
      category: '调试',
      handler: () => {
        throw new Error('nope');
      },
    });
    const r = await catalog.run('boom');
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/nope/);
  });
});
