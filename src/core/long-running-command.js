import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const LONG_RUNNING_PATTERNS = [
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b/i, reason: 'package script starts a dev server or watcher' },
  { pattern: /\b(vite|next\s+dev|webpack-dev-server|parcel|astro\s+dev)\b/i, reason: 'frontend dev server command' },
  { pattern: /\b(uvicorn|gunicorn|flask\s+run|python(?:3)?\s+manage\.py\s+runserver)\b/i, reason: 'backend web server command' },
  { pattern: /\bpython(?:3)?\s+-m\s+http\.server\b/i, reason: 'local HTTP server command' },
  { pattern: /\b(jest|vitest|pytest|tsc)\b.*\s--watch\b/i, reason: 'watch-mode test or build command' },
  { pattern: /\b(tail\s+-f|ping\b|nc\s+-l|while\s+true)\b/i, reason: 'command is designed to keep running' },
  { pattern: /\b(node|python(?:3)?|bun)\b.*\b(repl|interactive)\b/i, reason: 'interactive runtime command' },
  { pattern: /\bpygame\b/i, reason: 'pygame applications keep a window/event loop open until stopped' },
];

export function classifyLongRunningCommand(command, options = {}) {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return { isLongRunning: false, reason: '' };
  }

  for (const entry of LONG_RUNNING_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return { isLongRunning: true, reason: entry.reason };
    }
  }

  const pythonFile = findPythonEntrypoint(normalized);
  if (pythonFile && importsPygame(pythonFile, options.cwd || process.cwd())) {
    return {
      isLongRunning: true,
      reason: `Python entrypoint ${pythonFile} imports pygame and likely opens an event loop`,
    };
  }

  return { isLongRunning: false, reason: '' };
}

function findPythonEntrypoint(command) {
  const match = /(?:^|\s)(?:python3?|py)\s+(?:-[A-Za-z]\s+)*(?:"([^"]+\.py)"|'([^']+\.py)'|([^\s;&|]+\.py))/i.exec(command);
  return match?.[1] || match?.[2] || match?.[3] || null;
}

function importsPygame(filePath, cwd) {
  const absolutePath = resolve(cwd, filePath);
  if (!existsSync(absolutePath)) {
    return false;
  }

  try {
    const content = readFileSync(absolutePath, 'utf8');
    return /^\s*(import\s+pygame\b|from\s+pygame\b)/m.test(content);
  } catch {
    return false;
  }
}
