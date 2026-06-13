/**
 * Electron main-process entrypoint.
 *
 * The application implementation lives in main-app.js so tests can import it
 * without booting Electron immediately.
 */

import { pathToFileURL } from 'url';
import { ElectronMainApp, main } from './main-app.js';

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === invokedPath) {
  main();
}

export { ElectronMainApp, main };
