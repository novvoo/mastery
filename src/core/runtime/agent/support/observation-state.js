export const ObservationErrorCode = Object.freeze({
  MISSING_FILE: 'MISSING_FILE',
  EMPTY_WORKSPACE: 'EMPTY_WORKSPACE',
  FACT_CONTRADICTION: 'FACT_CONTRADICTION',
  ROUTE_BLOCKED: 'ROUTE_BLOCKED',
  SCOPE_BLOCKED: 'SCOPE_BLOCKED',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  SECURITY_BLOCKED: 'SECURITY_BLOCKED',
  DUPLICATE_MUTATION: 'DUPLICATE_MUTATION',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  CAPABILITY_LIMITATION: 'CAPABILITY_LIMITATION',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const WORKSPACE_METADATA_ENTRY_PATTERN =
  /^(?:\.agent-data|\.agent-logs|\.agent-memory|\.git|test)$/i;

export function getToolTargetPath(toolName, args = {}) {
  if (!args || typeof args !== 'object') {
    return null;
  }
  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
    case 'rename_file':
      return args.path || args.file_path || args.file || args.filePath || args.target || null;
    case 'list_dir':
    case 'tree':
      return args.path || args.dir || args.directory || null;
    default:
      return args.path || args.file_path || args.file || args.target || null;
  }
}

export function isWorkspaceRootPath(pathValue) {
  const pathText = String(pathValue ?? '.').trim();
  return pathText === '' || pathText === '.' || pathText === './';
}

export function parseDirectoryEntries(result) {
  if (Array.isArray(result?.entries)) {
    return result.entries
      .map((entry) => String(entry?.name || entry?.path || entry || '').trim())
      .filter(Boolean);
  }
  if (Array.isArray(result?.files)) {
    return result.files.map((entry) => String(entry?.path || entry || '').trim()).filter(Boolean);
  }
  if (Array.isArray(result)) {
    return result
      .map((entry) => String(entry?.name || entry?.path || entry || '').trim())
      .filter(Boolean);
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\s\-*•]+/, '')
        .replace(/^[DF]\s+/i, '')
        .trim(),
    )
    .map((line) => line.split(/\s+/)[0] || '')
    .filter((entry) => entry && !/^error[:\s]/i.test(entry));
}

export function isEffectivelyEmptyWorkspaceEntries(entries = []) {
  const names = entries
    .map((entry) =>
      String(entry || '')
        .replace(/^\.?\//, '')
        .trim(),
    )
    .filter(Boolean);
  if (names.length === 0) {
    return true;
  }
  return names.every((name) => WORKSPACE_METADATA_ENTRY_PATTERN.test(name));
}

function resultToText(result) {
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result ?? '');
  } catch {
    return String(result);
  }
}

function classifyErrorCode(toolName, args, result, options = {}) {
  if (options.errorCode) {
    return options.errorCode;
  }
  const text = resultToText(result);
  if (/FACT_BLOCKED|known empty workspace|contradicts observed workspace facts/i.test(text)) {
    return ObservationErrorCode.FACT_CONTRADICTION;
  }
  if (/SCOPE_BLOCKED/i.test(text) || options.scopeBlocked) {
    return ObservationErrorCode.SCOPE_BLOCKED;
  }
  if (/not available for the current plan task|route blocked/i.test(text) || options.routeBlocked) {
    return ObservationErrorCode.ROUTE_BLOCKED;
  }
  if (/参数校验失败|schema|missing required parameter/i.test(text)) {
    return ObservationErrorCode.SCHEMA_VALIDATION_FAILED;
  }
  if (/security policy blocked/i.test(text)) {
    return ObservationErrorCode.SECURITY_BLOCKED;
  }
  if (/duplicate mutation/i.test(text) || options.duplicateMutation) {
    return ObservationErrorCode.DUPLICATE_MUTATION;
  }
  if (
    /STEP_ABNORMAL:\s*shell_timeout|Command timed out|timed out after|timeout after/i.test(text)
  ) {
    return ObservationErrorCode.TIMEOUT_ERROR;
  }
  if (/file not found|no such file|enoent|文件不存在|目录不存在/i.test(text)) {
    return ObservationErrorCode.MISSING_FILE;
  }
  if (
    /\b(cannot|can't|can not)\s+(proceed|continue|do|modify|run|access)\b|\bcritical limitation\b/i.test(
      text,
    )
  ) {
    return ObservationErrorCode.CAPABILITY_LIMITATION;
  }
  if (
    toolName === 'shell' &&
    /\b(exit\s*code|status)\s*[:=]?\s*[1-9]\d*\b|\btests?\s+failed\b/i.test(text)
  ) {
    return ObservationErrorCode.VERIFICATION_FAILED;
  }
  if (options.error || /^Error:|Command failed|BLOCKED:/i.test(text.trim())) {
    return ObservationErrorCode.UNKNOWN_ERROR;
  }
  return null;
}

export function classifyToolObservation(toolName, args = {}, result = null, options = {}) {
  const targetPath = getToolTargetPath(toolName, args);
  const explicitError = options.error || (result && typeof result === 'object' && result.error);
  const errorCode = classifyErrorCode(toolName, args, result, options);
  const directoryEntries =
    toolName === 'list_dir' || toolName === 'glob' || toolName === 'tree'
      ? parseDirectoryEntries(result)
      : [];
  const emptyWorkspace =
    toolName === 'list_dir' &&
    isWorkspaceRootPath(targetPath) &&
    isEffectivelyEmptyWorkspaceEntries(directoryEntries);

  return {
    toolName,
    args,
    targetPath,
    ok: !explicitError && !errorCode,
    errorCode: emptyWorkspace ? ObservationErrorCode.EMPTY_WORKSPACE : errorCode,
    directoryEntries,
    emptyWorkspace,
    missingPath: errorCode === ObservationErrorCode.MISSING_FILE ? targetPath : null,
    text: resultToText(result),
  };
}
