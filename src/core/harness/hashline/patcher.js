/**
 * High-level patch orchestrator. Reads each section's target file via the
 * configured Filesystem, strips BOM and normalizes line endings,
 * validates the section snapshot tag (with Recovery), applies the
 * result back through the same Filesystem.
 *
 * Two layers:
 *
 * - Patcher.apply — high-level, all-or-nothing. Preflights every
 *   section in memory before any write hits disk, then commits in order.
 * - Patcher.prepare / Patcher.commit — granular primitives
 *   for callers that need per-section control (e.g. batched LSP flush,
 *   custom interleaving). `prepare` performs all the read-side work,
 *   validates the section snapshot tag (with recovery), and applies the
 *   edits in memory. `commit` writes the prepared result and records a
 *   fresh snapshot.
 *
 * Because `prepare` already runs the full apply, a multi-section batch is
 * naturally all-or-nothing: by the time any `commit` runs, every section
 * has been validated.
 *
 * The patcher itself is stateless across calls; reuse one instance per
 * filesystem configuration.
 */
import * as path from 'node:path';
import { applyEdits } from './apply.js';
import { hasBlockEdit, resolveBlockEdits } from './block.js';
import { computeFileHash, formatHashlineHeader } from './format.js';
import { isNotFound } from './fs.js';
import {
  HEADTAIL_DRIFT_WARNING,
  missingSnapshotTagMessage,
  pathRecoveredFromTagMessage,
  RevealedLine,
  unseenLinesMessage,
} from './messages.js';
import { MismatchError } from './mismatch.js';
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from './normalize.js';
import { Recovery } from './recovery.js';

/**
 * Upper bound on the number of unseen anchor lines whose actual file content
 * we inline into a rejection error (see Patcher.assertSeenLines). Big
 * enough to fit the common "edit a whole function body" retry path in one
 * message, small enough to keep the error human-readable when the model
 * over-anchors and to preserve the "re-read first" fallback for genuinely
 * blind wide edits (only the revealed prefix gets merged into `seenLines`).
 */
const SEEN_LINE_REVEAL_CAP = 40;

/**
 * Per-revealed-line character cap. Matches the read/search column cap so a
 * revealed anchor line can never dump a minified megabyte-wide bundle line
 * into the tool error, TUI, and model context. Lines longer than the cap
 * are trimmed to `cap` characters plus an `…` marker AND flag the entire
 * reveal as truncated so no line joins `seenLines` — the model must re-read
 * the range to prove it saw the full width.
 */
const SEEN_LINE_REVEAL_MAX_COLUMNS = 512;

/**
 * @typedef {import("./types.js").ApplyResult} ApplyResult
 * @typedef {import("./types.js").BlockResolution} BlockResolution
 * @typedef {import("./types.js").BlockResolver} BlockResolver
 * @typedef {import("./types.js").Edit} Edit
 * @typedef {import("./types.js").FileOp} FileOp
 * @typedef {import("./fs.js").Filesystem} Filesystem
 * @typedef {import("./fs.js").WriteResult} WriteResult
 * @typedef {import("./input.js").Patch} Patch
 * @typedef {import("./input.js").PatchSection} PatchSection
 * @typedef {import("./normalize.js").LineEnding} LineEnding
 * @typedef {import("./recovery.js").RecoveryResult} RecoveryResult
 * @typedef {import("./snapshots.js").Snapshot} Snapshot
 * @typedef {import("./snapshots.js").SnapshotStore} SnapshotStore
 * @typedef {{ fs: Filesystem, snapshots: SnapshotStore, blockResolver?: BlockResolver, allowRecovery?: boolean }} PatcherOptions
 */

/**
 * @typedef {Object} PatchSectionResult
 * @property {string} path
 * @property {string} canonicalPath
 * @property {"create" | "update" | "delete" | "noop"} op
 * @property {string} before
 * @property {string} after
 * @property {string} persisted
 * @property {string} written
 * @property {string} fileHash
 * @property {string} header
 * @property {number | undefined} firstChangedLine
 * @property {string[]} warnings
 * @property {string | undefined} moveDest
 * @property {BlockResolution[] | undefined} blockResolutions
 */

