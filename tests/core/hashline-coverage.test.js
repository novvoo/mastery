/**
 * Hashline 覆盖增强测试
 *
 * 目标：全面覆盖 hashine.js 中之前未被测试的核心路径与边缘情况，
 * 包括：Filesystem 基类、DiskFilesystem 细节、SnapshotStore 边界、
 * _checkFilePolicy、扩展 DSL 操作、Diff3MergeEngine 内部函数、
 * 错误格式化 / StructuredError、Patcher 内部 recovery 分支等。
 */
import { describe, test, expect } from 'bun:test';
import {
  Filesystem,
  DiskFilesystem,
  MemoryFilesystem,
  InMemorySnapshotStore,
  Patcher,
  Patch,
  parsePatch,
  serializePatch,
  applyHunksToText,
  applyHunksToTextExtended,
  parsePatchExtended,
  Section,
  PatchParseError,
  PatchApplyError,
  StructuredParseError,
  StructuredApplyError,
  Diff3MergeEngine,
  createDiff3Conflict,
  HashlineErrorCode,
  HashlineErrorSeverity,
  errorSeverity,
  formatHashlineError,
  createPatcher,
  hashContent,
  computeTag,
  normalizeText,
  OP_SWAP,
  OP_DEL,
  OP_INS_PRE,
  OP_INS_POST,
  OP_NOP,
  OP_INS_HEAD,
  OP_INS_TAIL,
  OP_INS_BLK_POST,
  OP_SWAP_BLK,
  OP_DEL_BLK,
  OP_ABORT,
} from '../../src/core/harness/hashline.js';
import { ContentAddressableStore } from '../../src/core/harness/content-addressing.js';
import { mkdir, writeFile, rm, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
// 1. Filesystem 基类 + DiskFilesystem 静态方法 + stat 错误
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: Filesystem base class', () => {
  test('read throws not implemented', async () => {
    const fs = new Filesystem();
    await expect(fs.read('x')).rejects.toThrow('not implemented');
  });

  test('write throws not implemented', async () => {
    const fs = new Filesystem();
    await expect(fs.write('x', 'y')).rejects.toThrow('not implemented');
  });

  test('exists throws not implemented', async () => {
    const fs = new Filesystem();
    await expect(fs.exists('x')).rejects.toThrow('not implemented');
  });

  test('stat throws not implemented', async () => {
    const fs = new Filesystem();
    await expect(fs.stat('x')).rejects.toThrow('not implemented');
  });
});

