/**
 * Model capability registry.
 *
 * Keeps local defaults for offline startup, then optionally enriches unknown
 * models from public provider/model catalog APIs.
 */

const ONE_MILLION = 1048576;

const LOCAL_CAPABILITIES = [
  { provider: 'openai', model: 'gpt-4', contextWindow: 8192, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-4-32k', contextWindow: 32768, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-4-turbo', contextWindow: 128000, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-4o', contextWindow: 128000, maxOutputTokens: 16384, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-4o-mini', contextWindow: 128000, maxOutputTokens: 16384, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-3.5-turbo', contextWindow: 16385, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gpt-3.5-turbo-16k', contextWindow: 16385, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'anthropic', model: 'claude-3', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'anthropic', model: 'claude-3.5', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'claude-3', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'claude-3.5', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'qwen3.5-plus', contextWindow: 131072, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'qwen2.5-plus', contextWindow: 131072, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'qwen2.5', contextWindow: 32768, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'qwen-plus', contextWindow: 32768, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'qwen-turbo', contextWindow: 8192, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gemini-1.5-pro', contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openai', model: 'gemini-1.5-flash', contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'google', model: 'gemini-1.5-pro', contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'google', model: 'gemini-1.5-flash', contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'zhipu', model: 'glm-4', contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'zhipu', model: 'glm-4-flash', contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'zhipu', model: 'glm-4-plus', contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'zhipu', model: 'glm-3', contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'deepseek', model: 'deepseek-chat', contextWindow: 64000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'deepseek', model: 'deepseek-coder', contextWindow: 64000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'anthropic/claude-3-opus', contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'openai/gpt-4o', contextWindow: 128000, maxOutputTokens: 16384, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'openai/gpt-4-turbo', contextWindow: 128000, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'google/gemini-pro-1.5', contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'meta-llama/llama-3-70b', contextWindow: 8192, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
  { provider: 'openrouter', model: 'mistralai/mistral-7b', contextWindow: 32768, maxOutputTokens: 4096, toolCalling: true, source: 'local' },
];

const capabilityCache = new Map();

export function getLocalModelCapabilities(provider, model, options = {}) {
  const override = buildOverrideCapabilities(provider, model, options.env);
  if (override) {
    return override;
  }

  return findLocalCapabilities(provider, model) || inferModelCapabilities(provider, model);
}

export async function resolveModelCapabilities(options = {}) {
  const provider = options.provider || 'openai';
  const model = options.model || 'gpt-4';
  const env = options.env || process.env;
  const override = buildOverrideCapabilities(provider, model, env);
  if (override) {
    return override;
  }

  const local = findLocalCapabilities(provider, model);
  if (local && env.MODEL_CAPABILITY_REFRESH !== 'true') {
    return local;
  }

  const allowNetwork = env.MODEL_CAPABILITY_LOOKUP !== 'false' && options.allowNetwork !== false;
  const cacheKey = `${provider}:${model}`;
  if (capabilityCache.has(cacheKey) && env.MODEL_CAPABILITY_REFRESH !== 'true') {
    return capabilityCache.get(cacheKey);
  }

  if (allowNetwork) {
    const remote = await fetchRemoteCapabilities({
      provider,
      model,
      baseURL: options.baseURL,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl || fetch,
      timeoutMs: Number(env.MODEL_CAPABILITY_LOOKUP_TIMEOUT_MS || 3000),
    });

    if (remote) {
      capabilityCache.set(cacheKey, remote);
      return remote;
    }
  }

  const inferred = local || inferModelCapabilities(provider, model);
  capabilityCache.set(cacheKey, inferred);
  return inferred;
}

export function chooseModelForContext(models, requiredInputTokens, options = {}) {
  const reserveOutputTokens = options.reserveOutputTokens || 8192;
  const candidates = models
    .map(model => ({
      ...model,
      usableInputTokens: Math.max(0, (model.contextWindow || 0) - reserveOutputTokens),
    }))
    .filter(model => model.usableInputTokens >= requiredInputTokens)
    .sort((a, b) => {
      const costA = Number(a.inputCostPerToken || a.promptCostPerToken || 0);
      const costB = Number(b.inputCostPerToken || b.promptCostPerToken || 0);
      if (costA !== costB) {
        return costA - costB;
      }
      return a.contextWindow - b.contextWindow;
    });

  return candidates[0] || null;
}

export function isLongContextCapabilities(capabilities, threshold = 128000) {
  return (capabilities?.contextWindow || 0) >= threshold;
}

export function clearModelCapabilityCache() {
  capabilityCache.clear();
}

async function fetchRemoteCapabilities(options) {
  const lookups = [];
  if (options.provider === 'openrouter') {
    lookups.push(fetchOpenRouterModelCapabilities);
  }
  lookups.push(fetchLiteLLMModelCapabilities);

  for (const lookup of lookups) {
    try {
      const capabilities = await lookup(options);
      if (capabilities) {
        return capabilities;
      }
    } catch {
      // Remote catalogs are best-effort; local heuristics keep startup reliable.
    }
  }
  return null;
}

async function fetchOpenRouterModelCapabilities(options) {
  const baseURL = (options.baseURL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const headers = {};
  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  const data = await fetchJson(`${baseURL}/models`, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    headers,
  });
  const models = Array.isArray(data?.data) ? data.data : [];
  const found = findRemoteModel(models, options.model);
  if (!found) {
    return null;
  }
  return normalizeRemoteCapabilities({
    provider: 'openrouter',
    model: found.id || found.name || options.model,
    contextWindow: found.context_length,
    maxOutputTokens: found.top_provider?.max_completion_tokens || found.max_completion_tokens,
    inputCostPerToken: found.pricing?.prompt,
    outputCostPerToken: found.pricing?.completion,
    toolCalling: Array.isArray(found.supported_parameters)
      ? found.supported_parameters.includes('tools')
      : undefined,
    source: 'openrouter-models-api',
  });
}

async function fetchLiteLLMModelCapabilities(options) {
  const data = await fetchJson(
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    }
  );
  const entry = findLiteLLMEntry(data, options.provider, options.model);
  if (!entry) {
    return null;
  }
  const [modelName, value] = entry;
  return normalizeRemoteCapabilities({
    provider: value.litellm_provider || options.provider,
    model: modelName,
    contextWindow: value.max_input_tokens || value.max_context_tokens || value.context_window,
    maxOutputTokens: value.max_output_tokens,
    inputCostPerToken: value.input_cost_per_token || value.prompt_cost_per_token,
    outputCostPerToken: value.output_cost_per_token || value.completion_cost_per_token,
    toolCalling: value.supports_function_calling ?? value.supports_tool_choice,
    source: 'litellm-model-catalog',
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3000);
  try {
    const response = await options.fetchImpl(url, {
      headers: options.headers || {},
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function findLocalCapabilities(provider, model) {
  const normalizedProvider = normalize(provider);
  const normalizedModel = normalize(model);
  const exact = LOCAL_CAPABILITIES.find(item =>
    normalize(item.provider) === normalizedProvider &&
    normalize(item.model) === normalizedModel
  );
  if (exact) {
    return { ...exact };
  }

  const loose = LOCAL_CAPABILITIES.find(item =>
    normalize(item.provider) === normalizedProvider &&
    normalizedModel.includes(normalize(item.model))
  );
  return loose ? { ...loose, model } : null;
}

function findRemoteModel(models, model) {
  const normalizedModel = normalize(model);
  return models.find(item => normalize(item.id) === normalizedModel) ||
    models.find(item => normalize(item.id).endsWith(`/${normalizedModel}`)) ||
    models.find(item => normalizedModel.endsWith(`/${normalize(item.id)}`)) ||
    models.find(item => normalize(item.name) === normalizedModel);
}

function findLiteLLMEntry(data, provider, model) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const normalizedProvider = normalize(provider);
  const normalizedModel = normalize(model);
  const entries = Object.entries(data);

  return entries.find(([name]) => normalize(name) === normalizedModel) ||
    entries.find(([name, value]) =>
      normalize(value?.litellm_provider) === normalizedProvider &&
      normalize(name) === normalizedModel
    ) ||
    entries.find(([name]) => normalize(name).endsWith(`/${normalizedModel}`)) ||
    entries.find(([name]) => normalizedModel.endsWith(`/${normalize(name)}`));
}

function normalizeRemoteCapabilities(raw) {
  const contextWindow = toPositiveInteger(raw.contextWindow);
  if (!contextWindow) {
    return null;
  }
  return {
    provider: raw.provider,
    model: raw.model,
    contextWindow,
    maxOutputTokens: toPositiveInteger(raw.maxOutputTokens) || 8192,
    inputCostPerToken: toNumber(raw.inputCostPerToken),
    outputCostPerToken: toNumber(raw.outputCostPerToken),
    toolCalling: raw.toolCalling !== false,
    source: raw.source,
  };
}

function buildOverrideCapabilities(provider, model, env = process.env) {
  const contextWindow = toPositiveInteger(env.MODEL_CONTEXT_WINDOW || env.MODEL_MAX_CONTEXT_TOKENS);
  if (!contextWindow) {
    return null;
  }
  return {
    provider,
    model,
    contextWindow,
    maxOutputTokens: toPositiveInteger(env.MODEL_MAX_OUTPUT_TOKENS) || 8192,
    toolCalling: env.MODEL_TOOL_CALLING !== 'false',
    source: 'env-override',
  };
}

function inferModelCapabilities(provider, model) {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('gemini-1.5') || lower.includes('gemini-2') || lower.includes('1m')) {
    return { provider, model, contextWindow: ONE_MILLION, maxOutputTokens: 8192, toolCalling: true, source: 'heuristic' };
  }
  if (lower.includes('claude')) {
    return { provider, model, contextWindow: 200000, maxOutputTokens: 8192, toolCalling: true, source: 'heuristic' };
  }
  if (lower.includes('gpt-4') || lower.includes('gpt-5') || lower.includes('o1') || lower.includes('o3')) {
    return { provider, model, contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true, source: 'heuristic' };
  }
  if (lower.includes('qwen')) {
    return { provider, model, contextWindow: 131072, maxOutputTokens: 8192, toolCalling: true, source: 'heuristic' };
  }
  if (lower.includes('deepseek')) {
    return { provider, model, contextWindow: 64000, maxOutputTokens: 8192, toolCalling: true, source: 'heuristic' };
  }
  return { provider, model, contextWindow: 32000, maxOutputTokens: 4096, toolCalling: true, source: 'heuristic' };
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
