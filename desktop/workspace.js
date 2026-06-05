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
  let debounceTimer = null;
  let watcher = null;

  const emitChange = (eventType, filename) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const relativePath = filename ? String(filename).split(path.sep).join('/') : '';
      onChange({
        eventType: eventType || 'change',
        path: relativePath,
        root,
        timestamp: Date.now(),
      });
    }, debounceMs);
  };

  try {
    watcher = fs.watch(root, { recursive: true }, emitChange);
  } catch {
    watcher = fs.watch(root, emitChange);
  }

  return {
    close() {
      clearTimeout(debounceTimer);
      watcher?.close();
    },
  };
}
