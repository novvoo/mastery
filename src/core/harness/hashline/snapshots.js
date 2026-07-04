/**
 * Per-session snapshot store used by `Recovery` and `Patcher` to bind hashline
 * section tags to the exact file content that minted them.
 *
 * A section tag is a content-derived hash of the *whole file* (see
 * `computeFileHash`). Any read of byte-identical content mints the same tag,
 * so reads of one file state fuse onto one anchor and a follow-up edit
 * anchored at any line validates whenever the live file still hashes to it.
 *
 * The abstract base class lets callers plug in whatever storage they like
 * (LRU, persistent SQLite, etc.). `InMemorySnapshotStore` ships as a sensible
 * default backed by a small hand-rolled LRU (no external dep): a bounded set
 * of paths, each with a short history of full-file versions so in-session
 * edit chains can still recover against the version a stale tag names.
 *
 */

import { computeFileHash, sha256Hex } from './format.js';

/**
 * One full-file version observed at a point in time. The tag the model sees is
 * `Snapshot.hash`; recovery replays edits against `Snapshot.text`.
 */
export class Snapshot {
  constructor({ path, text, hash, recordedAt, seenLines }) {
    this.path = path;
    this.text = text;
    this.hash = hash;
    this.recordedAt = recordedAt;
    this.seenLines = seenLines;
  }

  get tag() {
    return this.hash;
  }
}

/**
 * Storage seam for full-file version snapshots. The patcher calls `head` for
 * the latest version of a path and `byHash` when it needs the historical
 * version a section's stale tag names.
 */
export class SnapshotStore {
  head(_path) {
    throw new Error('SnapshotStore.head() not implemented');
  }

  byHash(_path, _hash) {
    throw new Error('SnapshotStore.byHash() not implemented');
  }

  byContent(_path, _fullText) {
    throw new Error('SnapshotStore.byContent() not implemented');
  }

  findByHash(_hash) {
    return [];
  }

  record(_path, _fullText, _seenLines) {
    throw new Error('SnapshotStore.record() not implemented');
  }

  recordSeenLines(_path, _hash, _lines) {
    throw new Error('SnapshotStore.recordSeenLines() not implemented');
  }

  invalidate(_path) {
    throw new Error('SnapshotStore.invalidate() not implemented');
  }

  relocate(_from, _to) {
    throw new Error('SnapshotStore.relocate() not implemented');
  }

  clear() {
    throw new Error('SnapshotStore.clear() not implemented');
  }
}

const DEFAULT_MAX_PATHS = 30;
const DEFAULT_MAX_VERSIONS_PER_PATH = 4;
/** Global ceiling on retained snapshot text across all paths (UTF-16 code units). */
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Union `lines` into `snapshot.seenLines`, lazily creating the set. */
function mergeSeenLines(snapshot, lines) {
  if (lines === undefined) return;
  if (snapshot.seenLines === undefined) snapshot.seenLines = new Set();
  for (const line of lines) snapshot.seenLines.add(line);
}

/**
 * Tiny LRU map with a byte-size budget. No external dependency; enough for the
 * snapshot store's per-session load. Its public behavior matches the small
 * subset of LRU cache semantics this module needs: `get` refreshes recency,
 * `set` inserts/replaces, `delete` removes, and `values()` preserves recency order.
 *
 * Eviction: when both `max` and `maxSize` are configured, eviction happens
 * whenever either threshold is exceeded; the least-recently-used entry is
 * dropped first.
 */
class LruMap {
  constructor({ max, maxSize, sizeCalculation }) {
    this.max = max;
    this.maxSize = maxSize;
    this.sizeCalculation = sizeCalculation || (() => 1);
    this.map = new Map();
    this.totalSize = 0;
  }

  #touch(key) {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Map iteration is insertion-ordered; delete+set moves the key to the end.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  #dropOldest() {
    for (const [key, value] of this.map) {
      this.map.delete(key);
      this.totalSize -= this.sizeCalculation(value);
      return;
    }
  }

  get(key) {
    return this.#touch(key);
  }

  set(key, value) {
    const prior = this.map.get(key);
    if (prior !== undefined) this.totalSize -= this.sizeCalculation(prior);
    this.map.set(key, value);
    this.totalSize += this.sizeCalculation(value);

    while (this.map.size > this.max) this.#dropOldest();
    while (this.maxSize !== undefined && this.totalSize > this.maxSize && this.map.size > 1)
      this.#dropOldest();
  }

  delete(key) {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    this.totalSize -= this.sizeCalculation(value);
    return true;
  }

  values() {
    return this.map.values();
  }

  clear() {
    this.map.clear();
    this.totalSize = 0;
  }
}

