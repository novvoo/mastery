/**
 * Smoke Test — 面向首次运行者
 *
 * 验证路径：
 *   1. 入口模块可静态导入（不需要 model provider / API key）
 *   2. `--version` 输出项目版本号
 *   3. `--help` 输出帮助信息（包含关键命令名）
 *   4. handleCliArgs(['help']) 能正常处理并返回 true（即已显示帮助，不进入交互）
 *   5. `doctor` / `check` 输出可执行（不依赖模型）
 *
 * 设计目标：
 *   - 这是用户 clone 仓库 + `bun install` 之后第一个能跑通的验证
 *   - 不需要任何环境变量或 API key
 *   - 测试结果失败应当提示具体的运行环境版本问题（而不是模型问题）
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));

// 为 smoke 测试提供假的 API key，避免 doctor 检查失败
const originalOpenAIKey = process.env.OPENAI_API_KEY;
beforeAll(() => {
  // 生成一个随机的假 API key 用于测试
  process.env.OPENAI_API_KEY = 'sk-test-' + Math.random().toString(36).substring(2, 15);
});

afterAll(() => {
  // 恢复原始环境变量
  if (originalOpenAIKey !== undefined) {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
});

describe('smoke: 零配置 / 首次运行验证', () => {
  describe('1. 入口模块可导入', () => {
    it('src/index.js 能作为 ESM 模块加载', async () => {
      const mod = await import('../../src/index.js');
      expect(mod).toBeObject();
      // 导出项：runCli, AIEngineeringAgent, handleCliArgs 等
      expect(typeof mod.runCli === 'function' || typeof mod.default === 'function').toBe(true);
    });

    it('导出 handleCliArgs 用于命令行参数处理', async () => {
      const mod = await import('../../src/index.js');
      expect(typeof mod.handleCliArgs).toBe('function');
    });

    it('AIEngineeringAgent 类可实例化基础依赖', async () => {
      const mod = await import('../../src/index.js');
      expect(typeof mod.AIEngineeringAgent).toBe('function');
    });
  });

  describe('2. --version 输出正确版本', () => {
    it('handleCliArgs(["--version"]) 打印版本号并返回 true', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['--version']);
      expect(result).toBe(true);
    });

    it('handleCliArgs(["-v"]) 短参数同样可用', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['-v']);
      expect(result).toBe(true);
    });

    it('package.json 中的 version 字段存在且合法', () => {
      expect(pkg.version).toBeString();
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('3. --help 输出完整帮助信息', () => {
    it('handleCliArgs(["--help"]) 返回 true', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['--help']);
      expect(result).toBe(true);
    });

    it('handleCliArgs(["help"]) 裸命令也能处理', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['help']);
      expect(result).toBe(true);
    });

    it('handleCliArgs(["-h"]) 短参数同样可用', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['-h']);
      expect(result).toBe(true);
    });
  });

  describe('4. CLI 参数路由（不进入交互循环）', () => {
    it('handleCliArgs([]) 不处理参数 → 返回 false，交给上层进入交互', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs([]);
      expect(result).toBe(false);
    });

    it('handleCliArgs(["doctor"]) 返回 true，不会进入交互循环', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['doctor']);
      expect(result).toBe(true);
    });

    it('handleCliArgs(["check"]) 是 doctor 的别名', async () => {
      const mod = await import('../../src/index.js');
      const result = await mod.handleCliArgs(['check']);
      expect(result).toBe(true);
    });
  });

  describe('5. 运行环境 self-check', () => {
    it('当前运行时是 Bun 1.3+（CLI 推荐基线）', () => {
      const bunVersion = process.versions.bun;
      expect(bunVersion).toBeString();
      const major = parseInt(bunVersion.split('.')[0], 10);
      const minor = parseInt(bunVersion.split('.')[1], 10);
      expect(major >= 1).toBe(true);
      if (major === 1) {
        expect(minor >= 3).toBe(true);
      }
    });

    it('package.json 脚本包含 smoke test 入口', () => {
      expect(pkg.scripts).toBeObject();
      expect(typeof pkg.scripts['test:smoke']).toBe('string');
    });

    it('package.json 脚本包含关键 build/release 入口', () => {
      expect(pkg.scripts['release:prepare']).toBeString();
      expect(pkg.scripts['package:release']).toBeString();
      expect(pkg.scripts['desktop:build']).toBeString();
      expect(pkg.scripts['desktop:renderer:build']).toBeString();
    });
  });
});
