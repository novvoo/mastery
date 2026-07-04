import { describe, expect, test } from 'bun:test';

import {
  getPlanTemplateByTaskType,
  PLAN_TEMPLATES,
} from '../../src/core/runtime/agent/support/plan-templates.js';

describe('plan templates', () => {
  test('describe professional evidence gates without ceremonial methodology language', () => {
    const text = JSON.stringify(PLAN_TEMPLATES);

    expect(text).toContain('focused evidence');
    expect(text).toContain('planning proportional to risk');
    expect(text).toContain('regression evidence');

    expect(text).not.toContain('comprehensive reporting');
    expect(text).not.toContain('all necessary information for thorough analysis');
    expect(text).not.toContain('Full-cycle development workflow');
    expect(text).not.toContain('TDD methodology');
    expect(text).not.toContain('TDD approach followed');
  });

  test('quick edits require context evidence before mutation', () => {
    const template = getPlanTemplateByTaskType('quick');
    const taskIds = template.tasks.map((task) => task.id);
    const verifyContext = template.tasks.find((task) => task.id === 'verify_context');
    const implement = template.tasks.find((task) => task.id === 'implement_changes');

    expect(taskIds.slice(0, 2)).toEqual(['verify_context', 'implement_changes']);
    expect(verifyContext.phase).toBe('exploration');
    expect(verifyContext.allowedTools).toContain('read_file');
    expect(implement.dependencies).toContain('verify_context');
  });

  test('new project plans include a design gate before writing files', () => {
    const template = getPlanTemplateByTaskType('new_project');
    const taskIds = template.tasks.map((task) => task.id);
    const design = template.tasks.find((task) => task.id === 'design_project');
    const setup = template.tasks.find((task) => task.id === 'setup_project_structure');

    expect(taskIds.indexOf('design_project')).toBeLessThan(
      taskIds.indexOf('setup_project_structure'),
    );
    expect(design.phase).toBe('planning');
    expect(design.allowedTools).toContain('capture_requirements');
    expect(setup.dependencies).toEqual(['design_project']);
  });

  test('code review template stays read-only and avoids implementation phase', () => {
    const template = getPlanTemplateByTaskType('code_review');
    const mutationTools = new Set([
      'write_file',
      'edit_file',
      'delete_file',
      'rename_file',
      'mkdir',
      'apply_hashline_patch',
      'git_apply_patch',
    ]);

    expect(template.phases).not.toContain('implementation');
    for (const task of template.tasks) {
      expect(task.phase).not.toBe('implementation');
      expect((task.allowedTools || []).some((tool) => mutationTools.has(tool))).toBe(false);
    }
  });
});
