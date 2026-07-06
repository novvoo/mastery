/**
 * VerificationEngine — 程序化任务完成验证。
 *
 * 不信任 LLM 的自述，通过检查工具事件中的实际测试输出来
 * 验证任务是否真正完成。
 *
 * 参考 claude-code 的 Verification Agent 模式，但用代码
 * 而非 LLM 来做验证，确保客观性。
 */

import { isMutationEvent, isRuntimeVerificationEvent } from './evidence-verifier.js';

/**
 * 从工具事件预览中检测测试失败。
 * events 存储的是 resultPreview（前 300 字符），
 * 对于 shell 命令，这个预览包含 exit code、stderr 等信息。
 *
 * @param {Array} toolEvents - [{ name, args, success, resultPreview }]
 * @returns {{ passed: boolean, failedEvents: Object[], summary: string }}
 */
export function verifyTestResults(toolEvents) {
  const testEvents = (toolEvents || []).filter(
    (e) => e?.name === 'shell' && isRuntimeVerificationEvent(e),
  );

  /** 从事件中提取 shell 命令文本 */
  function getCommand(e) {
    if (!e) return '';
    return e.args?.command || e.args?.cmd || e.args?.value || '';
  }

  const failedEvents = [];

  for (const event of testEvents) {
    const preview = String(event?.resultPreview || '');
    if (!preview || preview === '(command produced no output)') {
      continue;
    }

    // 检查 exit code > 0
    const exitMatch = preview.match(/exit code (\d+)/i);
    if (exitMatch) {
      const code = parseInt(exitMatch[1], 10);
      if (code > 0) {
        const cmd = getCommand(event);
        failedEvents.push({
          command: cmd || 'unknown',
          exitCode: code,
          detail: preview.slice(0, 200),
        });
        continue;
      }
    }

    // 检查失败关键词（无 exit code 时兜底）
    if (
      /[Ff]ail(?:ed|ure|s)?\b/i.test(preview) &&
      !/0 failed|0 failures|all tests passed/i.test(preview)
    ) {
      const cmd = getCommand(event);
      failedEvents.push({
        command: cmd || 'unknown',
        exitCode: -1,
        detail: 'Text contains failure indicators: ' + preview.slice(0, 200),
      });
    }
  }

  return {
    passed: failedEvents.length === 0,
    failedEvents,
    summary:
      failedEvents.length === 0
        ? 'All test commands appear to pass (no failures detected in event history).'
        : `Verification detected ${failedEvents.length} test command(s) with failures:\n` +
          failedEvents
            .map((f) => `  - ${f.command}: exit code ${f.exitCode > 0 ? f.exitCode : 'unknown'}`)
            .join('\n') +
          '\n\nRun the failing test command(s) again to confirm, then fix the issues before claiming completion.',
  };
}

/**
 * 检查文件修改与 plan 步骤的匹配度。
 *
 * @param {Array} planSteps - plan 中的步骤列表 [{ name, files? }]
 * @param {Array} toolEvents - 工具事件列表
 * @returns {{ matched: boolean, modifiedFiles: string[], unmatchedSteps: string[] }}
 */
export function verifyPlanCoverage(planSteps, toolEvents) {
  if (!planSteps?.length || !toolEvents?.length) {
    return {
      matched: false,
      modifiedFiles: [],
      unmatchedSteps: [],
      note: 'No plan steps or tool events to verify',
    };
  }

  // 提取所有被修改的文件
  const modifiedFiles = new Set();
  for (const event of toolEvents) {
    if (isMutationEvent(event)) {
      const filePath = event?.args?.path || event?.args?.file_path || '';
      if (filePath) modifiedFiles.add(filePath);
    }
  }

  // 检查每个 plan step 是否涉及了文件修改
  const unmatchedSteps = [];
  for (const step of planSteps) {
    const stepFiles = step.files || [];
    const stepName = step.name || step.description || step.id || 'unnamed step';

    if (stepFiles.length > 0) {
      const matched = stepFiles.some((f) => [...modifiedFiles].some((mf) => mf.includes(f)));
      if (!matched) {
        unmatchedSteps.push(stepName);
      }
    }
  }

  return {
    matched: unmatchedSteps.length === 0,
    modifiedFiles: [...modifiedFiles],
    unmatchedSteps,
    note:
      unmatchedSteps.length > 0
        ? `Steps without matching file modifications: ${unmatchedSteps.join(', ')}`
        : 'All plan steps have matching file modifications',
  };
}

