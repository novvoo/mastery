import { describe, test, expect } from 'bun:test';
import {
  APP_NAME,
  APP_DISPLAY_NAME,
  APP_COPYRIGHT,
  APP_CREDITS,
  getUserConfigDir,
  getUserEnvPath,
  getProviderRequirement,
  getProviderModel,
  getProviderBaseUrl,
  getMissingRequiredConfig,
  buildMissingConfigMessage,
  applyRuntimeValues,
} from '../../src/core/runtime-config.js';

describe('runtime-config (src/core)', () => {
  test('exports APP_NAME', () => {
    expect(APP_NAME).toBe('mastery');
  });

  test('exports APP_DISPLAY_NAME', () => {
    expect(APP_DISPLAY_NAME).toBe('AI Agent Desktop');
  });

  test('exports APP_COPYRIGHT', () => {
    expect(typeof APP_COPYRIGHT).toBe('string');
    expect(APP_COPYRIGHT.length).toBeGreaterThan(0);
  });

  test('exports APP_CREDITS', () => {
    expect(typeof APP_CREDITS).toBe('string');
    expect(APP_CREDITS.length).toBeGreaterThan(0);
  });

  test('getUserConfigDir respects AGENT_CONFIG_DIR', () => {
    const dir = getUserConfigDir({ AGENT_CONFIG_DIR: '/custom/dir' }, '/home', 'linux');
    expect(dir).toBe('/custom/dir');
  });

  test('getUserConfigDir uses XDG_CONFIG_HOME on Linux', () => {
    const dir = getUserConfigDir({ XDG_CONFIG_HOME: '/xdg' }, '/home', 'linux');
    expect(dir).toContain('/xdg');
  });

  test('getUserConfigDir defaults on Linux', () => {
    const dir = getUserConfigDir({}, '/home', 'linux');
    expect(dir).toContain('.config');
  });

  test('getUserConfigDir uses APPDATA on Windows', () => {
    const dir = getUserConfigDir({ APPDATA: 'C:\\AppData\\Roaming' }, 'C:\\Users\\test', 'win32');
    expect(dir).toContain('AppData');
  });

  test('getUserEnvPath returns .env path', () => {
    const envPath = getUserEnvPath({
      env: { HOME: '/home' },
      platform: () => 'linux',
      home: '/home',
    });
    expect(envPath).toContain('.env');
  });

  test('getProviderRequirement returns config for known providers', () => {
    const openai = getProviderRequirement('openai');
    expect(openai).toBeDefined();
    expect(openai.keyVar).toBe('OPENAI_API_KEY');

    const zhipu = getProviderRequirement('zhipu');
    expect(zhipu).toBeDefined();
    expect(zhipu.keyVar).toBe('ZHIPU_API_KEY');

    const deepseek = getProviderRequirement('deepseek');
    expect(deepseek).toBeDefined();
  });

  test('getProviderRequirement returns null for unknown provider', () => {
    expect(getProviderRequirement('unknown')).toBeNull();
  });

  test('getProviderModel returns model name from env', () => {
    const model = getProviderModel('openai', { OPENAI_MODEL: 'gpt-4-turbo' });
    expect(model).toBe('gpt-4-turbo');
  });

  test('getProviderModel returns default when not set', () => {
    const model = getProviderModel('openai', {});
    expect(model).toBe('gpt-4o');
  });

  test('getProviderBaseUrl returns base URL from env', () => {
    const url = getProviderBaseUrl('openai', { OPENAI_BASE_URL: 'https://custom.api.com/v1' });
    expect(url).toBe('https://custom.api.com/v1');
  });

  test('getProviderBaseUrl returns default when not set', () => {
    const url = getProviderBaseUrl('openai', {});
    expect(url).toBe('https://api.openai.com/v1');
  });

  test('getMissingRequiredConfig returns empty when key is set', () => {
    const missing = getMissingRequiredConfig({
      MODEL_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(missing).toEqual([]);
  });

  test('getMissingRequiredConfig returns missing keys', () => {
    const missing = getMissingRequiredConfig({ MODEL_PROVIDER: 'openai' });
    expect(missing).toContain('OPENAI_API_KEY');
  });

  test('buildMissingConfigMessage includes key name', () => {
    const msg = buildMissingConfigMessage(['OPENAI_API_KEY'], '/home/.config/.env');
    expect(msg).toContain('OPENAI_API_KEY');
  });

  test('applyRuntimeValues sets env vars', () => {
    const env = {};
    applyRuntimeValues({ KEY1: 'val1', KEY2: 'val2' }, env);
    expect(env.KEY1).toBe('val1');
    expect(env.KEY2).toBe('val2');
  });

  test('applyRuntimeValues skips undefined values', () => {
    const env = {};
    applyRuntimeValues({ KEY1: 'val1', KEY2: undefined }, env);
    expect(env.KEY1).toBe('val1');
    expect(env.KEY2).toBeUndefined();
  });
});
