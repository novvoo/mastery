/**
 * MemoryAudit — 记忆健康检查与审计 CLI
 *
 * 功能：
 *   - 全面审计所有记忆条目（有效性、新鲜度、矛盾）
 *   - Git-aware stale 检测
 *   - 矛盾检测 & 合并建议
 *   - Token 预算统计
 *   - 自动清理陈旧/重复记忆
 *   - 生成审计报告
 */

import { join } from 'path';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { MemoryVerifier, MemoryProvenance, GitDiffStaleDetector } from './memory-verifier.js';
import { MemoryType } from './memory-types.js';

export class MemoryAudit {
  /**
   * @param {object} opts
   * @param {string} opts.workingDirectory   项目根目录
   * @param {object} [opts.structuredMemory] StructuredMemory 实例
   * @param {object} [opts.logger]           日志输出函数（console.log）
   */
  constructor(opts = {}) {
    this.workingDir = opts.workingDirectory || process.cwd();
    this.structuredMemory = opts.structuredMemory || null;
    this.logger = opts.logger || console.log;
    this.verifier = new MemoryVerifier(this.workingDir);
    this.staleDetector = new GitDiffStaleDetector(this.workingDir);

    /** @type {AuditReport} */
    this.lastReport = null;
  }

  /**
   * 运行完整审计。
   * @param {object} [opts]
   * @param {boolean} [opts.fullVerification=true]  文件引用验证
   * @param {boolean} [opts.detectStale=true]        Git diff stale 检测
   * @param {boolean} [opts.detectContradictions=true] 矛盾检测
   * @param {boolean} [opts.compactDuplicate=true]   自动压缩重复条目
   * @param {boolean} [opts.autoClean=false]         自动清理（不询问）
   * @returns {Promise<AuditReport>}
   */
  async runAudit(opts = {}) {
    const {
      fullVerification = true,
      detectStale = true,
      detectContradictions = true,
      compactDuplicate = true,
      autoClean = false,
    } = opts;

    const report = {
      timestamp: Date.now(),
      summary: { total: 0, valid: 0, stale: 0, expired: 0, conflicting: 0, duplicate: 0 },
      details: [],
      contradictions: [],
      staleEntries: [],
      duplicateEntries: [],
      removedIds: [],
      recommendations: [],
    };

    // 1) 收集所有记忆条目
    const entries = this._collectEntries();
    report.summary.total = entries.length;
    if (entries.length === 0) {
      this.logger('📋 No memory entries found.');
      this.lastReport = report;
      return report;
    }

    this.logger(`🔍 Auditing ${entries.length} memory entries...`);

    // 2) 全量验证（检查文件引用、过期）
    if (fullVerification) {
      const results = await this.verifier.verifyAll(entries);
      for (const r of results.results) {
        if (r.stale) {
          report.staleEntries.push({
            id: r.id || r.entryId,
            title: r.title,
            reason: r.message || 'Source changed',
          });
        }
      }
      report.summary.valid = results.valid || 0;
      report.summary.stale = results.stale || 0;
      this.logger(`   ├─ Valid: ${report.summary.valid}, Stale: ${report.summary.stale}`);
    }

    // 3) Git diff driven stale detection
    if (detectStale && entries.length > 0) {
      const gitStaleIds = this._detectGitDiffStale(entries);
      for (const id of gitStaleIds) {
        if (!report.staleEntries.find((s) => s.id === id)) {
          const entry = entries.find((e) => e.id === id);
          report.staleEntries.push({
            id,
            title: entry?.title || 'unknown',
            reason: 'Git diff: source file changed',
          });
        }
      }
      report.summary.stale = report.staleEntries.length;
      this.logger(`   ├─ Git-aware stale: ${gitStaleIds.length} found`);
    }

    // 4) 矛盾检测
    if (detectContradictions) {
      const { contradictions } = MemoryVerifier.detectContradictions(entries);
      report.contradictions = contradictions;
      report.summary.conflicting = contradictions.length;
      if (contradictions.length > 0) {
        this.logger(`   ├─ Contradictions: ${contradictions.length}`);
        for (const c of contradictions) {
          report.details.push({
            type: 'contradiction',
            severity: 'warning',
            message: `[${c.topic}] ${c.reason}: "${c.a.title}" vs "${c.b.title}"`,
          });
        }
      }
    }

    // 5) 重复条目检测 & 压缩
    if (compactDuplicate) {
      const { merged, removedIds } = MemoryVerifier.compact(entries);
      report.duplicateEntries = removedIds;
      report.summary.duplicate = removedIds.length;
      if (removedIds.length > 0) {
        this.logger(`   ├─ Duplicates: ${removedIds.length} (compacted to ${merged.length})`);
        for (const id of removedIds) {
          report.details.push({
            type: 'duplicate',
            severity: 'info',
            message: `Duplicate entry: ${id}`,
          });
        }
      }
    }

    // 6) 过期检测
    let expiredCount = 0;
    for (const entry of entries) {
      if (typeof entry.isExpired === 'function' ? entry.isExpired() : false) {
        expiredCount++;
        report.details.push({
          type: 'expired',
          severity: 'info',
          message: `Expired: ${entry.title || entry.id}`,
        });
      }
    }
    report.summary.expired = expiredCount;
    if (expiredCount > 0) {
      this.logger(`   ├─ Expired: ${expiredCount}`);
    }

    // 7) 自动清理或生成建议
    if (autoClean) {
      const cleaned = this._autoClean(report);
      report.removedIds = cleaned;
      this.logger(`   └─ Auto-cleaned: ${cleaned.length} entries`);
    } else {
      this._generateRecommendations(report);
      if (report.recommendations.length > 0) {
        this.logger(`   ├─ Recommendations: ${report.recommendations.length}`);
        for (const rec of report.recommendations) {
          this.logger(`   │  ${rec.action}: ${rec.reason}`);
        }
      }
    }

    // 8) 统计记忆目录磁盘使用量
    report.diskUsage = this._getDiskUsage();

    this.logger(
      `\n📊 Audit Summary: ${report.summary.total} total, ${report.summary.valid} valid, ${report.summary.stale} stale, ${report.summary.conflicting} conflicts, ${report.summary.duplicate} duplicates`,
    );
    if (report.diskUsage) {
      this.logger(
        `💾 Disk usage: ${this._formatSize(report.diskUsage.totalBytes)} (${report.diskUsage.fileCount} files)`,
      );
    }

    this.lastReport = report;
    return report;
  }

