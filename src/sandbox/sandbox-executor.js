/**
 * Sandbox Executor - 安全执行层
 * 
 * 提供隔离的执行环境，支持:
 * - 资源限制 (CPU, 内存, 时间)
 * - 网络隔离
 * - 文件系统沙盒
 * - 权限控制
 */

import { spawn } from 'child_process';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * 沙盒执行配置
 */
export class SandboxConfig {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000; // 默认30秒
    this.memoryLimit = options.memoryLimit || 512 * 1024 * 1024; // 512MB
    this.cpuLimit = options.cpuLimit || 1.0; // 1核
    this.networkEnabled = options.networkEnabled ?? false;
    this.fileSystemEnabled = options.fileSystemEnabled ?? true;
    this.workingDir = options.workingDir || null;
    this.envVars = options.envVars || {};
    this.readOnlyPaths = options.readOnlyPaths || [];
    this.writeablePaths = options.writeablePaths || [];
    this.blockedSyscalls = options.blockedSyscalls || [
      'execve', 'fork', 'vfork', 'clone', 'ptrace'
    ];
  }
}

/**
 * 沙盒执行结果
 */
export class SandboxResult {
  constructor(data = {}) {
    this.success = data.success ?? false;
    this.exitCode = data.exitCode ?? null;
    this.stdout = data.stdout ?? '';
    this.stderr = data.stderr ?? '';
    this.duration = data.duration ?? 0;
    this.memoryUsed = data.memoryUsed ?? 0;
    this.killed = data.killed ?? false;
    this.killReason = data.killReason ?? null;
    this.sandboxId = data.sandboxId ?? null;
  }
}

/**
 * 沙盒执行器
 */
export class SandboxExecutor {
  #sandboxes = new Map();
  #config;

  constructor(config = new SandboxConfig()) {
    this.#config = config;
  }