/**
 * @typedef {Object} PatcherApplyResult
 * @property {PatchSectionResult[]} sections
 */

/**
 * Opaque token returned by Patcher.prepare. Carries the section, the
 * raw file content read off disk, and the in-memory apply result.
 * Patcher.commit just writes the PreparedSection.applyResult.
 */
export class PreparedSection {
  constructor(
    section,
    canonicalPath,
    exists,
    rawContent,
    bom,
    lineEnding,
    normalized,
    applyResult,
    parseWarnings,
    fileOp,
  ) {
    this.section = section;
    this.canonicalPath = canonicalPath;
    this.exists = exists;
    this.rawContent = rawContent;
    this.bom = bom;
    this.lineEnding = lineEnding;
    this.normalized = normalized;
    this.applyResult = applyResult;
    this.parseWarnings = parseWarnings;
    this.fileOp = fileOp;
  }

  /** Convenience: returns true when the apply produced no change and no file op. */
  get isNoop() {
    return this.fileOp === undefined && this.applyResult.text === this.normalized;
  }
}

function hasAnchorScopedEdit(edits) {
  return edits.some((edit) => {
    if (edit.kind === 'delete') return true;
    // A `replace_block N:` edit anchors to concrete content on line N.
    if (edit.kind === 'block') return true;
    return edit.cursor.kind === 'before_anchor' || edit.cursor.kind === 'after_anchor';
  });
}

function assertSectionHashPresent(sectionPath, fileHash) {
  if (fileHash !== undefined) return;
  throw new Error(missingSnapshotTagMessage(sectionPath));
}

function recoveryToApplyResult(result) {
  return {
    text: result.text,
    firstChangedLine: result.firstChangedLine,
    warnings: result.warnings,
  };
}
function mergeWarnings(...sources) {
  const out = [];
  for (const source of sources) {
    if (!source) continue;
    for (const warning of source) out.push(warning);
  }
  return out;
}

function hasUtf8Bom(bytes) {
  return (
    bytes !== undefined &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  );
}

function assertUniqueCanonicalPaths(prepared) {
  const seen = new Map();
  for (const entry of prepared) {
    const previous = seen.get(entry.canonicalPath);
    if (previous !== undefined) {
      throw new Error(
        `Multiple hashline sections resolve to the same file (${previous} and ${entry.section.path}). Merge their ops under one header before applying.`,
      );
    }
    seen.set(entry.canonicalPath, entry.section.path);
  }
}

/**
 * High-level patcher. Wires a Filesystem and a required
 * SnapshotStore together with the parsing + applying core.
 *
 * Construct once per FS configuration; reuse across patches.
 */
export class Patcher {
  /**
   * @param {PatcherOptions} options
   */
  constructor(options) {
    if (!options.snapshots) {
      throw new Error(
        'Hashline Patcher requires a SnapshotStore; section tags are opaque store pointers.',
      );
    }
    this.fs = options.fs;
    this.snapshots = options.snapshots;
    this.recovery = new Recovery(options.snapshots);
    this.blockResolver = options.blockResolver;
    this.allowRecovery = options.allowRecovery !== false;
  }

