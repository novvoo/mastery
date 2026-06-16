import { describe, it, expect, beforeEach } from 'bun:test';
import { WorkspaceState } from '../../src/core/workspace-state.js';

describe('WorkspaceState（多文件上下文聚合）', () => {
  let ws;
  beforeEach(() => {
    ws = new WorkspaceState();
  });

  it('recordFileRead 带 result.text 会生成快照', () => {
    ws.recordFileRead('/proj/a.js', true, { text: 'const x = 1;\nconsole.log(x);' });
    const snap = ws.getFileSnapshot('/proj/a.js');
    expect(snap).not.toBeNull();
    expect(snap.content).toMatch(/const x/);
  });

  it('LRU 淘汰：超过 MAX_SNAPSHOT_FILES 后淘汰最旧项', () => {
    for (let i = 0; i < 40; i++) {
      ws.setFileSnapshot(`/proj/file-${i}.js`, `content-${i}`);
    }
    expect(ws.listSnapshots().length).toBeLessThanOrEqual(30);
  });

  it('recordReference 生成最近引用，可按时间倒序取', () => {
    ws.recordReference('/a.js', 'mention');
    ws.recordReference('/b.js', 'mention');
    const recent = ws.getRecentlyReferenced(2);
    expect(recent[0].path).toMatch(/b.js/);
  });

  it('aggregateContext 以 hintPaths 优先拼装文本块', () => {
    ws.setFileSnapshot('/main.js', 'function main() { return 1; }');
    ws.setFileSnapshot('/util.js', 'function util() { return 2; }');
    const { summary, files } = ws.aggregateContext({ hintPaths: ['/util.js'] });
    expect(files[0]).toMatch(/util.js/);
    expect(summary).toMatch(/util.js/);
  });

  it('aggregateContext 超字符上限做截断，不返回过长文本', () => {
    for (let i = 0; i < 5; i++) {
      ws.setFileSnapshot(`/f-${i}.js`, 'x'.repeat(2000));
    }
    const { summary, totalChars } = ws.aggregateContext({ maxTotalChars: 1500, maxCharsPerFile: 400 });
    expect(totalChars).toBeLessThanOrEqual(1500);
    expect(typeof summary).toBe('string');
  });

  it('getFileSnapshot 对不存在的路径返回 null', () => {
    expect(ws.getFileSnapshot('/nowhere.txt')).toBeNull();
  });

  it('clear 后快照与引用计数被清空', () => {
    ws.setFileSnapshot('/x.js', '1');
    ws.recordReference('/x.js');
    ws.clear();
    expect(ws.listSnapshots().length).toBe(0);
    expect(ws.getRecentlyReferenced().length).toBe(0);
  });

  it('getSummary 包含 snapshots 和 recentReferences 计数', () => {
    ws.setFileSnapshot('/x.js', '1');
    ws.recordReference('/x.js');
    const s = ws.getSummary();
    expect(s.snapshots).toBeGreaterThanOrEqual(1);
    expect(s.recentReferences).toBeGreaterThanOrEqual(1);
  });
});