/**
 * In-memory `SnapshotStore`. Per-path history is a short ring of full-file
 * versions (oldest dropped first); per-session path tracking is LRU-bounded
 * so cold paths age out automatically.
 */
export class InMemorySnapshotStore extends SnapshotStore {
  #versions;
  #maxVersionsPerPath;
  #maxPaths;
  #lineFingerprints = new Map();

  constructor(options = {}) {
    super();
    this.#maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    this.#versions = new LruMap({
      max: this.#maxPaths,
      maxSize: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      sizeCalculation: (history) => {
        let total = 1;
        for (const version of history) total += version.text.length;
        return total;
      },
    });
    this.#maxVersionsPerPath = options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS_PER_PATH;
  }

  head(path) {
    return this.#versions.get(path)?.[0] ?? null;
  }

  byHash(path, hash) {
    const history = this.#versions.get(path);
    return history?.find((version) => version.hash === hash) ?? null;
  }

  has(path, hash) {
    return this.byHash(path, hash) !== null;
  }

  byContent(path, fullText) {
    const history = this.#versions.get(path);
    return history?.find((version) => version.text === fullText) ?? null;
  }

  findByHash(hash) {
    const matches = [];
    for (const history of this.#versions.values()) {
      for (const version of history) {
        if (version.hash === hash) matches.push(version);
      }
    }
    return matches;
  }

  record(path, fullText, seenLines) {
    const text = String(fullText ?? '');
    const hash = computeFileHash(text);
    // `get` refreshes LRU recency for `path`.
    const history = this.#versions.get(path) ?? [];
    const existing = history.find((version) => version.hash === hash);
    if (existing) {
      existing.recordedAt = Date.now();
      mergeSeenLines(existing, seenLines);
      if (history[0] !== existing) {
        this.#versions.set(path, [existing, ...history.filter((version) => version !== existing)]);
      }
      this.#recordLineFingerprints(path, text);
      return hash;
    }

    const snapshot = new Snapshot({ path, text, hash, recordedAt: Date.now() });
    mergeSeenLines(snapshot, seenLines);
    this.#versions.set(path, [snapshot, ...history].slice(0, this.#maxVersionsPerPath));
    this.#recordLineFingerprints(path, text);
    return hash;
  }

  #recordLineFingerprints(path, fullText) {
    let set = this.#lineFingerprints.get(path);
    if (!set) {
      set = new Set();
      this.#lineFingerprints.set(path, set);
    }
    if (set.size > 4096) return;
    for (const line of String(fullText ?? '').split('\n')) {
      if (line.trim().length === 0) continue;
      set.add(sha256Hex(line));
      if (set.size >= 4096) break;
    }
  }

  history(path) {
    return [...(this.#versions.get(path) ?? [])];
  }

  seenLines(path, hash) {
    if (hash !== undefined) return new Set(this.byHash(path, hash)?.seenLines ?? []);
    const fingerprints = this.#lineFingerprints.get(path);
    if (fingerprints) return new Set(fingerprints);
    const merged = new Set();
    for (const snapshot of this.#versions.get(path) ?? []) {
      for (const line of snapshot.seenLines ?? []) merged.add(line);
    }
    return merged;
  }

  stats() {
    let versions = 0;
    let totalBytes = 0;
    for (const history of this.#versions.values()) {
      versions += history.length;
      for (const snapshot of history) totalBytes += snapshot.text.length;
    }
    return {
      paths: [...this.#versions.values()].length,
      versions,
      totalBytes,
      maxPaths: this.#maxPaths,
      maxVersionsPerPath: this.#maxVersionsPerPath,
    };
  }

  recordSeenLines(path, hash, lines) {
    const version = this.#versions.get(path)?.find((snapshot) => snapshot.hash === hash);
    if (version) mergeSeenLines(version, lines);
  }

  invalidate(path) {
    this.#versions.delete(path);
    this.#lineFingerprints.delete(path);
  }

  relocate(from, to) {
    const sourceHistory = this.#versions.get(from);
    if (sourceHistory === undefined || sourceHistory.length === 0) return;
    const relocated = sourceHistory.map((version) => ({ ...version, path: to }));
    const destHistory = this.#versions.get(to);
    if (destHistory === undefined) {
      this.#versions.set(to, relocated);
    } else {
      const seen = new Set();
      const merged = [];
      for (const version of [...relocated, ...destHistory]) {
        if (seen.has(version.hash)) continue;
        seen.add(version.hash);
        merged.push(version);
      }
      this.#versions.set(to, merged.slice(0, this.#maxVersionsPerPath));
    }
    this.#versions.delete(from);
    this.#lineFingerprints.delete(from);
  }

  clear() {
    this.#versions.clear();
    this.#lineFingerprints.clear();
  }
}
