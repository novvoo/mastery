import { mkdir, writeFile, access } from 'fs/promises';
import { join, resolve } from 'path';
import { ToolCategory } from '../../core/types.js';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slugify(value) {
  return String(value || 'project')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

export default function setup() {
  return {
    name: 'setup',
    description:
      'Initialize AI Engineering Mastery project context. Creates CONTEXT.md and docs/adr/0001-initial-setup.md with domain language, module map, docs paths, test framework, and code style notes. Run once per project before using other methodology skills.',
    category: ToolCategory.skill_productivity,
    params: {
      project_path: {
        type: 'string',
        description: 'Project path to initialize. Defaults to the current working directory.',
      },
      project_name: {
        type: 'string',
        description: 'Human-readable project name.',
      },
      issue_tracker: {
        type: 'string',
        description: 'Issue tracker choice such as GitHub Issues, Linear, or Local Files.',
      },
      docs_path: {
        type: 'string',
        description: 'Documentation directory. Defaults to docs.',
      },
      test_framework: {
        type: 'string',
        description: 'Detected or selected test framework such as bun test, jest, vitest, pytest, go test, or cargo test.',
      },
      code_style: {
        type: 'string',
        description: 'Comma-separated project-specific code style rules.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite existing CONTEXT.md or initial ADR if present. Defaults to false.',
      },
    },
    handler: async (params, ctx) => {
      const {
        project_path,
        project_name = 'AI Engineering Mastery Project',
        issue_tracker = 'GitHub Issues',
        docs_path = 'docs',
        test_framework = 'bun test',
        code_style = '',
        overwrite = false,
      } = params;
      const baseDir = resolve(project_path || ctx.workingDirectory || process.cwd());
      const docsDir = resolve(baseDir, docs_path);
      const adrDir = join(docsDir, 'adr');
      const contextPath = join(baseDir, 'CONTEXT.md');
      const adrPath = join(adrDir, '0001-initial-setup.md');
      const styleRules = String(code_style || '')
        .split(',')
        .map(rule => rule.trim())
        .filter(Boolean);

      await mkdir(adrDir, { recursive: true });

      const created = [];
      const skipped = [];

      if (overwrite || !(await exists(contextPath))) {
        await writeFile(contextPath, [
          `# Project Context`,
          ``,
          `## Project`,
          `- Name: ${project_name}`,
          `- Issue Tracker: ${issue_tracker}`,
          `- Docs Path: ${docs_path}`,
          `- Test Framework: ${test_framework}`,
          ``,
          `## Domain Language`,
          `- TODO: Add shared domain terms and definitions.`,
          ``,
          `## Module Map`,
          `- TODO: List major modules and their responsibilities.`,
          ``,
          `## Architecture Decisions`,
          `- See \`${docs_path}/adr/\` for ADRs.`,
          ``,
          `## Code Style`,
          ...(styleRules.length > 0
            ? styleRules.map(rule => `- ${rule}`)
            : [`- Follow existing project conventions.`, `- Keep changes surgical and tied to the request.`]),
          ``,
          `## Verification`,
          `- Default command: \`${test_framework}\``,
          ``,
        ].join('\n'), 'utf-8');
        created.push(contextPath);
      } else {
        skipped.push(contextPath);
      }

      if (overwrite || !(await exists(adrPath))) {
        await writeFile(adrPath, [
          `# ADR 0001: Initial Project Setup`,
          ``,
          `## Status`,
          `Accepted`,
          ``,
          `## Context`,
          `This repository uses the AI Engineering Mastery methodology as shared operating context for coding agents.`,
          ``,
          `## Decision`,
          `Use \`CONTEXT.md\` for domain language and module ownership, and \`${docs_path}/adr/\` for architecture decisions.`,
          ``,
          `## Consequences`,
          `- Agents should read \`CONTEXT.md\` before non-trivial changes.`,
          `- Significant architectural decisions should be recorded as ADRs.`,
          `- Verification should use \`${test_framework}\` unless a narrower command is more appropriate.`,
          ``,
        ].join('\n'), 'utf-8');
        created.push(adrPath);
      } else {
        skipped.push(adrPath);
      }

      if (ctx.memoryManager) {
        try {
          await ctx.memoryManager.store({
            key: `setup_${slugify(project_name)}`,
            value: {
              projectName: project_name,
              baseDir,
              contextPath,
              adrPath,
              testFramework: test_framework,
              issueTracker: issue_tracker,
            },
          });
        } catch {
          // Memory update is best-effort.
        }
      }

      return [
        `# Setup Complete`,
        ``,
        `Project: ${project_name}`,
        `Base directory: ${baseDir}`,
        ``,
        `## Created`,
        created.length > 0 ? created.map(path => `- ${path}`).join('\n') : '- None',
        ``,
        `## Skipped`,
        skipped.length > 0 ? skipped.map(path => `- ${path} (already exists)`).join('\n') : '- None',
        ``,
        `## Next Steps`,
        `- Use \`zoom_out\` before unfamiliar or cross-module changes.`,
        `- Use \`grill\` or \`brainstorm\` for ambiguous/non-trivial work.`,
        `- Use \`tdd\`, \`verify\`, and \`review\` to close coding tasks with evidence.`,
      ].join('\n');
    },
  };
}