  /**
   * 生成健康分数（0-100）。
   * @returns {{ score: number, grade: string, issues: string[] }}
   */
  getHealthScore() {
    const report = this.lastReport;
    if (!report) {
      return { score: 100, grade: 'A', issues: [] };
    }

    const { summary } = report;
    const total = summary.total || 1;
    const stalePenalty = (summary.stale / total) * 30;
    const conflictPenalty = (summary.conflicting / total) * 20;
    const duplicatePenalty = (summary.duplicate / total) * 15;
    const expiredPenalty = (summary.expired / total) * 10;

    const score = Math.max(
      0,
      Math.round(100 - stalePenalty - conflictPenalty - duplicatePenalty - expiredPenalty),
    );
    const grade =
      score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    const issues = [];
    if (summary.stale > 0) {
      issues.push(`${summary.stale} stale entries`);
    }
    if (summary.conflicting > 0) {
      issues.push(`${summary.conflicting} contradictions`);
    }
    if (summary.duplicate > 0) {
      issues.push(`${summary.duplicate} duplicates`);
    }
    if (summary.expired > 0) {
      issues.push(`${summary.expired} expired entries`);
    }

    return { score, grade, issues };
  }

  /**
   * 生成 Markdown 审计报告。
   * @returns {string}
   */
  generateMarkdownReport() {
    const report = this.lastReport;
    if (!report) {
      return '# Memory Audit Report\n\nNo audit has been run yet.';
    }

    const health = this.getHealthScore();
    const healthBar = this._renderHealthBar(health.score);
    const validPct =
      report.summary.total > 0
        ? (((report.summary.valid || 0) / report.summary.total) * 100).toFixed(1)
        : '100.0';

    const lines = [
      '# 📋 Memory Audit Report',
      '',
      `**Date:** ${new Date(report.timestamp).toISOString()}`,
      '',
      `## Health: ${health.score}/100 (${health.grade})`,
      '',
      `\`\`\``,
      healthBar,
      `\`\`\``,
      '',
      `**Valid:** ${validPct}% of ${report.summary.total} entries are healthy`,
      '',
      '## Summary',
      '',
      `| Metric | Count | % | Status |`,
      `|--------|-------|---|--------|`,
      `| Total | ${report.summary.total} | 100% | 📊 |`,
      `| Valid | ${report.summary.valid} | ${validPct}% | ✅ |`,
      `| Stale | ${report.summary.stale} | ${((report.summary.stale / Math.max(1, report.summary.total)) * 100).toFixed(1)}% | ${report.summary.stale > 0 ? '⚠️' : '✅'} |`,
      `| Expired | ${report.summary.expired} | ${((report.summary.expired / Math.max(1, report.summary.total)) * 100).toFixed(1)}% | ${report.summary.expired > 0 ? '⏰' : '✅'} |`,
      `| Conflicting | ${report.summary.conflicting} | ${((report.summary.conflicting / Math.max(1, report.summary.total)) * 100).toFixed(1)}% | ${report.summary.conflicting > 0 ? '🔴' : '✅'} |`,
      `| Duplicates | ${report.summary.duplicate} | ${((report.summary.duplicate / Math.max(1, report.summary.total)) * 100).toFixed(1)}% | ${report.summary.duplicate > 0 ? '🔄' : '✅'} |`,
      '',
    ];

    if (report.diskUsage && report.diskUsage.totalBytes > 0) {
      lines.push(
        `💾 **Disk:** ${this._formatSize(report.diskUsage.totalBytes)} (${report.diskUsage.fileCount} files)`,
      );
      lines.push('');
    }

    if (health.issues.length > 0) {
      lines.push('## Issues');
      lines.push('');
      for (const issue of health.issues) {
        lines.push(`- 🔴 ${issue}`);
      }
      lines.push('');
    }

    if (report.contradictions.length > 0) {
      lines.push('## Contradictions');
      lines.push('');
      for (const c of report.contradictions) {
        lines.push(`- **${c.topic || 'general'}**: ${c.reason}`);
        lines.push(`  - A: \`${c.a?.title || '?'}\``);
        lines.push(`  - B: \`${c.b?.title || '?'}\``);
      }
      lines.push('');
    }

    if (report.staleEntries.length > 0) {
      lines.push('## Stale Entries');
      lines.push('');
      for (const s of report.staleEntries) {
        lines.push(`- \`${s.id}\`: **${s.title}** — ${s.reason}`);
      }
      lines.push('');
    }

    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      for (const rec of report.recommendations) {
        const sev = rec.severity === 'critical' ? '🔴' : rec.severity === 'warning' ? '🟡' : '🔵';
        lines.push(`- ${sev} **${rec.action}**: ${rec.reason}`);
        if (rec.fix) {
          lines.push(`  → Fix: ${rec.fix}`);
        }
      }
      lines.push('');
    }

