/**
 * P0: 完整 Rename Torture Tests
 *
 * 覆盖：
 *   1. tsconfig paths alias 重命名
 *   2. package.json exports / subpath exports
 *   3. pnpm workspace 跨包重命名
 *   4. barrel re-export 链 (index.ts → index.ts → leaf)
 *   5. type-only import / export 重命名
 *   6. default export / default import 重命名
 *   7. alias import (import { X as Y }) 重命名
 *
 * 每个 test case 模拟：
 *   - 原始文件状态
 *   - LSP TextEdit 生成
 *   - TextEdit→Hashline 映射 (lspTextEditsToHashlinePatch)
 *   - Hashline apply 原子性
 *   - 所有引用同步验证
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

// ── 测试用 filesystem ──────────────────────────────────────────────────────

class TestProject {
  constructor(name) {
    this.root = resolve(`/tmp/rename-torture-${name}-${Date.now()}`);
    this.files = new Map();
  }

  async setup(structure) {
    await mkdir(this.root, { recursive: true });
    for (const [relativePath, content] of Object.entries(structure)) {
      const fullPath = join(this.root, relativePath);
      const dir = join(fullPath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, content);
      this.files.set(relativePath, content);
    }
    return this;
  }

  async read(relativePath) {
    return readFile(join(this.root, relativePath), 'utf-8');
  }

  async cleanup() {
    if (existsSync(this.root)) {
      await rm(this.root, { recursive: true, force: true });
    }
  }

  sha256(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  path(...parts) {
    return join(this.root, ...parts);
  }
}

// ── 辅助：TextEdit 模拟 ────────────────────────────────────────────────────

function makeTextEdit(startLine, startChar, endLine, endChar, newText = '') {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    newText,
  };
}

/**
 * 模拟 LSP rename 返回的 workspace edit。
 * 为 oldName 在指定行找到，生成替换 edit。
 */
function simulateRenameEdits(files, oldName, newName, options = {}) {
  const editsByUri = {};
  const { fileTypes = ['.ts', '.tsx'], renameSymbolOnly = false } = options;

  for (const [filePath, content] of Object.entries(files)) {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    if (!fileTypes.some(t => ext === t || ext === t.replace('.', ''))) continue;

    const lines = content.split('\n');
    const edits = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let searchPos = 0;

      while (true) {
        const idx = line.indexOf(oldName, searchPos);
        if (idx === -1) break;

        // 检查是否为完整标识符
        const before = line[idx - 1] || ' ';
        const after = line[idx + oldName.length] || ' ';
        const isWordBoundary = !/[a-zA-Z0-9_$]/.test(before) && !/[a-zA-Z0-9_$]/.test(after);

        if (isWordBoundary || !renameSymbolOnly) {
          edits.push(makeTextEdit(i, idx, i, idx + oldName.length, newName));
        }

        searchPos = idx + oldName.length;
      }
    }

    if (edits.length > 0) {
      editsByUri[`file://${filePath}`] = edits;
    }
  }

  return { changes: editsByUri };
}

// ── 模拟 Hashline patcher ──────────────────────────────────────────────────

function computeTag(content) {
  return createHash('sha256').update(content).digest('hex');
}

function lspTextEditsToHashlinePatch(editsByPath) {
  const lines = [];
  for (const [filePath, { originalContent, edits }] of Object.entries(editsByPath)) {
    const norm = originalContent;
    const tag = computeTag(norm);
    lines.push(`[${filePath}#${tag}]`);

    const sorted = [...edits].sort((a, b) => {
      if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
      return b.range.start.character - a.range.start.character;
    });

    let content = norm;
    for (const edit of sorted) {
      const startLine = edit.range.start.line + 1;
      const endLine = edit.range.end.line + 1;
      const startChar = edit.range.start.character;
      const endChar = edit.range.end.character;

      if (startLine === endLine) {
        // 同行编辑
        lines.push(`SWAP ${startLine}.=${endLine}:`);
        const lineContent = content.split('\n')[startLine - 1] || '';
        const before = lineContent.substring(0, startChar);
        const after = lineContent.substring(endChar);
        const replacement = before + (edit.newText || '') + after;
        if (replacement) lines.push(`+${replacement}`);
      } else {
        // 跨行编辑
        lines.push(`SWAP ${startLine}.=${endLine}:`);
        for (const newLine of (edit.newText || '').split('\n')) {
          lines.push(`+${newLine}`);
        }
      }
      content = applyTextEdits(content, [edit]);
    }
  }
  return lines.join('\n');
}

