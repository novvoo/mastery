export class AdvisorRuntime {
  constructor(agent, host, retryDelayMs = 1000) {
    this.agent = agent;
    this.host = host;
    this.retryDelayMs = retryDelayMs;
    this.#lastCount = 0;
    this.#seenContext = new Map();
    this.#pending = [];
    this.#busy = false;
    this.#backlog = 0;
    this.#consecutiveFailures = 0;
    this.#failureNotified = false;
    this.#latestMessages = undefined;
    this.#waiters = [];
    this.#epoch = 0;
    this.disposed = false;
  }

  #lastCount;
  #seenContext;
  #pending;
  #busy;
  #backlog;
  #consecutiveFailures;
  #failureNotified;
  #latestMessages;
  #waiters;
  #epoch;

  get backlog() {
    return this.#backlog;
  }

  onTurnEnd(messages) {
    if (this.disposed) return;
    const all = messages ?? this.host.snapshotMessages();
    this.#latestMessages = all;
    const render = this.#renderDelta(all);
    if (render) {
      this.#pending.push({ text: render, turns: 1 });
      this.#backlog++;
      this.#notifyWaiters();
      void this.#drain();
    }
  }

  waitForCatchup(maxMs, threshold, signal) {
    if (this.disposed || signal?.aborted || this.#backlog < threshold) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers();
    let waiter;
    const finish = () => {
      const idx = this.#waiters.indexOf(waiter);
      if (idx >= 0) this.#waiters.splice(idx, 1);
      clearTimeout(waiter.timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    waiter = { threshold, resolve, finish, timer: setTimeout(finish, maxMs) };
    this.#waiters.push(waiter);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) {
      finish();
    }
    return promise;
  }

  dispose() {
    this.disposed = true;
    this.#epoch++;
    this.#pending = [];
    this.#backlog = 0;
    this.#consecutiveFailures = 0;
    this.#failureNotified = false;
    this.#wakeAllWaiters();
    try {
      this.agent.abort('advisor disposed');
    } catch {}
  }

  #resetAdvisorContext(clearBacklog, wakeWaiters) {
    this.#lastCount = 0;
    this.#pending = [];
    this.#consecutiveFailures = 0;
    this.#failureNotified = false;
    this.#seenContext.clear();
    if (clearBacklog) {
      this.#backlog = 0;
    }
    if (wakeWaiters) {
      this.#wakeAllWaiters();
    }
    try {
      this.agent.reset();
    } catch {}
    try {
      this.agent.abort('advisor reset');
    } catch {}
  }

  reset() {
    this.#epoch++;
    this.#resetAdvisorContext(true, true);
  }

  seedTo(count) {
    this.#lastCount = count;
    this.#pending = [];
    this.#backlog = 0;
    this.#consecutiveFailures = 0;
    this.#failureNotified = false;
    this.#seenContext.clear();
    this.#wakeAllWaiters();
  }

  #renderDelta(messages) {
    const all = messages ?? this.#latestMessages ?? this.host.snapshotMessages();
    if (all.length < this.#lastCount) {
      this.#lastCount = all.length;
      this.#seenContext.clear();
      return null;
    }
    const delta = all
      .slice(this.#lastCount)
      .filter((m) => !(m.role === 'custom' && m.customType === 'advisor'))
      .map((m) => this.#dedupContextMessage(m));
    this.#lastCount = all.length;
    if (delta.length === 0) return null;

    const md = this.#formatSessionHistory(delta);
    if (!md.trim()) return null;
    return `### Session update\n\n${md}`;
  }

  #dedupContextMessage(msg) {
    if (msg.role !== 'custom') return msg;
    const type = msg.customType;
    if (!type) return msg;
    const content = msg.content;
    if (typeof content !== 'string') return msg;
    if (this.#seenContext.get(type) === content) {
      return { ...msg, content: '(unchanged — still in effect)' };
    }
    this.#seenContext.set(type, content);
    return msg;
  }

  #formatSessionHistory(messages) {
    const lines = [];
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          lines.push(
            `## User\n\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
          );
          break;
        case 'assistant':
          lines.push(
            `## Assistant\n\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
          );
          break;
        case 'toolResult':
          lines.push(
            `## Tool Result (${msg.toolName})\n\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
          );
          break;
        case 'system':
          lines.push(
            `## System\n\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`,
          );
          break;
        default:
          lines.push(`## ${msg.role}\n\n${JSON.stringify(msg)}`);
      }
    }
    return lines.join('\n\n');
  }

  #notifyWaiters() {
    for (let i = this.#waiters.length - 1; i >= 0; i--) {
      const w = this.#waiters[i];
      if (this.#backlog < w.threshold) {
        w.finish();
      }
    }
  }

  #wakeAllWaiters() {
    for (const w of [...this.#waiters]) {
      w.finish();
    }
  }

  #rollbackFailedTurn(snapshot) {
    const messages = this.agent.state.messages;
    if (messages.length <= snapshot) return;
    try {
      if (this.agent.rollbackTo) {
        this.agent.rollbackTo(snapshot);
        return;
      }
      messages.length = snapshot;
    } catch (err) {
      console.debug('advisor rollback failed', { err: String(err) });
    }
  }

  async #drain() {
    if (this.#busy) return;
    this.#busy = true;
    try {
      while (!this.disposed && this.#pending.length) {
        const popped = this.#pending.splice(0);
        const epoch = this.#epoch;
        const candidateBatch = popped.map((b) => b.text).join('\n\n');
        const turnsCovered = popped.reduce((sum, b) => sum + b.turns, 0);

        let shouldReprime = false;
        if (this.host.maintainContext) {
          try {
            shouldReprime = await this.host.maintainContext(turnsCovered);
          } catch (err) {
            console.debug('advisor context maintenance failed', { err: String(err) });
          }
        }
        if (this.#epoch !== epoch) continue;

        let batch;
        let finalTurns;
        if (shouldReprime) {
          const newTurns = this.#pending.reduce((sum, b) => sum + b.turns, 0);
          this.#resetAdvisorContext(false, false);
          batch = this.#renderDelta(this.#latestMessages);
          finalTurns = turnsCovered + newTurns;
        } else {
          batch = candidateBatch;
          finalTurns = turnsCovered;
        }

        if (this.disposed || batch === null) {
          this.#backlog = Math.max(0, this.#backlog - finalTurns);
          this.#notifyWaiters();
          continue;
        }

        let success = false;
        const messageSnapshot = this.agent.state.messages.length;
        try {
          this.host.beginAdvisorUpdate?.();
          await this.agent.prompt(batch);
          const promptError = this.agent.state.error;
          if (promptError) throw new Error(promptError);
          success = true;
          this.#consecutiveFailures = 0;
          this.#failureNotified = false;
        } catch (err) {
          if (this.#epoch !== epoch) continue;
          this.#rollbackFailedTurn(messageSnapshot);
          console.debug('advisor turn failed', { err: String(err) });
          this.#consecutiveFailures++;
          if (this.#consecutiveFailures >= 3) {
            console.warn('advisor failed consecutively 3 times; dropping backlog to prevent stall');
            if (!this.#failureNotified) {
              this.#failureNotified = true;
              try {
                this.host.notifyFailure?.(err);
              } catch (notifyErr) {
                console.warn('advisor failure notification failed', { err: String(notifyErr) });
              }
            }
            this.#consecutiveFailures = 0;
            this.#seenContext.clear();
            success = true;
          } else {
            this.#pending.unshift({ text: batch, turns: finalTurns });
            await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
          }
        }

        if (success && this.#epoch === epoch) {
          this.#backlog = Math.max(0, this.#backlog - finalTurns);
          this.#notifyWaiters();
        }
      }
    } finally {
      this.#busy = false;
    }
  }
}
