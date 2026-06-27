import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const STATE_DIRNAME = '.agent-memory';
const STATE_FILENAME = 'session-state.json';

export class SessionPersistence {
  constructor(workingDirectory, options = {}) {
    this.filePath = options.filePath || join(workingDirectory || process.cwd(), STATE_DIRNAME, STATE_FILENAME);
    this.maxMessages = options.maxMessages ?? 80;
    this.enabled = options.enabled !== false;
  }

  load() {
    if (!this.enabled || !existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  save(sessionManager, metadata = {}) {
    if (!this.enabled || !sessionManager?.exportSnapshot) {
      return false;
    }
    try {
      const snapshot = sessionManager.exportSnapshot({ maxMessages: this.maxMessages });
      const payload = {
        ...snapshot,
        metadata: {
          ...(snapshot.metadata || {}),
          ...metadata,
        },
      };
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
      renameSync(tempPath, this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  restoreInto(sessionManager) {
    const snapshot = this.load();
    if (!snapshot || !sessionManager?.restoreSnapshot) {
      return false;
    }
    return sessionManager.restoreSnapshot(snapshot);
  }
}

export function createSessionPersistence(workingDirectory, options = {}) {
  return new SessionPersistence(workingDirectory, options);
}
