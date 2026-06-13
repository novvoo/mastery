/**
 * TaskClassifier — 向后兼容薄层
 *
 * 所有逻辑已合并到 IntentClassifier.classifyTask() 等方法。
 * 此文件保留仅为不破坏现有 import。
 *
 * @deprecated 请直接使用 IntentClassifier.classifyTask() / .budgetFor() / .inferSemanticRiskDomains() 等
 */

import { IntentClassifier } from './intent-classifier.js';

/**
 * @deprecated 使用 IntentClassifier.classifyTask() 代替
 */
export class TaskClassifier {
  #delegate;

  constructor(config = {}) {
    this.#delegate = new IntentClassifier(null, null, config);
  }

  classify(userInput, intent = null) {
    return this.#delegate.classifyTask(userInput, intent);
  }

  budgetFor(profile) {
    return this.#delegate.budgetFor(profile);
  }

  inferSemanticRiskDomains(userInput) {
    return this.#delegate.inferSemanticRiskDomains(userInput);
  }

  deep(userInput) {
    return this.#delegate.deepAssess(userInput);
  }

  completionGates(profile) {
    return this.#delegate.completionGates(profile);
  }

  iterationBudget(profile) {
    return this.#delegate.iterationBudget(profile);
  }
}

export default TaskClassifier;
