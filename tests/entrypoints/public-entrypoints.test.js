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
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('function function');
    expect(result.stderr.trim()).toBe('');
  });
});
