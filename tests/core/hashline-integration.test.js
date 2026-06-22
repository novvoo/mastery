/**
 * Hashline 集成测试：
 *  - Hashline 桥接既有 ContentAddressableStore / FileAnalyzer
 *  - DiskFilesystem 落盘 + snapshot store + bridge 联动
 *  - 与 AgentEngine 注入的 contentStore 协同（模拟 filesystem-tools 的写入路径）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  DiskFilesystem,
  InMemorySnapshotStore,
  Patcher,
  Patch,
  computeTag,
  hashContent,
  HashlineBridge,
} from '../../src/core/harness/hashline.js';
import { ContentAddressableStore, FileAnalyzer } from '../../src/core/harness/content-addressing.js';

let workDir;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hashline-int-'));
});

afterEach(async () => {
  if (workDir) {
    try { await rm(workDir, { recursive: true, force: true }); } catch {}
  }
});

describe('hashline integration: DiskFilesystem + bridge + ContentAddressableStore', () => {
  test('apply patch to real file, bridge records into CAS', async () => {
    const file = join(workDir, 'demo.js');
    const initial = 'function foo() {\n  return 1;\n}\n';
    await writeFile(file, initial, 'utf-8');

    const store = new ContentAddressableStore();
    const analyzer = new FileAnalyzer(store);
    const bridge = new HashlineBridge(store, analyzer);
    const snapshots = new InMemorySnapshotStore();
    // 让 bridge/CAS 先“看见”当前文件（模拟 filesystem-tools write_file 的副作用）
    store.storeBlob(initial);
    store.setRef(`file:${file}`, store.storeBlob(initial));
    analyzer.analyzeFile(file, initial);

    // DiskFilesystem 用绝对路径，指定 tmpdir 为 rootDir
    const fs = new DiskFilesystem(workDir);
    // patcher 使用相对于 cwd 的 path：我们直接传绝对路径
    const tag = snapshots.record(file, initial);
    const patcher = new Patcher({ fs, snapshots, bridge });

    // SWAP 内容行以 + 开头；下面这条 patch 替换第 2 行 `  return 1;`
    const validPatch = `[${file}#${tag}]\nSWAP 2.=2:\n+  return 2;`;
    const r = await patcher.apply(validPatch);
    expect(r.ok).toBe(true);

    const onDisk = await readFile(file, 'utf-8');
    expect(onDisk).toBe('function foo() {\n  return 2;\n}\n');

    // CAS 被桥接更新
    const ref = store.getRef(`file:${file}`);
    expect(ref).not.toBeNull();
    expect(store.getBlob(ref)).toBe(onDisk);

    // snapshot store 自动更新
    expect(snapshots.head(file).tag).toBe(computeTag(onDisk));
  });

  test('recovery across external edit on real disk', async () => {
    const file = join(workDir, 'r.js');
    const initial = 'a\nb\nc\n';
    await writeFile(file, initial, 'utf-8');

    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(file, initial);

    const fs = new DiskFilesystem(workDir);
    const patcher = new Patcher({ fs, snapshots });

    // 外部在文件前面插入一行（行号偏移 +1）
    await writeFile(file, 'PRE\na\nb\nc\n', 'utf-8');

    // patch 想删原 line 2（"b"），recovery 应重定位到新 line 3
    const r = await patcher.apply(`[${file}#${tag}]\nDEL 2.=2`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
    const onDisk = await readFile(file, 'utf-8');
    expect(onDisk).toBe('PRE\na\nc\n');
  });

  test('patcher + bridge mirrors filesystem-tools edit_file semantics', async () => {
    // 这个用例验证：当 agent 既走 filesystem-tools.edit_file 路径、又走
    // Hashline patcher 路径时，两者的 hash / ref 写入是兼容的。
    const file = join(workDir, 'mirror.js');
    const initial = 'const x = 1;\nconst y = 2;\n';
    await writeFile(file, initial, 'utf-8');

    const store = new ContentAddressableStore();
    const analyzer = new FileAnalyzer(store);
    const bridge = new HashlineBridge(store, analyzer);
    const snapshots = new InMemorySnapshotStore();

    // 1) 模拟 filesystem-tools write_file：把 initial 写入 CAS（用绝对路径作为 ref 名）
    const blobHash1 = store.storeBlob(initial);
    store.setRef(`file:${file}`, blobHash1);
    analyzer.analyzeFile(file, initial);
    snapshots.record(file, initial);

    // 2) 用 Hashline 做一次编辑
    const fs = new DiskFilesystem(workDir);
    const tag1 = snapshots.head(file).tag;
    const patcher = new Patcher({ fs, snapshots, bridge });
    const r1 = await patcher.apply(`[${file}#${tag1}]\nSWAP 1.=1:\n+const x = 10;`);
    expect(r1.ok).toBe(true);

    // 3) CAS 里 file:<path> ref 应指向新内容
    const ref1 = store.getRef(`file:${file}`);
    expect(store.getBlob(ref1)).toBe('const x = 10;\nconst y = 2;\n');

    // 4) 再用 Hashline 编辑一次（snapshot tag 链）
    const tag2 = snapshots.head(file).tag;
    const r2 = await patcher.apply(`[${file}#${tag2}]\nDEL 2.=2`);
    expect(r2.ok).toBe(true);
    const ref2 = store.getRef(`file:${file}`);
    expect(store.getBlob(ref2)).toBe('const x = 10;\n');

    // 5) snapshot history 应至少有 3 个版本
    const hist = snapshots.history(file);
    expect(hist.length).toBeGreaterThanOrEqual(3);
  });

  test('Patch.parse + serialize interop with real patch text', () => {
    const path = join(workDir, 'p.js');
    const tag = computeTag('a\nb\n');
    const text = `[${path}#${tag}]\nSWAP 1.=2:\n+x\n+y\nDEL 3.=3`;
    const p = Patch.parse(text);
    expect(p.sections[0].hunks.length).toBe(2);
    const out = p.serialize();
    const p2 = Patch.parse(out);
    expect(p2.sections[0].hunks[0].lines).toEqual(['x', 'y']);
  });

  test('preflight does not touch disk', async () => {
    const file = join(workDir, 'p.js');
    const initial = 'a\nb\n';
    await writeFile(file, initial, 'utf-8');
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(file, initial);
    const patcher = new Patcher({ fs: new DiskFilesystem(workDir), snapshots });
    const pre = await patcher.preflight(`[${file}#${tag}]\nDEL 1.=1`);
    expect(pre.preflight[0].ok).toBe(true);
    // 文件没变
    expect(await readFile(file, 'utf-8')).toBe(initial);
  });

  test('bridge tag refs use hashline: prefix', async () => {
    const file = join(workDir, 't.js');
    const initial = 'one\n';
    await writeFile(file, initial, 'utf-8');
    const store = new ContentAddressableStore();
    const bridge = new HashlineBridge(store);
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record(file, initial);
    const patcher = new Patcher({ fs: new DiskFilesystem(workDir), snapshots, bridge });
    const r = await patcher.apply(`[${file}#${tag}]\nSWAP 1.=1:\n+two`);
    expect(r.ok).toBe(true);
    const newTag = r.sections[0].newTag;
    expect(store.getRef(`hashline:${file}:${newTag}`)).not.toBeNull();
    expect(store.getRef(`hashline:${file}:${tag}`)).not.toBeNull();
  });

  test('atomic batch: failure does not write any file', async () => {
    const f1 = join(workDir, 'a.js');
    const f2 = join(workDir, 'b.js');
    await writeFile(f1, 'a1\na2\n', 'utf-8');
    // 故意不创建 f2
    const snapshots = new InMemorySnapshotStore();
    const t1 = snapshots.record(f1, 'a1\na2\n');
    const t2 = snapshots.record(f2, 'b1\n'); // snapshot 存在但文件不存在
    const patcher = new Patcher({ fs: new DiskFilesystem(workDir), snapshots });
    const r = await patcher.apply(
      `[${f1}#${t1}]\nDEL 1.=1\n[${f2}#${t2}]\nDEL 1.=1`,
    );
    expect(r.ok).toBe(false);
    // f1 不应被修改
    expect(await readFile(f1, 'utf-8')).toBe('a1\na2\n');
  });

  test('hashline hashContent matches CAS hashContent', () => {
    // 确保两套哈希函数一致
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(hashContent('hello')).toBe(expected);
  });
});
