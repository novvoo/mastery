/**
 * Command Catalog — 命令面板（⌘K / Ctrl+K）的底层命令注册表。
 *
 * 设计：
 *   - 每个命令有固定 id、title、category、shortcut、keywords（用于模糊搜索）
 *   - handler 可以是同步或异步的，返回 { success, message, navigateTo? }
 *   - 渲染层订阅 catalog，通过 filter(prefix) 拉取匹配项
 *   - 不依赖具体 UI 框架，方便 CLI 与 Desktop 复用
 */

export class CommandCatalog {
  constructor() {
    /** @type {Map<string, Command>} */
    this._commands = new Map();
  }

  register(command) {
    if (!command || typeof command.id !== 'string' || !command.id) {
      throw new Error('CommandCatalog: id 是必填项');
    }
    if (typeof command.handler !== 'function') {
      throw new Error(`CommandCatalog: ${command.id} 必须有 handler`);
    }
    this._commands.set(command.id, {
      id: command.id,
      title: command.title || command.id,
      category: command.category || '其他',
      keywords: (command.keywords || []).slice(),
      shortcut: command.shortcut || null,
      description: command.description || '',
      requiresConfirm: !!command.requiresConfirm,
      handler: command.handler,
      enabled: typeof command.enabled === 'function' ? command.enabled : () => true,
    });
    return this;
  }

  unregister(id) { this._commands.delete(id); return this; }
  has(id) { return this._commands.has(id); }
  get(id) { return this._commands.get(id) || null; }

  /** 返回所有启用中的命令（用于全量面板） */
  list() {
    return Array.from(this._commands.values())
      .filter(cmd => cmd.enabled())
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  /** 模糊搜索（空格分隔多关键字，AND 语义，忽略大小写） */
  filter(query) {
    const q = (query || '').trim().toLowerCase();
    const all = this.list();
    if (!q) return all;
    const needles = q.split(/\s+/).filter(Boolean);
    return all.filter(cmd => {
      const haystack = [
        cmd.title, cmd.category, cmd.id, cmd.description, ...cmd.keywords,
      ].join(' ').toLowerCase();
      return needles.every(n => haystack.includes(n));
    });
  }

  /** 执行一个命令，返回 handler 的返回值（会吞掉异常并转换成 success:false） */
  async run(id, payload = null) {
    const cmd = this._commands.get(id);
    if (!cmd) return { success: false, message: `未知命令: ${id}` };
    if (!cmd.enabled()) return { success: false, message: `命令 ${cmd.id} 当前不可用` };
    try {
      const result = await cmd.handler(payload);
      if (result && typeof result === 'object' && 'success' in result) return result;
      return { success: true, message: result?.message || '' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 从一个 {id -> handler-like object} 字典批量注册（方便跨文件组织） */
  bulk(patch) {
    for (const [id, cmd] of Object.entries(patch || {})) this.register({ id, ...cmd });
    return this;
  }
}

// 全局单例，CLI / Desktop 共享
const defaultCatalog = new CommandCatalog();

// 注册一组默认的"通用命令"。具体业务侧的命令（切换模型、跑测试、MCP servers 等）
// 可以在业务入口（desktop/main-app.js 或 cli/index.js）里再额外 register。
defaultCatalog.bulk({
  'core.toggle-debug': {
    title: '切换调试模式', category: '设置', keywords: ['debug', '调试', '日志'],
    description: '启用/禁用 Agent LLM 请求与工具执行的详细日志',
    handler: () => ({ success: true, message: 'debug toggle 交由上层订阅' }),
  },
  'core.clear-session': {
    title: '清空当前会话', category: '会话', keywords: ['clear', '重置', 'session'],
    description: '重置会话消息与工具执行历史（不会删除已保存的文档索引）',
    requiresConfirm: true,
    handler: () => ({ success: true, message: 'session clear 交由上层订阅' }),
  },
  'core.stop-agent': {
    title: '停止 Agent', category: '会话', keywords: ['stop', 'cancel', '中止', '取消'],
    description: '立刻中断当前的 Agent 执行',
    handler: () => ({ success: true, message: 'stop 交由上层订阅' }),
  },
});

export const commandCatalog = defaultCatalog;
export default commandCatalog;
