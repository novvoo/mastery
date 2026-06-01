#!/usr/bin/env node

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const platform = process.env.RELEASE_PLATFORM || process.platform;
const arch = process.env.RELEASE_ARCH || process.arch;
const packageName = `${packageJson.name}-${packageJson.version}-${platform}-${arch}`;
const distDir = join(root, 'dist');
const stageDir = join(distDir, packageName);
const skipNodeModules = process.env.SKIP_NODE_MODULES === '1';

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

const entries = [
  'src',
  'package.json',
  'package-lock.json',
  'README.md',
  'TESTING.md',
  '.env.example',
  'LICENSE',
];

for (const entry of entries) {
  const source = join(root, entry);
  if (!existsSync(source)) {
    continue;
  }
  cpSync(source, join(stageDir, basename(entry)), {
    recursive: true,
    dereference: false,
  });
}

if (!skipNodeModules) {
  const nodeModules = join(root, 'node_modules');
  if (!existsSync(nodeModules)) {
    throw new Error('node_modules not found. Run npm ci --omit=dev --omit=optional before packaging.');
  }
  cpSync(nodeModules, join(stageDir, 'node_modules'), {
    recursive: true,
    dereference: false,
  });
}

const binDir = join(stageDir, 'bin');
mkdirSync(binDir, { recursive: true });

const unixLauncher = `#!/usr/bin/env sh
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "$DIR/src/index.js" "$@"
`;
const windowsLauncher = `@echo off
setlocal
set "DIR=%~dp0.."
node "%DIR%\\src\\index.js" %*
`;

const unixLauncherPath = join(binDir, 'agent');
writeFileSync(unixLauncherPath, unixLauncher);
chmodSync(unixLauncherPath, 0o755);
writeFileSync(join(binDir, 'agent.cmd'), windowsLauncher);

writeFileSync(
  join(stageDir, 'RELEASE.json'),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      platform,
      arch,
      node: process.version,
      packagedAt: new Date().toISOString(),
      entrypoint: 'src/index.js',
      launchers: ['bin/agent', 'bin/agent.cmd'],
      includesNodeModules: !skipNodeModules,
    },
    null,
    2
  )
);

console.log(stageDir);
