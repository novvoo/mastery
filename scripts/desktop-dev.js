/**
 * Start the Electron desktop app with the Vite renderer dev server.
 */

import { spawn } from 'child_process';
import { once } from 'events';
import { setTimeout as delay } from 'timers/promises';

const DEV_SERVER_URL = process.env.DEV_SERVER_URL || 'http://127.0.0.1:5173';
const VITE_HOST = new URL(DEV_SERVER_URL).hostname;
const VITE_PORT = new URL(DEV_SERVER_URL).port || '5173';

const children = new Set();
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }

    await delay(250);
  }

  throw new Error(`Renderer dev server did not start at ${url}`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill();
  }

  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  const vite = run('npx', [
    'vite',
    '--config',
    'desktop/vite.config.js',
    '--host',
    VITE_HOST,
    '--port',
    VITE_PORT,
  ]);

  vite.once('exit', (code) => {
    if (!shuttingDown) shutdown(code || 1);
  });

  await waitForServer(DEV_SERVER_URL);

  const electron = run('npx', ['electron', 'desktop/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DEV_SERVER_URL,
    },
  });

  const [code] = await once(electron, 'exit');
  shutdown(code || 0);
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
