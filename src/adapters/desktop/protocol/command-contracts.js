import { serialize } from 'node:v8';

export const COMMAND_SCHEMA_VERSION = 1;

export class CommandContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CommandContractError';
    this.code = code;
    this.details = details;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const requireObject = (payload, channel) => {
  if (!isObject(payload)) {
    throw new CommandContractError(
      'INVALID_COMMAND_PAYLOAD',
      `${channel} payload 必须是对象`,
      { channel, expected: 'object' },
    );
  }
};

const requireString = (value, field, channel, { allowEmpty = false } = {}) => {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new CommandContractError(
      'INVALID_COMMAND_PAYLOAD',
      `${channel}.${field} 必须是${allowEmpty ? '' : '非空'}字符串`,
      { channel, field, expected: allowEmpty ? 'string' : 'non-empty string' },
    );
  }
};

const contracts = new Map();

const normalizeModelBatchPayload = (payload, channel) => {
  const models = Array.isArray(payload) ? payload : payload?.models;
  if (!Array.isArray(models)) {
    throw new CommandContractError(
      'INVALID_COMMAND_PAYLOAD',
      `${channel}.models 必须是数组`,
      { channel, field: 'models', expected: 'array' },
    );
  }
  return { models };
};

const requireSerializable = (value, channel) => {
  try {
    serialize(value);
    return value;
  } catch {
    throw new CommandContractError(
      'INVALID_COMMAND_RESULT',
      `${channel} 返回了不可跨 IPC 传输的结果`,
      { channel, expected: 'structured-cloneable' },
    );
  }
};

export function registerCommandContract(channel, validate, options = {}) {
  if (typeof channel !== 'string' || !channel) {
    throw new TypeError('command contract channel must be a non-empty string');
  }
  if (typeof validate !== 'function') {
    throw new TypeError(`command contract ${channel} requires a validator`);
  }
  contracts.set(channel, {
    channel,
    schemaVersion: options.schemaVersion ?? COMMAND_SCHEMA_VERSION,
    risk: options.risk ?? 'standard',
    payloadType: options.payloadType ?? 'object',
    resultType: options.resultType ?? 'structured-cloneable',
    validateResult: options.validateResult ?? ((value) => requireSerializable(value, channel)),
    validate,
  });
}

export function validateCommand(channel, payload) {
  const contract = contracts.get(channel);
  if (!contract) {
    throw new CommandContractError(
      'COMMAND_CONTRACT_MISSING',
      `${channel} 尚未注册 command contract`,
      { channel },
    );
  }
  try {
    const normalized = contract.validate(payload);
    return normalized === undefined ? payload : normalized;
  } catch (error) {
    if (error instanceof CommandContractError) throw error;
    throw new CommandContractError(
      'INVALID_COMMAND_PAYLOAD',
      error?.message || `${channel} payload 校验失败`,
      { channel },
    );
  }
}

