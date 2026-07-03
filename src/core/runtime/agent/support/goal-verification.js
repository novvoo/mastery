export class GoalVerification {
  constructor() {
    this.#successCriteria = [];
    this.#verificationResults = [];
  }

  #successCriteria;
  #verificationResults;

  setSuccessCriteria(criteria) {
    this.#successCriteria = Array.isArray(criteria) ? criteria : [];
  }

  addSuccessCriterion(criterion) {
    if (typeof criterion === 'function') {
      this.#successCriteria.push({ check: criterion, description: 'Custom function' });
    } else if (criterion?.check) {
      this.#successCriteria.push(criterion);
    }
  }

  async verify(output) {
    const results = [];
    let allPassed = true;

    for (const criterion of this.#successCriteria) {
      let passed = false;
      let reason = '';

      try {
        if (typeof criterion.check === 'function') {
          passed = await criterion.check(output);
        } else {
          passed = criterion.check(output);
        }
      } catch (error) {
        passed = false;
        reason = `Check failed with error: ${error.message}`;
      }

      if (!passed) {
        allPassed = false;
        reason = reason || criterion.description || 'Criterion not met';
      }

      results.push({
        description: criterion.description || 'Unknown criterion',
        passed,
        reason,
      });
    }

    const verificationResult = {
      timestamp: Date.now(),
      allPassed,
      passedCount: results.filter((r) => r.passed).length,
      totalCount: results.length,
      results,
    };

    this.#verificationResults.push(verificationResult);

    return verificationResult;
  }

  getLastVerification() {
    return this.#verificationResults[this.#verificationResults.length - 1] || null;
  }

  getVerificationHistory() {
    return [...this.#verificationResults];
  }

  generateReport() {
    const last = this.getLastVerification();
    if (!last) {
      return 'No verification has been performed yet.';
    }

    const lines = [
      '# Goal Verification Report',
      '',
      `**Timestamp**: ${new Date(last.timestamp).toISOString()}`,
      '',
      `**Overall Result**: ${last.allPassed ? '✅ PASSED' : '❌ FAILED'}`,
      '',
      `**Criteria**: ${last.passedCount}/${last.totalCount} passed`,
      '',
      '---',
      '',
      '## Detailed Results',
      '',
    ];

    for (let i = 0; i < last.results.length; i++) {
      const result = last.results[i];
      lines.push(`${result.passed ? '✅' : '❌'} **${i + 1}. ${result.description}**`);
      if (!result.passed && result.reason) {
        lines.push(`   Reason: ${result.reason}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  clear() {
    this.#verificationResults = [];
  }
}

export const CommonSuccessCriteria = {
  testPassed: {
    description: 'All tests pass',
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return (
        /(all tests passed|test suite passed|tests passed|pass:\s*\d+)/i.test(text) &&
        !/(fail:\s*\d+|error|test failed)/i.test(text)
      );
    },
  },

  buildSucceeded: {
    description: 'Build completed successfully',
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return (
        /(build completed|build succeeded|success|compiled successfully)/i.test(text) &&
        !/(error|failed|build failed)/i.test(text)
      );
    },
  },

  lintPassed: {
    description: 'Linting passed',
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return /(no errors|lint passed|success)/i.test(text) && !/(error|warning|failed)/i.test(text);
    },
  },

  fileCreated: (expectedPath) => ({
    description: `File created at ${expectedPath}`,
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return text.includes(expectedPath);
    },
  }),

  fileModified: (expectedPath) => ({
    description: `File modified at ${expectedPath}`,
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return text.includes(expectedPath);
    },
  }),

  outputContains: (expectedText) => ({
    description: `Output contains: ${expectedText}`,
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return text.includes(expectedText);
    },
  }),

  noErrors: {
    description: 'No errors in output',
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return !/(error|exception|traceback)/i.test(text);
    },
  },

  exitCodeZero: {
    description: 'Command exited with code 0',
    check: (output) => {
      if (typeof output === 'object' && output !== null) {
        return output.exitCode === 0 || output.code === 0;
      }
      const text = String(output ?? '');
      return /exit code\s*0|exited with code\s*0/i.test(text);
    },
  },

  functionExists: (functionName) => ({
    description: `Function ${functionName} exists`,
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return new RegExp(
        `function\\s+${functionName}|const\\s+${functionName}\\s*=\\s*function|const\\s+${functionName}\\s*=\\s*\\(`,
        'i',
      ).test(text);
    },
  }),

  classExists: (className) => ({
    description: `Class ${className} exists`,
    check: (output) => {
      const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
      return new RegExp(`class\\s+${className}`, 'i').test(text);
    },
  }),
};

export function createDefaultVerificationForTask(taskType) {
  const verification = new GoalVerification();

  switch (taskType) {
    case 'test':
      verification.addSuccessCriterion(CommonSuccessCriteria.testPassed);
      verification.addSuccessCriterion(CommonSuccessCriteria.exitCodeZero);
      break;

    case 'build':
      verification.addSuccessCriterion(CommonSuccessCriteria.buildSucceeded);
      verification.addSuccessCriterion(CommonSuccessCriteria.exitCodeZero);
      break;

    case 'lint':
      verification.addSuccessCriterion(CommonSuccessCriteria.lintPassed);
      verification.addSuccessCriterion(CommonSuccessCriteria.exitCodeZero);
      break;

    case 'create_file':
      verification.addSuccessCriterion(CommonSuccessCriteria.fileCreated(''));
      verification.addSuccessCriterion(CommonSuccessCriteria.noErrors);
      break;

    case 'modify_file':
      verification.addSuccessCriterion(CommonSuccessCriteria.fileModified(''));
      verification.addSuccessCriterion(CommonSuccessCriteria.noErrors);
      break;

    default:
      verification.addSuccessCriterion(CommonSuccessCriteria.noErrors);
      verification.addSuccessCriterion(CommonSuccessCriteria.exitCodeZero);
      break;
  }

  return verification;
}
