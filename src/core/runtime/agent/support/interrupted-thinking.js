/**
 * 中断思维恢复机制
 *
 * 参考 oh-my-pi 的 demoteInterruptedThinking 实现。
 *
 * 当用户 Ctrl+C 打断 Agent 时，保存当前思维状态，
 * 下次继续时可以恢复被打断的推理过程。
 */

/**
 * 中断思维详情
 */
export class InterruptedThinkingDetails {
  constructor(options = {}) {
    this.interruptedAt = options.interruptedAt || Date.now();
    this.provider = options.provider || null;
    this.model = options.model || '';
    this.blockCount = options.blockCount || 0;
    this.reasoning = options.reasoning || '';
    this.partialContent = options.partialContent || [];
  }

  toJSON() {
    return {
      interruptedAt: this.interruptedAt,
      provider: this.provider,
      model: this.model,
      blockCount: this.blockCount,
      reasoning: this.reasoning,
      partialContent: this.partialContent,
    };
  }
}

/**
 * 中断思维降级器
 *
 * 将被打断的思维块转换为隐藏消息，以便下次继续时恢复。
 */
export class InterruptedThinkingDemoter {
  /**
   * 从助手消息中提取被打断的思维块
   *
   * 参考 oh-my-pi 的 demoteInterruptedThinking 实现
   *
   * @param {object} message - 助手消息对象
   * @returns {object|null} 降级后的思维详情或 null
   */
  demote(message) {
    const content = message?.content || [];

    if (!Array.isArray(content) || content.length === 0) {
      return null;
    }

    // 扫描末尾的空文本块，跳过
    let scanEnd = content.length;
    while (scanEnd > 0) {
      const block = content[scanEnd - 1];
      // 跳过空文本块
      if (block?.type === 'text' && block?.text?.trim().length === 0) {
        scanEnd--;
        continue;
      }
      break;
    }

    // 从末尾扫描未完成的思维块
    // 特征：thinking 块且无 thinkingSignature（表示未完成）
    let runStart = scanEnd;
    while (runStart > 0) {
      const block = content[runStart - 1];
      // 只有未签名的 thinking 块才算被打断
      if (
        block?.type === 'thinking' &&
        block?.thinking?.trim().length > 0 &&
        !block?.thinkingSignature
      ) {
        runStart--;
        continue;
      }
      break;
    }

    const blockCount = scanEnd - runStart;
    if (blockCount === 0) {
      return null;
    }

    // 提取思维内容
    const reasoningBlocks = [];
    const partialContent = [];
    for (let index = runStart; index < scanEnd; index++) {
      const block = content[index];
      if (block?.type === 'thinking') {
        reasoningBlocks.push(block.thinking.trim());
        partialContent.push(block);
      }
    }

    const reasoning = reasoningBlocks.join('\n\n');

    return {
      reasoning,
      partialContent,
      blockCount,
    };
  }

  /**
   * 创建中断思维的隐藏消息
   *
   * @param {object} details - 降级后的思维详情
   * @param {object} metadata - 元数据
   * @returns {object} 隐藏消息对象
   */
  createHiddenMessage(details, metadata = {}) {
    const template = `<interrupted_thinking>
The previous turn was interrupted while the agent was thinking. Here is the
partial reasoning that was cut off — it may help you continue from where it stopped.

<reasoning>
${details.reasoning}
</reasoning>

<status>
Blocks recovered: ${details.blockCount}
Interrupted at: ${new Date(metadata.interruptedAt || Date.now()).toISOString()}
</status>
</interrupted_thinking>`;


    return {
      type: 'interrupted_thinking',
      content: template,
      display: false, // 不显示给用户，只传给模型
      details: new InterruptedThinkingDetails({
        interruptedAt: metadata.interruptedAt,
        provider: metadata.provider,
        model: metadata.model,
        blockCount: details.blockCount,
        reasoning: details.reasoning,
        partialContent: details.partialContent,
      }),
    };
  }
}

/**
 * 中断思维恢复器
 */
export class InterruptedThinkingRecoverer {
  #sessionManager;
  #lastInterruptedThinking = null;

  constructor(options = {}) {
    this.#sessionManager = options.sessionManager;
  }

  /**
   * 保存中断思维
   *
   * @param {object} message - 被打断的助手消息
   * @param {object} metadata - 元数据
   */
  saveInterrupted(message, metadata = {}) {
    const demoter = new InterruptedThinkingDemoter();
    const details = demoter.demote(message);

    if (!details) {
      return false;
    }

    this.#lastInterruptedThinking = demoter.createHiddenMessage(details, metadata);

    if (this.#sessionManager) {
      // 注入隐藏消息到对话历史
      this.#sessionManager.addHiddenMessage?.(this.#lastInterruptedThinking.content);
    }

    return true;
  }

  /**
   * 检查是否有待恢复的中断思维
   */
  hasPendingRecovery() {
    return this.#lastInterruptedThinking !== null;
  }

  /**
   * 获取待恢复的中断思维
   */
  getPendingRecovery() {
    return this.#lastInterruptedThinking;
  }

  /**
   * 清除中断思维
   */
  clear() {
    this.#lastInterruptedThinking = null;
  }

  /**
   * 生成继续推理的提示
   *
   * @returns {string|null}
   */
  getContinuePrompt() {
    if (!this.#lastInterruptedThinking) {
      return null;
    }

    return `Your previous thinking was interrupted. Please continue from where you stopped. 
The recovered reasoning context has been provided above. 
Do not start over — pick up the train of thought and proceed with your planned action.`;
  }
}

/**
 * 检查消息是否包含未完成的思维
 *
 * @param {object} message - 消息对象
 * @returns {boolean}
 */
export function hasIncompleteThinking(message) {
  const content = message?.content || [];

  if (!Array.isArray(content)) {
    return false;
  }

  // 检查是否有未签名的 thinking 块
  return content.some(
    (block) =>
      block?.type === 'thinking' &&
      block?.thinking?.trim().length > 0 &&
      !block?.thinkingSignature
  );
}

/**
 * 检查 finishReason 是否表示被打断
 *
 * @param {string} finishReason - 完成原因
 * @returns {boolean}
 */
export function isInterruptedFinish(finishReason) {
  const interruptedReasons = new Set([
    'stop_sequence', // Anthropic 的中断序列
    'pause_turn', // oh-my-pi 的暂停轮次
    'interrupted', // 通用中断标记
    'abort', // 用户中止
  ]);

  return interruptedReasons.has(finishReason);
}

/**
 * 创建中断思维的系统提示模板
 */
const INTERRUPTED_THINKING_TEMPLATE = `<interrupted_thinking>
{{reasoning}}
</interrupted_thinking>`;

/**
 * 格式化中断思维内容
 *
 * @param {string} reasoning - 思维内容
 * @returns {string}
 */
export function formatInterruptedThinking(reasoning) {
  return INTERRUPTED_THINKING_TEMPLATE.replace('{{reasoning}}', reasoning);
}

export default {
  InterruptedThinkingDetails,
  InterruptedThinkingDemoter,
  InterruptedThinkingRecoverer,
  hasIncompleteThinking,
  isInterruptedFinish,
  formatInterruptedThinking,
  INTERRUPTED_THINKING_TEMPLATE,
};