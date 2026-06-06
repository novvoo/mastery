import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
import { URL } from 'url';

const sessions = new Map();
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT_START = 41730;
const DEFAULT_PORT_END = 42730;
const SERVER_READY_TIMEOUT_MS = 15000;

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

function detectNodeCommand(projectRoot, explicitCommand, port) {
  if (explicitCommand) {
    return explicitCommand;
  }

  const packagePath = join(projectRoot, 'package.json');
  if (!existsSync(packagePath)) {
    return null;
  }

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const scripts = pkg.scripts || {};
  const scriptName = ['dev', 'start', 'preview', 'serve'].find(name => scripts[name]);
  if (!scriptName) {
    return null;
  }

  const manager = choosePackageManager(projectRoot);
  const passthroughArgs = ['dev', 'preview'].includes(scriptName)
    ? ` -- --host ${DEFAULT_HOST} --port ${port}`
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

  for (let port = DEFAULT_PORT_START; port <= DEFAULT_PORT_END; port += 1) {
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
    probe.listen(port, DEFAULT_HOST);
  });
}

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
}

async function waitForHttp(url, timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.status < 500) {
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }
  throw new Error(`Preview server did not become ready: ${lastError?.message || url}`);
}

function createStaticServer(root) {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const requestUrl = new URL(req.url || '/', 'http://localhost');
    let candidate = resolve(root, normalizeRelativePath(requestUrl.pathname));
    if (!isInside(root, candidate)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(candidate)) {
      const spaFallback = join(root, 'index.html');
      if (existsSync(spaFallback)) {
        candidate = spaFallback;
      } else {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
    }

    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      candidate = join(candidate, 'index.html');
      if (!existsSync(candidate)) {
        res.writeHead(404);
        res.end('Not Found');
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

async function startStaticPreview({ workingDirectory, target, port }) {
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  if (!existsSync(resolved)) {
    throw new Error(`Preview target not found: ${resolved}`);
  }

  const stat = statSync(resolved);
  const root = stat.isDirectory() ? resolved : dirname(resolved);
  const entry = stat.isDirectory() ? 'index.html' : basename(resolved);
  const previewPort = await findAvailablePort(port);
  const server = createStaticServer(root);

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(previewPort, DEFAULT_HOST, resolveListen);
  });

  const session = {
    id: createSessionId(),
    mode: 'static',
    target: resolved,
    root,
    entry,
    port: previewPort,
    host: DEFAULT_HOST,
    url: `http://${DEFAULT_HOST}:${previewPort}/${encodeURIComponent(entry)}`,
    process: null,
    server,
    command: null,
    startedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return serializeSession(session);
}

async function startNodePreview({ workingDirectory, target, command, port }) {
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  const projectRoot = existsSync(resolved) && statSync(resolved).isFile() ? dirname(resolved) : resolved;
  const previewPort = await findAvailablePort(port);
  const nodeCommand = detectNodeCommand(projectRoot, command, previewPort);
  if (!nodeCommand) {
    throw new Error('No Node preview command found. Add package.json scripts.dev/start or pass command.');
  }

  const shellCommand = getShellCommand(nodeCommand);
  const child = spawn(shellCommand.executable, shellCommand.args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: DEFAULT_HOST,
      PORT: String(previewPort),
      VITE_HOST: DEFAULT_HOST,
      VITE_PORT: String(previewPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const append = data => {
    output += data.toString();
    if (output.length > 20000) {
      output = output.slice(-20000);
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  const session = {
    id: createSessionId(),
    mode: 'node',
    target: projectRoot,
    root: projectRoot,
    entry: '',
    port: previewPort,
    host: DEFAULT_HOST,
    url: `http://${DEFAULT_HOST}:${previewPort}/`,
    process: child,
    server: null,
    command: nodeCommand,
    startedAt: Date.now(),
    get output() {
      return output;
    },
  };
  sessions.set(session.id, session);

  child.once('exit', (exitCode, signal) => {
    session.exitCode = exitCode;
    session.signal = signal;
  });

  try {
    await waitForHttp(session.url);
  } catch (error) {
    stopPreview(session.id);
    throw new Error(`${error.message}\nCommand output:\n${output.slice(-2000)}`);
  }

  return serializeSession(session);
}

function inferPreviewKind({ workingDirectory, target, kind }) {
  if (kind && kind !== 'auto') {
    return kind;
  }
  const { resolved } = resolveInsideWorkspace(workingDirectory, target || '.');
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return ['.html', '.htm'].includes(extname(resolved).toLowerCase()) ? 'static' : 'node';
  }
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
    status: session.process?.exitCode === null || session.server ? 'running' : 'exited',
    output: session.output ? session.output.slice(-4000) : undefined,
    started_at: new Date(session.startedAt).toISOString(),
  };
}
