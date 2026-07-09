/**
 * Prompt Builder — 提示词构建器
 *
 * 将 agent.js 中散落在各处的提示词字符串抽取出来统一管理：
 *   - 工具语法纠正提示 (tool-syntax-correction)
 *   - 工具使用纠正提示 (tool-refusal-correction)
 *   - 编码任务操作提示 (coding-task-operating)
 *   - 编码完成门提示 (coding-completion-gate)
 *   - 语义风险指导 (semantic-risk-guidance)
 *   - 验证策略建议 (verification-strategy)
 *   - 终止响应检测 & 最终答案提取
 */

import {
  buildCodingCompletionGatePrompt as buildCodingCompletionGatePromptText,
  buildCodingTaskOperatingPrompt as buildCodingTaskOperatingPromptText,
  buildSemanticRiskGuidance as buildSemanticRiskGuidanceText,
} from '../../../prompts/coding-prompts.js';
import { TERMINATION_KEYWORDS } from '../../../../utils/patterns.js';
import { isMutationEvent } from './evidence-verifier.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

// ============== 工具提示 ==============

export function buildToolSyntaxCorrectionPrompt(toolParser, toolRegistry, responseText) {
  const toolNames = toolRegistry
    .getAll()
    .map((t) => t.name)
    .slice(0, 24)
    .join(', ');
  let diag = null;
  if (typeof toolParser?.detectMalformedToolCall === 'function') {
    diag = toolParser.detectMalformedToolCall(String(responseText || ''));
  }
  const diagnosis = diag
    ? `\nParser diagnosis:\n  - problem: ${diag.tag}\n  - opening: ${diag.opening}\n  - closing: ${diag.closing}\n  - detail: ${diag.hint}\n`
    : '';
  return (
    `Your previous response looked like a tool call, but this runtime could not parse it, so it was not accepted as a final answer.\n` +
    `${diagnosis}\n` +
    `Previous response:\n${responseText}\n\n` +
    `Use one valid tool-call format now. Prefer: CALL tool_name({"param":"value"}). ` +
    `Available tools include: ${toolNames}. If you are actually finished, respond with FINAL_ANSWER: and summarize the completed work for the user.`
  );
}

export function buildToolUseCorrectionPrompt(toolRegistry, userInput) {
  const toolNames = toolRegistry
    .getAll()
    .map((t) => t.name)
    .slice(0, 24)
    .join(', ');
  return (
    `Your previous response incorrectly refused a local/system task. You do have tools available in this agent runtime.\n` +
    `Original user request: ${userInput}\n\n` +
    `Use an appropriate tool now instead of answering from assumptions. Available tools include: ${toolNames}. ` +
    `For filesystem, terminal, PTY, embedding, memory, or browser tasks, choose the matching tool and continue from the observation.`
  );
}

// ============== 编码任务提示 ==============

export function buildCodingTaskOperatingPrompt(params, extra = {}) {
  // 兼容旧调用：如果传入字符串，转为对象
  const opts =
    typeof params === 'string' ? { userInput: params, ...extra } : { ...params, ...extra };
  if (typeof buildCodingTaskOperatingPromptText === 'function') {
    return buildCodingTaskOperatingPromptText(opts);
  }
  return (
    `You are working on a coding task. The engine has pre-computed workspace structure and diagnostics.\n` +
    `Use this context directly:\n` +
    `  1) read specific code sections you need to edit (read_file with offset+limit),\n` +
    `  2) edit existing code with edit_file/apply_hashline_patch, or create new files with write_file,\n` +
    `  3) verify behavior (shell, review, verify).\n` +
    `Avoid broad workspace exploration when a focused read, edit, or verification step would produce better evidence.\n` +
    `User request: ${opts.userInput || 'coding task'}`
  );
}

export function buildCodingCompletionGatePrompt(userInput, gate) {
  if (typeof buildCodingCompletionGatePromptText === 'function') {
    return buildCodingCompletionGatePromptText({ userInput, gate: gate || {} });
  }
  return (
    `Before providing a final answer for this coding task, reconsider:\n` +
    `  - reason: ${gate.reason || 'insufficient evidence'}\n` +
    `  - evidence so far: ${(gate.evidence || []).slice(0, 3).join('\n    ') || '(none recorded)'}\n` +
    `Continue with the next evidence-producing step: make the scoped change if clear, gather one missing fact if needed, run relevant verification after mutation, or explain the blocker in the final answer.`
  );
}

