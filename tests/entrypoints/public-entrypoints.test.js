import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';

describe('public entrypoints', () => {
  test('CLI package entrypoint can be imported without starting the app', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      "const mod = await import('./src/index.js'); console.log(typeof mod.default, typeof mod.runCli, typeof mod.handleCliArgs);",
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function function function');
    expect(result.stderr.trim()).toBe('');
  });

  test('desktop main entrypoint can be imported without launching Electron', () => {
    const result = spawnSync('node', [
      '--input-type=module',
      '-e',
      "const mod = await import('./desktop/main.js'); console.log(typeof mod.ElectronMainApp, typeof mod.main);",
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function function');
    // 注意：electron 包在首次 import 时可能输出下载提示到 stderr，
    // 我们只检查非致命错误（不包含 Error / StackTrace）
    const lowerStderr = (result.stderr || '').toLowerCase();
    expect(lowerStderr).not.toContain('error');
    expect(lowerStderr).not.toContain('trace');
  });
});