/**
 * 综合验证入口。
 * 在 Agent 声称完成时调用，检查：
 *   1) 有 mutation 的工具事件 → 测试是否通过
 *   2) plan 步骤与修改文件的匹配度
 *
 * @param {Object} options
 * @param {Array} options.toolEvents - 本轮工具事件 [{ name, args, success, resultPreview }]
 * @param {Array} [options.planSteps] - plan 步骤（可选）
 * @returns {{ passed: boolean, guidance: string, details: Object }}
 */
export function verifyCompletion({ toolEvents, planSteps }) {
  // 检查是否有 mutation 操作
  const hasMutation = (toolEvents || []).some((e) => isMutationEvent(e));
  if (!hasMutation) {
    return {
      passed: true,
      guidance: '',
      details: { note: 'No mutation events found, skipping verification' },
    };
  }

  // 检查"循环修改不验证"模式
  const repeatCheck = detectRepeatedMutationWithoutVerification(toolEvents);
  if (repeatCheck.repeated) {
    return {
      passed: false,
      guidance:
        `[VERIFICATION FAILED] Repeated mutations without verification.\n` +
        `The same file(s) were modified ${repeatCheck.writes.length} times without running tests in between.\n` +
        `Run the test suite to confirm the changes actually fix the issues.\n` +
        `Do NOT use FINAL_ANSWER or claim completion.`,
      details: { repeatCheck },
    };
  }

  const testResult = verifyTestResults(toolEvents);
  const planResult = planSteps ? verifyPlanCoverage(planSteps, toolEvents) : null;

  const issues = [];

  if (!testResult.passed) {
    issues.push(testResult.summary);
  }

  if (planResult && !planResult.matched) {
    issues.push(planResult.note);
  }

  const passed = issues.length === 0;

  const guidance = passed
    ? ''
    : `[VERIFICATION FAILED] The task appears incomplete based on actual test output.\n${issues.join('\n')}\n\nDo NOT use FINAL_ANSWER or claim completion. Re-run the failing commands, fix the issues, then verify again.`;

  return { passed, guidance, details: { testResult, planResult, repeatCheck } };
}

/**
 * 检测"循环修改不验证"模式：
 * 同一个文件被反复编辑/写入但没有中间跑测试。
 *
 * @param {Array} toolEvents
 * @param {number} [threshold=3] - 无验证情况下允许的最大重复写入次数
 * @returns {{ repeated: boolean, writes: string[], lastVerifyAt: number|null }}
 */
export function detectRepeatedMutationWithoutVerification(toolEvents, threshold = 3) {
  if (!toolEvents?.length) {
    return { repeated: false, writes: [], lastVerifyAt: null };
  }

  // 找最后一个验证事件的位置
  let lastVerifyIndex = -1;
  for (let i = toolEvents.length - 1; i >= 0; i--) {
    if (toolEvents[i]?.name === 'shell' && isRuntimeVerificationEvent(toolEvents[i])) {
      lastVerifyIndex = i;
      break;
    }
  }

  // 找最后一个验证事件之后的 mutation 次数
  const writesAfterVerify = [];
  for (let i = lastVerifyIndex + 1; i < toolEvents.length; i++) {
    const ev = toolEvents[i];
    if (isMutationEvent(ev)) {
      writesAfterVerify.push(ev.args?.path || ev.args?.file_path || 'unknown');
    }
  }

  const repeated = writesAfterVerify.length >= threshold && new Set(writesAfterVerify).size <= 2; // 集中在 <= 2 个文件上

  return {
    repeated,
    writes: writesAfterVerify,
    lastVerifyAt: lastVerifyIndex,
  };
}

/**
 * 检测 Agent 的修改覆盖面：是否所有文件都被触及了
 *
 * @param {string[]} expectedFiles - 期望被修改的文件列表（从测试输出中提取）
 * @param {Array} toolEvents
 * @returns {{ covered: string[], missing: string[], allCovered: boolean }}
 */
export function checkFileCoverage(expectedFiles, toolEvents) {
  if (!expectedFiles?.length) return { covered: [], missing: [], allCovered: true };

  const modified = new Set();
  for (const ev of toolEvents || []) {
    if (isMutationEvent(ev)) {
      const path = ev.args?.path || ev.args?.file_path || '';
      if (path) modified.add(path);
    }
  }

  const covered = expectedFiles.filter((f) => [...modified].some((m) => m.includes(f)));
  const missing = expectedFiles.filter((f) => !covered.includes(f));

  return {
    covered,
    missing,
    allCovered: missing.length === 0,
  };
}