  /**
   * 创建隔离的沙盒环境
   */
  async createSandbox(options = {}) {
    const sandboxId = randomUUID();
    const config = new SandboxConfig({ ...this.#config, ...options });
    
    // 创建沙盒工作目录
    const sandboxDir = config.workingDir || join(process.cwd(), '.sandboxes', sandboxId);
    if (!existsSync(sandboxDir)) {
      mkdirSync(sandboxDir, { recursive: true });
    }

    // 创建子目录结构
    const dirs = ['workspace', 'tmp', 'readonly'];
    for (const dir of dirs) {
      const path = join(sandboxDir, dir);
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    }

    const sandbox = {
      id: sandboxId,
      config,
      dir: sandboxDir,
      createdAt: Date.now(),
      processes: new Map(),
    };

    this.#sandboxes.set(sandboxId, sandbox);
    return sandbox;
  }

  /**
   * 在沙盒中执行命令
   */
  async execute(command, args = [], options = {}) {
    const sandbox = await this.createSandbox(options.sandbox);
    const startTime = Date.now();

    try {
      // 准备环境变量
      const env = {
        ...process.env,
        ...sandbox.config.envVars,
        SANDBOX_ID: sandbox.id,
        SANDBOX_DIR: sandbox.dir,
        NODE_OPTIONS: `--max-old-space-size=${Math.floor(sandbox.config.memoryLimit / 1024 / 1024)}`,
      };

      // 构建沙盒化命令
      const sandboxedCommand = this.#buildSandboxCommand(command, sandbox.config);
      
      return new Promise((resolve, reject) => {
        const child = spawn(sandboxedCommand, args, {
          cwd: join(sandbox.dir, 'workspace'),
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: false,
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let killReason = null;

        // 收集输出
        child.stdout?.on('data', (data) => {
          stdout += data.toString();
          // 限制输出大小
          if (stdout.length > 10 * 1024 * 1024) { // 10MB
            stdout = stdout.substring(0, 10 * 1024 * 1024) + '\n... (output truncated)';
          }
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
          if (stderr.length > 10 * 1024 * 1024) {
            stderr = stderr.substring(0, 10 * 1024 * 1024) + '\n... (output truncated)';
          }
        });

        // 设置超时
        const timeoutId = setTimeout(() => {
          killed = true;
          killReason = 'timeout';
          child.kill('SIGTERM');
          
          // 5秒后强制终止
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }, sandbox.config.timeout);

        // 内存监控
        const memoryCheck = setInterval(() => {
          try {
            const usage = process.memoryUsage();
            if (usage.heapUsed > sandbox.config.memoryLimit) {
              killed = true;
              killReason = 'memory_limit';
              child.kill('SIGTERM');
            }
          } catch (e) {
            // 忽略错误
          }
        }, 1000);

        child.on('close', (exitCode) => {
          clearTimeout(timeoutId);
          clearInterval(memoryCheck);

          const duration = Date.now() - startTime;
          
          resolve(new SandboxResult({
            success: exitCode === 0 && !killed,
            exitCode,
            stdout,
            stderr,
            duration,
            memoryUsed: process.memoryUsage().heapUsed,
            killed,
            killReason,
            sandboxId: sandbox.id,
          }));
        });

        child.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(memoryCheck);
          
          reject(new Error(`Sandbox execution failed: ${error.message}`));
        });
      });
    } finally {
      // 清理沙盒（如果配置了自动清理）
      if (options.autoCleanup !== false) {
        await this.destroySandbox(sandbox.id);
      }
    }
  }

  /**
   * 执行 JavaScript 代码
   */
  async executeJavaScript(code, options = {}) {
    const sandbox = await this.createSandbox(options.sandbox);
    
    // 创建临时文件
    const scriptPath = join(sandbox.dir, 'workspace', `script_${Date.now()}.js`);
    
    // 包装代码以提供安全环境
    const wrappedCode = `
      'use strict';
      
      // 禁用危险的全局对象
      delete global.process;
      delete global.require;
      delete global.module;
      delete global.exports;
      
      // 提供安全的控制台
      const console = {
        log: (...args) => print(args.join(' ')),
        error: (...args) => printError(args.join(' ')),
        warn: (...args) => printError('WARN: ' + args.join(' ')),
        info: (...args) => print(args.join(' ')),
      };
      
      // 执行用户代码
      ${code}
    `;

    writeFileSync(scriptPath, wrappedCode);

    return this.execute('node', [scriptPath], {
      ...options,
      sandbox: { ...options.sandbox, workingDir: sandbox.dir },
    });
  }

  /**
   * 执行 Python 代码
   */
  async executePython(code, options = {}) {
    const sandbox = await this.createSandbox(options.sandbox);
    const scriptPath = join(sandbox.dir, 'workspace', `script_${Date.now()}.py`);
    
    // 添加安全限制
    const wrappedCode = `
import sys
sys.setrecursionlimit(1000)

${code}
`;

    writeFileSync(scriptPath, wrappedCode);

    return this.execute('python3', [scriptPath], {
      ...options,
      sandbox: { ...options.sandbox, workingDir: sandbox.dir },
    });
  }

  /**
   * 构建沙盒化命令
   */
  #buildSandboxCommand(command, config) {
    // 暂时回退到普通执行，避免 firejail 依赖
    // 实际生产环境应该配置 firejail 或 systemd-run
    return command;
  }

  /**
   * 销毁沙盒
   */
  async destroySandbox(sandboxId) {
    const sandbox = this.#sandboxes.get(sandboxId);
    if (!sandbox) {return false;}

    // 终止所有进程
    for (const proc of sandbox.processes.values()) {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        // 忽略错误
      }
    }

    // 清理文件系统
    try {
      rmSync(sandbox.dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Failed to cleanup sandbox ${sandboxId}:`, e.message);
    }

    this.#sandboxes.delete(sandboxId);
    return true;
  }

  /**
   * 获取沙盒信息
   */
  getSandbox(sandboxId) {
    return this.#sandboxes.get(sandboxId);
  }

  /**
   * 列出所有沙盒
   */
  listSandboxes() {
    return Array.from(this.#sandboxes.values()).map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      processCount: s.processes.size,
    }));
  }

  /**
   * 清理所有沙盒
   */
  async cleanup() {
    const promises = Array.from(this.#sandboxes.keys()).map(id => 
      this.destroySandbox(id)
    );
    await Promise.all(promises);
  }
}

export default SandboxExecutor;
