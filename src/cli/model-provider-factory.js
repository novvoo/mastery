import { OpenAIModelProvider } from '../models/openai-provider.js';
import { LlamaModelProvider } from '../models/llama-provider.js';
import { ZhipuModelProvider } from '../models/zhipu-provider.js';
import { DeepSeekModelProvider } from '../models/deepseek-provider.js';
import { OpenRouterModelProvider } from '../models/openrouter-provider.js';
import { resolveModelCapabilities } from '../models/model-capabilities.js';
import { getProviderApiKey } from './agent-config.js';

export const VALID_MODEL_PROVIDERS = ['openai', 'llama', 'zhipu', 'deepseek', 'openrouter'];

export function assertSupportedProvider(provider) {
  if (!VALID_MODEL_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}. Supported: ${VALID_MODEL_PROVIDERS.join(', ')}`);
  }
}

export function assertProviderConfigured(provider, env = process.env) {
  if (provider === 'llama') {
    return;
  }
  const keyVarByProvider = {
    openai: 'OPENAI_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const keyVar = keyVarByProvider[provider] || 'OPENAI_API_KEY';
  if (!env[keyVar]) {
    throw new Error(`${keyVar} not set in environment`);
  }
}

function instantiateModelProvider({
  provider,
  model,
  apiKey,
  baseURL,
  temperature,
  debug,
  capabilities,
}) {
  if (provider === 'openai') {
    return new OpenAIModelProvider(
      apiKey,
      baseURL,
      model,
      false,
      capabilities ? { capabilities } : undefined
    );
  }
  if (provider === 'llama') {
    return new LlamaModelProvider(model, {
      temperature,
      debug,
      ...(capabilities ? { capabilities } : {}),
    });
  }
  if (provider === 'zhipu') {
    return new ZhipuModelProvider(apiKey, baseURL, model, capabilities ? { capabilities } : undefined);
  }
  if (provider === 'deepseek') {
    return new DeepSeekModelProvider(apiKey, baseURL, model, capabilities ? { capabilities } : undefined);
  }
  if (provider === 'openrouter') {
    return new OpenRouterModelProvider(apiKey, baseURL, model, capabilities ? { capabilities } : undefined);
  }
  assertSupportedProvider(provider);
}

export async function createConfiguredModelProvider(config, {
  debug = false,
  env = process.env,
  onCapabilitiesResolved,
} = {}) {
  assertSupportedProvider(config.provider);
  const apiKey = getProviderApiKey(config.provider, env);
  const modelCapabilities = await resolveModelCapabilities({
    provider: config.provider,
    model: config.model,
    baseURL: config.apiUrl,
    apiKey,
  });

  onCapabilitiesResolved?.(modelCapabilities);

  return instantiateModelProvider({
    provider: config.provider,
    model: config.model,
    apiKey: config.provider === 'openai' ? config.apiKey : apiKey,
    baseURL: config.apiUrl,
    temperature: config.temperature,
    debug,
    capabilities: modelCapabilities,
  });
}

export function createModelProviderForSwitch(provider, model, {
  temperature,
  debug = false,
  env = process.env,
} = {}) {
  assertSupportedProvider(provider);
  assertProviderConfigured(provider, env);

  const baseUrlByProvider = {
    openai: env.OPENAI_BASE_URL || env.OPENAI_API_URL || 'https://api.openai.com/v1',
    zhipu: env.ZHIPU_BASE_URL,
    deepseek: env.DEEPSEEK_BASE_URL,
    openrouter: env.OPENROUTER_BASE_URL,
  };

  return instantiateModelProvider({
    provider,
    model,
    apiKey: getProviderApiKey(provider, env),
    baseURL: baseUrlByProvider[provider],
    temperature,
    debug,
  });
}
