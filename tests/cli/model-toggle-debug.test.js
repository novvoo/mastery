import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import {
  toggleModelConfig,
  readAllModelConfigs,
  saveAllModelConfigs,
} from '../../desktop/main-app/llm-config-and-persistence.js';
import { writeUserEnv } from '../../src/core/runtime/runtime-config.js';

describe('Model Toggle Sync End-to-End', () => {
  let tmpDir;
  let ctx;

  beforeEach(() => {
    tmpDir = `/tmp/model-toggle-test-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    ctx = {
      userEnvPath: path.join(tmpDir, '.env'),
      userConfigDir: tmpDir,
      electron: {
        app: {
          getPath: (name) => {
            if (name === 'userData') return tmpDir;
            return tmpDir;
          },
        },
      },
    };

    // 创建初始模型配置文件
    const initialConfigs = [
      {
        id: 'model1',
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key-123',
        enabled: false,
        name: 'OpenAI',
      },
      {
        id: 'model2',
        provider: 'zhipu',
        model: 'glm-4',
        apiKey: 'test-key-456',
        enabled: true,
        name: '智谱',
      },
    ];
    fs.writeFileSync(path.join(tmpDir, 'models.json'), JSON.stringify(initialConfigs, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('should sync enabled model to .env when toggling', async () => {
    console.log('=== 测试：启用模型同步到 .env ===');

    const result = await toggleModelConfig(ctx, 'model1', true);

    console.log('Result:', JSON.stringify(result, null, 2));

    // 验证返回结果
    expect(result.success).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');

    // 验证 .env 文件存在且内容正确
    const envPath = ctx.userEnvPath;
    console.log('Checking .env file:', envPath);

    expect(fs.existsSync(envPath)).toBe(true);

    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('.env content:\n', envContent);

    expect(envContent).toContain('MODEL_PROVIDER=openai');
    expect(envContent).toContain('OPENAI_MODEL=gpt-4o');
    expect(envContent).toContain('OPENAI_API_KEY=test-key-123');

    // 验证 models.json 中只有一个启用的模型
    const configs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    const enabledCount = configs.filter((c) => c.enabled).length;
    console.log('Enabled models count:', enabledCount);

    expect(enabledCount).toBe(1);
    expect(configs.find((c) => c.id === 'model1').enabled).toBe(true);
    expect(configs.find((c) => c.id === 'model2').enabled).toBe(false);
  });

  test('should not disable the only enabled model', async () => {
    console.log('=== 测试：不能禁用唯一启用的模型 ===');

    // 修改配置，使 model1 成为唯一启用的模型
    const configs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    configs.forEach((c) => (c.enabled = c.id === 'model1'));
    fs.writeFileSync(path.join(tmpDir, 'models.json'), JSON.stringify(configs, null, 2));

    const result = await toggleModelConfig(ctx, 'model1', false);

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(false);
    expect(result.error).toBe('不能禁用当前激活的模型，请先启用其他模型');
  });

  test('should handle zhipu model sync', async () => {
    console.log('=== 测试：同步智谱模型到 .env ===');

    const result = await toggleModelConfig(ctx, 'model2', true);

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.provider).toBe('zhipu');

    const envContent = fs.readFileSync(ctx.userEnvPath, 'utf8');
    console.log('.env content:\n', envContent);

    expect(envContent).toContain('MODEL_PROVIDER=zhipu');
    expect(envContent).toContain('ZHIPU_MODEL=glm-4');
    expect(envContent).toContain('ZHIPU_API_KEY=test-key-456');
  });

  test('should handle deepseek model sync', async () => {
    console.log('=== 测试：同步深度求索模型到 .env ===');

    // 添加一个 deepseek 模型
    const configs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    configs.push({
      id: 'model3',
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'test-key-789',
      enabled: false,
      name: 'DeepSeek',
    });
    fs.writeFileSync(path.join(tmpDir, 'models.json'), JSON.stringify(configs, null, 2));

    const result = await toggleModelConfig(ctx, 'model3', true);

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.provider).toBe('deepseek');

    const envContent = fs.readFileSync(ctx.userEnvPath, 'utf8');
    console.log('.env content:\n', envContent);

    expect(envContent).toContain('MODEL_PROVIDER=deepseek');
    expect(envContent).toContain('DEEPSEEK_MODEL=deepseek-chat');
    expect(envContent).toContain('DEEPSEEK_API_KEY=test-key-789');
  });

  test('should handle openrouter model sync', async () => {
    console.log('=== 测试：同步 OpenRouter 模型到 .env ===');

    // 添加一个 openrouter 模型
    const configs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    configs.push({
      id: 'model4',
      provider: 'openrouter',
      model: 'meta-llama/llama-3.1-70b',
      apiKey: 'test-key-abc',
      enabled: false,
      name: 'OpenRouter',
    });
    fs.writeFileSync(path.join(tmpDir, 'models.json'), JSON.stringify(configs, null, 2));

    const result = await toggleModelConfig(ctx, 'model4', true);

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.provider).toBe('openrouter');

    const envContent = fs.readFileSync(ctx.userEnvPath, 'utf8');
    console.log('.env content:\n', envContent);

    expect(envContent).toContain('MODEL_PROVIDER=openrouter');
    expect(envContent).toContain('OPENROUTER_MODEL=meta-llama/llama-3.1-70b');
    expect(envContent).toContain('OPENROUTER_API_KEY=test-key-abc');
  });

  test('should handle missing apiKey or model', async () => {
    console.log('=== 测试：配置不完整时应该失败 ===');

    // 添加一个配置不完整的模型
    const configs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    configs.push({
      id: 'model5',
      provider: 'openai',
      model: '',
      apiKey: '',
      enabled: false,
      name: 'Incomplete',
    });
    fs.writeFileSync(path.join(tmpDir, 'models.json'), JSON.stringify(configs, null, 2));

    const result = await toggleModelConfig(ctx, 'model5', true);

    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(false);
    expect(result.error).toBe('模型配置不完整（缺少 API Key 或模型名称）');

    const savedConfigs = JSON.parse(fs.readFileSync(path.join(tmpDir, 'models.json'), 'utf8'));
    expect(savedConfigs.find((c) => c.id === 'model2').enabled).toBe(true);
    expect(savedConfigs.find((c) => c.id === 'model5').enabled).toBe(false);
  });
});
