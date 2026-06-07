import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve, relative, dirname, basename, extname } from 'path';
import { ToolCategory } from '../../core/types.js';

/**
 * zoom_out - System-level context before changes.
 * Generates a system context report with project structure overview,
 * dependency analysis, impact analysis, and recommended change order.
 */
export default function zoom_out() {
  return {
    name: 'zoom_out',
    description:
      'System-level context tool. Generates a comprehensive context report before making changes, including project structure, related modules, dependency analysis, change impact assessment, and recommended change order to minimize risk.',
    category: ToolCategory.skill_engineering,
    params: {
      proposed_change: {
        type: 'string',
        description: 'Description of the proposed change',
      },
      focus_file: {
        type: 'string',
        description: 'Path to the primary file being changed (optional, for deeper analysis)',
      },
    },
    required: ['proposed_change'],
    handler: async (params, ctx) => {
      const { proposed_change, focus_file = '' } = params;
      const { workingDirectory } = ctx;

      if (!proposed_change || typeof proposed_change !== 'string' || !proposed_change.trim()) {
        return 'Error: Required parameter "proposed_change" is missing or empty. Please describe the proposed change and try again.';
      }

      const baseDir = workingDirectory || process.cwd();

      const structure = await analyzeProjectStructure(baseDir);

      let fileAnalysis = null;
      if (focus_file) {
        const absoluteFocusPath = resolve(baseDir, focus_file);
        fileAnalysis = await analyzeFocusFile(absoluteFocusPath, baseDir);
      }

      const impact = analyzeChangeImpact(proposed_change, structure, fileAnalysis);

      const cascadingEffects = identifyCascadingEffects(impact, structure);

      const changeOrder = recommendChangeOrder(impact, cascadingEffects);

      return formatSystemContextReport(proposed_change, structure, fileAnalysis, impact, cascadingEffects, changeOrder);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function analyzeProjectStructure(baseDir) {
  const modules = [];
  const dependencies = { imports: [], exports: [] };

  try {
    await walkDirectory(baseDir, baseDir, modules, dependencies, 3);
  } catch (err) {
    // If directory walk fails, provide minimal structure
    modules.push({
      path: '(unable to scan)',
      type: 'unknown',
      relativePath: '(unable to scan)',
    });
  }

  return { baseDir, modules, dependencies };
}

async function walkDirectory(dir, baseDir, modules, dependencies, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) {return;}

  const skipDirs = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.cache',
    'coverage', '.nyc_output', '__pycache__', '.venv', 'vendor',
  ]);

  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (skipDirs.has(entry) || entry.startsWith('.')) {continue;}

    const fullPath = join(dir, entry);
    let fileStat;

    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      await walkDirectory(fullPath, baseDir, modules, dependencies, maxDepth, currentDepth + 1);
    } else {
      const ext = extname(entry).toLowerCase();
      const codeExtensions = new Set([
        '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
        '.java', '.cpp', '.c', '.cs', '.php', '.swift', '.kt',
      ]);

      if (codeExtensions.has(ext)) {
        const relativePath = relative(baseDir, fullPath);
        modules.push({
          path: fullPath,
          type: ext.replace('.', ''),
          relativePath,
          name: entry,
        });

        // Scan for imports/exports
        try {
          const content = await readFile(fullPath, 'utf-8');
          scanImportsExports(content, relativePath, dependencies);
        } catch {
          // Skip files that cannot be read
        }
      }
    }
  }
}

