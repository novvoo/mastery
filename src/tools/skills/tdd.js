import { ToolCategory } from '../../core/types/index.js';

/**
 * tdd - Test-driven development workflow.
 * Guides through Red-Green-Refactor cycle with phase-specific guidance.
 */
export default function tdd() {
  return {
    name: 'tdd',
    description:
      'Test-driven development workflow tool. Guides through the Red-Green-Refactor cycle. Use "red" phase to generate failing test guidance, "green" phase for minimal implementation, and "refactor" phase for improvement suggestions.',
    category: ToolCategory.skill_engineering,
    params: {
      component: {
        type: 'string',
        description: 'The component, module, or function being developed',
      },
      spec: {
        type: 'string',
        description: 'The specification or expected behavior of the component',
      },
      phase: {
        type: 'string',
        description: 'The TDD phase to execute',
        enum: ['red', 'green', 'refactor'],
      },
      test_file: {
        type: 'string',
        description: 'Path to the test file (optional, for context)',
      },
      source_file: {
        type: 'string',
        description: 'Path to the source file (optional, for context)',
      },
    },
    required: ['component', 'spec', 'phase'],
    handler: async (params, ctx) => {
      const { component, spec, phase, test_file = '', source_file = '' } = params;

      switch (phase) {
        case 'red':
          return generateRedPhase(component, spec, test_file);
        case 'green':
          return generateGreenPhase(component, spec, source_file, test_file);
        case 'refactor':
          return generateRefactorPhase(component, spec, source_file, test_file);
        default:
          return `Error: Unknown phase "${phase}". Must be one of: red, green, refactor.`;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Phase: RED - Write failing tests first
// ---------------------------------------------------------------------------

function generateRedPhase(component, spec, testFile) {
  const testCases = deriveTestCases(component, spec);

  const lines = [
    '# TDD: RED Phase - Write Failing Tests',
    '',
    '> **Rule**: Do NOT write any implementation code until all tests are written and failing.',
    '',
    '---',
    '',
    '## Component',
    '',
    `**Name**: ${component}`,
    '',
    `**Specification**: ${spec}`,
    '',
    '---',
    '',
    '## Test Structure',
    '',
    testFile
      ? `**Test File**: \`${testFile}\``
      : "**Test File**: (create an appropriate test file for your project's test framework)",
    '',
    '### Recommended Test Organization',
    '',
    '```',
    `describe('${component}', () => {`,
    '  // Happy path tests',
    "  describe('happy path', () => { ... });",
    '',
    '  // Edge case tests',
    "  describe('edge cases', () => { ... });",
    '',
    '  // Error case tests',
    "  describe('error handling', () => { ... });",
    '});',
    '```',
    '',
    '---',
    '',
    '## Test Cases to Implement',
    '',
  ];

  testCases.forEach((tc, i) => {
    lines.push(`### TC-${i + 1}: ${tc.name} [${tc.category}]`);
    lines.push('');
    lines.push(`- **Description**: ${tc.description}`);
    lines.push(`- **Input**: ${tc.input}`);
    lines.push(`- **Expected Output**: ${tc.expected}`);
    if (tc.notes) {
      lines.push(`- **Notes**: ${tc.notes}`);
    }
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '## Red Phase Checklist',
    '',
    '- [ ] All test cases above are implemented as failing tests',
    '- [ ] Tests fail for the RIGHT reason (not syntax errors or import issues)',
    '- [ ] Test descriptions clearly state the expected behavior',
    '- [ ] Each test is independent and does not depend on other tests',
    '- [ ] Edge cases and error paths are covered',
    '',
    '> **Next Step**: Once all tests are written and failing, run the tdd tool with phase "green" to get minimal implementation guidance.',
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Phase: GREEN - Write minimal implementation to pass tests
// ---------------------------------------------------------------------------

function generateGreenPhase(component, spec, sourceFile, testFile) {
  const lines = [
    '# TDD: GREEN Phase - Minimal Implementation',
    '',
    '> **Rule**: Write the MINIMUM code required to make all tests pass. No premature optimization.',
    '',
    '---',
    '',
    '## Component',
    '',
    `**Name**: ${component}`,
    '',
    `**Specification**: ${spec}`,
    '',
    sourceFile ? `**Source File**: \`${sourceFile}\`` : '',
    '',
    testFile ? `**Test File**: \`${testFile}\`` : '',
    '',
    '---',
    '',
    '## Implementation Strategy',
    '',
    '### Step 1: Stub Implementation',
    '',
    'Create the minimal function/module signature that satisfies the test imports:',
    '',
    '```javascript',
    `// ${component} - minimal stub`,
    `// TODO: Implement to satisfy: ${spec}`,
    '',
    'export function main(/* params */) {',
    '  throw new Error("Not yet implemented");',
    '}',
    '```',
    '',
    '### Step 2: Make Tests Pass One at a Time',
    '',
    'Work through tests in this order:',
    '1. **Happy path tests** - Implement the core logic first',
    '2. **Edge case tests** - Add conditional handling',
    '3. **Error case tests** - Add error handling last',
    '',
    '### Step 3: Implementation Guidelines',
    '',
    '- Use the simplest possible solution for each test',
    '- Avoid generalizing beyond what the tests require',
    '- Hard-code values if needed to make a test pass (generalize in refactor)',
    '- Do NOT add error handling for cases not covered by tests',
    '- Do NOT optimize for performance (that comes in refactor)',
    '',
    '### Step 4: Run Tests After Each Change',
    '',
    '```bash',
    '# Run the specific test file',
    testFile ? `bun test ${testFile}` : 'bun test <test-file>',
    '',
    '# Or run with watch mode for rapid feedback',
    'bun test --watch',
    '```',
    '',
    '---',
    '',
    '## Green Phase Checklist',
    '',
    '- [ ] All previously failing tests now pass',
    '- [ ] No tests were removed or modified to make them pass',
    '- [ ] Implementation is minimal (no gold-plating)',
    '- [ ] No new dependencies were added unless absolutely necessary',
    '- [ ] Code is syntactically correct and linter passes',
    '',
    '> **Next Step**: Once all tests pass, run the tdd tool with phase "refactor" to improve the code while keeping tests green.',
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Phase: REFACTOR - Improve code while keeping tests green
// ---------------------------------------------------------------------------

function generateRefactorPhase(component, spec, sourceFile, testFile) {
  const lines = [
    '# TDD: REFACTOR Phase - Improve with Confidence',
    '',
    '> **Rule**: All tests MUST remain green throughout refactoring. If a test breaks, revert immediately.',
    '',
    '---',
    '',
    '## Component',
    '',
    `**Name**: ${component}`,
    '',
    `**Specification**: ${spec}`,
    '',
    sourceFile ? `**Source File**: \`${sourceFile}\`` : '',
    '',
    testFile ? `**Test File**: \`${testFile}\`` : '',
    '',
    '---',
    '',
    '## Refactoring Opportunities',
    '',
    '### 1. Code Structure',
    '',
    '- Extract repeated logic into helper functions',
    '- Reduce function/method length (target: < 20 lines)',
    '- Improve variable and function naming for clarity',
    '- Remove dead code or unused variables',
    '',
    '### 2. Design Patterns',
    '',
    '- Identify opportunities for strategy, factory, or observer patterns',
    '- Reduce coupling between components',
    '- Improve separation of concerns',
    '- Consider dependency injection for testability',
    '',
    '### 3. Performance',
    '',
    '- Identify unnecessary computations or allocations',
    '- Consider memoization for repeated expensive operations',
    '- Review algorithm complexity (Big-O)',
    '- Add performance benchmarks if relevant',
    '',
    '### 4. Readability',
    '',
    '- Add inline comments for non-obvious logic',
    '- Ensure consistent code style',
    '- Group related operations logically',
    '- Simplify complex conditional expressions',
    '',
    '### 5. Test Quality',
    '',
    '- Review test descriptions for clarity',
    '- Remove any test duplication',
    '- Ensure test fixtures are well-organized',
    '- Add missing edge case tests if behavior was clarified during implementation',
    '',
    '---',
    '',
    '## Refactoring Process',
    '',
    '1. **Pick ONE refactoring at a time**',
    '2. **Make the change**',
    '3. **Run ALL tests**',
    '4. **If tests pass**: commit the refactoring',
    '5. **If tests fail**: revert and try a different approach',
    '6. **Repeat** until no more valuable improvements remain',
    '',
    '---',
    '',
    '## Refactor Phase Checklist',
    '',
    '- [ ] All tests still pass after refactoring',
    '- [ ] Code is cleaner and more maintainable',
    '- [ ] No behavioral changes were introduced',
    '- [ ] No new dependencies were added',
    '- [ ] Performance has not regressed',
    '- [ ] Code review with the review tool passes without critical issues',
    '',
    '> **Next Step**: Run the verify tool to confirm all acceptance criteria are met with evidence.',
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveTestCases(component, spec) {
  const specLower = spec.toLowerCase();
  const testCases = [];

  // Happy path
  testCases.push({
    name: 'Core functionality',
    category: 'Happy Path',
    description: `${component} should satisfy the primary specification: ${spec}`,
    input: 'Valid input as defined by the specification',
    expected: 'Output that matches the specification requirements',
    notes: 'This is the most important test - it validates the core contract',
  });

  testCases.push({
    name: 'Default behavior',
    category: 'Happy Path',
    description: `${component} should handle default/typical usage without errors`,
    input: 'Standard input with no special conditions',
    expected: 'Expected standard output',
    notes: 'Validates the common case that will be exercised most frequently',
  });

  // Edge cases
  testCases.push({
    name: 'Empty input handling',
    category: 'Edge Case',
    description: `${component} should handle empty or zero-value input gracefully`,
    input: 'Empty string, empty array, 0, or null as appropriate',
    expected: 'Defined behavior (error, default value, or empty result)',
    notes: 'Clarify expected behavior for empty input in the specification',
  });

  testCases.push({
    name: 'Boundary values',
    category: 'Edge Case',
    description: `${component} should handle boundary values correctly`,
    input: 'Minimum, maximum, and near-boundary values',
    expected: 'Correct behavior at and around boundaries',
    notes: 'Consider numeric limits, string length limits, collection size limits',
  });

  if (
    specLower.includes('array') ||
    specLower.includes('list') ||
    specLower.includes('collection')
  ) {
    testCases.push({
      name: 'Single element collection',
      category: 'Edge Case',
      description: `${component} should handle a collection with exactly one element`,
      input: 'Collection with one element',
      expected: 'Correct behavior for single-element case',
      notes: '',
    });
  }

  // Error cases
  testCases.push({
    name: 'Invalid input type',
    category: 'Error Case',
    description: `${component} should reject or handle invalid input types`,
    input: 'Wrong type (e.g., string when number expected)',
    expected: 'Clear error message or defined fallback behavior',
    notes: 'Input validation is critical for robustness',
  });

  testCases.push({
    name: 'Error recovery',
    category: 'Error Case',
    description: `${component} should handle errors gracefully without crashing`,
    input: 'Input or conditions that trigger error paths',
    expected: 'Controlled error handling with informative messages',
    notes: '',
  });

  return testCases;
}
