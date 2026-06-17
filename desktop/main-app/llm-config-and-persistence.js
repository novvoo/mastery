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
  const configPath = path.join(app.getPath('userData'), 'config.json');

  try {
    const configData = {
      workingDirectory: ctx.config.workingDirectory,
      window: {
        width: ctx.mainWindow?.getSize()[0] || ctx.config.window.width,
        height: ctx.mainWindow?.getSize()[1] || ctx.config.window.height
      },
      runtime: ctx.config.runtime
    };

    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

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
