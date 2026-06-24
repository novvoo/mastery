/**
 * ConversationJournal — 请求-结果持久化日志
 *
 * 每次用户请求 + Agent 执行结果都记录到 .agent-memory/conversations/YYYY-MM-DD.md。
 * 进程重启不丢失，按天归档，与其它 .agent-memory 持久化文件统一管理。
 */
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const JOURNAL_DIRNAME = '.agent-memory/conversations';

export class ConversationJournal {
  /** @param {string} workingDirectory */
  constructor(workingDirectory) {
    this.#journalDir = join(workingDirectory, JOURNAL_DIRNAME);
    this.#ensureDir();
  }

  /**
   * 用户输入后立刻调用：写入请求头部 + 用户请求内容。
   * 返回 { filePath, entryHeaderLen } 供后续 recordResult 定位追加。
   */
  recordInput(userInput, runId) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19);
    const filePath = join(this.#journalDir, `${dateStr}.md`);

    const lines = [];
    const isNewFile = !existsSync(filePath);
    if (isNewFile) {
      lines.push(`# Conversation Journal — ${dateStr}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push(`### ${timeStr} \`${runId}\``);
    lines.push('');
    lines.push('**用户请求:**');
    lines.push('');
    if (userInput && userInput.trim()) {
      const quoted = userInput
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
      lines.push(quoted);
    } else {
      lines.push('> *(空请求)*');
    }
    lines.push('');
    // 占位：结果将在 recordResult 追加
    lines.push('<!-- RESULT_PENDING -->');
    lines.push('');
    appendFileSync(filePath, lines.join('\n'), 'utf-8');
  }

  /**
   * Agent 完成后调用：覆盖 RESULT_PENDING 占位，写入完整结果。
   * @param {{ answer: string|null, success: boolean, reason: string|null, durationMs: number, toolCount: number, runId: string }} entry
   */
  recordResult(entry) {
    const { answer, success, reason, durationMs, toolCount, runId } = entry;
    const filePath = this.#findJournalFile();
    if (!filePath || !existsSync(filePath)) return;

    let content = readFileSync(filePath, 'utf-8');
    const placeholder = '<!-- RESULT_PENDING -->';

    const summary = [
      `| 字段 | 值 |`,
      `|------|-----|`,
      `| 状态 | ${success ? '✅ 成功' : '❌ 失败'} |`,
      `| 原因 | \`${reason || '—'}\` |`,
      `| 耗时 | ${(durationMs / 1000).toFixed(1)}s |`,
      `| 工具调用 | ${toolCount} 次 |`,
      `| 匹配 runId | \`${runId}\` |`,
    ].join('\n');

    let resultBlock;
    if (answer && answer.trim()) {
      const preview =
        answer.length > 1200
          ? answer.slice(0, 1200).replace(/\n$/, '') + '\n\n*(... 已截断)*'
          : answer;
      resultBlock = '\n**Agent 结果:**\n\n```\n' + preview + '\n```\n';
    } else {
      resultBlock = '\n**Agent 结果:** *(无输出)*\n';
    }

    const replacement = summary + '\n' + resultBlock;
    content = content.replace(placeholder, replacement);
    writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * 返回今天对应的 journal 文件路径（用于 recordResult 查找）。
   */
  #findJournalFile() {
    const dateStr = new Date().toISOString().slice(0, 10);
    return join(this.#journalDir, `${dateStr}.md`);
  }

  #journalDir;
  #ensureDir() {
    if (!this.#journalDir) return;
    mkdirSync(this.#journalDir, { recursive: true });
  }
}
