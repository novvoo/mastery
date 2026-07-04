const DEFAULT_MAX_FILE_SIZE = 1_048_576;

const GENERATED_PATH_PATTERNS = [
  /\.d\.ts$/,
  /\.generated\./,
  /\.min\.(js|css)$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /\.bundle\./,
  /-bundle\./,
];

const LOCKFILE_PATH_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /cargo\.lock$/,
  /gemfile\.lock$/,
  /poetry\.lock$/,
  /composer\.lock$/,
  /pipfile\.lock$/,
];

async function readTextForPolicy(fs, path) {
  if (typeof fs.readText === 'function') return fs.readText(path);
  if (typeof fs.read === 'function') return fs.read(path);
  return undefined;
}

/**
 * Host-level guardrails for Hashline editing. These checks keep generated,
 * lockfile, oversized, and binary-like files out of line-anchored patch flows
 * before the core patcher performs snapshot validation and apply.
 */
export async function checkHashlineFilePolicy(fs, path, options = {}) {
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const lower = String(path).toLowerCase();

  if (GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(lower))) {
    return `Cannot edit generated/build artifact via Hashline: ${path}.`;
  }

  if (LOCKFILE_PATH_PATTERNS.some((pattern) => pattern.test(lower))) {
    return `Cannot edit lockfile via Hashline: ${path}.`;
  }

  let stat;
  try {
    stat = await fs.stat?.(path);
  } catch {
    return null;
  }
  if (stat?.size > maxFileSize) {
    return `File too large for Hashline editing: ${path} (${stat.size} > ${maxFileSize}).`;
  }

  try {
    const text = await readTextForPolicy(fs, path);
    if (typeof text === 'string' && text.includes('\u0000')) {
      return `Cannot edit binary file via Hashline: ${path}.`;
    }
  } catch {
    // Missing/read-protected files are handled by the core patcher.
  }
  return null;
}

export const HASHLINE_POLICY = {
  DEFAULT_MAX_FILE_SIZE,
  GENERATED_PATH_PATTERNS,
  LOCKFILE_PATH_PATTERNS,
};
