import { describe, expect, test } from 'bun:test';
import {
  APP_NAME,
  APP_DISPLAY_NAME,
  APP_COPYRIGHT,
  APP_CREDITS,
  getProviderRequirement,
  getProviderModel,
  getProviderBaseUrl,
  getMissingRequiredConfig,
  buildMissingConfigMessage,
} from '../../src/core/runtime/runtime-config.js';

describe('RuntimeConfig — app constants', () => {
  test('APP_NAME is mastery', () => {
    expect(APP_NAME).toBe('mastery');
  });

  test('APP_DISPLAY_NAME is defined', () => {
    expect(APP_DISPLAY_NAME).toBe('AI Agent Desktop');
  });

  test('APP_COPYRIGHT and APP_CREDITS are strings', () => {
    expect(typeof APP_COPYRIGHT).toBe('string');
    expect(APP_COPYRIGHT.length).toBeGreaterThan(0);
    expect(typeof APP_CREDITS).toBe('string');
  });
});

describe('RuntimeConfig — getProviderRequirement', () => {
  test('returns config for known provider: openai', () => {
    const cfg = getProviderRequirement('openai');
    expect(cfg).not.toBeNull();
    expect(cfg.keyVar).toBe('OPENAI_API_KEY');
    expect(cfg.defaultModel).toBe('gpt-4o');
  });

  test('returns config for zhipu', () => {
    const cfg = getProviderRequirement('zhipu');
    expect(cfg.defaultModel).toBe('glm-4');
  });

  test('returns config for deepseek', () => {
    const cfg = getProviderRequirement('deepseek');
    expect(cfg.defaultModel).toBe('deepseek-chat');
  });

  test('returns config for openrouter', () => {
    const cfg = getProviderRequirement('openrouter');
    expect(cfg.defaultModel).toBe('anthropic/claude-3.5-sonnet');
  });

  test('returns null for unknown provider', () => {
    expect(getProviderRequirement('nonexistent')).toBeNull();
  });
});

describe('RuntimeConfig — getProviderModel', () => {
  test('uses provider default when no env set', () => {
    const model = getProviderModel('openai', {});
    expect(model).toBe('gpt-4o');
  });

  test('uses env MODEL as fallback for unknown provider', () => {
    const model = getProviderModel('unknown', { MODEL: 'my-model' });
    expect(model).toBe('my-model');
  });

  test('falls back to gpt-4 for unknown provider without any env', () => {
    const model = getProviderModel('unknown', {});
    expect(model).toBe('gpt-4');
  });

  test('env OPENAI_MODEL takes precedence for openai', () => {
    const model = getProviderModel('openai', { OPENAI_MODEL: 'custom-model' });
    expect(model).toBe('custom-model');
  });

  test('env DEEPSEEK_MODEL takes precedence for deepseek', () => {
    const model = getProviderModel('deepseek', { DEEPSEEK_MODEL: 'custom-deepseek' });
    expect(model).toBe('custom-deepseek');
  });

  test('env MODEL overrides provider-specific model', () => {
    const model = getProviderModel('openai', { MODEL: 'override-model' });
    expect(model).toBe('override-model');
  });
});

describe('RuntimeConfig — getProviderBaseUrl', () => {
  test('returns default baseUrl for openai', () => {
    const url = getProviderBaseUrl('openai', {});
    expect(url).toBe('https://api.openai.com/v1');
  });

  test('env OPENAI_BASE_URL overrides for openai', () => {
    const url = getProviderBaseUrl('openai', { OPENAI_BASE_URL: 'https://custom/v1' });
    expect(url).toBe('https://custom/v1');
  });

  test('env OPENAI_API_URL also works for openai', () => {
    const url = getProviderBaseUrl('openai', { OPENAI_API_URL: 'https://alt/v1' });
    expect(url).toBe('https://alt/v1');
  });

  test('returns default for deepseek', () => {
    const url = getProviderBaseUrl('deepseek', {});
    expect(url).toBe('https://api.deepseek.com/v1');
  });

  test('returns undefined for unknown provider', () => {
    expect(getProviderBaseUrl('unknown', {})).toBeUndefined();
  });
});

describe('RuntimeConfig — getMissingRequiredConfig', () => {
  const withKey = (provider, key, extra = {}) => {
    return getMissingRequiredConfig({ MODEL_PROVIDER: provider, [key]: 'sk-xxx', ...extra });
  };
  const withoutKey = (provider, extra = {}) => {
    return getMissingRequiredConfig({ MODEL_PROVIDER: provider, ...extra });
  };

  test('returns empty when API key is present', () => {
    expect(withKey('openai', 'OPENAI_API_KEY')).toEqual([]);
    expect(withKey('deepseek', 'DEEPSEEK_API_KEY')).toEqual([]);
  });

  test('returns key var name when API key is missing', () => {
    expect(withoutKey('openai')).toEqual(['OPENAI_API_KEY']);
    expect(withoutKey('deepseek')).toEqual(['DEEPSEEK_API_KEY']);
  });

  test('returns empty for unknown provider', () => {
    expect(withoutKey('nonexistent')).toEqual([]);
  });

  test('defaults to openai when no MODEL_PROVIDER set', () => {
    expect(getMissingRequiredConfig({})).toEqual(['OPENAI_API_KEY']);
  });
});

describe('RuntimeConfig — buildMissingConfigMessage', () => {
  test('includes variable names and user env path', () => {
    const msg = buildMissingConfigMessage(['OPENAI_API_KEY', 'OPENAI_BASE_URL'], '/tmp/.env');
    expect(msg).toContain('OPENAI_API_KEY');
    expect(msg).toContain('OPENAI_BASE_URL');
    expect(msg).toContain('/tmp/.env');
  });

  test('handles single missing var', () => {
    const msg = buildMissingConfigMessage(['DEEPSEEK_API_KEY'], '/tmp/.env');
    expect(msg).toContain('DEEPSEEK_API_KEY');
  });
});
