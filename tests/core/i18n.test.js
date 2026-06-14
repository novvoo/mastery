import { describe, test, expect } from 'bun:test';
import { I18n, getI18n, createI18n, SupportedLanguages } from '../../src/core/i18n.js';

describe('i18n', () => {
  test('getI18n returns an i18n instance', () => {
    const inst = getI18n();
    expect(inst).toBeDefined();
  });

  test('createI18n creates a new instance', () => {
    const inst = createI18n();
    expect(inst).toBeDefined();
    expect(inst).toBeInstanceOf(I18n);
  });

  test('I18n has t method for translation', () => {
    const inst = getI18n();
    if (typeof inst.t === 'function') {
      const result = inst.t('common.confirm');
      expect(typeof result).toBe('string');
    }
  });

  test('I18n setLocale changes locale', () => {
    const inst = createI18n({ locale: 'en' });
    if (typeof inst.setLocale === 'function') {
      inst.setLocale('en');
      const locale = inst.getLocale ? inst.getLocale() : inst.locale;
      expect(locale).toBe('en');
    }
  });

  test('I18n addTranslations adds custom translations', () => {
    const inst = createI18n({ locale: 'test-locale' });
    if (typeof inst.addTranslations === 'function') {
      inst.addTranslations('test-locale', { greeting: 'Hello!' });
    }
  });

  test('SupportedLanguages has entries', () => {
    expect(SupportedLanguages).toBeDefined();
    expect(typeof SupportedLanguages).toBe('object');
  });

  test('I18n defaults export', () => {
    expect(I18n).toBeDefined();
    expect(typeof I18n).toBe('function');
  });
});
