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
  const requestedPath = String(filePath ?? '').trim();
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
    const { absolutePath, relativePath } = resolveWorkspacePath(payload?.path ?? payload?.target, {
      engine,
    });
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Selected path is not a file.', path: relativePath };
    }

    const maxBytes = Number(payload?.maxBytes ?? 2 * 1024 * 1024);
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
    const { absolutePath, relativePath, workingDirectory } = resolveWorkspacePath(
      payload?.path ?? payload?.target,
      { engine },
    );
    const content = String(payload?.content ?? '');
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    const stat = fs.statSync(absolutePath);
    broadcast?.('workspace:changed', {
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

export async function handleCreateWorkspaceFile(payload = {}, { engine, broadcast }) {
  try {
    const { absolutePath, relativePath, workingDirectory } = resolveWorkspacePath(payload?.path, {
      engine,
    });
    if (fs.existsSync(absolutePath)) {
      return { success: false, error: '目标文件已存在', path: relativePath };
    }

    const content = String(payload?.content ?? '');
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    const stat = fs.statSync(absolutePath);
    broadcast?.('workspace:changed', {
      path: relativePath,
      workingDirectory,
      action: 'create',
    });
    return {
      success: true,
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to create file.' };
  }
}

export async function handleCreateWorkspaceDirectory(payload = {}, { engine, broadcast }) {
  try {
    const { absolutePath, relativePath, workingDirectory } = resolveWorkspacePath(payload?.path, {
      engine,
    });
    if (fs.existsSync(absolutePath)) {
      return { success: false, error: '目标目录已存在', path: relativePath };
    }

    fs.mkdirSync(absolutePath, { recursive: true });
    broadcast?.('workspace:changed', {
      path: relativePath,
      workingDirectory,
      action: 'create-directory',
    });
    return {
      success: true,
      path: relativePath,
    };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to create directory.' };
  }
}

export async function handleDeleteWorkspaceItem(payload = {}, { engine, broadcast }) {
  try {
    const { absolutePath, relativePath, workingDirectory } = resolveWorkspacePath(payload?.path, {
      engine,
    });
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: '文件不存在', path: relativePath };
    }

    const stat = fs.lstatSync(absolutePath);
    if (stat.isDirectory()) {
      fs.rmSync(absolutePath, { recursive: true, force: false });
    } else {
      fs.unlinkSync(absolutePath);
    }
    broadcast?.('workspace:changed', {
      path: relativePath,
      workingDirectory,
      action: 'delete',
    });
    return { success: true, path: relativePath };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to delete item.' };
  }
}

export async function handleRenameWorkspaceItem(payload = {}, { engine, broadcast }) {
  try {
    const source = resolveWorkspacePath(payload?.path, { engine });
    const target = resolveWorkspacePath(payload?.newPath, { engine });
    if (!fs.existsSync(source.absolutePath)) {
      return { success: false, error: '源路径不存在', path: source.relativePath };
    }
    if (fs.existsSync(target.absolutePath)) {
      return { success: false, error: '目标路径已存在', path: target.relativePath };
    }

    fs.renameSync(source.absolutePath, target.absolutePath);
    broadcast?.('workspace:changed', {
      path: target.relativePath,
      oldPath: source.relativePath,
      workingDirectory: target.workingDirectory,
      action: 'rename',
    });
    return { success: true, path: target.relativePath, oldPath: source.relativePath };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to rename item.' };
  }
}

export async function handleFileDiff(payload = {}, { engine }) {
  const filePath = String(payload?.path ?? payload?.target ?? '').trim();
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
      const relativeSnapshot = engine?.workspaceState?.getFileSnapshot(filePath)?.content;
      const absoluteSnapshot = engine?.workspaceState?.getFileSnapshot(absPath)?.content;
      const oldContent =
        typeof relativeSnapshot === 'string'
          ? relativeSnapshot
          : typeof absoluteSnapshot === 'string'
            ? absoluteSnapshot
            : '';

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
