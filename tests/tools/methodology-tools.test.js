import { describe, test, expect } from 'bun:test';
import {
  createDataContractCheckTool,
  createImpactMapTool,
  createMigrationPlanTool,
  createProjectProfileTool,
  createReleaseChecklistTool,
  createRiskCheckTool,
  createSecurityReviewTool,
  createTestStrategyTool,
  createUiAcceptanceTool,
} from '../../src/tools/skills/methodology.js';
import { SKILL_TOOL_CREATORS } from '../../src/tools/index.js';

describe('expanded methodology tools', () => {
  test('all methodology tools expose callable handlers', () => {
    const tools = [
      createImpactMapTool(),
      createProjectProfileTool(),
      createRiskCheckTool(),
      createTestStrategyTool(),
      createMigrationPlanTool(),
      createReleaseChecklistTool(),
      createUiAcceptanceTool(),
      createDataContractCheckTool(),
      createSecurityReviewTool(),
    ];

    expect(tools.map((tool) => tool.name)).toEqual([
      'impact_map',
      'project_profile',
      'risk_check',
      'test_strategy',
      'migration_plan',
      'release_checklist',
      'ui_acceptance',
      'data_contract_check',
      'security_review',
    ]);
    expect(tools.every((tool) => typeof tool.handler === 'function')).toBe(true);
  });

  test('tools are registered through skill tool creators as individual tools', () => {
    const names = SKILL_TOOL_CREATORS.map((creator) => creator()?.name).filter(Boolean);
    expect(names).toContain('impact_map');
    expect(names).toContain('project_profile');
    expect(names).toContain('security_review');
    expect(names).toContain('data_contract_check');
  });

  test('security_review produces focused checklist output', async () => {
    const tool = createSecurityReviewTool();
    const result = await tool.handler({
      surface: 'auth token refresh',
      threat: 'permission bypass',
    });
    expect(result).toContain('Security Review');
    expect(result).toContain('permission bypass');
  });
});
