import { describe, test, expect } from 'bun:test';
import {
  hashContent,
  normalizeText,
  computeTag,
  MemoryFilesystem,
  DiskFilesystem,
  InMemorySnapshotStore,
  Patch,
  PatchParseError,
  PatchApplyError,
  Patcher,
  parsePatch,
  serializePatch,
  applyHunksToText,
  HashlineBridge,
  createPatcher,
  OP_SWAP,
  OP_DEL,
  OP_INS_PRE,
  OP_INS_POST,
} from '../../src/core/harness/hashline.js';
import { ContentAddressableStore, FileAnalyzer } from '../../src/core/harness/content-addressing.js';

// ── 哈希 / 规范化 ────────────────────────────────────────────────────────────

describe('hashline: normalize & tag', () => {
  test('normalizeText unifies newlines and trims trailing whitespace', () => {
    const a = 'foo\r\nbar\rbaz\n\n\n';
    const b = 'foo\nbar\nbaz';
    expect(normalizeText(a)).toBe('foo\nbar\nbaz\n');
    expect(normalizeText(b)).toBe('foo\nbar\nbaz\n');
    expect(normalizeText(a)).toBe(normalizeText(b));
  });

  test('normalizeText strips trailing whitespace per line', () => {
    expect(normalizeText('foo   \nbar\t')).toBe('foo\nbar\n');
  });

  test('computeTag is stable for equivalent content', () => {
    expect(computeTag('a\nb\n')).toBe(computeTag('a\nb'));
    expect(computeTag('a\r\nb')).toBe(computeTag('a\nb\n'));
  });

  test('hashContent returns 64-char hex', () => {
    expect(hashContent('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── Filesystem 抽象 ──────────────────────────────────────────────────────────

describe('hashline: MemoryFilesystem', () => {
  test('read/write/exists/stat', async () => {
    const fs = new MemoryFilesystem({ a: 'hello' });
    expect(await fs.exists('a')).toBe(true);
    expect(await fs.exists('b')).toBe(false);
    expect(await fs.read('a')).toBe('hello');
    await fs.write('b', 'world');
    expect(await fs.read('b')).toBe('world');
    const st = await fs.stat('a');
    expect(st.size).toBeGreaterThan(0);
    expect(typeof st.mtimeMs).toBe('number');
  });

  test('read missing throws ENOENT', async () => {
    const fs = new MemoryFilesystem();
    let err;
    try {
      await fs.read('nope');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('ENOENT');
  });
});

describe('hashline: DiskFilesystem', () => {
  test('read/write/exists on real disk', async () => {
    const fs = new DiskFilesystem();
    const path = `./test-hashline-tmp-${Date.now()}.txt`;
    try {
      await fs.write(path, 'line1\nline2\n');
      expect(await fs.exists(path)).toBe(true);
      expect(await fs.read(path)).toBe('line1\nline2\n');
      const st = await fs.stat(path);
      expect(st.size).toBe(12);
    } finally {
      // cleanup
      const { unlink } = await import('fs/promises');
      try { await unlink(path); } catch {}
    }
  });
});

// ── SnapshotStore ────────────────────────────────────────────────────────────

describe('hashline: InMemorySnapshotStore', () => {
  test('record returns stable tag for equivalent content', () => {
    const s = new InMemorySnapshotStore();
    const t1 = s.record('a', 'foo\nbar\n');
    const t2 = s.record('a', 'foo\nbar'); // 规范化后等价
    expect(t1).toBe(t2);
    expect(s.head('a').tag).toBe(t1);
    // record stores raw text; first record's raw text was 'foo\nbar\n'
    expect(s.byHash('a', t1).text).toBe('foo\nbar\n');
  });

  test('head / byHash / history', () => {
    const s = new InMemorySnapshotStore();
    const t1 = s.record('a', 'v1');
    const t2 = s.record('a', 'v2');
    const t3 = s.record('a', 'v3');
    expect(s.head('a').tag).toBe(t3);
    expect(s.history('a').length).toBe(3);
    expect(s.byHash('a', t2).text).toBe('v2');
    expect(s.has('a', t1)).toBe(true);
    expect(s.has('a', 'nope')).toBe(false);
  });

  test('recordSeenLines tracks line fingerprints', () => {
    const s = new InMemorySnapshotStore();
    s.record('a', 'foo\nbar\nbaz');
    const seen = s.seenLines('a');
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has(hashContent('foo'))).toBe(true);
    expect(seen.has(hashContent('bar'))).toBe(true);
  });

  test('invalidate clears single path', () => {
    const s = new InMemorySnapshotStore();
    s.record('a', 'x');
    s.record('b', 'y');
    s.invalidate('a');
    expect(s.head('a')).toBeNull();
    expect(s.head('b')).not.toBeNull();
  });

  test('clear wipes everything', () => {
    const s = new InMemorySnapshotStore();
    s.record('a', 'x');
    s.clear();
    expect(s.stats().paths).toBe(0);
  });

  test('LRU per-path version cap evicts oldest', () => {
    const s = new InMemorySnapshotStore({ maxVersionsPerPath: 3 });
    const t1 = s.record('a', '1');
    s.record('a', '2');
    s.record('a', '3');
    s.record('a', '4');
    // t1 should have been evicted
    expect(s.has('a', t1)).toBe(false);
    expect(s.history('a').length).toBe(3);
  });

  test('LRU path cap evicts oldest path', () => {
    const s = new InMemorySnapshotStore({ maxPaths: 2 });
    s.record('a', '1');
    s.record('b', '2');
    s.record('c', '3'); // should evict 'a'
    expect(s.head('a')).toBeNull();
    expect(s.head('b')).not.toBeNull();
    expect(s.head('c')).not.toBeNull();
  });

  test('re-recording existing tag moves it to head', () => {
    const s = new InMemorySnapshotStore();
    const t1 = s.record('a', '1');
    s.record('a', '2');
    s.record('a', '3');
    // re-touch t1
    s.record('a', '1');
    expect(s.head('a').tag).toBe(t1);
    expect(s.history('a').length).toBe(3);
  });

  test('stats reports counts', () => {
    const s = new InMemorySnapshotStore();
    s.record('a', '1');
    s.record('a', '2');
    s.record('b', '3');
    const st = s.stats();
    expect(st.paths).toBe(2);
    expect(st.versions).toBe(3);
    expect(st.maxPaths).toBe(30);
  });
});

// ── Patch DSL / Parser ───────────────────────────────────────────────────────

describe('hashline: parsePatch', () => {
  test('parses SWAP single line', () => {
    const patch = parsePatch('[a.txt#tag]\nSWAP 1.=1:\n+new');
    expect(patch.sections.length).toBe(1);
    const s = patch.sections[0];
    expect(s.path).toBe('a.txt');
    expect(s.tag).toBe('tag');
    expect(s.hunks.length).toBe(1);
    expect(s.hunks[0].op).toBe(OP_SWAP);
    expect(s.hunks[0].start).toBe(1);
    expect(s.hunks[0].end).toBe(1);
    expect(s.hunks[0].lines).toEqual(['new']);
  });

  test('parses SWAP range with multiple content lines', () => {
    const patch = parsePatch('[a#t]\nSWAP 2.=4:\n+x\n+y\n+z');
    expect(patch.sections[0].hunks[0]).toMatchObject({
      op: OP_SWAP, start: 2, end: 4, lines: ['x', 'y', 'z'],
    });
  });

  test('parses DEL single and range', () => {
    const patch = parsePatch('[a#t]\nDEL 1.=1\nDEL 3.=5');
    expect(patch.sections[0].hunks).toEqual([
      { op: OP_DEL, start: 1, end: 1, lines: [], srcLine: 2 },
      { op: OP_DEL, start: 3, end: 5, lines: [], srcLine: 3 },
    ]);
  });

  test('parses INS.PRE and INS.POST', () => {
    const patch = parsePatch('[a#t]\nINS.PRE 3=\n+before\nINS.POST 5=\n+after');
    const h = patch.sections[0].hunks;
    expect(h[0]).toMatchObject({ op: OP_INS_PRE, start: 3, lines: ['before'] });
    expect(h[1]).toMatchObject({ op: OP_INS_POST, start: 5, lines: ['after'] });
  });

  test('content line: + is pure marker, content preserved verbatim', () => {
    // `+` 是标记符，其后内容原样保留（保留缩进）
    const a = parsePatch('[a#t]\nSWAP 1.=1:\n+foo');
    const b = parsePatch('[a#t]\nSWAP 1.=1:\n+ foo');
    const c = parsePatch('[a#t]\nSWAP 1.=1:\n+  return 2;');
    expect(a.sections[0].hunks[0].lines).toEqual(['foo']);
    expect(b.sections[0].hunks[0].lines).toEqual([' foo']);
    expect(c.sections[0].hunks[0].lines).toEqual(['  return 2;']);
  });

  test('ignores blank lines and comments', () => {
    const patch = parsePatch('# header\n[a#t]\n\n# a comment\nSWAP 1.=1:\n+x\n');
    expect(patch.sections[0].hunks[0].lines).toEqual(['x']);
  });

  test('multiple sections', () => {
    const patch = parsePatch('[a#t1]\nDEL 1.=1\n[b#t2]\nSWAP 1.=1:\n+y');
    expect(patch.sections.length).toBe(2);
    expect(patch.sections[0].path).toBe('a');
    expect(patch.sections[1].path).toBe('b');
  });

  test('throws on content line before section', () => {
    expect(() => parsePatch('+foo')).toThrow(PatchParseError);
  });

  test('throws on content line with no op header', () => {
    expect(() => parsePatch('[a#t]\n+foo')).toThrow(PatchParseError);
  });

  test('throws on unrecognized line', () => {
    expect(() => parsePatch('[a#t]\nGARBAGE 1')).toThrow(PatchParseError);
  });

  test('Patch.parse static equals parsePatch', () => {
    const a = Patch.parse('[a#t]\nDEL 1.=1');
    const b = parsePatch('[a#t]\nDEL 1.=1');
    expect(a.sections.length).toBe(b.sections.length);
  });

  test('serialize roundtrip', () => {
    const src = '[a#t]\nSWAP 2.=3:\n+x\n+y\nDEL 5.=5';
    const patch = parsePatch(src);
    const out = patch.serialize();
    const reparsed = parsePatch(out);
    expect(reparsed.sections[0].hunks.length).toBe(2);
    expect(reparsed.sections[0].hunks[0].lines).toEqual(['x', 'y']);
  });
});

// ── applyHunksToText ─────────────────────────────────────────────────────────

describe('hashline: applyHunksToText', () => {
  const text = 'l1\nl2\nl3\nl4\nl5';

  test('SWAP replaces range', () => {
    const out = applyHunksToText(text, [
      { op: OP_SWAP, start: 2, end: 3, lines: ['x', 'y'], srcLine: 1 },
    ]);
    expect(out).toBe('l1\nx\ny\nl4\nl5');
  });

  test('DEL removes range', () => {
    const out = applyHunksToText(text, [
      { op: OP_DEL, start: 2, end: 3, lines: [], srcLine: 1 },
    ]);
    expect(out).toBe('l1\nl4\nl5');
  });

  test('INS.PRE inserts before line', () => {
    const out = applyHunksToText(text, [
      { op: OP_INS_PRE, start: 3, end: 3, lines: ['before'], srcLine: 1 },
    ]);
    expect(out).toBe('l1\nl2\nbefore\nl3\nl4\nl5');
  });

  test('INS.POST inserts after line', () => {
    const out = applyHunksToText(text, [
      { op: OP_INS_POST, start: 3, end: 3, lines: ['after'], srcLine: 1 },
    ]);
    expect(out).toBe('l1\nl2\nl3\nafter\nl4\nl5');
  });

  test('multiple non-overlapping hunks applied together', () => {
    const out = applyHunksToText(text, [
      { op: OP_DEL, start: 5, end: 5, lines: [], srcLine: 1 },
      { op: OP_SWAP, start: 1, end: 1, lines: ['NEW1'], srcLine: 2 },
      { op: OP_INS_POST, start: 3, end: 3, lines: ['AFTER3'], srcLine: 3 },
    ]);
    expect(out).toBe('NEW1\nl2\nl3\nAFTER3\nl4');
  });

  test('throws on overlapping hunks', () => {
    expect(() =>
      applyHunksToText(text, [
        { op: OP_SWAP, start: 2, end: 4, lines: ['x'], srcLine: 1 },
        { op: OP_SWAP, start: 3, end: 5, lines: ['y'], srcLine: 2 },
      ]),
    ).toThrow(PatchApplyError);
  });

  test('INS.PRE at line 1 prepends', () => {
    const out = applyHunksToText('a\nb', [
      { op: OP_INS_PRE, start: 1, end: 1, lines: ['top'], srcLine: 1 },
    ]);
    expect(out).toBe('top\na\nb');
  });

  test('INS.POST at last line appends', () => {
    const out = applyHunksToText('a\nb', [
      { op: OP_INS_POST, start: 2, end: 2, lines: ['bot'], srcLine: 1 },
    ]);
    expect(out).toBe('a\nb\nbot');
  });
});

// ── Patcher：干净 apply ─────────────────────────────────────────────────────

describe('hashline: Patcher apply (clean)', () => {
  test('apply SWAP with matching tag', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'one\ntwo\nthree\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'one\ntwo\nthree\n');
    const patcher = new Patcher({ fs, snapshots });

    const patchText = `[a.txt#${tag}]\nSWAP 2.=2:\n+TWO`;
    const r = await patcher.apply(patchText);
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('one\nTWO\nthree\n');
    // snapshot 自动更新
    const head = snapshots.head('a.txt');
    expect(head.text).toBe('one\nTWO\nthree\n');
  });

  test('apply multiple sections atomically', async () => {
    const fs = new MemoryFilesystem({
      'a.txt': 'a1\na2\n',
      'b.txt': 'b1\nb2\n',
    });
    const snapshots = new InMemorySnapshotStore();
    const ta = snapshots.record('a.txt', 'a1\na2\n');
    const tb = snapshots.record('b.txt', 'b1\nb2\n');
    const patcher = new Patcher({ fs, snapshots });

    const r = await patcher.apply(
      `[a.txt#${ta}]\nDEL 1.=1\n[b.txt#${tb}]\nSWAP 1.=1:\n+B1`,
    );
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('a2\n');
    expect(await fs.read('b.txt')).toBe('B1\nb2\n');
  });

  test('preflight reports ok without writing', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'x\ny\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'x\ny\n');
    const patcher = new Patcher({ fs, snapshots });

    const pre = await patcher.preflight(`[a.txt#${tag}]\nDEL 1.=1`);
    expect(pre.preflight[0].ok).toBe(true);
    // 没落盘
    expect(await fs.read('a.txt')).toBe('x\ny\n');
  });

  test('preflight rejects out-of-range hunk', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'x\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'x\n');
    const patcher = new Patcher({ fs, snapshots });
    const pre = await patcher.preflight(`[a.txt#${tag}]\nDEL 5.=5`);
    expect(pre.preflight[0].ok).toBe(false);
    expect(pre.preflight[0].error).toContain('out of range');
  });

  test('apply fails on file not found', async () => {
    const fs = new MemoryFilesystem();
    const patcher = new Patcher({ fs, snapshots: new InMemorySnapshotStore() });
    const r = await patcher.apply('[nope#t]\nDEL 1.=1');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('file not found');
  });

  test('stale tag without recovery returns recoverable preflight', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'changed\n' });
    const snapshots = new InMemorySnapshotStore();
    // 故意只记录旧版本，不记录当前
    const oldTag = snapshots.record('a.txt', 'original\n');
    // 现在文件已经被外部改过
    await fs.write('a.txt', 'changed\n');
    const patcher = new Patcher({ fs, snapshots, allowRecovery: false });
    const pre = await patcher.preflight(`[a.txt#${oldTag}]\nDEL 1.=1`);
    expect(pre.preflight[0].ok).toBe(false);
    expect(pre.preflight[0].matchStale).toBe(true);
    expect(pre.preflight[0].recoverable).toBe(true);
  });

  test('apply with stale tag and recovery disabled fails the batch', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'changed\n' });
    const snapshots = new InMemorySnapshotStore();
    const oldTag = snapshots.record('a.txt', 'original\n');
    await fs.write('a.txt', 'changed\n');
    const patcher = new Patcher({ fs, snapshots, allowRecovery: false });
    const r = await patcher.apply(`[a.txt#${oldTag}]\nDEL 1.=1`);
    expect(r.ok).toBe(false);
  });
});

