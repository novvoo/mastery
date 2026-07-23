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
} from '../../src/core/runtime/runtime-config.js';
import { createDesktopCore as _createDesktopCore } from '../../src/adapters/desktop/desktop-core.js';

/**
 * 创建默认 Desktop Core。write_file 审批通过 IPC 让用户在写文件前预览 diff。
 */
export async function initializeDesktopCore(ctx) {
  console.log('🔧 初始化 Desktop Core...');

  const writeFileApproval = async ({ args, workingDirectory }) => {
    const ipc = ctx.ipcAdapter;
    if (!ipc || typeof ipc.request !== 'function') {return true;}

    const file_path = args?.path || args?.file_path || '';
    const newContent = typeof args?.content === 'string' ? args.content : '';

    let oldContent = '';
    try {
      const full = file_path && file_path.startsWith('/')
        ? file_path
        : `${workingDirectory}/${file_path}`;
      if (fs.existsSync(full)) {oldContent = fs.readFileSync(full, 'utf8');}
    } catch (_) {}

    try {
      const resp = await ipc.request('write-file:approve', {
        path: file_path,
        oldContent,
        newContent,
      });
      if (resp && resp.apply === false) {return false;}
      if (resp && typeof resp.content === 'string') {return { content: resp.content };}
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
    onRuntimeHealthChange: (health) => {
      if (!ctx.capabilityRegistry?.get?.('agent.runtime')) return;
      const status = health?.state === 'healthy'
        ? 'available'
        : health?.state === 'failed'
          ? 'unavailable'
          : 'degraded';
      ctx.capabilityRegistry.setStatus(
        'agent.runtime',
        status,
        health?.lastError || null,
      );
    },
    useOmp: process.env.MASTERY_USE_OMP === '1' || process.env.MASTERY_USE_OMP === 'true',
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
  const engine = ctx.desktopCore?.getEngine?.();
  if (engine?.getAvailableModels) {
    // OMP loads credentials and the active model from its own configuration.
    return getLLMConfigStatus(ctx);
  }
  const activeConfig = findEnabledModelConfig(ctx);
  if (activeConfig) syncActiveModelToEnv(ctx, activeConfig);
  if (activeConfig && typeof ctx.desktopCore?.attachModelProvider === 'function') {
    ctx.desktopCore.attachModelProvider({
      provider: activeConfig.provider,
      model: activeConfig.model,
      managedBy: 'omp',
    });
  }
  return getLLMConfigStatus(ctx);
}

export function attachModelProvider() {
  // OMP owns model providers; kept as a compatibility no-op for the Electron facade.
}

export function getLLMConfigStatus(ctx) {
  const ompState = ctx.desktopCore?.getDetailedState?.()?.engine || {};
  const ompModel = ompState.model;
  const provider = process.env.MODEL_PROVIDER || 'openai';
  const requirement = getProviderRequirement(provider);
  const missingVars = getMissingRequiredConfig();

  return {
    configured: Boolean(ompModel) || missingVars.length === 0,
    provider: ompModel?.provider || provider,
    model: ompModel?.id || getProviderModel(provider),
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

  // 同步到 models.json，确保模型设置管理页面也能看到这个配置
  syncConfigToModelsJson(ctx, { provider, apiKey, model, baseUrl });

  const engine = ctx.desktopCore?.getEngine?.();
  if (engine?.setModel) {
    await engine.setModel(provider, model).catch(() => null);
  }
  const status = getLLMConfigStatus(ctx);

  return {
    success: true,
    envPath,
    status
  };
}

/**
 * 将弹窗设置的模型同步到 models.json
 * 如果已存在相同 provider 的配置则更新，否则新增
 */
function syncConfigToModelsJson(ctx, { provider, apiKey, model, baseUrl }) {
  try {
    const configs = readAllModelConfigs(ctx);
    const newId = `model_${provider}_${Date.now()}`;

    // 查找是否已有同 provider 的配置
    const existingIdx = configs.findIndex(c => c.provider === provider);

    if (existingIdx >= 0) {
      // 更新已有配置，并设为启用
      configs.forEach((c, i) => {
        configs[i].enabled = i === existingIdx;
      });
      configs[existingIdx] = {
        ...configs[existingIdx],
        id: configs[existingIdx].id || newId,
        provider,
        apiKey,
        model,
        baseUrl: baseUrl || configs[existingIdx].baseUrl || '',
        enabled: true
      };
    } else {
      // 新增配置，禁用其他所有配置
      configs.forEach((c, i) => {
        configs[i].enabled = false;
      });
      configs.push({
        id: newId,
        provider,
        apiKey,
        model,
        baseUrl: baseUrl || '',
        enabled: true
      });
    }

    saveAllModelConfigs(ctx, configs);
    console.log(`✅ 已同步模型配置到 models.json: ${provider}:${model}`);
  } catch (err) {
    console.warn('同步模型配置到 models.json 失败:', err.message);
  }
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

function getSafeStorage(ctx) {
  const safeStorage = ctx?.electron?.safeStorage;
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    return null;
  }
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch (_) {
    return null;
  }
}

function getApiKeyPreview(apiKey = '') {
  const value = String(apiKey || '');
  if (!value) {return '';}
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

function decryptModelConfig(ctx, config = {}) {
  const apiKey = String(config.apiKey || '');
  if (apiKey) {
    return {
      ...config,
      apiKey,
      hasApiKey: true,
      apiKeyPreview: config.apiKeyPreview || getApiKeyPreview(apiKey),
    };
  }

  if (!config.apiKeyEncrypted) {
    return {
      ...config,
      apiKey: '',
      hasApiKey: false,
      apiKeyPreview: '',
    };
  }

  const safeStorage = getSafeStorage(ctx);
  if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
    return {
      ...config,
      apiKey: '',
      hasApiKey: true,
      apiKeyPreview: config.apiKeyPreview || '已保存',
      apiKeyUnavailable: true,
    };
  }

  try {
    const decrypted = safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, 'base64'));
    return {
      ...config,
      apiKey: decrypted,
      hasApiKey: Boolean(decrypted),
      apiKeyPreview: config.apiKeyPreview || getApiKeyPreview(decrypted),
      apiKeyUnavailable: false,
    };
  } catch (err) {
    console.warn('解密模型 API Key 失败:', err.message);
    return {
      ...config,
      apiKey: '',
      hasApiKey: true,
      apiKeyPreview: config.apiKeyPreview || '已保存',
      apiKeyUnavailable: true,
    };
  }
}

function serializeModelConfig(ctx, config = {}) {
  const base = { ...config };
  const apiKey = String(base.apiKey || '').trim();
  delete base.apiKey;
  delete base.apiKeyEncrypted;
  delete base.apiKeyStorage;
  delete base.apiKeyUnavailable;

  if (!apiKey) {
    return {
      ...base,
      hasApiKey: false,
      apiKeyPreview: '',
    };
  }

  const safeStorage = getSafeStorage(ctx);
  if (safeStorage && typeof safeStorage.encryptString === 'function') {
    try {
      return {
        ...base,
        apiKeyEncrypted: safeStorage.encryptString(apiKey).toString('base64'),
        apiKeyStorage: 'safeStorage',
        hasApiKey: true,
        apiKeyPreview: getApiKeyPreview(apiKey),
      };
    } catch (err) {
      console.warn('加密模型 API Key 失败，回退到明文兼容模式:', err.message);
    }
  }

  return {
    ...base,
    apiKey,
    apiKeyStorage: 'plain',
    hasApiKey: true,
    apiKeyPreview: getApiKeyPreview(apiKey),
  };
}

function sanitizeModelConfigForRenderer(config = {}) {
  const { apiKey, apiKeyEncrypted, ...safeConfig } = config;
  const hasApiKey = Boolean(config.hasApiKey || apiKey || apiKeyEncrypted);
  return {
    ...safeConfig,
    apiKey: '',
    hasApiKey,
    apiKeyPreview: config.apiKeyPreview || getApiKeyPreview(apiKey),
  };
}

function preserveExistingApiKey(previousConfigs, incomingConfig = {}) {
  const apiKey = String(incomingConfig.apiKey || '').trim();
  if (apiKey) {return { ...incomingConfig, apiKey };}

  const existing = previousConfigs.find(c => c.id === incomingConfig.id);
  if (existing?.apiKey) {
    return {
      ...incomingConfig,
      apiKey: existing.apiKey,
      hasApiKey: true,
      apiKeyPreview: existing.apiKeyPreview || getApiKeyPreview(existing.apiKey),
    };
  }
  return {
    ...incomingConfig,
    apiKey: '',
    hasApiKey: Boolean(incomingConfig.hasApiKey),
  };
}

export function readAllModelConfigs(ctx) {
  try {
    const configPath = getModelConfigsPath(ctx);
    if (!fs.existsSync(configPath)) {return [];}
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(config => decryptModelConfig(ctx, config)) : [];
  } catch (err) {
    console.warn('读取模型配置失败:', err.message);
    return [];
  }
}

export function readAllModelConfigsForRenderer(ctx) {
  return readAllModelConfigs(ctx).map(sanitizeModelConfigForRenderer);
}

export function saveAllModelConfigs(ctx, configs) {
  try {
    const configPath = getModelConfigsPath(ctx);
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
    const serialized = Array.isArray(configs)
      ? configs.map(config => serializeModelConfig(ctx, config))
      : [];
    fs.writeFileSync(configPath, JSON.stringify(serialized, null, 2));
    return { success: true };
  } catch (err) {
    console.error('保存模型配置失败:', err.message);
    return { success: false, error: err.message };
  }
}

export async function saveAllModelConfigsAndActivate(ctx, configs) {
  const previousConfigs = readAllModelConfigs(ctx);
  const mergedConfigs = Array.isArray(configs)
    ? configs.map(config => preserveExistingApiKey(previousConfigs, config))
    : [];
  const activeConfig = mergedConfigs.find(c => c.enabled) || null;
  if (activeConfig) {
    const validation = validateActiveModelConfig(activeConfig);
    if (!validation.success) {
      return validation;
    }
  }

  const saveResult = saveAllModelConfigs(ctx, mergedConfigs);
  if (!saveResult.success) {
    return saveResult;
  }

  if (!activeConfig) {
    return saveResult;
  }

  const activateResult = await activateModelConfig(ctx, activeConfig);
  if (!activateResult.success) {
    saveAllModelConfigs(ctx, previousConfigs);
  }
  return { ...saveResult, ...activateResult };
}

export async function saveSingleModelConfig(ctx, config) {
  const previousConfigs = readAllModelConfigs(ctx);
  const configs = previousConfigs.map(c => ({ ...c }));
  const mergedConfig = preserveExistingApiKey(previousConfigs, config);
  if (mergedConfig.enabled) {
    const validation = validateActiveModelConfig(mergedConfig);
    if (!validation.success) {
      return validation;
    }
  }

  const idx = configs.findIndex(c => c.id === mergedConfig.id);
  
  if (idx >= 0) {
    // 如果启用了某个模型，先禁用所有其他模型
    if (mergedConfig.enabled) {
      configs.forEach((c, i) => {
        configs[i].enabled = c.id === mergedConfig.id ? true : false;
      });
    }
    configs[idx] = { ...configs[idx], ...mergedConfig };
  } else {
    // 新添加的模型如果启用，先禁用所有其他模型
    if (mergedConfig.enabled) {
      configs.forEach((c, i) => {
        configs[i].enabled = false;
      });
    }
    configs.push(mergedConfig);
  }
  
  const result = saveAllModelConfigs(ctx, configs);
  if (!result.success) {
    return result;
  }
  
  // 如果保存的模型是启用的，同步到 .env 并立即附加到运行时
  if (mergedConfig.enabled) {
    const activeConfig = configs.find(c => c.id === mergedConfig.id);
    if (activeConfig) {
      const activateResult = await activateModelConfig(ctx, activeConfig);
      if (!activateResult.success) {
        saveAllModelConfigs(ctx, previousConfigs);
      }
      return { ...result, ...activateResult };
    }
  }
  
  return result;
}

export function deleteModelConfig(ctx, id) {
  const configs = readAllModelConfigs(ctx);
  const filtered = configs.filter(c => c.id !== id);
  return saveAllModelConfigs(ctx, filtered);
}

export async function toggleModelConfig(ctx, id, enabled) {
  console.log(`🔍 toggleModelConfig called: id=${id}, enabled=${enabled}, ctx.userEnvPath=${ctx.userEnvPath}`);
  
  const configs = readAllModelConfigs(ctx);
  console.log(`📋 Current configs: ${JSON.stringify(configs)}`);
  
  // 如果启用某个模型，先禁用所有其他模型（单选模式）
  if (enabled) {
    const updated = configs.map(c => ({
      ...c,
      enabled: c.id === id ? true : false
    }));
    
    // 将启用的模型同步到 .env
    const activeConfig = updated.find(c => c.id === id);
    console.log(`🎯 Active config to sync: ${JSON.stringify(activeConfig)}`);

    const validation = activeConfig ? validateActiveModelConfig(activeConfig) : { success: false };
    if (!validation.success) {
      return {
        success: false,
        configs: configs.map(sanitizeModelConfigForRenderer),
        error: validation.error,
        envPath: ctx.userEnvPath
      };
    }

    const saveResult = saveAllModelConfigs(ctx, updated);
    if (!saveResult.success) {
      return saveResult;
    }

    const syncResult = activeConfig ? await activateModelConfig(ctx, activeConfig) : { success: false };
    if (!syncResult.success) {
      saveAllModelConfigs(ctx, configs);
    }
    
    console.log(`📝 Sync result: ${JSON.stringify(syncResult)}`);
    
    return { 
      success: syncResult.success, 
      configs: updated.map(sanitizeModelConfigForRenderer),
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

function findEnabledModelConfig(ctx) {
  try {
    return readAllModelConfigs(ctx).find(c => c.enabled && c.apiKey && c.model) || null;
  } catch (_) {
    return null;
  }
}

function validateActiveModelConfig(config) {
  const provider = config?.provider || 'openai';
  const requirement = getProviderRequirement(provider);
  if (!requirement) {
    return { success: false, error: `不支持的模型提供商: ${provider}` };
  }
  if (!config?.apiKey || !config?.model) {
    return { success: false, error: '模型配置不完整（缺少 API Key 或模型名称）' };
  }
  return { success: true };
}

async function activateModelConfig(ctx, config) {
  const syncResult = syncActiveModelToEnv(ctx, config);
  if (!syncResult.success) {
    return syncResult;
  }

  if (!ctx.desktopCore) {
    return {
      ...syncResult,
      status: getLLMConfigStatus(ctx)
    };
  }

  try {
    const status = await attachConfiguredModelProvider(ctx);
    return {
      ...syncResult,
      status
    };
  } catch (error) {
    console.error(`❌ 附加模型提供者失败: ${error.message}`);
    return {
      success: false,
      provider: syncResult.provider,
      model: syncResult.model,
      error: error.message,
      status: getLLMConfigStatus(ctx)
    };
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
