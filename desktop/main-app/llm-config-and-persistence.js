/**
 * Electron 主应用 — LLM 配置与持久化模块
 *
 * 职责：
 *   - 初始化 Desktop Core（包含 write-file 审批）
 *   - 创建并附加已配置的模型提供者
 *   - 读取/保存 LLM 配置状态（provider/model/API key/baseUrl）
 *   - 保存/恢复应用配置（窗口大小、工作目录等）
 */

import path from 'path';
import fs from 'fs';
import {
  getMissingRequiredConfig,
  getProviderBaseUrl,
  getProviderModel,
  getProviderRequirement,
  writeUserEnv,
  applyRuntimeValues
} from '../../src/core/runtime-config.js';
import { createConfiguredModelProvider } from '../../src/cli/model-provider-factory.js';
import { createDesktopCore as _createDesktopCore } from '../../src/adapters/desktop/desktop-core.js';

/**
 * 创建默认 Desktop Core。write_file 审批通过 IPC 让用户在写文件前预览 diff。
 */
export async function initializeDesktopCore(ctx) {
  console.log('🔧 初始化 Desktop Core...');

  const writeFileApproval = async ({ args, workingDirectory }) => {
    const ipc = ctx.ipcAdapter;
    if (!ipc || typeof ipc.request !== 'function') return true;

    const file_path = args?.path || args?.file_path || '';
    const newContent = typeof args?.content === 'string' ? args.content : '';

    let oldContent = '';
    try {
      const full = file_path && file_path.startsWith('/')
        ? file_path
        : `${workingDirectory}/${file_path}`;
      if (fs.existsSync(full)) oldContent = fs.readFileSync(full, 'utf8');
    } catch (_) {}

    try {
      const resp = await ipc.request('write-file:approve', {
        path: file_path,
        oldContent,
        newContent,
      });
      if (resp && resp.apply === false) return false;
      if (resp && typeof resp.content === 'string') return { content: resp.content };
      return true;
    } catch (_) {
      return true;
    }
  };

  ctx.desktopCore = _createDesktopCore({
    workingDirectory: ctx.config.workingDirectory,
    debug: ctx.config.debug,
    maxIterations: ctx.config.runtime.maxIterations,
    autoDownloadModels: ctx.config.runtime.autoDownloadModels,
    hookTimeout: ctx.config.runtime.hookTimeout,
    ipc: ctx.config.ipc,
    writeFileApproval,
  });

  await ctx.desktopCore.initialize();
  console.log('✅ Desktop Core 初始化完成');
}

export function createDesktopCore(options) {
  return _createDesktopCore(options);
}

/**
 * 从已加载的运行环境中尝试附加一个已配置的 modelProvider。
 * 返回 { configured, provider, model, baseUrl, missingVars, ... }
 */
export async function attachConfiguredModelProvider(ctx) {
  const missingVars = getMissingRequiredConfig();
  if (missingVars.length > 0) {
    console.warn(`⚠️  未配置 LLM: 缺少 ${missingVars.join(', ')}。可在 ${ctx.userEnvPath} 或项目 .env 中配置。`);
    return getLLMConfigStatus(ctx);
  }

  const provider = process.env.MODEL_PROVIDER || 'openai';
  const model = getProviderModel(provider);
  const baseURL = getProviderBaseUrl(provider);

  const modelProvider = await createConfiguredModelProvider({
    provider,
    model,
    apiUrl: baseURL,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: Number(process.env.TEMPERATURE || 0.7)
  }, { debug: ctx.config.debug });

  attachModelProvider(ctx, modelProvider);
  console.log(`✅ LLM 已配置: ${provider}:${model}`);
  return getLLMConfigStatus(ctx);
}

export function attachModelProvider(ctx, modelProvider) {
  if (ctx.desktopCore) {
    ctx.desktopCore.attachModelProvider(modelProvider);
    console.log('✅ 模型提供者已附加');
  }
}

