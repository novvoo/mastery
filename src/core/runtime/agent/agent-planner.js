/**
 * AgentPlanner compatibility facade.
 *
 * The project used to have two plan implementations:
 * - AgentPlanner for ReActAgent
 * - ExecutionPlanManager for AgentEngine
 *
 * ExecutionPlanManager is now the single planning core. This facade preserves
 * the historical AgentPlanner API so existing call sites can migrate gradually
 * without reintroducing a second plan implementation.
 */

import { ExecutionPlanManager } from './execution-plan-manager.js';

export class AgentPlanner extends ExecutionPlanManager {
  constructor(options = {}) {
    super(options);
  }

  createIfNeeded(userInput, taskProfile, options = {}) {
    const result = super.createIfNeeded(userInput, taskProfile, options);
    if (options?.modelProvider && result && typeof result.then === 'function') {
      return result.then(() => this.activePlan);
    }
    return this.activePlan;
  }

  buildPrompt(userInput = '', semanticRiskGuidance = '') {
    const prompt = super.buildPrompt(userInput);
    return semanticRiskGuidance && prompt ? `${prompt}\n${semanticRiskGuidance}` : prompt;
  }

  isCompleted() {
    return super.isCompleted;
  }

  getExecutor() {
    return null;
  }
}

export default AgentPlanner;
