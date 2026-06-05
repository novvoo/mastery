import fs from 'fs';
import path from 'path';

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

  const maxEntries = Number.isInteger(options?.maxEntries) ? options.maxEntries : 500;
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
        type: isDirectory ? 'directory' : (isSymlink ? 'symlink' : 'file'),
        hidden: entry.name.startsWith('.'),
        size: entryStats?.size || 0,
        mtimeMs: entryStats?.mtimeMs || 0,
      };
    })
    .sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
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

export function createWorkspaceWatcher(workingDirectory, onChange, options = {}) {
  const root = path.resolve(workingDirectory);
  const debounceMs = Number.isInteger(options.debounceMs) ? options.debounceMs : 80;
  const pollIntervalMs = Number.isInteger(options.pollIntervalMs) ? options.pollIntervalMs : 1000;
  const enableNativeWatch = options.enableNativeWatch !== false;
  const maxWatchedDirectories = Number.isInteger(options.maxWatchedDirectories)
    ? options.maxWatchedDirectories
    : 2000;
  let debounceTimer = null;
  let pollTimer = null;
  let closed = false;
  const watchers = new Map();
  let lastSnapshot = '';

  const normalizeRelativePath = (directory, filename) => {
    const changedPath = filename ? path.join(directory, String(filename)) : directory;
    return path.relative(root, changedPath).split(path.sep).join('/');
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
    result.signatureParts.push(`${relativeDirectory || '.'}:dir:${directoryStats.mtimeMs}:${directoryStats.size}`);

    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return result;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativeEntryPath = path.relative(root, entryPath).split(path.sep).join('/');
      let entryStats = null;
      try {
        entryStats = fs.lstatSync(entryPath);
      } catch {
        result.signatureParts.push(`${relativeEntryPath}:missing`);
        continue;
      }

      const type = entry.isDirectory() ? 'dir' : (entry.isSymbolicLink() ? 'symlink' : 'file');
      result.signatureParts.push(`${relativeEntryPath}:${type}:${entryStats.mtimeMs}:${entryStats.size}`);
      if (entry.isDirectory()) {
        scanWorkspace(entryPath, result);
        if (result.directories.length >= maxWatchedDirectories) {
          break;
        }
      }
    }

    return result;
  };

  const readSnapshot = () => {
    const result = scanWorkspace();
    return {
      directories: result.directories,
      signature: result.signatureParts.join('\n')
    };
  };

  const listDirectories = (directory, directories = []) => {
    if (directories.length >= maxWatchedDirectories) {
      return directories;
    }

    directories.push(directory);

    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return directories;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      listDirectories(path.join(directory, entry.name), directories);
      if (directories.length >= maxWatchedDirectories) {
        break;
      }
    }

    return directories;
  };

  const syncWatchers = (snapshot = null) => {
    if (closed || !fs.existsSync(root)) {
      return;
    }

    const directories = new Set(snapshot?.directories || listDirectories(root));

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

  const emitChange = (eventType, relativePath) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const snapshot = readSnapshot();
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
        emitChange('change', '');
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