    if (report.removedIds?.length > 0) {
      lines.push('## Cleaned');
      lines.push('');
      lines.push(`Auto-cleaned ${report.removedIds.length} entries during audit.`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 渲染 ASCII 健康度进度条。
   * @private
   */
  _renderHealthBar(score) {
    const filled = Math.round(score / 5);
    const empty = 20 - filled;
    const color = score >= 90 ? '🟢' : score >= 70 ? '🟡' : score >= 50 ? '🟠' : '🔴';
    return `${color} [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${score}%`;
  }

  /**
   * 保存 Markdown 报告到文件。
   * @param {string} [filePath]
   */
  saveReport(filePath) {
    const dest = filePath || join(this.workingDir, '.agent-memory', 'audit-report.md');
    const content = this.generateMarkdownReport();
    writeFileSync(dest, content, 'utf-8');
    return dest;
  }

  // ── 私有方法 ───────────────────────────────────────────────────────

  _collectEntries() {
    if (this.structuredMemory) {
      return this.structuredMemory.getAll();
    }

    // Fallback: 从文件系统扫描 .agent-memory/entries/
    const entriesDir = join(this.workingDir, '.agent-memory', 'entries');
    if (!existsSync(entriesDir)) {
      return [];
    }

    const entries = [];
    try {
      for (const f of readdirSync(entriesDir)) {
        if (!f.endsWith('.md')) {
          continue;
        }
        try {
          const content = readFileSync(join(entriesDir, f), 'utf-8');
          const frontmatter = this._parseFrontmatter(content);
          entries.push({
            id: f.replace('.md', ''),
            ...frontmatter,
            content: content.replace(/^---[\s\S]*?---\s*/, ''),
          });
        } catch {
          /* skip unreadable */
        }
      }
    } catch {
      /* skip */
    }
    return entries;
  }

  _parseFrontmatter(markdown) {
    const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      return {};
    }
    const result = {};
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0) {
        const key = line.substring(0, colonIdx).trim();
        let val = line.substring(colonIdx + 1).trim();
        if (val === 'true') {
          val = true;
        } else if (val === 'false') {
          val = false;
        } else if (/^\d+$/.test(val)) {
          val = parseInt(val, 10);
        }
        result[key] = val;
      }
    }
    return result;
  }

  _detectGitDiffStale(entries) {
    try {
      const { changedFiles } = this.staleDetector.getChangedFiles();
      if (!changedFiles || changedFiles.length === 0) {
        return [];
      }
      return this.staleDetector.findStaleMemories(changedFiles, entries);
    } catch {
      return [];
    }
  }

  _autoClean(report) {
    const removed = [];

    // 清理过期条目
    for (const d of report.details) {
      if (d.type === 'expired' && this.structuredMemory) {
        const id = d.message.replace('Expired: ', '');
        try {
          this.structuredMemory.delete(id);
          removed.push(id);
        } catch {}
      }
    }

    // 清理重复条目
    for (const id of report.duplicateEntries) {
      if (this.structuredMemory) {
        try {
          this.structuredMemory.delete(id);
          removed.push(id);
        } catch {}
      }
    }

    return removed;
  }

  _generateRecommendations(report) {
    const recs = report.recommendations;
    recs.length = 0;

    const total = report.summary.total || 1;
    const healthPct = (((report.summary.valid || 0) / total) * 100).toFixed(0);

    if (report.summary.stale > 0) {
      recs.push({
        action: 'review_stale',
        severity: report.summary.stale > total * 0.3 ? 'critical' : 'warning',
        reason: `${report.summary.stale} stale entries need review or cleanup`,
        fix: 'Re-verify source files and update or remove stale memories.',
      });
    }
    if (report.summary.expired > 0) {
      recs.push({
        action: 'clean_expired',
        severity: 'warning',
        reason: `${report.summary.expired} expired entries should be removed`,
        fix: 'Run audit with autoClean=true or manually delete expired entries.',
      });
    }
    if (report.summary.duplicate > 0) {
      recs.push({
        action: 'remove_duplicates',
        severity: 'info',
        reason: `${report.summary.duplicate} duplicate entries, re-run with autoClean=true`,
        fix: 'Duplicates can be auto-compacted. Run audit with compactDuplicate=true.',
      });
    }
    if (report.summary.conflicting > 0) {
      recs.push({
        action: 'resolve_contradictions',
        severity: 'warning',
        reason: `${report.summary.conflicting} contradictory memories, manual review needed`,
        fix: 'Review each contradiction pair and keep the higher-confidence entry.',
      });
    }

    // 健康度总体建议
    if (Number(healthPct) < 60) {
      recs.push({
        action: 'deep_clean',
        severity: 'critical',
        reason: `Memory health too low (${healthPct}%), consider full reset of stale/expired entries`,
        fix: 'Consider running a full clean cycle and rebuilding from fresh project scan.',
      });
    }
  }

  _getDiskUsage() {
    const memoryDir = join(this.workingDir, '.agent-memory');
    if (!existsSync(memoryDir)) {
      return { totalBytes: 0, fileCount: 0 };
    }

    let totalBytes = 0;
    let fileCount = 0;
    const walk = (dir) => {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            walk(join(dir, entry.name));
          } else {
            try {
              totalBytes += statSync(join(dir, entry.name)).size;
              fileCount++;
            } catch {}
          }
        }
      } catch {}
    };
    walk(memoryDir);
    return { totalBytes, fileCount };
  }

  _formatSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

/**
 * @typedef {object} AuditReport
 * @property {number} timestamp
 * @property {{ total: number, valid: number, stale: number, expired: number, conflicting: number, duplicate: number }} summary
 * @property {object[]} details
 * @property {object[]} contradictions
 * @property {object[]} staleEntries
 * @property {string[]} duplicateEntries
 * @property {string[]} removedIds
 * @property {object[]} recommendations
 * @property {{ totalBytes: number, fileCount: number }} diskUsage
 */

export default MemoryAudit;
