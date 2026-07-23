export const SupervisorState = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

export class RuntimeSupervisor {
  #createRuntime;
  #runtime = null;
  #state = SupervisorState.IDLE;
  #restartCount = 0;
  #maxRestarts;
  #startPromise = null;
  #lastError = null;
  #recoveryPromise = null;
  #restartDelayMs;
  #onRuntimeChanged;
  #disposed = false;

  constructor({
    createRuntime,
    maxRestarts = 2,
    restartDelayMs = 250,
    onRuntimeChanged = null,
  } = {}) {
    if (typeof createRuntime !== 'function') {
      throw new TypeError('RuntimeSupervisor requires createRuntime');
    }
    this.#createRuntime = createRuntime;
    this.#maxRestarts = Math.max(0, Number(maxRestarts) || 0);
    this.#restartDelayMs = Math.max(0, Number(restartDelayMs) || 0);
    this.#onRuntimeChanged = onRuntimeChanged;
  }

  async start() {
    if (this.#state === SupervisorState.HEALTHY) return this.#runtime;
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start();
    try {
      return await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async #start() {
    this.#state = SupervisorState.STARTING;
    try {
      const runtime = this.#createRuntime();
      this.#runtime = runtime;
      runtime.setSupervisorHooks?.({
        onUnexpectedExit: ({ code }) => {
          this.handleUnexpectedExit({ code, runtime }).catch(() => {});
        },
      });
      await runtime.initialize();
      this.#lastError = null;
      this.#state = SupervisorState.HEALTHY;
      this.#onRuntimeChanged?.(runtime, this.getHealth());
      return runtime;
    } catch (error) {
      this.#lastError = error;
      this.#state = SupervisorState.FAILED;
      try { await this.#runtime?.dispose?.(); } catch {}
      this.#runtime = null;
      throw error;
    }
  }

  async recover() {
    if (this.#disposed) throw new Error('runtime supervisor disposed');
    if (this.#recoveryPromise) return this.#recoveryPromise;
    this.#recoveryPromise = this.#recover();
    try {
      return await this.#recoveryPromise;
    } finally {
      this.#recoveryPromise = null;
    }
  }

  async #recover() {
    if (this.#restartCount >= this.#maxRestarts) {
      this.#state = SupervisorState.FAILED;
      this.#onRuntimeChanged?.(null, this.getHealth());
      throw new Error(`runtime restart budget exhausted (${this.#maxRestarts})`);
    }
    this.#restartCount += 1;
    this.#state = SupervisorState.DEGRADED;
    try { await this.#runtime?.dispose?.(); } catch {}
    this.#runtime = null;
    this.#onRuntimeChanged?.(null, this.getHealth());
    if (this.#restartDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#restartDelayMs));
    }
    return this.start();
  }

  async handleUnexpectedExit({ code, runtime } = {}) {
    if (this.#disposed || runtime !== this.#runtime) return this.#runtime;
    this.#lastError = new Error(`runtime exited unexpectedly with code ${code ?? 'unknown'}`);
    return this.recover();
  }

  getRuntime() {
    return this.#runtime;
  }

  getHealth() {
    return {
      state: this.#state,
      restartCount: this.#restartCount,
      maxRestarts: this.#maxRestarts,
      lastError: this.#lastError?.message || null,
    };
  }

  async dispose() {
    this.#disposed = true;
    try { await this.#runtime?.dispose?.(); } finally {
      this.#runtime = null;
      this.#state = SupervisorState.STOPPED;
      this.#onRuntimeChanged?.(null, this.getHealth());
    }
  }
}
