/**
 * AgentMemory - 生产级记忆系统
 * 
 * 设计参考 Claude Code 的记忆系统理念：
 * 1. WorkingContext - 当前工作上下文（文件、任务、决策）
 * 2. ProjectMemory - 项目持久化记忆（结构、规范、依赖）
 * 3. SessionMemory - 会话记忆（历史、摘要）
 * 4. PatternLearning - 模式学习（成功/失败经验）
 * 
 * 核心理念：
 * - 实用优先：不是三层玄学，而是真正有用的信息
 * - 深度集成：记忆与 Agent 工作流紧密集成
 * - 自动管理：自动追踪重要信息，减少手动维护
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { glob } from 'glob';
import { randomUUID } from 'crypto';

/**
 * 工作上下文 - 追踪当前工作状态
 */
export class WorkingContext {
  #context;
  #filePath;
  #dirty;

  constructor(workingDir) {
    this.#filePath = join(workingDir, '.agent-data', 'working-context.json');
    this.#context = this.createDefault();
    this.#dirty = false;
    this.load();
  }

  createDefault() {
    return {
      activeFiles: [],           // 当前活跃的文件
      recentFiles: [],            // 最近访问的文件（带时间戳）
      currentTask: null,          // 当前任务描述
      taskPhase: 'initial',       // 设计/实现/测试/部署
      keyDecisions: [],           // 关键决策
      constraints: [],            // 约束条件
      lastUpdated: new Date().toISOString(),
    };
  }

