import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFileSystemTools } from '../../src/tools/filesystem/filesystem-tools.js';
import { DiskFilesystem, InMemorySnapshotStore, Patcher } from '../../src/core/harness/hashline.js';

let workDir;
let tools;
let ctx;
let readTool;
let editTool;

function toolByName(name) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'filesystem-edit-file-'));
  const snapshots = new InMemorySnapshotStore();
  tools = createFileSystemTools();
  ctx = {
    workingDirectory: workDir,
    snapshotStore: snapshots,
    hashlinePatcher: new Patcher({
      fs: new DiskFilesystem(workDir),
      snapshots,
    }),
  };
  readTool = toolByName('read_file');
  editTool = toolByName('edit_file');
});

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe('filesystem edit_file read_file numbered old_text regression', () => {
  test('edits the raw line when old_text is a single numbered read_file line', async () => {
    const initial = ['{', '  "scripts": {', '    "testEnvironment": "node"', '  }', '}'].join('\n');
    await writeFile(join(workDir, 'package.json'), initial, 'utf-8');

    const readResult = await readTool.handler({ path: 'package.json' }, ctx);
    const numberedLine = readResult.split('\n').find((line) => line.startsWith('3: '));
    expect(numberedLine).toBe('3:     "testEnvironment": "node"');

    const editResult = await editTool.handler(
      {
        path: 'package.json',
        old_text: numberedLine,
        new_text: '    "testEnvironment": "jsdom"',
      },
      ctx,
    );

    expect(editResult).toContain('File edited successfully: package.json');
    expect(editResult).toContain('Strategy: read-file-output (via Hashline patcher)');
    expect(editResult).toContain('Changed 1 line(s) starting at line 3.');
    expect(await readFile(join(workDir, 'package.json'), 'utf-8')).toBe(
      ['{', '  "scripts": {', '    "testEnvironment": "jsdom"', '  }', '}'].join('\n'),
    );
  });

  test('keeps exact numeric-prefix old_text ahead of read_file prefix stripping', async () => {
    const initial = ['3: keep the literal prefix', 'keep the literal prefix'].join('\n');
    await writeFile(join(workDir, 'numbers.txt'), initial, 'utf-8');
    await readTool.handler({ path: 'numbers.txt' }, ctx);

    const editResult = await editTool.handler(
      {
        path: 'numbers.txt',
        old_text: '3: keep the literal prefix',
        new_text: '3: changed the literal prefix',
      },
      ctx,
    );

    expect(editResult).toContain('File edited successfully: numbers.txt');
    expect(editResult).toContain('Strategy: exact (via Hashline patcher)');
    expect(await readFile(join(workDir, 'numbers.txt'), 'utf-8')).toBe(
      ['3: changed the literal prefix', 'keep the literal prefix'].join('\n'),
    );
  });
});