// ── Patcher：recovery / 3-way merge ──────────────────────────────────────────

describe('hashline: Patcher recovery', () => {
  test('recovers via snapshot store when tag stale but base known', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'one\ntwo\nthree\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'one\ntwo\nthree\n');
    // 模拟外部在文件“前面”加了一行，行号偏移
    await fs.write('a.txt', 'ZERO\none\ntwo\nthree\n');
    const patcher = new Patcher({ fs, snapshots, allowRecovery: true });

    // patch 想删原 line 2（"two"），recovery 应该把它重定位到新 line 3
    const r = await patcher.apply(`[a.txt#${tag}]\nDEL 2.=2`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
    expect(await fs.read('a.txt')).toBe('ZERO\none\nthree\n');
  });

  test('recovers INS.PRE via base snapshot', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'a\nb\nc\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'a\nb\nc\n');
    await fs.write('a.txt', 'PRE\na\nb\nc\n');
    const patcher = new Patcher({ fs, snapshots });
    // 想在原 line 2 (b) 前插入 INS
    const r = await patcher.apply(`[a.txt#${tag}]\nINS.PRE 2=\n+INS`);
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('PRE\na\nINS\nb\nc\n');
  });

  test('recovery picks closest candidate when duplicates exist', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'dup\nA\ndup\nB\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'dup\nA\ndup\nB\n');
    // 在前面加一行，原 line 3 (dup) 应该重定位到 line 4，而不是 line 1
    await fs.write('a.txt', 'TOP\ndup\nA\ndup\nB\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[a.txt#${tag}]\nDEL 3.=3`);
    expect(r.ok).toBe(true);
    // 删除的应该是第二个 dup（原 line 3）
    expect(await fs.read('a.txt')).toBe('TOP\ndup\nA\nB\n');
  });

  test('recovery records warnings', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'one\ntwo\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'one\ntwo\n');
    await fs.write('a.txt', 'ZERO\none\ntwo\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[a.txt#${tag}]\nDEL 1.=1`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].warnings.length).toBeGreaterThan(0);
    expect(r.sections[0].warnings[0]).toContain('recovered');
  });

  test('3-way merge detects conflicts when base and current differ', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'line1\nline2\nline3\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'line1\nline2\nline3\n');
    await fs.write('a.txt', 'line1\nMODIFIED\nline3\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[a.txt#${tag}]\nSWAP 2.=2:\n+PATCHED`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
    expect(r.sections[0].conflicts.length).toBeGreaterThan(0);
    expect(r.sections[0].conflicts[0].type).toBe('conflict');
    expect(r.sections[0].warnings.some(w => w.includes('conflict'))).toBe(true);
  });

  test('LCS-based line mapping handles deletions correctly', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'a\nb\nc\nd\ne\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'a\nb\nc\nd\ne\n');
    await fs.write('a.txt', 'a\nd\ne\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[a.txt#${tag}]\nDEL 4.=4`);
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('a\ne\n');
  });

  test('LCS-based line mapping handles insertions correctly', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'a\nb\nc\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'a\nb\nc\n');
    await fs.write('a.txt', 'a\nINSERTED\nb\nc\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[a.txt#${tag}]\nSWAP 3.=3:\n+MODIFIED_C`);
    expect(r.ok).toBe(true);
    expect(await fs.read('a.txt')).toBe('a\nINSERTED\nb\nMODIFIED_C\n');
  });

  test('getLastConflicts returns detected conflicts', async () => {
    const fs = new MemoryFilesystem({ 'a.txt': 'base\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'base\n');
    await fs.write('a.txt', 'modified\n');
    const patcher = new Patcher({ fs, snapshots });
    await patcher.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+patched\n`);
    const conflicts = patcher.getLastConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].type).toBe('conflict');
  });

  test('recovery works with large file using greedy LCS', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i}`);
    const fs = new MemoryFilesystem({ 'big.txt': lines.join('\n') + '\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('big.txt', lines.join('\n') + '\n');
    const modifiedLines = ['INSERTED']
      .concat(lines.slice(0, 200))
      .concat(['INSERTED2'])
      .concat(lines.slice(200));
    await fs.write('big.txt', modifiedLines.join('\n') + '\n');
    const patcher = new Patcher({ fs, snapshots });
    const r = await patcher.apply(`[big.txt#${tag}]\nDEL 250.=250`);
    expect(r.ok).toBe(true);
    expect(r.sections[0].recovered).toBe(true);
  });
});

// ── HashlineBridge ───────────────────────────────────────────────────────────

describe('hashline: HashlineBridge', () => {
  test('records apply into ContentAddressableStore', async () => {
    const store = new ContentAddressableStore();
    const analyzer = new FileAnalyzer(store);
    const bridge = new HashlineBridge(store, analyzer);

    const fs = new MemoryFilesystem({ 'a.txt': 'one\ntwo\n' });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('a.txt', 'one\ntwo\n');
    const patcher = new Patcher({ fs, snapshots, bridge });

    const r = await patcher.apply(`[a.txt#${tag}]\nSWAP 1.=1:\n+ONE`);
    expect(r.ok).toBe(true);

    // 桥接应该写入了 file:a.txt ref
    const ref = store.getRef('file:a.txt');
    expect(ref).not.toBeNull();
    expect(store.getBlob(ref)).toBe('ONE\ntwo\n');
    // hashline tag refs
    expect(store.getRef(`hashline:a.txt:${r.sections[0].newTag}`)).not.toBeNull();
  });

  test('createPatcher with bridge', async () => {
    const store = new ContentAddressableStore();
    const bridge = new HashlineBridge(store);
    const patcher = createPatcher({ bridge });
    await patcher.fs.write('x.txt', 'a\n');
    const tag = patcher.snapshots.record('x.txt', 'a\n');
    const r = await patcher.apply(`[x.txt#${tag}]\nDEL 1.=1`);
    expect(r.ok).toBe(true);
    expect(store.getRef('file:x.txt')).not.toBeNull();
  });

  test('bridge swallows store errors', () => {
    const badStore = {
      storeBlob() { throw new Error('boom'); },
      setRef() { throw new Error('boom'); },
      getRef() { return null; },
    };
    const bridge = new HashlineBridge(badStore);
    expect(() => bridge.recordApply('p', 'a', 'b', 't1', 't2')).not.toThrow();
  });
});

// ── 端到端：完整 patch 文本流程 ──────────────────────────────────────────────

describe('hashline: end-to-end', () => {
  test('full patch with all op types', async () => {
    const initial = 'line1\nline2\nline3\nline4\nline5\n';
    const fs = new MemoryFilesystem({ 'demo.js': initial });
    const snapshots = new InMemorySnapshotStore();
    const tag = snapshots.record('demo.js', initial);
    const patcher = new Patcher({ fs, snapshots });

    const patchText = [
      `[demo.js#${tag}]`,
      `# swap line 2`,
      `SWAP 2.=2:`,
      `+LINE2`,
      `# delete line 4`,
      `DEL 4.=4`,
      `# insert before line 5`,
      `INS.PRE 5=`,
      `+BEFORE5`,
      `# insert after line 1`,
      `INS.POST 1=`,
      `+AFTER1`,
    ].join('\n');

    const r = await patcher.apply(patchText);
    expect(r.ok).toBe(true);
    const out = await fs.read('demo.js');
    // line1 -> line1 + AFTER1
    // line2 -> LINE2
    // line3 -> line3
    // line4 deleted
    // line5 -> BEFORE5 + line5
    expect(out).toBe('line1\nAFTER1\nLINE2\nline3\nBEFORE5\nline5\n');
    // head tag matches new content
    const newTag = computeTag(out);
    expect(snapshots.head('demo.js').tag).toBe(newTag);
  });

  test('serialize after parse preserves operations', () => {
    const src = '[a#t]\nSWAP 1.=2:\n+x\n+y\nDEL 4.=5\nINS.PRE 6=\n+z';
    const p = parsePatch(src);
    const out = p.serialize();
    const p2 = parsePatch(out);
    expect(p2.sections[0].hunks.length).toBe(3);
    expect(p2.sections[0].hunks[2].lines).toEqual(['z']);
  });
});
