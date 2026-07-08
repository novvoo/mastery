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

function hasSubstantiveToolResultContent(content) {
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (block.type === 'image') return true;
    if (block.type === 'text' && block.text && block.text.trim().length > 0) return true;
  }
  return false;
}

function coerceToolResultContent(raw) {
  const rawObj = raw && typeof raw === 'object' ? raw : null;
  const rawContent = rawObj?.content;

  if (!Array.isArray(rawContent)) {
    const text = rawObj && typeof rawObj === 'object' && 'text' in rawObj
      ? String(rawObj.text)
      : stringifyResult(raw);
    return {
      content: [{ type: 'text', text: text || 'Tool returned an invalid result: missing content array.' }],
      malformed: true,
    };
  }

  const content = [];
  let invalidBlocks = 0;
  for (const block of rawContent) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      invalidBlocks++;
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      content.push({ type: 'text', text: block.text.trimEnd() });
    } else if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType });
    } else {
      invalidBlocks++;
    }
  }

  if (invalidBlocks > 0) {
    content.push({
      type: 'text',
      text: `Tool returned an invalid result: ${invalidBlocks} content block${invalidBlocks === 1 ? '' : 's'} had an unsupported shape.`,
    });
  }

  return { content, malformed: invalidBlocks > 0 };
}

export function normalizeToolResult(result) {
  const text = stringifyResult(result);
  const coerced = coerceToolResultContent(result);
  
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
  
  let isError = explicitFailure || stringFailure;
  const error = isError ? extractErrorMessage(result, text) : null;

  if (isError && !hasSubstantiveToolResultContent(coerced.content)) {
    coerced.content.length = 0;
    coerced.content.push({ type: 'text', text: error || 'Tool failed with no output.' });
  }

  const useless = !isError && Boolean(result && typeof result === 'object' && result.useless);

  return {
    success: !isError,
    error,
    result,
    resultPreview: text.slice(0, 500),
    content: coerced.content,
    malformed: coerced.malformed,
    isError,
    useless,
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
