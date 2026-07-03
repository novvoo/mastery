import { ToolCategory } from '../../core/types/index.js';

function lines(title, sections) {
  return [
    `# ${title}`,
    '',
    ...sections.flatMap(([heading, items]) => [
      `## ${heading}`,
      ...items.map((item) => `- ${item}`),
      '',
    ]),
  ].join('\n');
}

export function createImpactMapTool() {
  return {
    name: 'impact_map',
    description:
      'Methodology tool for mapping blast radius before cross-module, refactor, migration, UI, data, API, or security changes.',
    category: ToolCategory.skill_engineering,
    params: {
      change: { type: 'string', description: 'The proposed change or task.' },
      surfaces: {
        type: 'string',
        description: 'Comma-separated known affected surfaces such as API, UI, data, auth, tests.',
      },
    },
    required: ['change'],
    handler: async ({ change, surfaces = '' }) => {
      const surfaceList = surfaces
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const scope = surfaceList.length ? surfaceList.join(', ') : 'code, tests, runtime behavior';
      return lines('Impact Map', [
        ['Change', [change]],
        ['Likely affected surfaces', [scope]],
        [
          'Checks',
          [
            'Identify direct call sites and dependent modules before editing.',
            'Look for contracts: public APIs, schemas, events, files, env vars, or UI states.',
            'Plan at least one verification path for each high-risk surface.',
          ],
        ],
        [
          'Recommended next step',
          ['Use targeted read/search tools, then update the plan if the affected scope changes.'],
        ],
      ]);
    },
  };
}

export function createProjectProfileTool() {
  return {
    name: 'project_profile',
    description:
      'Methodology tool for profiling an existing in-development codebase before planning edits: config files, package manager, scripts, test modules, lint/build commands, and local conventions.',
    category: ToolCategory.skill_engineering,
    params: {
      task: { type: 'string', description: 'The code task being planned.' },
      focus: {
        type: 'string',
        description: 'Optional focus such as tests, config, frontend, backend, data, release.',
      },
    },
    required: ['task'],
    handler: async ({ task, focus = '' }) =>
      lines('Project Profile', [
        ['Task', [task]],
        ['Focus', [focus || 'existing project configuration, tests, scripts, conventions']],
        [
          'Inspect first',
          [
            'Identify package manager and project entry points from package/config files.',
            'Find available scripts for test, lint, typecheck, build, dev, or preview.',
            'Locate existing test modules, fixtures, and test naming conventions.',
            'Check framework/tooling config that constrains the implementation.',
          ],
        ],
        [
          'Use in plan',
          [
            'Choose implementation style that matches existing project conventions.',
            'Choose the narrowest useful verification command from discovered scripts/tests.',
            'Update the plan if required config, missing scripts, or absent tests change the scope.',
          ],
        ],
      ]),
  };
}

export function createRiskCheckTool() {
  return {
    name: 'risk_check',
    description:
      'Methodology tool for explicit risk triage before or after risky edits, covering correctness, compatibility, security, data, and rollback.',
    category: ToolCategory.skill_engineering,
    params: {
      task: { type: 'string', description: 'The task or change being assessed.' },
      risk_domains: {
        type: 'string',
        description: 'Comma-separated risk domains such as security, data, API, performance.',
      },
      stage: {
        type: 'string',
        enum: ['before', 'after'],
        description: 'Whether this is a pre-change or post-change risk check.',
      },
    },
    required: ['task'],
    handler: async ({ task, risk_domains = '', stage = 'before' }) => {
      const domains =
        risk_domains
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .join(', ') || 'correctness, compatibility, tests, rollback';
      return lines(`${stage === 'after' ? 'Post-change' : 'Pre-change'} Risk Check`, [
        ['Task', [task]],
        ['Risk domains', [domains]],
        [
          'Required reasoning',
          [
            'Name assumptions that could be wrong.',
            'Name the most likely regression path.',
            'Choose evidence needed before final answer.',
          ],
        ],
      ]);
    },
  };
}

export function createTestStrategyTool() {
  return {
    name: 'test_strategy',
    description:
      'Methodology tool for planning targeted tests and verification evidence before implementation or after debugging.',
    category: ToolCategory.skill_engineering,
    params: {
      behavior: { type: 'string', description: 'Behavior, bug, or feature to verify.' },
      test_level: {
        type: 'string',
        description: 'Preferred level: unit, integration, e2e, manual, lint, build, or mixed.',
      },
      constraints: {
        type: 'string',
        description: 'Known constraints or unavailable test runners.',
      },
    },
    required: ['behavior'],
    handler: async ({ behavior, test_level = 'mixed', constraints = '' }) =>
      lines('Test Strategy', [
        ['Behavior under test', [behavior]],
        ['Recommended level', [test_level]],
        [
          'Cases',
          [
            'Happy path that proves the requested behavior.',
            'Regression or edge case tied to the original bug/risk.',
            'Failure mode or boundary condition when practical.',
          ],
        ],
        ['Constraints', [constraints || 'None provided']],
      ]),
  };
}

