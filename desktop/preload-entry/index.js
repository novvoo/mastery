const fs = require('fs');
const path = require('path');
const vm = require('vm');

const preloadPath = path.join(__dirname, '..', 'preload.js');
const startedAt = Date.now();
const electron = require('electron');
const { contextBridge, ipcRenderer } = electron;

try {
  Object.defineProperty(globalThis, 'contextBridge', {
    configurable: true,
    value: contextBridge
  });
  Object.defineProperty(globalThis, 'ipcRenderer', {
    configurable: true,
    value: ipcRenderer
  });
} catch (error) {
  console.warn('[IPC-DIAG][preload-entry] failed to seed bridge globals', {
    message: error?.message
  });
}

console.log('[IPC-DIAG][preload-entry] bootstrap start', {
  preloadPath,
  exists: fs.existsSync(preloadPath),
  cwd: process.cwd(),
  dirname: __dirname,
  node: process.versions?.node,
  electron: process.versions?.electron,
  chrome: process.versions?.chrome,
  sandboxed: process.sandboxed,
  contextIsolated: process.contextIsolated,
  hasContextBridge: !!contextBridge,
  hasIpcRenderer: !!ipcRenderer,
  globalContextBridge: typeof globalThis.contextBridge,
  globalIpcRenderer: typeof globalThis.ipcRenderer,
  hasRequire: typeof require
});

try {
  const preloadSource = fs.readFileSync(preloadPath, 'utf8');
  const runPreload = vm.runInThisContext(
    `(function(require, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval) {\n${preloadSource}\n})`,
    { filename: preloadPath }
  );
  runPreload(require, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval);
  console.log('[IPC-DIAG][preload-entry] bootstrap complete', {
    elapsedMs: Date.now() - startedAt
  });
} catch (error) {
  console.error('[IPC-DIAG][preload-entry] bootstrap failed', {
    message: error?.message,
    stack: error?.stack
  });
  throw error;
}
