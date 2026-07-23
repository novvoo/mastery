import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_IGNORED_WATCH_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', '.cache'];

export function listWorkspaceDirectory(root, options = {}) {
  const relative = String(options.path || '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root))) throw new Error('Path is outside workspace');
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => !DEFAULT_IGNORED_WATCH_DIRECTORIES.includes(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.relative(root, path.join(target, entry.name)),
      type: entry.isDirectory() ? 'directory' : 'file',
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  return { success: true, path: relative, entries };
}

export function createWorkspaceWatcher(root, onChange) {
  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename || DEFAULT_IGNORED_WATCH_DIRECTORIES.some((part) => String(filename).split(path.sep).includes(part))) return;
      onChange?.({ eventType, path: String(filename) });
    });
  } catch {
    return { close() {} };
  }
  return watcher;
}