export function createMigrationPlanTool() {
  return {
    name: 'migration_plan',
    description:
      'Methodology tool for sequencing migrations, upgrades, schema changes, API transitions, and compatibility work.',
    category: ToolCategory.skill_engineering,
    params: {
      migration: { type: 'string', description: 'The migration or upgrade to perform.' },
      compatibility: {
        type: 'string',
        description: 'Compatibility requirements or old/new versions.',
      },
    },
    required: ['migration'],
    handler: async ({ migration, compatibility = '' }) =>
      lines('Migration Plan', [
        ['Migration', [migration]],
        ['Compatibility', [compatibility || 'Identify old and new behavior before editing']],
        [
          'Sequence',
          [
            'Inventory current usage and data/API contracts.',
            'Introduce compatible changes before removing old paths.',
            'Verify migrated and legacy paths when applicable.',
            'Document rollback or recovery steps for risky migrations.',
          ],
        ],
      ]),
  };
}

export function createReleaseChecklistTool() {
  return {
    name: 'release_checklist',
    description:
      'Methodology tool for release, deployment, packaging, changelog, and CI readiness checks.',
    category: ToolCategory.skill_engineering,
    params: {
      release_goal: { type: 'string', description: 'What is being released or deployed.' },
      target: { type: 'string', description: 'Target environment, package, version, or platform.' },
    },
    required: ['release_goal'],
    handler: async ({ release_goal, target = '' }) =>
      lines('Release Checklist', [
        ['Release goal', [release_goal]],
        ['Target', [target || 'Not specified']],
        [
          'Checks',
          [
            'Working tree and diff are understood.',
            'Versioning/changelog/package metadata are correct if applicable.',
            'Build, tests, lint, or smoke checks are selected.',
            'Deployment or rollback notes are captured for risky changes.',
          ],
        ],
      ]),
  };
}

export function createUiAcceptanceTool() {
  return {
    name: 'ui_acceptance',
    description:
      'Methodology tool for defining UI acceptance criteria, responsive states, accessibility checks, and preview verification.',
    category: ToolCategory.skill_engineering,
    params: {
      experience: { type: 'string', description: 'The UI/UX change or screen being worked on.' },
      states: { type: 'string', description: 'Comma-separated UI states to verify.' },
    },
    required: ['experience'],
    handler: async ({ experience, states = '' }) =>
      lines('UI Acceptance Criteria', [
        ['Experience', [experience]],
        ['States to verify', [states || 'default, loading, error, empty, mobile, desktop']],
        [
          'Acceptance checks',
          [
            'Text fits without overlap at mobile and desktop widths.',
            'Interactive controls have clear affordances and accessible labels.',
            'Preview or browser verification is planned when a dev server is available.',
          ],
        ],
      ]),
  };
}

export function createDataContractCheckTool() {
  return {
    name: 'data_contract_check',
    description:
      'Methodology tool for validating data shape, schemas, queries, migrations, transformations, and compatibility contracts.',
    category: ToolCategory.skill_engineering,
    params: {
      contract: { type: 'string', description: 'The data contract, schema, query, or transform.' },
      consumers: { type: 'string', description: 'Known consumers or downstream dependencies.' },
    },
    required: ['contract'],
    handler: async ({ contract, consumers = '' }) =>
      lines('Data Contract Check', [
        ['Contract', [contract]],
        ['Consumers', [consumers || 'Identify downstream consumers before changing shape']],
        [
          'Validation',
          [
            'Confirm required fields, nullable values, and defaults.',
            'Check backwards compatibility for readers/writers.',
            'Plan query/schema/data validation evidence.',
          ],
        ],
      ]),
  };
}

export function createSecurityReviewTool() {
  return {
    name: 'security_review',
    description:
      'Methodology tool for focused security review of auth, permissions, secrets, injection, input validation, and trust boundaries.',
    category: ToolCategory.skill_engineering,
    params: {
      surface: { type: 'string', description: 'Security-sensitive surface or change.' },
      threat: { type: 'string', description: 'Known threat or concern, if any.' },
    },
    required: ['surface'],
    handler: async ({ surface, threat = '' }) =>
      lines('Security Review', [
        ['Surface', [surface]],
        [
          'Threat focus',
          [threat || 'auth, authorization, secrets, input validation, trust boundary'],
        ],
        [
          'Checklist',
          [
            'Verify authentication and authorization are distinct and both covered.',
            'Check untrusted inputs before dangerous operations.',
            'Avoid logging or storing secrets.',
            'Plan a verification path for the security claim.',
          ],
        ],
      ]),
  };
}

export default function createMethodologyTools() {
  return [
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
}
