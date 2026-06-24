import { describe, expect, test } from 'bun:test';
import {
  DESKTOP_RENDERER_HOST,
  DESKTOP_RENDERER_PORT_END,
  DESKTOP_RENDERER_PORT_START,
  resolveDevServerUrl,
} from '../../scripts/desktop-dev.js';
import {
  PREVIEW_HOST,
  PREVIEW_PORT_END,
  PREVIEW_PORT_START,
} from '../../src/core/preview-server.js';

describe('desktop dev server ports', () => {
  test('Electron renderer dev server uses a separate port range from workspace previews', () => {
    expect(DESKTOP_RENDERER_HOST).toBe(PREVIEW_HOST);
    expect(DESKTOP_RENDERER_PORT_END).toBeLessThan(PREVIEW_PORT_START);
    expect(PREVIEW_PORT_END).toBeGreaterThan(PREVIEW_PORT_START);
  });

  test('selects the next available Electron renderer port without entering preview range', async () => {
    const unavailable = new Set([DESKTOP_RENDERER_PORT_START, DESKTOP_RENDERER_PORT_START + 1]);
    const devServer = await resolveDevServerUrl({
      env: {},
      isPortAvailableFn: async (port) => !unavailable.has(port),
    });

    expect(devServer.host).toBe(DESKTOP_RENDERER_HOST);
    expect(Number(devServer.port)).toBe(DESKTOP_RENDERER_PORT_START + 2);
    expect(Number(devServer.port)).toBeLessThan(PREVIEW_PORT_START);
    expect(devServer.url).toBe(
      `http://${DESKTOP_RENDERER_HOST}:${DESKTOP_RENDERER_PORT_START + 2}/`,
    );
    expect(devServer.strictPort).toBe(true);
  });

  test('honors an explicit DEV_SERVER_URL with strict port selection', async () => {
    const devServer = await resolveDevServerUrl({
      defaultUrl: 'http://127.0.0.1:5300/',
      env: { DEV_SERVER_URL: 'http://127.0.0.1:5300/' },
      isPortAvailableFn: async () => false,
    });

    expect(devServer.port).toBe('5300');
    expect(devServer.url).toBe('http://127.0.0.1:5300/');
    expect(devServer.strictPort).toBe(true);
  });
});
