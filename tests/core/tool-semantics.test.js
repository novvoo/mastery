import { describe, test, expect } from 'bun:test';
import {
  ToolEffect,
  getToolEffect,
  isMutation,
  isStrictMutation,
  isVerification,
  isInspection,
  isMeaningfulProgress,
  FORCE_ACTION_ALLOWED_EFFECTS,
} from '../../src/core/runtime/agent/support/tool-semantics.js';

describe('tool-semantics', () => {
  // ──────────────────────────────────────────
  // 基本分类测试
  // ──────────────────────────────────────────
  test('getToolEffect returns MUTATION for write_file with content', () => {
    expect(getToolEffect('write_file', { content: 'hello' })).toBe(ToolEffect.MUTATION);
  });

  test('getToolEffect returns NO_PROGRESS for write_file with empty content', () => {
    expect(getToolEffect('write_file', { content: '' })).toBe(ToolEffect.NO_PROGRESS);
  });

  test('getToolEffect returns MUTATION for delete_file', () => {
    expect(getToolEffect('delete_file', { path: 'foo.js' })).toBe(ToolEffect.MUTATION);
  });

  test('getToolEffect returns MUTATION for rename_file', () => {
    expect(getToolEffect('rename_file', { oldPath: 'a.js', newPath: 'b.js' })).toBe(ToolEffect.MUTATION);
  });

  test('getToolEffect returns TARGETED_INSPECTION for read_file', () => {
    expect(getToolEffect('read_file', { path: 'foo.js' })).toBe(ToolEffect.TARGETED_INSPECTION);
  });

  test('getToolEffect returns VERIFICATION for shell test command', () => {
    expect(getToolEffect('shell', { command: 'bun test' })).toBe(ToolEffect.VERIFICATION);
  });

  // ──────────────────────────────────────────
  // edit_file 实际变化校验
  // ──────────────────────────────────────────
  test('edit_file with actual change → MUTATION', () => {
    expect(
      getToolEffect('edit_file', {
        old_string: 'const a = 1;',
        new_string: 'const a = 2;',
      }),
    ).toBe(ToolEffect.MUTATION);
  });

  test('edit_file with identical old/new string → NO_PROGRESS', () => {
    expect(
      getToolEffect('edit_file', {
        old_string: 'const a = 1;',
        new_string: 'const a = 1;',
      }),
    ).toBe(ToolEffect.NO_PROGRESS);
  });

  test('edit_file with whitespace-only difference → MUTATION (whitespace is a change)', () => {
    expect(
      getToolEffect('edit_file', {
        old_string: 'const a = 1;',
        new_string: 'const a = 1; ',
      }),
    ).toBe(ToolEffect.MUTATION);
  });

  test('edit_file with missing args → NO_PROGRESS', () => {
    expect(getToolEffect('edit_file', {})).toBe(ToolEffect.NO_PROGRESS);
  });

  test('edit_file isMutation returns false for no-op replacement', () => {
    expect(
      isMutation('edit_file', {
        old_string: 'aaa',
        new_string: 'aaa',
      }),
    ).toBe(false);
  });

  test('edit_file isMutation returns true for real replacement', () => {
    expect(
      isMutation('edit_file', {
        old_string: 'aaa',
        new_string: 'bbb',
      }),
    ).toBe(true);
  });

  // ──────────────────────────────────────────
  // apply_hashline_patch 实际变化校验
  // ──────────────────────────────────────────
  test('apply_hashline_patch with real diff → MUTATION', () => {
    const patch = `--- a/foo.js
+++ b/foo.js
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;
    expect(getToolEffect('apply_hashline_patch', { patch })).toBe(ToolEffect.MUTATION);
  });

  test('apply_hashline_patch with only context lines → NO_PROGRESS', () => {
    const patch = `--- a/foo.js
+++ b/foo.js
@@ -1,3 +1,3 @@
 const a = 1;
 const b = 2;
 const c = 4;`;
    expect(getToolEffect('apply_hashline_patch', { patch })).toBe(ToolEffect.NO_PROGRESS);
  });

  test('apply_hashline_patch with empty patch → NO_PROGRESS', () => {
    expect(getToolEffect('apply_hashline_patch', { patch: '' })).toBe(ToolEffect.NO_PROGRESS);
  });

  test('apply_hashline_patch with only file headers → NO_PROGRESS', () => {
    const patch = `--- a/foo.js
+++ b/foo.js`;
    expect(getToolEffect('apply_hashline_patch', { patch })).toBe(ToolEffect.NO_PROGRESS);
  });

  test('apply_hashline_patch isMutation returns false for no-op patch', () => {
    const patch = `--- a/foo.js
+++ b/foo.js
@@ -1,2 +1,2 @@
 line1
 line2`;
    expect(isMutation('apply_hashline_patch', { patch })).toBe(false);
  });

  test('apply_hashline_patch isMutation returns true for patch with additions', () => {
    const patch = `--- a/foo.js
+++ b/foo.js
@@ -1,2 +1,3 @@
 line1
+new line
 line2`;
    expect(isMutation('apply_hashline_patch', { patch })).toBe(true);
  });

  test('apply_hashline_patch isMutation returns true for patch with deletions', () => {
    const patch = `--- a/foo.js
+++ b/foo.js
@@ -1,3 +1,2 @@
 line1
-line2
 line3`;
    expect(isMutation('apply_hashline_patch', { patch })).toBe(true);
  });

  // ──────────────────────────────────────────
  // 便捷谓词函数
  // ──────────────────────────────────────────
  test('isMutation returns false for no-op edit_file', () => {
    expect(isMutation('edit_file', { old_string: 'x', new_string: 'x' })).toBe(false);
  });

  test('isMutation returns false for read_file', () => {
    expect(isMutation('read_file', { path: 'foo.js' })).toBe(false);
  });

  test('isStrictMutation behaves same as isMutation for edit_file', () => {
    expect(isStrictMutation('edit_file', { old_string: 'a', new_string: 'a' })).toBe(false);
    expect(isStrictMutation('edit_file', { old_string: 'a', new_string: 'b' })).toBe(true);
  });

  test('isVerification returns true for shell test', () => {
    expect(isVerification('shell', { command: 'npm test' })).toBe(true);
  });

  test('isInspection returns true for read_file', () => {
    expect(isInspection('read_file')).toBe(true);
  });

  // ──────────────────────────────────────────
  // isMeaningfulProgress
  // ──────────────────────────────────────────
  test('isMeaningfulProgress returns false for no-op edit_file', () => {
    expect(
      isMeaningfulProgress('edit_file', { old_string: 'x', new_string: 'x' }),
    ).toBe(false);
  });

  test('isMeaningfulProgress returns true for real edit_file', () => {
    expect(
      isMeaningfulProgress('edit_file', { old_string: 'x', new_string: 'y' }),
    ).toBe(true);
  });

  test('isMeaningfulProgress returns true for verification', () => {
    expect(isMeaningfulProgress('shell', { command: 'bun test' })).toBe(true);
  });

  test('isMeaningfulProgress returns partial for inspection without context', () => {
    expect(isMeaningfulProgress('read_file', { path: 'foo.js' })).toBe('partial');
  });

  test('isMeaningfulProgress returns true for inspection in scope', () => {
    expect(
      isMeaningfulProgress('read_file', { path: 'foo.js' }, { isInScope: true }),
    ).toBe(true);
  });

  // ──────────────────────────────────────────
  // 边界测试
  // ──────────────────────────────────────────
  test('handles null/undefined args gracefully', () => {
    expect(getToolEffect('edit_file', null)).toBe(ToolEffect.NO_PROGRESS);
    expect(getToolEffect('edit_file', undefined)).toBe(ToolEffect.NO_PROGRESS);
    expect(getToolEffect('write_file', null)).toBe(ToolEffect.NO_PROGRESS);
    expect(getToolEffect('apply_hashline_patch', null)).toBe(ToolEffect.NO_PROGRESS);
  });

  test('handles missing old_string/new_string', () => {
    expect(getToolEffect('edit_file', { path: 'foo.js' })).toBe(ToolEffect.NO_PROGRESS);
  });

  test('FORCE_ACTION_ALLOWED_EFFECTS contains MUTATION and VERIFICATION', () => {
    expect(FORCE_ACTION_ALLOWED_EFFECTS.has(ToolEffect.MUTATION)).toBe(true);
    expect(FORCE_ACTION_ALLOWED_EFFECTS.has(ToolEffect.VERIFICATION)).toBe(true);
    expect(FORCE_ACTION_ALLOWED_EFFECTS.has(ToolEffect.TARGETED_INSPECTION)).toBe(false);
  });
});
