```markdown
# ai-engineering-mastery-agent Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `ai-engineering-mastery-agent` repository, a React-based JavaScript project. You'll learn about file naming, import/export styles, commit conventions, and how to write and run tests using Jest. This guide is essential for maintaining consistency and quality in the codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userProfile.js`, `dashboardView.js`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```javascript
    import { fetchData } from './apiUtils';
    import UserCard from '../components/userCard';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```javascript
    // In userProfile.js
    export function UserProfile(props) {
      // component code
    }
    ```
    ```javascript
    // Importing
    import { UserProfile } from './userProfile';
    ```

### Commit Patterns
- Commit messages are **freeform** with no strict prefix requirement.
- Typical commit message length is around 40 characters.
  - Example:  
    ```
    Add user authentication to dashboard
    ```

## Workflows

_No specific automated workflows detected in the repository._

## Testing Patterns

- **Framework:** Jest
- **Test file pattern:** Files end with `.test.js`
  - Example: `userProfile.test.js`
- **How to write tests:**
  - Place test files alongside the modules they test or in a `__tests__` directory.
  - Use named exports in your modules for easy importing in tests.

  Example test:
  ```javascript
  // userProfile.test.js
  import { UserProfile } from './userProfile';

  test('renders user profile component', () => {
    // Test implementation
  });
  ```

- **How to run tests:**
  - Use the following command:
    ```
    npm test
    ```

## Commands
| Command | Purpose |
|---------|---------|
| /test   | Run all Jest tests in the project |
| /lint   | (If applicable) Run linter to check code style |
| /build  | (If applicable) Build the project for production |

```