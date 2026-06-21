import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'node:fs';
import path from 'node:path';
import { computeDiff, isNoop } from '../../../../core/diff-preview.js';

const execFileAsync = promisify(execFile);

export async function handleIsGitRepo({ engine }) {
  const workingDirectory = engine?.getConfig?.().workingDirectory || process.cwd();
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: workingDirectory });
    return { isGitRepo: true };
  } catch {
    return { isGitRepo: false };
  }
}

export function resolveWorkspacePath(filePath, { engine }) {
  const requestedPath = String(filePath || '').trim();
  if (!requestedPath) {
    throw new Error('Missing file path.');
  }

  const workingDirectory = engine?.getConfig?.().workingDirectory || process.cwd();
  const root = path.resolve(workingDirectory);
  const absolutePath = path.resolve(root, requestedPath);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Path is outside the current workspace.');
  }

  return {
    absolutePath,
    relativePath: relativePath || path.basename(absolutePath),
    workingDirectory: root,
  };
}

export async function handleReadWorkspaceFile(payload = {}, { engine }) {
  try {
    const { absolutePath, relativePath } = resolveWorkspacePath(payload?.path || payload?.target, { engine });
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Selected path is not a file.', path: relativePath };
    }

    const maxBytes = Number(payload?.maxBytes || 512 * 1024);
    if (stat.size > maxBytes) {
      return {
        success: false,
        error: `File is too large to preview (${stat.size} bytes).`,
        path: relativePath,
        size: stat.size,
      };
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    return {
      success: true,
      path: relativePath,
      name: path.basename(absolutePath),
      content,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to read file.' };
  }
}

export async function handleWriteWorkspaceFile(payload = {}, { engine, broadcast }) {
  try {
    const { absolutePath, relativePath, workingDirectory } = resolveWorkspacePath(payload?.path || payload?.target, { engine });
    const content = String(payload?.content ?? '');
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    const stat = fs.statSync(absolutePath);
    broadcast('workspace:changed', {
      path: relativePath,
      workingDirectory,
      action: 'write',
    });
    return {
      success: true,
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to write file.' };
  }
}

export async function handleFileDiff(payload = {}, { engine }) {
  const filePath = String(payload?.path || payload?.target || '').trim();
  if (!filePath) {
    return { success: false, error: 'Missing file path.' };
  }

  const workingDirectory = engine?.getConfig?.().workingDirectory || process.cwd();
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], {
      cwd: workingDirectory,
    });

    const { stdout } = await execFileAsync('git', ['diff', '--', filePath], {
      cwd: workingDirectory,
      maxBuffer: 1024 * 1024,
    });
    return {
      success: true,
      path: filePath,
      diff: stdout || '',
      hasDiff: Boolean(stdout && stdout.trim()),
      source: 'git',
    };
  } catch (gitError) {
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(workingDirectory, filePath);
      const newContent = fs.readFileSync(absPath, 'utf8');
      const oldContent = engine?.workspaceState?.getFileSnapshot(filePath)?.content ||
                         engine?.workspaceState?.getFileSnapshot(absPath)?.content || '';

      const diff = computeDiff({ path: filePath, oldContent, newContent });
      const hasDiff = !isNoop(diff);

      return {
        success: true,
        path: filePath,
        diff: diff.unifiedDiff,
        hasDiff,
        source: 'snapshot',
      };
    } catch (snapshotError) {
      return {
        success: false,
        path: filePath,
        error: snapshotError.message || '无法读取文件内容',
        diff: '',
        hasDiff: false,
      };
    }
  }
}
