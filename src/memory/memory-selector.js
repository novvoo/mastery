import { MemoryType } from './memory-types.js';

export class RuleBasedSelector {
  select(query, candidates, options = {}) {
    const { limit = 5 } = options;
    return this.keywordMatch(query, candidates, limit);
  }

  keywordMatch(query, candidates, limit) {
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = candidates.map(c => {
      let score = 0;
      const text = `${c.title} ${c.content} ${c.tags.join(' ')}`.toLowerCase();

      for (const kw of keywords) {
        if (text.includes(kw)) {
          score += 2;
        }
      }

      const ageDays = (Date.now() - c.timestamp) / (1000 * 60 * 60 * 24);
      score -= ageDays * 0.1;

      if (c.type === MemoryType.PROJECT) {
        score += 1;
      }

      c.score = score;
      return c;
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export class MemorySelector {
  #modelProvider;
  #fallbackSelector;

  constructor(modelProvider = null) {
    this.#modelProvider = modelProvider;
    this.#fallbackSelector = new RuleBasedSelector();
  }

  async select(query, candidates, options = {}) {
    const { limit = 5, model = null } = options;

    if (candidates.length === 0) {
      return [];
    }

    if (candidates.length <= limit) {
      return this.#fallbackSelector.select(query, candidates, { limit });
    }

    if (!this.#modelProvider) {
      return this.#fallbackSelector.select(query, candidates, { limit });
    }

    const prompt = this.#buildSelectionPrompt(query, candidates);

    try {
      const response = await this.#modelProvider.generate(prompt, {
        model: model || 'gpt-4o-mini',
        maxTokens: 200,
        temperature: 0.1,
      });

      return this.#parseSelection(response, candidates, limit);
    } catch (error) {
      console.warn(`Memory selector LLM failed, falling back to rule-based: ${error.message}`);
      return this.#fallbackSelector.select(query, candidates, { limit });
    }
  }

  #buildSelectionPrompt(query, candidates) {
    const candidatesList = candidates
      .map((c, i) => `${i + 1}. [${c.type}] ${c.title}`)
      .join('\n');

    return `You are a memory selector for an AI agent. Your task is to select the most relevant memories for the current query.

Current Query: "${query}"

Available Memories (${candidates.length} total):
${candidatesList}

Instructions:
1. Select the TOP ${Math.min(5, candidates.length)} most relevant memories
2. Consider: does this memory contain information that would help answer the query or complete the task?
3. Prioritize:
   - User preferences for personalization
   - Project-specific knowledge for context
   - Recent feedback for adapting behavior
   - Reference material for factual accuracy
4. Return ONLY the numbers of selected memories, separated by commas
5. Do NOT include any explanation or extra text

Example output: 1, 3, 5

Selection:`;
  }

  #parseSelection(response, candidates, limit) {
    const text = response.trim();
    const numbers = text.match(/\d+/g) || [];

    const selected = [];
    for (const num of numbers) {
      const index = parseInt(num) - 1;
      if (index >= 0 && index < candidates.length) {
        const candidate = candidates[index];
        if (!selected.find(s => s.id === candidate.id)) {
          selected.push(candidate);
        }
      }
    }

    return selected.slice(0, limit);
  }

  async validate(memory, verificationFn) {
    if (!memory || !memory.source) {
      return { valid: true, message: 'No verification needed' };
    }

    try {
      const result = await verificationFn(memory);

      if (result.valid) {
        memory.status = 'verified';
        return { valid: true, message: 'Memory verified as current' };
      } else {
        memory.status = 'stale';
        return { valid: false, message: result.message || 'Memory content may be outdated' };
      }
    } catch (error) {
      return { valid: true, message: `Verification skipped: ${error.message}` };
    }
  }
}