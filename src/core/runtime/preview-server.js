import http from 'http';
import net from 'net';
import { spawn, execSync } from 'child_process';
import { createReadStream, existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
import { URL } from 'url';

const sessions = new Map();
export const PREVIEW_HOST = '127.0.0.1';
export const PREVIEW_PORT_START = 41730;
export const PREVIEW_PORT_END = 42730;
const SERVER_READY_TIMEOUT_MS = 15000;
const PREVIEW_STAGE_TIMEOUT_MS = 120000;
const STAGE_OUTPUT_LIMIT = 4000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function createSessionId() {
  return `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRelativePath(pathname) {
  try {
    const decoded = decodeURIComponent(pathname || '/');
    return decoded.replace(/^\/+/, '') || 'index.html';
  } catch {
    return 'index.html';
  }
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

function resolveInsideWorkspace(workingDirectory, target = '.') {
  const root = resolve(workingDirectory || process.cwd());
  const normalizedTarget = String(target || '.').trim() || '.';
  const resolved = resolve(root, normalizedTarget);
  if (!isInside(root, resolved)) {
    throw new Error('Preview target must stay inside the working directory.');
  }
  return { root, resolved };
}

function choosePackageManager(projectRoot) {
  if (existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'))) {
    return 'bun';
  }
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function readPackageScripts(projectRoot) {
  const packagePath = join(projectRoot, 'package.json');
  if (!existsSync(packagePath)) {
    return {};
  }

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  return pkg.scripts || {};
}

function readPackageJson(projectRoot) {
  const packagePath = join(projectRoot, 'package.json');
  if (!existsSync(packagePath)) {
    return null;
  }
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

function isWebPreviewScript(command = '') {
  const normalized = String(command || '').toLowerCase();
  return /\b(vite|next\s+dev|astro\s+dev|webpack-dev-server|webpack\s+serve|parcel|serve|http-server|live-server|vite-preview|nuxt\s+dev|svelte-kit\s+dev)\b/.test(normalized)
    || /\b(dev-server|preview-server)\b/.test(normalized)
    || /\b(node|bun|tsx|ts-node)\b.*\b(server|app|index)\b/.test(normalized);
}

function findWebPreviewScriptName(scripts = {}) {
  const preferredNames = ['dev', 'start', 'preview', 'serve'];
  for (const name of preferredNames) {
    if (scripts[name] && isWebPreviewScript(scripts[name])) {
      return name;
    }
  }

  return Object.keys(scripts).find(name => isWebPreviewScript(scripts[name])) || null;
}

function detectNodeCommand(projectRoot, explicitCommand, port) {
  if (explicitCommand) {
    return explicitCommand;
  }

  const scripts = readPackageScripts(projectRoot);
  const scriptName = findWebPreviewScriptName(scripts);
  if (!scriptName) {
    return null;
  }

  const manager = choosePackageManager(projectRoot);
  const passthroughArgs = ['dev', 'preview', 'serve'].includes(scriptName) && !hasExplicitPort(scripts[scriptName])
    ? ` -- --host ${PREVIEW_HOST} --port ${port}`
    : '';

  if (manager === 'bun') {
    return `bun run ${scriptName}${passthroughArgs}`;
  }
  if (manager === 'pnpm') {
    return `pnpm run ${scriptName}${passthroughArgs}`;
  }
  if (manager === 'yarn') {
    return `yarn ${scriptName}${passthroughArgs}`;
  }
  return `npm run ${scriptName}${passthroughArgs}`;
}

function createPackageManagerCommand(projectRoot, action) {
  const manager = choosePackageManager(projectRoot);
  if (action === 'install') {
    if (manager === 'bun') {
      return 'bun install';
    }
    if (manager === 'pnpm') {
      return 'pnpm install';
    }
    if (manager === 'yarn') {
      return 'yarn install';
    }
    return 'npm install';
  }

  if (manager === 'bun') {
    return `bun run ${action}`;
  }
  if (manager === 'pnpm') {
    return `pnpm run ${action}`;
  }
  if (manager === 'yarn') {
    return `yarn ${action}`;
  }
  return `npm run ${action}`;
}

function hasPackageDependencies(pkg) {
  if (!pkg) {
    return false;
  }
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .some(field => Object.keys(pkg[field] || {}).length > 0);
}

function findBuildScriptName(scripts = {}) {
  if (scripts.build) {
    return 'build';
  }
  if (scripts.compile) {
    return 'compile';
  }
  return null;
}

function findStaticOutputRoot(projectRoot) {
  const candidates = ['dist', 'build', 'out', 'public', '.output/public', '.next'];
  for (const candidate of candidates) {
    const outputRoot = join(projectRoot, candidate);
    if (existsSync(join(outputRoot, 'index.html'))) {
      return outputRoot;
    }
  }
  if (existsSync(join(projectRoot, 'index.html'))) {
    return projectRoot;
  }
  return null;
}

function findStaticRootFromPackage(projectRoot) {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {return null;}

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }

  const hints = [];

  if (typeof pkg.main === 'string') {
    const mainDir = dirname(pkg.main);
    if (mainDir && mainDir !== '.') {
      hints.push(join(projectRoot, mainDir));
    }
  }

  const scripts = pkg.scripts || {};
  const scriptText = JSON.stringify(scripts);
  const outputHints = scriptText.match(/\b(dist|build|out|public|\.output|\.next)\b/g) || [];
  for (const h of new Set(outputHints)) {
    hints.push(join(projectRoot, h));
  }

  for (const h of hints) {
    if (existsSync(join(h, 'index.html'))) {return h;}
  }
  return null;
}

function findStaticRootInSourceDirs(projectRoot) {
  const sourceDirs = ['src', 'app', 'website', 'web', 'client', 'frontend', 'public'];
  for (const dir of sourceDirs) {
    const full = join(projectRoot, dir);
    if (existsSync(join(full, 'index.html'))) {return full;}
  }
  return null;
}

/**
 * Search the whole project for the first `index.html` as a last-resort
 * static-serving root.  Useful when the generated project is plain HTML
 * with a stray `package.json` but no `npm`/`npx` is available on the host.
 */
function findAnyStaticRoot(projectRoot) {
  const output = findStaticOutputRoot(projectRoot);
  if (output) {return output;}

  const fromPkg = findStaticRootFromPackage(projectRoot);
  if (fromPkg) {return fromPkg;}

  const fromSource = findStaticRootInSourceDirs(projectRoot);
  if (fromSource) {return fromSource;}

  const visited = new Set();
  const queue = [projectRoot];
  let found = null;
  let depth = 0;
  const MAX_DEPTH = 6;

  while (queue.length > 0 && found === null && depth < MAX_DEPTH) {
    const current = queue.shift();
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      entries.sort((a, b) => {
        const aIsSource = ['src', 'app', 'website', 'web'].includes(a.name);
        const bIsSource = ['src', 'app', 'website', 'web'].includes(b.name);
        if (aIsSource !== bIsSource) {return aIsSource ? -1 : 1;}
        return a.name.localeCompare(b.name);
      });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {continue;}
        const fullPath = join(current, entry.name);
        if (visited.has(fullPath)) {continue;}
        visited.add(fullPath);
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
          found = dirname(fullPath);
          break;
        }
      }
    } catch {
      // Skip unreadable directories.
    }
    depth++;
  }
  return found;
}

/**
 * Lightweight "is this CLI available" check — runs synchronously and
 * never throws.  Returns false when the binary cannot be located or
 * when running it fails outright.
 */
function isCommandAvailable(command) {
  try {
    const probe = process.platform === 'win32'
      ? `where ${command}`
      : `command -v ${command}`;
    const out = execSync(probe, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000 });
    return out && out.toString().trim().length > 0;
  } catch {
    return false;
  }
}

function nodeEcosystemAvailable(projectRoot) {
  const manager = choosePackageManager(projectRoot);
  if (!isCommandAvailable('node')) {return { node: false, manager: false, managerName: manager };}
  if (manager === 'bun') {return { node: true, manager: isCommandAvailable('bun'), managerName: 'bun' };}
  if (manager === 'pnpm') {return { node: true, manager: isCommandAvailable('pnpm'), managerName: 'pnpm' };}
  if (manager === 'yarn') {return { node: true, manager: isCommandAvailable('yarn'), managerName: 'yarn' };}
  return { node: true, manager: isCommandAvailable('npm'), managerName: 'npm' };
}

function runCommandStage({ projectRoot, command, name, label, timeoutMs = PREVIEW_STAGE_TIMEOUT_MS, env = {} }) {
  const stage = {
    name,
    label,
    command,
    status: 'running',
    startedAt: Date.now(),
    output: '',
  };

  const shellCommand = getShellCommand(command);
  const child = spawn(shellCommand.executable, shellCommand.args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const append = data => {
    output += data.toString();
    if (output.length > STAGE_OUTPUT_LIMIT) {
      output = output.slice(-STAGE_OUTPUT_LIMIT);
    }
    stage.output = output;
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  return new Promise((resolveStage, rejectStage) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stage.status = 'failed';
      stage.completedAt = Date.now();
      stage.durationMs = stage.completedAt - stage.startedAt;
      rejectStage(new Error(`Preview ${label} stage timed out after ${timeoutMs}ms.\nCommand: ${command}\nOutput:\n${output}`));
    }, timeoutMs);

    child.once('error', error => {
      clearTimeout(timer);
      stage.status = 'failed';
      stage.completedAt = Date.now();
      stage.durationMs = stage.completedAt - stage.startedAt;
      rejectStage(new Error(`Preview ${label} stage failed: ${error.message}\nCommand: ${command}\nOutput:\n${output}`));
    });

    child.once('exit', exitCode => {
      clearTimeout(timer);
      stage.completedAt = Date.now();
      stage.durationMs = stage.completedAt - stage.startedAt;
      stage.output = output;
      if (exitCode === 0) {
        stage.status = 'completed';
        resolveStage(stage);
        return;
      }
      stage.status = 'failed';
      rejectStage(new Error(`Preview ${label} stage failed with exit code ${exitCode}.\nCommand: ${command}\nOutput:\n${output}`));
    });
  });
}

async function preparePackagePreview(projectRoot, { scripts, explicitCommand, pipeline }) {
  const pkg = readPackageJson(projectRoot);
  if (!pkg) {
    return { installOk: true, buildOk: true, note: 'no package.json' };
  }

  const eco = nodeEcosystemAvailable(projectRoot);
  const result = { installOk: true, buildOk: true, note: '', eco };

  if (hasPackageDependencies(pkg) && !existsSync(join(projectRoot, 'node_modules'))) {
    if (!eco.node || !eco.manager) {
      result.installOk = false;
      result.note = `Skipped install: ${eco.managerName} not found on PATH. Will fall back to static serving.`;
      pipeline.push({
        name: 'install', label: 'install', command: `${eco.managerName} install`,
        status: 'skipped', completedAt: Date.now(), durationMs: 0,
        output: `Package manager '${eco.managerName}' is not available. Skipping dependency install.`,
      });
    } else {
      const command = createPackageManagerCommand(projectRoot, 'install');
      try {
        const stage = await runCommandStage({
          projectRoot, command, name: 'install', label: 'install',
        });
        pipeline.push(stage);
      } catch (error) {
        result.installOk = false;
        result.note = `Install failed: ${error.message}. Will fall back to static serving.`;
        pipeline.push({
          name: 'install', label: 'install', command,
          status: 'failed', completedAt: Date.now(), durationMs: 0,
          output: error.message || 'command failed',
        });
      }
    }
  }

  const hasRunnableServer = explicitCommand || findWebPreviewScriptName(scripts);
  const buildScriptName = findBuildScriptName(scripts);
  if (!hasRunnableServer && buildScriptName) {
    if (!eco.node || !eco.manager) {
      result.buildOk = false;
      result.note = (result.note ? result.note + ' ' : '') + `Skipped build: ${eco.managerName} not found on PATH.`;
      pipeline.push({
        name: 'build', label: 'build', command: `${eco.managerName} run ${buildScriptName}`,
        status: 'skipped', completedAt: Date.now(), durationMs: 0,
        output: `Package manager '${eco.managerName}' is not available. Skipping build.`,
      });
    } else {
      const command = createPackageManagerCommand(projectRoot, buildScriptName);
      try {
        const stage = await runCommandStage({
          projectRoot, command, name: 'build', label: 'build',
          env: { HOST: PREVIEW_HOST },
        });
        pipeline.push(stage);
      } catch (error) {
        result.buildOk = false;
        result.note = (result.note ? result.note + ' ' : '') + `Build failed: ${error.message}. Will fall back to static serving.`;
        pipeline.push({
          name: 'build', label: 'build', command,
          status: 'failed', completedAt: Date.now(), durationMs: 0,
          output: error.message || 'command failed',
        });
      }
    }
  }

  return result;
}

function getShellCommand(command) {
  if (process.platform === 'win32') {
    return {
      executable: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command],
    };
  }
  return {
    executable: process.env.SHELL || '/bin/sh',
    args: ['-lc', command],
  };
}

async function findAvailablePort(preferredPort) {
  if (preferredPort) {
    await assertPortAvailable(Number(preferredPort));
    return Number(preferredPort);
  }

  for (let port = PREVIEW_PORT_START; port <= PREVIEW_PORT_END; port += 1) {
    try {
      await assertPortAvailable(port);
      return port;
    } catch {
      // Continue scanning.
    }
  }
  throw new Error('No available local preview port found.');
}

function assertPortAvailable(port) {
  return new Promise((resolvePort, rejectPort) => {
    const probe = net.createServer();
    probe.once('error', rejectPort);
    probe.once('listening', () => {
      probe.close(() => resolvePort(port));
    });
    probe.listen(port, PREVIEW_HOST);
  });
}

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
}

function hasExplicitPort(command = '') {
  return /(?:^|\s)(?:-p|--port)(?:\s+|=)\d+\b/.test(String(command));
}

function extractLocalHttpUrl(text = '') {
  const matches = String(text).match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/[^\s]*)?/gi) || [];
  for (const match of matches) {
    try {
      const parsed = new URL(match);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // Ignore partial URLs in process output.
    }
  }
  return null;
}

async function waitForNodePreviewHttp(session, getOutput, timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    const detectedUrl = extractLocalHttpUrl(getOutput());
    const urlsToTry = detectedUrl && detectedUrl !== session.url
      ? [detectedUrl, session.url]
      : [session.url];

    for (const url of urlsToTry) {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.status < 500) {
          if (url !== session.url) {
            const parsed = new URL(url);
            session.url = url;
            session.host = parsed.hostname;
            session.port = Number(parsed.port);
          }
          return true;
        }
      } catch (error) {
        lastError = error;
      }
    }

    await wait(300);
  }

  throw new Error(`Preview server did not become ready: ${lastError?.message || session.url}`);
}

function createErrorPage(statusCode, message) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusCode} - Preview Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #090B0D;
      color: #B0BDBD;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      text-align: center;
      max-width: 500px;
    }
    .status {
      font-size: 64px;
      font-weight: 800;
      color: #2F8F80;
      margin-bottom: 16px;
    }
    .message {
      font-size: 16px;
      color: #E8F0F0;
      margin-bottom: 8px;
    }
    .hint {
      font-size: 13px;
      color: #8A9696;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="status">${statusCode}</div>
    <div class="message">${message}</div>
    <div class="hint">This preview is served from your local workspace</div>
  </div>
</body>
</html>`;
}

function createStaticServer(root) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage(405, 'Method Not Allowed'));
      return;
    }

    const requestUrl = new URL(req.url || '/', 'http://localhost');
    let candidate = resolve(root, normalizeRelativePath(requestUrl.pathname));
    if (!isInside(root, candidate)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createErrorPage(403, 'Access Forbidden'));
      return;
    }

    if (!existsSync(candidate)) {
      const spaFallback = join(root, 'index.html');
      if (existsSync(spaFallback)) {
        candidate = spaFallback;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(createErrorPage(404, 'Page Not Found'));
        return;
      }
    }

    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      candidate = join(candidate, 'index.html');
      if (!existsSync(candidate)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(createErrorPage(404, 'Page Not Found'));
        return;
      }
    }

    const mime = MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    createReadStream(candidate).pipe(res);
  });
}

