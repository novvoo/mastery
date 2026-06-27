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
  constructor(...args) {
    return loadMainApp().then(({ ElectronMainApp: MainApp }) => new MainApp(...args));
  }

  static async create(...args) {
    const { ElectronMainApp: MainApp } = await loadMainApp();
    return new MainApp(...args);
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
