import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  PREVIEW_HOST,
  PREVIEW_PORT_START,
  PREVIEW_PORT_END,
  startPreview,
  stopPreview,
  listPreviews,
  stopAllPreviews,
} from '../../src/core/runtime/preview-server.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('preview-server constants', () => {
  test('PREVIEW_HOST is localhost', () => {
    expect(PREVIEW_HOST).toBe('127.0.0.1');
  });

  test('PREVIEW_PORT_START is a valid port', () => {
    expect(PREVIEW_PORT_START).toBeGreaterThan(1024);
    expect(PREVIEW_PORT_START).toBeLessThan(65536);
  });

  test('PREVIEW_PORT_END is greater than PREVIEW_PORT_START', () => {
    expect(PREVIEW_PORT_END).toBeGreaterThan(PREVIEW_PORT_START);
  });
});

describe('startPreview - static mode', () => {
  const testDir = join(tmpdir(), `preview-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'index.html'), '<html><body>Hello Preview</body></html>');
  });

  afterEach(() => {
    stopAllPreviews();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('starts a static preview for a directory with index.html', async () => {
    const result = await startPreview({ workingDirectory: testDir, kind: 'static' });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('static');
    expect(result.url).toBeDefined();
    expect(result.url).toContain('http://');
    expect(result.session_id).toBeDefined();
    expect(result.port).toBeGreaterThan(0);
    expect(result.host).toBe(PREVIEW_HOST);
  });

  test('starts a static preview for a specific HTML file', async () => {
    const htmlPath = join(testDir, 'index.html');
    const result = await startPreview({
      workingDirectory: testDir,
      target: htmlPath,
      kind: 'static',
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('static');
  });

  test('treats zero-like preview port as auto allocation', async () => {
    const result = await startPreview({
      workingDirectory: testDir,
      kind: 'static',
      port: '0',
    });

    expect(result.success).toBe(true);
    expect(result.port).toBeGreaterThanOrEqual(PREVIEW_PORT_START);
    expect(result.url).toContain(`:${result.port}/`);
    expect(result.url).not.toContain(':0/');
  });

  test('ignores invalid preview port values and auto allocates', async () => {
    const result = await startPreview({
      workingDirectory: testDir,
      kind: 'static',
      port: 'not-a-port',
    });

    expect(result.success).toBe(true);
    expect(result.port).toBeGreaterThanOrEqual(PREVIEW_PORT_START);
    expect(result.url).toContain(`:${result.port}/`);
  });

  test('throws when target does not exist', async () => {
    try {
      await startPreview({ workingDirectory: testDir, target: 'nonexistent.html', kind: 'static' });
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error.message).toContain('not found');
    }
  });

  test('throws when no index.html found in project', async () => {
    const emptyDir = join(tmpdir(), `preview-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      await startPreview({ workingDirectory: emptyDir, kind: 'static' });
      expect(true).toBe(false);
    } catch (error) {
      expect(error.message).toBeDefined();
    } finally {
      try {
        rmSync(emptyDir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('returns pipeline information', async () => {
    const result = await startPreview({ workingDirectory: testDir, kind: 'static' });
    expect(result.pipeline).toBeDefined();
    expect(Array.isArray(result.pipeline)).toBe(true);
  });
});

describe('stopPreview', () => {
  const testDir = join(tmpdir(), `preview-stop-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'index.html'), '<html><body>Stop Test</body></html>');
  });

  afterEach(() => {
    stopAllPreviews();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('stops an active preview session', async () => {
    const started = await startPreview({ workingDirectory: testDir, kind: 'static' });
    const result = stopPreview(started.session_id);
    expect(result.success).toBe(true);
    expect(result.stopped).toBe(started.session_id);
  });

  test('returns error for non-existent session', () => {
    const result = stopPreview('nonexistent_session_id');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('listPreviews', () => {
  const testDir = join(tmpdir(), `preview-list-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'index.html'), '<html><body>List Test</body></html>');
  });

  afterEach(() => {
    stopAllPreviews();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('lists active preview sessions', async () => {
    await startPreview({ workingDirectory: testDir, kind: 'static' });
    const list = listPreviews();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].session_id).toBeDefined();
    expect(list[0].url).toBeDefined();
  });

  test('returns empty array when no sessions', () => {
    stopAllPreviews();
    const list = listPreviews();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });
});

describe('stopAllPreviews', () => {
  const testDir = join(tmpdir(), `preview-stopall-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'index.html'), '<html><body>Stop All Test</body></html>');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('stops all active preview sessions', async () => {
    await startPreview({ workingDirectory: testDir, kind: 'static' });
    stopAllPreviews();
    const list = listPreviews();
    expect(list.length).toBe(0);
  });
});

describe('preview session serialization', () => {
  const testDir = join(tmpdir(), `preview-serial-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'index.html'), '<html><body>Serial Test</body></html>');
  });

  afterEach(() => {
    stopAllPreviews();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('serialized session includes expected fields', async () => {
    const result = await startPreview({ workingDirectory: testDir, kind: 'static' });
    expect(result.success).toBe(true);
    expect(result.session_id).toBeDefined();
    expect(result.mode).toBeDefined();
    expect(result.url).toBeDefined();
    expect(result.port).toBeDefined();
    expect(result.host).toBeDefined();
    expect(result.root).toBeDefined();
    expect(result.target).toBeDefined();
    expect(result.pipeline).toBeDefined();
    expect(result.started_at).toBeDefined();
    expect(result.status).toBeDefined();
  });
});
