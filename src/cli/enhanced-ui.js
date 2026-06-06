/**
 * Enhanced CLI UI utilities
 * 增强版 CLI 界面工具
 * 
 * Inspired by OpenAI Codex 2026 design:
 * - Summary Panel: Track agent plan, sources, and outputs
 * - Multi-Task: Parallel task execution display
 * - Context Annotations: Source tracking for information
 * - Proactive Suggestions: Context-aware recommendations
 * - Role-based Skill Cards: Organized skill bundles
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import Table from 'cli-table3';

let debugEnabled = process.env.DEBUG === 'true';

// 颜色主题
const theme = {
  primary: chalk.cyan,
  primaryBold: chalk.cyan.bold,
  secondary: chalk.magenta,
  success: chalk.green,
  successBold: chalk.green.bold,
  warning: chalk.yellow,
  warningBold: chalk.yellow.bold,
  error: chalk.red,
  errorBold: chalk.red.bold,
  info: chalk.blue,
  muted: chalk.gray,
  dim: chalk.dim,
  white: chalk.white,
  whiteBold: chalk.white.bold,
};

/**
 * 创建表格
 * @param {Object} options - 表格选项
 * @returns {Table}
 */
export function createTable(options = {}) {
  return new Table({
    style: {
      head: ['cyan'],
      border: ['gray'],
    },
    ...options,
  });
}

/**
 * 格式化状态标签
 * @param {string} status - 状态值
 * @returns {string}
 */
export function formatStatus(status) {
  const statusMap = {
    // 任务状态
    pending: theme.warning('⏳ PENDING'),
    waiting: theme.info('⏸️  WAITING'),
    running: theme.primary('▶️  RUNNING'),
    completed: theme.success('✅ COMPLETED'),
    failed: theme.error('❌ FAILED'),
    cancelled: theme.muted('🚫 CANCELLED'),
    // 代理状态
    idle: theme.muted('💤 IDLE'),
    stopped: theme.warning('🛑 STOPPED'),
    // 通用
    enabled: theme.success('● ON'),
    disabled: theme.muted('○ OFF'),
    active: theme.success('● ACTIVE'),
    inactive: theme.muted('○ INACTIVE'),
  };
  return statusMap[status] || theme.white(status);
}

/**
 * 格式化优先级
 * @param {number} priority - 优先级数值
 * @returns {string}
 */
export function formatPriority(priority) {
  const labels = ['🔴 CRITICAL', '🟠 HIGH', '🔵 NORMAL', '🟢 LOW', '⚪ BACKGROUND'];
  const colors = [theme.error, theme.warning, theme.info, theme.success, theme.muted];
  return colors[priority]?.(labels[priority]) || theme.white(String(priority));
}

/**
 * 截断文本
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度
 * @returns {string}
 */
export function truncate(text, maxLength) {
  if (!text) {return '';}
  const str = String(text);
  if (str.length <= maxLength) {return str;}
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * 格式化时间戳
 * @param {number} timestamp - 时间戳
 * @returns {string}
 */
export function formatTime(timestamp) {
  if (!timestamp) {return theme.muted('N/A');}
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // 小于1分钟
  if (diff < 60000) {return theme.success('just now');}
  // 小于1小时
  if (diff < 3600000) {return theme.info(`${Math.floor(diff / 60000)}m ago`);}
  // 小于24小时
  if (diff < 86400000) {return theme.warning(`${Math.floor(diff / 3600000)}h ago`);}
  // 默认显示日期
  return theme.muted(date.toLocaleString());
}

/**
 * 格式化持续时间
 * @param {number} ms - 毫秒数
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) {return theme.muted('N/A');}
  if (ms < 1000) {return `${ms}ms`;}
  if (ms < 60000) {return `${(ms / 1000).toFixed(1)}s`;}
  if (ms < 3600000) {return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;}
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * 创建带边框的盒子
 * @param {string} content - 内容
 * @param {Object} options - 选项
 * @returns {string}
 */
export function createBox(content, options = {}) {
  return boxen(content, {
    padding: 1,
    margin: { top: 0, bottom: 0 },
    borderStyle: 'round',
    borderColor: 'cyan',
    ...options,
  });
}

/**
 * 创建标题
 * @param {string} text - 标题文本
 * @returns {string}
 */
export function createHeader(text) {
  return '\n' + theme.dim('━'.repeat(60)) + '\n' + 
         theme.primaryBold(`  ${text}`) + '\n' + 
         theme.dim('━'.repeat(60));
}

/**
 * 创建分隔线
 * @param {string} char - 分隔字符
 * @returns {string}
 */
export function createSeparator(char = '─') {
  return theme.dim(char.repeat(60));
}

/**
 * 格式化 JSON 数据
 * @param {Object} data - 数据对象
 * @param {number} indent - 缩进
 * @returns {string}
 */
export function formatJSON(data, indent = 2) {
  const json = JSON.stringify(data, null, indent);
  return json
    .replace(/"(\w+)":/g, theme.secondary('"$1":'))
    .replace(/: "([^"]*)"/g, ': ' + theme.success('"$1"'))
    .replace(/: (\d+)/g, ': ' + theme.warning('$1'))
    .replace(/: (true|false|null)/g, ': ' + theme.primary('$1'));
}

