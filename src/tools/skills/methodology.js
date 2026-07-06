import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { ToolCategory } from '../../core/types/index.js';

const CONFIG_FILES = [
  'package.json', 'tsconfig.json', 'jsconfig.json', 'tsconfig.app.json',
  'vite.config.ts', 'vite.config.js', 'vitest.config.ts', 'vitest.config.js',
  'jest.config.js', 'jest.config.ts', 'jest.config.mjs',
  'playwright.config.ts', 'playwright.config.js',
  'eslint.config.js', 'eslint.config.mjs', '.eslintrc.json', '.eslintrc.js',
  'biome.json', '.prettierrc', 'prettier.config.js',
  'pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini',
  'go.mod', 'go.sum',
  'Cargo.toml', 'Cargo.lock',
  'Gemfile', 'composer.json',
  'pom.xml', 'build.gradle', 'gradle.properties',
  'Makefile', 'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'README.md', 'CONTEXT.md',
  '.github/workflows',
];

async function findTestDirs(baseDir) {
  const testDirNames = ['tests', '__tests__', 'spec', 'test', 'e2e', 'integration'];
  const found = [];
  for (const name of testDirNames) {
    const testDir = join(baseDir, name);
    if (existsSync(testDir)) {
      try {
        const entries = await readdir(testDir, { withFileTypes: true });
        const fileCount = entries.filter(e => e.isFile() && /\.(js|ts|tsx|jsx|py|go|rs|java)$/i.test(e.name)).length;
        found.push({ path: name, fileCount });
      } catch {}
    }
  }
  return found;
}

async function findTestScripts(baseDir) {
  const scripts = [];
  const pkgPath = join(baseDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      if (pkg.scripts) {
        const testScripts = Object.entries(pkg.scripts).filter(([k, v]) =>
          /^(test|vitest|jest|pytest|check|lint|typecheck|type-check|build)$/i.test(k) ||
          /test|lint|typecheck|check|build/i.test(k)
        );
        for (const [name, cmd] of testScripts) {
          scripts.push({ name, command: cmd });
        }
      }
    } catch {}
  }
  return scripts;
}

async function readConfigFile(baseDir, relativePath) {
  const fullPath = join(baseDir, relativePath);
  if (!existsSync(fullPath)) return null;
  try {
    const content = await readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    return {
      path: relativePath,
      size: content.length,
      lines: lines.length,
      preview: lines.slice(0, 20).join('\n'),
    };
  } catch {
    return null;
  }
}

function formatConfigSection(header, configs) {
  const found = configs.filter(Boolean);
  if (found.length === 0) return '';
  return [
    `## ${header}`,
    '',
    ...found.map((c) => {
      const parts = [
        `- **${c.path}** (${c.lines} 行, ${c.size} 字节)`,
        '  ```',
        ...c.preview.split('\n').map((l) => `  ${l}`),
        `  ${c.lines > 20 ? `  ... (+${c.lines - 20} more lines)` : ''}`,
        '  ```',
      ];
      return parts.join('\n');
    }),
  ].join('\n');
}

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
      'Scan key project config files (package.json, tsconfig, test config, etc.), discover available scripts and test modules, and return a structured summary of the project setup. Use this once instead of manually reading each config file separately.',
    category: ToolCategory.skill_engineering,
    params: {
      task: { type: 'string', description: 'The code task being planned.' },
      focus: {
        type: 'string',
        description: 'Optional focus such as tests, config, frontend, backend, data, release.',
      },
    },
    required: ['task'],
    handler: async ({ task, focus = '' }, ctx) => {
      const baseDir = (ctx && ctx.workingDirectory) || process.cwd();
      const parts = [
        `# Project Profile for: ${task}`,
        `Focus: ${focus || 'existing project configuration, tests, scripts, conventions'}`,
        '',
      ];

      // 1. 扫描所有已知的配置文件
      const configResults = [];
      for (const configFile of CONFIG_FILES) {
        if (configFile.includes('*')) continue;
        const resolvedPath = join(baseDir, configFile);
        if (existsSync(resolvedPath)) {
          try {
            const content = await readFile(resolvedPath, 'utf-8');
            const lines = content.split('\n');
            configResults.push({
              path: configFile,
              size: content.length,
              lines: lines.length,
              preview: lines.slice(0, 15).join('\n'),
            });
          } catch {}
        }
      }
      if (configResults.length > 0) {
        parts.push(formatConfigSection('Discovered Config Files', configResults));
      } else {
        parts.push('## Config Files');
        parts.push('');
        parts.push('No standard config files found.');
        parts.push('');
      }

      // 2. 扫描 .github/workflows
      const workflowsDir = join(baseDir, '.github/workflows');
      if (existsSync(workflowsDir)) {
        try {
          const workflows = await readdir(workflowsDir);
          const yamlFiles = workflows.filter(f => /\.(yml|yaml)$/i.test(f));
          if (yamlFiles.length > 0) {
            parts.push('## CI/CD Workflows');
            parts.push('');
            for (const wf of yamlFiles) {
              const wfContent = await readFile(join(workflowsDir, wf), 'utf-8');
              const wfLines = wfContent.split('\n');
              parts.push(`- **.github/workflows/${wf}** (${wfLines.length} 行)`);
              const scriptLines = wfLines.filter(l => /^\s+run\s*[:=]/i.test(l) || /^\s+-\s+run\s/i.test(l));
              if (scriptLines.length > 0) {
                parts.push('');
                for (const sl of scriptLines.slice(0, 5)) {
                  parts.push(`  - \`${sl.trim()}\``);
                }
                if (scriptLines.length > 5) {
                  parts.push(`  - ... (+${scriptLines.length - 5} more steps)`);
                }
              }
            }
            parts.push('');
          }
        } catch {}
      }

      // 3. 扫描 test 目录
      const testDirs = await findTestDirs(baseDir);
      if (testDirs.length > 0) {
        parts.push('## Test Directories');
        parts.push('');
        for (const td of testDirs) {
          parts.push(`- **${td.path}/** — ${td.fileCount} source files`);
        }
        parts.push('');
      }

      // 4. 发现可用的脚本
      const scripts = await findTestScripts(baseDir);
      if (scripts.length > 0) {
        parts.push('## Available Scripts');
        parts.push('');
        parts.push('| Script | Command |');
        parts.push('|--------|---------|');
        for (const s of scripts) {
          parts.push(`| \`${s.name}\` | \`${s.command}\` |`);
        }
        parts.push('');
        const testScript = scripts.find(s => /^(test|vitest|jest|pytest|spec|check)$/i.test(s.name));
        if (testScript) {
          parts.push(`**Recommended verification:** \`${testScript.command}\``);
          parts.push('');
        }
      }

      // 5. 扫描 src/ 的关键子目录结构
      const srcDir = join(baseDir, 'src');
      if (existsSync(srcDir)) {
        try {
          const topDirs = (await readdir(srcDir, { withFileTypes: true }))
            .filter(e => e.isDirectory())
            .map(e => e.name);
          if (topDirs.length > 0) {
            parts.push('## Source Structure (src/)');
            parts.push('');
            parts.push(`Top-level directories: ${topDirs.join(', ')}`);
            parts.push('');
          }
        } catch {}
      }

      // 6. 输出总结
      parts.push('## Summary');
      parts.push('');
      parts.push(`- Config files found: ${configResults.length}`);
      parts.push(`- Test directories: ${testDirs.length}`);
      parts.push(`- Available scripts: ${scripts.length}`);
      parts.push('');
      parts.push('Use this profile to choose the appropriate plan and verification strategy.');

      return parts.join('\n');
    },
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
