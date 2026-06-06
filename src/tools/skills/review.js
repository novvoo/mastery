import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ToolCategory } from '../../core/types.js';

/**
 * review - Code review with forbidden responses.
 * Reads the target file and generates a structured review report
 * with issues categorized by severity.
 */
export default function review() {
  return {
    name: 'review',
    description:
      'Code review tool that reads a file and generates a structured review report with issues categorized by severity (Critical/Warning/Suggestion). Enforces forbidden responses to ensure honest, actionable feedback.',
    category: ToolCategory.skill_engineering,
    params: {
      file_path: {
        type: 'string',
        description: 'Path to the file to review',
      },
      focus_areas: {
        type: 'string',
        description: 'Comma-separated list of focus areas for the review (e.g., "security,performance,readability")',
      },
    },
    required: ['file_path'],
    handler: async (params, ctx) => {
      const { file_path, focus_areas = '' } = params;
      const { workingDirectory } = ctx;

      const focusList = focus_areas
        ? focus_areas.split(',').map((f) => f.trim()).filter(Boolean)
        : [];

      // Resolve the file path relative to working directory if not absolute
      const absolutePath = resolve(workingDirectory || process.cwd(), file_path);

      let fileContent;
      try {
        fileContent = await readFile(absolutePath, 'utf-8');
      } catch (err) {
        return `# Code Review - Error\n\nUnable to read file: \`${file_path}\`\n\n**Error**: ${err.message}\n\nPlease verify the file path is correct and the file exists.`;
      }

      const fileLines = fileContent.split('\n');
      const overview = generateOverview(file_path, fileContent, fileLines);
      const issues = analyzeCode(fileContent, fileLines, focusList);
      const categorized = categorizeIssues(issues, focusList);

      return formatReviewReport(file_path, absolutePath, overview, categorized, focusList);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateOverview(filePath, content, lines) {
  const ext = filePath.split('.').pop().toLowerCase();

  // Detect language
  const langMap = {
    js: 'JavaScript', jsx: 'JavaScript (JSX)', ts: 'TypeScript', tsx: 'TypeScript (JSX)',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
    cpp: 'C++', c: 'C', cs: 'C#', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
  };

  const language = langMap[ext] || ext.toUpperCase() || 'Unknown';

  // Count metrics
  const totalLines = lines.length;
  const blankLines = lines.filter((l) => l.trim() === '').length;
  const commentLines = lines.filter((l) => /^\s*(\/\/|#|\/\*|\*|\*\/|<!--|--|;)/.test(l)).length;
  const codeLines = totalLines - blankLines - commentLines;

  // Detect exports / public API surface
  const exports = content.match(/export\s+(default\s+)?(function|class|const|let|var|async\s+function)\s+(\w+)/g) || [];

  return {
    language,
    totalLines,
    codeLines,
    blankLines,
    commentLines,
    exports: exports.map((e) => e.trim()),
  };
}

function analyzeCode(content, lines, focusAreas) {
  const issues = [];

  // --- Security Issues ---
  if (focusAreas.length === 0 || focusAreas.some((f) => f.toLowerCase().includes('security'))) {
    // Check for eval
    lines.forEach((line, i) => {
      if (/\beval\s*\(/.test(line)) {
        issues.push({
          line: i + 1,
          severity: 'Critical',
          category: 'Security',
          description: 'Use of eval() detected',
          detail: 'eval() executes arbitrary code and is a serious security risk. It can lead to code injection attacks.',
          suggestedFix: 'Use JSON.parse() for data deserialization, or Function constructor with explicit parameters if dynamic code execution is truly necessary.',
          reasoning: 'eval() bypasses all security boundaries and can execute malicious code if the input is not fully controlled.',
        });
      }
    });

    // Check for innerHTML
    lines.forEach((line, i) => {
      if (/\.innerHTML\s*=/.test(line) && !/sanitize|escape|DOMPurify/i.test(line)) {
        issues.push({
          line: i + 1,
          severity: 'Critical',
          category: 'Security',
          description: 'Unsanitized innerHTML assignment',
          detail: 'Setting innerHTML without sanitization can lead to XSS (Cross-Site Scripting) vulnerabilities.',
          suggestedFix: 'Use textContent for plain text, or sanitize HTML with a library like DOMPurify before assignment.',
          reasoning: 'XSS attacks can steal user data, hijack sessions, and perform actions on behalf of users.',
        });
      }
    });

    // Check for hardcoded secrets
    lines.forEach((line, i) => {
      if (/(password|secret|api_key|apikey|token|private_key)\s*[:=]\s*['"][^'"]{8,}/i.test(line) && !/process\.env|ENV|placeholder|example|xxx|dummy/i.test(line)) {
        issues.push({
          line: i + 1,
          severity: 'Critical',
          category: 'Security',
          description: 'Potential hardcoded secret detected',
          detail: 'Secrets, API keys, or passwords appear to be hardcoded in the source file.',
          suggestedFix: 'Move secrets to environment variables or a secrets management service. Use process.env or equivalent.',
          reasoning: 'Hardcoded secrets in source code are visible to anyone with repository access and are a major security risk.',
        });
      }
    });
  }

  // --- Performance Issues ---
  if (focusAreas.length === 0 || focusAreas.some((f) => f.toLowerCase().includes('performance'))) {
    // Check for synchronous file operations in async context
    lines.forEach((line, i) => {
      if (/\breadFileSync|writeFileSync|existsSync|execSync\b/.test(line)) {
        issues.push({
          line: i + 1,
          severity: 'Warning',
          category: 'Performance',
          description: 'Synchronous file system operation detected',
          detail: 'Synchronous I/O operations block the event loop and can cause performance degradation.',
          suggestedFix: 'Use the async equivalents (readFile, writeFile, exists) with await or callbacks.',
          reasoning: 'In server environments, blocking the event loop affects all concurrent requests.',
        });
      }
    });

    // Check for nested loops (potential O(n^2))
    let loopDepth = 0;
    lines.forEach((line, i) => {
      const opens = (line.match(/\b(for|while)\b/g) || []).length;
      const closes = (line.match(/\b\}\b/g) || []).length;
      loopDepth += opens - closes;
      if (loopDepth >= 3) {
        issues.push({
          line: i + 1,
          severity: 'Warning',
          category: 'Performance',
          description: 'Deeply nested loops detected (depth >= 3)',
          detail: 'Three or more nested loops can result in O(n^3) or worse time complexity.',
          suggestedFix: 'Consider using hash maps, sorting, or algorithmic optimization to reduce nesting.',
          reasoning: 'Deep nesting often indicates an algorithm that will degrade badly with larger inputs.',
        });
        loopDepth = 0; // Report once
      }
    });
  }

  // --- Correctness Issues ---
  if (focusAreas.length === 0 || focusAreas.some((f) => f.toLowerCase().includes('correctness'))) {
    // Check for == instead of ===
    lines.forEach((line, i) => {
      if (/[^!=<>]==[^=]/.test(line) && !/\/\//.test(line.split('==')[0])) {
        issues.push({
          line: i + 1,
          severity: 'Warning',
          category: 'Correctness',
          description: 'Loose equality (==) detected',
          detail: 'Using == instead of === can lead to unexpected type coercion.',
          suggestedFix: 'Use strict equality (===) to avoid type coercion surprises.',
          reasoning: 'JavaScript\'s type coercion rules with == are complex and error-prone.',
        });
      }
    });

    // Check for empty catch blocks
    for (let i = 0; i < lines.length; i++) {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(lines[i])) {
        issues.push({
          line: i + 1,
          severity: 'Warning',
          category: 'Correctness',
          description: 'Empty catch block detected',
          detail: 'Errors are being silently swallowed without any handling or logging.',
          suggestedFix: 'At minimum, log the error. Consider whether the error should be propagated or handled.',
          reasoning: 'Silent error swallowing makes debugging extremely difficult and can mask serious issues.',
        });
      }
    }

    // Check for unused variables (simple heuristic)
    lines.forEach((line, i) => {
      const match = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
      if (match) {
        const varName = match[1];
        const varOccurrences = content.split(varName).length - 1;
        if (varOccurrences <= 1) {
          issues.push({
            line: i + 1,
            severity: 'Suggestion',
            category: 'Correctness',
            description: `Potentially unused variable: ${varName}`,
            detail: `The variable "${varName}" is declared but does not appear to be used elsewhere in the file.`,
            suggestedFix: 'Remove the unused variable or verify it is used in a way not detected by this analysis.',
            reasoning: 'Unused variables add noise and may indicate dead code or a mistake.',
          });
        }
      }
    });
  }

  // --- Readability Issues ---
  if (focusAreas.length === 0 || focusAreas.some((f) => f.toLowerCase().includes('readability'))) {
    // Check for very long lines
    lines.forEach((line, i) => {
      if (line.length > 120) {
        issues.push({
          line: i + 1,
          severity: 'Suggestion',
          category: 'Readability',
          description: `Line exceeds 120 characters (${line.length} chars)`,
          detail: 'Long lines reduce readability and make diffs harder to review.',
          suggestedFix: 'Break the line into multiple lines following your project\'s line length convention.',
          reasoning: 'Most code style guides recommend lines under 100-120 characters.',
        });
      }
    });

    // Check for very long functions (simple heuristic)
    let functionStart = -1;
    let braceCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/function\s+\w+|=>\s*\{|const\s+\w+\s*=\s*(async\s+)?\(/.test(lines[i]) && functionStart === -1) {
        functionStart = i;
        braceCount = 0;
      }
      if (functionStart >= 0) {
        braceCount += (lines[i].match(/\{/g) || []).length;
        braceCount -= (lines[i].match(/\}/g) || []).length;
        if (braceCount <= 0 && i > functionStart) {
          const funcLength = i - functionStart + 1;
          if (funcLength > 50) {
            issues.push({
              line: functionStart + 1,
              severity: 'Suggestion',
              category: 'Readability',
              description: `Long function detected (~${funcLength} lines)`,
              detail: 'Functions exceeding 50 lines are harder to understand, test, and maintain.',
              suggestedFix: 'Consider breaking the function into smaller, focused helper functions.',
              reasoning: 'Shorter functions are easier to name, test, reason about, and reuse.',
            });
          }
          functionStart = -1;
        }
      }
    }
  }

  return issues;
}

function categorizeIssues(issues, focusAreas) {
  const critical = issues.filter((i) => i.severity === 'Critical');
  const warnings = issues.filter((i) => i.severity === 'Warning');
  const suggestions = issues.filter((i) => i.severity === 'Suggestion');

  return { critical, warnings, suggestions, total: issues.length };
}

function formatReviewReport(filePath, absolutePath, overview, categorized, focusAreas) {
  const lines = [
    '# Code Review Report',
    '',
    `**File**: \`${filePath}\``,
    '',
    `**Resolved Path**: \`${absolutePath}\``,
    '',
    '---',
    '',
    '## Overview',
    '',
    `| Property | Value |`,
    `|----------|-------|`,
    `| Language | ${overview.language} |`,
    `| Total Lines | ${overview.totalLines} |`,
    `| Code Lines | ${overview.codeLines} |`,
    `| Comment Lines | ${overview.commentLines} |`,
    `| Blank Lines | ${overview.blankLines} |`,
  ];

  if (overview.exports.length > 0) {
    lines.push(`| Exports | ${overview.exports.length} |`);
    lines.push('');
    lines.push('**Exported API**:');
    overview.exports.forEach((exp) => {
      lines.push(`- \`${exp}\``);
    });
  }

  if (focusAreas.length > 0) {
    lines.push('');
    lines.push(`**Focus Areas**: ${focusAreas.join(', ')}`);
  }

  lines.push(
    '',
    '---',
    '',
    '## Issues Summary',
    '',
    `| Severity | Count |`,
    `|----------|-------|`,
    `| :red_circle: Critical | ${categorized.critical.length} |`,
    `| :yellow_circle: Warning | ${categorized.warnings.length} |`,
    `| :blue_circle: Suggestion | ${categorized.suggestions.length} |`,
    `| **Total** | **${categorized.total}** |`,
  );

  // Critical Issues
  if (categorized.critical.length > 0) {
    lines.push('', '---', '', '## Critical Issues', '');
    categorized.critical.forEach((issue, i) => {
      lines.push(formatIssue(issue, i + 1));
    });
  }

  // Warnings
  if (categorized.warnings.length > 0) {
    lines.push('', '---', '', '## Warnings', '');
    categorized.warnings.forEach((issue, i) => {
      lines.push(formatIssue(issue, i + 1));
    });
  }

  // Suggestions
  if (categorized.suggestions.length > 0) {
    lines.push('', '---', '', '## Suggestions', '');
    categorized.suggestions.forEach((issue, i) => {
      lines.push(formatIssue(issue, i + 1));
    });
  }

  if (categorized.total === 0) {
    lines.push('', '> No issues found. The code appears clean within the scope of this analysis.');
  }

  lines.push(
    '',
    '---',
    '',
    '## Forbidden Responses Reminder',
    '',
    '> The following responses are **FORBIDDEN** in code reviews:',
    '>',
    '> 1. **"Looks good to me"** without specific, substantive observations',
    '> 2. **"Nice!"** or other empty praise without actionable feedback',
    '> 3. **"I think it\'s fine"** without identifying at least one concrete improvement',
    '> 4. **Silence** - a review with no issues found MUST still include observations about what was checked and why it passes',
    '>',
    '> Every review must contain **specific, actionable, and honest** feedback.',
    '',
    '---',
    '',
    '> **Next Steps**: Address Critical issues before merging. Warnings should be addressed if time permits. Suggestions are optional improvements.',
    ''
  );

  return lines.join('\n');
}

function formatIssue(issue, index) {
  const lines = [
    `### Issue ${index}: ${issue.description}`,
    '',
    `- **Location**: Line ${issue.line}`,
    `- **Category**: ${issue.category}`,
    `- **Severity**: ${issue.severity}`,
    '',
    `**Detail**: ${issue.detail}`,
    '',
    `**Suggested Fix**: ${issue.suggestedFix}`,
    '',
    `**Reasoning**: ${issue.reasoning}`,
    '',
  ];
  return lines.join('\n');
}