/**
 * 创建进度条
 * @param {number} current - 当前值
 * @param {number} total - 总值
 * @param {number} width - 宽度
 * @returns {string}
 */
export function createProgressBar(current, total, width = 30) {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  
  const bar = theme.success('█'.repeat(filled)) + theme.dim('░'.repeat(empty));
  return `[${bar}] ${percentage.toFixed(1)}%`;
}

function formatDebugValue(value, maxLength = 800) {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (!text) {return '';}
  return text.length > maxLength ? text.substring(0, maxLength) + '... (truncated)' : text;
}

function tryParseJSON(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatToolResultPreview(name, result) {
  const parsed = tryParseJSON(result);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (name === 'web_search') {
      const count = Array.isArray(parsed.results) ? parsed.results.length : 0;
      const provider = parsed.provider ? ` via ${parsed.provider}` : '';
      const query = parsed.query ? ` for "${truncate(parsed.query, 60)}"` : '';
      return `${count} result${count === 1 ? '' : 's'}${provider}${query}`;
    }
    if (name === 'web_fetch') {
      const status = parsed.status ? `HTTP ${parsed.status}` : 'fetched';
      const chars = typeof parsed.text === 'string' ? `, ${parsed.text.length} chars` : '';
      const url = parsed.url ? ` ${truncate(parsed.url, 90)}` : '';
      return `${status}${chars}${url}`;
    }
    if (name === 'browser_open') {
      const state = parsed.opened ? 'opened' : 'ready';
      const target = parsed.target ? ` ${truncate(parsed.target, 90)}` : '';
      return `${state}${target}`;
    }
  }

  const text = typeof result === 'string'
    ? result
    : JSON.stringify(result);
  return truncate(String(text || '').replace(/\n/g, ' '), 180);
}

/**
 * Enhanced UI object
 */