export function getLLMConfigStatus(ctx) {
  const provider = process.env.MODEL_PROVIDER || 'openai';
  const requirement = getProviderRequirement(provider);
  const missingVars = getMissingRequiredConfig();

  return {
    configured: missingVars.length === 0,
    provider,
    model: getProviderModel(provider),
    baseUrl: getProviderBaseUrl(provider),
    missingVars,
    userEnvPath: ctx.userEnvPath,
    keyVar: requirement?.keyVar || 'OPENAI_API_KEY',
    modelVar: requirement?.modelVar || 'OPENAI_MODEL',
    baseUrlVar: requirement?.baseUrlVar || 'OPENAI_BASE_URL'
  };
}

export async function saveLLMConfig(ctx, config = {}) {
  const provider = config.provider || 'openai';
  const requirement = getProviderRequirement(provider);
  if (!requirement) {
    return {
      success: false,
      error: `不支持的模型提供商: ${provider}`,
      status: getLLMConfigStatus(ctx)
    };
  }

  const apiKey = String(config.apiKey || '').trim();
  const model = String(config.model || requirement.defaultModel || '').trim();
  const baseUrl = String(config.baseUrl || requirement.defaultBaseUrl || '').trim();

  if (!apiKey) {
    return {
      success: false,
      error: `${requirement.keyVar} 不能为空`,
      status: getLLMConfigStatus(ctx)
    };
  }

  if (!model) {
    return {
      success: false,
      error: `${requirement.modelVar} 不能为空`,
      status: getLLMConfigStatus(ctx)
    };
  }

  const values = {
    MODEL_PROVIDER: provider,
    [requirement.keyVar]: apiKey,
    [requirement.modelVar]: model
  };

  if (baseUrl) {
    values[requirement.baseUrlVar] = baseUrl;
  }

  const envPath = writeUserEnv(values, {
    envPath: ctx.userEnvPath
  });
  applyRuntimeValues(values);
  const status = await attachConfiguredModelProvider(ctx);

  return {
    success: true,
    envPath,
    status
  };
}

export async function handleSaveConfig(ctx) {
  const { dialog, app } = ctx.electron;

  try {
    saveAppConfig(ctx);

    dialog.showMessageBox(ctx.mainWindow, {
      type: 'info',
      title: '保存成功',
      message: '配置已保存',
      buttons: ['确定']
    });
  } catch (error) {
    dialog.showErrorBox('保存失败', error.message);
  }
}

export function getAppConfigPath(electronOrCtx) {
  const electronRef = electronOrCtx?.electron || electronOrCtx;
  const { app } = electronRef;
  return path.join(app.getPath('userData'), 'config.json');
}

export function readAppConfig(electronOrCtx) {
  try {
    const configPath = getAppConfigPath(electronOrCtx);
    if (!fs.existsSync(configPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn('读取应用配置失败:', err.message);
    return {};
  }
}

export function saveAppConfig(ctx, overrides = {}) {
  const configPath = getAppConfigPath(ctx);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readAppConfig(ctx);
  const [width, height] = ctx.mainWindow?.getSize?.() || [];
  const configData = {
    ...existing,
    workingDirectory: ctx.config.workingDirectory,
    window: {
      ...existing.window,
      width: width || ctx.config.window?.width,
      height: height || ctx.config.window?.height
    },
    runtime: {
      ...existing.runtime,
      ...ctx.config.runtime
    },
    ...overrides
  };

  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
  return {
    success: true,
    configPath,
    config: configData
  };
}

/**
 * 多模型配置持久化
 * 将模型配置列表保存到用户数据目录下的 models.json 文件
 */

function getModelConfigsPath(ctx) {
  const { app } = ctx.electron;
  return path.join(app.getPath('userData'), 'models.json');
}

export function readAllModelConfigs(ctx) {
  try {
    const configPath = getModelConfigsPath(ctx);
    if (!fs.existsSync(configPath)) return [];
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('读取模型配置失败:', err.message);
    return [];
  }
}

export function saveAllModelConfigs(ctx, configs) {
  try {
    const configPath = getModelConfigsPath(ctx);
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));
    return { success: true };
  } catch (err) {
    console.error('保存模型配置失败:', err.message);
    return { success: false, error: err.message };
  }
}

