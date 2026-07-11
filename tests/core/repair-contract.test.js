import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  discoverRepairContract,
  formatRepairContract,
} from '../../src/core/runtime/agent/support/repair-contract.js';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('repair contract discovery', () => {
  test('detects conflicting package, context, ADR, and CI runners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'repair-contract-'));
    roots.push(root);
    await mkdir(join(root, 'docs', 'adr'), { recursive: true });
    await mkdir(join(root, '.github', 'workflows'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    await writeFile(join(root, 'CONTEXT.md'), 'Use `bun test` as the official command.');
    await writeFile(join(root, 'docs', 'adr', '0001.md'), 'Decision: bun test');
    await writeFile(join(root, '.github', 'workflows', 'ci.yml'), 'run: npm test');

    const contract = await discoverRepairContract(root);
    expect(contract.runners).toContain('npm');
    expect(contract.runners).toContain('bun');
    expect(contract.hasRunnerConflict).toBe(true);
    expect(formatRepairContract(contract)).toContain('Runner conflict detected');
  });

  test('returns an empty non-conflicting contract without declarations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'repair-contract-'));
    roots.push(root);
    expect(await discoverRepairContract(root)).toEqual({
      sources: [],
      declaredCommands: [],
      runners: [],
      hasRunnerConflict: false,
    });
  });
});
