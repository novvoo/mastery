const ERROR_PREFIX_RE = /^(?:error|failed|failure|exception|traceback|fatal)\b[:\s-]*/i;
const ERROR_HINT_RE =
  /\b(?:file not found|not found|enoent|eacces|permission denied|timed out|timeout|schema validation failed|missing required|security policy blocked|scope_blocked|invalid tool|cannot execute|command failed)\b/i;

function stringifyResult(result) {
  if (typeof result === 'string') {
    return result;
  }
  if (result instanceof Error) {
    return result.message;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function extractErrorMessage(result, text) {
  if (result instanceof Error) {
    return result.message;
  }
  if (result && typeof result === 'object') {
    const candidate =
      result.error ||
      result.errorMessage ||
      result.message ||
      result.reason ||
      result.stderr ||
      result.details;
    if (candidate) {
      return stringifyResult(candidate);
    }
  }
  if (typeof text === 'string') {
    const firstLine = text.split('\n').find(Boolean) || text;
    return firstLine.replace(ERROR_PREFIX_RE, '').trim() || firstLine.trim();
  }
  return 'Tool execution failed';
}

export function normalizeToolResult(result) {
  const text = stringifyResult(result);
  const explicitFailure =
    result instanceof Error ||
    (result && typeof result === 'object' && result.success === false) ||
    (result && typeof result === 'object' && Boolean(result.error)) ||
    (result && typeof result === 'object' && Boolean(result.routeBlocked)) ||
    (result && typeof result === 'object' && Boolean(result.factBlocked)) ||
    (result && typeof result === 'object' && Boolean(result.workspaceContextRequired)) ||
    (result && typeof result === 'object' && Boolean(result.scopeBlocked));
  const stringFailure =
    typeof result === 'string' &&
    (ERROR_PREFIX_RE.test(result.trim()) || ERROR_HINT_RE.test(result));
  const success = !(explicitFailure || stringFailure);
  const error = success ? null : extractErrorMessage(result, text);

  return {
    success,
    error,
    result,
    resultPreview: text.slice(0, 500),
  };
}

export function assertToolResultSucceeded(result, toolName = 'tool') {
  const normalized = normalizeToolResult(result);
  if (!normalized.success) {
    const error = new Error(`${toolName} failed: ${normalized.error}`);
    error.toolName = toolName;
    error.result = result;
    error.normalizedResult = normalized;
    throw error;
  }
  return normalized;
}
