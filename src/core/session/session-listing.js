import path from 'path';
import fs from 'fs';

const META_READ_SIZE = 4096;
const TAIL_READ_SIZE = 8192;
const CONCURRENCY_LIMIT = 8;
const CONCURRENCY_THRESHOLD = 64;

async function readFirstLine(filePath, size = META_READ_SIZE) {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      if (bytesRead === 0) {
        return null;
      }
      const text = buffer.toString('utf-8', 0, bytesRead);
      const firstLine = text.split('\n')[0];
      return firstLine || null;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readLastLines(filePath, size = TAIL_READ_SIZE) {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const stats = await handle.stat();
      const fileSize = stats.size;
      if (fileSize === 0) {
        return [];
      }
      const readSize = Math.min(size, fileSize);
      const buffer = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(buffer, 0, readSize, fileSize - readSize);
      const text = buffer.toString('utf-8', 0, bytesRead);
      const lines = text.split('\n').filter(Boolean);
      return lines;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseMetaLine(line) {
  if (!line) return null;
  try {
    const entry = JSON.parse(line);
    if (entry && entry.type === 'session_meta') {
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

async function loadSessionMetaFromFile(filePath) {
  const firstLine = await readFirstLine(filePath);
  let meta = parseMetaLine(firstLine);

  if (!meta) {
    const lastLines = await readLastLines(filePath);
    for (const line of lastLines) {
      meta = parseMetaLine(line);
      if (meta) break;
    }
  }

  let mtime = null;
  try {
    const stats = await fs.promises.stat(filePath);
    mtime = stats.mtimeMs;
  } catch {
    mtime = null;
  }

  const sessionId = path.basename(filePath, '.jsonl');
  const updatedAt = meta?.updatedAt || meta?.createdAt || mtime || 0;
  const createdAt = meta?.createdAt || updatedAt || 0;

  return {
    sessionId,
    title: meta?.title || '未命名会话',
    createdAt,
    updatedAt,
    workingDirectory: meta?.workingDirectory || '',
    status: meta?.status || 'unknown',
    meta,
    filePath,
  };
}

async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = [];
  const actualConcurrency = Math.min(concurrency, items.length);
  for (let i = 0; i < actualConcurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function listJsonlFiles(sessionsDir) {
  try {
    const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(sessionsDir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function listSessions({
  sessionsDir,
  limit = 50,
  offset = 0,
  sortBy = 'updatedAt',
  sortOrder = 'desc',
} = {}) {
  if (!sessionsDir) {
    return [];
  }

  const files = await listJsonlFiles(sessionsDir);
  if (files.length === 0) {
    return [];
  }

  let sessions;
  if (files.length > CONCURRENCY_THRESHOLD) {
    sessions = await runWithConcurrency(files, CONCURRENCY_LIMIT, loadSessionMetaFromFile);
  } else {
    sessions = await Promise.all(files.map(loadSessionMetaFromFile));
  }

  sessions = sessions.filter(Boolean);

  sessions.sort((a, b) => {
    const aVal = a[sortBy] || 0;
    const bVal = b[sortBy] || 0;
    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  return sessions.slice(offset, offset + limit);
}

export async function countSessions({ sessionsDir } = {}) {
  if (!sessionsDir) {
    return 0;
  }

  const files = await listJsonlFiles(sessionsDir);
  return files.length;
}

export async function searchSessions({ sessionsDir, query, limit = 20 } = {}) {
  if (!sessionsDir || !query) {
    return [];
  }

  const files = await listJsonlFiles(sessionsDir);
  if (files.length === 0) {
    return [];
  }

  const lowerQuery = String(query).toLowerCase();

  let sessions;
  if (files.length > CONCURRENCY_THRESHOLD) {
    sessions = await runWithConcurrency(files, CONCURRENCY_LIMIT, loadSessionMetaFromFile);
  } else {
    sessions = await Promise.all(files.map(loadSessionMetaFromFile));
  }

  const matched = sessions
    .filter(Boolean)
    .filter((s) =>
      String(s.title || '')
        .toLowerCase()
        .includes(lowerQuery),
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);

  return matched;
}

export async function getSessionPreview(sessionId, { sessionsDir, previewLength = 200 } = {}) {
  if (!sessionsDir || !sessionId) {
    return null;
  }

  const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);

  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    let firstUserMessage = '';

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          const msg = entry.message;
          const role = msg.role || msg.type;
          if (role === 'user') {
            const content =
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            firstUserMessage = content;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    const preview = firstUserMessage.slice(0, previewLength);
    return {
      sessionId,
      preview,
      hasMore: firstUserMessage.length > previewLength,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
