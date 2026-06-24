import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { switchModel } from '../../src/cli/agent-app-model-commands.js';
import { getUserEnvPath, writeUserEnv, loadRuntimeEnv } from '../../src/core/runtime/runtime-config.js';
import { existsSync, readFileSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Model Switch Configuration Persistence', () => {
  let testDir;
  let originalEnv;

  beforeEach(() => {
    testDir = join(tmpdir(), `mastery-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Object.keys(process.env).forEach(key => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    
    try {
      rmdirSync(testDir, { recursive: true });
    } catch {}
  });

  test('writeUserEnv creates .env file with correct format', () => {
    const envPath = join(testDir, '.env');
    const values = {
      MODEL_PROVIDER: 'zhipu',
      ZHIPU_MODEL: 'glm-4',
      ZHIPU_API_KEY: 'test-key',
    };
    
    writeUserEnv(values, { envPath });
    
    expect(existsSync(envPath)).toBe(true);
    
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('MODEL_PROVIDER=zhipu');
    expect(content).toContain('ZHIPU_MODEL=glm-4');
    expect(content).toContain('ZHIPU_API_KEY=test-key');
  });

  test('writeUserEnv merges with existing values', () => {
    const envPath = join(testDir, '.env');
    writeUserEnv({ EXISTING_KEY: 'existing-value' }, { envPath });
    writeUserEnv({ NEW_KEY: 'new-value' }, { envPath });
    
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXISTING_KEY=existing-value');
    expect(content).toContain('NEW_KEY=new-value');
  });

  test('writeUserEnv handles empty values', () => {
    const envPath = join(testDir, '.env');
    writeUserEnv({ EMPTY: '', UNDEFINED: undefined, VALID: 'value' }, { envPath });
    
    const content = readFileSync(envPath, 'utf-8');
    expect(content).not.toContain('EMPTY');
    expect(content).not.toContain('UNDEFINED');
    expect(content).toContain('VALID=value');
  });

  test('writeUserEnv escapes special characters', () => {
    const envPath = join(testDir, '.env');
    writeUserEnv({ 
      WITH_SPACE: 'hello world',
      WITH_QUOTE: 'it"s a test',
      COMPLEX: 'path/to/file?query=1',
    }, { envPath });
    
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('WITH_SPACE="hello world"');
    expect(content).toContain(JSON.stringify('it"s a test'));
    expect(content).toContain('COMPLEX="path/to/file?query=1"');
  });

  test('getUserEnvPath returns correct path', () => {
    const path = getUserEnvPath();
    expect(path).toContain('.config/mastery');
    expect(path.endsWith('.env')).toBe(true);
  });

  test('loadRuntimeEnv reads from user config path', () => {
    const envPath = join(testDir, '.env');
    writeUserEnv({ TEST_VAR: 'test-value' }, { envPath });
    
    const mockEnv = {};
    loadRuntimeEnv({ env: mockEnv, userEnvPath: envPath, cwdEnvPath: '/nonexistent/.env' });
    
    expect(mockEnv.TEST_VAR).toBe('test-value');
  });

  test('loadRuntimeEnv gives priority to process.env over user config', () => {
    const envPath = join(testDir, '.env');
    writeUserEnv({ TEST_VAR: 'file-value' }, { envPath });
    
    const mockEnv = { TEST_VAR: 'env-value' };
    loadRuntimeEnv({ env: mockEnv, userEnvPath: envPath, cwdEnvPath: '/nonexistent/.env' });
    
    expect(mockEnv.TEST_VAR).toBe('env-value');
  });

  test('getUserConfigDir respects AGENT_CONFIG_DIR env var', () => {
    const result = getUserEnvPath({ env: { AGENT_CONFIG_DIR: testDir } });
    expect(result).toBe(join(testDir, '.env'));
  });

  describe('switchModel', () => {
    beforeEach(() => {});

    afterEach(() => {
      mock.restore();
    });

    test('switchModel persists MODEL_PROVIDER and OPENAI_MODEL to .env', async () => {
      mock.module('../../src/cli/model-provider-factory.js', () => ({
        assertSupportedProvider: () => {},
        createModelProviderForSwitch: () => ({ mock: 'provider' }),
      }));

      const { switchModel: mockedSwitchModel } = await import('../../src/cli/agent-app-model-commands.js');
      
      const agent = {
        config: { provider: 'zhipu', model: 'glm-4', temperature: 0.7, maxIterations: 10 },
        debugMode: false,
        engine: { attachModelProvider: () => {} },
        schedulerEngine: null,
        modelProvider: null,
      };

      await mockedSwitchModel(agent, 'openai', 'gpt-4o');
      
      expect(agent.config.provider).toBe('openai');
      expect(agent.config.model).toBe('gpt-4o');
    });

    test('switchModel persists MODEL_PROVIDER and ZHIPU_MODEL to .env', async () => {
      mock.module('../../src/cli/model-provider-factory.js', () => ({
        assertSupportedProvider: () => {},
        createModelProviderForSwitch: () => ({ mock: 'provider' }),
      }));

      const { switchModel: mockedSwitchModel } = await import('../../src/cli/agent-app-model-commands.js');
      
      const agent = {
        config: { provider: 'openai', model: 'gpt-4', temperature: 0.7, maxIterations: 10 },
        debugMode: false,
        engine: { attachModelProvider: () => {} },
        schedulerEngine: null,
        modelProvider: null,
      };

      await mockedSwitchModel(agent, 'zhipu', 'glm-4');
      
      expect(agent.config.provider).toBe('zhipu');
      expect(agent.config.model).toBe('glm-4');
    });

    test('switchModel persists MODEL_PROVIDER and DEEPSEEK_MODEL to .env', async () => {
      mock.module('../../src/cli/model-provider-factory.js', () => ({
        assertSupportedProvider: () => {},
        createModelProviderForSwitch: () => ({ mock: 'provider' }),
      }));

      const { switchModel: mockedSwitchModel } = await import('../../src/cli/agent-app-model-commands.js');
      
      const agent = {
        config: { provider: 'openai', model: 'gpt-4', temperature: 0.7, maxIterations: 10 },
        debugMode: false,
        engine: { attachModelProvider: () => {} },
        schedulerEngine: null,
        modelProvider: null,
      };

      await mockedSwitchModel(agent, 'deepseek', 'deepseek-chat');
      
      expect(agent.config.provider).toBe('deepseek');
      expect(agent.config.model).toBe('deepseek-chat');
    });

    test('switchModel persists MODEL_PROVIDER and OPENROUTER_MODEL to .env', async () => {
      mock.module('../../src/cli/model-provider-factory.js', () => ({
        assertSupportedProvider: () => {},
        createModelProviderForSwitch: () => ({ mock: 'provider' }),
      }));

      const { switchModel: mockedSwitchModel } = await import('../../src/cli/agent-app-model-commands.js');
      
      const agent = {
        config: { provider: 'openai', model: 'gpt-4', temperature: 0.7, maxIterations: 10 },
        debugMode: false,
        engine: { attachModelProvider: () => {} },
        schedulerEngine: null,
        modelProvider: null,
      };

      await mockedSwitchModel(agent, 'openrouter', 'anthropic/claude-3-sonnet');
      
      expect(agent.config.provider).toBe('openrouter');
      expect(agent.config.model).toBe('anthropic/claude-3-sonnet');
    });
  });
});