/**
 * Process Manager
 * 进程管理器 - 处理跨平台兼容性、进程生命周期、竞态条件
 *
 * 功能：
 * - 跨平台命令适配 (Windows/macOS/Linux)
 * - 进程互斥锁（防止竞态）
 * - 端口管理（避免端口冲突）
 * - 进程健康检查
 * - 自动重启机制
 */

import { spawn } from 'child_process';
import { platform, tmpdir } from 'os';
import {
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

// 平台检测
const PLATFORM = platform();
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

// 锁文件目录
const LOCK_DIR = join(tmpdir(), 'ai-agent-locks');

export class ProcessManager extends EventEmitter {
  #activeProcesses;
  #portLocks;
  #healthCheckInterval;
  #config;
  #portAllocationQueue;

  constructor(options = {}) {
    super();
    this.#activeProcesses = new Map();
    this.#portLocks = new Map();
    this.#portAllocationQueue = Promise.resolve();
    this.#config = {
      healthCheckInterval: options.healthCheckInterval ?? 30000, // 30秒
      maxRestartAttempts: options.maxRestartAttempts ?? 3,
      restartDelay: options.restartDelay ?? 5000, // 5秒
      defaultTimeout: options.defaultTimeout ?? 60000, // 1分钟
      ...options,
    };

    // 确保锁目录存在
    if (!existsSync(LOCK_DIR)) {
      mkdirSync(LOCK_DIR, { recursive: true });
    }

    // 启动健康检查
    this.#startHealthCheck();
  }

  /**
   * 获取平台信息
   */
  static getPlatformInfo() {
    return {
      platform: PLATFORM,
      isWindows: IS_WINDOWS,
      isMacOS: IS_MACOS,
      isLinux: IS_LINUX,
      shell: IS_WINDOWS ? 'cmd.exe' : '/bin/sh',
      shellFlag: IS_WINDOWS ? '/c' : '-c',
      pathSeparator: IS_WINDOWS ? ';' : ':',
      executableExt: IS_WINDOWS ? '.exe' : '',
    };
  }

  /**
   * 适配跨平台命令
   * @param {string} command - 原始命令
   * @returns {object} 适配后的命令配置
   */
  adaptCommand(command) {
    const info = ProcessManager.getPlatformInfo();

    // Windows 适配
    if (IS_WINDOWS) {
      // 转换路径分隔符
      command = command.replace(/\//g, '\\');

      // 处理 which/where
      command = command.replace(/\bwhich\b/g, 'where');

      // 处理 rm -rf
      command = command.replace(/\brm\s+-rf\s+/g, 'rmdir /s /q ');
      command = command.replace(/\brm\s+-f\s+/g, 'del /f ');

      // 处理 cp
      command = command.replace(/\bcp\s+-r\s+/g, 'xcopy /e /i ');
      command = command.replace(/\bcp\s+/g, 'copy ');

      // 处理 mv
      command = command.replace(/\bmv\s+/g, 'move ');

      // 处理 cat
      command = command.replace(/\bcat\s+/g, 'type ');

      // 处理 touch
      command = command.replace(/\btouch\s+/g, 'type nul > ');

      // 处理 mkdir -p
      command = command.replace(/\bmkdir\s+-p\s+/g, 'mkdir ');

      // 处理 grep
      command = command.replace(/\bgrep\s+/g, 'findstr ');

      // 处理 && 和 ||
      // Windows cmd 支持 && 和 ||，但 PowerShell 需要特殊处理
    }

    return {
      command,
      shell: info.shell,
      shellFlag: info.shellFlag,
      platform: info.platform,
    };
  }

  /**
   * 执行命令（带超时和错误处理）
   * @param {string} command - 命令
   * @param {object} options - 选项
   * @returns {Promise<object>} 执行结果
   */
  async execute(command, options = {}) {
    const adapted = this.adaptCommand(command);
    const timeout = options.timeout ?? this.#config.defaultTimeout;
    const cwd = options.cwd || process.cwd();
    const env = { ...process.env, ...options.env };

    // 生成进程 ID
    const processId = `proc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      // 启动进程
      const child = spawn(adapted.shell, [adapted.shellFlag, adapted.command], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true, // Windows 隐藏窗口
      });

      // 记录进程
      this.#activeProcesses.set(processId, {
        process: child,
        command: adapted.command,
        startTime,
        timeout,
        restartCount: 0,
      });

      this.emit('process:started', { processId, command: adapted.command });

      // 超时处理
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');

        // 强制终止
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);

      // 收集输出
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        this.emit('process:stdout', { processId, data: data.toString() });
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        this.emit('process:stderr', { processId, data: data.toString() });
      });

      // 进程结束
      child.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        this.#activeProcesses.delete(processId);

        const duration = Date.now() - startTime;
        const result = {
          processId,
          command: adapted.command,
          exitCode: code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
          killed,
          success: code === 0 && !killed,
        };

        if (result.success) {
          this.emit('process:completed', result);
          resolve(result);
        } else {
          this.emit('process:failed', result);

          // 自动重试逻辑
          if (options.retry !== false && this.shouldRetry(result)) {
            this.#retryExecution(command, options, processId).then(resolve).catch(reject);
          } else {
            reject(new Error(`Command failed: ${stderr || 'Unknown error'} (exit code: ${code})`));
          }
        }
      });

      // 错误处理
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        this.#activeProcesses.delete(processId);
        this.emit('process:error', { processId, error });
        reject(error);
      });
    });
  }

  /**
   * 判断是否应重试
   */
  shouldRetry(result) {
    // 超时错误重试
    if (result.killed) {
      return true;
    }

    // 特定退出码重试
    const retryableCodes = [1, 126, 127, 130, 137, 143]; // 各种错误码
    if (retryableCodes.includes(result.exitCode)) {
      return true;
    }

    // 网络相关错误重试
    if (result.stderr && /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(result.stderr)) {
      return true;
    }

    return false;
  }

  /**
   * 重试执行
   */
  async #retryExecution(command, options, originalProcessId) {
    const restartCount = Number.isFinite(options.__restartCount) ? options.__restartCount : 0;

    if (restartCount >= this.#config.maxRestartAttempts) {
      throw new Error(`Max retry attempts (${this.#config.maxRestartAttempts}) exceeded`);
    }

    const nextAttempt = restartCount + 1;
    this.emit('process:retry', {
      processId: originalProcessId,
      attempt: nextAttempt,
    });

    // 延迟后重试
    await this.delay(this.#config.restartDelay * nextAttempt);

    return this.execute(command, { ...options, __restartCount: nextAttempt });
  }

  /**
   * 获取可用端口（避免端口冲突）
   * @param {number} preferredPort - 首选端口
   * @returns {Promise<number>} 可用端口
   */
  async getAvailablePort(preferredPort = 0) {
    const allocation = this.#portAllocationQueue.then(() =>
      this.#allocateAvailablePort(preferredPort),
    );
    this.#portAllocationQueue = allocation.catch(() => {});
    return allocation;
  }

  async #allocateAvailablePort(preferredPort = 0) {
    const net = await import('net');
    const host = '127.0.0.1';

    for (let attempt = 0; attempt < 25; attempt++) {
      const port = await new Promise((resolve, reject) => {
        const server = net.createServer();

        server.on('error', (err) => {
          if (preferredPort && err.code === 'EADDRINUSE') {
            server.listen(0, host);
          } else {
            reject(err);
          }
        });

        server.on('listening', () => {
          const address = server.address();
          const resolvedPort = typeof address === 'object' ? address.port : 0;
          server.close(() => resolve(resolvedPort));
        });

        server.listen(preferredPort, host);
      });

      if (!this.#portLocks.has(port)) {
        this.#portLocks.set(port, {
          lockedAt: Date.now(),
          pid: process.pid,
        });
        return port;
      }

      preferredPort = 0;
    }

    throw new Error('Could not allocate a unique local port');
  }

  /**
   * 检查端口是否可用
   */
  async isPortAvailable(port) {
    const net = await import('net');

    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * 获取进程互斥锁
   * @param {string} lockName - 锁名称
   * @returns {boolean} 是否获取成功
   */
  acquireLock(lockName) {
    const lockFile = join(LOCK_DIR, `${lockName}.lock`);

    try {
      // 检查锁是否存在且有效
      if (existsSync(lockFile)) {
        const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));

        // 检查锁是否过期（5分钟）
        if (Date.now() - lockData.timestamp < 300000) {
          // 检查进程是否仍在运行
          try {
            process.kill(lockData.pid, 0);
            return false; // 进程仍在运行，锁有效
          } catch {
            // 进程已不存在，可以获取锁
          }
        }
      }

      // 创建锁文件
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
        }),
      );

      return true;
    } catch (error) {
      console.error(`Failed to acquire lock ${lockName}:`, error);
      return false;
    }
  }

  /**
   * 释放进程互斥锁
   */
  releaseLock(lockName) {
    const lockFile = join(LOCK_DIR, `${lockName}.lock`);

    try {
      if (existsSync(lockFile)) {
        const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));

        // 只能释放自己持有的锁
        if (lockData.pid === process.pid) {
          unlinkSync(lockFile);
          return true;
        }
      }
    } catch (error) {
      console.error(`Failed to release lock ${lockName}:`, error);
    }

    return false;
  }

  /**
   * 检查锁状态
   */
  checkLock(lockName) {
    const lockFile = join(LOCK_DIR, `${lockName}.lock`);

    try {
      if (!existsSync(lockFile)) {
        return { locked: false };
      }

      const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));

      // 检查锁是否过期
      if (Date.now() - lockData.timestamp > 300000) {
        return { locked: false, expired: true };
      }

      // 检查进程是否存在
      try {
        process.kill(lockData.pid, 0);
        return { locked: true, pid: lockData.pid, timestamp: lockData.timestamp };
      } catch {
        return { locked: false, stale: true };
      }
    } catch (error) {
      return { locked: false, error: error.message };
    }
  }

  /**
   * 启动健康检查
   */
  #startHealthCheck() {
    this.#healthCheckInterval = setInterval(() => {
      this.#performHealthCheck();
    }, this.#config.healthCheckInterval);
  }

  /**
   * 执行健康检查
   */
  #performHealthCheck() {
    const now = Date.now();
    const staleProcessIds = [];

    for (const [processId, info] of this.#activeProcesses) {
      const duration = now - info.startTime;

      // 检查是否超时
      if (duration > info.timeout) {
        console.warn(`Process ${processId} exceeded timeout, terminating...`);
        this.terminateProcess(processId);
        continue;
      }

      // 检查进程是否还活着
      if (info.process && !info.process.killed) {
        try {
          process.kill(info.process.pid, 0);
        } catch {
          // 进程已死但未触发 close 事件
          console.warn(`Process ${processId} died unexpectedly, cleaning up`);
          staleProcessIds.push(processId);
        }
      }
    }

    // 清理已死的进程记录
    for (const processId of staleProcessIds) {
      this.#activeProcesses.delete(processId);
    }

    // 清理过期锁文件
    this.#cleanupStaleLocks();
  }

  /**
   * 清理过期的锁文件
   */
  #cleanupStaleLocks() {
    try {
      if (!existsSync(LOCK_DIR)) {
        return;
      }

      const files = readdirSync(LOCK_DIR);
      const now = Date.now();
      const LOCK_TTL_MS = 30 * 60 * 1000; // 30分钟后锁过期

      for (const file of files) {
        if (!file.endsWith('.lock')) {
          continue;
        }

        try {
          const filePath = join(LOCK_DIR, file);
          const stats = statSync(filePath);
          const age = now - stats.mtimeMs;

          if (age > LOCK_TTL_MS) {
            // 检查持有锁的进程是否还活着
            let lockData;
            try {
              lockData = JSON.parse(readFileSync(filePath, 'utf-8'));
            } catch {
              // 无法解析锁文件，直接删除
            }

            let shouldDelete = true;
            if (lockData && lockData.pid) {
              try {
                // 检查进程是否还活着
                process.kill(lockData.pid, 0);
                shouldDelete = false; // 进程还在，不删除
              } catch {
                // 进程不在了，可以删除
              }
            }

            if (shouldDelete) {
              unlinkSync(filePath);
              console.log(`process-manager: cleaned up stale lock ${file}`);
            }
          }
        } catch {
          // 忽略单个锁文件的错误
        }
      }
    } catch {
      // 清理失败不影响正常使用
    }
  }

  /**
   * 终止进程
   */
  terminateProcess(processId, force = false) {
    const info = this.#activeProcesses.get(processId);
    if (!info || !info.process) {
      return false;
    }

    try {
      if (force) {
        info.process.kill('SIGKILL');
      } else {
        info.process.kill('SIGTERM');

        // 5秒后强制终止
        setTimeout(() => {
          if (!info.process.killed) {
            info.process.kill('SIGKILL');
          }
        }, 5000);
      }

      return true;
    } catch (error) {
      console.error(`Failed to terminate process ${processId}:`, error);
      return false;
    }
  }

  /**
   * 终止所有活跃进程
   */
  async terminateAllProcesses(force = false) {
    const promises = [];

    for (const [processId] of this.#activeProcesses) {
      promises.push(this.terminateProcess(processId, force));
    }

    await Promise.all(promises);
    this.#activeProcesses.clear();
  }

  /**
   * 获取系统资源使用情况
   */
  async getSystemStats() {
    const os = await import('os');

    return {
      platform: PLATFORM,
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAvg: os.loadavg(),
      uptime: os.uptime(),
      activeProcesses: this.#activeProcesses.size,
      lockedPorts: this.#portLocks.size,
    };
  }

  /**
   * 延迟函数
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 清理资源
   */
  async dispose() {
    // 停止健康检查
    if (this.#healthCheckInterval) {
      clearInterval(this.#healthCheckInterval);
      this.#healthCheckInterval = null;
    }

    // 终止所有进程
    await this.terminateAllProcesses(true);

    // 清理端口锁
    this.#portLocks.clear();

    // 移除所有监听器
    this.removeAllListeners();
  }
}

export default ProcessManager;
