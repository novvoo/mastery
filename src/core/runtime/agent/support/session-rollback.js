export class SessionRollbackManager {
  constructor(sessionManager) {
    this.#sessionManager = sessionManager;
    this.#checkpoints = [];
    this.#maxCheckpoints = 20;
  }

  #sessionManager;
  #checkpoints;
  #maxCheckpoints;

  createCheckpoint(reason = 'manual') {
    const checkpoint = {
      id: `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      reason,
      messageCount: this.#sessionManager.getMessageCount?.() ?? 0,
      snapshot:
        this.#sessionManager.snapshotState?.() ??
        JSON.parse(JSON.stringify(this.#sessionManager.state)),
    };
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > this.#maxCheckpoints) {
      this.#checkpoints.shift();
    }
    return checkpoint.id;
  }

  rollbackToCheckpoint(checkpointId) {
    const checkpoint = this.#checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }
    this.#restoreFromCheckpoint(checkpoint);
    this.#checkpoints = this.#checkpoints.filter((c) => c.id <= checkpointId);
    return checkpoint;
  }

  rollbackToMessageCount(count) {
    const checkpoint = this.#findCheckpointBeforeMessageCount(count);
    if (checkpoint) {
      this.#restoreFromCheckpoint(checkpoint);
      this.#checkpoints = this.#checkpoints.filter((c) => c.timestamp <= checkpoint.timestamp);
      return checkpoint;
    }
    return null;
  }

  rollbackToTimestamp(timestamp) {
    const checkpoint = this.#findCheckpointBeforeTimestamp(timestamp);
    if (checkpoint) {
      this.#restoreFromCheckpoint(checkpoint);
      this.#checkpoints = this.#checkpoints.filter((c) => c.timestamp <= checkpoint.timestamp);
      return checkpoint;
    }
    return null;
  }

  rollbackLastTurn() {
    if (this.#checkpoints.length < 2) return null;
    const lastCheckpoint = this.#checkpoints[this.#checkpoints.length - 1];
    const previousCheckpoint = this.#checkpoints[this.#checkpoints.length - 2];
    this.#restoreFromCheckpoint(previousCheckpoint);
    this.#checkpoints.pop();
    return previousCheckpoint;
  }

  getCheckpoints() {
    return [...this.#checkpoints];
  }

  clearCheckpoints() {
    this.#checkpoints = [];
  }

  #findCheckpointBeforeMessageCount(count) {
    for (let i = this.#checkpoints.length - 1; i >= 0; i--) {
      if (this.#checkpoints[i].messageCount <= count) {
        return this.#checkpoints[i];
      }
    }
    return this.#checkpoints[0] || null;
  }

  #findCheckpointBeforeTimestamp(timestamp) {
    for (let i = this.#checkpoints.length - 1; i >= 0; i--) {
      if (this.#checkpoints[i].timestamp <= timestamp) {
        return this.#checkpoints[i];
      }
    }
    return this.#checkpoints[0] || null;
  }

  #restoreFromCheckpoint(checkpoint) {
    if (this.#sessionManager.restoreState) {
      this.#sessionManager.restoreState(checkpoint.snapshot);
    } else if (this.#sessionManager.state) {
      Object.assign(this.#sessionManager.state, checkpoint.snapshot);
    }
  }
}