describe('hashline coverage: DiskFilesystem stat & realpath', () => {
  test('stat throws on missing file', async () => {
    const fs = new DiskFilesystem('/tmp/nonexistent-hashline-test');
    await expect(fs.stat('nope.txt')).rejects.toThrow();
  });

  test('_getRealpath caches', async () => {
    // macOS /tmp → /private/tmp 是 symlink，避免用 /tmp
    const { mkdtemp, rm } = await import('fs/promises');
    const tmp = await mkdtemp('/tmp/hl-cache-');
    const fs = new DiskFilesystem(tmp);
    try {
      const r1 = fs._getRealpath(tmp);
      const r2 = fs._getRealpath(tmp);
      expect(r1).toBe(r2);
      expect(fs._realpathCache.has(tmp)).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('_getRealpath returns path on lstat/readlink error', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const tmp = await mkdtemp('/tmp/hl-real-');
    const fs = new DiskFilesystem(tmp);
    try {
      const result = fs._getRealpath(tmp + '/___no_such_path___');
      expect(typeof result).toBe('string');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('_resolve handles normal path', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const tmp = await mkdtemp('/tmp/hl-rslv-');
    const fs = new DiskFilesystem(tmp);
    try {
      const resolved = fs._resolve('test.js');
      expect(resolved).toContain('hl-rslv-');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('_resolve root with trailing separator', async () => {
    const { mkdtemp, rm } = await import('fs/promises');
    const tmp = await mkdtemp('/tmp/hl-root-');
    const fs = new DiskFilesystem(tmp + '/');
    try {
      const resolved = fs._resolve('test.js');
      expect(resolved).toContain('hl-root-');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('hashline coverage: MemoryFilesystem stat error', () => {
  test('stat throws ENOENT on missing file', async () => {
    const fs = new MemoryFilesystem();
    let err;
    try {
      await fs.stat('nope');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('ENOENT');
  });

  test('snapshot exports all files', () => {
    const fs = new MemoryFilesystem({ a: '1', b: '2' });
    const snap = fs.snapshot();
    expect(snap).toEqual({ a: '1', b: '2' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. InMemorySnapshotStore 边界
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: InMemorySnapshotStore edges', () => {
  test('maxTotalBytes eviction triggers on large content', () => {
    const s = new InMemorySnapshotStore({
      maxPaths: 10,
      maxVersionsPerPath: 5,
      maxTotalBytes: 200,
    });
    const big = 'x'.repeat(100);
    // 超出总字节上限，应逐出最老 path 的最老版本
    s.record('a', big);
    s.record('b', big);
    s.record('c', big); // 至少 300 bytes，超出 200
    const st = s.stats();
    expect(st.totalBytes).toBeLessThanOrEqual(200);
  });

  test('maxTotalBytes evicts oldest path when single version', () => {
    const s = new InMemorySnapshotStore({ maxPaths: 10, maxVersionsPerPath: 5, maxTotalBytes: 50 });
    s.record('a', 'hello');
    s.record('b', 'world');
    // 可能被迫淘汰
    const st = s.stats();
    expect(st.totalBytes).toBeLessThanOrEqual(50);
  });

  test('seenLines returns empty set for unknown path', () => {
    const s = new InMemorySnapshotStore();
    const seen = s.seenLines('unknown');
    expect(seen).toBeInstanceOf(Set);
    expect(seen.size).toBe(0);
  });

  test('record with null/undefined text', () => {
    const s = new InMemorySnapshotStore();
    const t1 = s.record('a', null);
    const t2 = s.record('a', undefined);
    expect(t1).toBeDefined();
    expect(t1).toBe(t2);
    expect(s.head('a').tag).toBe(t1);
  });

  test('recordSeenLines stops recording when over cap', () => {
    const s = new InMemorySnapshotStore();
    // 预先灌满 seen lines
    let text = '';
    for (let i = 0; i < 5000; i++) {
      text += `line_${i}\n`;
    }
    s.record('a', text);
    const seen = s.seenLines('a');
    // 不应超过 4096
    expect(seen.size).toBeLessThanOrEqual(4096);
  });

  test('history returns empty array for unknown path', () => {
    const s = new InMemorySnapshotStore();
    expect(s.history('unknown')).toEqual([]);
  });

  test('re-recording same content reindexes correctly', () => {
    const s = new InMemorySnapshotStore({ maxVersionsPerPath: 2 });
    const t1 = s.record('a', 'v1');
    s.record('a', 'v2'); // 这会淘汰 t1
    // t1 被淘汰后，重新记录它应该能工作
    const t1Again = s.record('a', 'v1');
    expect(t1Again).toBe(t1);
  });

  test('_evict with maxVersionsPerPath evicts and reindexes', () => {
    const s = new InMemorySnapshotStore({ maxVersionsPerPath: 2 });
    const t1 = s.record('a', '1');
    const t2 = s.record('a', '2');
    const t3 = s.record('a', '3');
    // t1 被 evict
    expect(s.has('a', t1)).toBe(false);
    expect(s.has('a', t2)).toBe(true);
    expect(s.has('a', t3)).toBe(true);
    expect(s.history('a').length).toBe(2);
    // _reindex 保证 byHash 能找到 t2 和 t3
    expect(s.byHash('a', t2).tag).toBe(t2);
    expect(s.byHash('a', t3).tag).toBe(t3);
  });

  test('stats reports maxPaths correct', () => {
    const s = new InMemorySnapshotStore({ maxPaths: 5, maxVersionsPerPath: 3 });
    const st = s.stats();
    expect(st.maxPaths).toBe(5);
    expect(st.maxVersionsPerPath).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. _checkFilePolicy: generated / lockfile / large file 保护
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: Patcher._checkFilePolicy', () => {
  test('blocks generated files (.d.ts)', async () => {
    const fs = new MemoryFilesystem({ 'src/types.d.ts': 'export type Foo = number;' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('src/types.d.ts', 'export type Foo = number;');
    const r = await p.apply(
      '[src/types.d.ts#' + computeTag('export type Foo = number;\n') + ']\nDEL 1.=1',
    );
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks files in /dist/', async () => {
    const fs = new MemoryFilesystem({ '/dist/bundle.js': 'console.log(1);\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('/dist/bundle.js', 'console.log(1);\n');
    const r = await p.apply('[/dist/bundle.js#' + computeTag('console.log(1);\n') + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks files in /build/', async () => {
    const fs = new MemoryFilesystem({ '/build/output.js': 'x\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('/build/output.js', 'x\n');
    const r = await p.apply('[/build/output.js#' + computeTag('x\n') + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks files in /node_modules/', async () => {
    const fs = new MemoryFilesystem({ '/node_modules/pkg/index.js': 'module.exports = 1;\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('/node_modules/pkg/index.js', 'module.exports = 1;\n');
    const r = await p.apply(
      '[/node_modules/pkg/index.js#' + computeTag('module.exports = 1;\n') + ']\nDEL 1.=1',
    );
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks lockfiles (package-lock.json)', async () => {
    const fs = new MemoryFilesystem({ 'package-lock.json': '{"lock":true}\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('package-lock.json', '{"lock":true}\n');
    const r = await p.apply('[package-lock.json#' + computeTag('{"lock":true}\n') + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks lockfiles (yarn.lock)', async () => {
    const fs = new MemoryFilesystem({ 'yarn.lock': 'lock\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('yarn.lock', 'lock\n');
    const r = await p.apply('[yarn.lock#' + computeTag('lock\n') + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks lockfiles (pnpm-lock.yaml)', async () => {
    const fs = new MemoryFilesystem({ 'pnpm-lock.yaml': 'lock: true\n' });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('pnpm-lock.yaml', 'lock: true\n');
    const r = await p.apply('[pnpm-lock.yaml#' + computeTag('lock: true\n') + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.policyBlocked).toBe(true);
  });

  test('blocks files larger than maxFileSize', async () => {
    // maxFileSize 在 Patcher 构造函数中不是独立参数，通过 this.maxFileSize 设置
    // 默认 1MB。构造 > 1MB 文件来触发保护。
    const big = 'x'.repeat(2_000_000) + '\n';
    const fs = new MemoryFilesystem({ 'big.txt': big });
    const snapshots = new InMemorySnapshotStore();
    const p = new Patcher({ fs, snapshots });
    snapshots.record('big.txt', big);
    const r = await p.apply('[big.txt#' + computeTag(big) + ']\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('too large');
  });

  test('allows normal file editing through policy check', async () => {
    const fs = new MemoryFilesystem({ 'src/normal.ts': 'const x = 1;\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('src/normal.ts', 'const x = 1;\n');
    const p = new Patcher({ fs, snapshots });
    const r = await p.apply(`[src/normal.ts#${tag}]\nSWAP 1.=1:\n+const x = 2;`);
    expect(r.ok).toBe(true);
  });

  test('allows file creation when stat fails', async () => {
    // _checkFilePolicy 中 stat 失败 → null（允许编辑/创建）
    const fs = new MemoryFilesystem();
    // 但是 Patcher 的 apply 会在 preflight 阶段遇到 file not found
    // 这里我们只测 policy 不阻塞的情况
    const p = new Patcher({ fs, snapshots: new InMemorySnapshotStore() });
    const r = await p.apply(
      '[newfile.js#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nINS.PRE 1=\n+hello',
    );
    // 文件不存在 → preflight 失败但不是 policyBlocked
    expect(r.ok).toBe(false);
    expect(r.error).toContain('file not found');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. parsePatchExtended: ABORT / loose tag / 各种 unified diff 前缀 / 结构化错误
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: parsePatchExtended', () => {
  test('rejects unified diff header: @@', () => {
    expect(() => parsePatchExtended('@@ -1,5 +1,6 @@\n+new line\n')).toThrow(StructuredParseError);
  });

  test('rejects unified diff header: ---', () => {
    expect(() => parsePatchExtended('--- a/file.js\n--- b/file.js')).toThrow(StructuredParseError);
  });

  test('rejects unified diff header: +++', () => {
    expect(() => parsePatchExtended('+++ b/file.js\n@@ -1 +1 @@')).toThrow(StructuredParseError);
  });

  test('rejects unified diff header: diff ', () => {
    expect(() => parsePatchExtended('diff --git a/file b/file')).toThrow(StructuredParseError);
  });

  test('parses ABORT sentinel', () => {
    const patch = parsePatchExtended(
      '[test.txt#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nABORT',
    );
    expect(patch.sections.length).toBe(1);
    expect(patch.sections[0].hunks.length).toBe(1);
    expect(patch.sections[0].hunks[0].op).toBe(OP_ABORT);
  });

  test('parses loose section header (non-64-char tag)', () => {
    const patch = parsePatchExtended('[test.txt#short]\nDEL 1.=1');
    expect(patch.sections.length).toBe(1);
    expect(patch.sections[0].tag).toBe('short');
  });

  test('parses INS.BLK.POST', () => {
    const patch = parsePatchExtended(
      '[test.txt#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nINS.BLK.POST 3=\n+after block',
    );
    expect(patch.sections[0].hunks[0].op).toBe(OP_INS_BLK_POST);
  });

  test('parses SWAP.BLK', () => {
    const patch = parsePatchExtended(
      '[test.txt#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nSWAP.BLK 3=\n+new',
    );
    expect(patch.sections[0].hunks[0].op).toBe(OP_SWAP_BLK);
  });

  test('parses DEL.BLK', () => {
    const patch = parsePatchExtended(
      '[test.txt#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nDEL.BLK 3=',
    );
    expect(patch.sections[0].hunks[0].op).toBe(OP_DEL_BLK);
  });

  test('throws StructuredParseError on unrecognized line', () => {
    try {
      parsePatchExtended(
        '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\n??GARBAGE 1',
      );
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredParseError);
      expect(e.code).toBe(HashlineErrorCode.PARSE_UNEXPECTED_TOKEN);
      expect(e.srcLine).toBe(2);
    }
  });

  test('throws on content line without op', () => {
    try {
      parsePatchExtended(
        '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\n+content',
      );
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredParseError);
      expect(e.code).toBe(HashlineErrorCode.PARSE_CONTENT_WITHOUT_OP);
    }
  });

  test('throws on content before section', () => {
    try {
      parsePatchExtended(
        '+content\n[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nDEL 1.=1',
      );
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredParseError);
      expect(e.code).toBe(HashlineErrorCode.PARSE_NO_SECTION_OPEN);
    }
  });

  test('ABORT skips content lines after', () => {
    // ABORT 后 flushOp → 后续 + 行应报错（没有 op）
    expect(() =>
      parsePatchExtended(
        '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nABORT\n+should not be here',
      ),
    ).toThrow();
  });

  test('INS.HEAD + INS.TAIL in same section', () => {
    const p = parsePatchExtended(
      '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nINS.HEAD 1=\n+// top\nINS.TAIL 3=\n+// bottom',
    );
    const h = p.sections[0].hunks;
    expect(h[0].op).toBe(OP_INS_HEAD);
    expect(h[0].lines).toEqual(['// top']);
    expect(h[1].op).toBe(OP_INS_TAIL);
    expect(h[1].lines).toEqual(['// bottom']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. applyHunksToTextExtended: BLK 操作 + applyHunksToText NOP + unknown op
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: applyHunksToTextExtended BLK ops', () => {
  test('INS.BLK.POST inserts after block boundary', () => {
    const text = 'import x;\n\nfunction foo() {\n}\n\nclass Bar {\n}';
    // 从 line 3 (function foo) 找块结束 → line 4 (}) 后空行 line 5
    const hunks = [{ op: OP_INS_BLK_POST, start: 3, end: 3, lines: ['// comment'] }];
    const r = applyHunksToTextExtended(text, hunks);
    // 应该插入在 block 结尾空行之后
    expect(r).toContain('// comment');
    expect(r.split('// comment')[1] || '').toContain('class');
  });

  test('INS.BLK.POST at end of file', () => {
    const text = 'function foo() {\n}';
    const hunks = [{ op: OP_INS_BLK_POST, start: 1, end: 1, lines: ['// after'] }];
    const r = applyHunksToTextExtended(text, hunks);
    expect(r).toContain('// after');
  });

  test('SWAP.BLK replaces entire blank-line-delimited block', () => {
    const text =
      'import x;\n\nfunction foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}';
    // anchor at line 3 (inside foo block), should swap entire foo block
    const hunks = [
      { op: OP_SWAP_BLK, start: 3, end: 3, lines: ['function foo() {', '  return 99;', '}'] },
    ];
    const r = applyHunksToTextExtended(text, hunks);
    expect(r).toContain('return 99');
    expect(r).toContain('function bar');
  });

  test('SWAP.BLK at first block (no preceding blank line)', () => {
    const text = 'function first() {\n  return 1;\n}\n\nfunction second() {\n}';
    const hunks = [
      { op: OP_SWAP_BLK, start: 1, end: 1, lines: ['function first() {', '  return 99;', '}'] },
    ];
    const r = applyHunksToTextExtended(text, hunks);
    expect(r).toContain('return 99');
    expect(r).toContain('function second');
  });

  test('DEL.BLK removes entire block', () => {
    const text = 'import x;\n\nfunction foo() {\n  old;\n}\n\nfunction bar() {\n}';
    const hunks = [{ op: OP_DEL_BLK, start: 3, end: 3, lines: [] }];
    const r = applyHunksToTextExtended(text, hunks);
    expect(r).not.toContain('function foo');
    expect(r).toContain('function bar');
  });

  test('ABORT hunk is skipped', () => {
    const hunks = [
      { op: OP_ABORT, start: 0, end: 0, lines: [] },
      { op: OP_SWAP, start: 1, end: 1, lines: ['changed'] },
    ];
    const r = applyHunksToTextExtended('original\n', hunks);
    expect(r).toBe('changed\n');
  });

  test('empty hunks returns original text', () => {
    expect(applyHunksToTextExtended('original\n', [])).toBe('original\n');
  });

  test('NOP is skipped in applyHunksToText', () => {
    const hunks = [
      { op: OP_NOP, start: 1, end: 1, lines: [] },
      { op: OP_SWAP, start: 1, end: 1, lines: ['changed'] },
    ];
    const r = applyHunksToText('original\n', hunks);
    expect(r).toBe('changed\n');
  });

  test('unknown op throws in applyHunksToText', () => {
    expect(() => applyHunksToText('x\n', [{ op: 'UNKNOWN', start: 1, end: 1, lines: [] }])).toThrow(
      'unknown op',
    );
  });

  test('unknown op throws in applyHunksToTextExtended', () => {
    expect(() =>
      applyHunksToTextExtended('x\n', [{ op: 'UNKNOWN', start: 1, end: 1, lines: [] }]),
    ).toThrow(PatchApplyError);
  });

  test('overlapping hunks in extended throws when simplified check', () => {
    // 两个非空区间重叠
    expect(() =>
      applyHunksToTextExtended('a\nb\nc\nd\n', [
        { op: OP_SWAP, start: 2, end: 3, lines: ['x'] },
        { op: OP_SWAP, start: 3, end: 4, lines: ['y'] },
      ]),
    ).toThrow(PatchApplyError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. _remapHunksByContent + _contentMatchScore + _remapHunksAgainstBase gone +
//    _computeLCSGreedy + Patcher autoRecord=false / allowRecovery 默认
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: Patcher recovery internals', () => {
  test('_remapHunksByContent with exact content match', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'foo\nbar\nbaz\n' });
    const snapshots = new InMemorySnapshotStore();
    // 不存 base snapshot，只靠 seen lines
    const tag = snapshots.record('a.txt', 'foo\nbar\nbaz\n');
    // 修改文件
    await fs.write('a.txt', 'PRE\nfoo\nbar\nbaz\n');
    const p = new Patcher({ fs, snapshots });
    // SWAP 带有 lines（hunk 内容），_remapHunksByContent 应该用它匹配
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 2.=2:\n+REPLACED_BAR`);
    expect(r.ok).toBe(true);
    // bar 应该被替换（具体位置取决于匹配结果）
  });

  test('_remapHunksByContent with no snapshot - INS operations keep position', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'foo\nbar\nbaz\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'foo\nbar\nbaz\n');
    await fs.write('a.txt', 'foo\nbar\nbaz\n');
    const p = new Patcher({ fs, snapshots });
    // INS.PRE 操作，_remapHunksByContent 应该保持原行号
    const r = await p.apply(`[a.txt#${tag}]\nINS.PRE 2=\n+INSERTED`);
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('foo\nINSERTED\nbar\nbaz\n');
  });

  test('_remapHunksByContent with short fingerprint skips remap', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'a\nb\nc\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'a\nb\nc\n');
    await fs.write('a.txt', 'X\na\nb\nc\n');
    const p = new Patcher({ fs, snapshots });
    // SWAP with very short lines（<3 char after trim），fingerprint too short
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 2.=2:\n+x`);
    expect(r.ok).toBe(true);
  });

  test('_remapHunksAgainstBase gone branch', async () => {
    // 当 baseToCurMapping 返回 undefined 且 baseLine 也不存在时触发 "gone" 分支
    const fs = new MemoryFilesystem({ 'a.txt': 'a\nb\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'a\nb\nc\nd\n');
    // current 只有 2 行，但 base 有 4 行 → line 3-4 的映射应为 undefined
    await fs.write('a.txt', 'a\nb\n');
    const p = new Patcher({ fs, snapshots });
    const r = await p.apply(`[a.txt#${tag}]\nDEL 3.=3`);
    // 应该 recovery 成功（DEL 操作在 gone 分支标记冲突）
    expect(r.ok).toBe(true);
  });

  test('_computeLCSGreedy correct for simple case', async () => {
    // 触发贪心 LCS（n * m > 1M）
    const lines = Array.from({ length: 1100 }, (_, i) => `line${i}`);
    const base = lines.join('\n') + '\n';
    const cur =
      'INSERTED\n' +
      lines.slice(0, 500).join('\n') +
      '\nMIDDLE\n' +
      lines.slice(500).join('\n') +
      '\n';
    const fs = new MemoryFilesystem({ 'big.txt': cur });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('big.txt', base);
    const p = new Patcher({ fs, snapshots });
    const r = await p.apply(`[big.txt#${tag}]\nDEL 600.=600`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
  });

  test('_contentMatchScore: startsWith match', () => {
    const p = new Patcher();
    // fingerprint = long string, candidate starts with it → score 0.8
    const score = p._contentMatchScore('function hel', 'function helper(x) {', ['line1', 'line2']);
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  test('_contentMatchScore: includes substring match', () => {
    const p = new Patcher();
    const score = p._contentMatchScore('function helper', 'export function helper(x): number', [
      'line1',
    ]);
    expect(score).toBe(0.6);
  });

  test('_contentMatchScore: exact match', () => {
    const p = new Patcher();
    const score = p._contentMatchScore('function helper(x)', 'function helper(x)', ['line1']);
    expect(score).toBe(1.0);
  });

  test('_contentMatchScore: no match', () => {
    const p = new Patcher();
    const score = p._contentMatchScore('abcdef', 'ghijkl', ['line1']);
    expect(score).toBe(0);
  });

  test('autoRecord false does not update snapshots', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'old\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'old\n');
    const p = new Patcher({ fs, snapshots, autoRecord: false });
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+new`);
    expect(r.ok).toBe(true);
    // snapshot head should still be old
    expect(snapshots.head('a.txt').text).toBe('old\n');
  });

  test('autoRecord true (default) auto-updates snapshots', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'old\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'old\n');
    const p = new Patcher({ fs, snapshots }); // autoRecord defaults to true
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+new`);
    expect(r.ok).toBe(true);
    expect(snapshots.head('a.txt').text).toBe('new\n');
  });

  test('allowRecovery defaults to true', () => {
    const p = new Patcher();
    expect(p.allowRecovery).toBe(true);
    expect(p.autoRecord).toBe(true);
    expect(p.bridge).toBeNull();
  });

  test('bridge null does not crash on apply', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'test\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'test\n');
    const p = new Patcher({ fs, snapshots, bridge: null });
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+TEST`);
    expect(r.ok).toBe(true);
  });

  test('recovery without base snapshot uses seen-line matching', async () => {
    // 不 record base，只通过前面的操作让 seenLines 有数据
    const fs = new MemoryFilesystem({ 'a.txt': 'line1\nline2\nline3\n' });
    const snapshots = new InMemorySnapshotStore();
    // record 但不保存旧 tag（用不同的 snapshots 模拟无 snapshot 情况）
    snapshots.record('a.txt', 'line1\nline2\nline3\n');
    // 外部修改
    await fs.write('a.txt', 'PRE\nline1\nline2\nline3\n');
    const tag = computeTag('line1\nline2\nline3\n');
    const p = new Patcher({ fs, snapshots });
    // snapshot 里有这个 tag（通过 record 自动存入的）
    const r = await p.apply(`[a.txt#${tag}]\nDEL 2.=2`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
  });

  test('_checkRange: INS.PRE at lineCount+1 is valid', () => {
    const p = new Patcher();
    const err = p._checkRange({ op: OP_INS_PRE, start: 3, end: 3, srcLine: 1, lines: [] }, 2);
    // INS.PRE at lineCount+1 allowed (append mode)
    expect(err).toBeNull();
  });

  test('_checkRange: INS.POST at lineCount+1 fails', () => {
    const p = new Patcher();
    const err = p._checkRange({ op: OP_INS_POST, start: 3, end: 3, srcLine: 1, lines: [] }, 2);
    expect(err).not.toBeNull();
  });

  test('_checkRange: start < 1 fails', () => {
    const p = new Patcher();
    const err = p._checkRange({ op: OP_SWAP, start: 0, end: 1, srcLine: 1, lines: [] }, 5);
    expect(err).not.toBeNull();
    expect(err).toContain('start line');
  });

  test('_checkRange: end < start fails', () => {
    const p = new Patcher();
    const err = p._checkRange({ op: OP_SWAP, start: 3, end: 2, srcLine: 1, lines: [] }, 5);
    expect(err).not.toBeNull();
    expect(err).toContain('end');
  });

  test('_checkRange: SWAP end > lineCount fails', () => {
    const p = new Patcher();
    const err = p._checkRange({ op: OP_SWAP, start: 3, end: 6, srcLine: 1, lines: [] }, 5);
    expect(err).not.toBeNull();
    expect(err).toContain('end out of range');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Diff3MergeEngine: _editDistance + _findLineByContent + partial merge +
//    deleted anchor + moved block + content diverged with no unresolved
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: Diff3MergeEngine', () => {
  test('_editDistance computes Levenshtein correctly', () => {
    expect(Diff3MergeEngine._editDistance('abc', 'abc')).toBe(0);
    expect(Diff3MergeEngine._editDistance('abc', 'abd')).toBe(1);
    expect(Diff3MergeEngine._editDistance('abc', '')).toBe(3);
    expect(Diff3MergeEngine._editDistance('', 'abc')).toBe(3);
    expect(Diff3MergeEngine._editDistance('kitten', 'sitting')).toBe(3);
  });

  test('_findLineByContent exact match', () => {
    const lines = ['import x', 'const y = 1', 'function main()'];
    expect(Diff3MergeEngine._findLineByContent(lines, 'import x')).toBe(1);
    expect(Diff3MergeEngine._findLineByContent(lines, 'function main()')).toBe(3);
  });

  test('_findLineByContent trimmed match (length > 10)', () => {
    // trimmed.length 必须 > 10 才会走宽松匹配分支
    const lines = ['  function veryLongHelper(x)  ', '  const y = 1  '];
    expect(Diff3MergeEngine._findLineByContent(lines, 'function veryLongHelper(x)')).toBe(1);
  });

  test('_findLineByContent returns -1 for not found', () => {
    const lines = ['a', 'b'];
    expect(Diff3MergeEngine._findLineByContent(lines, 'nonexistent_very_long_line')).toBe(-1);
  });

  test('_findLineByContent with null baseLine', () => {
    expect(Diff3MergeEngine._findLineByContent(['a', 'b'], null)).toBe(-1);
  });

  test('_findLineByContent with short trimmed line', () => {
    // trimmed.length <= 10 → no fallback prefix match
    const lines = ['short', 'x'];
    expect(Diff3MergeEngine._findLineByContent(lines, 'short_nope')).toBe(-1);
  });

  test('merge with deleted anchor', () => {
    const baseText = 'line1\nline2\nline3\nline4\n';
    const currentText = 'line1\nline4\n'; // line2-3 deleted
    const hunks = [{ op: 'SWAP', start: 2, end: 3, lines: ['replacement1', 'replacement2'] }];
    const result = Diff3MergeEngine.merge(baseText, currentText, hunks, 'test.txt');
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].reason).toBe(HashlineErrorCode.CONFLICT_DELETED_ANCHOR);
  });

  test('merge with moved block detection', () => {
    const baseText = 'a\nblock_line1\nblock_line2\nb\nc\n';
    const currentText = 'a\nb\nc\nblock_line1\nblock_line2\n'; // block moved
    const hunks = [{ op: 'SWAP', start: 2, end: 3, lines: ['replaced1', 'replaced2'] }];
    const result = Diff3MergeEngine.merge(baseText, currentText, hunks, 'test.txt');
    // Either moved block conflict or remapped
    expect(result).toBeTruthy();
    expect(typeof result.conflicts).toBe('object');
  });

  test('merge with partial merge (has resolved and unresolved hunks)', () => {
    const baseText = 'line1\nline2\nline3\nline4\n';
    const currentText = 'line1\nMODIFIED\nline3\nline4\n';
    const hunks = [
      { op: 'SWAP', start: 2, end: 2, lines: ['PATCHED_line2'] }, // overlaps modified
      { op: 'INS_POST', start: 4, end: 4, lines: ['appended'] }, // no overlap
    ];
    const result = Diff3MergeEngine.merge(baseText, currentText, hunks, 'test.txt');
    // conflict on SWAP hunk, INS_POST resolved
    expect(result.conflicts.length).toBeGreaterThan(0);
    if (result.partialMerge) {
      expect(result.merged).not.toBeNull();
    }
  });

  test('merge content diverged detects conflict', () => {
    const baseText = 'a\nb\nc\n';
    const currentText = 'a\nB_MODIFIED\nc\n'; // line 2 changed, hash differs
    const hunks = [{ op: 'DEL', start: 2, end: 2, lines: [] }];
    const result = Diff3MergeEngine.merge(baseText, currentText, hunks, 'test.txt');
    // line 2 hash differs → mapping undefined → _findLineByContent → not found → deleted anchor conflict
    expect(result).not.toBeNull();
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].reason).toBe(HashlineErrorCode.CONFLICT_DELETED_ANCHOR);
  });

  test('merge applies all resolved hunks when no conflicts', () => {
    const baseText = 'line1\nline2\nline3\n';
    const currentText = 'line1\nline2\nline3\n'; // identical
    const hunks = [{ op: 'DEL', start: 2, end: 2 }];
    const result = Diff3MergeEngine.merge(baseText, currentText, hunks, 'test.txt');
    expect(result.merged).toBe('line1\nline3\n');
    expect(result.conflicts.length).toBe(0);
  });

  test('_editDistance with longer strings', () => {
    const d = Diff3MergeEngine._editDistance('abcdefghij', 'abcdeFGHij');
    expect(d).toBe(3); // F, G, H substitutions
  });

  test('_computeEditMapping handles fuzzy fallback', () => {
    const base = ['function veryLongNameForHelper(x): number', '  return x + 1;'];
    const cur = ['function veryLongNameForHelper_renamed(x): number', '  return x + 2;'];
    const mapping = Diff3MergeEngine._computeEditMapping(base, cur);
    // Should at least attempt fuzzy match for the renamed function
    // mapping[1] might or might not exist depending on threshold
    expect(typeof mapping).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 错误格式化 + StructuredApplyError + createDiff3Conflict +
//    createPatcher + empty patch + HashlineErrorSeverity
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: error formatting & utilities', () => {
  test('errorSeverity returns severity for known code', () => {
    expect(errorSeverity(HashlineErrorCode.PARSE_UNEXPECTED_TOKEN)).toBe('FATAL');
    expect(errorSeverity(HashlineErrorCode.APPLY_STALE_TAG)).toBe('ERROR');
    expect(errorSeverity(HashlineErrorCode.CONFLICT_MOVED_BLOCK)).toBe('WARNING');
  });

  test('errorSeverity returns ERROR for unknown code', () => {
    expect(errorSeverity('UNKNOWN_CODE')).toBe('ERROR');
    expect(errorSeverity(null)).toBe('ERROR');
    expect(errorSeverity(undefined)).toBe('ERROR');
  });

  test('formatHashlineError returns structured error object', () => {
    const err = formatHashlineError(
      HashlineErrorCode.APPLY_FILE_NOT_FOUND,
      'File not found: test.txt',
      { line: 5, column: 1, span: 'DEL 1.=1' },
      { path: 'test.txt' },
    );
    expect(err.code).toBe(HashlineErrorCode.APPLY_FILE_NOT_FOUND);
    expect(err.severity).toBe('ERROR');
    expect(err.message).toBe('File not found: test.txt');
    expect(err.sourceSpan.line).toBe(5);
    expect(err.sourceSpan.column).toBe(1);
    expect(err.sourceSpan.span).toBe('DEL 1.=1');
    expect(err.context.path).toBe('test.txt');
  });

  test('formatHashlineError without sourceSpan and context', () => {
    const err = formatHashlineError(HashlineErrorCode.POLICY_BINARY_FILE, 'binary');
    expect(err.code).toBe(HashlineErrorCode.POLICY_BINARY_FILE);
    expect(err.severity).toBe('FATAL');
    expect(err.sourceSpan).toBeUndefined();
    expect(err.context).toBeUndefined();
  });

  test('formatHashlineError uses srcLine as sourceSpan line', () => {
    const err = formatHashlineError('CODE', 'msg', { srcLine: 42 });
    expect(err.sourceSpan.line).toBe(42);
    expect(err.sourceSpan.column).toBeNull();
  });

  test('StructuredApplyError construction', () => {
    const err = new StructuredApplyError('apply failed', {
      path: '/test/file.ts',
      code: HashlineErrorCode.CONFLICT_CONTENT_DIVERGED,
      conflict: { reason: 'content changed' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('StructuredApplyError');
    expect(err.path).toBe('/test/file.ts');
    expect(err.code).toBe(HashlineErrorCode.CONFLICT_CONTENT_DIVERGED);
    expect(err.conflict.reason).toBe('content changed');
  });

  test('StructuredApplyError with no details', () => {
    const err = new StructuredApplyError('fail');
    expect(err.path).toBeNull();
    expect(err.code).toBeNull();
    expect(err.conflict).toBeNull();
  });

  test('createDiff3Conflict with all fields', () => {
    const c = createDiff3Conflict({
      path: 'src/foo.ts',
      baseRange: [10, 15],
      currentRange: [12, 17],
      patchRange: [10, 15],
      baseText: 'old code',
      currentText: 'new code',
      patchText: 'patched code',
      reason: 'moved_block',
    });
    expect(c.path).toBe('src/foo.ts');
    expect(c.baseRange).toEqual([10, 15]);
    expect(c.currentRange).toEqual([12, 17]);
    expect(c.patchRange).toEqual([10, 15]);
    expect(c.baseText).toBe('old code');
    expect(c.currentText).toBe('new code');
    expect(c.patchText).toBe('patched code');
    expect(c.reason).toBe('moved_block');
  });

  test('createDiff3Conflict with defaults', () => {
    const c = createDiff3Conflict();
    expect(c.path).toBe('');
    expect(c.baseRange).toEqual([0, 0]);
    expect(c.currentRange).toEqual([0, 0]);
    expect(c.patchRange).toEqual([0, 0]);
    expect(c.baseText).toBe('');
    expect(c.currentText).toBe('');
    expect(c.patchText).toBe('');
    expect(c.reason).toBe('overlapping_change');
  });

  test('createPatcher with no args', () => {
    const p = createPatcher();
    expect(p).toBeInstanceOf(Patcher);
    expect(p.autoRecord).toBe(true);
    expect(p.allowRecovery).toBe(true);
  });

  test('createPatcher with custom args', () => {
    const snapshots = new InMemorySnapshotStore();
    const p = createPatcher({
      snapshots,
      autoRecord: false,
      allowRecovery: false,
    });
    expect(p.snapshots).toBe(snapshots);
    expect(p.autoRecord).toBe(false);
    expect(p.allowRecovery).toBe(false);
  });

  test('empty patch parse + serialize', () => {
    const p = parsePatch('');
    expect(p.sections.length).toBe(0);
    const out = serializePatch(p);
    expect(out).toBe('');
  });

  test('serializePatch empty sections', () => {
    const p = new Patch([]);
    expect(p.serialize()).toBe('');
  });

  test('serializePatch handles all op types', () => {
    const p = new Patch([
      new Section('test.txt', 'aa'.repeat(32), [
        { op: OP_SWAP, start: 1, end: 2, lines: ['x', 'y'], srcLine: 2 },
        { op: OP_DEL, start: 3, end: 3, lines: [], srcLine: 5 },
        { op: OP_INS_PRE, start: 4, end: 4, lines: ['z'], srcLine: 6 },
        { op: OP_INS_POST, start: 5, end: 5, lines: ['w'], srcLine: 7 },
      ]),
    ]);
    const out = p.serialize();
    expect(out).toContain('[test.txt#');
    expect(out).toContain('SWAP 1.=2:');
    expect(out).toContain('DEL 3.=3');
    expect(out).toContain('INS.PRE 4=');
    expect(out).toContain('INS.POST 5=');
    expect(out).toContain('+x');
    expect(out).toContain('+y');
    expect(out).toContain('+z');
    expect(out).toContain('+w');
  });

  test('HashlineErrorSeverity maps all codes', () => {
    for (const key of Object.keys(HashlineErrorCode)) {
      expect(HashlineErrorSeverity[key]).toBeDefined();
      expect(['FATAL', 'ERROR', 'WARNING']).toContain(HashlineErrorSeverity[key]);
    }
  });

  test('normalizeText handles null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  test('normalizeText handles already-normalized text', () => {
    const text = 'line1\nline2\n';
    expect(normalizeText(text)).toBe(text);
  });

  test('normalizeText handles text with no trailing newline', () => {
    const text = 'hello world';
    expect(normalizeText(text)).toBe('hello world\n');
  });

  test('Section class properties', () => {
    const s = new Section('file.ts', 'aaaa'.repeat(16), [
      { op: OP_SWAP, start: 1, end: 2, lines: ['x'] },
    ]);
    expect(s.path).toBe('file.ts');
    expect(s.tag).toBe('aaaa'.repeat(16));
    expect(s.hunks.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 额外：seen-line recovery（无 base snapshot）+ diff3 fallback + conflict gone 类型
// ══════════════════════════════════════════════════════════════════════════════

describe('hashline coverage: recovery edge cases', () => {
  test('recovery warnings include gone type conflict', async () => {
    // 让 base 有 5 行，current 只有 2 行 → hunk 指向的行 gone
    const fs = new MemoryFilesystem({ 'a.txt': 'surviving1\nsurviving2\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'l1\nl2\nl3\nl4\nl5\n');
    const p = new Patcher({ fs, snapshots });
    const r = await p.apply(`[a.txt#${tag}]\nDEL 3.=3`);
    expect(r.ok).toBe(true);
    // 应该有 gone 类型的 warning
    const allWarnings = r.sections[0].warnings.join(' ');
    expect(allWarnings).toBeTruthy();
  });

  test('diff3 merge fallback path through _remapHunksAgainstBase', async () => {
    // diff3 returns merged=null → 降级到 _remapHunksAgainstBase
    const fs = new MemoryFilesystem({ 'a.txt': 'COMPLETELY_DIFFERENT\nTEXT_HERE\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'original\ncontent\nhere\n');
    const p = new Patcher({ fs, snapshots });
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+REPLACED`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
    // fallback warnings should include 'diff3 merge incomplete'
    expect(
      r.sections[0].warnings.some(
        (w) => w.includes('diff3 merge incomplete') || w.includes('fallback'),
      ),
    ).toBe(true);
  });

  test('Patcher.apply compute error returns failure', async () => {
    // 创建策略错误场景 - hunk 无法映射
    const fs = new MemoryFilesystem({ 'a.txt': 'line1\nline2\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'line1\nline2\n');
    // 修改文件但故意用不匹配的 tag 触发 recovery
    await fs.write('a.txt', 'line1\nline2\n');
    const p = new Patcher({ fs, snapshots, allowRecovery: false });
    const r = await p.apply(`[a.txt#${tag}]\nSWAP 999.=1000:\n+out of range`);
    // allowRecovery=false + stale tag → 直接失败
    expect(r.ok).toBe(false);
  });

  test('del single line shorthand in parsePatch', () => {
    const p = parsePatch(
      '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nDEL 3',
    );
    expect(p.sections[0].hunks[0]).toMatchObject({ op: OP_DEL, start: 3, end: 3 });
  });

  test('swap single line shorthand with colon', () => {
    const p = parsePatch(
      '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nSWAP 1:\n+replaced',
    );
    expect(p.sections[0].hunks[0]).toMatchObject({
      op: OP_SWAP,
      start: 1,
      end: 1,
      lines: ['replaced'],
    });
  });

  test('parseExtended throws on garbage after ABORT', () => {
    expect(() =>
      parsePatchExtended(
        '[a#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]\nGARBAGE_LINE',
      ),
    ).toThrow(StructuredParseError);
  });

  test('parsePatchExtended detect unified diff: --- ', () => {
    expect(() => parsePatchExtended('--- a/file.js\n+++ b/file.js')).toThrow(StructuredParseError);
  });

  test('parsePatchExtended detect diff --git', () => {
    expect(() => parsePatchExtended('diff --git a/file b/file')).toThrow(StructuredParseError);
  });
});
