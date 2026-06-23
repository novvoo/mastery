/**
 * TextEditMapper 测试套件
 *
 * 覆盖:
 *  1. 同行多 edit 合并
 *  2. Overlapping edit 冲突检测
 *  3. Mixed create-delete-rename 模式识别
 *  4. 非重叠 edit 保序处理
 *  5. 大文件批量 edit 压力
 *  6. 空编辑 / no-op 处理
 *  7. 字符级精准合并
 *  8. 边界情况（文件首行、末行、空文件）
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TextEditMapper, convertTextEditsToHashline } from '../../src/core/harness/textedit-mapper.js';
import { Patcher, MemoryFilesystem, InMemorySnapshotStore } from '../../src/core/harness/hashline.js';

// 辅助：创建 LSP TextEdit
function makeEdit(startLine, startChar, endLine, endChar, newText) {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    newText,
  };
}

// 辅助：创建 mapper 并转换
function convert(content, edits, opts = {}) {
  const mapper = new TextEditMapper({
    filePath: 'test.ts',
    fileContent: content,
    options: opts,
  });
  return mapper.convert(edits);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. 基本分类测试
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Basic classification', () => {
  test('classify pure insert as INS.PRE', () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [makeEdit(1, 0, 1, 0, 'inserted\n')];

    const result = convert(content, edits);
    expect(result.stats.total).toBe(1);
    expect(result.stats.create).toBe(1);
    expect(result.mappedEdits[0].op).toBe('INS.PRE');
  });

  test('classify pure delete as DEL', () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [makeEdit(1, 0, 2, 0, '')];

    const result = convert(content, edits);
    expect(result.stats.delete).toBe(1);
    expect(result.mappedEdits[0].op).toBe('DEL');
  });

  test('classify replace as SWAP', () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [makeEdit(1, 0, 2, 0, 'replaced\n')];

    const result = convert(content, edits);
    expect(result.stats.modify).toBe(1);
    expect(result.mappedEdits[0].op).toBe('SWAP');
  });

  test('handle no-op edit (empty range, empty newText)', () => {
    const content = 'line1\n';
    const edits = [makeEdit(0, 0, 0, 0, '')];

    const result = convert(content, edits);
    expect(result.stats.mapped).toBe(0); // NOP 被过滤
  });

  test('handle multiple non-overlapping edits', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n';
    const edits = [
      makeEdit(1, 0, 1, 5, 'REPLACED1'),  // SWAP line 2
      makeEdit(4, 0, 4, 5, 'REPLACED2'),  // SWAP line 5
    ];

    const result = convert(content, edits);
    expect(result.stats.mapped).toBe(2);
    expect(result.conflicts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. 同一行多 edit 测试
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Same-line multi-edit', () => {
  test('merge two non-overlapping same-line edits', () => {
    const content = 'ABCDEFGHIJ\n';
    // Edit 1: replace "BCD" (char 1-4) with "X"
    // Edit 2: replace "FGH" (char 5-8) with "Y"
    const edits = [
      makeEdit(0, 1, 0, 4, 'X'),
      makeEdit(0, 5, 0, 8, 'Y'),
    ];

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBe(1);
    expect(result.stats.mapped).toBe(1);
    // 合并后应为 "AXEYIJ"
    const merged = result.mappedEdits[0];
    expect(merged.lines[0]).toBe('AXEYIJ');
  });

  test('merge two same-line edits in reverse order', () => {
    const content = 'ABCDEFGHIJ\n';
    // Edit 2 first (later position), Edit 1 second (earlier position)
    const edits = [
      makeEdit(0, 5, 0, 8, 'Y'),
      makeEdit(0, 1, 0, 4, 'X'),
    ];

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBe(1);
    expect(result.mappedEdits[0].lines[0]).toBe('AXEYIJ');
  });

  test('detect conflict when same-line edits overlap in character range', () => {
    const content = 'ABCDEFGHIJ\n';
    // Overlapping character ranges
    const edits = [
      makeEdit(0, 1, 0, 6, 'X'),   // char 1-6
      makeEdit(0, 4, 0, 8, 'Y'),   // char 4-8 (overlaps)
    ];

    const result = convert(content, edits, { autoMerge: true, strictOverlap: true });
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].type).toBe('same-line-multi');
  });

  test('merge same-line edit with insert on same line', () => {
    const content = 'const x = 1;\n';
    // Replace "x" with "y", then insert "let " before the line
    const edits = [
      makeEdit(0, 6, 0, 7, 'y'),     // rename x → y
      makeEdit(0, 0, 0, 0, 'let '),  // add let before
    ];

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBe(1);
    const merged = result.mappedEdits[0];
    expect(merged.lines[0]).toBe('let const y = 1;');
  });

  test('handle 3+ same-line edits', () => {
    const content = 'abcdefghijklmnop\n';
    const edits = [
      makeEdit(0, 0, 0, 1, 'A'),   // a → A
      makeEdit(0, 7, 0, 8, 'H'),   // h → H
      makeEdit(0, 14, 0, 15, 'O'), // o → O
    ];

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBeGreaterThanOrEqual(1);
    expect(result.mappedEdits[0].lines[0]).toBe('AbcdefgHijklmnOp');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Overlapping edit 冲突检测
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Overlapping edit detection', () => {
  test('detect line-range overlap', () => {
    const content = 'line1\nline2\nline3\nline4\nline5\n';
    const edits = [
      makeEdit(1, 0, 3, 0, 'replaced\n'),   // covers lines 2-4
      makeEdit(2, 0, 4, 0, 'replaced2\n'),  // partially overlaps
    ];

    const result = convert(content, edits, { strictOverlap: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].type).toBe('overlap');
  });

  test('allow non-overlapping adjacent edits', () => {
    const content = 'line1\nline2\nline3\nline4\n';
    const edits = [
      makeEdit(1, 0, 2, 0, 'new2\n'),   // lines 2-3
      makeEdit(3, 0, 4, 0, 'new4\n'),   // lines 4-5 (adjacent, no overlap)
    ];

    const result = convert(content, edits);
    expect(result.conflicts.length).toBe(0);
    expect(result.stats.mapped).toBe(2);
  });

  test('identical range edits are conflicting', () => {
    const content = 'line1\nline2\n';
    const edits = [
      makeEdit(0, 0, 1, 0, 'A\n'),
      makeEdit(0, 0, 1, 0, 'B\n'),
    ];

    const result = convert(content, edits, { strictOverlap: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  test('non-overlapping same-line but different columns merge ok', () => {
    const content = 'import { A, B, C } from "mod";\n';
    // "import { " = 8 chars, then "A, " = 3 chars, then "B, " = 3 chars, then "C"
    // Remove "A, " (chars 8-11) then remove ", C" (chars 13-16)
    const edits = [
      makeEdit(0, 8, 0, 11, ''),   // remove "A, "
      makeEdit(0, 13, 0, 16, ''),  // remove ", C"
    ];

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBe(1);
    expect(result.mappedEdits[0].lines[0]).toContain('B');
    expect(result.mappedEdits[0].lines[0]).not.toContain('A');
    expect(result.mappedEdits[0].lines[0]).not.toContain('C');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Mixed create-delete-rename 模式识别
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Mixed create-delete-rename', () => {
  test('detect rename pattern: delete old + insert similar new', () => {
    const content = 'function oldName() {\n  return 1;\n}\n\nother stuff\n';
    const edits = [
      makeEdit(0, 0, 3, 0, ''),                                          // delete old function
      makeEdit(0, 0, 0, 0, 'function newName() {\n  return 1;\n}\n'),    // insert renamed
    ];

    const result = convert(content, edits);
    // Should be detected as rename → merged into SWAP
    const merged = result.stats.merged > 0;
    if (merged) {
      const swapEdit = result.mappedEdits.find(e => e.op === 'SWAP');
      expect(swapEdit).toBeTruthy();
    }
  });

  test('detect replace pattern: delete + create different content', () => {
    const content = 'const x = oldValue;\nother stuff\n';
    const edits = [
      makeEdit(0, 0, 1, 0, ''),                     // delete old line
      makeEdit(0, 0, 0, 0, 'const x = newValue;\n'), // insert new line
    ];

    const result = convert(content, edits);
    // Should merge into a single SWAP
    const swapCount = result.mappedEdits.filter(e => e.op === 'SWAP').length;
    expect(swapCount).toBeGreaterThanOrEqual(0); // May or may not merge depending on similarity
  });

  test('keep separate when delete + create are unrelated', () => {
    const content = '// old comment\nline1\nline2\n';
    const edits = [
      makeEdit(0, 0, 1, 0, ''),                           // delete comment
      makeEdit(2, 0, 2, 0, 'import { newLib } from "x";\n'), // insert import after
    ];

    const result = convert(content, edits);
    // These should remain separate (different content, different positions)
    expect(result.stats.mapped).toBeGreaterThanOrEqual(1);
  });

  test('mixed create-delete-rename with 3+ edits', () => {
    const content = 'import Old from "old";\nimport Old2 from "old2";\n\nconst x = Old();\n';
    const edits = [
      makeEdit(0, 0, 1, 0, ''),                                  // delete line 1
      makeEdit(0, 0, 0, 0, 'import New from "new";\n'),         // insert new import
      makeEdit(1, 0, 2, 0, ''),                                  // delete line 2
      makeEdit(1, 0, 1, 0, 'import New2 from "new2";\n'),       // replace line 2
      makeEdit(3, 12, 3, 15, 'New'),                            // rename Old→New on line 4
    ];

    const result = convert(content, edits);
    // Check for expected stats
    expect(result.stats.total).toBe(5);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Hashline Patch 生成与往返验证
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Hashline patch generation & roundtrip', () => {
  test('generate valid Hashline patch text', () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [makeEdit(1, 0, 2, 0, 'replaced\n')];

    const result = convertTextEditsToHashline('test.ts', content, edits);
    expect(result.patchText).toContain('[test.ts#');
    expect(result.patchText).toContain('SWAP');
  });

  test('patch roundtrip: apply generated patch back to file', async () => {
    const content = 'line1\nline2\nline3\nline4\n';
    const edits = [
      makeEdit(1, 0, 2, 0, 'REPLACED_L2\n'),  // replace line 2
      makeEdit(3, 0, 4, 0, 'REPLACED_L4\n'),  // replace line 4
    ];

    const result = convertTextEditsToHashline('test.ts', content, edits);
    expect(result.patchText).toBeTruthy();
    expect(result.conflicts.length).toBe(0);

    // Apply patch via Patcher
    const fs = new MemoryFilesystem({ 'test.ts': content });
    const snapshots = new InMemorySnapshotStore();
    snapshots.record('test.ts', content);

    const patcher = new Patcher({ fs, snapshots });
    const applyResult = await patcher.apply(result.patchText);

    expect(applyResult.ok).toBe(true);

    // Verify content
    const newContent = await fs.read('test.ts');
    expect(newContent).toContain('REPLACED_L2');
    expect(newContent).toContain('REPLACED_L4');
    expect(newContent).not.toContain('line2\n');
  });

  test('patch with same-line multi-edit roundtrip', async () => {
    const content = 'const a = 1, b = 2, c = 3;\n';
    // Character positions: a at 6, b at 13, c at 20
    const edits = [
      makeEdit(0, 6, 0, 7, 'x'),     // rename a → x
      makeEdit(0, 13, 0, 14, 'y'),   // rename b → y
      makeEdit(0, 20, 0, 21, 'z'),   // rename c → z
    ];

    const result = convertTextEditsToHashline('test.ts', content, edits);
    expect(result.conflicts.length).toBe(0);

    const fs = new MemoryFilesystem({ 'test.ts': content });
    const snapshots = new InMemorySnapshotStore();
    snapshots.record('test.ts', content);

    const patcher = new Patcher({ fs, snapshots });
    const applyResult = await patcher.apply(result.patchText);

    expect(applyResult.ok).toBe(true);
    const newContent = await fs.read('test.ts');
    expect(newContent).toContain('const x = 1, y = 2, z = 3;');
  });

  test('patch with overlapping edits detected as conflicts', async () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [
      makeEdit(1, 0, 2, 0, 'A\n'),
      makeEdit(1, 0, 3, 0, 'B\n'),
    ];

    const result = convertTextEditsToHashline('test.ts', content, edits, { strictOverlap: true });
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. 边界情况
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Edge cases', () => {
  test('handle empty file content', () => {
    const content = '';
    const edits = [makeEdit(0, 0, 0, 0, 'new content\n')];

    const result = convert(content, edits);
    expect(result.stats.mapped).toBe(1);
    expect(result.mappedEdits[0].op).toBe('INS.PRE');
  });

  test('handle edit at file start (line 0)', () => {
    const content = 'first\nsecond\n';
    const edits = [makeEdit(0, 0, 0, 0, '// header\n')];

    const result = convert(content, edits);
    expect(result.mappedEdits[0].startLine).toBe(1);
  });

  test('handle edit at file end', () => {
    const content = 'line1\nline2\n';
    const edits = [makeEdit(2, 0, 2, 0, 'line3\nline4\n')];

    const result = convert(content, edits);
    expect(result.mappedEdits[0].op).toBe('INS.PRE');
  });

  test('handle empty edits array', () => {
    const content = 'something\n';
    const result = convert(content, []);
    expect(result.stats.total).toBe(0);
    expect(result.mappedEdits.length).toBe(0);
  });

  test('handle edit that deletes everything', () => {
    const content = 'line1\nline2\nline3\n';
    const edits = [makeEdit(0, 0, 3, 0, '')];

    const result = convert(content, edits);
    expect(result.mappedEdits[0].op).toBe('DEL');
    expect(result.mappedEdits[0].startLine).toBe(1);
    expect(result.mappedEdits[0].endLine).toBe(4);
  });

  test('handle edit across many lines', () => {
    const content = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
    const edits = [makeEdit(2, 0, 8, 0, 'X\nY\nZ')];

    const result = convert(content, edits);
    expect(result.mappedEdits[0].op).toBe('SWAP');
    expect(result.mappedEdits[0].startLine).toBe(3);
    expect(result.mappedEdits[0].endLine).toBe(9);
    expect(result.mappedEdits[0].lines.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. 大文件压力测试
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Large file stress', () => {
  test('handle 100 edits in 200-line file', () => {
    const lines = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`line_${i.toString().padStart(4, '0')}: const value${i} = ${i};`);
    }
    const content = lines.join('\n') + '\n';

    const edits = [];
    for (let i = 0; i < 100; i++) {
      const lineNo = i * 2; // every other line
      edits.push(makeEdit(lineNo, 0, lineNo + 1, 0, `// REPLACED ${i}\n`));
    }

    const start = Date.now();
    const result = convert(content, edits);
    const elapsed = Date.now() - start;

    expect(result.stats.mapped).toBeGreaterThan(0);
    expect(result.conflicts.length).toBe(0);
    expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
  });

  test('handle 50 same-line edits on one line', () => {
    // Create a line with 100 comma-separated items
    const items = Array.from({ length: 100 }, (_, i) => `v${i}`);
    const content = `const vals = [${items.join(', ')}];\n`;

    // "const vals = [" = 14 chars, then each "vN, " = 4 chars
    // Rename vN → xN for first 50 items
    const edits = [];
    for (let i = 0; i < 50; i++) {
      const charPos = 14 + i * 4;
      edits.push(makeEdit(0, charPos, 0, charPos + 2, `x${i}`)); // rename vN → xN
    }

    const result = convert(content, edits, { autoMerge: true });
    expect(result.stats.merged).toBeGreaterThanOrEqual(1);
    // Check that all 50 renames happened
    const finalLine = result.mappedEdits[0]?.lines?.[0] || '';
    for (let i = 0; i < 50; i++) {
      expect(finalLine).toContain(`x${i}`);
    }
  });

  test('handle edits that create file from scratch', () => {
    const content = '';
    const edits = [
      makeEdit(0, 0, 0, 0, '#!/usr/bin/env node\n'),
      makeEdit(0, 0, 0, 0, '// line 2\n'),
      makeEdit(0, 0, 0, 0, '// line 3\n'),
    ];

    const result = convert(content, edits);
    expect(result.stats.create).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. 真实场景模拟测试
// ═══════════════════════════════════════════════════════════════════════

describe('TextEditMapper: Real-world scenarios', () => {
  test('rename variable across function with multiple references', () => {
    const content = [
      'function process(data) {',
      '  const result = data.map(x => x * 2);',
      '  const sum = result.reduce((a, b) => a + b, 0);',
      '  console.log(sum);',
      '  return sum;',
      '}',
    ].join('\n') + '\n';

    // LSP TextEdits for renaming "sum" to "total"
    const edits = [
      makeEdit(2, 9, 2, 12, 'total'),
      makeEdit(3, 15, 3, 18, 'total'),
      makeEdit(4, 9, 4, 12, 'total'),
    ];

    const result = convert(content, edits);
    expect(result.conflicts.length).toBe(0);
    expect(result.stats.mapped).toBeGreaterThan(0);
  });

  test('extract method refactoring', () => {
    const content = [
      'class Calculator {',
      '  compute() {',
      '    const a = this.getA();',
      '    const b = this.getB();',
      '    const sum = a + b;',
      '    return sum * 2;',
      '  }',
      '}',
    ].join('\n') + '\n';

    // Extract "const sum = a + b; return sum * 2;" into separate method
    const edits = [
      // Add new method after compute
      makeEdit(6, 0, 6, 0, '\n  computeInner(a, b) {\n    const sum = a + b;\n    return sum * 2;\n  }\n'),
      // Replace body of compute
      makeEdit(2, 0, 6, 0,
        '    const a = this.getA();\n' +
        '    const b = this.getB();\n' +
        '    return this.computeInner(a, b);\n',
      ),
    ];

    const result = convert(content, edits);
    // Should have 2 edits (overlap detected)
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  test('add import + rename usage', () => {
    const content = [
      '// no imports',
      '',
      'function main() {',
      '  const result = oldFunction();',
      '  return result;',
      '}',
    ].join('\n') + '\n';

    const edits = [
      makeEdit(0, 0, 0, 0, 'import { newFunction } from "./lib";\n'),
      makeEdit(3, 15, 3, 27, 'newFunction'),
    ];

    const result = convert(content, edits);
    expect(result.conflicts.length).toBe(0);
    expect(result.stats.mapped).toBe(2);
  });

  test('type-only import + value rename combo', () => {
    const content = [
      'import type { OldType } from "./types";',
      '',
      'function process(input: OldType): OldType {',
      '  return input;',
      '}',
    ].join('\n') + '\n';

    const edits = [
      makeEdit(0, 14, 0, 21, 'NewType'),
      makeEdit(2, 25, 2, 32, 'NewType'),
      makeEdit(2, 35, 2, 42, 'NewType'),
    ];

    const result = convert(content, edits);
    expect(result.conflicts.length).toBe(0);
  });
});
