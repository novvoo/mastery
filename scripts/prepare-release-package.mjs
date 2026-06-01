#!/usr/bin/env bun

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { spawnSync } from 'child_process';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const platform = process.env.RELEASE_PLATFORM || process.platform;
const arch = process.env.RELEASE_ARCH || process.arch;
const packageName = `${packageJson.name}-${packageJson.version}-${platform}-${arch}`;
const distDir = join(root, 'dist');
const stageDir = join(distDir, packageName);
const skipNodeModules = process.env.SKIP_NODE_MODULES === '1';
const standaloneRuntime = process.env.RELEASE_STANDALONE || '';

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

const entries = [
  'README.md',
  'TESTING.md',
  '.env.example',
  'LICENSE',
];

if (!standaloneRuntime) {
  entries.unshift('src', 'package.json', 'bun.lock');
}

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

if (!standaloneRuntime && !skipNodeModules) {
  const nodeModules = join(root, 'node_modules');
  if (!existsSync(nodeModules)) {
    throw new Error('node_modules not found. Run bun install --production before packaging.');
  }
  cpSync(nodeModules, join(stageDir, 'node_modules'), {
    recursive: true,
    dereference: false,
  });
}

const binDir = join(stageDir, 'bin');
mkdirSync(binDir, { recursive: true });

if (standaloneRuntime === 'bun') {
  const binaryName = platform === 'win32' ? 'agent.exe' : 'agent';
  const binaryPath = join(binDir, binaryName);
  const bun = process.env.BUN_BIN || 'bun';
  const result = spawnSync(bun, [
    'build',
    join(root, 'src/index.js'),
    '--compile',
    '--outfile',
    binaryPath,
  ], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Bun standalone binary build failed with exit code ${result.status}`);
  }

  if (platform !== 'win32') {
    chmodSync(binaryPath, 0o755);
  }

  writeFileSync(join(binDir, 'agent.cmd'), `@echo off
setlocal
"%~dp0agent.exe" %*
`);
} else {
  const unixLauncher = `#!/usr/bin/env sh
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec bun "$DIR/src/index.js" "$@"
`;
  const windowsLauncher = `@echo off
setlocal
set "DIR=%~dp0.."
bun "%DIR%\\src\\index.js" %*
`;

  const unixLauncherPath = join(binDir, 'agent');
  writeFileSync(unixLauncherPath, unixLauncher);
  chmodSync(unixLauncherPath, 0o755);
  writeFileSync(join(binDir, 'agent.cmd'), windowsLauncher);
}

writeFileSync(
  join(stageDir, 'RELEASE.json'),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      platform,
      arch,
      node: process.version,
      bun: standaloneRuntime === 'bun' ? getBunVersion() : null,
      packagedAt: new Date().toISOString(),
      runtime: standaloneRuntime || 'node',
      entrypoint: standaloneRuntime === 'bun' ? `bin/${platform === 'win32' ? 'agent.exe' : 'agent'}` : 'src/index.js',
      launchers: platform === 'win32' ? ['bin/agent.exe', 'bin/agent.cmd'] : ['bin/agent'],
      includesSource: !standaloneRuntime,
      includesNodeModules: !standaloneRuntime && !skipNodeModules,
    },
    null,
    2
  )
);

console.log(stageDir);

function getBunVersion() {
  const result = spawnSync(process.env.BUN_BIN || 'bun', ['--version'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
