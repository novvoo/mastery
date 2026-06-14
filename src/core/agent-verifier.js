/**
 * AgentVerifier — 完成门控、验证策略、证据检查
 *
 * 从 ReActAgent 拆出的职责：
 *   - shouldBlockCodingFinal: 编码任务完成门控（evidence-verifier 集成）
 *   - buildCodingCompletionGatePrompt: 生成门控纠正提示
 *   - suggestVerificationStrategy: 从 package.json / 文件扩展名推导验证命令
 *   - buildSemanticRiskGuidance: 语义风险域指导
 *   - buildCodingTaskOperatingPrompt: 编码任务操作提示
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import {
  buildCodingCompletionGatePrompt as buildCodingCompletionGatePromptText,
  buildCodingTaskOperatingPrompt as buildCodingTaskOperatingPromptText,
  buildSemanticRiskGuidance as buildSemanticRiskGuidanceText,
} from './coding-prompts.js';
import {
  getCompletionGates,
  computeIterationBudget as rbComputeIterationBudget,
} from './risk-budget.js';
import {
  isMutationEvent as evIsMutationEvent,
  checkCompletionGates as evCheckCompletionGates,
  finalAnswerMentionsVerification,
} from './evidence-verifier.js';
import { METHODOLOGY_TOOLS, MAX_ITERATIONS_DEFAULT } from './agent-constants.js';
import { TaskStatus } from '../planner/graph-planner.js';

export class AgentVerifier {
  #debugEvent;
  #toolRegistry;
  #preview;

  constructor({ debugEvent, toolRegistry, preview }) {
    this.#debugEvent = debugEvent;
    this.#toolRegistry = toolRegistry;
    this.#preview = preview;
  }

  /**
   * 编码任务完成门控
   * 决定是否阻止 Agent 提前给出最终答案
   */
  shouldBlockCodingFinal({ responseText, taskProfile, runToolEvents, activePlan, activePlanManager }) {
    const successfulEvents = runToolEvents.filter(event => event.success);
    const hasMutationEvidence = successfulEvents.some(event => evIsMutationEvent(event));

    if (!taskProfile?.isModificationTask) {
      const text = String(responseText || '').trim();
      if (!text) {
        return { block: false };
      }
      if (!hasMutationEvidence) {
        return { block: false };
      }
      const checkSummary = finalAnswerMentionsVerification(text, hasMutationEvidence);
      if (!checkSummary.ok) {
        return {
          block: true,
          reason: checkSummary.reason,
          evidence: { hasMutationEvidence, verificationMentioned: false },
        };
      }
      return { block: false, evidence: { hasMutationEvidence } };
    }

    const text = String(responseText || '').trim();
    if (!text) {
      return { block: false };
    }

    // evidence-verifier 评估
    const gates = getCompletionGates(taskProfile.riskLevel, taskProfile);
    const gateResult = evCheckCompletionGates(successfulEvents, gates, taskProfile);

    // 执行计划未完成
    if (activePlan && activePlan.status !== TaskStatus.COMPLETED) {
      return {
        block: true,
        reason: 'automatic_plan_incomplete',
        evidence: {
          automaticPlan: activePlanManager ? activePlanManager.buildPrompt('') : '',
          ...gateResult.summary,
        },
      };
    }

    // 0 工具证据
    if (successfulEvents.length === 0) {
      return {
        block: true,
        reason: 'no_tool_evidence',
        evidence: gateResult.summary,
      };
    }

    // evidence-verifier 其他缺失
    if (gateResult.block) {
      return {
        block: true,
        reason: gateResult.reason,
        missing: gateResult.missing,
        evidence: gateResult.summary,
      };
    }

    // final answer 必须诚实提到验证
    const hasMutation = gateResult.summary?.mutationEvents?.length > 0;
    const checkSummary = finalAnswerMentionsVerification(text, hasMutation);
    if (!checkSummary.ok) {
      return {
        block: true,
        reason: checkSummary.reason,
        evidence: gateResult.summary,
      };
    }

    return { block: false, evidence: gateResult.summary };
  }

  /**
   * 生成完成门控纠正提示
   */
  buildCodingCompletionGatePrompt(userInput, gate, taskProfile) {
    return buildCodingCompletionGatePromptText({
      userInput,
      gate,
      semanticRiskGuidance: this.buildSemanticRiskGuidance(taskProfile),
      requiresSemanticRiskReview: taskProfile?.requiresSemanticRiskReview,
    });
  }

  /**
   * 生成编码任务操作提示
   */
  buildCodingTaskOperatingPrompt(userInput, taskProfile) {
    return buildCodingTaskOperatingPromptText({
      userInput,
      hasMethodologyTools: this.#hasAnyTool(METHODOLOGY_TOOLS),
      profile: taskProfile || {},
      semanticRiskGuidance: this.buildSemanticRiskGuidance(taskProfile),
    });
  }

  /**
   * 生成语义风险指导
   */
  buildSemanticRiskGuidance(taskProfile) {
    return buildSemanticRiskGuidanceText(taskProfile?.semanticRiskDomains || []);
  }

  /**
   * 从 package.json / 文件扩展名推导验证策略
   */
  async suggestVerificationStrategy(userInput, workingDirectory) {
    try {
      const pkgPath = `${workingDirectory}/package.json`;
      const changedFiles = this.#extractRequestedFilePaths(userInput);

      const extensions = new Set();
      for (const p of changedFiles) {
        const m = p.match(/\.[a-zA-Z0-9]+$/);
        if (m) { extensions.add(m[0].toLowerCase()); }
      }

      let recommendedCommands = [];
      let packageInfo = null;

      if (existsSync(pkgPath)) {
        try {
          const raw = await readFile(pkgPath, 'utf-8');
          const pkg = JSON.parse(raw);
          packageInfo = { scripts: pkg.scripts || {} };
          const scripts = pkg.scripts || {};
          const priority = [
            ['test', /^(test|tests?|spec)$/i],
            ['lint', /^(lint|linting|eslint|stylelint)$/i],
            ['build', /^(build|compile|bundle|build:.*)$/i],
            ['typecheck', /^(type.?check|tsc|typecheck:.*|check)$/i],
            ['start', /^(start|dev|serve)$/i],
          ];
          for (const [label, regex] of priority) {
            const name = Object.keys(scripts).find(s => regex.test(s));
            if (name) {
              recommendedCommands.push(`bun run ${name}  # ${label} (npm run ${name} 作为备选)`);
            }
          }
          if (recommendedCommands.length === 0 && Object.keys(scripts).length > 0) {
            const first = Object.keys(scripts)[0];
            recommendedCommands.push(`bun run ${first}  # first available script`);
          }
        } catch {
          // JSON parse errors are non-fatal
        }
      }

      const extBasedCommands = [];
      for (const ext of extensions) {
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          extBasedCommands.push('node --check <file>  # syntax check');
          extBasedCommands.push('npx tsc --noEmit  # typecheck');
          extBasedCommands.push('bun test  # if tests exist (npm test 作为备选)');
        } else if (['.py'].includes(ext)) {
          extBasedCommands.push('python -c "import py_compile; py_compile.compile(\'<file>\', doraise=True)"  # syntax check');
          extBasedCommands.push('pytest  # if tests exist');
        } else if (['.go'].includes(ext)) {
          extBasedCommands.push('go build ./...');
          extBasedCommands.push('go test ./...');
        } else if (['.rs'].includes(ext)) {
          extBasedCommands.push('cargo check');
          extBasedCommands.push('cargo test');
        } else if (['.java'].includes(ext)) {
          extBasedCommands.push('mvn test');
        }
      }

      const verificationHintExts = new Set();
      let unverifiableExts = [];
      for (const ext of extensions) {
        if (['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.csv'].includes(ext)) {
          verificationHintExts.add(ext);
        }
      }
      for (const ext of verificationHintExts) {
        if (['.json', '.yml', '.yaml', '.toml'].includes(ext)) {
          if (ext === '.json') { extBasedCommands.push('node -e "JSON.parse(require(\'fs\').readFileSync(\'<file>\',\'utf8\'))"  # syntax check JSON'); }
        } else {
          unverifiableExts.push(ext);
        }
      }

      const lines = [];
      if (packageInfo) {
        const scripts = Object.keys(packageInfo.scripts).slice(0, 6);
        lines.push(`Detected package.json. Relevant scripts: ${scripts.join(', ') || '(none)'}.`);
      }
      if (recommendedCommands.length > 0) {
        lines.push('Recommended verification commands (from package.json):');
        for (const c of recommendedCommands.slice(0, 4)) { lines.push(`  - ${c}`); }
      }
      if (extBasedCommands.length > 0) {
        lines.push('File-extension-based verification commands:');
        for (const c of extBasedCommands.slice(0, 6)) { lines.push(`  - ${c}`); }
      }
      if (unverifiableExts.length > 0) {
        lines.push(`Files with extensions ${unverifiableExts.join(', ')} may not have meaningful runtime verification; ` +
                    'use read_file to inspect correctness instead of claiming "tested".');
      }
      if (lines.length === 0) {
        lines.push('Before finishing, run a shell command that exercises your changes (for example: a test, linter, typechecker, or build).');
      }
      return lines.join('\n');
    } catch {
      return 'Before finishing, run a shell command that exercises your changes (for example: a test, linter, typechecker, or build).';
    }
  }

  /**
   * 根据任务复杂度计算自适应迭代预算
   */
  computeIterationBudget(taskProfile, configMaxIterations) {
    const userSetMaxIterations = Number.isFinite(configMaxIterations) && configMaxIterations > 0;
    const baseMax = configMaxIterations || MAX_ITERATIONS_DEFAULT;

    if (userSetMaxIterations) {
      return baseMax;
    }

    if (!taskProfile) {
      return Math.max(4, Math.round(baseMax * 0.5));
    }
    const budget = rbComputeIterationBudget(taskProfile.riskLevel || taskProfile, baseMax);
    return Math.max(4, budget);
  }

  // ---- private ----

  #hasAnyTool(toolNames) {
    for (const name of toolNames) {
      if (this.#toolRegistry.has(name)) {
        return true;
      }
    }
    return false;
  }

  #extractRequestedFilePaths(text) {
    const paths = new Set();
    const regex = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|ts|tsx|jsx|json|md|py|java|go|rs|c|cpp|h|hpp))\b/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      paths.add(match[1]);
    }
    const basenamesWithDirectory = new Set(
      Array.from(paths)
        .filter(path => path.includes('/'))
        .map(path => path.split('/').pop())
    );
    for (const path of Array.from(paths)) {
      if (!path.includes('/') && basenamesWithDirectory.has(path)) {
        paths.delete(path);
      }
    }
    return paths;
  }
}
