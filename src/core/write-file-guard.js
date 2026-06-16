/**
 * WriteFileGuard — 写文件前计算 diff，并同步更新 WorkspaceState 快照。
 *
 * 用法（CLI）:
 *   const guard = new WriteFileGuard({ workspaceState });
 *   const { success, applied, diff } = await guard.write(path, newContent, {
 *     readFile: (p) => fs.promises.readFile(p, 'utf8'),
 *     writeFile: (p, c) => fs.promises.writeFile(p, c, 'utf8'),
 *   });
 *
 * 用法（Desktop — 需要用户确认时):
 *   const guard = new WriteFileGuard({
 *     workspaceState,
 *     approvalStrategy: 'hunk',  // 'auto' | 'hunk' | 'never'
 *     onRequestApproval: async ({ path, diff }) => {
 *       // 弹出 DiffPreview，让用户勾选要应用的 hunks
 *       // 返回 { apply: boolean, selectedHunks?: number[] }
 *       return { apply: true };
 *     },
 *   });
 */

import { computeDiff, isNoop as diffIsNoop, applySelectedHunks } from './diff-preview.js';

export class WriteFileGuard {
  constructor({ workspaceState, approvalStrategy = 'auto', onRequestApproval = null } = {}) {
    this.workspaceState = workspaceState || null;
    this.approvalStrategy = approvalStrategy; // 'auto' | 'hunk' | 'never'
    this.onRequestApproval = onRequestApproval;
    this.lastStats = null;
  }

  async write(filePath, newContent, io) {
    if (!io || typeof io.writeFile !== 'function') {
      return { success: false, reason: 'io.writeFile 必须提供', applied: false, diff: null };
    }
    if (typeof newContent !== 'string') {
      return { success: false, reason: 'newContent 必须是字符串', applied: false, diff: null };
    }

    let oldContent = '';
    let fileExists = false;
    try {
      if (io.readFile) {
        oldContent = await io.readFile(filePath);
        fileExists = true;
      }
    } catch (_) { /* 文件不存在 — 视为全新创建 */ }

    const diff = computeDiff({ path: filePath, oldContent, newContent });
    const noop = diffIsNoop(diff);

    // 决策：是否需要用户确认
    let approval = { apply: true, selectedHunks: null };
    const risky = this.#isRisky(filePath, diff, newContent, fileExists);
    const shouldAsk =
      this.approvalStrategy === 'hunk' ||
      (this.approvalStrategy === 'auto' && risky && this.onRequestApproval);

    if (shouldAsk && this.onRequestApproval) {
      try {
        approval = await this.onRequestApproval({
          path: filePath,
          diff,
          isNewFile: !fileExists,
          newContent,
        });
      } catch (e) {
        return {
          success: false,
          reason: `审批回调抛异常: ${e.message}`,
          applied: false,
          diff: diffSummary(diff),
        };
      }
      if (!approval || approval.apply === false) {
        return {
          success: true,
          applied: false,
          reason: 'user-cancelled',
          diff: diffSummary(diff),
        };
      }
    }

    // 计算最终落盘内容：若用户指定了 hunk 子集，则只应用这些；否则整体落盘
    let contentToWrite = newContent;
    if (noop && !approval.selectedHunks) {
      // 无变更 — 直接返回
    } else if (approval.selectedHunks && approval.selectedHunks.length > 0) {
      // 构造 acceptHunks 布尔数组
      const accept = diff.hunks.map((_, i) => approval.selectedHunks.includes(i));
      const result = applySelectedHunks(diff, accept, oldContent);
      contentToWrite = result;
    }

    try {
      await io.writeFile(filePath, contentToWrite);
    } catch (e) {
      return {
        success: false,
        reason: `writeFile 失败: ${e.message}`,
        applied: false,
        diff: diffSummary(diff),
      };
    }

    // 同步更新 WorkspaceState 快照，便于下次 aggregateContext
    if (this.workspaceState && typeof this.workspaceState.setFileSnapshot === 'function') {
      this.workspaceState.setFileSnapshot(filePath, contentToWrite, 'write-file-guard');
    }

    this.lastStats = { path: filePath, ...diffSummary(diff), isNewFile: !fileExists };
    return {
      success: true,
      applied: true,
      diff: diffSummary(diff),
      isNewFile: !fileExists,
    };
  }

  // --- 私有 ---

  #isRisky(filePath, diff, newContent, fileExists) {
    // 启发式：全新文件 > 50 行 或 修改行数 > 40 视为需要谨慎
    if (!fileExists && newContent.split('\n').length > 50) return true;
    if (diff.hunks.length > 6) return true;
    if ((diff.stats?.added ?? 0) + (diff.stats?.removed ?? 0) > 80) return true;
    // 路径包含常见配置/敏感关键字
    const lower = String(filePath).toLowerCase();
    if (/(package\.json|tsconfig|vite|webpack|\.env|deploy|dockerfile|nginx|kube)/.test(lower)) {
      return diff.hunks.length >= 2;
    }
    return false;
  }
}

function diffSummary(diff) {
  return {
    hunks: diff?.hunks?.length ?? 0,
    added: diff?.stats?.added ?? 0,
    removed: diff?.stats?.removed ?? 0,
    isNoop: diffIsNoop(diff),
  };
}

export default WriteFileGuard;
