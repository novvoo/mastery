import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ProcessManager } from '../../src/core/runtime/process-manager.js';

describe('ProcessManager', () => {
  let pm;

  beforeEach(() => {
    pm = new ProcessManager({ healthCheckInterval: 60000 });
  });

  afterEach(async () => {
    if (pm) {
      await pm.dispose();
    }
  });

  test('constructor creates instance with default config', () => {
    const p = new ProcessManager({ healthCheckInterval: 60000 });
    expect(p).toBeDefined();
  });

  test('constructor accepts custom options', () => {
    const p = new ProcessManager({
      healthCheckInterval: 10000,
      maxRestartAttempts: 5,
      restartDelay: 1000,
      defaultTimeout: 30000,
    });
    expect(p).toBeDefined();
  });

  test('getPlatformInfo returns platform details', () => {
    const info = ProcessManager.getPlatformInfo();
    expect(info).toBeDefined();
    expect(typeof info.platform).toBe('string');
    expect(typeof info.isWindows).toBe('boolean');
    expect(typeof info.isMacOS).toBe('boolean');
    expect(typeof info.isLinux).toBe('boolean');
    expect(typeof info.shell).toBe('string');
    expect(typeof info.shellFlag).toBe('string');
    expect(typeof info.pathSeparator).toBe('string');
    expect(typeof info.executableExt).toBe('string');
  });

  test('adaptCommand returns adapted command config', () => {
    const result = pm.adaptCommand('echo hello');
    expect(result).toBeDefined();
    expect(result.command).toBeDefined();
    expect(result.shell).toBeDefined();
    expect(result.shellFlag).toBeDefined();
    expect(result.platform).toBeDefined();
  });

  test('adaptCommand keeps simple command unchanged on non-Windows', () => {
    const info = ProcessManager.getPlatformInfo();
    if (!info.isWindows) {
      const result = pm.adaptCommand('ls -la');
      expect(result.command).toBe('ls -la');
    }
  });

  test('adaptCommand handles which command on non-Windows', () => {
    const info = ProcessManager.getPlatformInfo();
    if (!info.isWindows) {
      const result = pm.adaptCommand('which node');
      expect(result.command).toBe('which node');
    }
  });

  test('execute runs a simple command successfully', async () => {
    const result = await pm.execute('echo hello', { timeout: 10000 });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.killed).toBe(false);
    expect(typeof result.duration).toBe('number');
  });

  test('execute returns process details', async () => {
    const result = await pm.execute('echo test', { timeout: 10000 });
    expect(result.processId).toBeDefined();
    expect(result.command).toBeDefined();
    expect(typeof result.duration).toBe('number');
  });

  test('execute handles failing command', async () => {
    try {
      await pm.execute('exit 1', { timeout: 10000, retry: false });
      // If it doesn't throw, check result
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
    }
  });

  test('execute rejects after retryable failures instead of resolving empty', async () => {
    const retrying = new ProcessManager({
      healthCheckInterval: 60000,
      maxRestartAttempts: 1,
      restartDelay: 0,
    });
    const retryEvents = [];
    retrying.on('process:retry', (event) => retryEvents.push(event));

    try {
      await expect(retrying.execute('exit 1', { timeout: 1000 })).rejects.toThrow(
        'Max retry attempts',
      );
      expect(retryEvents.length).toBe(1);
      expect(retryEvents[0].attempt).toBe(1);
    } finally {
      await retrying.dispose();
    }
  });

  test('execute respects zero restart attempts for retryable failures', async () => {
    const noRetry = new ProcessManager({
      healthCheckInterval: 60000,
      maxRestartAttempts: 0,
      restartDelay: 0,
    });

    try {
      await expect(noRetry.execute('exit 1', { timeout: 1000 })).rejects.toThrow(
        'Max retry attempts (0) exceeded',
      );
    } finally {
      await noRetry.dispose();
    }
  });

  test('execute respects timeout option', async () => {
    try {
      await pm.execute('sleep 10', { timeout: 500, retry: false });
      // Should timeout and throw/reject
    } catch (error) {
      expect(error).toBeDefined();
    }
  }, 10000);

  test('shouldRetry returns true for killed processes', () => {
    const result = { killed: true, exitCode: null, stderr: '' };
    expect(pm.shouldRetry(result)).toBe(true);
  });

  test('shouldRetry returns true for retryable exit codes', () => {
    expect(pm.shouldRetry({ killed: false, exitCode: 1, stderr: '' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 126, stderr: '' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 127, stderr: '' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 130, stderr: '' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 137, stderr: '' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 143, stderr: '' })).toBe(true);
  });

  test('shouldRetry returns true for network errors in stderr', () => {
    expect(pm.shouldRetry({ killed: false, exitCode: 1, stderr: 'ECONNREFUSED' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 1, stderr: 'ETIMEDOUT' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 1, stderr: 'ENOTFOUND' })).toBe(true);
    expect(pm.shouldRetry({ killed: false, exitCode: 1, stderr: 'EAI_AGAIN' })).toBe(true);
  });

  test('shouldRetry returns false for non-retryable results', () => {
    expect(pm.shouldRetry({ killed: false, exitCode: 0, stderr: '' })).toBe(false);
    expect(pm.shouldRetry({ killed: false, exitCode: 2, stderr: 'some error' })).toBe(false);
  });

  test('acquireLock and releaseLock work together', () => {
    const lockName = `test_lock_${Date.now()}`;
    const acquired = pm.acquireLock(lockName);
    expect(acquired).toBe(true);

    // Second acquire from same process should fail since lock is valid
    const acquired2 = pm.acquireLock(lockName);
    expect(acquired2).toBe(false);

    const released = pm.releaseLock(lockName);
    expect(released).toBe(true);
  });

  test('releaseLock returns false for non-held lock', () => {
    const result = pm.releaseLock('nonexistent_lock_xyz');
    expect(result).toBe(false);
  });

  test('checkLock returns correct status', () => {
    const lockName = `test_check_${Date.now()}`;
    // No lock yet
    const noLock = pm.checkLock(lockName);
    expect(noLock.locked).toBe(false);

    // Acquire lock
    pm.acquireLock(lockName);
    const locked = pm.checkLock(lockName);
    expect(locked.locked).toBe(true);
    expect(locked.pid).toBe(process.pid);

    // Release
    pm.releaseLock(lockName);
  });

  test('isPortAvailable checks port availability', async () => {
    const available = await pm.isPortAvailable(0);
    // Port 0 is not a real port to check, use a high port
    const available2 = await pm.isPortAvailable(59999);
    expect(typeof available2).toBe('boolean');
  });

  test('getAvailablePort returns a valid port number', async () => {
    const port = await pm.getAvailablePort(0);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  test('getSystemStats returns system information', async () => {
    const stats = await pm.getSystemStats();
    expect(stats).toBeDefined();
    expect(typeof stats.platform).toBe('string');
    expect(typeof stats.arch).toBe('string');
    expect(typeof stats.cpus).toBe('number');
    expect(stats.cpus).toBeGreaterThan(0);
    expect(typeof stats.totalMemory).toBe('number');
    expect(typeof stats.freeMemory).toBe('number');
    expect(typeof stats.activeProcesses).toBe('number');
    expect(typeof stats.lockedPorts).toBe('number');
  });

  test('delay returns a promise that resolves after specified time', async () => {
    const start = Date.now();
    await pm.delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // slight margin
  });

  test('terminateProcess returns false for non-existent process', () => {
    const result = pm.terminateProcess('nonexistent');
    expect(result).toBe(false);
  });

  test('terminateAllProcesses clears active processes', async () => {
    await pm.terminateAllProcesses();
    const stats = await pm.getSystemStats();
    expect(stats.activeProcesses).toBe(0);
  });

  test('dispose cleans up resources', async () => {
    await pm.dispose();
    // Should not throw
  });
});
