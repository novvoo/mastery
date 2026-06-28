/**
 * Workspace directory listing and file watching utilities.
 * 纯 Node.js 实现，不依赖 Electron，可被 Desktop 和 CLI 共享。
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_IGNORED_WATCH_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'release',
  'build',
  'coverage',
  '.next',
  '.vite',
  '.turbo',
  '.cache',
  '.agent-data',
]);

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * 列出工作目录下的文件和子目录
 * @param {string} workingDirectory - 工作目录绝对路径
 * @param {Object} options - { path, maxEntries }
 * @returns {{ success: boolean, entries?: Array, error?: string }}
 */
export function listWorkspaceDirectory(workingDirectory, options = {}) {
  const root = path.resolve(workingDirectory);
  const relativePath = typeof options?.path === 'string' ? options.path : '';
  const targetPath = path.resolve(root, relativePath || '.');
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const isInsideWorkspace = targetPath === root || targetPath.startsWith(rootPrefix);

  if (!isInsideWorkspace) {
    return { success: false, error: '路径超出工作目录范围' };
  }

  if (!fs.existsSync(targetPath)) {
    return { success: false, error: '目录不存在' };
  }

  const maxEntries = normalizeNonNegativeInteger(options?.maxEntries, 500);
  let stats;
  let dirEntries;
  try {
    stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return { success: false, error: '路径不是目录' };
    }
    dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
  } catch (error) {
    return { success: false, error: `无法读取目录: ${error.message}` };
  }

  const entries = dirEntries
    .map((entry) => {
      const fullPath = path.join(targetPath, entry.name);
      let entryStats = null;
      try {
        entryStats = fs.lstatSync(fullPath);
      } catch {
        // Keep unreadable entries visible, but without metadata.
      }

      const relativeEntryPath = path.relative(root, fullPath).split(path.sep).join('/');
      const isDirectory = entry.isDirectory();
      const isSymlink = entry.isSymbolicLink();

      return {
        name: entry.name,
        path: relativeEntryPath,
        type: isDirectory ? 'directory' : isSymlink ? 'symlink' : 'file',
        hidden: entry.name.startsWith('.'),
        size: entryStats?.size || 0,
        mtimeMs: entryStats?.mtimeMs || 0,
      };
    })
    .sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') {
        return -1;
      }
      if (a.type !== 'directory' && b.type === 'directory') {
        return 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  return {
    success: true,
    root,
    path: relativePath,
    entries: entries.slice(0, maxEntries),
    truncated: entries.length > maxEntries,
    total: entries.length,
  };
}

/**
 * 创建工作目录变更监听器
 * @param {string} workingDirectory - 工作目录绝对路径
 * @param {Function} onChange - 变更回调 ({ eventType, path, root, timestamp })
 * @param {Object} options - { debounceMs, pollIntervalMs, enableNativeWatch, maxWatchedDirectories, ignoredDirectories }
 * @returns {{ close: Function }}
 */
export function createWorkspaceWatcher(workingDirectory, onChange, options = {}) {
  const root = path.resolve(workingDirectory);
  const debounceMs = normalizeNonNegativeInteger(options.debounceMs, 80);
  const pollIntervalMs = normalizeNonNegativeInteger(options.pollIntervalMs, 1000);
  const enableNativeWatch = options.enableNativeWatch !== false;
  const maxWatchedDirectories = normalizeNonNegativeInteger(options.maxWatchedDirectories, 2000);
  const ignoredDirectories = new Set([
    ...DEFAULT_IGNORED_WATCH_DIRECTORIES,
    ...(Array.isArray(options.ignoredDirectories) ? options.ignoredDirectories : []),
  ]);
  let debounceTimer = null;
  let pollTimer = null;
  let closed = false;
  const watchers = new Map();
  let lastSnapshot = '';

  const normalizeRelativePath = (directory, filename) => {
    const changedPath = filename ? path.join(directory, String(filename)) : directory;
    return path.relative(root, changedPath).split(path.sep).join('/');
  };

  const shouldWatchDirectoryEntry = (entry) => {
    return entry.isDirectory() && !ignoredDirectories.has(entry.name);
  };

  const scanWorkspace = (directory = root, result = { directories: [], signatureParts: [] }) => {
    if (result.directories.length >= maxWatchedDirectories) {
      return result;
    }

    let directoryStats = null;
    try {
      directoryStats = fs.statSync(directory);
    } catch {
      return result;
    }

    const relativeDirectory = path.relative(root, directory).split(path.sep).join('/');
    result.directories.push(directory);
    result.signatureParts.push(
      `${relativeDirectory || '.'}:dir:${directoryStats.mtimeMs}:${directoryStats.size}`,
    );

    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return result;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const entry of entries) {
      if (!shouldWatchDirectoryEntry(entry)) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      const relativeEntryPath = path.relative(root, entryPath).split(path.sep).join('/');
      let entryStats = null;
      try {
        entryStats = fs.statSync(entryPath);
      } catch {
        result.signatureParts.push(`${relativeEntryPath}:missing`);
        continue;
      }

      result.signatureParts.push(
        `${relativeEntryPath}:dir:${entryStats.mtimeMs}:${entryStats.size}`,
      );
      scanWorkspace(entryPath, result);
      if (result.directories.length >= maxWatchedDirectories) {
        break;
      }
    }

    return result;
  };

  const readSnapshot = () => {
    const result = scanWorkspace();
    return {
      directories: result.directories,
      signature: result.signatureParts.join('\n'),
    };
  };

  const syncWatchers = (snapshot = null) => {
    if (closed || !fs.existsSync(root)) {
      return;
    }

    const directories = new Set(snapshot?.directories || readSnapshot().directories);

    for (const [directory, watcher] of watchers) {
      if (!directories.has(directory)) {
        watcher.close();
        watchers.delete(directory);
      }
    }

    if (!enableNativeWatch) {
      return;
    }

    for (const directory of directories) {
      if (watchers.has(directory)) {
        continue;
      }

      try {
        const watcher = fs.watch(directory, (eventType, filename) => {
          emitChange(eventType, normalizeRelativePath(directory, filename));
        });
        watchers.set(directory, watcher);
      } catch {
        // Some directories may disappear or be unreadable between scan and watch.
      }
    }
  };

  const emitChange = (eventType, relativePath, knownSnapshot = null) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const snapshot = knownSnapshot || readSnapshot();
      lastSnapshot = snapshot.signature;
      syncWatchers(snapshot);
      onChange({
        eventType: eventType || 'change',
        path: relativePath || '',
        root,
        timestamp: Date.now(),
      });
    }, debounceMs);
  };

  const initialSnapshot = readSnapshot();
  lastSnapshot = initialSnapshot.signature;
  syncWatchers(initialSnapshot);

  if (watchers.size === 0 && pollIntervalMs <= 0) {
    throw new Error('无法监听工作目录');
  }

  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      if (closed) {
        return;
      }

      const snapshot = readSnapshot();
      if (snapshot.signature !== lastSnapshot) {
        lastSnapshot = snapshot.signature;
        syncWatchers(snapshot);
        emitChange('change', '', snapshot);
      }
    }, pollIntervalMs);
  }

  return {
    close() {
      closed = true;
      clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    },
  };
}

/**
 * 默认忽略的目录列表，供外部引用
 */
export { DEFAULT_IGNORED_WATCH_DIRECTORIES };
