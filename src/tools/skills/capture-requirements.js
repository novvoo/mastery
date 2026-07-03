import { ToolCategory } from '../../core/types.js';

/**
 * capture_requirements — 结构化需求捕获工具。
 *
 * 设计目标：在进入 implement_changes 之前，强制将「原始需求、改动文件清单、
 * 预期行为」三项工件写入执行引擎的可验证状态。没有这三项工件，实现阶段
 * 的 completionPredicate 永远不会放行，从而避免 LLM 在缺少依据时
 * 被迫编造代码修改。
 *
 * 这是一个**状态型工具**：handler 通过 ctx.onRequirementsCaptured 回调
 * 将工件写入 ExecutionPlanManager 的 #capturedRequirements，而不是
 * 仅返回一段文本。引擎侧的门禁通过检查该状态是否存在来阻断实现阶段。
 */
export default function createCaptureRequirementsTool() {
  return {
    name: 'capture_requirements',
    description:
      'Structured requirement capture gate. Before any code mutation, write three artifacts into the engine state: (1) request — one-sentence restatement of the original user request, (2) targets — the exact files/symbols that must change, (3) expected — the observable behavior after change. All three fields are required. If any field is missing, the tool returns an error and no mutation task can start. If the request is already complete against the codebase, pass status="already_complete" so the planner routes to verify_result.',
    category: ToolCategory.skill_engineering,
    params: {
      request: {
        type: 'string',
        description:
          'One-sentence restatement of the original user request in plain, concrete terms.',
      },
      targets: {
        type: 'array',
        description:
          'List of concrete files or symbols that must change. Example: ["src/App.jsx", "useAuth#getUser"]',
      },
      expected: {
        type: 'string',
        description: 'Observable behavior after change — what the user will see / test will pass.',
      },
      status: {
        type: 'string',
        description:
          'One of: "pending" (changes needed), "already_complete" (codebase already meets the request — do not mutate, go straight to verification). Defaults to "pending".',
      },
    },
    required: ['request', 'targets', 'expected'],
    handler: async ({ request, targets, expected, status = 'pending' }, ctx) => {
      const errors = [];

      if (typeof request !== 'string' || !request.trim()) {
        errors.push('request must be a non-empty string restating the user request.');
      }

      if (!Array.isArray(targets) || targets.length === 0) {
        errors.push('targets must be a non-empty array of file paths or symbols to change.');
      } else {
        const cleaned = targets.map((t) => String(t).trim()).filter(Boolean);
        if (cleaned.length === 0) {
          errors.push('targets contains no valid file path or symbol entries.');
        }
      }

      if (typeof expected !== 'string' || !expected.trim()) {
        errors.push('expected must be a non-empty string describing observable behavior.');
      }

      const normalizedStatus = typeof status === 'string' ? status.trim() : 'pending';
      if (!['pending', 'already_complete'].includes(normalizedStatus)) {
        errors.push('status must be either "pending" or "already_complete".');
      }

      if (errors.length > 0) {
        return {
          ok: false,
          error: 'capture_requirements rejected: missing or invalid artifacts. ' + errors.join(' '),
          hint: 'Please provide (1) request restatement, (2) concrete targets (files/symbols), (3) expected observable behavior. Without these three artifacts, the plan cannot enter implement_changes.',
        };
      }

      const artifact = {
        request: String(request).trim(),
        targets: targets.map((t) => String(t).trim()).filter(Boolean),
        expected: String(expected).trim(),
        status: normalizedStatus,
        capturedAt: Date.now(),
      };

      try {
        if (typeof ctx?.onRequirementsCaptured === 'function') {
          ctx.onRequirementsCaptured(artifact);
        }
      } catch (err) {
        return {
          ok: false,
          error: 'Failed to persist requirement artifact to engine state: ' + (err?.message ?? err),
        };
      }

      return {
        ok: true,
        message:
          normalizedStatus === 'already_complete'
            ? 'Requirement artifact captured. Status=already_complete — planner should route to verify_result without mutation.'
            : 'Requirement artifact captured. Plan is now allowed to enter implement_changes. The captured artifacts are the source of truth for any mutation.',
        artifact,
      };
    },
  };
}
