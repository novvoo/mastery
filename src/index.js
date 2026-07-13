#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveOmpCliPath() {
  if (process.env.OMP_CLI_PATH) {
    return process.env.OMP_CLI_PATH;
  }

  const searchPaths = [
    path.resolve(__dirname, '../node_modules/@oh-my-pi/pi-coding-agent'),
    path.resolve(process.cwd(), 'node_modules/@oh-my-pi/pi-coding-agent'),
  ];

  for (const pkgRoot of searchPaths) {
    const pkgPath = path.join(pkgRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const binEntry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.omp;
      if (binEntry) {
        const cliPath = path.join(pkgRoot, binEntry);
        if (fs.existsSync(cliPath)) {
          return cliPath;
        }
      }
    }
  }

  throw new Error(
    '未找到 @oh-my-pi/pi-coding-agent 包，请运行: npm add @oh-my-pi/pi-coding-agent，或设置 OMP_CLI_PATH 环境变量'
  );
}

export async function runCli(argv = process.argv.slice(2)) {
  const cliPath = resolveOmpCliPath();
  const child = spawn(process.env.BUN_PATH || 'bun', [cliPath, ...argv], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`OMP CLI 被信号 ${signal} 终止`));
      else resolve(code || 0);
    });
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

export { OmpAdapter, createOmpAdapter } from './adapters/desktop/omp-adapter.js';
export {
  DesktopCore,
  createDesktopCore,
  DesktopState,
  DesktopPlugin,
  UIBridge,
  createUIBridge,
} from './adapters/desktop/desktop-core.js';
export { RuntimeEvent, PlatformType, MAX_ITERATIONS_DEFAULT } from './runtime/types.js';
export { getEventBus } from './runtime/event-bus.js';
