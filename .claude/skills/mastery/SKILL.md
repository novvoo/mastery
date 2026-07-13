```markdown
# mastery Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `mastery` repository, a React-based JavaScript codebase. You'll learn file naming, import/export styles, commit message habits, and how to structure and write tests. This guide also provides suggested commands for common workflows.

## Coding Conventions

### File Naming
- Use **kebab-case** for all file names.
  - **Example:**  
    `user-profile.js`  
    `dashboard-header.test.js`

### Import Style
- Use **relative imports** for modules within the project.
  - **Example:**
    ```js
    import { UserProfile } from './user-profile';
    import { DashboardHeader } from '../components/dashboard-header';
    ```

### Export Style
- Use **named exports** for all modules.
  - **Example:**
    ```js
    // user-profile.js
    export function UserProfile() {
      // component code
    }
    ```

### Commit Patterns
- Commit messages are **freeform** (no strict prefix or format).
- Average length is about 30 characters.
  - **Example:**  
    `add user profile component`  
    `fix bug in dashboard header`

## Workflows

_No explicit workflows detected in the repository._

## Testing Patterns

- **Test File Naming:**  
  Test files use the `*.test.*` pattern and are placed alongside the files they test.
  - **Example:**  
    `user-profile.test.js`

- **Testing Framework:**  
  The specific framework is unknown, but tests follow the standard `.test.js` convention.

- **Test Example:**
    ```js
    // user-profile.test.js
    import { UserProfile } from './user-profile';

    describe('UserProfile', () => {
      it('renders without crashing', () => {
        // test implementation
      });
    });
    ```

## Commands
| Command | Purpose |
|---------|---------|
| /new-component | Scaffold a new React component with kebab-case naming and named exports |
| /run-tests | Run all test files matching *.test.* |
| /lint | Lint the codebase to ensure style consistency |
```