import { performance } from 'node:perf_hooks';

export class LoopWatchdog {
  constructor(options = {}) {
    this.#intervalMs = options.intervalMs ?? 250;
    this.#thresholdMs = options.thresholdMs ?? 250;
    this.#now = options.now ?? (() => performance.now());
    this.#schedule =
      options.schedule ??
      ((cb, ms) => {
        const timer = setTimeout(cb, ms);
        return { unref: () => timer.unref?.(), cancel: () => clearTimeout(timer) };
      });
    this.#expected = 0;
    this.#wasBlocked = false;
    this.#running = false;
    this.#generation = 0;
    this.#handle = undefined;
    this.onBlocked =
      options.onBlocked ??
      ((blockedMs, phase) => {
        console.warn('ui.loop-blocked', {
          blockedMs: Math.round(blockedMs),
          phase: phase ?? 'unknown',
        });
      });
  }

  #intervalMs;
  #thresholdMs;
  #now;
  #schedule;
  #expected;
  #wasBlocked;
  #running;
  #generation;
  #handle;
  onBlocked;

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#wasBlocked = false;
    this.#armTick();
  }

  stop() {
    this.#running = false;
    this.#wasBlocked = false;
    this.#generation++;
    this.#handle?.cancel?.();
    this.#handle = undefined;
  }

  #armTick() {
    const generation = this.#generation;
    this.#expected = this.#now() + this.#intervalMs;
    this.#handle = this.#schedule(() => this.#tick(generation), this.#intervalMs);
    this.#handle.unref?.();
  }

  #tick(generation) {
    if (!this.#running || generation !== this.#generation) return;
    const blockedMs = this.#now() - this.#expected;
    if (blockedMs > this.#thresholdMs) {
      if (!this.#wasBlocked) {
        this.#wasBlocked = true;
        this.onBlocked(Math.round(blockedMs), 'unknown');
      }
    } else {
      this.#wasBlocked = false;
    }
    this.#armTick();
  }
}
