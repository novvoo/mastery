/**
 * ProjectRules 单元测试
 * 测试分层规则加载、@import、递归查找等
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { ProjectRules } from '../../src/memory/project-rules.js';

describe('ProjectRules', () => {
  let tmpDir;
  let originalHome;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `agent-test-rules-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  function writeRule(subPath, content) {
    const rulesDir = join(tmpDir, subPath, '.agent-rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'instructions.md'), content, 'utf-8');
  }

  it('returns empty when no rules exist', () => {
    const rules = new ProjectRules(tmpDir);
    rules.load();
    expect(rules.hasRules()).toBe(false);
    expect(rules.toPromptFragment()).toBe('');
    expect(rules.getLoadedRules()).toEqual([]);
  });

  it('loads project-level rules', () => {
    writeRule('.', '# Project Rules\nUse TypeScript for all new files.');
    const rules = new ProjectRules(tmpDir);
    rules.load();
    expect(rules.hasRules()).toBe(true);
    const fragment = rules.toPromptFragment();
    expect(fragment).toContain('## Project Rules & Conventions');
    expect(fragment).toContain('### Project Rules');
    expect(fragment).toContain('Use TypeScript');
  });

  it('loads rules from parent directories', () => {
    const subDir = join(tmpDir, 'src', 'components');
    writeRule('.', '# Root Rules\nMonorepo root rules.');
    writeRule('src', '# Src Rules\nAll source in src/.');
    mkdirSync(subDir, { recursive: true });

    const rules = new ProjectRules(subDir);
    rules.load();
    const loaded = rules.getLoadedRules();
    expect(loaded.length).toBeGreaterThanOrEqual(2);

    const fragment = rules.toPromptFragment();
    expect(fragment).toContain('Root Rules');
    expect(fragment).toContain('Src Rules');
  });

  it('supports @import directives', () => {
    writeRule('.', '# Main Rules\n@import conventions.md');
    const rulesDir = join(tmpDir, '.agent-rules');
    writeFileSync(
      join(rulesDir, 'conventions.md'),
      '# Conventions\n- Use tabs for indentation',
      'utf-8',
    );

    const rules = new ProjectRules(tmpDir);
    rules.load();

    const fragment = rules.toPromptFragment();
    expect(fragment).toContain('Conventions');
    expect(fragment).toContain('Use tabs');
  });

  it('handles circular @import gracefully', () => {
    writeRule('.', '# Main\n@import a.md');
    const rulesDir = join(tmpDir, '.agent-rules');
    writeFileSync(join(rulesDir, 'a.md'), '# A\n@import b.md', 'utf-8');
    writeFileSync(join(rulesDir, 'b.md'), '# B\n@import a.md', 'utf-8');

    const rules = new ProjectRules(tmpDir);
    rules.load();
    // should not throw
    expect(rules.hasRules()).toBe(true);
  });

  it('handles missing @import gracefully', () => {
    writeRule('.', '# Main\n@import missing.md');
    const rules = new ProjectRules(tmpDir);
    rules.load();
    expect(rules.hasRules()).toBe(true);
    const fragment = rules.toPromptFragment();
    // should still contain the main content
    expect(fragment).toContain('Main');
  });

  it('getSubdirRulesPath returns correct path', () => {
    writeRule('lib', '# Lib rules');
    const rules = new ProjectRules(tmpDir);
    rules.load();
    const path = rules.getSubdirRulesPath('lib');
    expect(path).toBeTruthy();
    expect(path).toContain('.agent-rules');
  });

  it('skips files exceeding max size', () => {
    const rulesDir = join(tmpDir, '.agent-rules');
    mkdirSync(rulesDir, { recursive: true });
    // Write a file > 200KB
    const hugeContent = '# Huge\n' + 'x'.repeat(250 * 1024);
    writeFileSync(join(rulesDir, 'instructions.md'), hugeContent, 'utf-8');

    const rules = new ProjectRules(tmpDir);
    rules.load();
    // should be empty because file was skipped
    expect(rules.hasRules()).toBe(false);
  });

  it('reload refreshes rules', () => {
    const rules = new ProjectRules(tmpDir);
    rules.load();
    expect(rules.hasRules()).toBe(false);

    writeRule('.', '# New rules');
    rules.load(); // reload
    expect(rules.hasRules()).toBe(true);
  });

  it('toPromptFragment groups by level', () => {
    writeRule('.', '# Project');
    const subDir = join(tmpDir, 'src', 'lib');
    writeRule('src/lib', '# Local lib rules');
    mkdirSync(subDir, { recursive: true });

    const rules = new ProjectRules(subDir);
    rules.load();

    const fragment = rules.toPromptFragment();
    expect(fragment).toContain('### Project Rules');
    expect(fragment).toContain('### Local Rules');
  });
});
