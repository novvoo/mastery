/**
 * Electron main-process entrypoint.
 *
 * The application implementation lives in main-app.js so tests can import it
 * without booting Electron immediately.
 */

import { pathToFileURL } from 'url';

async function loadMainApp() {
  return import('./main-app.js');
}

class ElectronMainApp {
  #args;
  #impl = null;
  #implPromise = null;

  constructor(...args) {
    this.#args = args;
  }

  static async create(...args) {
    const { ElectronMainApp: MainApp } = await loadMainApp();
    return new MainApp(...args);
  }

  async #getImpl() {
    if (!this.#implPromise) {
      this.#implPromise = loadMainApp().then(({ ElectronMainApp: MainApp }) => {
        this.#impl = new MainApp(...this.#args);
        return this.#impl;
      });
    }
    return this.#implPromise;
  }

  async initialize() {
    const impl = await this.#getImpl();
    return impl.initialize();
  }

  async attachModelProvider(modelProvider) {
    const impl = await this.#getImpl();
    return impl.attachModelProvider(modelProvider);
  }

  getDesktopCore() {
    return this.#impl?.getDesktopCore?.() ?? null;
  }

  getIPCAdapter() {
    return this.#impl?.getIPCAdapter?.() ?? null;
  }

  getMainWindow() {
    return this.#impl?.getMainWindow?.() ?? null;
  }

  getState() {
    return (
      this.#impl?.getState?.() ?? {
        desktopState: null,
        ipcStats: null,
        windowVisible: false,
        windowCount: 0,
        workingDirectory: this.#args[0]?.workingDirectory ?? null,
      }
    );
  }

  async dispose() {
    if (!this.#impl && !this.#implPromise) {
      return undefined;
    }
    const impl = await this.#getImpl();
    return impl.dispose();
  }
}

async function main(...args) {
  const { main: runMain } = await loadMainApp();
  return runMain(...args);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === invokedPath) {
  main();
}

export { ElectronMainApp, main };
export default ElectronMainApp;
