import { resolve } from 'path';
import { getProviderBaseUrl, getProviderModel } from '../core/runtime/runtime-config.js';
import { shellSandboxConfigFromEnv } from '../sandbox/shell-sandbox.js';

export function getProviderApiKey(provider, env = process.env) {
  if (provider === 'zhipu') {
    return env.ZHIPU_API_KEY;
  }
  if (provider === 'deepseek') {
    return env.DEEPSEEK_API_KEY;
  }
  if (provider === 'openrouter') {
    return env.OPENROUTER_API_KEY;
  }
  return env.OPENAI_API_KEY;
}

export function loadCliConfig(env = process.env, cwd = process.cwd()) {
  const provider = env.MODEL_PROVIDER || 'openai';
  const model = getProviderModel(provider);
  const toolCacheEnv = env.TOOL_CACHE;
  const toolResultCacheEnabled = toolCacheEnv !== 'false' && toolCacheEnv !== '0';
  const tokenBudgetRaw = env.TOKEN_BUDGET;
  const tokenBudget = tokenBudgetRaw ? parseFloat(tokenBudgetRaw) : null;

  return {
    provider,
    model,
    apiKey: env.OPENAI_API_KEY,
    apiUrl: getProviderBaseUrl(provider) || 'https://api.openai.com/v1',
    maxIterations: parseInt(env.MAX_ITERATIONS || '10'),
    maxTokens: parseInt(env.MAX_TOKENS || '2048'),
    temperature: parseFloat(env.TEMPERATURE || '0.7'),
    workingDir: resolve(env.WORKING_DIRECTORY || cwd),
    debug: env.DEBUG === 'true',
    logDir: env.LOG_DIR || './logs',
    intentClassification: env.INTENT_CLASSIFICATION !== 'false',
    shellSandbox: shellSandboxConfigFromEnv(),
    tokenBudget,
    tokenBudgetWarningThreshold: parseFloat(env.TOKEN_BUDGET_WARN || '70'),
    toolResultCacheEnabled,
  };
}
