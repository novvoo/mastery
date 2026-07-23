import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RENDERER_ROOT = path.resolve(import.meta.dir, '../../desktop/renderer');
const SOURCE_EXTENSION = /\.(?:js|jsx|mjs)$/;
const FORBIDDEN_IMPORT =
  /(?:from\s+|import\s*\(|require\s*\()\s*['"](?:electron|node:|fs(?:\/|['"])|path(?:\/|['"])|[^'"]*main-app|[^'"]*src\/adapters)/;
const PRELOAD_FILES = [
  path.resolve(import.meta.dir, '../../desktop/preload.js'),
  path.resolve(import.meta.dir, '../../desktop/preload.cjs'),
];

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return SOURCE_EXTENSION.test(entry.name) ? [fullPath] : [];
  });
}

describe('renderer architecture boundaries', () => {
  test('renderer accesses privileged capabilities only through the preload IPC contract', () => {
    const violations = listSourceFiles(RENDERER_ROOT)
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(RENDERER_ROOT, file));

    expect(violations).toEqual([]);
  });

  test('preload contracts allow subscribing to agent stop events', () => {
    for (const file of PRELOAD_FILES) {
      const source = readFileSync(file, 'utf8');
      const receiveChannels = source.match(/receive:\s*\[([\s\S]*?)\n\s*\]/)?.[1] ?? '';

      expect(receiveChannels).toContain("'agent:stop'");
    }
  });
});