export function listCommandContracts() {
  return [...contracts.values()]
    .map(({ channel, schemaVersion, risk, payloadType, resultType }) => ({
      channel,
      schemaVersion,
      risk,
      payloadType,
      resultType,
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

export function getCommandContract(channel) {
  const contract = contracts.get(channel);
  if (!contract) return null;
  const { validate: _validate, validateResult: _validateResult, ...metadata } = contract;
  return { ...metadata };
}

export function validateCommandResult(channel, value) {
  const contract = contracts.get(channel);
  if (!contract) return value;
  return contract.validateResult(value);
}

const NO_PAYLOAD_SUFFIXES = [
  ':list',
  ':count',
  ':getState',
  ':getStats',
  ':getTools',
  ':getInfo',
  ':getConfigStatus',
  ':getAvailableModels',
  ':getSlashSuggestions',
  ':isGitRepo',
  ':supportedLanguages',
  ':snapshot',
  ':cycleModel',
  ':cycleThinkingLevel',
  ':minimize',
  ':maximize',
  ':close',
  ':show',
  ':hide',
  ':stop',
];

registerCommandContract(
  'llm:save-all-models',
  (payload) => normalizeModelBatchPayload(payload, 'llm:save-all-models'),
  {
    risk: 'critical',
    payloadType: 'object',
  },
);

const inferRisk = (channel) => {
  if (/^(terminal:|llm:save|llm:delete|workspace:(write|create|delete|rename))/.test(channel)) {
    return 'critical';
  }
  if (/^(agent:|workspace:|preview:|app:openExternal)/.test(channel)) return 'high';
  return 'standard';
};

export function ensureCommandContract(channel) {
  if (contracts.has(channel)) return getCommandContract(channel);

  const acceptsEmptyObject = NO_PAYLOAD_SUFFIXES.some((suffix) => channel.endsWith(suffix));
  registerCommandContract(
    channel,
    (payload) => {
      if (payload === undefined || payload === null) {
        if (acceptsEmptyObject) return {};
        throw new CommandContractError(
          'INVALID_COMMAND_PAYLOAD',
          `${channel} payload 缺失`,
          { channel, expected: 'object' },
        );
      }
      requireObject(payload, channel);
      return payload;
    },
    {
      risk: inferRisk(channel),
      payloadType: acceptsEmptyObject ? 'empty-object' : 'object',
    },
  );
  return getCommandContract(channel);
}

export function ensureCommandContractCoverage(channels) {
  for (const channel of channels) ensureCommandContract(channel);
  const missing = channels.filter((channel) => !contracts.has(channel));
  if (missing.length > 0) {
    throw new Error(`missing command contracts: ${missing.join(', ')}`);
  }
  return { total: channels.length, missing };
}

registerCommandContract('agent:processInput', (payload) => {
  requireObject(payload, 'agent:processInput');
  requireString(payload.input, 'input', 'agent:processInput');
  if (payload.options !== undefined && !isObject(payload.options)) {
    throw new CommandContractError(
      'INVALID_COMMAND_PAYLOAD',
      'agent:processInput.options 必须是对象',
      { channel: 'agent:processInput', field: 'options', expected: 'object' },
    );
  }
  return { ...payload, input: payload.input.trim(), options: payload.options || {} };
}, { risk: 'high', payloadType: 'object' });

registerCommandContract('app:openExternal', (payload) => {
  const url = typeof payload === 'string' ? payload : payload?.url;
  requireString(url, 'url', 'app:openExternal');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CommandContractError(
      'INVALID_URL',
      'app:openExternal.url 不是有效 URL',
      { channel: 'app:openExternal', field: 'url' },
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CommandContractError(
      'UNSUPPORTED_URL_SCHEME',
      'app:openExternal 只允许 http(s) URL',
      { channel: 'app:openExternal', protocol: parsed.protocol },
    );
  }
  return url;
}, { risk: 'high', payloadType: 'url-string' });

registerCommandContract('workspace:setWorkingDirectory', (payload) => {
  const directory = typeof payload === 'string' ? payload : payload?.directory;
  requireString(directory, 'directory', 'workspace:setWorkingDirectory');
  return directory;
}, { risk: 'high', payloadType: 'path-string' });

registerCommandContract('terminal:execute', (payload) => {
  requireObject(payload, 'terminal:execute');
  requireString(payload.command, 'command', 'terminal:execute');
  return { ...payload, command: payload.command.trim() };
}, { risk: 'critical', payloadType: 'object' });

for (const channel of ['app:getPath', 'preview:stop', 'llm:delete-model']) {
  registerCommandContract(channel, (payload) => {
    const value = typeof payload === 'string'
      ? payload
      : payload?.name || payload?.sessionId || payload?.modelId || payload?.id;
    requireString(value, 'value', channel);
    return value;
  }, {
    risk: inferRisk(channel),
    payloadType: 'string',
  });
}
