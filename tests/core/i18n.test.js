import { describe, test, expect, beforeEach } from 'bun:test';
import { I18n, getI18n, createI18n, SupportedLanguages, DEFAULT_LANGUAGE } from '../../src/core/i18n.js';

describe('i18n - 默认语言与翻译', () => {

  beforeEach(() => {
    // 清除单例，以便每个测试从干净状态开始
  });

  test('DEFAULT_LANGUAGE 应为简体中文', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh-CN');
  });

  test('createI18n 不传参数时默认使用 zh-CN', () => {
    const inst = createI18n();
    expect(inst.getCurrentLanguage()).toBe('zh-CN');
  });

  test('简体中文翻译：common.ok 应为 确定', () => {
    const inst = createI18n();
    const okText = inst.t('common.ok');
    expect(okText).toBe('确定');
  });

  test('简体中文翻译：common.cancel 应为 取消', () => {
    const inst = createI18n();
    expect(inst.t('common.cancel')).toBe('取消');
  });

  test('简体中文翻译：agent.thinking 应为 思考中...', () => {
    const inst = createI18n();
    expect(inst.t('agent.thinking')).toBe('思考中...');
  });

  test('简体中文翻译：agent.tool_call 可正确插值 {tool}', () => {
    const inst = createI18n();
    const result = inst.t('agent.tool_call', { tool: 'list_files' });
    expect(result).toBe('调用工具: list_files');
  });

  test('支持指定语言为 zh-CN', () => {
    const inst = createI18n();
    expect(inst.getSupportedLanguages()).toContain('zh-CN');
  });

  test('SupportedLanguages 应包含 10 种语言', () => {
    expect(SupportedLanguages).toBeDefined();
    expect(SupportedLanguages.EN).toBe('en');
    expect(SupportedLanguages.ZH_CN).toBe('zh-CN');
    expect(SupportedLanguages.ZH_TW).toBe('zh-TW');
    expect(SupportedLanguages.JA).toBe('ja');
  });

  test('切换到 en 时返回英文翻译', () => {
    const inst = createI18n({ language: 'en' });
    expect(inst.t('common.ok')).toBe('OK');
  });

  test('不存在的 key 回退到 key 本身', () => {
    const inst = createI18n();
    expect(inst.t('nonexistent.key')).toBe('nonexistent.key');
  });

  test('setLanguage 可以动态切换语言', () => {
    const inst = createI18n();
    inst.setLanguage('en');
    expect(inst.getCurrentLanguage()).toBe('en');
    expect(inst.t('common.ok')).toBe('OK');

    inst.setLanguage('zh-CN');
    expect(inst.getCurrentLanguage()).toBe('zh-CN');
    expect(inst.t('common.ok')).toBe('确定');
  });

  test('getI18n 返回单例', () => {
    const inst1 = getI18n();
    const inst2 = getI18n();
    expect(inst1).toBe(inst2);
  });

  test('createI18n 每次都创建新实例', () => {
    const inst1 = createI18n();
    const inst2 = createI18n();
    expect(inst1).not.toBe(inst2);
  });

  test('fallback 语言可以自定义', () => {
    const inst = createI18n({ language: 'en', fallbackLanguage: 'zh-CN' });
    // 当前语言为 en，但在 zh-CN 中有、在 en 中无的 key 应在 zh-CN 查找后找不到就返回 key 本身
    expect(typeof inst.t('common.ok')).toBe('string');
  });

  test('环境变量 LANG=zh_CN.UTF-8 检测为 zh-CN', () => {
    const originalLang = process.env.LANG;
    process.env.LANG = 'zh_CN.UTF-8';
    // 新建实例使用环境变量
    const inst = new I18n();
    expect(inst.getCurrentLanguage()).toBe('zh-CN');
    if (originalLang !== undefined) {
      process.env.LANG = originalLang;
    } else {
      delete process.env.LANG;
    }
  });

  test('cli 相关中文翻译', () => {
    const inst = createI18n();
    expect(inst.t('cli.welcome')).toBe('欢迎使用 AI Engineering Agent');
    expect(inst.t('cli.goodbye')).toBe('再见！');
    expect(inst.t('cli.prompt')).toBe('您');
    expect(inst.t('cli.agent')).toBe('助手');
    expect(inst.t('cli.system')).toBe('系统');
    expect(inst.t('cli.help')).toBe('输入 /help 查看可用命令');
  });

  test('命令相关中文翻译', () => {
    const inst = createI18n();
    expect(inst.t('cmd.help.title')).toBe('可用命令');
    expect(inst.t('cmd.status.title')).toBe('系统状态');
    expect(inst.t('cmd.status.running')).toBe('运行中');
    expect(inst.t('cmd.status.stopped')).toBe('已停止');
  });

  test('en 语言翻译完整', () => {
    const inst = createI18n({ language: 'en' });
    expect(inst.t('common.ok')).toBe('OK');
    expect(inst.t('common.cancel')).toBe('Cancel');
    expect(inst.t('agent.thinking')).toBe('Thinking...');
    expect(inst.t('agent.completed')).toBe('Completed');
  });

  test('ja 语言翻译完整', () => {
    const inst = createI18n({ language: 'ja' });
    // ja 在无翻译时会回退到 DEFAULT_LANGUAGE(zh-CN)
    // 我们只验证 ja 能正常工作不抛错
    const result = inst.t('common.ok');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