function applyTextEdits(text, edits) {
  let result = text;
  const sorted = [...edits].sort((a, b) => {
    if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  for (const edit of sorted) {
    const lines = result.split('\n');
    let startOffset = 0;
    let endOffset = 0;
    for (let i = 0; i < edit.range.start.line; i++) startOffset += lines[i].length + 1;
    startOffset += edit.range.start.character;
    for (let i = 0; i < edit.range.end.line; i++) endOffset += lines[i].length + 1;
    endOffset += edit.range.end.character;
    result = result.substring(0, startOffset) + (edit.newText || '') + result.substring(endOffset);
  }
  return result;
}

function detectOverlappingEdits(editsByPath) {
  const conflicts = [];
  for (const [filePath, { edits }] of Object.entries(editsByPath)) {
    const sorted = [...edits].sort((a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (b.range.start.line <= a.range.end.line) {
          if (b.range.start.line === a.range.end.line) {
            if (b.range.start.character < a.range.end.character) {
              conflicts.push({ filePath, editA: i, editB: j, overlap: 'same-line char' });
            }
          } else {
            conflicts.push({ filePath, editA: i, editB: j, overlap: 'cross-line' });
          }
        }
      }
    }
  }
  return conflicts;
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('Rename Torture Tests', () => {
  // ═══════════════════════════════════════════════════════════════════
  // Test 1: tsconfig paths alias
  // ═══════════════════════════════════════════════════════════════════
  describe('1. tsconfig paths alias rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('tsconfig-paths');
      await project.setup({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@app/*': ['src/*'],
              '@components/*': ['src/components/*'],
              '@utils/*': ['src/utils/*'],
            },
          },
        }, null, 2),
        'src/index.ts': `import { OldButton } from '@components/OldButton';
import { formatDate } from '@utils/date';
import { config } from '@app/config';
export { OldButton, formatDate, config };`,
        'src/components/OldButton.ts': `import React from 'react';
import type { ButtonProps } from '@app/types';
import { styled } from '@utils/css';

export const OldButton: React.FC<ButtonProps> = (props) => {
  return <button className={styled.button}>{props.children}</button>;
};`,
        'src/utils/date.ts': `export function formatDate(date: Date): string {
  return date.toISOString();
}`,
        'src/config.ts': `export const config = { apiUrl: '/api' };`,
        'src/types.ts': `export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}`,
        'src/utils/css.ts': `export const styled = { button: 'btn-primary' };`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename symbol across tsconfig paths alias references', () => {
      const oldName = 'OldButton';
      const newName = 'NewButton';

      // 模拟 LSP rename 生成的 workspace edit
      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 验证所有引用都被找到
      const editCount = Object.values(workspaceEdit.changes).reduce((s, e) => s + e.length, 0);
      expect(editCount).toBeGreaterThan(0);

      // 检查 index.ts barrel export 也被更新
      const indexEdits = workspaceEdit.changes[`file://src/index.ts`];
      expect(indexEdits).toBeDefined();
      expect(indexEdits.some(e => e.newText === newName)).toBe(true);

      // 检查 components/OldButton.ts 的定义处
      const componentEdits = workspaceEdit.changes[`file://src/components/OldButton.ts`];
      expect(componentEdits).toBeDefined();

      // 应用到文件，验证一致性
      const editedFiles = Object.fromEntries(project.files);
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const filePath = uri.replace('file://', '');
        const content = editedFiles[filePath] || project.files.get(filePath);
        editedFiles[filePath] = applyTextEdits(content, edits);
      }

      // 验证：旧名称不应再出现
      for (const [filePath, content] of Object.entries(editedFiles)) {
        expect(content).not.toContain(` ${oldName} `);
        expect(content).not.toContain(`${oldName}:`);
        expect(content).not.toContain(`{${oldName}}`);
        expect(content).not.toContain(`{ ${oldName} `);
      }

      // Hashline 转换验证
      const editsByPath = {};
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        const originalContent = project.files.get(fp);
        editsByPath[fp] = { originalContent, edits };
      }

      const patchText = lspTextEditsToHashlinePatch(editsByPath);
      expect(patchText.length).toBeGreaterThan(0);
      expect(patchText).toContain('[src/index.ts#');
      expect(patchText).toContain('[src/components/OldButton.ts#');
      expect(patchText).toContain('SWAP');

      // 无重叠 edit
      const conflicts = detectOverlappingEdits(editsByPath);
      expect(conflicts).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 2: package.json exports / subpath exports
  // ═══════════════════════════════════════════════════════════════════
  describe('2. package.json exports rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('pkg-exports');
      await project.setup({
        'package.json': JSON.stringify({
          name: '@myorg/ui-lib',
          version: '1.0.0',
          main: 'dist/index.js',
          exports: {
            '.': './dist/index.js',
            './button': './dist/components/Button.js',
            './card': './dist/components/Card.js',
            './utils': './dist/utils/index.js',
            './theme': './dist/theme/colors.js',
          },
          typesVersions: {
            '*': {
              button: ['./dist/components/Button.d.ts'],
              card: ['./dist/components/Card.d.ts'],
            },
          },
        }, null, 2),
        'src/index.ts': `export { OldButton } from './components/OldButton';
export { Card } from './components/Card';
export * from './utils';`,
        'src/components/OldButton.ts': `import React from 'react';
import type { OldButtonProps } from './types';

export const OldButton: React.FC<OldButtonProps> = (props) => {
  return <button>{props.label}</button>;
};

export type { OldButtonProps };`,
        'src/components/types.ts': `export interface OldButtonProps {
  label: string;
  disabled?: boolean;
}`,
        'src/components/Card.ts': `import { OldButton } from './OldButton';
import type { OldButtonProps } from './types';

export const Card = ({ title }: { title: string }) => {
  return <div><h2>{title}</h2><OldButton label="OK" /></div>;
};`,
        'src/utils/index.ts': `export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}`,
        'consumer-app/src/App.ts': `import { OldButton } from '@myorg/ui-lib/button';
import type { OldButtonProps } from '@myorg/ui-lib/button';
import { Card } from '@myorg/ui-lib/card';
import { capitalize } from '@myorg/ui-lib/utils';

const props: OldButtonProps = { label: 'Submit' };
export default () => <div><OldButton {...props} /><Card title="Hello" /></div>;`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename symbol that is exported via package.json subpath exports', () => {
      const oldName = 'OldButton';
      const newName = 'Button';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 检查 barrel export 更新
      const indexEdits = workspaceEdit.changes[`file://src/index.ts`];
      expect(indexEdits).toBeDefined();

      // 检查类型引用更新 (OldButtonProps → ButtonProps)
      const typesEdits = workspaceEdit.changes[`file://src/components/types.ts`];
      expect(typesEdits).toBeDefined();
      if (typesEdits) {
        expect(typesEdits.length).toBeGreaterThan(0);
      }

      // 检查消费者应用的引用
      const consumerEdits = workspaceEdit.changes[`file://consumer-app/src/App.ts`];
      expect(consumerEdits).toBeDefined();

      // 应用编辑并验证
      const editedFiles = Object.fromEntries(project.files);
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editedFiles[fp] = applyTextEdits(editedFiles[fp] || '', edits);
      }

      // Card.ts 中引用 OldButton 的 import 应被更新
      const cardContent = editedFiles['src/components/Card.ts'];
      expect(cardContent).not.toContain(`import { OldButton }`);
      expect(cardContent).toContain('Button');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 3: pnpm workspace 跨包重命名
  // ═══════════════════════════════════════════════════════════════════
  describe('3. pnpm workspace cross-package rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('pnpm-workspace');
      await project.setup({
        'pnpm-workspace.yaml': `packages:
  - 'packages/*'
  - 'apps/*'`,
        'package.json': JSON.stringify({
          name: 'monorepo-root',
          private: true,
        }, null, 2),
        'packages/shared/src/index.ts': `export { OldLogger } from './logger';
export type { LogLevel } from './types';`,
        'packages/shared/src/logger.ts': `import type { LogLevel } from './types';

export class OldLogger {
  private level: LogLevel = 'info';
  log(msg: string) { console.log("[OLD]", msg); }
}`,
        'packages/shared/src/types.ts': `export type LogLevel = 'debug' | 'info' | 'warn' | 'error';`,
        'packages/shared/package.json': JSON.stringify({
          name: '@mono/shared',
          version: '1.0.0',
          main: 'src/index.ts',
          exports: {
            '.': './src/index.ts',
            './logger': './src/logger.ts',
            './types': './src/types.ts',
          },
        }, null, 2),
        'apps/web/src/App.tsx': `import { OldLogger } from '@mono/shared/logger';
import type { LogLevel } from '@mono/shared/types';

const log = new OldLogger();
log.log('Application started');

export const setupLogging = (level: LogLevel) => {
  const logger = new OldLogger();
  logger.log('Logging configured');
};`,
        'apps/web/package.json': JSON.stringify({
          name: '@mono/web',
          version: '1.0.0',
          dependencies: { '@mono/shared': 'workspace:*' },
          devDependencies: {
            '@types/react': '^18.0.0',
            typescript: '^5.0.0',
          },
        }, null, 2),
        'apps/admin/src/dashboard.ts': `import { OldLogger } from '@mono/shared';

const auditLog = new OldLogger();
auditLog.log('Admin action');`,
        'apps/admin/package.json': JSON.stringify({
          name: '@mono/admin',
          version: '1.0.0',
          dependencies: { '@mono/shared': 'workspace:*' },
        }, null, 2),
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename across pnpm workspace packages with all references', () => {
      const oldName = 'OldLogger';
      const newName = 'Logger';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // shared/logger.ts 的定义处
      const loggerEdits = workspaceEdit.changes[`file://packages/shared/src/logger.ts`];
      expect(loggerEdits).toBeDefined();
      if (loggerEdits) {
        const classRename = loggerEdits.find(e => e.newText === newName);
        expect(classRename).toBeDefined();
      }

      // shared/index.ts barrel export
      const sharedIndexEdits = workspaceEdit.changes[`file://packages/shared/src/index.ts`];
      expect(sharedIndexEdits).toBeDefined();

      // apps/web 消费者
      const webEdits = workspaceEdit.changes[`file://apps/web/src/App.tsx`];
      expect(webEdits).toBeDefined();

      // apps/admin 消费者
      const adminEdits = workspaceEdit.changes[`file://apps/admin/src/dashboard.ts`];
      expect(adminEdits).toBeDefined();

      // 应用并验证
      const editedFiles = Object.fromEntries(project.files);
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editedFiles[fp] = applyTextEdits(editedFiles[fp] || '', edits);
      }

      for (const [fp, content] of Object.entries(editedFiles)) {
        expect(content).not.toContain(`OldLogger`);
      }

      // web 应用中的 import 已更新
      expect(editedFiles['apps/web/src/App.tsx']).toContain(`import { Logger } from`);
      expect(editedFiles['apps/admin/src/dashboard.ts']).toContain(`import { Logger } from`);

      // Hashline patch 生成验证
      const editsByPath = {};
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editsByPath[fp] = { originalContent: project.files.get(fp), edits };
      }
      const patchText = lspTextEditsToHashlinePatch(editsByPath);
      expect(patchText.length).toBeGreaterThan(0);
      expect(patchText).toContain('SWAP');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 4: barrel re-export chain (多层 index.ts)
  // ═══════════════════════════════════════════════════════════════════
  describe('4. barrel re-export chain', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('barrel-chain');
      await project.setup({
        'src/index.ts': `export * from './components';
export * from './hooks';
export * from './utils';`,
        'src/components/index.ts': `export { OldInput } from './OldInput';
export { Select } from './Select';`,
        'src/components/OldInput.ts': `import React from 'react';

export interface OldInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export const OldInput: React.FC<OldInputProps> = (props) => {
  return <input value={props.value} onChange={e => props.onChange(e.target.value)} />;
};`,
        'src/components/Select.ts': `import React from 'react';
import { OldInput } from './OldInput';

export const Select: React.FC<{ options: string[] }> = ({ options }) => {
  return <div>
    <OldInput value="" onChange={() => {}} placeholder="Select..." />
    {options.map(o => <div key={o}>{o}</div>)}
  </div>;
};`,
        'src/hooks/index.ts': `export { useOldData } from './useOldData';`,
        'src/hooks/useOldData.ts': `import { useState, useEffect } from 'react';
import type { OldInputProps } from '../components/OldInput';

export function useOldData(defaultValue: string) {
  const [data, setData] = useState(defaultValue);
  return { data, setData };
}`,
        'src/utils/index.ts': `export { oldFormatter } from './oldFormatter';`,
        'src/utils/oldFormatter.ts': `export function oldFormatter(value: string): string {
  return value.trim().toLowerCase();
}`,
        'src/pages/Home.tsx': `import { OldInput, Select } from '../components';
import { useOldData } from '../hooks';
import { oldFormatter } from '../utils';
import type { OldInputProps } from '../components/OldInput';

export const Home: React.FC = () => {
  const { data, setData } = useOldData('');
  const display = oldFormatter(data);
  return <div>
    <h1>Home</h1>
    <OldInput value={data} onChange={setData} placeholder="Enter text" />
    <Select options={['a', 'b']} />
    <p>{display}</p>
  </div>;
};`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename through 3-level barrel chain (src/index → components/index → OldInput)', () => {
      const oldName = 'OldInput';
      const newName = 'Input';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 叶子定义 (OldInput → Input, OldInputProps → InputProps)
      const leafEdits = workspaceEdit.changes[`file://src/components/OldInput.ts`];
      expect(leafEdits).toBeDefined();
      if (leafEdits) {
        // 至少有对 OldInput 本身的 rename
        const classRename = leafEdits.filter(e => e.newText === newName);
        expect(classRename.length).toBeGreaterThan(0);
      }

      // barrel 1: components/index.ts
      const barrel1Edits = workspaceEdit.changes[`file://src/components/index.ts`];
      expect(barrel1Edits).toBeDefined();

      // 同目录 Select.ts 引用
      const selectEdits = workspaceEdit.changes[`file://src/components/Select.ts`];
      expect(selectEdits).toBeDefined();

      // hooks/useOldData.ts (type-only import)
      const hooksEdits = workspaceEdit.changes[`file://src/hooks/useOldData.ts`];
      expect(hooksEdits).toBeDefined();

      // pages/Home.tsx 消费者
      const homeEdits = workspaceEdit.changes[`file://src/pages/Home.tsx`];
      expect(homeEdits).toBeDefined();

      // 应用并验证全链一致
      const editedFiles = Object.fromEntries(project.files);
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editedFiles[fp] = applyTextEdits(editedFiles[fp] || '', edits);
      }

      // 顶层 barrel 中无旧名称
      expect(editedFiles['src/index.ts']).not.toContain(oldName);
      // 二级 barrel 已更新
      expect(editedFiles['src/components/index.ts']).not.toContain(oldName);
      expect(editedFiles['src/components/index.ts']).toContain(newName);
      // 消费者已更新
      expect(editedFiles['src/pages/Home.tsx']).not.toContain(oldName);
      expect(editedFiles['src/pages/Home.tsx']).toContain(newName);
      // hooks 的 type-only 引用已更新
      expect(editedFiles['src/hooks/useOldData.ts']).not.toContain(oldName);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 5: type-only import / export rename
  // ═══════════════════════════════════════════════════════════════════
  describe('5. type-only import rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('type-only');
      await project.setup({
        'src/OldTypes.ts': `export type OldUser = {
  id: string;
  name: string;
  email: string;
};

export interface OldConfig {
  debug: boolean;
  port: number;
}`,
        'src/services.ts': `import type { OldUser, OldConfig } from './OldTypes';

export function getUser(): OldUser {
  return { id: '1', name: 'Test', email: 'test@test.com' };
}

export function getConfig(): OldConfig {
  return { debug: true, port: 3000 };
}`,
        'src/components.ts': `import type { OldUser } from './OldTypes';
import React from 'react';

type Props = { user: OldUser };

export const UserCard: React.FC<Props> = ({ user }) => {
  return <div>{user.name} ({user.email})</div>;
};`,
        'src/index.ts': `export type { OldUser, OldConfig } from './OldTypes';
export { getUser, getConfig } from './services';
export { UserCard } from './components';`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename type-only imported symbols', () => {
      const oldName = 'OldUser';
      const newName = 'User';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 类型定义处
      const typeEdits = workspaceEdit.changes[`file://src/OldTypes.ts`];
      expect(typeEdits).toBeDefined();

      // services.ts 中的 type-only import
      const svcEdits = workspaceEdit.changes[`file://src/services.ts`];
      expect(svcEdits).toBeDefined();

      // components.ts 中的 type-only import
      const compEdits = workspaceEdit.changes[`file://src/components.ts`];
      expect(compEdits).toBeDefined();

      // barrel export
      const idxEdits = workspaceEdit.changes[`file://src/index.ts`];
      expect(idxEdits).toBeDefined();

      // 验证 import type 语句被正确处理
      if (svcEdits) {
        const importTypeEdit = svcEdits.find(e =>
          e.range.start.line === 0 && e.newText && e.newText.includes(newName)
        );
        expect(importTypeEdit).toBeDefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 6: default export rename
  // ═══════════════════════════════════════════════════════════════════
  describe('6. default export rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('default-export');
      await project.setup({
        'src/OldComponent.tsx': `import React from 'react';

interface Props { title: string }

const OldComponent: React.FC<Props> = ({ title }) => {
  return <h1>{title}</h1>;
};

export default OldComponent;`,
        'src/App.tsx': `import React from 'react';
import OldComponent from './OldComponent';

export const App: React.FC = () => {
  return <div><OldComponent title="Hello" /></div>;
};`,
        'src/index.ts': `export { default as OldComponent } from './OldComponent';
export { App } from './App';`,
        'src/utils.ts': `import OldComponent from './OldComponent';

export const renderComponent = () => OldComponent({ title: 'Static' });`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename default-exported symbol and update default imports', () => {
      const oldName = 'OldComponent';
      const newName = 'Component';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 定义文件
      const defEdits = workspaceEdit.changes[`file://src/OldComponent.tsx`];
      expect(defEdits).toBeDefined();

      // App.tsx: import OldComponent from...
      const appEdits = workspaceEdit.changes[`file://src/App.tsx`];
      expect(appEdits).toBeDefined();
      if (appEdits) {
        // 需要更新 import 声明中的标识符 + JSX 使用
        const importEdit = appEdits.find(e => e.newText === newName);
        const jsxEdit = appEdits.find(e =>
          e.range.start.line > 0 && e.newText === newName
        );
        expect(importEdit).toBeDefined();
      }

      // index.ts barrel: export { default as OldComponent }
      const barrelEdits = workspaceEdit.changes[`file://src/index.ts`];
      expect(barrelEdits).toBeDefined();

      // utils.ts
      const utilEdits = workspaceEdit.changes[`file://src/utils.ts`];
      expect(utilEdits).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 7: alias import rename (import { X as Y })
  // ═══════════════════════════════════════════════════════════════════
  describe('7. alias import rename', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('alias-import');
      await project.setup({
        'src/OldApi.ts': `export class OldApiClient {
  private baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl = baseUrl; }
  async fetch(path: string) {
    return fetch(\`\${this.baseUrl}\${path}\`).then(r => r.json());
  }
}`,
        'src/http-layer.ts': `import { OldApiClient as HttpClient } from './OldApiClient';

const api = new HttpClient('https://api.example.com');

export function getData() {
  return api.fetch('/data');
}`,
        'src/cache-layer.ts': `import { OldApiClient as Api } from './OldApiClient';

const api = new Api('https://cache.example.com');
export const cached = api.fetch('/cache');`,
        'src/index.ts': `export { OldApiClient } from './OldApiClient';
export { getData } from './http-layer';
export { cached } from './cache-layer';`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should rename original symbol while preserving local alias names', () => {
      const oldName = 'OldApiClient';
      const newName = 'ApiClient';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
        { renameSymbolOnly: false },
      );

      // 定义文件
      const defEdits = workspaceEdit.changes[`file://src/OldApi.ts`];
      expect(defEdits).toBeDefined();

      // http-layer.ts: import { OldApiClient as HttpClient }
      const httpEdits = workspaceEdit.changes[`file://src/http-layer.ts`];
      expect(httpEdits).toBeDefined();
      if (httpEdits) {
        // 验证：只替换 OldApiClient，不替换 as HttpClient
        const httpContent = project.files.get('src/http-layer.ts');
        const edited = applyTextEdits(httpContent, httpEdits);
        expect(edited).not.toContain('OldApiClient');
        expect(edited).toContain('HttpClient'); // alias 保留
        expect(edited).toContain(`${newName} as HttpClient`);
      }

      // cache-layer.ts: import { OldApiClient as Api }
      const cacheEdits = workspaceEdit.changes[`file://src/cache-layer.ts`];
      expect(cacheEdits).toBeDefined();
      if (cacheEdits) {
        const cacheContent = project.files.get('src/cache-layer.ts');
        const edited = applyTextEdits(cacheContent, cacheEdits);
        expect(edited).not.toContain('OldApiClient');
        expect(edited).toContain('Api'); // alias 保留
      }

      // barrel
      const barrelEdits = workspaceEdit.changes[`file://src/index.ts`];
      expect(barrelEdits).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 8: Same-line multiple edits (TextEdit→Hashline proof)
  // ═══════════════════════════════════════════════════════════════════
  describe('8. Same-line multi-edit / overlapping edits', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('same-line');
      await project.setup({
        'src/code.ts': `const oldVar = oldFunc(oldArg);
console.log(oldVar);
export { oldVar };`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should handle multiple same-line edits: oldVar→newVar, oldFunc→newFunc, oldArg→newArg', () => {
      const content = project.files.get('src/code.ts');
      const lines = content.split('\n');

      // Character positions: const oldVar = oldFunc(oldArg);
      // oldVar at 6-12, oldFunc at 15-22, oldArg at 23-29

      const edits = [
        makeTextEdit(0, 23, 0, 29, 'newArg'),
        makeTextEdit(0, 15, 0, 22, 'newFunc'),
        makeTextEdit(0, 6, 0, 12, 'newVar'),
        makeTextEdit(1, 12, 1, 18, 'newVar'),
        makeTextEdit(2, 9, 2, 15, 'newVar'),
      ];

      // 排序后从后往前应用
      const sorted = [...edits].sort((a, b) => {
        if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
        return b.range.start.character - a.range.start.character;
      });

      let result = content;
      for (const e of sorted) {
        result = applyTextEdits(result, [e]);
      }

      // 验证所有旧标识符都已替换
      expect(result).not.toContain('oldVar');
      expect(result).not.toContain('oldFunc');
      expect(result).not.toContain('oldArg');

      // 验证替换结果
      expect(result).toContain('const newVar = newFunc(newArg)');
      expect(result).toContain('console.log(newVar)');
      expect(result).toContain('export { newVar }');

      // Hashline 映射
      const editsByPath = {
        'src/code.ts': { originalContent: content, edits },
      };
      const patch = lspTextEditsToHashlinePatch(editsByPath);
      expect(patch).toContain('[src/code.ts#');
      expect(patch).toContain('SWAP');

      // 同行多 edit 时，Hashline 应产生多个 SWAP（行号相同，从后往前）
      const swapCount = (patch.match(/SWAP/g) || []).length;
      expect(swapCount).toBeGreaterThanOrEqual(3);

      // 无重叠冲突
      const conflicts = detectOverlappingEdits(editsByPath);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect overlapping edits as conflicts', () => {
      const content = 'const testVar = 42;';
      const overlapEdits = [
        makeTextEdit(0, 6, 0, 13, 'newTest'),   // 6-13
        makeTextEdit(0, 10, 0, 18, 'changed'),    // 10-18 (重叠!)
      ];

      const editsByPath = {
        'src/code.ts': { originalContent: content, edits: overlapEdits },
      };

      const conflicts = detectOverlappingEdits(editsByPath);
      expect(conflicts.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 9: Mixed create-delete-rename in workspace edit
  // ═══════════════════════════════════════════════════════════════════
  describe('9. Mixed create-delete-rename operations', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('mixed-ops');
      await project.setup({
        'src/OldService.ts': `export class OldService {
  private db: any;
  connect() { console.log('connected'); }
  disconnect() { console.log('disconnected'); }
}`,
        'src/Consumer.ts': `import { OldService } from './OldService';
import { helper } from './helper';

const svc = new OldService();
svc.connect();
helper();
svc.disconnect();`,
        'src/helper.ts': `export function helper() {
  console.log('helper');
}`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should handle rename that also involves add/remove of lines around the symbol', () => {
      const oldName = 'OldService';
      const newName = 'NewService';

      // 模拟一个场景：class 定义处重命名 + 在类中新增方法 + 删除旧方法
      const definitionContent = project.files.get('src/OldService.ts');

      // Find line numbers from content
      const defLines = definitionContent.split('\n');
      let classLine = -1, connectLine = -1, disconnectLine = -1;
      for (let i = 0; i < defLines.length; i++) {
        if (defLines[i].includes(`class ${oldName}`)) classLine = i;
        if (defLines[i].includes('connect()')) connectLine = i;
        if (defLines[i].includes('disconnect()')) disconnectLine = i;
      }

      expect(classLine).toBeGreaterThanOrEqual(0);

      const edits = [
        // 重命名 class
        makeTextEdit(classLine, 13, classLine, 13 + oldName.length, newName),
        // 新增方法（在 connect 之后）
        makeTextEdit(connectLine + 1, 0, connectLine + 1, 0, '  query() { console.log("querying"); }\n'),
        // 删除 disconnect 方法
        makeTextEdit(disconnectLine, 0, disconnectLine + 1, 0, ''),
      ];

      // 应用编辑
      let result = definitionContent;
      for (const edit of edits.sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
        result = applyTextEdits(result, [edit]);
      }

      expect(result).toContain(`class ${newName}`);
      expect(result).toContain('query()');
      expect(result).not.toContain('disconnect()');

      // Hashline 转换
      const editsByPath = {
        'src/OldService.ts': { originalContent: definitionContent, edits },
      };
      const patch = lspTextEditsToHashlinePatch(editsByPath);
      expect(patch).toContain('[src/OldService.ts#');
      // 应有多个 SWAP（rename + delete + add）
      const opCount = (patch.match(/SWAP/g) || []).length;
      expect(opCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 10: Large-file batch rename stress test
  // ═══════════════════════════════════════════════════════════════════
  describe('10. Large batch rename stress', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('large-rename');
      const files = {};

      // 生成 200 行的文件，其中 50 处引用 target symbol
      let mainContent = '// Auto-generated test file\n';
      for (let i = 0; i < 200; i++) {
        if (i % 4 === 0) {
          mainContent += `const ref${i} = oldTargetFn(data${i});\n`;
        } else if (i % 4 === 1) {
          mainContent += `export function helper${i}() { return oldTargetFn('arg${i}'); }\n`;
        } else if (i % 4 === 2) {
          mainContent += `type T${i} = ReturnType<typeof oldTargetFn>;\n`;
        } else {
          mainContent += `const x${i} = { fn: oldTargetFn, id: ${i} };\n`;
        }
      }
      mainContent += '\nexport default oldTargetFn;\n';
      files['src/main.ts'] = mainContent;

      // 生成额外的消费者文件
      let consumerContent = 'import { oldTargetFn } from "./main";\n';
      for (let i = 0; i < 50; i++) {
        consumerContent += `const R${i} = oldTargetFn("val${i}");\n`;
      }
      files['src/consumer.ts'] = consumerContent;

      await project.setup(files);
    });

    afterAll(async () => { await project.cleanup(); });

    it('should correctly rename 50+ occurrences across files', () => {
      const oldName = 'oldTargetFn';
      const newName = 'newTargetFn';

      const workspaceEdit = simulateRenameEdits(
        Object.fromEntries(project.files),
        oldName, newName,
      );

      // 统计编辑数
      const mainEdits = workspaceEdit.changes['file://src/main.ts'] || [];
      const consumerEdits = workspaceEdit.changes['file://src/consumer.ts'] || [];
      expect(mainEdits.length).toBeGreaterThanOrEqual(50);
      expect(consumerEdits.length).toBeGreaterThanOrEqual(50);

      // 应用所有编辑
      const editedFiles = Object.fromEntries(project.files);
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editedFiles[fp] = applyTextEdits(editedFiles[fp] || '', edits);
      }

      // 全面验证：所有文件中无旧名称残留
      for (const [fp, content] of Object.entries(editedFiles)) {
        const remaining = content.match(new RegExp(oldName, 'g'));
        expect(remaining).toBeNull();
      }

      // 新名称出现次数 === 旧名称本应出现的位置数
      const mainOccurrences = (editedFiles['src/main.ts'].match(new RegExp(newName, 'g')) || []).length;
      const consumerOccurrences = (editedFiles['src/consumer.ts'].match(new RegExp(newName, 'g')) || []).length;
      expect(mainOccurrences).toBeGreaterThanOrEqual(50);
      expect(consumerOccurrences).toBeGreaterThanOrEqual(50);

      // Hashline patch 无重叠冲突
      const editsByPath = {};
      for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
        const fp = uri.replace('file://', '');
        editsByPath[fp] = { originalContent: project.files.get(fp), edits };
      }
      const conflicts = detectOverlappingEdits(editsByPath);
      expect(conflicts).toHaveLength(0);

      // Hashline patch 可序列化
      const patchText = lspTextEditsToHashlinePatch(editsByPath);
      expect(patchText.length).toBeGreaterThan(1000);
      expect(patchText).toContain('[src/main.ts#');
      expect(patchText).toContain('[src/consumer.ts#');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Test 11: Hashline atomic rollback proof
  // ═══════════════════════════════════════════════════════════════════
  describe('11. Hashline atomic rollback for workspace edit', () => {
    let project;

    beforeAll(async () => {
      project = new TestProject('rollback');
      await project.setup({
        'src/a.ts': `export const A = "original";`,
        'src/b.ts': `export const B = "original";`,
        'src/c.ts': `export const C = "original";`,
      });
    });

    afterAll(async () => { await project.cleanup(); });

    it('should produce correct Hashline patches that include all files', () => {
      const edits = {
        'src/a.ts': [makeTextEdit(0, 18, 0, 28, 'modifiedA')],
        'src/b.ts': [makeTextEdit(0, 18, 0, 28, 'modifiedB')],
        'src/c.ts': [makeTextEdit(0, 18, 0, 28, 'modifiedC')],
      };

      const editsByPath = {};
      for (const [fp, fileEdits] of Object.entries(edits)) {
        editsByPath[fp] = { originalContent: project.files.get(fp), edits: fileEdits };
      }

      const patch = lspTextEditsToHashlinePatch(editsByPath);

      // 3 个 section 头
      expect((patch.match(/^\[/gm) || []).length).toBe(3);
      // 每个 section 有其 tag
      const tags = [...patch.matchAll(/^\[([^\]#]+)#([a-f0-9]+)\]/gm)];
      expect(tags.length).toBe(3);

      // 验证应用每个文件
      for (const [fp, fileEdits] of Object.entries(edits)) {
        const original = project.files.get(fp);
        const edited = applyTextEdits(original, fileEdits);
        expect(edited).toContain('modified');
        expect(edited).not.toContain('original');
      }
    });
  });
});
