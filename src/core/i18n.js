/**
 * Internationalization (i18n) Support
 * 国际化支持模块
 *
 * 功能：
 * - 多语言消息管理
 * - 自动语言检测
 * - 动态语言切换
 * - 格式化支持（数字、日期、货币）
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// 支持的语言
export const SupportedLanguages = Object.freeze({
  EN: 'en',
  ZH_CN: 'zh-CN',
  ZH_TW: 'zh-TW',
  JA: 'ja',
  KO: 'ko',
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  RU: 'ru',
  AR: 'ar',
});

// 默认语言 - 简体中文
export const DEFAULT_LANGUAGE = 'zh-CN';

// 内置翻译
const TRANSLATIONS = {
  en: {
    // 通用
    'common.ok': 'OK',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.error': 'Error',
    'common.warning': 'Warning',
    'common.success': 'Success',
    'common.loading': 'Loading...',
    'common.processing': 'Processing...',
    'common.done': 'Done',
    'common.failed': 'Failed',
    'common.retry': 'Retry',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.finish': 'Finish',
    'common.close': 'Close',
    'common.open': 'Open',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.search': 'Search',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.all': 'All',
    'common.none': 'None',
    'common.or': 'or',
    'common.and': 'and',

    // Agent
    'agent.thinking': 'Thinking...',
    'agent.reasoning': 'Reasoning...',
    'agent.executing': 'Executing...',
    'agent.completed': 'Completed',
    'agent.failed': 'Failed',
    'agent.waiting': 'Waiting...',
    'agent.tool_call': 'Calling tool: {tool}',
    'agent.tool_result': 'Tool result received',
    'agent.final_answer': 'Final Answer',
    'agent.max_iterations': 'Maximum iterations reached',
    'agent.timeout': 'Operation timed out',

    // Tools
    'tool.executing': 'Executing {tool}...',
    'tool.completed': '{tool} completed',
    'tool.failed': '{tool} failed: {error}',
    'tool.not_found': 'Tool not found: {tool}',
    'tool.invalid_args': 'Invalid arguments for {tool}',
    'tool.timeout': '{tool} timed out',

    // Errors
    'error.unknown': 'Unknown error occurred',
    'error.network': 'Network error: {message}',
    'error.file_not_found': 'File not found: {path}',
    'error.permission_denied': 'Permission denied',
    'error.invalid_input': 'Invalid input',
    'error.timeout': 'Operation timed out',
    'error.process_failed': 'Process execution failed',
    'error.port_in_use': 'Port {port} is already in use',
    'error.lock_acquired': 'Resource is locked by another process',

    // CLI
    'cli.welcome': 'Welcome to AI Engineering Agent',
    'cli.goodbye': 'Goodbye!',
    'cli.prompt': 'You',
    'cli.agent': 'Agent',
    'cli.system': 'System',
    'cli.help': 'Type /help for available commands',
    'cli.exit_hint': 'Type /exit or press Ctrl+C to exit',

    // Commands
    'cmd.help.title': 'Available Commands',
    'cmd.help.description': 'List of all available commands',
    'cmd.status.title': 'System Status',
    'cmd.status.running': 'Running',
    'cmd.status.stopped': 'Stopped',
    'cmd.status.error': 'Error',
  },

  'zh-CN': {
    // 通用
    'common.ok': '确定',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.error': '错误',
    'common.warning': '警告',
    'common.success': '成功',
    'common.loading': '加载中...',
    'common.processing': '处理中...',
    'common.done': '完成',
    'common.failed': '失败',
    'common.retry': '重试',
    'common.continue': '继续',
    'common.back': '返回',
    'common.next': '下一步',
    'common.finish': '完成',
    'common.close': '关闭',
    'common.open': '打开',
    'common.save': '保存',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.create': '创建',
    'common.search': '搜索',
    'common.filter': '筛选',
    'common.sort': '排序',
    'common.all': '全部',
    'common.none': '无',
    'common.or': '或',
    'common.and': '和',

    // Agent
    'agent.thinking': '思考中...',
    'agent.reasoning': '推理中...',
    'agent.executing': '执行中...',
    'agent.completed': '已完成',
    'agent.failed': '失败',
    'agent.waiting': '等待中...',
    'agent.tool_call': '调用工具: {tool}',
    'agent.tool_result': '收到工具结果',
    'agent.final_answer': '最终答案',
    'agent.max_iterations': '已达到最大迭代次数',
    'agent.timeout': '操作超时',

    // Tools
    'tool.executing': '执行 {tool}...',
    'tool.completed': '{tool} 完成',
    'tool.failed': '{tool} 失败: {error}',
    'tool.not_found': '未找到工具: {tool}',
    'tool.invalid_args': '{tool} 参数无效',
    'tool.timeout': '{tool} 超时',

    // Errors
    'error.unknown': '发生未知错误',
    'error.network': '网络错误: {message}',
    'error.file_not_found': '文件未找到: {path}',
    'error.permission_denied': '权限被拒绝',
    'error.invalid_input': '输入无效',
    'error.timeout': '操作超时',
    'error.process_failed': '进程执行失败',
    'error.port_in_use': '端口 {port} 已被占用',
    'error.lock_acquired': '资源被其他进程锁定',

    // CLI
    'cli.welcome': '欢迎使用 AI Engineering Agent',
    'cli.goodbye': '再见！',
    'cli.prompt': '您',
    'cli.agent': '助手',
    'cli.system': '系统',
    'cli.help': '输入 /help 查看可用命令',
    'cli.exit_hint': '输入 /exit 或按 Ctrl+C 退出',

    // Commands
    'cmd.help.title': '可用命令',
    'cmd.help.description': '所有可用命令列表',
    'cmd.status.title': '系统状态',
    'cmd.status.running': '运行中',
    'cmd.status.stopped': '已停止',
    'cmd.status.error': '错误',
  },

  'zh-TW': {
    // 繁體中文
    'common.ok': '確定',
    'common.cancel': '取消',
    'common.confirm': '確認',
    'common.error': '錯誤',
    'common.warning': '警告',
    'common.success': '成功',
    'common.loading': '載入中...',
    'common.processing': '處理中...',
    'common.done': '完成',
    'common.failed': '失敗',
    'common.retry': '重試',
    'common.continue': '繼續',
    'common.back': '返回',
    'common.next': '下一步',
    'common.finish': '完成',
    'common.close': '關閉',
    'common.open': '開啟',
    'common.save': '儲存',
    'common.delete': '刪除',
    'common.edit': '編輯',
    'common.create': '創建',
    'common.search': '搜索',
    'common.filter': '篩選',
    'common.sort': '排序',
    'common.all': '全部',
    'common.none': '無',
    'common.or': '或',
    'common.and': '和',

    // Agent
    'agent.thinking': '思考中...',
    'agent.reasoning': '推理中...',
    'agent.executing': '執行中...',
    'agent.completed': '已完成',
    'agent.failed': '失敗',
    'agent.waiting': '等待中...',
    'agent.tool_call': '呼叫工具: {tool}',
    'agent.tool_result': '收到工具結果',
    'agent.final_answer': '最終答案',
    'agent.max_iterations': '已達到最大迭代次數',
    'agent.timeout': '操作逾時',

    // Tools
    'tool.executing': '執行 {tool}...',
    'tool.completed': '{tool} 完成',
    'tool.failed': '{tool} 失敗: {error}',
    'tool.not_found': '未找到工具: {tool}',
    'tool.invalid_args': '{tool} 參數無效',
    'tool.timeout': '{tool} 逾時',

    // Errors
    'error.unknown': '發生未知錯誤',
    'error.network': '網路錯誤: {message}',
    'error.file_not_found': '檔案未找到: {path}',
    'error.permission_denied': '權限被拒絕',
    'error.invalid_input': '輸入無效',
    'error.timeout': '操作逾時',
    'error.process_failed': '程序執行失敗',
    'error.port_in_use': '埠號 {port} 已被佔用',
    'error.lock_acquired': '資源被其他程序鎖定',

    // CLI
    'cli.welcome': '歡迎使用 AI Engineering Agent',
    'cli.goodbye': '再見！',
    'cli.prompt': '您',
    'cli.agent': '助手',
    'cli.system': '系統',
    'cli.help': '輸入 /help 查看可用命令',
    'cli.exit_hint': '輸入 /exit 或按 Ctrl+C 退出',

    // Commands
    'cmd.help.title': '可用命令',
    'cmd.help.description': '所有可用命令列表',
    'cmd.status.title': '系統狀態',
    'cmd.status.running': '執行中',
    'cmd.status.stopped': '已停止',
    'cmd.status.error': '錯誤',
  },
};

export class I18n {
  #currentLanguage;
  #translations;
  #fallbackLanguage;

  constructor(options = {}) {
    const language =
      options.language ?? (options.autoDetect ? this.#detectLanguage() : DEFAULT_LANGUAGE);
    this.#currentLanguage = language;
    this.#fallbackLanguage = options.fallbackLanguage || DEFAULT_LANGUAGE;
    this.#translations = new Map();

    // 加载内置翻译
    this.#loadBuiltInTranslations();

    // 加载外部翻译文件
    if (options.translationsDir) {
      this.#loadExternalTranslations(options.translationsDir);
    }
  }

  /**
   * 检测系统语言
   */
  #detectLanguage() {
    // 从环境变量检测
    const envLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL;
    if (envLang) {
      const lang = envLang.split('.')[0].split('_')[0].toLowerCase();

      // 映射到支持的语言
      const langMap = {
        zh: 'zh-CN',
        en: 'en',
        ja: 'ja',
        ko: 'ko',
        de: 'de',
        fr: 'fr',
        es: 'es',
        ru: 'ru',
        ar: 'ar',
      };

      if (langMap[lang]) {
        // 进一步区分简体中文和繁体中文
        if (lang === 'zh') {
          if (envLang.includes('TW') || envLang.includes('HK') || envLang.includes('MO')) {
            return 'zh-TW';
          }
          return 'zh-CN';
        }
        return langMap[lang];
      }
    }

    return DEFAULT_LANGUAGE;
  }

  /**
   * 加载内置翻译
   */
  #loadBuiltInTranslations() {
    for (const [lang, translations] of Object.entries(TRANSLATIONS)) {
      this.#translations.set(lang, translations);
    }
  }

  /**
   * 加载外部翻译文件
   */
  #loadExternalTranslations(dir) {
    try {
      for (const lang of Object.values(SupportedLanguages)) {
        const filePath = resolve(dir, `${lang}.json`);
        if (existsSync(filePath)) {
          const content = JSON.parse(readFileSync(filePath, 'utf-8'));
          const existing = this.#translations.get(lang) || {};
          this.#translations.set(lang, { ...existing, ...content });
        }
      }
    } catch (error) {
      console.warn('Failed to load external translations:', error.message);
    }
  }

  /**
   * 获取当前语言
   */
  getCurrentLanguage() {
    return this.#currentLanguage;
  }

  /**
   * 设置语言
   */
  setLanguage(language) {
    if (this.#translations.has(language)) {
      this.#currentLanguage = language;
      return true;
    }
    console.warn(`Language not supported: ${language}`);
    return false;
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages() {
    return Array.from(this.#translations.keys());
  }

  /**
   * 翻译消息
   * @param {string} key - 消息键
   * @param {object} params - 替换参数
   * @returns {string} 翻译后的消息
   */
  t(key, params = {}) {
    // 尝试当前语言
    let message = this.#getMessage(this.#currentLanguage, key);

    // 如果没有找到，尝试回退语言
    if (!message && this.#currentLanguage !== this.#fallbackLanguage) {
      message = this.#getMessage(this.#fallbackLanguage, key);
    }

    // 如果仍然没有找到，返回键名
    if (!message) {
      return key;
    }

    // 替换参数
    return this.#interpolate(message, params);
  }

  /**
   * 获取消息
   */
  #getMessage(language, key) {
    const translations = this.#translations.get(language);
    return translations ? translations[key] : null;
  }

  /**
   * 插值替换
   */
  #interpolate(message, params) {
    return message.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }

  /**
   * 格式化数字
   */
  formatNumber(number, options = {}) {
    const locale = this.#currentLanguage;
    return new Intl.NumberFormat(locale, options).format(number);
  }

  /**
   * 格式化日期
   */
  formatDate(date, options = {}) {
    const locale = this.#currentLanguage;
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, options).format(d);
  }

  /**
   * 格式化相对时间
   */
  formatRelativeTime(value, unit, options = {}) {
    const locale = this.#currentLanguage;
    return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
  }

  /**
   * 格式化货币
   */
  formatCurrency(value, currency = 'USD', options = {}) {
    const locale = this.#currentLanguage;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      ...options,
    }).format(value);
  }

  /**
   * 添加翻译
   */
  addTranslations(language, translations) {
    const existing = this.#translations.get(language) || {};
    this.#translations.set(language, { ...existing, ...translations });
  }

  /**
   * 检查是否有翻译
   */
  hasTranslation(key) {
    return (
      !!this.#getMessage(this.#currentLanguage, key) ||
      !!this.#getMessage(this.#fallbackLanguage, key)
    );
  }
}

// 创建单例实例
let i18nInstance = null;

export function getI18n(options = {}) {
  if (!i18nInstance) {
    i18nInstance = new I18n(options);
  }
  return i18nInstance;
}

export function createI18n(options = {}) {
  return new I18n(options);
}

export default I18n;