export function buildSemanticRiskGuidance(semanticRiskDomains) {
  if (typeof buildSemanticRiskGuidanceText === 'function') {
    return buildSemanticRiskGuidanceText(semanticRiskDomains);
  }
  const domains = semanticRiskDomains || [];
  if (domains.length === 0) {
    return '';
  }
  return (
    `Semantic risk domains for this change:\n` +
    domains
      .map(
        (d) => `  - ${d.label}: ${(d.checklist || [])[0] || 'review API surface and invariants'}`,
      )
      .join('\n')
  );
}

// ============== 验证策略建议 ==============

export async function suggestVerificationStrategy(userInput, { workingDirectory } = {}) {
  const root = workingDirectory || process.cwd();
  const changedFiles = extractRequestedFilePaths(String(userInput || ''));
  const extensions = new Set();
  for (const p of changedFiles) {
    const m = p.match(/\.[a-zA-Z0-9]+$/);
    if (m) {
      extensions.add(m[0].toLowerCase());
    }
  }

  const lines = [];

  // package.json scripts
  const pkgPath = `${root}/package.json`;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      const priority = [
        ['test', /^(test|tests?|spec)$/i],
        ['lint', /^(lint|linting|eslint|stylelint)$/i],
        ['build', /^(build|compile|bundle|build:.*)$/i],
        ['typecheck', /^(type.?check|tsc|typecheck:.*|check)$/i],
        ['start', /^(start|dev|serve)$/i],
      ];
      const matched = [];
      for (const [label, regex] of priority) {
        const name = Object.keys(scripts).find((s) => regex.test(s));
        if (name) {
          matched.push(`bun run ${name}  # ${label} (npm run ${name} 作为备选)`);
        }
      }
      if (matched.length > 0) {
        lines.push('Detected package.json. Recommended verification commands:');
        for (const c of matched.slice(0, 4)) {
          lines.push(`  - ${c}`);
        }
      } else if (Object.keys(scripts).length > 0) {
        lines.push(`package.json scripts exist. Consider: bun run ${Object.keys(scripts)[0]}`);
      }
    } catch {
      /* ignore */
    }
  }

  // 基于扩展名的建议
  const extBased = [];
  if ([...extensions].some((ext) => ['.ts', '.tsx', '.js', '.jsx'].includes(ext))) {
    extBased.push('node --check <file>  # syntax check');
    extBased.push('npx tsc --noEmit  # typecheck');
    extBased.push('bun test  # if tests exist (npm test 作为备选)');
  }
  if (extensions.has('.py')) {
    extBased.push(
      'python -c "import py_compile; py_compile.compile(\'<file>\', doraise=True)"  # syntax check',
    );
    extBased.push('pytest  # if tests exist');
  }
  if (extensions.has('.go')) {
    extBased.push('go build ./...');
    extBased.push('go test ./...');
  }
  if (extensions.has('.rs')) {
    extBased.push('cargo check');
    extBased.push('cargo test');
  }
  if (extBased.length > 0) {
    lines.push('File-extension-based verification commands:');
    for (const c of extBased.slice(0, 6)) {
      lines.push(`  - ${c}`);
    }
  }

  if (lines.length === 0) {
    lines.push(
      "No strong verification signals from the request. Use read_file to inspect existing code and then run your project's usual test/lint commands.",
    );
  }
  return lines.join('\n');
}

function extractRequestedFilePaths(text) {
  const paths = new Set();
  const regex =
    /\b((?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|ts|tsx|jsx|json|md|py|java|go|rs|c|cpp|h|hpp))\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    paths.add(match[1]);
  }
  const basenamesWithDirectory = new Set(
    Array.from(paths)
      .filter((p) => p.includes('/'))
      .map((p) => p.split('/').pop()),
  );
  for (const path of Array.from(paths)) {
    if (!path.includes('/') && basenamesWithDirectory.has(path)) {
      paths.delete(path);
    }
  }
  return paths;
}

// ============== 终止检测与最终答案提取 ==============

export function isTermination(response) {
  if (!response) {
    return false;
  }
  if (TERMINATION_KEYWORDS.some((kw) => response.includes(kw))) {
    return true;
  }
  if (response.trim().length === 0) {
    return true;
  }
  return false;
}

