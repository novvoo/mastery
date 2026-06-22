/**
 * Memory Manager - CONTEXT.md based persistent memory
 *
 * 默认存储路径：{workingDir}/CONTEXT.md
 * 可通过 contextDir 参数指定子目录（如 '.agent-memory'）。
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const MAX_CONTEXT_FILE_SIZE = 500 * 1024; // 500KB max CONTEXT.md size
const MAX_SESSION_HISTORY = 50; // 最多保留50个历史会话
const MAX_KEY_DECISIONS = 100; // 最多保留100个关键决策

export class MemoryManager {
  /** @type {string} */
  #contextPath;
  /** @type {string} */
  #workingDir;
  /** @type {object} */
  #context;

  /**
   * @param {string} workingDir
   * @param {string} [contextDir] - 可选，CONTEXT.md 所在子目录（如 '.agent-memory'）
   */
  constructor(workingDir, contextDir = null) {
    this.#workingDir = workingDir;
    const base = contextDir ? join(workingDir, contextDir) : workingDir;
    this.#contextPath = join(base, 'CONTEXT.md');
    this.#context = this.createDefaultContext(workingDir);
  }

  /** @param {string} workingDir @returns {object} */
  createDefaultContext(workingDir) {
    const now = new Date().toISOString().split('T')[0];
    return {
      projectInfo: {
        name: workingDir.split('/').pop() || 'project',
        path: workingDir,
        created: now,
        lastUpdated: now,
      },
      currentTask: {
        status: 'active',
        description: '',
        phase: 'design',
      },
      keyDecisions: [],
      constraints: [],
      fileMap: [],
      sessionHistory: [],
      notes: [],
    };
  }

  async load() {
    // 兼容迁移：如果新路径不存在但旧根路径存在 CONTEXT.md，自动迁移
    if (!existsSync(this.#contextPath)) {
      const legacyPath = join(this.#workingDir, 'CONTEXT.md');
      if (existsSync(legacyPath) && legacyPath !== this.#contextPath) {
        try {
          const content = await readFile(legacyPath, 'utf-8');
          // 确保目标目录存在
          const dir = this.#contextPath.substring(0, this.#contextPath.lastIndexOf('/'));
          if (!existsSync(dir)) { await mkdir(dir, { recursive: true }); }
          await writeFile(this.#contextPath, content, 'utf-8');
          // 不删除旧文件，保持向后兼容
        } catch { /* 迁移失败静默 */ }
      }
    }

    if (existsSync(this.#contextPath)) {
      try {
        const content = await readFile(this.#contextPath, 'utf-8');
        this.#context = this.parseContextMd(content);
      } catch {
        this.#context = this.createDefaultContext(
          this.#context.projectInfo.path
        );
      }
    }
    return this.#context;
  }

  async save() {
    // 修剪过长的历史数据
    this.#pruneContext();
    
    const content = this.toMarkdown();
    
    // 检查文件大小
    if (content.length > MAX_CONTEXT_FILE_SIZE) {
      console.warn(`MemoryManager: CONTEXT.md too large (${content.length} chars), forcing additional pruning`);
      // 进一步修剪
      this.#context.sessionHistory = this.#context.sessionHistory.slice(-10);
      this.#context.keyDecisions = this.#context.keyDecisions.slice(-20);
    }
    
    const dir = this.#contextPath.substring(0, this.#contextPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.#contextPath, this.toMarkdown(), 'utf-8');
    this.#context.projectInfo.lastUpdated = new Date().toISOString().split('T')[0];
  }

  /**
   * 修剪上下文数据以保持合理大小
   */
  #pruneContext() {
    if (this.#context.sessionHistory.length > MAX_SESSION_HISTORY) {
      const removed = this.#context.sessionHistory.length - MAX_SESSION_HISTORY;
      this.#context.sessionHistory = this.#context.sessionHistory.slice(-MAX_SESSION_HISTORY);
      console.warn(`MemoryManager: pruned ${removed} old sessions from history`);
    }
    
    if (this.#context.keyDecisions.length > MAX_KEY_DECISIONS) {
      const removed = this.#context.keyDecisions.length - MAX_KEY_DECISIONS;
      this.#context.keyDecisions = this.#context.keyDecisions.slice(-MAX_KEY_DECISIONS);
      console.warn(`MemoryManager: pruned ${removed} old key decisions`);
    }
  }

  /** @param {string} description @param {string} phase */
  async updateTask(description, phase) {
    this.#context.currentTask.description = description;
    this.#context.currentTask.phase = phase;
    this.#context.currentTask.status = 'active';
    await this.save();
  }

  async completeTask() {
    this.#context.currentTask.status = 'completed';
    await this.save();
  }

  /** @param {string} decision @param {string} reason */
  async addDecision(decision, reason) {
    this.#context.keyDecisions.push({
      decision,
      reason,
      date: new Date().toISOString().split('T')[0],
    });
    await this.save();
  }

  /** @param {string} constraint */
  async addConstraint(constraint) {
    if (!this.#context.constraints.includes(constraint)) {
      this.#context.constraints.push(constraint);
      await this.save();
    }
  }

  /** @param {string} file @param {string} purpose */
  async updateFileMap(file, purpose) {
    const existing = this.#context.fileMap.find(f => f.file === file);
    if (existing) {
      existing.purpose = purpose;
      existing.lastModified = new Date().toISOString().split('T')[0];
    } else {
      this.#context.fileMap.push({
        file,
        purpose,
        lastModified: new Date().toISOString().split('T')[0],
      });
    }
    await this.save();
  }

  /** @param {string} note */
  async addNote(note) {
    this.#context.notes.push(note);
    await this.save();
  }

  async startNewSession() {
    const sessionNum = this.#context.sessionHistory.length + 1;
    this.#context.sessionHistory.push({
      session: sessionNum,
      date: new Date().toISOString().split('T')[0],
      completed: [],
      inProgress: [],
      nextSteps: [],
      openQuestions: [],
    });
    await this.save();
  }

  /**
   * @param {object} updates
   * @param {string[]} [updates.completed]
   * @param {string[]} [updates.inProgress]
   * @param {string[]} [updates.nextSteps]
   * @param {string[]} [updates.openQuestions]
   */
  async updateCurrentSession(updates) {
    const current = this.#context.sessionHistory[this.#context.sessionHistory.length - 1];
    if (current) {
      if (updates.completed) {current.completed = updates.completed;}
      if (updates.inProgress) {current.inProgress = updates.inProgress;}
      if (updates.nextSteps) {current.nextSteps = updates.nextSteps;}
      if (updates.openQuestions) {current.openQuestions = updates.openQuestions;}
    }
    await this.save();
  }

  /** Generate a compact prompt fragment for system prompt injection */
  toPromptFragment() {
    const ctx = this.#context;
    /** @type {string[]} */
    const lines = [];

    lines.push('## Current Project Context');
    lines.push(`- Task: ${ctx.currentTask.description || '(none)'}`);
    lines.push(`- Phase: ${ctx.currentTask.phase}`);
    lines.push(`- Status: ${ctx.currentTask.status}`);

    if (ctx.keyDecisions.length > 0) {
      lines.push('');
      lines.push('### Key Decisions (recent)');
      const recent = ctx.keyDecisions.slice(-5);
      for (const d of recent) {
        lines.push(`- ${d.decision}: ${d.reason}`);
      }
    }

    if (ctx.constraints.length > 0) {
      lines.push('');
      lines.push(`### Active Constraints: ${ctx.constraints.join('; ')}`);
    }

    return lines.join('\n');
  }

  toMarkdown() {
    const ctx = this.#context;
    /** @type {string[]} */
    const lines = [];

    lines.push('# Project Context');
    lines.push('');
    lines.push('## Project Info');
    lines.push(`- **Name**: ${ctx.projectInfo.name}`);
    lines.push(`- **Path**: ${ctx.projectInfo.path}`);
    lines.push(`- **Created**: ${ctx.projectInfo.created}`);
    lines.push(`- **Last Updated**: ${ctx.projectInfo.lastUpdated}`);
    lines.push('');
    lines.push('## Current Task');
    lines.push(`- **Status**: ${ctx.currentTask.status}`);
    lines.push(`- **Description**: ${ctx.currentTask.description || '(none)'}`);
    lines.push(`- **Phase**: ${ctx.currentTask.phase}`);

    if (ctx.keyDecisions.length > 0) {
      lines.push('');
      lines.push('## Key Decisions');
      lines.push('| Decision | Reason | Date |');
      lines.push('|----------|--------|------|');
      for (const d of ctx.keyDecisions) {
        lines.push(`| ${d.decision} | ${d.reason} | ${d.date} |`);
      }
    }

    if (ctx.constraints.length > 0) {
      lines.push('');
      lines.push('## Active Constraints');
      for (const c of ctx.constraints) {
        lines.push(`- ${c}`);
      }
    }

    if (ctx.fileMap.length > 0) {
      lines.push('');
      lines.push('## File Map');
      lines.push('| File | Purpose | Last Modified |');
      lines.push('|------|---------|---------------|');
      for (const f of ctx.fileMap) {
        lines.push(`| ${f.file} | ${f.purpose} | ${f.lastModified} |`);
      }
    }

    if (ctx.sessionHistory.length > 0) {
      lines.push('');
      lines.push('## Session History');
      for (const s of ctx.sessionHistory) {
        lines.push(`### Session ${s.session} - ${s.date}`);
        if (s.completed.length > 0) {lines.push(`- Completed: ${s.completed.join(', ')}`);}
        if (s.inProgress.length > 0) {lines.push(`- In Progress: ${s.inProgress.join(', ')}`);}
        if (s.nextSteps.length > 0) {lines.push(`- Next Steps: ${s.nextSteps.join(', ')}`);}
        if (s.openQuestions.length > 0) {lines.push(`- Open Questions: ${s.openQuestions.join(', ')}`);}
      }
    }

    if (ctx.notes.length > 0) {
      lines.push('');
      lines.push('## Important Notes');
      for (const n of ctx.notes) {
        lines.push(`- ${n}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /** @param {string} content @returns {object} */
  parseContextMd(content) {
    // Simple parser - in production, use a proper markdown parser
    const ctx = this.createDefaultContext(this.#workingDir);

    const taskMatch = content.match(/- \*\*Description\*\*: (.+)/);
    if (taskMatch) {ctx.currentTask.description = taskMatch[1];}

    const phaseMatch = content.match(/- \*\*Phase\*\*: (\w+)/);
    if (phaseMatch) {ctx.currentTask.phase = phaseMatch[1];}

    const statusMatch = content.match(/- \*\*Status\*\*: (\w+)/);
    if (statusMatch) {ctx.currentTask.status = statusMatch[1];}

    // Parse constraints
    const constraintSection = content.match(/## Active Constraints\n([\s\S]*?)(?=\n## |$)/);
    if (constraintSection) {
      const items = constraintSection[1].match(/^- (.+)$/gm);
      if (items) {ctx.constraints = items.map(i => i.replace(/^- /, ''));}
    }

    // Parse notes
    const notesSection = content.match(/## Important Notes\n([\s\S]*?)(?=\n## |$)/);
    if (notesSection) {
      const items = notesSection[1].match(/^- (.+)$/gm);
      if (items) {ctx.notes = items.map(i => i.replace(/^- /, ''));}
    }

    return ctx;
  }

  getContext() {
    return this.#context;
  }

  getContextPath() {
    return this.#contextPath;
  }
}
