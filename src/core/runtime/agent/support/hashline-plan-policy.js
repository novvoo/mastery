export const HASHLINE_PLAN_COORDINATION_GUIDANCE =
  `Hashline and plan are one execution loop: the current plan task defines intent, scope, and completion criteria; apply_hashline_patch is the preferred fast edit vehicle once the task has enough context.\n` +
  `Use methodology tools to shape or validate the patch when the task is ambiguous, cross-module, risky, or has similar competing flows; then use hashline for the concrete code edit instead of bypassing the plan.\n` +
  `After every hashline edit, inspect/review/verify according to the next plan task. If hashline reports stale tags, conflicts, rollback, diagnostics failure, or the patch no longer matches the plan, call change_plan before continuing.`;
