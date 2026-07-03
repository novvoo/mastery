import { ToolCategory } from '../../core/types.js';
import { readFileSync, existsSync } from 'fs';

export default function createModuleSystemCheckTool() {
  return {
    name: 'module_system_check',
    description:
      'Detect module system conflicts between ES Module and CommonJS. Scans package.json for "type" field and checks source files for import/export vs require/module.exports usage.',
    category: ToolCategory.skill_engineering,
    params: {
      projectRoot: {
        type: 'string',
        description: 'Root directory of the project. Defaults to current working directory.',
      },
      filePatterns: {
        type: 'array',
        description:
          'Array of glob patterns for files to scan. Default: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"]',
      },
    },
    handler: async (params, ctx) => {
      const { globSync } = await import('glob');
      const projectRoot = params.projectRoot || ctx?.workingDirectory || process.cwd();
      const filePatterns = params.filePatterns || [
        '**/*.js',
        '**/*.mjs',
        '**/*.cjs',
        '**/*.ts',
        '**/*.tsx',
      ];

      const packageJsonPath = `${projectRoot}/package.json`;
      let packageType = 'commonjs';
      let hasPackageJson = false;

      if (existsSync(packageJsonPath)) {
        hasPackageJson = true;
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          packageType = packageJson.type === 'module' ? 'esm' : 'commonjs';
        } catch {
          packageType = 'commonjs';
        }
      }

      const allFiles = [];
      for (const pattern of filePatterns) {
        const files = globSync(pattern, {
          cwd: projectRoot,
          ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
          absolute: true,
        });
        allFiles.push(...files);
      }

      const findings = [];
      const esmFiles = [];
      const cjsFiles = [];
      const mixedFiles = [];

      for (const filePath of allFiles) {
        if (!existsSync(filePath)) continue;
        try {
          const content = readFileSync(filePath, 'utf-8');
          const hasImport =
            /\bimport\s+(?:\{[\s\S]*?\}|[\w*]+)\s+from\s+['"]/.test(content) ||
            /\bimport\s+['"]/.test(content) ||
            /\bimport\(\s*['"]/.test(content);
          const hasExport =
            /\bexport\s+(?:default|const|function|class|let|var|\{)/.test(content) ||
            /\bexport\s*=\s*/.test(content);
          const hasRequire = /\brequire\s*\(\s*['"]/.test(content);
          const hasModuleExports =
            /\bmodule\.exports\s*=/.test(content) || /\bexports\s*=/.test(content);

          const relativePath = filePath.replace(projectRoot, '').replace(/^\//, '');

          if ((hasImport || hasExport) && (hasRequire || hasModuleExports)) {
            mixedFiles.push({
              file: relativePath,
              issues: ['Mixed ES Module and CommonJS syntax in same file'],
            });
          } else if (hasImport || hasExport) {
            esmFiles.push({
              file: relativePath,
              issues: [],
            });
          } else if (hasRequire || hasModuleExports) {
            cjsFiles.push({
              file: relativePath,
              issues: [],
            });
          }
        } catch {
          continue;
        }
      }

      const conflicts = [];

      if (packageType === 'esm') {
        for (const cjsFile of cjsFiles) {
          conflicts.push({
            file: cjsFile.file,
            problem: 'CommonJS syntax detected in ES Module project',
            expected: 'import/export (ES Module)',
            found: 'require()/module.exports (CommonJS)',
            suggestion: 'Convert to ES Module syntax or rename file to .cjs',
          });
        }
      } else {
        for (const esmFile of esmFiles) {
          conflicts.push({
            file: esmFile.file,
            problem: 'ES Module syntax detected in CommonJS project',
            expected: 'require()/module.exports (CommonJS)',
            found: 'import/export (ES Module)',
            suggestion:
              'Convert to CommonJS syntax or rename file to .mjs or add "type": "module" to package.json',
          });
        }
      }

      for (const mixedFile of mixedFiles) {
        conflicts.push({
          file: mixedFile.file,
          problem: 'Mixed ES Module and CommonJS syntax',
          expected: 'Consistent module syntax',
          found: 'Both import/export and require()/module.exports',
          suggestion: 'Choose one module system and remove the other syntax',
        });
      }

      const report = {
        projectRoot,
        packageJsonFound: hasPackageJson,
        declaredModuleType: packageType,
        filesScanned: allFiles.length,
        esmFilesCount: esmFiles.length,
        cjsFilesCount: cjsFiles.length,
        mixedFilesCount: mixedFiles.length,
        conflicts: conflicts,
        hasConflicts: conflicts.length > 0,
        summary:
          conflicts.length > 0
            ? `Found ${conflicts.length} module system conflict(s). The project is configured as ${packageType.toUpperCase()}, but some files use incompatible module syntax.`
            : `No module system conflicts detected. All ${allFiles.length} files are consistent with ${packageType.toUpperCase()} configuration.`,
      };

      return formatReport(report);
    },
  };
}

function formatReport(report) {
  const lines = [
    '# Module System Compatibility Report',
    '',
    '---',
    '',
    '## Project Configuration',
    '',
    `**Project Root**: ${report.projectRoot}`,
    '',
    `**package.json Found**: ${report.packageJsonFound ? 'Yes' : 'No'}`,
    '',
    `**Declared Module Type**: ${report.declaredModuleType.toUpperCase()}`,
    '',
    '## File Analysis',
    '',
    `**Files Scanned**: ${report.filesScanned}`,
    '',
    `**ES Module Files**: ${report.esmFilesCount}`,
    '',
    `**CommonJS Files**: ${report.cjsFilesCount}`,
    '',
    `**Mixed Syntax Files**: ${report.mixedFilesCount}`,
    '',
  ];

  if (report.hasConflicts) {
    lines.push('---', '', '## Conflicts Found', '');
    lines.push('| File | Problem | Expected | Found | Suggestion |');
    lines.push('|------|---------|----------|-------|------------|');
    for (const conflict of report.conflicts) {
      lines.push(
        `| ${conflict.file} | ${conflict.problem} | ${conflict.expected} | ${conflict.found} | ${conflict.suggestion} |`,
      );
    }
  }

  lines.push('', '---', '', `**Summary**: ${report.summary}`, '');

  return lines.join('\n');
}
