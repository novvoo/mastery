import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

async function ensureDir(dirPath) {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function readSessionLines(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return raw.split('\n').filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeSessionLines(filePath, lines) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, lines.join('\n') + '\n', 'utf-8');
  await fs.promises.rename(tempPath, filePath);
}

function findMetaIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'session_meta') {
        return i;
      }
    } catch {
      continue;
    }
  }
  return -1;
}

function truncateLinesAtMessageIndex(lines, forkAtMessageIndex) {
  let messageCount = 0;
  const result = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message) {
        if (messageCount >= forkAtMessageIndex) {
          break;
        }
        messageCount++;
      }
      result.push(line);
    } catch {
      result.push(line);
    }
  }

  return result;
}

export async function forkSession(store, sourceSessionId, options = {}) {
  const { workingDirectory, forkAtMessageIndex, newTitle } = options;

  const sourceMeta = await store.getSessionMeta(sourceSessionId, workingDirectory);
  if (!sourceMeta) {
    throw new Error(`Source session not found: ${sourceSessionId}`);
  }

  const newSessionId = crypto.randomUUID();
  const sourcePath = store.getSessionFilePath(sourceSessionId, workingDirectory);
  const newPath = store.getSessionFilePath(newSessionId, workingDirectory);

  let lines;

  if (forkAtMessageIndex !== undefined && forkAtMessageIndex !== null) {
    const sourceLines = await readSessionLines(sourcePath);
    if (!sourceLines) {
      throw new Error(`Source session file not found: ${sourcePath}`);
    }
    lines = truncateLinesAtMessageIndex(sourceLines, forkAtMessageIndex);
  } else {
    await ensureDir(path.dirname(newPath));
    await fs.promises.copyFile(sourcePath, newPath);
    const copiedLines = await readSessionLines(newPath);
    if (!copiedLines) {
      throw new Error(`Failed to copy session file: ${sourcePath}`);
    }
    lines = copiedLines;
  }

  const metaIndex = findMetaIndex(lines);
  if (metaIndex >= 0) {
    const metaEntry = JSON.parse(lines[metaIndex]);
    metaEntry.sessionId = newSessionId;
    metaEntry.forkedFrom = sourceSessionId;
    metaEntry.forkedAt = Date.now();
    metaEntry.title = newTitle || `Fork: ${sourceMeta.title || '未命名会话'}`;
    metaEntry.updatedAt = Date.now();
    lines[metaIndex] = JSON.stringify(metaEntry);
  }

  await writeSessionLines(newPath, lines);

  const updatedMeta = metaIndex >= 0 ? JSON.parse(lines[metaIndex]) : null;
  return { sessionId: newSessionId, meta: updatedMeta };
}

export async function createChildSession(store, parentSessionId, options = {}) {
  const { workingDirectory, agentName, task } = options;

  const newSessionId = crypto.randomUUID();
  const newPath = store.getSessionFilePath(newSessionId, workingDirectory);

  const parentMeta = await store.getSessionMeta(parentSessionId, workingDirectory);

  const title = task
    ? `Sub-agent: ${String(task).slice(0, 60)}`
    : `Sub-agent: ${agentName || 'unknown'}`;

  const metaEntry = {
    type: 'session_meta',
    version: 1,
    sessionId: newSessionId,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workingDirectory: workingDirectory || parentMeta?.workingDirectory || '',
    status: 'running',
    parentSession: parentSessionId,
    isSubAgent: true,
    agentName: agentName || 'unknown',
  };

  if (task) {
    metaEntry.task = task;
  }

  await writeSessionLines(newPath, [JSON.stringify(metaEntry)]);

  return { sessionId: newSessionId, meta: metaEntry };
}

export async function getSessionLineage(store, sessionId, options = {}) {
  const { workingDirectory } = options;
  const lineage = [];
  let currentId = sessionId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const meta = await store.getSessionMeta(currentId, workingDirectory);
    if (!meta) {
      break;
    }

    lineage.unshift({
      sessionId: currentId,
      title: meta.title || '未命名会话',
      isSubAgent: meta.isSubAgent === true,
    });

    currentId = meta.parentSession || meta.forkedFrom || null;
  }

  return lineage;
}

export async function listChildSessions(store, parentSessionId, options = {}) {
  const { workingDirectory } = options;

  const sessionFiles = await store.listSessionFiles(workingDirectory);
  if (sessionFiles.length === 0) {
    return [];
  }

  const children = [];

  for (const filePath of sessionFiles) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const firstLine = raw.split('\n').find((l) => l.trim());
      if (!firstLine) continue;

      const entry = JSON.parse(firstLine);
      if (entry.type !== 'session_meta') continue;

      if (entry.parentSession === parentSessionId) {
        children.push({
          sessionId: entry.sessionId || path.basename(filePath, '.jsonl'),
          title: entry.title || '未命名会话',
          isSubAgent: entry.isSubAgent === true,
          agentName: entry.agentName,
          createdAt: entry.createdAt || 0,
          updatedAt: entry.updatedAt || entry.createdAt || 0,
          status: entry.status || 'unknown',
        });
      }
    } catch {
      continue;
    }
  }

  children.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return children;
}