function scanImportsExports(content, filePath, dependencies) {
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect imports
    const importMatch = trimmed.match(
      /(?:import\s+.*?from\s+['"])(.*?)(?:['"])/
    ) || trimmed.match(
      /(?:require\s*\(\s*['"])(.*?)(?:['"])/
    ) || trimmed.match(
      /(?:from\s+['"])(.*?)(?:['"])/
    );

    if (importMatch) {
      const importPath = importMatch[1];
      // Only track local imports (not node_modules)
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        dependencies.imports.push({
          from: filePath,
          module: importPath,
        });
      }
    }

    // Detect exports
    const exportMatch = trimmed.match(/export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/);
    if (exportMatch) {
      dependencies.exports.push({
        file: filePath,
        name: exportMatch[1],
      });
    }
  }
}

async function analyzeFocusFile(absolutePath, baseDir) {
  let content;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch {
    return {
      path: absolutePath,
      exists: false,
      error: 'File not found or cannot be read',
    };
  }

  const lines = content.split('\n');
  const relativePath = relative(baseDir, absolutePath);

  // Analyze imports
  const imports = [];
  const exportNames = [];

  for (const line of lines) {
    const trimmed = line.trim();

    const importMatch = trimmed.match(
      /(?:import\s+(?:\{[^}]*}\s+)?(?:\w+\s+)?)?from\s+['"]([^'"]+)['"]/
    ) || trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);

    if (importMatch) {
      imports.push(importMatch[1]);
    }

    const exportMatch = trimmed.match(/export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/);
    if (exportMatch) {
      exportNames.push(exportMatch[1]);
    }
  }

  // Identify local dependencies (files in the same project)
  const localDeps = imports.filter((imp) => imp.startsWith('.') || imp.startsWith('/'));

  // Identify what depends on this file (from exports)
  const providedAPI = exportNames;

  return {
    path: absolutePath,
    relativePath,
    exists: true,
    totalLines: lines.length,
    imports,
    localDeps,
    exports: exportNames,
    providedAPI,
  };
}

function analyzeChangeImpact(proposedChange, structure, fileAnalysis) {
  const changeLower = proposedChange.toLowerCase();
  const impactAreas = [];

  // Analyze based on change description keywords
  if (changeLower.includes('api') || changeLower.includes('endpoint') || changeLower.includes('route')) {
    impactAreas.push({
      area: 'API Layer',
      risk: 'High',
      reason: 'API changes affect all consumers (frontend, mobile, third-party integrations).',
      affected: ['API consumers', 'Documentation', 'Integration tests'],
    });
  }

  if (changeLower.includes('database') || changeLower.includes('schema') || changeLower.includes('migration')) {
    impactAreas.push({
      area: 'Data Layer',
      risk: 'High',
      reason: 'Schema changes can break existing queries and data access patterns.',
      affected: ['Data access layer', 'Existing queries', 'Data migrations'],
    });
  }

  if (changeLower.includes('auth') || changeLower.includes('permission') || changeLower.includes('security')) {
    impactAreas.push({
      area: 'Security / Auth',
      risk: 'Critical',
      reason: 'Security changes have wide impact and must be thoroughly tested.',
      affected: ['Authentication flows', 'Authorization checks', 'Session management', 'All protected routes'],
    });
  }

  if (changeLower.includes('config') || changeLower.includes('environment') || changeLower.includes('setting')) {
    impactAreas.push({
      area: 'Configuration',
      risk: 'Medium',
      reason: 'Configuration changes affect all environments and deployments.',
      affected: ['All services reading this config', 'Deployment scripts', 'Environment documentation'],
    });
  }

  if (changeLower.includes('refactor') || changeLower.includes('restructure') || changeLower.includes('rename')) {
    impactAreas.push({
      area: 'Code Structure',
      risk: 'Medium',
      reason: 'Structural changes can break imports and references across the codebase.',
      affected: ['Import statements', 'Test files', 'Documentation references'],
    });
  }

  if (changeLower.includes('dependency') || changeLower.includes('upgrade') || changeLower.includes('package')) {
    impactAreas.push({
      area: 'Dependencies',
      risk: 'Medium',
      reason: 'Dependency changes can introduce breaking changes or compatibility issues.',
      affected: ['All modules using the dependency', 'Build process', 'Deployment'],
    });
  }

  // If file analysis is available, add file-specific impact
  if (fileAnalysis && fileAnalysis.exists) {
    if (fileAnalysis.exports.length > 0) {
      impactAreas.push({
        area: `Exported API of ${fileAnalysis.relativePath}`,
        risk: fileAnalysis.exports.length > 3 ? 'High' : 'Medium',
        reason: `This file exports ${fileAnalysis.exports.length} symbol(s): ${fileAnalysis.exports.join(', ')}. Changes may break consumers.`,
        affected: fileAnalysis.exports,
      });
    }

    if (fileAnalysis.localDeps.length > 0) {
      impactAreas.push({
        area: `Dependencies of ${fileAnalysis.relativePath}`,
        risk: 'Low',
        reason: `This file depends on ${fileAnalysis.localDeps.length} local module(s). Changes to those modules could affect this file.`,
        affected: fileAnalysis.localDeps,
      });
    }
  }

  // Default impact if nothing specific detected
  if (impactAreas.length === 0) {
    impactAreas.push({
      area: 'General',
      risk: 'Medium',
      reason: 'The proposed change may have broader impacts that should be investigated.',
      affected: ['Review the full project structure below'],
    });
  }

  return impactAreas;
}

function identifyCascadingEffects(impact, structure) {
  const effects = [];

  impact.forEach((area) => {
    if (area.risk === 'Critical' || area.risk === 'High') {
      effects.push({
        effect: `Changes to ${area.area} may cascade to: ${area.affected.join(', ')}`,
        severity: area.risk,
        mitigation: 'Update all consumers before deploying. Run full test suite. Consider a feature flag for gradual rollout.',
      });
    }
  });

  // Check for circular dependency risks
  if (structure.dependencies.imports.length > 0) {
    const importMap = new Map();
    for (const imp of structure.dependencies.imports) {
      if (!importMap.has(imp.from)) {
        importMap.set(imp.from, []);
      }
      importMap.get(imp.from).push(imp.module);
    }

    // Simple circular dependency detection
    for (const [file, deps] of importMap) {
      for (const dep of deps) {
        const resolvedDep = dep.replace(/^\.\.?\//, '');
        const otherDeps = importMap.get(resolvedDep);
        if (otherDeps && otherDeps.some((d) => d.includes(file.replace(/\.\w+$/, '')))) {
          effects.push({
            effect: `Potential circular dependency detected between "${file}" and "${resolvedDep}"`,
            severity: 'Warning',
            mitigation: 'Refactor to remove the circular dependency. Consider introducing an intermediate module or event-based communication.',
          });
        }
      }
    }
  }

  if (effects.length === 0) {
    effects.push({
      effect: 'No significant cascading effects identified at the project structure level.',
      severity: 'Low',
      mitigation: 'Still review changes carefully at the module level using the review tool.',
    });
  }

  return effects;
}

function recommendChangeOrder(impact, cascadingEffects) {
  const steps = [];

  // Step 1: Understand the current state
  steps.push({
    order: 1,
    action: 'Review current state',
    detail: 'Use the review tool on all files that will be modified. Understand the existing behavior before changing anything.',
    tool: 'review',
  });

  // Step 2: Write tests for existing behavior
  steps.push({
    order: 2,
    action: 'Characterize existing behavior with tests',
    detail: 'Write tests that capture the current behavior of the code you plan to change. These tests ensure you don\'t break existing functionality.',
    tool: 'tdd (red phase)',
  });

  // Step 3: Make changes from the inside out
  const highRiskAreas = impact.filter((a) => a.risk === 'Critical' || a.risk === 'High');
  if (highRiskAreas.length > 0) {
    steps.push({
      order: 3,
      action: 'Address high-risk areas first',
      detail: `Start with the highest-risk area: ${highRiskAreas[0].area}. Work from the deepest dependency outward to minimize broken intermediate states.`,
      tool: 'tdd (green phase)',
    });
  } else {
    steps.push({
      order: 3,
      action: 'Implement changes incrementally',
      detail: 'Make changes in small, testable increments. Each increment should leave the system in a working state.',
      tool: 'tdd (green phase)',
    });
  }

  // Step 4: Update consumers
  steps.push({
    order: 4,
    action: 'Update all consumers and dependencies',
    detail: 'After core changes are made, update all files that depend on the changed modules. Ensure imports and API calls are updated.',
    tool: 'review',
  });

  // Step 5: Refactor
  steps.push({
    order: 5,
    action: 'Refactor for quality',
    detail: 'With all tests passing, refactor the code for readability, performance, and maintainability.',
    tool: 'tdd (refactor phase)',
  });

  // Step 6: Verify
  steps.push({
    order: 6,
    action: 'Verify all acceptance criteria',
    detail: 'Run the verify tool to confirm all acceptance criteria are met with fresh evidence.',
    tool: 'verify',
  });

  return steps;
}

function formatSystemContextReport(proposedChange, structure, fileAnalysis, impact, cascadingEffects, changeOrder) {
  const lines = [
    '# System Context Report',
    '',
    `**Proposed Change**: ${proposedChange}`,
    '',
    `**Base Directory**: \`${structure.baseDir}\``,
    '',
    '---',
    '',
    '## 1. Project Structure Overview',
    '',
  ];

  if (structure.modules.length > 0) {
    // Group modules by directory
    const dirMap = new Map();
    for (const mod of structure.modules) {
      const dir = dirname(mod.relativePath);
      if (!dirMap.has(dir)) {
        dirMap.set(dir, []);
      }
      dirMap.get(dir).push(mod);
    }

    lines.push('### Directory Structure');
    lines.push('');
    lines.push('```');

    // Show top-level structure
    const topLevelDirs = new Set();
    for (const mod of structure.modules) {
      const parts = mod.relativePath.split('/');
      if (parts.length > 1) {
        topLevelDirs.add(parts[0]);
      } else {
        lines.push(mod.relativePath);
      }
    }

    for (const dir of [...topLevelDirs].sort()) {
      const mods = dirMap.get(dir);
      if (mods) {
        lines.push(`${dir}/`);
        for (const mod of mods.slice(0, 10)) {
          lines.push(`  ${basename(mod.relativePath)}`);
        }
        if (mods.length > 10) {
          lines.push(`  ... and ${mods.length - 10} more files`);
        }
      }
    }

    lines.push('```');
    lines.push('');
    lines.push(`**Total source files scanned**: ${structure.modules.length}`);
  } else {
    lines.push('> No source files found in the project directory. The directory may be empty or use an unrecognized structure.');
  }

  // File-specific analysis
  if (fileAnalysis) {
    lines.push('', '---', '', '## 2. Focus File Analysis', '');

    if (!fileAnalysis.exists) {
      lines.push(`> **File not found**: \`${fileAnalysis.path}\``);
      lines.push('');
      lines.push(fileAnalysis.error);
    } else {
      lines.push(`**File**: \`${fileAnalysis.relativePath}\``);
      lines.push(`**Lines**: ${fileAnalysis.totalLines}`);
      lines.push('');

      if (fileAnalysis.imports.length > 0) {
        lines.push('**Imports**:');
        fileAnalysis.imports.forEach((imp) => {
          lines.push(`- \`${imp}\``);
        });
        lines.push('');
      }

      if (fileAnalysis.exports.length > 0) {
        lines.push('**Exports**:');
        fileAnalysis.exports.forEach((exp) => {
          lines.push(`- \`${exp}\``);
        });
        lines.push('');
      }

      if (fileAnalysis.localDeps.length > 0) {
        lines.push('**Local Dependencies**:');
        fileAnalysis.localDeps.forEach((dep) => {
          lines.push(`- \`${dep}\``);
        });
        lines.push('');
      }
    }
  }

  lines.push(
    '---',
    '',
    '## 3. Change Impact Analysis',
    '',
    '| Area | Risk | Reason | Affected |',
    '|------|------|--------|----------|',
  );

  impact.forEach((area) => {
    const affectedStr = Array.isArray(area.affected) ? area.affected.join(', ') : area.affected;
    lines.push(`| ${area.area} | **${area.risk}** | ${area.reason} | ${affectedStr} |`);
  });

  lines.push(
    '',
    '---',
    '',
    '## 4. Potential Cascading Effects',
    ''
  );

  cascadingEffects.forEach((effect) => {
    const severityBadge = effect.severity === 'Critical'
      ? ':red_circle:'
      : effect.severity === 'High'
        ? ':orange_circle:'
        : effect.severity === 'Warning'
          ? ':yellow_circle:'
          : ':green_circle:';

    lines.push(`- ${severityBadge} **${effect.severity}**: ${effect.effect}`);
    lines.push(`  - *Mitigation*: ${effect.mitigation}`);
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '## 5. Recommended Change Order',
    ''
  );

  changeOrder.forEach((step) => {
    lines.push(`### Step ${step.order}: ${step.action}`);
    lines.push('');
    lines.push(step.detail);
    lines.push('');
    lines.push(`**Recommended Tool**: \`${step.tool}\``);
    lines.push('');
  });

  lines.push(
    '---',
    '',
    '> **Next Steps**: Follow the recommended change order above. Start with Step 1 (review current state) before making any modifications.',
    ''
  );

  return lines.join('\n');
}