  /**
   * Apply every section in `patch`. `prepare` runs the full apply for each
   * section in memory before any write hits the filesystem, so a
   * multi-section batch is naturally all-or-nothing. Returns one
   * PatchSectionResult per section in the original patch order.
   *
   * @param {Patch} patch
   * @returns {Promise<PatcherApplyResult>}
   */
  async apply(patch) {
    // Single-section fast path.
    if (patch.sections.length === 1) {
      const prepared = await this.prepare(patch.sections[0]);
      return { sections: [await this.commit(prepared)] };
    }

    // Prepare every section first so any failure (stale hash, missing
    // file, parse error, in-memory no-op) surfaces before any write.
    const prepared = [];
    for (const section of patch.sections) prepared.push(await this.prepare(section));
    assertUniqueCanonicalPaths(prepared);
    for (const entry of prepared) {
      if (entry.isNoop) {
        throw new Error(`Edits to ${entry.section.path} resulted in no changes being made.`);
      }
    }

    const results = [];
    for (let index = 0; index < prepared.length; index++) {
      try {
        results.push(await this.commit(prepared[index]));
      } catch (error) {
        // A mid-batch write failure leaves earlier sections on disk with no
        // rollback; report exactly which sections landed so the caller can
        // re-issue only the missing ones instead of double-applying.
        const written = prepared.slice(0, index).map((entry) => entry.section.path);
        const notWritten = prepared.slice(index + 1).map((entry) => entry.section.path);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to write ${prepared[index].section.path}: ${message}` +
            (written.length > 0 ? ` Sections already written: ${written.join(', ')}.` : '') +
            (notWritten.length > 0 ? ` Sections not written: ${notWritten.join(', ')}.` : ''),
          { cause: error },
        );
      }
    }
    return { sections: results };
  }

  /**
   * Run the preflight pass only: read, parse, validate, apply-in-memory.
   * No writes hit the filesystem. Use for CI checks and dry runs.
   *
   * @param {Patch} patch
   * @returns {Promise<void>}
   */
  async preflight(patch) {
    const prepared = [];
    for (const section of patch.sections) prepared.push(await this.prepare(section));
    assertUniqueCanonicalPaths(prepared);
    for (const entry of prepared) {
      if (entry.isNoop) {
        throw new Error(`Edits to ${entry.section.path} resulted in no changes being made.`);
      }
    }
  }

  /**
   * Read a section's target file, parse the section, validate the snapshot
   * tag (with recovery), and apply the edits in memory. Returns a
   * PreparedSection which can be fed to commit to land
   * the result on the filesystem.
   *
   * Throws on parse error, missing-file-for-anchored-edit, or unrecovered
   * tag mismatch (MismatchError).
   *
   * @param {PatchSection} section
   * @returns {Promise<PreparedSection>}
   */
  async prepare(section) {
    const parsed = section.parse();
    const parseWarnings = [...parsed.warnings];
    const fileOp = parsed.fileOp;
    assertSectionHashPresent(section.path, section.fileHash);

    let target = section;
    let canonicalPath = this.fs.canonicalPath(target.path);
    let read = await this.#tryRead(target.path);

    // Path recovery: the authored path doesn't exist on disk, but its
    // filename + snapshot tag may name a file the model read this session
    // (it supplied a bare filename, or the wrong directory). Rebind to that
    // file so the edit lands where the tag points, and warn. This runs
    // before the write gate so a recoverable bare/mis-typed path is rebound
    // to its real (writable) location instead of being rejected against the
    // literal — possibly read-only — path it was authored as.
    if (!read.exists) {
      const recovered = this.#recoverSectionPathFromTag(target, canonicalPath);
      if (recovered && this.fs.allowTagPathRecovery(target.path, recovered.section.path)) {
        parseWarnings.push(
          pathRecoveredFromTagMessage(target.path, recovered.section.path, target.fileHash),
        );
        target = recovered.section;
        canonicalPath = recovered.canonicalPath;
        read = await this.#tryRead(target.path);
      }
    }

    // Gate the final (possibly recovered) target before any write work, so
    // an unrecoverable read-only target (e.g. a plan-mode working-tree path)
    // fails with the write guard rather than a misleading "file not found".
    await this.fs.preflightWrite(target.path, { fileOp });

    if (!read.exists) {
      throw new Error(`File not found: ${target.path}. Use the write tool to create new files.`);
    }

    if (fileOp?.kind === 'move' && this.fs.canonicalPath(fileOp.dest) === canonicalPath) {
      throw new Error(`MV destination is the same as ${target.path}.`);
    }

    const { bom: bomFromText, text } = stripBom(read.rawContent);
    const bom = bomFromText || (await this.#readBinaryBom(target.path));
    const lineEnding = detectLineEnding(text);
    const normalized = normalizeToLF(text);

    const applyResult =
      fileOp?.kind === 'rem'
        ? this.#applyWithRecovery({
            section: target,
            canonicalPath,
            exists: read.exists,
            normalized,
            edits: [],
          })
        : this.#applyWithRecovery({
            section: target,
            canonicalPath,
            exists: read.exists,
            normalized,
            edits: parsed.edits,
          });

    return new PreparedSection(
      target,
      canonicalPath,
      read.exists,
      read.rawContent,
      bom,
      lineEnding,
      normalized,
      applyResult,
      parseWarnings,
      fileOp,
    );
  }

  /**
   * Resolve a missing authored path to a file read this session by matching
   * its filename and snapshot tag. Returns the section rebound to that file's
   * canonical path, or `null` when no unique filename+tag match exists.
   *
   * Resolution requires BOTH the bare filename (basename) and the section tag
   * to match a single retained file: a whole-file content hash plus an exact
   * filename is a strong identity signal, so the model almost certainly meant
   * that file but gave the wrong directory (or only the filename). A tie — two
   * retained files sharing the filename and tag — declines recovery. The
   * recorded path of the authored file itself is excluded so a deleted file
   * does not "recover" onto its own stale snapshot.
   */
  #recoverSectionPathFromTag(section, originalCanonicalPath) {
    if (section.fileHash === undefined) return null;
    const authoredName = path.basename(section.path);
    const candidates = [
      ...new Set(
        this.snapshots
          .findByHash(section.fileHash)
          .filter((snapshot) => path.basename(snapshot.path) === authoredName)
          .map((snapshot) => snapshot.path),
      ),
    ].filter((candidate) => this.fs.canonicalPath(candidate) !== originalCanonicalPath);
    if (candidates.length !== 1) return null;
    const resolved = candidates[0];
    return { section: section.withPath(resolved), canonicalPath: this.fs.canonicalPath(resolved) };
  }

  /**
   * Commit a previously prepare'd section to the filesystem.
   * Restores line endings and BOM, writes via the Filesystem, and
   * records a fresh snapshot in the SnapshotStore keyed by the
   * filesystem-canonical path.
   *
   * @param {PreparedSection} prepared
   * @returns {Promise<PatchSectionResult>}
   */
  async commit(prepared) {
    const {
      section,
      normalized,
      bom,
      lineEnding,
      parseWarnings,
      exists,
      applyResult,
      canonicalPath,
      fileOp,
    } = prepared;
    const after = applyResult.text;
    const warnings = mergeWarnings(parseWarnings, applyResult.warnings);
    const moveDest = fileOp?.kind === 'move' ? fileOp.dest : undefined;
    const resultPath = moveDest ?? section.path;

    if (fileOp?.kind === 'rem') {
      await this.fs.delete(section.path);
      this.snapshots.invalidate(canonicalPath);
      return {
        path: section.path,
        canonicalPath,
        op: 'delete',
        before: normalized,
        after: normalized,
        persisted: prepared.rawContent,
        written: prepared.rawContent,
        fileHash: computeFileHash(normalized),
        header: formatHashlineHeader(section.path, computeFileHash(normalized)),
        warnings,
      };
    }

    if (after === normalized && moveDest === undefined) {
      const hash = this.#recordFullSnapshot(canonicalPath, normalized);
      return {
        path: section.path,
        canonicalPath,
        op: 'noop',
        before: normalized,
        after: normalized,
        persisted: prepared.rawContent,
        written: prepared.rawContent,
        fileHash: hash,
        header: formatHashlineHeader(section.path, hash),
        warnings,
      };
    }

    const persisted = bom + restoreLineEndings(after, lineEnding);

    if (moveDest !== undefined) {
      const destCanonical = this.fs.canonicalPath(moveDest);
      this.snapshots.relocate(canonicalPath, destCanonical);
      await this.fs.move(section.path, moveDest, persisted);
      const fileHash = this.#recordFullSnapshot(destCanonical, after);
      return {
        path: resultPath,
        canonicalPath: destCanonical,
        op: 'update',
        before: normalized,
        after,
        persisted,
        written: persisted,
        fileHash,
        header: formatHashlineHeader(moveDest, fileHash),
        firstChangedLine: applyResult.firstChangedLine,
        blockResolutions: applyResult.blockResolutions,
        moveDest,
        warnings,
      };
    }

    const write = await this.fs.writeText(section.path, persisted);
    const fileHash = this.#recordFullSnapshot(canonicalPath, after);
    const op = exists ? 'update' : 'create';

    return {
      path: section.path,
      canonicalPath,
      op,
      before: normalized,
      after,
      persisted,
      written: write.text,
      fileHash,
      header: formatHashlineHeader(section.path, fileHash),
      firstChangedLine: applyResult.firstChangedLine,
      blockResolutions: applyResult.blockResolutions,
      warnings,
    };
  }

  async #readBinaryBom(path) {
    if (!this.fs.readBinary) return '';
    const bytes = await this.fs.readBinary(path);
    return hasUtf8Bom(bytes) ? '\uFEFF' : '';
  }

  async #tryRead(path) {
    try {
      const content = await this.fs.readText(path);
      return { exists: true, rawContent: content };
    } catch (error) {
      if (isNotFound(error)) return { exists: false, rawContent: '' };
      throw error;
    }
  }

  #recordFullSnapshot(canonicalPath, normalized) {
    return this.snapshots.record(canonicalPath, normalized);
  }

  /**
   * Reject an anchored edit that references a line the read which minted
   * `expected` never displayed. `matchedSnapshot` is the store version whose
   * text equals the live normalized content — the exact snapshot the model
   * anchored against. Absent means no provenance was recorded (the tag was
   * externally minted or aged out), so the edit applies as before. Only runs
   * on the no-drift path, where anchor line numbers index the tagged content
   * 1:1.
   *
   * The rejection inlines the actual file content at the unseen anchor lines
   * (from `matchedSnapshot.text`, which by definition equals the live
   * normalized content) so the model can verify what it was about to touch.
   * When the reveal covers EVERY unseen anchor line in full width
   * (`truncated === false`) those lines also merge into the snapshot's
   * seen-line set, so a straight retry with the same `[path#tag]` header
   * succeeds without a follow-up range read — the content the model
   * received in the error IS proof it has now seen those lines. When the
   * anchor range exceeds SEEN_LINE_REVEAL_CAP lines OR any
   * revealed line exceeds SEEN_LINE_REVEAL_MAX_COLUMNS characters
   * (`truncated === true`), NO lines merge: the message keeps the
   * range-re-read guidance intact and the model cannot piecewise-reveal
   * its way past the guard across multiple retries
   * (over-cap retry → tail reveal → next retry applies), nor coax the tool
   * into dumping a minified megabyte-wide line into the error preview.
   */
  #assertSeenLines(section, expected, matchedSnapshot) {
    const seen = matchedSnapshot?.seenLines;
    if (!seen || seen.size === 0) return;
    const unseen = section.collectAnchorLines().filter((line) => !seen.has(line));
    if (unseen.length === 0) return;
    const sourceLines = matchedSnapshot?.text.split('\n') ?? [];
    const revealed = [];
    const revealCount = Math.min(unseen.length, SEEN_LINE_REVEAL_CAP);
    let columnTruncated = false;
    for (let i = 0; i < revealCount; i++) {
      const line = unseen[i];
      // Out-of-range anchors are caught by parse/apply with a better
      // message; skip them here so they never join the revealed set.
      if (line < 1 || line > sourceLines.length) continue;
      const source = sourceLines[line - 1] ?? '';
      if (source.length > SEEN_LINE_REVEAL_MAX_COLUMNS) {
        revealed.push(new RevealedLine(line, `${source.slice(0, SEEN_LINE_REVEAL_MAX_COLUMNS)}…`));
        columnTruncated = true;
      } else {
        revealed.push(new RevealedLine(line, source));
      }
    }
    const truncated = unseen.length > revealed.length || columnTruncated;
    // Only merge when the reveal covered every unseen anchor line in full
    // width. A prefix-truncated reveal would let the model split a blind
    // edit into <=cap-line retries and land it without ever running the
    // required range re-read; a column-clipped reveal would leave part of
    // each line unseen while the model receives an "ok to retry" signal.
    if (!truncated) {
      for (const { line } of revealed) seen.add(line);
    }
    throw new Error(
      unseenLinesMessage(section.path, unseen, expected, { lines: revealed, truncated }),
    );
  }

  #mismatchError(section, canonicalPath, normalized, expected, hashRecognized) {
    const actualFileHash = this.#recordFullSnapshot(canonicalPath, normalized);
    return new MismatchError({
      path: section.path,
      expectedFileHash: expected,
      actualFileHash,
      fileLines: normalized.split('\n'),
      anchorLines: section.collectAnchorLines(),
      hashRecognized,
    });
  }

  #applyWithRecovery(args) {
    const { section, canonicalPath, exists, normalized, edits } = args;
    const expected = exists ? section.fileHash : undefined;
    // The 64-hex SHA-256 tag is content-derived: when the live text hashes to
    // it, trust the match and apply directly. `storedSnapshotForTag` feeds the
    // drift paths below (block resolution, 3-way recovery).
    const storedSnapshotForTag =
      expected === undefined ? null : this.snapshots.byHash(canonicalPath, expected);
    const liveMatches = expected !== undefined && computeFileHash(normalized) === expected;
    const matchedSnapshot = liveMatches
      ? this.snapshots.byContent(canonicalPath, normalized)
      : null;

    // Resolve `replace_block N:` edits to concrete ranges before recovery
    // runs. Block anchors are expressed against the snapshot the section tag
    // names, so resolve against that exact text:
    //   - live content matches the tag (or there is no tag) → resolve against
    //     the live, normalized content;
    //   - the file drifted → resolve against the tagged snapshot's text so the
    //     resulting ranges flow through the 3-way-merge recovery below.
    // When a block edit needs the tagged snapshot but it is unavailable, the
    // range cannot be placed safely — reject with a MismatchError (re-read).
    const blockResolutions = [];
    const resolveWarnings = [];
    let resolved = edits;
    if (hasBlockEdit(edits)) {
      const baseText =
        expected === undefined || liveMatches ? normalized : storedSnapshotForTag?.text;
      if (baseText === undefined) {
        throw this.#mismatchError(section, canonicalPath, normalized, expected ?? '', false);
      }
      resolved = resolveBlockEdits(edits, baseText, section.path, this.blockResolver, {
        onUnresolved: 'throw',
        onResolved: (resolution) => blockResolutions.push(resolution),
        onWarning: (warning) => resolveWarnings.push(warning),
      });
    }
    const withResolveWarnings = (result) =>
      resolveWarnings.length === 0
        ? result
        : { ...result, warnings: [...resolveWarnings, ...(result.warnings ?? [])] };

    // No tag, or the tag still names the live content: an edit anchored at any
    // line is safe to apply, and the resolved block spans line up with what
    // the caller read, so echo them back. (A drifted file falls through to
    // recovery below, where line numbers shift, so resolutions are dropped.)
    if (expected === undefined || liveMatches) {
      // The line numbers in `edits` index the exact content the tag names.
      // Reject any anchor the read never displayed: editing lines the model
      // has not seen is the off-by-memory mistake that mangles files.
      if (expected !== undefined) this.#assertSeenLines(section, expected, matchedSnapshot);
      const result = applyEdits(normalized, resolved);
      return withResolveWarnings(
        blockResolutions.length > 0 ? { ...result, blockResolutions } : result,
      );
    }
    // Head/tail-only inserts are position-stable: "start"/"end" cannot move
    // with content drift, so a stale tag is non-fatal. Apply onto the live
    // content and warn instead of hard-failing — unlike an anchored
    // mismatch, which cannot be safely relocated and must reject.
    if (!hasAnchorScopedEdit(resolved)) {
      const result = applyEdits(normalized, resolved);
      return withResolveWarnings({
        ...result,
        warnings: [HEADTAIL_DRIFT_WARNING, ...(result.warnings ?? [])],
      });
    }
    if (!this.allowRecovery) {
      throw this.#mismatchError(
        section,
        canonicalPath,
        normalized,
        expected,
        storedSnapshotForTag !== null,
      );
    }
    // File drifted: try to replay the edit against the version the tag
    // names and 3-way-merge it onto the live content.
    const recovered = this.recovery.tryRecover({
      path: canonicalPath,
      currentText: normalized,
      fileHash: expected,
      edits: resolved,
    });
    if (recovered) return withResolveWarnings(recoveryToApplyResult(recovered));
    const hashRecognized = this.snapshots.byHash(canonicalPath, expected) !== null;
    throw this.#mismatchError(section, canonicalPath, normalized, expected, hashRecognized);
  }
}