export const enhancedUI = {
  theme,
  createTable,
  createBox,
  createHeader,
  createSeparator,
  formatStatus,
  formatPriority,
  formatTime,
  formatDuration,
  formatJSON,
  createProgressBar,
  truncate,

  // ============================================================
  // CODEX 2026 STYLE: Summary Panel - Track agent plan & outputs
  // ============================================================
  
  /**
   * Display a summary panel showing current plan, sources, and outputs
   * @param {Object} options - { plan, sources, outputs, compact }
   */
  summaryPanel(options = {}) {
    const { plan = [], sources = [], outputs = [], compact = false } = options;
    
    if (compact) {
      // Compact single-line summary
      if (plan.length > 0) {
        console.log(theme.dim(`  📋 Plan: ${plan[plan.length - 1]}`));
      }
      return;
    }
    
    console.log('\n' + theme.dim('┌' + '─'.repeat(58) + '┐'));
    
    // Plan section
    console.log(theme.dim('│') + theme.primaryBold('  📋 CURRENT PLAN') + theme.dim(' '.repeat(37) + '│'));
    if (plan.length === 0) {
      console.log(theme.dim('│') + theme.muted('    No active plan') + theme.dim(' '.repeat(40) + '│'));
    } else {
      plan.slice(-3).forEach((item, i) => {
        const prefix = i === Math.min(2, plan.length - 1) ? '└─' : '├─';
        const text = truncate(String(item), 48);
        console.log(theme.dim(`│     ${prefix} ${text}`) + theme.dim(' '.repeat(Math.max(0, 52 - text.length)) + '│'));
      });
    }
    
    // Sources section
    console.log(theme.dim('│') + theme.secondaryBold('  📚 SOURCES') + theme.dim(' '.repeat(42) + '│'));
    if (sources.length === 0) {
      console.log(theme.dim('│') + theme.muted('    No sources consulted') + theme.dim(' '.repeat(39) + '│'));
    } else {
      sources.slice(-2).forEach((source, i) => {
        const icon = source.type === 'file' ? '📄' : source.type === 'web' ? '🌐' : source.type === 'memory' ? '🧠' : '📌';
        const text = truncate(String(source.name || source.url || source), 44);
        console.log(theme.dim(`│     ${icon} ${text}`) + theme.dim(' '.repeat(Math.max(0, 50 - text.length)) + '│'));
      });
    }
    
    // Outputs section
    console.log(theme.dim('│') + theme.successBold('  📤 OUTPUTS') + theme.dim(' '.repeat(43) + '│'));
    if (outputs.length === 0) {
      console.log(theme.dim('│') + theme.muted('    No outputs yet') + theme.dim(' '.repeat(41) + '│'));
    } else {
      outputs.slice(-2).forEach((output, i) => {
        const text = truncate(String(output), 46);
        console.log(theme.dim(`│     ✅ ${text}`) + theme.dim(' '.repeat(Math.max(0, 49 - text.length)) + '│'));
      });
    }
    
    console.log(theme.dim('└' + '─'.repeat(58) + '┘'));
  },

  // ============================================================
  // CODEX 2026 STYLE: Multi-Task Display - Parallel execution
  // ============================================================
  
  /**
   * Display parallel task status
   * @param {Array} tasks - Array of { id, name, status, progress }
   */
  multiTaskPanel(tasks = []) {
    if (tasks.length === 0) {return;}
    
    console.log('\n' + theme.dim('┌' + '─'.repeat(58) + '┐'));
    console.log(theme.dim('│') + theme.primaryBold('  ⚡ PARALLEL TASKS') + theme.dim(' '.repeat(40) + `(${tasks.length} active)│`));
    
    tasks.forEach((task, i) => {
      const statusIcon = task.status === 'running' ? '▶️' : 
                         task.status === 'completed' ? '✅' : 
                         task.status === 'failed' ? '❌' : '⏳';
      const statusColor = task.status === 'running' ? theme.primary :
                          task.status === 'completed' ? theme.success :
                          task.status === 'failed' ? theme.error : theme.muted;
      
      let progressStr = '';
      if (typeof task.progress === 'number') {
        progressStr = ` ${theme.dim('[')}${theme.success('█'.repeat(Math.floor(task.progress * 20)))}${theme.dim('░'.repeat(20 - Math.floor(task.progress * 20)))}${theme.dim(`] ${(task.progress * 100).toFixed(0)}%`)}`;
      }
      
      const text = `${statusIcon} ${statusColor(truncate(task.name || task.id, 35))}${progressStr}`;
      const padding = Math.max(0, 54 - (task.name || task.id).length);
      console.log(theme.dim(`│  ${text}`) + theme.dim(' '.repeat(padding) + '│'));
    });
    
    console.log(theme.dim('└' + '─'.repeat(58) + '┘'));
  },

  // ============================================================
  // CODEX 2026 STYLE: Context Annotations - Source tracking
  // ============================================================
  
  /**
   * Display annotated context with source attribution
   * @param {Object} annotation - { text, source, type }
   */
  annotation(annotation = {}) {
    const { text, source, type = 'info' } = annotation;
    
    const typeConfig = {
      info: { icon: '📌', color: theme.info },
      file: { icon: '📄', color: theme.primary },
      web: { icon: '🌐', color: theme.secondary },
      memory: { icon: '🧠', color: theme.warning },
      skill: { icon: '🎯', color: theme.success },
    };
    
    const config = typeConfig[type] || typeConfig.info;
    console.log(`\n  ${config.icon} ${config.color.bold('[' + (source || type.toUpperCase()) + ']')} ${theme.white(text)}`);
  },

  /**
   * Show annotation mode indicator
   * @param {boolean} active - Whether annotation mode is active
   */
  annotationMode(active = false) {
    if (active) {
      console.log(theme.success.bold('\n  ✏️  ANNOTATION MODE - Select elements to request changes\n'));
    }
  },

  // ============================================================
  // CODEX 2026 STYLE: Proactive Suggestions
  // ============================================================
  
  /**
   * Display proactive suggestions based on context
   * @param {Array} suggestions - Array of { text, action, icon }
   */
  suggestions(suggestions = []) {
    if (suggestions.length === 0) {return;}
    
    console.log('\n' + theme.dim('┌' + '─'.repeat(58) + '┐'));
    console.log(theme.dim('│') + theme.warningBold('  💡 SUGGESTIONS') + theme.dim(' '.repeat(42) + '│'));
    
    suggestions.slice(0, 4).forEach((sug, i) => {
      const icon = sug.icon || '👉';
      const text = truncate(String(sug.text || sug), 44);
      const action = sug.action ? ` (${sug.action})` : '';
      console.log(theme.dim(`│  ${icon} ${text}${theme.secondary(action)}`) + theme.dim(' '.repeat(Math.max(0, 50 - text.length - action.length)) + '│'));
    });
    
    console.log(theme.dim('└' + '─'.repeat(58) + '┘'));
  },

  // ============================================================
  // CODEX 2026 STYLE: Role-based Skill Cards
  // ============================================================
  
  /**
   * Display skill cards in a role-based layout
   * @param {Object} roleData - { role, skills: [{ name, description, icon }] }
   */
  skillCards(roleData = {}) {
    const { role = 'General', skills = [] } = roleData;
    
    console.log('\n' + theme.primaryBold(`  🎯 ${role.toUpperCase()} SKILLS`));
    console.log(theme.dim('─'.repeat(60)));
    
    skills.forEach((skill, i) => {
      const icon = skill.icon || '⚡';
      const name = skill.name || skill;
      const desc = skill.description ? theme.dim(` - ${truncate(skill.description, 40)}`) : '';
      console.log(`  ${icon} ${theme.white.bold(name)}${desc}`);
    });
    
    console.log(theme.dim('─'.repeat(60)));
  },

  /**
   * Display available skill bundles (Codex-style plugin bundles)
   * @param {Object} bundles - { [category]: [{ name, description, icon }] }
   */
  skillBundles(bundles = {}) {
    console.log('\n' + theme.primaryBold('  📦 AVAILABLE SKILL BUNDLES'));
    console.log(theme.dim('─'.repeat(60)));
    
    Object.entries(bundles).forEach(([category, categorySkills]) => {
      console.log(`\n  ${theme.secondary.bold(category)}:`);
      categorySkills.slice(0, 5).forEach(skill => {
        const icon = skill.icon || '⚡';
        const name = skill.name || skill;
        const desc = skill.description ? theme.dim(` - ${truncate(skill.description, 35)}`) : '';
        console.log(`    ${icon} ${name}${desc}`);
      });
      if (categorySkills.length > 5) {
        console.log(`    ${theme.muted(`+${categorySkills.length - 5} more...`)}`);
      }
    });
    
    console.log(theme.dim('─'.repeat(60)));
  },

  // ============================================================
  // IMPROVED VISUAL HIERARCHY - Better spacing and typography
  // ============================================================
  
  /**
   * Create improved header with better visual hierarchy
   * @param {string} text - Header text
   * @param {Object} options - { subtitle, icon }
   */
  sectionHeader(text, options = {}) {
    const { subtitle, icon = '─' } = options;
    console.log('');
    console.log(theme.primaryBold(`  ${text}`));
    if (subtitle) {
      console.log(theme.dim(`  ${subtitle}`));
    }
    console.log(theme.dim(icon.repeat(60)));
    console.log('');
  },

  /**
   * Display context card with better spacing
   * @param {Object} card - { title, items, color }
   */
  contextCard(card = {}) {
    const { title, items = [], color = theme.primary } = card;
    
    console.log('');
    console.log(color.bold(`  ┌─ ${title}`));
    items.forEach((item, i) => {
      const isLast = i === items.length - 1;
      const prefix = isLast ? '└─' : '├─';
      const text = truncate(String(item), 52);
      console.log(theme.dim(`  │   ${prefix} ${text}`));
    });
    console.log(color('  └' + '─'.repeat(Math.max(0, 55)) + '┘'));
    console.log('');
  },

  // ============================================================
  // LEGACY COMPATIBILITY
  // ============================================================

  // 快捷方法
  brand: (text) => theme.primaryBold(text),
  success(text) {
    const line = theme.success('✅ ' + text);
    console.log(line);
    return line;
  },
  error(text) {
    const line = theme.error('❌ ' + text);
    console.log(line);
    return line;
  },
  warning(text) {
    const line = theme.warning('⚠️  ' + text);
    console.log(line);
    return line;
  },
  warn(text) {
    return this.warning(text);
  },
  info(text) {
    const line = theme.info('ℹ️  ' + text);
    console.log(line);
    return line;
  },
  setDebugMode(enabled) {
    debugEnabled = Boolean(enabled);
  },

  isDebugEnabled() {
    return debugEnabled || process.env.DEBUG === 'true';
  },

  debug(text) {
    if (!this.isDebugEnabled()) {
      return '';
    }
    const line = theme.muted('🔍 ' + text);
    console.log(line);
    return line;
  },

  debugEvent(label, details = {}) {
    if (!this.isDebugEnabled()) {
      return;
    }

    const timestamp = new Date().toISOString();
    console.log(theme.muted(`🔍 [${timestamp}] ${label}`));

    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) {
        continue;
      }
      const rendered = formatDebugValue(value).replace(/\n/g, '\n       ');
      console.log(theme.muted(`     ${key}: ${rendered}`));
    }
  },
  
  // 工具调用显示
  toolCall(name, args) {
    console.log('');
    console.log(theme.warning(`  🔧 ${theme.white.bold(name)}`));
    const entries = Object.entries(args);
    if (entries.length > 0) {
      entries.forEach(([key, value], index) => {
        const isLast = index === entries.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const display = typeof value === 'string' && value.length > 80
          ? value.substring(0, 80) + '...'
          : String(value);
        console.log(theme.dim(`     ${prefix} ${key}: ${display}`));
      });
    }
  },

  // 工具结果显示
  toolResult(name, result) {
    const preview = formatToolResultPreview(name, result);
    console.log(theme.success(`  ✅ ${name}: ${theme.dim(preview)}`));
  },

  // 工具错误显示
  toolError(name, error) {
    console.log(theme.error(`  ❌ ${name}: ${error}`));
  },

  // 思考过程显示
  thought(text) {
    console.log('');
    console.log(theme.info('  💭 ') + theme.white(text));
  },

  // 迭代显示
  iteration(current, max) {
    console.log(theme.dim(`  ⏳ Iteration ${current}/${max}`));
  },

  // 最终答案显示
  finalAnswer(text) {
    console.log('');
    console.log(createBox(text, { 
      title: 'Final Answer',
      titleAlignment: 'center',
      borderColor: 'green'
    }));
    console.log('');
  },

  // 欢迎界面
  welcome(config) {
    const content = [
      theme.primaryBold('AI Engineering Mastery Agent v1.0.11'),
      '',
      `${theme.muted('Model:')} ${theme.white(config.model)}`,
      `${theme.muted('Provider:')} ${theme.white(config.provider)}`,
      `${theme.muted('Working Dir:')} ${theme.white(config.workingDir)}`,
      '',
      theme.dim('Type your request or "exit" to quit'),
      theme.dim('Skills auto-trigger based on context'),
      theme.dim('Use /help for available commands'),
    ].join('\n');

    console.log(createBox(content, { 
      borderColor: 'cyan',
      padding: 1,
    }));
    console.log('');
  },

  // 提示符
  prompt(label = 'You') {
    return theme.secondary.bold(`[${label}] `) + theme.white('❯ ');
  },

  // 创建 spinner
  spinner(text = 'Thinking') {
    return ora({
      text: theme.dim(text),
      spinner: 'dots',
      color: 'cyan',
    });
  },
};

export default enhancedUI;