async function startStaticPreview({ workingDirectory, target, port, pipeline = [] }) {
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  if (!existsSync(resolved)) {
    throw new Error(`Preview target not found: ${resolved}`);
  }

  const stat = statSync(resolved);
  let root = stat.isDirectory() ? resolved : dirname(resolved);
  let entry = stat.isDirectory() ? 'index.html' : basename(resolved);

  if (stat.isDirectory() && !existsSync(join(root, entry))) {
    const discovered = findAnyStaticRoot(resolved);
    if (discovered) {
      root = discovered;
      entry = 'index.html';
    }
  }

  if (!existsSync(join(root, entry))) {
    throw new Error(`No index.html or static entry found in ${resolved}. Create an index.html or specify a file path.`);
  }

  const previewPort = await findAvailablePort(port);
  const server = createStaticServer(root);

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(previewPort, PREVIEW_HOST, resolveListen);
  });

  const session = {
    id: createSessionId(),
    mode: 'static',
    target: resolved,
    root,
    entry,
    port: previewPort,
    host: PREVIEW_HOST,
    url: `http://${PREVIEW_HOST}:${previewPort}/${encodeURIComponent(entry)}`,
    process: null,
    server,
    command: null,
    pipeline,
    startedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return serializeSession(session);
}

async function startNodePreview({ workingDirectory, target, command, port }) {
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  const projectRoot = existsSync(resolved) && statSync(resolved).isFile() ? dirname(resolved) : resolved;
  const previewPort = await findAvailablePort(port);
  const pipeline = [];
  const scripts = readPackageScripts(projectRoot);

  // --- Phase 1: try the package-manager-driven pipeline (install → build → dev server).
  //     Any failure here is non-fatal; we fall through to the static-server fallback.
  let prepareResult = null;
  let nodeServerError = null;
  try {
    prepareResult = await preparePackagePreview(projectRoot, {
      scripts,
      explicitCommand: command,
      pipeline,
    });
  } catch (error) {
    nodeServerError = error;
  }

  const eco = nodeEcosystemAvailable(projectRoot);
  const tryExternally = !command || (eco.node && eco.manager);

  // --- Phase 2: try to start a live Node dev server (when tools are available
  //     and the user didn't force a static path).
  if (tryExternally && !nodeServerError) {
    const nodeCommand = detectNodeCommand(projectRoot, command, previewPort);
    if (nodeCommand) {
      try {
        const shellCommand = getShellCommand(nodeCommand);
        const child = spawn(shellCommand.executable, shellCommand.args, {
          cwd: projectRoot,
          env: {
            ...process.env,
            HOST: PREVIEW_HOST,
            PORT: String(previewPort),
            VITE_HOST: PREVIEW_HOST,
            VITE_PORT: String(previewPort),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let output = '';
        const append = data => {
          output += data.toString();
          if (output.length > 20000) {output = output.slice(-20000);}
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);

        const liveSession = {
          id: createSessionId(),
          mode: 'node',
          target: projectRoot,
          root: projectRoot,
          entry: '',
          port: previewPort,
          host: PREVIEW_HOST,
          url: `http://${PREVIEW_HOST}:${previewPort}/`,
          process: child,
          server: null,
          command: nodeCommand,
          pipeline: [
            ...pipeline,
            { name: 'start', label: 'start', command: nodeCommand, status: 'running', startedAt: Date.now() },
          ],
          startedAt: Date.now(),
          get output() { return output; },
        };

        child.once('exit', (exitCode, signal) => {
          liveSession.exitCode = exitCode;
          liveSession.signal = signal;
        });

        try {
          await waitForNodePreviewHttp(liveSession, () => output);
          sessions.set(liveSession.id, liveSession);
          return serializeSession(liveSession);
        } catch (error) {
          child.kill('SIGTERM');
          nodeServerError = error;
        }
      } catch (error) {
        nodeServerError = error;
      }
    }
  }

  // --- Phase 3: serve static HTML with the built-in http server.
  //     Two paths land here:
  //       (a) the build step *succeeded* and produced dist/index.html
  //           → serve it.  This is the normal post-build flow.
  //       (b) the external tool chain was unavailable / failed but the
  //           project already has an index.html somewhere → fall back to it.
  const staticRoot = findAnyStaticRoot(projectRoot);
  if (staticRoot) {
    const buildSucceeded = pipeline.some(stage => stage.name === 'build' && stage.status === 'completed');
    if (!buildSucceeded && (nodeServerError || prepareResult?.note)) {
      // Case (b): record the fallback so callers know we didn't run the full pipeline.
      pipeline.push({
        name: 'static-fallback',
        label: 'static-fallback',
        command: '(built-in http server — no external tool required)',
        status: 'running',
        startedAt: Date.now(),
        output: nodeServerError
          ? `Fell back to static serving because the Node pipeline failed: ${nodeServerError.message || String(nodeServerError)}`
          : prepareResult?.note || 'No runnable package script found; serving static HTML with the built-in http server.',
      });
    }
    const staticTarget = relative(projectRoot, staticRoot) || '.';
    return startStaticPreview({
      workingDirectory: projectRoot,
      target: staticTarget,
      port: previewPort,
      pipeline,
    });
  }

  // --- Phase 4: no static HTML was produced anywhere in the project.
  //     Surface the *original* error from the failed build stage (if any)
  //     so the user sees the real compilation problem instead of a generic
  //     "no index.html" message.
  const failedBuild = pipeline.find(stage => stage.name === 'build' && stage.status === 'failed');
  if (failedBuild) {
    throw new Error(failedBuild.output || 'Preview build stage failed');
  }
  if (nodeServerError) {
    throw nodeServerError;
  }

  const reasons = [];
  if (!eco.node) {reasons.push('node not found on PATH');}
  if (!eco.manager) {reasons.push(`${eco.managerName} not found on PATH`);}
  if (!findWebPreviewScriptName(scripts)) {reasons.push('no dev/preview/serve script in package.json');}
  reasons.push('no index.html found anywhere in the project');

  const reasonText = `Reasons: ${reasons.join('; ')}. `;
  throw new Error(
    'Could not start a preview. '
    + reasonText
    + 'Add a package.json script (dev/build/start/preview/serve) that produces index.html, or put an index.html file in the project root.',
  );
}

function inferPreviewKind({ workingDirectory, target, kind }) {
  if (kind && kind !== 'auto') {
    return kind;
  }
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  // --- Fast path: if we can already find an index.html somewhere in the
  //     project, prefer the built-in static server.  No npm, no spawn,
  //     no extra processes — just serve files via `http` module.
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return ['.html', '.htm'].includes(extname(resolved).toLowerCase()) ? 'static' : 'node';
  }
  if (findAnyStaticRoot(resolved)) {
    return 'static';
  }
  // --- Slow path: no static HTML yet.  If the project has package.json,
  //     try the node path in case a build step produces index.html.
  if (existsSync(join(resolved, 'package.json'))) {
    return 'node';
  }
  return 'static';
}

export async function startPreview(options = {}) {
  const workingDirectory = options.workingDirectory || process.cwd();
  const target = options.target || options.path || '.';
  const kind = inferPreviewKind({ workingDirectory, target, kind: options.kind || 'auto' });
  if (kind === 'node') {
    return startNodePreview({ workingDirectory, target, command: options.command, port: options.port });
  }
  return startStaticPreview({ workingDirectory, target, port: options.port });
}

export function stopPreview(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: `Preview session not found: ${sessionId}` };
  }

  if (session.server) {
    session.server.close();
  }
  if (session.process && session.process.exitCode === null) {
    session.process.kill('SIGTERM');
  }
  sessions.delete(sessionId);
  return { success: true, stopped: sessionId };
}

export function listPreviews() {
  return Array.from(sessions.values()).map(serializeSession);
}

export function stopAllPreviews() {
  for (const session of Array.from(sessions.values())) {
    stopPreview(session.id);
  }
}

function serializeSession(session) {
  return {
    success: true,
    session_id: session.id,
    mode: session.mode,
    url: session.url,
    port: session.port,
    host: session.host,
    root: session.root,
    target: session.target,
    entry: session.entry,
    command: session.command,
    pipeline: session.pipeline?.map(stage => ({
      name: stage.name,
      label: stage.label,
      command: stage.command,
      status: stage.status,
      duration_ms: stage.durationMs,
      output: stage.output ? stage.output.slice(-STAGE_OUTPUT_LIMIT) : undefined,
    })) || [],
    status: session.process?.exitCode === null || session.server ? 'running' : 'exited',
    output: session.output ? session.output.slice(-4000) : undefined,
    started_at: new Date(session.startedAt).toISOString(),
  };
}