  load() {
    try {
      if (existsSync(this.#filePath)) {
        const data = readFileSync(this.#filePath, 'utf-8');
        const loaded = JSON.parse(data);
        // 合并加载的数据，但保留默认值
        this.#context = {
          ...this.createDefault(),
          ...loaded,
          lastUpdated: new Date().toISOString(),
        };
        // 清理太旧的 recentFiles
        this.cleanOldFiles();
      }
    } catch (error) {
      console.error('Failed to load working context:', error.message);
    }
  }

  save() {
    if (!this.#dirty) return;
    try {
      const dir = resolve(this.#filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.#context.lastUpdated = new Date().toISOString();
      writeFileSync(this.#filePath, JSON.stringify(this.#context, null, 2), 'utf-8');
      this.#dirty = false;
    } catch (error) {
      console.error('Failed to save working context:', error.message);
    }
  }

  /**
   * 追踪访问的文件
   */
  trackFile(filePath) {
    const now = Date.now();
    const entry = { path: filePath, timestamp: now };

    // 更新 recentFiles（保持最近 50 个）
    this.#context.recentFiles = this.#context.recentFiles.filter(f => f.path !== filePath);
    this.#context.recentFiles.unshift(entry);
    if (this.#context.recentFiles.length > 50) {
      this.#context.recentFiles.length = 50;
    }

    // 更新 activeFiles（如果是重要文件）
    if (!this.#context.activeFiles.includes(filePath)) {
      this.#context.activeFiles.push(filePath);
      if (this.#context.activeFiles.length > 20) {
        this.#context.activeFiles.shift();
      }
    }

    this.#dirty = true;
    this.save();
  }

  /**
   * 设置当前任务
   */
  setTask(task, phase = 'initial') {
    this.#context.currentTask = task;
    this.#context.taskPhase = phase;
    this.#dirty = true;
    this.save();
  }

  /**
   * 添加关键决策
   */
  addDecision(decision, reason) {
    this.#context.keyDecisions.push({
      id: randomUUID(),
      decision,
      reason,
      timestamp: new Date().toISOString(),
    });
    // 保持最近 20 个决策
    if (this.#context.keyDecisions.length > 20) {
      this.#context.keyDecisions.shift();
    }
    this.#dirty = true;
    this.save();
  }

  /**
   * 添加约束
   */
  addConstraint(constraint) {
    if (!this.#context.constraints.includes(constraint)) {
      this.#context.constraints.push(constraint);
      this.#dirty = true;
      this.save();
    }
  }

  /**
   * 移除约束
   */
  removeConstraint(constraint) {
    const index = this.#context.constraints.indexOf(constraint);
    if (index > -1) {
      this.#context.constraints.splice(index, 1);
      this.#dirty = true;
      this.save();
    }
  }

  /**
   * 清理太旧的文件记录（超过 7 天）
   */
  cleanOldFiles() {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.#context.recentFiles = this.#context.recentFiles.filter(f => f.timestamp > sevenDaysAgo);
  }

  /**
   * 生成上下文提示
   */
  toPromptFragment() {
    const lines = [];
    
    if (this.#context.currentTask) {
      lines.push(`Current Task: ${this.#context.currentTask}`);
      lines.push(`Phase: ${this.#context.taskPhase}`);
    }

    if (this.#context.keyDecisions.length > 0) {
      lines.push('');
      lines.push('Key Decisions:');
      const recent = this.#context.keyDecisions.slice(-5);
      for (const d of recent) {
        lines.push(`- ${d.decision} (${d.reason})`);
      }
    }

    if (this.#context.constraints.length > 0) {
      lines.push('');
      lines.push(`Constraints: ${this.#context.constraints.join(', ')}`);
    }

    if (this.#context.activeFiles.length > 0) {
      lines.push('');
      lines.push(`Active Files: ${this.#context.activeFiles.slice(-5).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取完整上下文
   */
  getContext() {
    return { ...this.#context };
  }

  /**
   * 清除所有上下文
   */
  clear() {
    this.#context = this.createDefault();
    this.#dirty = true;
    this.save();
  }
}

/**
 * 项目记忆 - 持久化的项目知识
 */
export class ProjectMemory {
  #memory;
  #filePath;
  #workingDir;
  #dirty;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#filePath = join(workingDir, '.agent-data', 'project-memory.json');
    this.#memory = this.createDefault(workingDir);
    this.#dirty = false;
    this.load();
  }

  createDefault(workingDir) {
    return {
      projectName: workingDir.split('/').pop() || 'project',
      projectPath: workingDir,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      
      // 项目结构
      structure: {
        language: null,
        framework: null,
        packageManager: null,
        hasTests: false,
        hasDocs: false,
        hasCI: false,
      },
      
      // 技术栈
      techStack: [],
      dependencies: [],
      
      // 文件映射（文件 -> 用途）
      fileMap: [],
      
      // 编码规范
      conventions: [],
      
      // 项目特定的模式
      patterns: [],
      
      // 已知的入口点
      entryPoints: [],
      
      // API 端点
      apiEndpoints: [],
    };
  }

  load() {
    try {
      if (existsSync(this.#filePath)) {
        const data = readFileSync(this.#filePath, 'utf-8');
        const loaded = JSON.parse(data);
        this.#memory = {
          ...this.createDefault(this.#workingDir),
          ...loaded,
          lastUpdated: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error('Failed to load project memory:', error.message);
    }
  }

  save() {
    if (!this.#dirty) return;
    try {
      const dir = resolve(this.#filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.#memory.lastUpdated = new Date().toISOString();
      writeFileSync(this.#filePath, JSON.stringify(this.#memory, null, 2), 'utf-8');
      this.#dirty = false;
    } catch (error) {
      console.error('Failed to save project memory:', error.message);
    }
  }

  /**
   * 自动探索项目结构
   */
  async explore() {
    try {
      // 检测语言和框架
      const packageJson = join(this.#workingDir, 'package.json');
      if (existsSync(packageJson)) {
        const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
        this.updateStructure({
          language: 'javascript',
          framework: pkg.dependencies?.react ? 'react' : 
                     pkg.dependencies?.vue ? 'vue' :
                     pkg.dependencies?.next ? 'next' : null,
          packageManager: 'npm',
          hasTests: existsSync(join(this.#workingDir, 'test')) || 
                   existsSync(join(this.#workingDir, 'tests')) ||
                   pkg.scripts?.test,
        });
        
        // 更新依赖
        this.#memory.dependencies = Object.keys({
          ...pkg.dependencies,
          ...pkg.devDependencies,
        }).slice(0, 30); // 只保留前 30 个主要依赖
        
        // 更新 techStack
        this.#memory.techStack = Object.keys(pkg.dependencies || {}).slice(0, 20);
      }

      // 检测测试目录
      this.updateStructure({
        hasTests: existsSync(join(this.#workingDir, 'test')) ||
                 existsSync(join(this.#workingDir, 'tests')) ||
                 existsSync(join(this.#workingDir, '__tests__')),
        hasDocs: existsSync(join(this.#workingDir, 'docs')) ||
                existsSync(join(this.#workingDir, 'doc')),
        hasCI: existsSync(join(this.#workingDir, '.github/workflows')) ||
              existsSync(join(this.#workingDir, '.gitlab-ci.yml')) ||
              existsSync(join(this.#workingDir, '.circleci')),
      });

      // 探索入口点
      await this.findEntryPoints();

      this.#dirty = true;
      this.save();
    } catch (error) {
      console.error('Failed to explore project:', error.message);
    }
  }

  /**
   * 查找入口点
   */
  async findEntryPoints() {
    const patterns = [
      'src/index.{js,ts,jsx,tsx}',
      'src/main.{js,ts,jsx,tsx}',
      'src/app.{js,ts,jsx,tsx}',
      'index.{js,ts,jsx,tsx}',
      'main.{js,ts,jsx,tsx}',
      'App.{js,ts,jsx,tsx}',
    ];

    const entryPoints = [];
    for (const pattern of patterns) {
      const files = await glob(pattern, { cwd: this.#workingDir, absolute: true });
      entryPoints.push(...files.map(f => relative(this.#workingDir, f)));
    }

    this.#memory.entryPoints = [...new Set(entryPoints)].slice(0, 10);
  }

  /**
   * 更新项目结构
   */
  updateStructure(structure) {
    this.#memory.structure = { ...this.#memory.structure, ...structure };
    this.#dirty = true;
    this.save();
  }

  /**
   * 添加文件映射
   */
  addFileMapping(file, purpose, type = 'general') {
    const existing = this.#memory.fileMap.find(f => f.file === file);
    if (existing) {
      existing.purpose = purpose;
      existing.lastUsed = new Date().toISOString();
    } else {
      this.#memory.fileMap.push({
        file,
        purpose,
        type,
        lastUsed: new Date().toISOString(),
        addedAt: new Date().toISOString(),
      });
    }
    // 保持文件映射数量合理
    if (this.#memory.fileMap.length > 100) {
      this.#memory.fileMap.shift();
    }
    this.#dirty = true;
    this.save();
  }

  /**
   * 添加编码规范
   */
  addConvention(convention) {
    if (!this.#memory.conventions.find(c => c.text === convention)) {
      this.#memory.conventions.push({
        text: convention,
        addedAt: new Date().toISOString(),
      });
      this.#dirty = true;
      this.save();
    }
  }

  /**
   * 添加项目模式
   */
  addPattern(pattern, success = true) {
    this.#memory.patterns.push({
      pattern,
      success,
      timestamp: new Date().toISOString(),
    });
    // 保持模式数量合理
    if (this.#memory.patterns.length > 50) {
      this.#memory.patterns.shift();
    }
    this.#dirty = true;
    this.save();
  }

  /**
   * 添加 API 端点
   */
  addApiEndpoint(method, path, description) {
    const key = `${method}:${path}`;
    if (!this.#memory.apiEndpoints.find(e => `${e.method}:${e.path}` === key)) {
      this.#memory.apiEndpoints.push({
        method: method.toUpperCase(),
        path,
        description,
        addedAt: new Date().toISOString(),
      });
      this.#dirty = true;
      this.save();
    }
  }

  /**
   * 生成项目上下文提示
   */
  toPromptFragment() {
    const lines = [];
    
    lines.push(`Project: ${this.#memory.projectName}`);
    
    if (this.#memory.structure.framework) {
      lines.push(`Framework: ${this.#memory.structure.framework}`);
    }
    
    if (this.#memory.techStack.length > 0) {
      lines.push(`Tech Stack: ${this.#memory.techStack.slice(0, 10).join(', ')}`);
    }

    if (this.#memory.conventions.length > 0) {
      lines.push('');
      lines.push('Coding Conventions:');
      for (const c of this.#memory.conventions.slice(-5)) {
        lines.push(`- ${c.text}`);
      }
    }

    if (this.#memory.entryPoints.length > 0) {
      lines.push('');
      lines.push(`Entry Points: ${this.#memory.entryPoints.join(', ')}`);
    }

    if (this.#memory.apiEndpoints.length > 0) {
      lines.push('');
      lines.push('API Endpoints:');
      for (const e of this.#memory.apiEndpoints.slice(-5)) {
        lines.push(`- ${e.method} ${e.path}: ${e.description}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取完整记忆
   */
  getMemory() {
    return { ...this.#memory };
  }

  /**
   * 清除所有记忆
   */
  clear() {
    this.#memory = this.createDefault(this.#workingDir);
    this.#dirty = true;
    this.save();
  }
}

/**
 * 模式学习 - 从成功和失败中学习
 */
export class PatternLearning {
  #patterns;
  #filePath;
  #dirty;

  constructor(workingDir) {
    this.#filePath = join(workingDir, '.agent-data', 'patterns.json');
    this.#patterns = {
      successes: [],
      failures: [],
      antiPatterns: [],
    };
    this.#dirty = false;
    this.load();
  }

  load() {
    try {
      if (existsSync(this.#filePath)) {
        const data = readFileSync(this.#filePath, 'utf-8');
        this.#patterns = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load patterns:', error.message);
    }
  }

  save() {
    if (!this.#dirty) return;
    try {
      const dir = resolve(this.#filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.#filePath, JSON.stringify(this.#patterns, null, 2), 'utf-8');
      this.#dirty = false;
    } catch (error) {
      console.error('Failed to save patterns:', error.message);
    }
  }

  /**
   * 记录成功模式
   */
  recordSuccess(pattern, context = '', tool = null) {
    this.#patterns.successes.push({
      id: randomUUID(),
      pattern,
      context,
      tool,
      timestamp: new Date().toISOString(),
      usageCount: 0,
    });
    this.cleanOld();
    this.#dirty = true;
    this.save();
  }

  /**
   * 记录失败模式
   */
  recordFailure(pattern, reason = '', tool = null) {
    this.#patterns.failures.push({
      id: randomUUID(),
      pattern,
      reason,
      tool,
      timestamp: new Date().toISOString(),
    });
    this.cleanOld();
    this.#dirty = true;
    this.save();
  }

  /**
   * 记录反模式
   */
  recordAntiPattern(pattern, reason = '') {
    this.#patterns.antiPatterns.push({
      id: randomUUID(),
      pattern,
      reason,
      timestamp: new Date().toISOString(),
    });
    this.cleanOld();
    this.#dirty = true;
    this.save();
  }

  /**
   * 标记模式被使用
   */
  markUsed(patternId) {
    const success = this.#patterns.successes.find(p => p.id === patternId);
    if (success) {
      success.usageCount++;
      this.#dirty = true;
      this.save();
    }
  }

  /**
   * 清理太旧的模式（超过 90 天）
   */
  cleanOld() {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    
    // 清理旧的成功模式（保留成功的）
    this.#patterns.successes = this.#patterns.successes
      .filter(p => new Date(p.timestamp).getTime() > ninetyDaysAgo || p.usageCount > 2)
      .slice(-50);

    // 清理旧的失败模式
    this.#patterns.failures = this.#patterns.failures
      .filter(p => new Date(p.timestamp).getTime() > ninetyDaysAgo)
      .slice(-30);

    // 清理旧的反模式
    this.#patterns.antiPatterns = this.#patterns.antiPatterns
      .filter(p => new Date(p.timestamp).getTime() > ninetyDaysAgo)
      .slice(-20);
  }

  /**
   * 获取相关模式
   */
  getRelevantPatterns(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    // 查找相关的成功模式
    for (const p of this.#patterns.successes) {
      if (p.pattern.toLowerCase().includes(queryLower) ||
          p.context.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'success',
          pattern: p.pattern,
          context: p.context,
          usageCount: p.usageCount,
          id: p.id,
        });
      }
    }

    // 查找相关的失败模式
    for (const p of this.#patterns.failures) {
      if (p.pattern.toLowerCase().includes(queryLower) ||
          p.reason.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'failure',
          pattern: p.pattern,
          reason: p.reason,
          id: p.id,
        });
      }
    }

    // 查找相关的反模式
    for (const p of this.#patterns.antiPatterns) {
      if (p.pattern.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'antiPattern',
          pattern: p.pattern,
          reason: p.reason,
          id: p.id,
        });
      }
    }

    return results;
  }

  /**
   * 生成模式提示
   */
  toPromptFragment(query = '') {
    if (!query) {
      // 返回最近的成功模式
      if (this.#patterns.successes.length === 0) return '';
      
      const lines = ['[Learned Patterns]'];
      const recent = this.#patterns.successes.slice(-3);
      for (const p of recent) {
        lines.push(`- ✅ ${p.pattern} (used ${p.usageCount} times)`);
      }
      return lines.join('\n');
    }

    const relevant = this.getRelevantPatterns(query);
    if (relevant.length === 0) return '';

    const lines = ['[Relevant Patterns]'];
    for (const p of relevant.slice(0, 5)) {
      if (p.type === 'success') {
        lines.push(`✅ ${p.pattern}`);
      } else if (p.type === 'failure') {
        lines.push(`❌ ${p.pattern} - ${p.reason}`);
      } else {
        lines.push(`⚠️  Avoid: ${p.pattern}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      successes: this.#patterns.successes.length,
      failures: this.#patterns.failures.length,
      antiPatterns: this.#patterns.antiPatterns.length,
    };
  }

  /**
   * 清除所有模式
   */
  clear() {
    this.#patterns = { successes: [], failures: [], antiPatterns: [] };
    this.#dirty = true;
    this.save();
  }
}

/**
 * 主入口 - AgentMemory 整合所有记忆系统
 */
export class AgentMemory {
  #workingContext;
  #projectMemory;
  #patternLearning;
  #workingDir;
  #initialized;

  constructor(workingDir) {
    this.#workingDir = workingDir;
    this.#workingContext = new WorkingContext(workingDir);
    this.#projectMemory = new ProjectMemory(workingDir);
    this.#patternLearning = new PatternLearning(workingDir);
    this.#initialized = false;
  }

  /**
   * 初始化记忆系统
   */
  async initialize() {
    if (this.#initialized) return;
    
    // 探索项目结构
    await this.#projectMemory.explore();
    this.#initialized = true;
  }

  /**
   * 获取所有记忆用于系统提示
   */
  getMemoryContext(currentTask = '') {
    const parts = [];

    // 1. 项目记忆
    const projectContext = this.#projectMemory.toPromptFragment();
    if (projectContext) {
      parts.push(projectContext);
    }

    // 2. 工作上下文
    const workingContext = this.#workingContext.toPromptFragment();
    if (workingContext) {
      parts.push(workingContext);
    }

    // 3. 相关模式
    const patternContext = this.#patternLearning.toPromptFragment(currentTask);
    if (patternContext) {
      parts.push(patternContext);
    }

    return parts.join('\n\n');
  }

  /**
   * 追踪文件访问
   */
  trackFile(filePath) {
    this.#workingContext.trackFile(filePath);
    this.#projectMemory.addFileMapping(filePath, 'active');
  }

  /**
   * 设置当前任务
   */
  setTask(task, phase) {
    this.#workingContext.setTask(task, phase);
  }

  /**
   * 添加决策
   */
  addDecision(decision, reason) {
    this.#workingContext.addDecision(decision, reason);
    this.#projectMemory.addPattern(`Decision: ${decision}`, true);
  }

  /**
   * 添加约束
   */
  addConstraint(constraint) {
    this.#workingContext.addConstraint(constraint);
  }

  /**
   * 记录成功
   */
  recordSuccess(pattern, context = '', tool = null) {
    this.#patternLearning.recordSuccess(pattern, context, tool);
  }

  /**
   * 记录失败
   */
  recordFailure(pattern, reason = '', tool = null) {
    this.#patternLearning.recordFailure(pattern, reason, tool);
  }

  /**
   * 添加编码规范
   */
  addConvention(convention) {
    this.#projectMemory.addConvention(convention);
  }

  /**
   * 添加 API 端点
   */
  addApiEndpoint(method, path, description) {
    this.#projectMemory.addApiEndpoint(method, path, description);
  }

  /**
   * 获取工作上下文
   */
  getWorkingContext() {
    return this.#workingContext.getContext();
  }

  /**
   * 获取项目记忆
   */
  getProjectMemory() {
    return this.#projectMemory.getMemory();
  }

  /**
   * 获取模式统计
   */
  getPatternStats() {
    return this.#patternLearning.getStats();
  }

  /**
   * 清除所有记忆
   */
  clearAll() {
    this.#workingContext.clear();
    this.#projectMemory.clear();
    this.#patternLearning.clear();
  }
}

export default AgentMemory;
