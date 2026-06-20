import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryVerifier } from '../../src/memory/memory-verifier.js';
import { MemoryEntry } from '../../src/memory/memory-types.js';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemoryVerifier', () => {
  let workingDir;
  let verifier;

  beforeEach(() => {
    workingDir = join(tmpdir(), `memory-verifier-test-${Date.now()}`);
    mkdirSync(workingDir, { recursive: true });
    writeFileSync(join(workingDir, '.env'), 'TEST_FLAG=true\nOTHER_FLAG=false', 'utf-8');
    writeFileSync(join(workingDir, 'test-file.txt'), 'test content', 'utf-8');
    writeFileSync(join(workingDir, 'test-function.js'), 'export function testFunction() { return "test"; }', 'utf-8');
    verifier = new MemoryVerifier(workingDir);
  });

  afterEach(() => {
    if (existsSync(workingDir)) {
      rmSync(workingDir, { recursive: true });
    }
  });

  test('verifyMemory returns valid when no source', async () => {
    const memory = new MemoryEntry({ type: 'user', title: 'Test', content: 'Content' });
    const result = await verifier.verifyMemory(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('No source to verify');
  });

  test('verifyMemory handles unknown source type', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'unknown' }
    });
    const result = await verifier.verifyMemory(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Unknown source type: unknown');
  });

  test('verifyFileReference returns valid when no file source', async () => {
    const memory = new MemoryEntry({ type: 'user', title: 'Test', content: 'Content' });
    const result = await verifier.verifyFileReference(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('No file reference to verify');
  });

  test('verifyFileReference returns valid when file exists', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'file', path: 'test-file.txt' }
    });
    const result = await verifier.verifyFileReference(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('File reference verified');
  });

  test('verifyFileReference returns invalid when file not found', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'file', path: 'non-existent.txt' }
    });
    const result = await verifier.verifyFileReference(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('File not found');
  });

  test('verifyFileReference returns invalid when file modified after memory', async () => {
    const oldTimestamp = Date.now() - 10000;
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      timestamp: oldTimestamp,
      source: { type: 'file', path: 'test-file.txt' }
    });
    writeFileSync(join(workingDir, 'test-file.txt'), 'modified content', 'utf-8');
    const result = await verifier.verifyFileReference(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('File was modified');
  });

  test('verifyFileReference checks content hash when provided', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'file', path: 'test-file.txt', contentHash: 'invalid-hash' }
    });
    const result = await verifier.verifyFileReference(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('File content has changed');
  });

  test('verifyFunctionReference returns valid when no function source', async () => {
    const memory = new MemoryEntry({ type: 'user', title: 'Test', content: 'Content' });
    const result = await verifier.verifyFunctionReference(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('No function reference to verify');
  });

  test('verifyFunctionReference returns valid when function exists', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'function', file: 'test-function.js', name: 'testFunction' }
    });
    const result = await verifier.verifyFunctionReference(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Function reference verified');
  });

  test('verifyFunctionReference returns invalid when file not found', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'function', file: 'non-existent.js', name: 'testFunction' }
    });
    const result = await verifier.verifyFunctionReference(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('File not found');
  });

  test('verifyFunctionReference returns invalid when function not found', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'function', file: 'test-function.js', name: 'nonExistentFunction' }
    });
    const result = await verifier.verifyFunctionReference(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Function not found');
  });

  test('verifyFlag returns valid when no flag source', async () => {
    const memory = new MemoryEntry({ type: 'user', title: 'Test', content: 'Content' });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('No flag reference to verify');
  });

  test('verifyFlag returns valid when flag exists', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'flag', name: 'TEST_FLAG' }
    });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Flag verified');
  });

  test('verifyFlag returns valid when flag value matches', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'flag', name: 'TEST_FLAG', value: 'true' }
    });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Flag verified');
  });

  test('verifyFlag returns invalid when flag not found', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'flag', name: 'NON_EXISTENT_FLAG' }
    });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Flag not found');
  });

  test('verifyFlag returns invalid when flag value mismatch', async () => {
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'flag', name: 'TEST_FLAG', value: 'false' }
    });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('Flag value mismatch');
  });

  test('verifyFlag uses custom config file', async () => {
    writeFileSync(join(workingDir, 'custom.env'), 'CUSTOM_FLAG=value', 'utf-8');
    const memory = new MemoryEntry({ 
      type: 'user', 
      title: 'Test', 
      content: 'Content',
      source: { type: 'flag', name: 'CUSTOM_FLAG', file: 'custom.env' }
    });
    const result = await verifier.verifyFlag(memory);
    expect(result.valid).toBe(true);
    expect(result.message).toBe('Flag verified');
  });
});