import { describe, expect, test } from 'bun:test';

import { PLAN_TEMPLATES } from '../../src/core/runtime/agent/support/plan-templates.js';

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
});
