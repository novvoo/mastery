const READ_ONLY_TOOL_NAMES = new Set([
  'list_dir',
  'read_file',
  'glob',
  'tree',
  'stat_file',
  'search_codebase',
  'file_analyzer',
  'view_patch',
  'workspace_knowledge',
]);

export class ActionHistory {
  constructor(maxHistory = 50, loopThreshold = 0.85, maxLoopCount = 3) {
    this.#history = [];
    this.#maxHistory = maxHistory;
    this.#loopThreshold = loopThreshold;
    this.#maxLoopCount = maxLoopCount;
    this.#loopCount = 0;
    this.#lastAction = null;
    this.#readOnlyStreak = 0;
    this.#maxReadOnlyStreak = 0;
    this.#explorationTargets = new Map();
  }

  #history;
  #maxHistory;
  #loopThreshold;
  #maxLoopCount;
  #loopCount;
  #lastAction;
  #readOnlyStreak;
  #maxReadOnlyStreak;
  #explorationTargets;

  record(action) {
    const actionRecord = {
      ...action,
      timestamp: Date.now(),
      id: this.#generateActionId(action),
      isReadOnly: READ_ONLY_TOOL_NAMES.has(action.toolName),
    };

    this.#history.push(actionRecord);
    this.#lastAction = actionRecord;

    if (this.#history.length > this.#maxHistory) {
      this.#history.shift();
    }

    this.#updateReadOnlyStreak(actionRecord);
    this.#updateExplorationTargets(actionRecord);

    return actionRecord;
  }

