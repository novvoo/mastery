import { describe, test, expect } from 'bun:test';
import createBrainstormTool from '../../src/tools/skills/brainstorm.js';
import createTddTool from '../../src/tools/skills/tdd.js';
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
    expect(names).toContain('auto_research');
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

  test('brainstorm is an optional planning aid, not a hard gate', async () => {
    const tool = createBrainstormTool();
    const result = await tool.handler({
      problem: 'Refactor parser planning behavior',
      constraints: 'avoid ceremonial tool calls',
    });

    expect(tool.description).toContain('Optional design exploration');
    expect(result).toContain('Planning aid');
    expect(result).not.toContain('HARD-GATE');
    expect(result).not.toContain('must be reviewed and approved');
  });

  test('tdd guidance does not forbid implementation when evidence already exists', async () => {
    const tool = createTddTool();
    const result = await tool.handler({
      component: 'parser',
      spec: 'does not coerce plan task ids into brainstorm calls',
      phase: 'red',
    });

    expect(result).toContain('Prefer a focused failing test');
    expect(result).toContain('If stronger evidence already exists');
    expect(result).not.toContain('Do NOT write any implementation code');
  });
});
