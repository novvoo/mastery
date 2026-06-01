import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir, platform } from 'os';

export const APP_NAME = 'ai-engineering-mastery-agent';

const PROVIDER_CONFIG = {
  openai: {
    keyVar: 'OPENAI_API_KEY',
    baseUrlVar: 'OPENAI_BASE_URL',
    modelVar: 'OPENAI_MODEL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  zhipu: {
    keyVar: 'ZHIPU_API_KEY',
    baseUrlVar: 'ZHIPU_BASE_URL',
    modelVar: 'ZHIPU_MODEL',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4',
  },
  deepseek: {
    keyVar: 'DEEPSEEK_API_KEY',
    baseUrlVar: 'DEEPSEEK_BASE_URL',
    modelVar: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  openrouter: {
    keyVar: 'OPENROUTER_API_KEY',
    baseUrlVar: 'OPENROUTER_BASE_URL',
    modelVar: 'OPENROUTER_MODEL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
};

export function getUserConfigDir(env = process.env, home = homedir(), osPlatform = platform()) {
  if (env.AGENT_CONFIG_DIR) {
    return resolve(env.AGENT_CONFIG_DIR);
  }

  if (osPlatform === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_NAME);
  }

  return join(env.XDG_CONFIG_HOME || join(home, '.config'), APP_NAME);
}

export function getUserEnvPath(options = {}) {
  return join(getUserConfigDir(options.env, options.home, options.platform), '.env');
}

export function loadRuntimeEnv(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const initialKeys = new Set(Object.keys(env));
  const userEnvPath = options.userEnvPath || getUserEnvPath({ env });
  const cwdEnvPath = options.cwdEnvPath || join(cwd, '.env');

  applyEnvFile(userEnvPath, env, initialKeys, false);
  applyEnvFile(cwdEnvPath, env, initialKeys, true);

  return { userEnvPath, cwdEnvPath };
}

export function getProviderRequirement(provider) {
  return PROVIDER_CONFIG[provider] || null;
}

export function getProviderModel(provider, env = process.env) {
  const requirement = getProviderRequirement(provider);
  if (!requirement) {
    return env.OPENAI_MODEL || env.MODEL || 'gpt-4';
  }

  return env[requirement.modelVar] || env.MODEL || requirement.defaultModel;
}

export function getProviderBaseUrl(provider, env = process.env) {
  const requirement = getProviderRequirement(provider);
  if (!requirement) {
    return undefined;
  }

  if (provider === 'openai') {
    return env.OPENAI_BASE_URL || env.OPENAI_API_URL || requirement.defaultBaseUrl;
  }

  return env[requirement.baseUrlVar] || requirement.defaultBaseUrl;
}

export function getMissingRequiredConfig(env = process.env) {
  const provider = env.MODEL_PROVIDER || 'openai';
  const requirement = getProviderRequirement(provider);

  if (!requirement) {
    return [];
  }

  return env[requirement.keyVar] ? [] : [requirement.keyVar];
}

export function buildMissingConfigMessage(missingVars, userEnvPath = getUserEnvPath()) {
  return [
    `Missing required configuration: ${missingVars.join(', ')}`,
    `Set the variables in your shell, create .env in the current directory, or run interactively to create ${userEnvPath}.`,
  ].join('\n');
}

export function writeUserEnv(values, options = {}) {
  const envPath = options.envPath || getUserEnvPath();
  const existing = existsSync(envPath) ? parseDotenv(readFileSync(envPath)) : {};
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, formatEnv({ ...existing, ...values }));
  return envPath;
}

export function applyRuntimeValues(values, env = process.env) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      env[key] = String(value);
    }
  }
}

function applyEnvFile(filePath, env, initialKeys, allowOverrideConfigFileValues) {
  if (!existsSync(filePath)) {
    return;
  }

  const parsed = parseDotenv(readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (initialKeys.has(key)) {
      continue;
    }
    if (!allowOverrideConfigFileValues && env[key] !== undefined) {
      continue;
    }
    env[key] = value;
  }
}

function formatEnv(values) {
  const lines = [
    '# AI Engineering Mastery Agent user configuration',
    '# Environment variables still take precedence over this file.',
  ];

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      lines.push(`${key}=${escapeEnvValue(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function escapeEnvValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

// Keep dotenv's default current-directory behavior available for callers that
// import this module after process.env has already been prepared.
export { loadDotenv };
