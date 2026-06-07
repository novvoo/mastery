import { afterEach, describe, expect, test } from 'bun:test';
import net from 'net';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startPreview, stopAllPreviews, stopPreview } from '../../src/core/preview-server.js';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.listen(0, '127.0.0.1');
  });
}

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

  test('does not pass preview host and port flags to compile-only dev scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-tsc-only-'));
    try {
      writeFileSync(join(root, 'index.html'), '<h1>Snake Game</h1>');
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        type: 'module',
        scripts: { dev: 'tsc --watch' },
      }));

      const preview = await startPreview({
        workingDirectory: root,
        target: '.',
        kind: 'auto',
      });

      expect(preview.success).toBe(true);
      expect(preview.mode).toBe('static');
      const html = await fetch(preview.url).then(response => response.text());
      expect(html).toContain('Snake Game');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('passes preview host and port flags to Vite dev scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-vite-script-'));
    try {
      writeFileSync(join(root, 'server.js'), `
        import http from 'http';
        const portArg = process.argv[process.argv.indexOf('--port') + 1];
        const hostArg = process.argv[process.argv.indexOf('--host') + 1];
        const port = Number(portArg);
        http.createServer((req, res) => {
          res.end(JSON.stringify({ hostArg, portArg }));
        }).listen(port, hostArg);
      `);
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        type: 'module',
        scripts: { dev: 'node server.js vite' },
      }));

      const preview = await startPreview({
        workingDirectory: root,
        target: '.',
        kind: 'auto',
      });

      expect(preview.success).toBe(true);
      expect(preview.mode).toBe('node');
      const payload = await fetch(preview.url).then(response => response.json());
      expect(payload.hostArg).toBe('127.0.0.1');
      expect(Number(payload.portArg)).toBe(preview.port);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('follows the local URL printed by fixed-port start scripts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-fixed-port-'));
    const fixedPort = await getAvailablePort();
    try {
      writeFileSync(join(root, 'server.js'), `
        import http from 'http';
        const port = Number(process.argv[2]);
        http.createServer((req, res) => {
          res.end('Fixed Port Preview OK');
        }).listen(port, '127.0.0.1', () => {
          console.log('Available on:');
          console.log('  http://127.0.0.1:' + port);
        });
      `);
      writeFileSync(join(root, 'package.json'), JSON.stringify({
        type: 'module',
        scripts: { start: `node server.js ${fixedPort}` },
      }));

      const preview = await startPreview({
        workingDirectory: root,
        target: '.',
        kind: 'auto',
      });

      expect(preview.success).toBe(true);
      expect(preview.mode).toBe('node');
      expect(preview.port).toBe(fixedPort);
      expect(preview.url).toBe(`http://127.0.0.1:${fixedPort}/`);
      const text = await fetch(preview.url).then(response => response.text());
      expect(text).toBe('Fixed Port Preview OK');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
