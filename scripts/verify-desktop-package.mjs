import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const desktopReleaseDir = process.argv[2] || join(rootDir, 'release', 'desktop');

const requiredAsarEntries = [
  '/desktop/main.js',
  '/desktop/preload-entry/index.js',
  '/desktop/preload-entry/package.json',
  '/desktop/preload.js',
  '/desktop/workspace.js',
  '/src/adapters/desktop/desktop-core.js',
  '/src/adapters/desktop/ipc-adapter.js',
  '/src/core/runtime-config.js',
  '/src/models/openai-provider.js'
];

function normalizeAsarEntry(entry) {
  const normalized = String(entry).replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function findAppAsars(dir, results = []) {
  if (!existsSync(dir)) {
    return results;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === 'app.asar.unpacked') {
        continue;
      }
      findAppAsars(fullPath, results);
      continue;
    }

    if (entry === 'app.asar') {
      results.push(fullPath);
    }
  }

  return results;
}

const appAsars = findAppAsars(desktopReleaseDir);

if (appAsars.length === 0) {
  console.error(`No app.asar files found under ${desktopReleaseDir}`);
  process.exit(1);
}

let hasFailure = false;

for (const appAsar of appAsars) {
  const entries = new Set(asar.listPackage(appAsar).map(normalizeAsarEntry));
  const missing = requiredAsarEntries.filter(entry => !entries.has(entry));

  if (missing.length > 0) {
    hasFailure = true;
    console.error(`Desktop package is missing required files in ${relative(rootDir, appAsar)}:`);
    for (const entry of missing) {
      console.error(`  - ${entry}`);
    }
  } else {
    console.log(`Verified desktop package contents: ${relative(rootDir, appAsar)}`);
  }
}

if (hasFailure) {
  process.exit(1);
}