export function saveSingleModelConfig(ctx, config) {
  const configs = readAllModelConfigs(ctx);
  const idx = configs.findIndex(c => c.id === config.id);
  
  if (idx >= 0) {
    // 如果启用了某个模型，先禁用所有其他模型
    if (config.enabled) {
      configs.forEach((c, i) => {
        configs[i].enabled = c.id === config.id ? true : false;
      });
    }
    configs[idx] = { ...configs[idx], ...config };
  } else {
    // 新添加的模型如果启用，先禁用所有其他模型
    if (config.enabled) {
      configs.forEach((c, i) => {
        configs[i].enabled = false;
      });
    }
    configs.push(config);
  }
  
  const result = saveAllModelConfigs(ctx, configs);
  
  // 如果保存的模型是启用的，同步到 .env
  if (config.enabled) {
    const activeConfig = configs.find(c => c.id === config.id);
    if (activeConfig) {
      syncActiveModelToEnv(ctx, activeConfig);
    }
  }
  
  return result;
}

export function deleteModelConfig(ctx, id) {
  const configs = readAllModelConfigs(ctx);
  const filtered = configs.filter(c => c.id !== id);
  return saveAllModelConfigs(ctx, filtered);
}

export function toggleModelConfig(ctx, id, enabled) {
  console.log(`🔍 toggleModelConfig called: id=${id}, enabled=${enabled}, ctx.userEnvPath=${ctx.userEnvPath}`);
  
  const configs = readAllModelConfigs(ctx);
  console.log(`📋 Current configs: ${JSON.stringify(configs)}`);
  
  // 如果启用某个模型，先禁用所有其他模型（单选模式）
  if (enabled) {
    const updated = configs.map(c => ({
      ...c,
      enabled: c.id === id ? true : false
    }));
    saveAllModelConfigs(ctx, updated);
    
    // 将启用的模型同步到 .env
    const activeConfig = updated.find(c => c.id === id);
    console.log(`🎯 Active config to sync: ${JSON.stringify(activeConfig)}`);
    
    const syncResult = activeConfig ? syncActiveModelToEnv(ctx, activeConfig) : { success: false };
    
    console.log(`📝 Sync result: ${JSON.stringify(syncResult)}`);
    
    return { 
      success: syncResult.success, 
      configs: updated,
      provider: syncResult.provider,
      model: syncResult.model,
      error: syncResult.error,
      envPath: ctx.userEnvPath
    };
  } else {
    // 如果禁用当前模型，不允许（至少需要一个启用的模型）
    const currentActive = configs.find(c => c.enabled);
    if (currentActive && currentActive.id === id) {
      return { success: false, error: '不能禁用当前激活的模型，请先启用其他模型' };
    }
    
    const updated = configs.map(c => c.id === id ? { ...c, enabled: false } : c);
    return saveAllModelConfigs(ctx, updated);
  }
}

/**
 * 将激活的模型配置同步到 .env 文件
 */
function syncActiveModelToEnv(ctx, config) {
  const provider = config.provider || 'openai';
  const requirement = getProviderRequirement(provider);
  if (!requirement) {
    console.warn(`不支持的模型提供商: ${provider}`);
    return { success: false, error: `不支持的模型提供商: ${provider}` };
  }

  // 检查必要字段
  if (!config.apiKey || !config.model) {
    console.warn('模型配置不完整，无法同步到 .env');
    return { success: false, error: '模型配置不完整（缺少 API Key 或模型名称）' };
  }

  const values = {
    MODEL_PROVIDER: provider,
    [requirement.keyVar]: config.apiKey,
    [requirement.modelVar]: config.model
  };

  if (config.baseUrl) {
    values[requirement.baseUrlVar] = config.baseUrl;
  }

  try {
    writeUserEnv(values, { envPath: ctx.userEnvPath });
    applyRuntimeValues(values);
    console.log(`✅ 已同步激活模型到 .env: ${provider}:${config.model}`);
    return { success: true, provider, model: config.model };
  } catch (error) {
    console.error(`❌ 同步模型配置失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}
