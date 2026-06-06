import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startPreview, stopAllPreviews, stopPreview } from '../../src/core/preview-server.js';

describe('preview server', () => {
  afterEach(() => {
    stopAllPreviews();
  });

  test('starts a static HTML preview over localhost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-static-'));
    try {
      writeFileSync(join(root, 'index.html'), '<h1>Preview OK</h1>');

      const preview = await startPreview({
        workingDirectory: root,
        target: 'index.html',
      });

      expect(preview.success).toBe(true);
      expect(preview.mode).toBe('static');
      expect(preview.url).toContain('127.0.0.1');

      const html = await fetch(preview.url).then(response => response.text());
      expect(html).toContain('Preview OK');

      expect(stopPreview(preview.session_id).success).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks targets outside the working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-block-'));
    try {
      await expect(startPreview({
        workingDirectory: root,
        target: '../outside.html',
      })).rejects.toThrow('working directory');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('starts a Node preview command with PORT and HOST', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-node-'));
    try {
      writeFileSync(join(root, 'server.js'), `
        import http from 'http';
        const host = process.env.HOST || '127.0.0.1';
        const port = Number(process.env.PORT);
        http.createServer((req, res) => {
          res.end('Node Preview OK');
        }).listen(port, host);
      `);
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        type: 'module',
        scripts: { dev: 'node server.js' },
      }));

      const preview = await startPreview({
        workingDirectory: root,
        target: '.',
        kind: 'node',
        command: 'node server.js',
      });

      expect(preview.success).toBe(true);
      expect(preview.mode).toBe('node');
      const text = await fetch(preview.url).then(response => response.text());
      expect(text).toBe('Node Preview OK');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
