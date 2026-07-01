export const FixTemplates = Object.freeze({
  MODULE_SYSTEM_ERROR: {
    id: 'module_system_conflict',
    name: 'Module System Conflict',
    description: 'ESM/CommonJS module syntax mismatch',
    detectionPatterns: [
      /Cannot use import statement outside a module/i,
      /'require' is not defined/i,
      /'module' is not defined/i,
      /ES module/i,
      /CommonJS/i,
      /ERR_REQUIRE_ESM/i,
    ],
    analysisSteps: [
      { step: 'Read package.json and check the "type" field' },
      { step: 'Identify files using require()/module.exports (CommonJS)' },
      { step: 'Identify files using import/export (ESM)' },
      { step: 'Determine the target module system based on package.json' },
    ],
    fixStrategies: [
      {
        name: 'Convert to ESM',
        conditions: [{ condition: 'package.json has "type": "module"' }],
        actions: [
          { action: 'Replace require() with import statements' },
          { action: 'Replace module.exports with export statements' },
          { action: 'Replace __dirname/__filename with import.meta.url equivalents' },
        ],
      },
      {
        name: 'Convert to CommonJS',
        conditions: [{ condition: 'package.json does NOT have "type": "module"' }],
        actions: [
          { action: 'Replace import statements with require()' },
          { action: 'Replace export statements with module.exports' },
        ],
      },
      {
        name: 'Use file extensions',
        conditions: [{ condition: 'Mixed module types needed' }],
        actions: [
          { action: 'Rename ESM files to .mjs' },
          { action: 'Rename CommonJS files to .cjs' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the test/build command again' },
      { step: 'Verify no module-related errors remain' },
    ],
  },

  MISSING_DEPENDENCY: {
    id: 'missing_dependency',
    name: 'Missing Dependency',
    description: 'Package or module not installed',
    detectionPatterns: [
      /ModuleNotFoundError/i,
      /Cannot find module/i,
      /require\(\) of ES Module/i,
      /Error: Cannot find module/i,
      /ENOENT.*node_modules/i,
    ],
    analysisSteps: [
      { step: 'Extract the missing package name from the error' },
      { step: 'Check package.json for existing dependencies' },
      { step: 'Determine if this is a dev or production dependency' },
    ],
    fixStrategies: [
      {
        name: 'Install missing package',
        conditions: [],
        actions: [
          { action: 'Run: npm install <package-name>' },
          { action: 'For dev dependencies: npm install -D <package-name>' },
        ],
      },
      {
        name: 'Reinstall all dependencies',
        conditions: [{ condition: 'Multiple dependencies missing' }],
        actions: [
          { action: 'Delete node_modules directory' },
          { action: 'Delete package-lock.json or yarn.lock' },
          { action: 'Run: npm install' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the command again' },
      { step: 'Verify the dependency is now available' },
    ],
  },

  TYPE_ERROR: {
    id: 'type_error',
    name: 'Type Error',
    description: 'Value of wrong type passed to function',
    detectionPatterns: [
      /TypeError:/i,
      /is not a function/i,
      /Cannot read properties of undefined/i,
      /Cannot read properties of null/i,
      /Cannot set properties of undefined/i,
      /undefined is not an object/i,
      /null is not an object/i,
    ],
    analysisSteps: [
      { step: 'Identify the line number and variable name from stack trace' },
      { step: 'Read the affected file to understand the context' },
      { step: 'Check what value is being passed vs what is expected' },
      { step: 'Trace the value back to its source' },
    ],
    fixStrategies: [
      {
        name: 'Add null/undefined check',
        conditions: [{ condition: 'Value is null or undefined' }],
        actions: [
          { action: 'Add early return or guard clause' },
          { action: 'Add default value assignment' },
          { action: 'Add validation before using the value' },
        ],
      },
      {
        name: 'Fix function call',
        conditions: [{ condition: 'Calling a non-function value' }],
        actions: [
          { action: 'Check if the function exists on the object' },
          { action: 'Verify the import is correct' },
          { action: 'Ensure the value is initialized before calling' },
        ],
      },
      {
        name: 'Fix type coercion',
        conditions: [{ condition: 'Type mismatch in comparison or arithmetic' }],
        actions: [
          { action: 'Use explicit type conversion (Number(), String(), etc.)' },
          { action: 'Use strict equality (===) instead of loose (==)' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the test again' },
      { step: 'Verify the type error is resolved' },
    ],
  },

  SYNTAX_ERROR: {
    id: 'syntax_error',
    name: 'Syntax Error',
    description: 'Invalid JavaScript/TypeScript syntax',
    detectionPatterns: [
      /SyntaxError:/i,
      /Unexpected token/i,
      /Unexpected end of input/i,
      /Invalid or unexpected token/i,
      /Missing semicolon/i,
      /Unexpected reserved word/i,
    ],
    analysisSteps: [
      { step: 'Note the line number from the error' },
      { step: 'Read the affected file around that line' },
      { step: 'Check for missing parentheses, brackets, or braces' },
      { step: 'Check for typos in keywords' },
    ],
    fixStrategies: [
      {
        name: 'Fix missing brackets/parentheses',
        conditions: [{ condition: 'Mismatched brackets or parentheses' }],
        actions: [
          { action: 'Add closing bracket/parenthesis' },
          { action: 'Remove extra opening bracket/parenthesis' },
        ],
      },
      {
        name: 'Fix unexpected tokens',
        conditions: [{ condition: 'Unexpected token error' }],
        actions: [
          { action: 'Remove or fix the problematic character' },
          { action: 'Check for special characters that may be invisible' },
        ],
      },
      {
        name: 'Fix reserved words',
        conditions: [{ condition: 'Using reserved word as identifier' }],
        actions: [
          { action: 'Rename the variable/function' },
          { action: 'Use quotes for property names if needed' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the test/build again' },
      { step: 'Verify the syntax error is resolved' },
    ],
  },

  ASSERTION_ERROR: {
    id: 'assertion_error',
    name: 'Assertion Error',
    description: 'Test assertion failure',
    detectionPatterns: [
      /AssertionError:/i,
      /Expected.*to be/i,
      /Expected.*to equal/i,
      /Expected.*to deep equal/i,
      /Test failed/i,
      /Assertion failed/i,
    ],
    analysisSteps: [
      { step: 'Read the assertion message to understand what failed' },
      { step: 'Identify the expected vs actual values' },
      { step: 'Read the test file to understand the test case' },
      { step: 'Read the source code being tested' },
    ],
    fixStrategies: [
      {
        name: 'Fix implementation to match expected behavior',
        conditions: [{ condition: 'Implementation produces wrong result' }],
        actions: [
          { action: 'Correct the logic in the source code' },
          { action: 'Fix edge cases' },
          { action: 'Fix off-by-one errors' },
        ],
      },
      {
        name: 'Fix test expectations',
        conditions: [{ condition: 'Test expectations are incorrect' }],
        actions: [
          { action: 'Update assertion to match actual behavior' },
          { action: 'Fix test data or setup' },
        ],
      },
      {
        name: 'Fix test API mismatch',
        conditions: [{ condition: 'Test uses wrong API or method names' }],
        actions: [
          { action: 'Update test to use correct method names' },
          { action: 'Update test to use correct parameter order' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the specific test again' },
      { step: 'Verify the assertion passes' },
    ],
  },

  PERMISSION_ERROR: {
    id: 'permission_error',
    name: 'Permission Error',
    description: 'File or directory access denied',
    detectionPatterns: [
      /PermissionError/i,
      /EACCES/i,
      /EPERM/i,
      /access denied/i,
      /permission denied/i,
      /cannot write/i,
      /cannot read/i,
    ],
    analysisSteps: [
      { step: 'Identify the file/directory causing the error' },
      { step: 'Check current permissions on the file/directory' },
      { step: 'Determine if running as correct user' },
    ],
    fixStrategies: [
      {
        name: 'Change file permissions',
        conditions: [{ condition: 'Missing read/write permissions' }],
        actions: [
          { action: 'Run: chmod +rw <file>' },
          { action: 'Run: chown <user>:<group> <file>' },
        ],
      },
      {
        name: 'Run with elevated privileges',
        conditions: [{ condition: 'Need admin/sudo access' }],
        actions: [
          { action: 'Prefix command with sudo' },
          { action: 'Run as root user' },
        ],
      },
      {
        name: 'Change output directory',
        conditions: [{ condition: 'Cannot write to target directory' }],
        actions: [
          { action: 'Specify a different output path' },
          { action: 'Create the directory first' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the command again' },
      { step: 'Verify the permission error is resolved' },
    ],
  },

  TIMEOUT_ERROR: {
    id: 'timeout_error',
    name: 'Timeout Error',
    description: 'Operation took too long',
    detectionPatterns: [
      /Timeout/i,
      /timed out/i,
      /ETIMEDOUT/i,
      /Operation timed out/i,
      /exceeded timeout/i,
    ],
    analysisSteps: [
      { step: 'Identify what operation timed out' },
      { step: 'Check if the operation is expected to be slow' },
      { step: 'Check network connectivity if applicable' },
      { step: 'Check resource usage (CPU, memory)' },
    ],
    fixStrategies: [
      {
        name: 'Increase timeout',
        conditions: [{ condition: 'Operation needs more time' }],
        actions: [
          { action: 'Add --timeout flag with higher value' },
          { action: 'Modify configuration to increase timeout' },
        ],
      },
      {
        name: 'Optimize slow operation',
        conditions: [{ condition: 'Operation is slower than expected' }],
        actions: [
          { action: 'Profile the code to find bottlenecks' },
          { action: 'Optimize algorithms or database queries' },
        ],
      },
      {
        name: 'Fix network issues',
        conditions: [{ condition: 'Network timeout' }],
        actions: [
          { action: 'Check network connectivity' },
          { action: 'Check if the remote server is available' },
          { action: 'Retry the operation' },
        ],
      },
    ],
    verificationSteps: [
      { step: 'Run the operation again' },
      { step: 'Verify it completes within the timeout' },
    ],
  },
});

export function findMatchingTemplates(errorMessage) {
  const matches = [];
  for (const [key, template] of Object.entries(FixTemplates)) {
    for (const pattern of template.detectionPatterns) {
      if (pattern.test(errorMessage)) {
        matches.push({ ...template, errorType: key });
        break;
      }
    }
  }
  return matches;
}

export function generateFixPlan(errorMessage) {
  const templates = findMatchingTemplates(errorMessage);
  if (templates.length === 0) {
    return null;
  }

  const primaryTemplate = templates[0];
  return {
    errorType: primaryTemplate.errorType,
    name: primaryTemplate.name,
    description: primaryTemplate.description,
    analysisSteps: primaryTemplate.analysisSteps.map((s) => s.step),
    recommendedStrategy: primaryTemplate.fixStrategies[0],
    allStrategies: primaryTemplate.fixStrategies,
    verificationSteps: primaryTemplate.verificationSteps.map((s) => s.step),
  };
}