  #updateReadOnlyStreak(action) {
    if (action.isReadOnly) {
      this.#readOnlyStreak += 1;
      if (this.#readOnlyStreak > this.#maxReadOnlyStreak) {
        this.#maxReadOnlyStreak = this.#readOnlyStreak;
      }
    } else {
      this.#readOnlyStreak = 0;
    }
  }

  #updateExplorationTargets(action) {
    if (!action.isReadOnly) return;

    const targetKey = this.#getExplorationKey(action);
    if (targetKey) {
      const entry = this.#explorationTargets.get(targetKey) || {
        count: 0,
        firstTimestamp: action.timestamp,
      };
      entry.count += 1;
      entry.lastTimestamp = action.timestamp;
      this.#explorationTargets.set(targetKey, entry);
    }
  }

  #getExplorationKey(action) {
    const args = action.args || {};
    switch (action.toolName) {
      case 'read_file':
        return `read:${args.file_path || args.path || ''}`;
      case 'list_dir':
        return `list:${args.path || '.'}`;
      case 'glob':
        return `glob:${args.pattern || ''}`;
      case 'search_codebase':
        return `search:${args.query || ''}`;
      case 'file_analyzer':
        return `analyze:${args.file_path || args.path || ''}`;
      default:
        return null;
    }
  }

  #generateActionId(action) {
    const parts = [];
    if (action.toolName) parts.push(action.toolName);
    if (action.taskId) parts.push(action.taskId);
    if (action.filePath) {
      const path = typeof action.filePath === 'string' ? action.filePath : '';
      parts.push(path.split('/').pop());
    }
    if (action.type) parts.push(action.type);
    return parts.join(':');
  }

  detectLoop() {
    if (this.#history.length < 3) {
      return { isLoop: false, reason: 'Not enough history' };
    }

    const recent = this.#history.slice(-3);
    const similarities = [];

    for (let i = 1; i < recent.length; i++) {
      similarities.push(this.#calculateSimilarity(recent[i - 1], recent[i]));
    }

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    const allHighSimilarity = similarities.every((s) => s >= this.#loopThreshold);

    if (allHighSimilarity) {
      this.#loopCount += 1;
    } else {
      this.#loopCount = 0;
    }

    const isLoop = this.#loopCount >= this.#maxLoopCount;

    return {
      isLoop,
      avgSimilarity,
      similarityThreshold: this.#loopThreshold,
      loopCount: this.#loopCount,
      maxLoopCount: this.#maxLoopCount,
      recentActions: recent.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        timestamp: a.timestamp,
      })),
      reason: isLoop
        ? `Detected ${this.#loopCount} consecutive similar actions (similarity: ${avgSimilarity.toFixed(2)})`
        : 'No loop detected',
    };
  }

  detectReadOnlyLoop(threshold = 5) {
    if (this.#readOnlyStreak < threshold) {
      return {
        isReadOnlyLoop: false,
        streak: this.#readOnlyStreak,
        threshold,
        reason: `ReadOnly streak (${this.#readOnlyStreak}) below threshold (${threshold})`,
      };
    }

    const recentReadOnly = this.#history.filter((a) => a.isReadOnly).slice(-this.#readOnlyStreak);

    return {
      isReadOnlyLoop: true,
      streak: this.#readOnlyStreak,
      maxStreak: this.#maxReadOnlyStreak,
      threshold,
      recentReadOnlyActions: recentReadOnly.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        timestamp: a.timestamp,
        filePath: a.filePath,
      })),
      overExploredTargets: this.#getOverExploredTargets(),
      reason: `Detected ${this.#readOnlyStreak} consecutive read-only actions without any mutation`,
    };
  }

  #getOverExploredTargets() {
    const overExplored = [];
    for (const [key, entry] of this.#explorationTargets.entries()) {
      if (entry.count >= 2) {
        overExplored.push({
          key,
          count: entry.count,
          firstTimestamp: entry.firstTimestamp,
          lastTimestamp: entry.lastTimestamp,
          durationMs: entry.lastTimestamp - entry.firstTimestamp,
        });
      }
    }
    return overExplored.sort((a, b) => b.count - a.count);
  }

  getReadOnlyStreak() {
    return this.#readOnlyStreak;
  }

  getMaxReadOnlyStreak() {
    return this.#maxReadOnlyStreak;
  }

  getOverExploredTargets() {
    return this.#getOverExploredTargets();
  }

  hasReadFile(filePath) {
    if (!filePath) return false;
    const normalizedPath = filePath.trim();
    return this.#history.some((action) => {
      if (action.toolName !== 'read_file') return false;
      const actionPath = (action.args?.file_path || action.args?.path || '').trim();
      return actionPath === normalizedPath;
    });
  }

  hasExploredDirectory(dirPath) {
    if (!dirPath) return false;
    const normalizedDir = dirPath.trim();
    return this.#history.some((action) => {
      if (action.toolName !== 'list_dir' && action.toolName !== 'glob') return false;
      const actionPath = (action.args?.path || action.args?.pattern || '').trim();
      return (
        actionPath === normalizedDir ||
        actionPath.startsWith(normalizedDir + '/') ||
        normalizedDir.startsWith(actionPath + '/')
      );
    });
  }

  #calculateSimilarity(action1, action2) {
    let score = 0;
    let maxScore = 0;

    const compareField = (field) => {
      maxScore += 1;
      if (action1[field] === action2[field]) {
        score += 1;
      } else if (action1[field] && action2[field]) {
        const str1 = String(action1[field]);
        const str2 = String(action2[field]);
        const sim = this.#stringSimilarity(str1, str2);
        score += sim * 0.5;
      }
    };

    compareField('toolName');
    compareField('taskId');
    compareField('filePath');
    compareField('type');

    if (action1.args && action2.args) {
      maxScore += 1;
      const argsSim = this.#objectSimilarity(action1.args, action2.args);
      score += argsSim;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  #stringSimilarity(s1, s2) {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;

    if (longerLength === 0) return 1;

    return (longerLength - this.#levenshteinDistance(longer, shorter)) / longerLength;
  }

  #levenshteinDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else {
          if (j > 0) {
            let newValue = costs[j - 1];
            if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            }
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
      }
      if (i > 0) {
        costs[s2.length] = lastValue;
      }
    }
    return costs[s2.length];
  }

  #objectSimilarity(obj1, obj2) {
    const keys1 = Object.keys(obj1 || {});
    const keys2 = Object.keys(obj2 || {});

    if (keys1.length === 0 && keys2.length === 0) return 1;

    const commonKeys = keys1.filter((k) => keys2.includes(k));
    const allKeys = new Set([...keys1, ...keys2]);

    if (allKeys.size === 0) return 1;

    let score = 0;
    for (const key of commonKeys) {
      const v1 = obj1[key];
      const v2 = obj2[key];
      if (v1 === v2) {
        score += 1;
      } else if (typeof v1 === 'string' && typeof v2 === 'string') {
        score += this.#stringSimilarity(v1, v2) * 0.5;
      } else if (typeof v1 === 'object' && typeof v2 === 'object') {
        score += this.#objectSimilarity(v1, v2) * 0.5;
      }
    }

    return score / allKeys.size;
  }

  getRecentActions(count = 5) {
    return [...this.#history].reverse().slice(0, count).reverse();
  }

  getLastAction() {
    return this.#lastAction;
  }

  getHistoryLength() {
    return this.#history.length;
  }

  getLoopCount() {
    return this.#loopCount;
  }

  resetLoopCount() {
    this.#loopCount = 0;
  }

  clear() {
    this.#history = [];
    this.#loopCount = 0;
    this.#lastAction = null;
    this.#readOnlyStreak = 0;
    this.#maxReadOnlyStreak = 0;
    this.#explorationTargets = new Map();
  }

  toJSON() {
    return {
      history: this.#history,
      historyLength: this.#history.length,
      maxHistory: this.#maxHistory,
      loopCount: this.#loopCount,
      maxLoopCount: this.#maxLoopCount,
      readOnlyStreak: this.#readOnlyStreak,
      maxReadOnlyStreak: this.#maxReadOnlyStreak,
      explorationTargetCount: this.#explorationTargets.size,
    };
  }
}

export function createActionRecord(toolName, args, result, taskId) {
  const action = {
    toolName,
    args: typeof args === 'object' ? args : {},
    result: typeof result === 'object' ? result : {},
    taskId,
    timestamp: Date.now(),
  };

  if (args?.file_path || args?.filePath) {
    action.filePath = args.file_path || args.filePath;
  }

  if (args?.type) {
    action.type = args.type;
  }

  return action;
}
