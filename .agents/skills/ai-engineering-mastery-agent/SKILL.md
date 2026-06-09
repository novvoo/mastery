```markdown
# ai-engineering-mastery-agent Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and workflows for contributing to the `ai-engineering-mastery-agent` JavaScript codebase. You'll learn the project's coding conventions, how to refactor and optimize agent logic, and how to follow the repository's workflow for improving code efficiency and accuracy.

## Coding Conventions

- **File Naming:**  
  Use kebab-case for all file names.  
  _Example:_  
  ```
  agent-logic.js
  tool-router.js
  ```

- **Import Style:**  
  Use relative imports for modules.  
  _Example:_  
  ```js
  import { routeTool } from './tool-router.js';
  import { calculateScore } from '../utils/math.js';
  ```

- **Export Style:**  
  Use named exports.  
  _Example:_  
  ```js
  // In src/core/agent.js
  export function runAgent(input) { ... }
  export function stopAgent() { ... }
  ```

- **Commit Messages:**  
  Use conventional commits with the `feat` prefix for new features or improvements.  
  _Example:_  
  ```
  feat: optimize agent decision logic
  ```

## Workflows

### Improve Code Efficiency and Accuracy
**Trigger:** When you want to optimize or refactor core logic and tool-related modules for better performance or correctness.  
**Command:** `/improve-efficiency`

1. **Identify** inefficiencies or inaccuracies in the core logic or tool modules.
2. **Modify** relevant files, typically in:
   - `src/core/agent.js`
   - `src/core/tool-router.js`
   - Any files under `src/tools/*/*.js`
3. **Test** your changes to ensure correctness and improved performance.
4. **Commit** your changes with a message indicating code efficiency or accuracy improvements.
   - _Example:_  
     ```
     feat: improve tool routing performance
     ```
5. **Push** your changes and open a pull request for review.

#### Example Refactor
```js
// Before: inefficient loop in agent.js
export function processTasks(tasks) {
  let results = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(handleTask(tasks[i]));
  }
  return results;
}

// After: using map for clarity and efficiency
export function processTasks(tasks) {
  return tasks.map(handleTask);
}
```

## Testing Patterns

- **Test Files:**  
  Test files follow the `*.test.*` naming pattern, e.g., `agent.test.js`.
- **Testing Framework:**  
  The specific testing framework is not detected; check existing test files for patterns.
- **Example Test File:**  
  ```js
  // agent.test.js
  import { runAgent } from './agent.js';

  test('runAgent returns expected output', () => {
    const result = runAgent('input');
    expect(result).toBe('expected output');
  });
  ```

## Commands

| Command              | Purpose                                                      |
|----------------------|--------------------------------------------------------------|
| /improve-efficiency  | Refactor and enhance code efficiency and accuracy            |
```