export function extractFinalAnswer(response) {
  if (!response) {
    return '';
  }
  for (const keyword of TERMINATION_KEYWORDS) {
    const idx = response.indexOf(keyword);
    if (idx !== -1) {
      return response.substring(idx + keyword.length).trim();
    }
  }
  return response.trim();
}

export function normalizeFinalAnswer(response) {
  const text = String(response || '').trim();
  if (!text) {
    return text;
  }
  const isToolCallFormat = /<action\b|<tool_call\b|<function_call\b|<tool_code\b|<invoke\b/i.test(
    text,
  );
  if (isToolCallFormat) {
    const trimmedNoTags = text
      .replace(/<\/?(?:action|tool_call|function_call|tool_code|invoke)\b[^>]*>/gi, '')
      .trim();
    if (trimmedNoTags.length < text.length * 0.5) {
      return '';
    }
  }
  const parsed = safeParseJSON(text);
  const doneText = parsed?.action?.done?.text || parsed?.done?.text;
  if (typeof doneText === 'string' && doneText.trim()) {
    return doneText.trim();
  }
  const directText = parsed?.text || parsed?.answer || parsed?.final_answer;
  if (typeof directText === 'string' && directText.trim()) {
    return directText.trim();
  }
  return text;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

// ============== 工具语法错误检测 ==============

export function containsUnparsedToolSyntax(toolParser, responseText) {
  const response = String(responseText || '');
  if (typeof toolParser?.detectMalformedToolCall === 'function') {
    const diag = toolParser.detectMalformedToolCall(response);
    if (diag) {
      return true;
    }
  }
  const patterns = [
    /<tool_code>[\s\S]*?<\/tool_code>/i,
    /<action>[\s\S]*?<\/action>/i,
    /<tool_call>[\s\S]*?<\/tool_call>/i,
    /<function_call>[\s\S]*?<\/function_call>/i,
    /<function>\s*[\s\S]*?\s*<\/function>/i,
    /<tool>\s*\/?[A-Za-z_][\w-]*\s*<\/tool>/i,
    /```(?:tool|json)?\s*\n\s*\{[\s\S]*?(?:"name"|"action"|"tool")[\s\S]*?\}\s*```/i,
    /\bCALL\s+\/?[A-Za-z_][\w.-]*\s*\(/,
    /<invoke\b[^>]*>/i,
    /<(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*\w+/i,
  ];
  return patterns.some((p) => p.test(response));
}

// ============== Agent 工具使用纠正 ==============

export function shouldCorrectToolRefusal(toolRegistry, userInput, responseText) {
  if (!toolRegistry || toolRegistry.size === 0) {
    return false;
  }
  const input = String(userInput || '').toLowerCase();
  const asksForLocalOperation = [
    /当前目录|本地|文件|目录|路径|文件夹|几个|多少|数量|统计|列出|查看|运行|执行|终端|命令/,
    /\b(current directory|working directory|local|filesystem|file system|files?|folders?|directories?|path|count|how many|list|show|run|execute|shell|terminal|pwd|ls|find|grep|rg)\b/,
  ].some((p) => p.test(input));
  if (!asksForLocalOperation) {
    return false;
  }

  const response = String(responseText || '').toLowerCase();
  return [
    /无法|不能|没法|无权|没有权限|无法访问|不能访问|不能查看|不能读取|不能操作/,
    /浏览器助手|网页浏览器|网页.*助手|只能操作.*网页|只能.*浏览器/,
    /cannot|can't|unable|do not have|don't have|no access|not able/,
    /browser assistant|web browser|only.*browser|only.*web/,
  ].some((p) => p.test(response));
}

// ============== 编码任务 completion gate ==============

export function shouldBlockCodingFinal(userInput, responseText, { taskProfile, toolEvents } = {}) {
  if (!taskProfile?.isModificationTask) {
    return { block: false };
  }

  const events = Array.isArray(toolEvents) ? toolEvents : [];
  const successfulEvents = events.filter((e) => e.success);

  // 1) 完全没有工具调用 → 对于修改任务，必须阻塞（不能凭空声称完成了编码任务）
  if (successfulEvents.length === 0) {
    return {
      block: true,
      reason: 'no_tool_evidence_for_modification_task',
      evidence: { hasMutation: false, hasVerification: false },
    };
  }

  // 2) 有工具调用但没有代码修改 → 如果尝试完成，必须阻塞。
  // A bug-fix task may explore with read/search tools, but exploration is not
  // completion evidence. Finishing after only reading code is the exact failure
  // mode this gate exists to prevent.
  const hasMutation = successfulEvents.some((e) => isMutationEvent(e));
  if (!hasMutation) {
    const hasOnlyTestShell = successfulEvents.every((e) => {
      if (e.name !== 'shell') return false;
      const cmd = String(e.args?.command || e.args?.cmd || '').toLowerCase();
      return /test|check|lint|build|run/.test(cmd);
    });
    return {
      block: true,
      reason: 'missing_code_change',
      evidence: {
        hasMutation: false,
        hasVerification: hasOnlyTestShell,
        details: hasOnlyTestShell
          ? 'Only test/verification commands were executed; no code was modified.'
          : 'Only read/analysis tools were executed; no code was modified.',
      },
    };
  }

  // 3) 有代码修改 → 允许通过
  //    更严格的验证（runtime verification / semantic review evidence）由 agent-verifier.js 负责
  //    prompt-builder.js 只做基础证据检查
  return { block: false, evidence: { hasMutation: true } };
}

// ============== 工厂：便于按名称调用 ==============

export function detectLanguageMismatch(executedCommands, { workingDirectory } = {}) {
  const root = workingDirectory || process.cwd();
  const detectedLanguages = new Set();
  const usedLanguages = new Set();

  if (existsSync(`${root}/package.json`)) {
    detectedLanguages.add('javascript');
  }
  if (existsSync(`${root}/tsconfig.json`) || existsSync(`${root}/tsconfig.app.json`)) {
    detectedLanguages.add('typescript');
  }
  if (
    existsSync(`${root}/pyproject.toml`) ||
    existsSync(`${root}/requirements.txt`) ||
    existsSync(`${root}/setup.py`)
  ) {
    detectedLanguages.add('python');
  }
  if (existsSync(`${root}/go.mod`)) {
    detectedLanguages.add('go');
  }
  if (existsSync(`${root}/cargo.toml`)) {
    detectedLanguages.add('rust');
  }

  for (const cmd of executedCommands) {
    const lowerCmd = String(cmd || '').toLowerCase();
    if (/python|pytest|pip|py_compile/.test(lowerCmd)) {
      usedLanguages.add('python');
    }
    if (/node|npm|bun|tsc|jest|vitest/.test(lowerCmd)) {
      usedLanguages.add('javascript');
    }
    if (/go build|go test/.test(lowerCmd)) {
      usedLanguages.add('go');
    }
    if (/cargo/.test(lowerCmd)) {
      usedLanguages.add('rust');
    }
  }

  const mismatch = [];
  for (const lang of usedLanguages) {
    if (!detectedLanguages.has(lang)) {
      mismatch.push(lang);
    }
  }

  if (mismatch.length === 0) {
    return null;
  }

  const primaryLang = Array.from(detectedLanguages)[0] || 'javascript';
  const suggestions = [];
  if (primaryLang === 'javascript') {
    suggestions.push('npm test', 'npm run lint', 'npx tsc --noEmit', 'bun test');
  } else if (primaryLang === 'typescript') {
    suggestions.push('npx tsc --noEmit', 'npm test', 'bun test');
  } else if (primaryLang === 'python') {
    suggestions.push('pytest', 'python -m unittest');
  } else if (primaryLang === 'go') {
    suggestions.push('go test ./...', 'go build ./...');
  } else if (primaryLang === 'rust') {
    suggestions.push('cargo test', 'cargo check');
  }

  return {
    used: mismatch,
    detected: Array.from(detectedLanguages),
    primary: primaryLang,
    suggestions,
  };
}

export const PromptBuilder = {
  buildToolSyntaxCorrectionPrompt,
  buildToolUseCorrectionPrompt,
  buildCodingTaskOperatingPrompt,
  buildCodingCompletionGatePrompt,
  buildSemanticRiskGuidance,
  suggestVerificationStrategy,
  detectLanguageMismatch,
  isTermination,
  extractFinalAnswer,
  normalizeFinalAnswer,
  containsUnparsedToolSyntax,
  shouldCorrectToolRefusal,
  shouldBlockCodingFinal,
};

export default PromptBuilder;
