import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export class SessionFileStoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SessionFileStoreError';
    this.code = code || 'UNKNOWN';
  }
}

export class SessionFileStore {
  #appDataDir;
  #debounceMs;
  #pendingWrites;
  #flushTimer;

  constructor(options = {}) {
    this.#appDataDir = options.appDataDir || this.#defaultAppDataDir();
    this.#debounceMs = options.debounceMs ?? 500;
    this.#pendingWrites = new Map();
    this.#flushTimer = null;
  }

  #defaultAppDataDir() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.mastery-agent');
  }

  getSessionsDir() {
    return path.join(this.#appDataDir, 'sessions');
  }

  getProjectSessionsDir(workingDirectory) {
    const projectHash = getProjectHash(workingDirectory);
    return path.join(this.getSessionsDir(), projectHash);
  }

  getSessionFilePath(sessionId, workingDirectory) {
    if (!sessionId) {
      throw new SessionFileStoreError('sessionId is required', 'INVALID_SESSION_ID');
    }
    let baseDir = this.getSessionsDir();
    if (workingDirectory) {
      baseDir = this.getProjectSessionsDir(workingDirectory);
    }
    return path.join(baseDir, `${sessionId}.jsonl`);
  }

  async #ensureDir(dirPath) {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new SessionFileStoreError(
        `Failed to create directory: ${error.message}`,
        'DIR_CREATE_FAILED',
      );
    }
  }

  async #appendLine(sessionId, workingDirectory, entry) {
    const filePath = this.getSessionFilePath(sessionId, workingDirectory);
    const line = JSON.stringify(entry) + '\n';

    const pending = this.#pendingWrites.get(filePath);
    if (pending) {
      pending.buffer += line;
    } else {
      this.#pendingWrites.set(filePath, { buffer: line, sessionId, workingDirectory });
    }

    this.#scheduleFlush();
  }

  #scheduleFlush() {
    if (this.#debounceMs <= 0) {
      this.#flushAll();
      return;
    }

    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
    }

    this.#flushTimer = setTimeout(() => {
      this.#flushAll();
    }, this.#debounceMs);
  }

  async #flushAll() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }

    const writes = [...this.#pendingWrites.entries()];
    this.#pendingWrites.clear();

    for (const [filePath, data] of writes) {
      try {
        await this.#ensureDir(path.dirname(filePath));
        await fs.promises.appendFile(filePath, data.buffer, 'utf-8');
      } catch (error) {
        throw new SessionFileStoreError(
          `Failed to write session file: ${error.message}`,
          'WRITE_FAILED',
        );
      }
    }
  }

  async flush() {
    await this.#flushAll();
  }

  async appendMeta(sessionId, meta, workingDirectory) {
    const entry = {
      type: 'session_meta',
      version: 1,
      sessionId,
      title: meta.title || '未命名会话',
      createdAt: meta.createdAt || Date.now(),
      workingDirectory: workingDirectory || meta.workingDirectory || '',
      status: meta.status || 'running',
    };
    if (meta.updatedAt !== undefined) {
      entry.updatedAt = meta.updatedAt;
    }
    if (meta.forkedFrom !== undefined) {
      entry.forkedFrom = meta.forkedFrom;
    }
    if (meta.parentSession !== undefined) {
      entry.parentSession = meta.parentSession;
    }
    if (meta.forkedAt !== undefined) {
      entry.forkedAt = meta.forkedAt;
    }
    if (meta.isSubAgent !== undefined) {
      entry.isSubAgent = meta.isSubAgent;
    }
    if (meta.agentName !== undefined) {
      entry.agentName = meta.agentName;
    }
    if (meta.task !== undefined) {
      entry.task = meta.task;
    }
    await this.#appendLine(sessionId, workingDirectory || entry.workingDirectory, entry);
    return entry;
  }

  async appendMessage(sessionId, message, workingDirectory) {
    const entry = {
      type: 'message',
      message,
      timestamp: Date.now(),
    };
    await this.#appendLine(sessionId, workingDirectory, entry);
    return entry;
  }

  async appendToolCall(sessionId, toolName, args, workingDirectory) {
    const entry = {
      type: 'tool_call',
      toolName,
      args,
      timestamp: Date.now(),
    };
    await this.#appendLine(sessionId, workingDirectory, entry);
    return entry;
  }

  async appendToolResult(sessionId, toolName, result, workingDirectory) {
    const entry = {
      type: 'tool_result',
      toolName,
      result,
      timestamp: Date.now(),
    };
    await this.#appendLine(sessionId, workingDirectory, entry);
    return entry;
  }

  async appendCompaction(sessionId, compactionInfo, workingDirectory) {
    const entry = {
      type: 'compaction',
      compactionInfo,
      timestamp: Date.now(),
    };
    await this.#appendLine(sessionId, workingDirectory, entry);
    return entry;
  }

  async #readAllLines(filePath) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw new SessionFileStoreError(
        `Failed to read session file: ${error.message}`,
        'READ_FAILED',
      );
    }
  }

  async loadSession(sessionId, workingDirectory) {
    await this.flush();
    const filePath = this.getSessionFilePath(sessionId, workingDirectory);
    const lines = await this.#readAllLines(filePath);

    if (lines === null) {
      return null;
    }

    const entries = [];
    const messages = [];
    let meta = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        entries.push(entry);

        if (entry.type === 'session_meta') {
          meta = entry;
        } else if (entry.type === 'message' && entry.message) {
          messages.push(entry.message);
        }
      } catch {
        continue;
      }
    }

    return {
      sessionId,
      meta,
      messages,
      entries,
    };
  }

  async getSessionMeta(sessionId, workingDirectory) {
    await this.flush();
    const filePath = this.getSessionFilePath(sessionId, workingDirectory);

    try {
      const handle = await fs.promises.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
        if (bytesRead === 0) {
          return null;
        }
        const text = buffer.toString('utf-8', 0, bytesRead);
        const firstLine = text.split('\n')[0];
        if (!firstLine) {
          return null;
        }
        const entry = JSON.parse(firstLine);
        if (entry.type === 'session_meta') {
          return entry;
        }
        return null;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw new SessionFileStoreError(
        `Failed to read session meta: ${error.message}`,
        'READ_META_FAILED',
      );
    }
  }

  async deleteSession(sessionId, workingDirectory) {
    const filePath = this.getSessionFilePath(sessionId, workingDirectory);
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw new SessionFileStoreError(
        `Failed to delete session: ${error.message}`,
        'DELETE_FAILED',
      );
    }
  }

  async listSessionFiles(projectPath) {
    const dir = projectPath ? this.getProjectSessionsDir(projectPath) : this.getSessionsDir();

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const files = [];

      const walk = async (currentDir, dirEntries) => {
        for (const entry of dirEntries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            const subEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
            await walk(fullPath, subEntries);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
          }
        }
      };

      await walk(dir, entries);
      return files;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new SessionFileStoreError(
        `Failed to list session files: ${error.message}`,
        'LIST_FAILED',
      );
    }
  }

  async saveSessionTitle(sessionId, title, workingDirectory) {
    await this.flush();
    const filePath = this.getSessionFilePath(sessionId, workingDirectory);

    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const lines = raw.split('\n');
      let metaIndex = -1;
      let metaEntry = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session_meta') {
            metaIndex = i;
            metaEntry = entry;
            break;
          }
        } catch {
          continue;
        }
      }

      if (metaIndex >= 0 && metaEntry) {
        metaEntry.title = title;
        metaEntry.updatedAt = Date.now();
        lines[metaIndex] = JSON.stringify(metaEntry);
        const tempPath = `${filePath}.tmp`;
        await fs.promises.writeFile(tempPath, lines.join('\n'), 'utf-8');
        await fs.promises.rename(tempPath, filePath);
        return true;
      }

      return false;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw new SessionFileStoreError(
        `Failed to update session title: ${error.message}`,
        'UPDATE_TITLE_FAILED',
      );
    }
  }
}

export function getProjectHash(workingDirectory) {
  const normalized = path.resolve(workingDirectory || process.cwd());
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function createSessionFileStore(options = {}) {
  return new SessionFileStore(options);
}

export default SessionFileStore;
