import {
  computeFileHash,
  normalizeText,
  OP_DEL,
  OP_INS_BLK_POST,
  OP_INS_HEAD,
  OP_INS_POST,
  OP_INS_PRE,
  OP_INS_TAIL,
  OP_SWAP,
  OP_SWAP_BLK,
  OP_DEL_BLK,
  OP_NOP,
  OP_ABORT,
  sha256Hex,
} from './format.js';
import { applyEdits } from './apply.js';
import { resolveBlockEdits } from './block.js';
import { conflictFromError, createDiff3Conflict as _createDiff3Conflict } from './conflicts.js';
import { Patch as CorePatch } from './input.js';
import { Patcher as CorePatcher } from './patcher.js';
import { checkHashlineFilePolicy } from './policy.js';
import { InMemoryFilesystem, RootedNodeFilesystem } from './fs.js';
import { InMemorySnapshotStore } from './snapshots.js';

export { conflictFromError };

export {
  OP_ABORT,
  OP_DEL,
  OP_DEL_BLK,
  OP_INS_BLK_POST,
  OP_INS_HEAD,
  OP_INS_POST,
  OP_INS_PRE,
  OP_INS_TAIL,
  OP_NOP,
  OP_SWAP,
  OP_SWAP_BLK,
};

export const hashContent = (content) => sha256Hex(String(content ?? ''));
export const computeTag = (text) => computeFileHash(text);
export { normalizeText, InMemorySnapshotStore };

export class PatchParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchParseError';
  }
}

export class PatchApplyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PatchApplyError';
    Object.assign(this, details);
  }
}

export class Section {
  constructor(path, tag, hunks = []) {
    this.path = path;
    this.tag = tag;
    this.fileHash = tag;
    this.hunks = hunks;
  }
}

export class Patch {
  constructor(sections = []) {
    this.sections = sections;
  }

  static parse(text) {
    return parsePatch(text);
  }

  serialize() {
    return serializePatch(this);
  }
}

export class MemoryFilesystem extends InMemoryFilesystem {}

export class DiskFilesystem extends RootedNodeFilesystem {}

function hunkHeader(hunk) {
  switch (hunk.op) {
    case OP_SWAP:
      return `SWAP ${hunk.start}.=${hunk.end}:`;
    case OP_DEL:
      return `DEL ${hunk.start}.=${hunk.end}`;
    case OP_INS_PRE:
      return `INS.PRE ${hunk.start}=`;
    case OP_INS_POST:
      return `INS.POST ${hunk.start}=`;
    case OP_INS_HEAD:
      return 'INS.HEAD:';
    case OP_INS_TAIL:
      return 'INS.TAIL:';
    case OP_INS_BLK_POST:
      return `INS.BLK.POST ${hunk.start}:`;
    case OP_SWAP_BLK:
      return `SWAP.BLK ${hunk.start}:`;
    case OP_DEL_BLK:
      return `DEL.BLK ${hunk.start}`;
    case OP_ABORT:
      return 'ABORT';
    default:
      throw new PatchApplyError(`unknown op: ${hunk.op}`);
  }
}

export function serializePatch(patch) {
  return (patch.sections ?? [])
    .map((section) => {
      if (section.diff !== undefined) {
        const tag = section.fileHash ?? section.tag;
        return `[${section.path}${tag ? `#${tag}` : ''}]\n${section.diff}`.trimEnd();
      }
      const lines = [`[${section.path}#${section.tag ?? section.fileHash ?? ''}]`];
      for (const hunk of section.hunks ?? []) {
        if (hunk.op === OP_NOP) continue;
        lines.push(hunkHeader(hunk));
        for (const line of hunk.lines ?? []) lines.push(`+${line}`);
      }
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n');
}

export function parsePatch(text) {
  const str = String(text ?? '').trim();
  if (str.length === 0) return new Patch([]);

  // Parse the top-level structure (section headers + diff bodies) first.
  // Structural errors (bad first line, conflicting tags) surface here with
  // their own messages and don't carry per-section line info.
  let core;
  try {
    core = CorePatch.parse(String(text));
  } catch (error) {
    if (error instanceof PatchParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('input must begin with')) {
      throw new StructuredParseError(message, {
        code: HashlineErrorCode.PARSE_NO_SECTION_OPEN,
        srcLine: 1,
      });
    }
    throw new PatchParseError(message);
  }

  // Parse each section's diff body individually. The parser reports errors
  // as `line N:` where N is relative to that section's diff body, so we must
  // use the failing section's own `_lineOffset` — not the first section's —
  // to map back to the correct global source line.
  const sections = [];
  for (const section of core.sections) {
    try {
      sections.push(new Section(section.path, section.fileHash ?? '', section.toHunks()));
    } catch (sectionError) {
      if (sectionError instanceof PatchParseError) throw sectionError;
      const message = sectionError instanceof Error ? sectionError.message : String(sectionError);
      const lineMatch = /^line\s+(\d+):/.exec(message);
      if (lineMatch) {
        let code = HashlineErrorCode.PARSE_UNEXPECTED_TOKEN;
        if (message.includes('payload line has no preceding hunk header')) {
          const gotMatch = /Got "([^"]+)"/.exec(message);
          if (gotMatch && gotMatch[1].startsWith('+')) {
            code = HashlineErrorCode.PARSE_CONTENT_WITHOUT_OP;
          }
        }
        const srcLine = Number(lineMatch[1]) + section._lineOffset + 1;
        throw new StructuredParseError(message, {
          code,
          srcLine,
        });
      }
      throw new PatchParseError(message);
    }
  }
  return new Patch(sections);
}

function toCorePatch(patch, options = {}) {
  if (typeof patch === 'string') return CorePatch.parse(patch, options);
  if (patch instanceof CorePatch) return patch;
  if (patch instanceof Patch || Array.isArray(patch?.sections)) {
    return CorePatch.parse(serializePatch(patch), options);
  }
  throw new PatchParseError('Expected a hashline patch string or Patch object.');
}

function hunkToEdits(hunks) {
  const edits = [];
  let index = 0;
  for (const hunk of hunks) {
    const lineNum = hunk.srcLine ?? 0;
    if (hunk.op === OP_SWAP) {
      for (const line of hunk.lines ?? []) {
        edits.push({
          kind: 'insert',
          cursor: { kind: 'before_anchor', anchor: { line: hunk.start } },
          text: line,
          lineNum,
          index: index++,
          mode: 'replacement',
        });
      }
      for (let line = hunk.start; line <= hunk.end; line++) {
        edits.push({ kind: 'delete', anchor: { line }, lineNum, index: index++ });
      }
    } else if (hunk.op === OP_DEL) {
      for (let line = hunk.start; line <= hunk.end; line++) {
        edits.push({ kind: 'delete', anchor: { line }, lineNum, index: index++ });
      }
    } else if (hunk.op === OP_INS_PRE || hunk.op === OP_INS_POST) {
      const cursor =
        hunk.op === OP_INS_PRE
          ? { kind: 'before_anchor', anchor: { line: hunk.start } }
          : { kind: 'after_anchor', anchor: { line: hunk.start } };
      for (const line of hunk.lines ?? []) {
        edits.push({ kind: 'insert', cursor, text: line, lineNum, index: index++ });
      }
    } else if (hunk.op === OP_INS_HEAD || hunk.op === OP_INS_TAIL) {
      const cursor = { kind: hunk.op === OP_INS_HEAD ? 'bof' : 'eof' };
      for (const line of hunk.lines ?? []) {
        edits.push({ kind: 'insert', cursor, text: line, lineNum, index: index++ });
      }
    } else if (hunk.op === OP_SWAP_BLK) {
      edits.push({
        kind: 'block',
        mode: 'replace',
        anchor: { line: hunk.start },
        payloads: hunk.lines ?? [],
        lineNum,
        index: index++,
      });
    } else if (hunk.op === OP_DEL_BLK) {
      edits.push({
        kind: 'block',
        mode: 'delete',
        anchor: { line: hunk.start },
        payloads: [],
        lineNum,
        index: index++,
      });
    } else if (hunk.op === OP_INS_BLK_POST) {
      edits.push({
        kind: 'block',
        mode: 'insert_after',
        anchor: { line: hunk.start },
        payloads: hunk.lines ?? [],
        lineNum,
        index: index++,
      });
    } else if (hunk.op !== OP_NOP && hunk.op !== OP_ABORT) {
      throw new PatchApplyError(`unknown op: ${hunk.op}`);
    }
  }
  return edits;
}

function findBlankLineBlockRange(text, anchorLine) {
  const lines = String(text).split('\n');
  const lineIdx = anchorLine - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  if (lines[lineIdx].trim() === '') return null;

  let start = lineIdx;
  while (start > 0 && lines[start - 1].trim() !== '') start--;

  let end = lineIdx;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;

  return { start: start + 1, end: end + 1 };
}

function blankLineBlockResolver({ text, line }) {
  return findBlankLineBlockRange(text, line);
}

export function applyHunksToText(text, hunks) {
  try {
    assertHunksNonOverlapping(hunks);
    const edits = hunkToEdits(hunks);
    const resolvedEdits = resolveBlockEdits(edits, String(text ?? ''), '', blankLineBlockResolver);
    return applyEdits(String(text ?? ''), resolvedEdits).text;
  } catch (error) {
    throw new PatchApplyError(error instanceof Error ? error.message : String(error));
  }
}

function assertHunksNonOverlapping(hunks) {
  const ranges = [];
  for (const hunk of hunks ?? []) {
    if ([OP_NOP, OP_ABORT, OP_INS_HEAD, OP_INS_TAIL].includes(hunk.op)) continue;
    if (hunk.op === OP_INS_PRE) ranges.push({ start: hunk.start, end: hunk.start - 1 });
    else if (hunk.op === OP_INS_POST) ranges.push({ start: hunk.start + 1, end: hunk.start });
    else ranges.push({ start: hunk.start, end: hunk.end });
  }
  const sorted = ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.end >= prev.start && cur.end >= cur.start && cur.start <= prev.end) {
      throw new PatchApplyError(
        `overlapping hunks: previous covers up to line ${prev.end}, next starts at ${cur.start}`,
      );
    }
  }
}

const UNIFIED_DIFF_PREFIXES = ['@@', '---', '+++', 'diff ', 'diff --git'];

function detectUnifiedDiff(text) {
  const firstLine = String(text).split('\n')[0]?.trim() ?? '';
  return UNIFIED_DIFF_PREFIXES.some((prefix) => firstLine.startsWith(prefix));
}

export function parsePatchExtended(text) {
  const str = String(text);
  // Detect unified diff format and throw structured error
  if (detectUnifiedDiff(str)) {
    throw new StructuredParseError('Input appears to be a unified diff, not a hashline patch', {
      code: HashlineErrorCode.PARSE_UNEXPECTED_TOKEN,
      srcLine: 1,
    });
  }
  // Normalize INS.HEAD / INS.TAIL shorthand
  return parsePatch(
    str
      .replace(/^INS\.HEAD\s+\d+\s*[=:]?/gm, 'INS.HEAD:')
      .replace(/^INS\.TAIL\s+\d+\s*[=:]?/gm, 'INS.TAIL:'),
  );
}
export const applyHunksToTextExtended = applyHunksToText;

export class HashlineBridge {
  constructor(store, analyzer = null) {
    this.store = store;
    this.analyzer = analyzer;
  }

  recordApply(path, originalText, newText, oldTag, newTag) {
    if (!this.store) return;
    try {
      const oldBlob = this.store.storeBlob(originalText);
      this.store.setRef(`hashline:${path}:${oldTag}`, oldBlob);
      const newBlob = this.store.storeBlob(newText);
      this.store.setRef(`hashline:${path}:${newTag}`, newBlob);
      this.store.setRef(`file:${path}`, newBlob);
      this.analyzer?.analyzeFile?.(path, newText);
    } catch {
      // Bridge failures must never hide the filesystem result.
    }
  }
}

function mapPreflightSuccess(section, prepared) {
  return {
    path: section.path,
    tag: section.fileHash,
    ok: true,
    recoverable: false,
    error: null,
    currentText: prepared.normalized,
    currentTag: computeTag(prepared.normalized),
    matchStale: false,
  };
}

function mapSectionResult(result, sourceSection, bridge) {
  const beforeHash = computeTag(result.before);
  const afterHash = computeTag(result.after);
  const oldTag = sourceSection.fileHash ?? beforeHash;
  bridge?.recordApply?.(result.path, result.before, result.after, oldTag, result.fileHash);
  return {
    path: result.path,
    tag: oldTag,
    applied: result.op !== 'noop',
    recovered: (result.warnings ?? []).some((warning) => /recover|drift/i.test(warning)),
    newTag: result.fileHash,
    beforeHash,
    afterHash,
    hunksApplied: result.op === 'noop' ? 0 : sourceSection.toHunks().length,
    warnings: (result.warnings ?? []).map((warning) => warning.replace(/^Recovered/, 'recovered')),
    conflicts: [],
    firstChangedLine: result.firstChangedLine,
  };
}

export class Patcher {
  constructor(options = {}) {
    this.fs = options.fs ?? new MemoryFilesystem();
    this.snapshots = options.snapshots ?? new InMemorySnapshotStore();
    this.bridge = options.bridge ?? null;
    this.maxFileSize = options.maxFileSize ?? 1_048_576;
    this.autoRecord = options.autoRecord !== false;
    this.allowRecovery = options.allowRecovery !== false;
    this._lastConflicts = [];
    this._core = new CorePatcher({
      fs: this.fs,
      snapshots: this.snapshots,
      blockResolver: options.blockResolver,
      allowRecovery: this.allowRecovery,
    });
  }

  async preflight(patch) {
    const parsed = toCorePatch(patch);
    const preflight = [];
    for (const section of parsed.sections) {
      try {
        const policyError = await checkHashlineFilePolicy(this.fs, section.path, {
          maxFileSize: this.maxFileSize,
        });
        if (policyError) {
          preflight.push({
            path: section.path,
            tag: section.fileHash,
            ok: false,
            recoverable: false,
            error: policyError,
            policyBlocked: true,
            currentText: null,
            currentTag: null,
            matchStale: false,
          });
          continue;
        }
        const prepared = await this._core.prepare(section);
        preflight.push(mapPreflightSuccess(section, prepared));
      } catch (error) {
        const message = normalizeErrorMessage(error);
        preflight.push({
          path: section.path,
          tag: section.fileHash,
          ok: false,
          recoverable: /mismatch|stale|hash|recover/i.test(message),
          error: message.replace('does not exist', 'out of range: line does not exist'),
          currentText: null,
          currentTag: null,
          matchStale: /mismatch|stale|hash/i.test(message),
        });
      }
    }
    return { patch: parsed, preflight };
  }

  async apply(patch) {
    try {
      const parsed = toCorePatch(patch);
      for (const section of parsed.sections) {
        const policyError = await checkHashlineFilePolicy(this.fs, section.path, {
          maxFileSize: this.maxFileSize,
        });
        if (policyError) {
          return {
            ok: false,
            sections: [],
            error: policyError,
            policyBlocked: true,
          };
        }
      }
      const result = await this._core.apply(parsed);
      const sections = result.sections.map((section, index) =>
        mapSectionResult(section, parsed.sections[index], this.bridge),
      );
      this._lastConflicts = sections.flatMap((section) => section.conflicts ?? []);

      // autoRecord: update snapshots with post-edit content
      if (!this.autoRecord) {
        // CorePatcher already records snapshots; if autoRecord is false,
        // we need to invalidate the post-edit snapshot to keep head at pre-edit state.
        for (const section of result.sections) {
          if (section.op !== 'noop' && section.op !== 'delete') {
            // Re-record the pre-edit content to keep snapshot at old state
            this.snapshots.record(section.canonicalPath, section.before);
          }
        }
      }

      return { ok: true, sections };
    } catch (error) {
      const message = normalizeErrorMessage(error);
      this._lastConflicts = [conflictFromError(error, message)];
      return { ok: false, sections: [], error: message, conflicts: this._lastConflicts };
    }
  }

  getLastConflicts() {
    return this._lastConflicts;
  }

  /**
   * Validate a hunk's line range against a file's line count.
   * Returns an error string or null if valid.
   */
  _checkRange(hunk, lineCount) {
    if (!hunk || !hunk.op) return 'invalid hunk';
    if ([OP_NOP, OP_ABORT, OP_INS_HEAD, OP_INS_TAIL].includes(hunk.op)) return null;
    if (hunk.start < 1) return `start line ${hunk.start} is before 1`;
    if (hunk.end < hunk.start) return `end line ${hunk.end} is before start ${hunk.start}`;
    // INS.PRE at lineCount+1 is valid (append mode)
    if (hunk.op === OP_INS_PRE) {
      if (hunk.start > lineCount + 1)
        return `start line ${hunk.start} out of range (max ${lineCount + 1})`;
      return null;
    }
    // INS.POST at lineCount+1 is invalid
    if (hunk.op === OP_INS_POST) {
      if (hunk.start > lineCount) return `start line ${hunk.start} out of range (max ${lineCount})`;
      return null;
    }
    // SWAP / DEL: end must be within file
    if (hunk.end > lineCount) return `end out of range: ${hunk.end} > ${lineCount}`;
    return null;
  }

  /**
   * Score how well a candidate line matches a fingerprint.
   * - Exact match: 1.0
   * - Candidate starts with fingerprint: 0.8
   * - Fingerprint is substring of candidate: 0.6
   * - No match: 0
   */
  _contentMatchScore(fingerprint, candidate, _contextLines = []) {
    if (!fingerprint || !candidate) return 0;
    if (candidate === fingerprint) return 1.0;
    if (candidate.startsWith(fingerprint)) return 0.8;
    if (candidate.includes(fingerprint)) return 0.6;
    // Check if fingerprint includes candidate (reverse direction)
    if (fingerprint.startsWith(candidate) && candidate.length > 5) return 0.4;
    return 0;
  }
}

export function createDiff3Conflict(options = {}) {
  return {
    type: 'conflict',
    path: options.path ?? '',
    baseRange: options.baseRange ?? [0, 0],
    currentRange: options.currentRange ?? [0, 0],
    patchRange: options.patchRange ?? [0, 0],
    baseText: options.baseText ?? '',
    currentText: options.currentText ?? '',
    patchText: options.patchText ?? '',
    reason: options.reason ?? 'overlapping_change',
  };
}

export function createPatcher(options = {}) {
  return new Patcher({
    fs: options.fs ?? new MemoryFilesystem(),
    snapshots: options.snapshots ?? new InMemorySnapshotStore(),
    bridge: options.bridge ?? null,
    maxFileSize: options.maxFileSize,
    allowRecovery: options.allowRecovery,
    autoRecord: options.autoRecord,
    blockResolver: options.blockResolver,
  });
}

export const HashlineErrorCode = {
  PARSE_UNEXPECTED_TOKEN: 'PARSE_UNEXPECTED_TOKEN',
  PARSE_NO_SECTION_OPEN: 'PARSE_NO_SECTION_OPEN',
  PARSE_INVALID_SECTION_HEADER: 'PARSE_INVALID_SECTION_HEADER',
  PARSE_CONTENT_WITHOUT_OP: 'PARSE_CONTENT_WITHOUT_OP',
  APPLY_STALE_TAG: 'APPLY_STALE_TAG',
  APPLY_FILE_NOT_FOUND: 'APPLY_FILE_NOT_FOUND',
  APPLY_RANGE_OUT_OF_BOUNDS: 'APPLY_RANGE_OUT_OF_BOUNDS',
  APPLY_WRITE_FAILED: 'APPLY_WRITE_FAILED',
  CONFLICT_CONTENT_DIVERGED: 'CONFLICT_CONTENT_DIVERGED',
  CONFLICT_MOVED_BLOCK: 'CONFLICT_MOVED_BLOCK',
  CONFLICT_DELETED_ANCHOR: 'CONFLICT_DELETED_ANCHOR',
  POLICY_PATH_ESCAPE: 'POLICY_PATH_ESCAPE',
  POLICY_BINARY_FILE: 'POLICY_BINARY_FILE',
  POLICY_GENERATED_FILE: 'POLICY_GENERATED_FILE',
  POLICY_LOCKFILE_READONLY: 'POLICY_LOCKFILE_READONLY',
  POLICY_FILE_TOO_LARGE: 'POLICY_FILE_TOO_LARGE',
};

export const HashlineErrorSeverity = {
  PARSE_UNEXPECTED_TOKEN: 'FATAL',
  PARSE_NO_SECTION_OPEN: 'FATAL',
  PARSE_INVALID_SECTION_HEADER: 'FATAL',
  PARSE_CONTENT_WITHOUT_OP: 'FATAL',
  APPLY_STALE_TAG: 'ERROR',
  APPLY_FILE_NOT_FOUND: 'ERROR',
  APPLY_RANGE_OUT_OF_BOUNDS: 'ERROR',
  APPLY_WRITE_FAILED: 'ERROR',
  CONFLICT_CONTENT_DIVERGED: 'WARNING',
  CONFLICT_MOVED_BLOCK: 'WARNING',
  CONFLICT_DELETED_ANCHOR: 'WARNING',
  POLICY_PATH_ESCAPE: 'FATAL',
  POLICY_BINARY_FILE: 'FATAL',
  POLICY_GENERATED_FILE: 'FATAL',
  POLICY_LOCKFILE_READONLY: 'FATAL',
  POLICY_FILE_TOO_LARGE: 'FATAL',
};

export const errorSeverity = (code) => HashlineErrorSeverity[code] ?? 'ERROR';

export const formatHashlineError = (code, message, sourceSpan = null, context = null) => {
  const span = sourceSpan
    ? sourceSpan.srcLine !== undefined
      ? {
          line: sourceSpan.srcLine,
          column: sourceSpan.column ?? null,
          span: sourceSpan.span ?? null,
        }
      : sourceSpan
    : undefined;
  return {
    code,
    severity: errorSeverity(code),
    message,
    sourceSpan: span,
    context: context ?? undefined,
  };
};

export class StructuredParseError extends PatchParseError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredParseError';
    this.code = details.code ?? null;
    this.srcLine = details.srcLine ?? null;
    Object.assign(this, details);
  }
}

export class StructuredApplyError extends PatchApplyError {
  constructor(message, details = null) {
    super(message, details || {});
    this.name = 'StructuredApplyError';
    this.path = details?.path ?? null;
    this.code = details?.code ?? null;
    this.conflict = details?.conflict ?? null;
  }
}

// ── Diff3MergeEngine: enhanced with fuzzy matching internals ──────────────

/**
 * Levenshtein edit distance between two strings.
 * Used by _computeEditMapping for fuzzy line matching.
 */
function _editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Find a line in `lines` that matches `target` content.
 * Tries exact match first, then trimmed match (for lines > 10 chars).
 * Returns 1-indexed line number, or -1 if not found.
 */
function _findLineByContent(lines, target) {
  if (target == null) return -1;
  // Exact match
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === target) return i + 1;
  }
  // Trimmed match (only for longer lines to avoid false positives)
  const trimmedTarget = String(target).trim();
  if (trimmedTarget.length > 10) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === trimmedTarget) return i + 1;
    }
  }
  return -1;
}

/**
 * Compute a mapping from base line indices to current line indices
 * using edit distance for fuzzy matching.
 * Returns an object { [baseIndex]: curIndex | undefined }.
 */
function _computeEditMapping(baseLines, curLines) {
  const mapping = {};
  // First pass: exact matches
  const curUsed = new Set();
  for (let i = 0; i < baseLines.length; i++) {
    for (let j = 0; j < curLines.length; j++) {
      if (curUsed.has(j)) continue;
      if (baseLines[i] === curLines[j]) {
        mapping[i] = j;
        curUsed.add(j);
        break;
      }
    }
  }
  // Second pass: fuzzy matches for unmatched lines
  const FUZZY_THRESHOLD = 0.3;
  for (let i = 0; i < baseLines.length; i++) {
    if (mapping[i] !== undefined) continue;
    const baseTrimmed = baseLines[i].trim();
    if (baseTrimmed.length < 5) continue;
    let bestDist = Infinity;
    let bestJ = -1;
    for (let j = 0; j < curLines.length; j++) {
      if (curUsed.has(j)) continue;
      const curTrimmed = curLines[j].trim();
      if (curTrimmed.length < 5) continue;
      const maxLen = Math.max(baseTrimmed.length, curTrimmed.length);
      if (maxLen === 0) continue;
      const dist = _editDistance(baseTrimmed, curTrimmed);
      const ratio = dist / maxLen;
      if (ratio < FUZZY_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      mapping[i] = bestJ;
      curUsed.add(bestJ);
    }
  }
  return mapping;
}

export class Diff3MergeEngine {
  static _editDistance = _editDistance;
  static _findLineByContent = _findLineByContent;
  static _computeEditMapping = _computeEditMapping;

  static merge(baseText, currentText, hunks, path = '') {
    const conflicts = [];
    const baseLines = String(baseText ?? '').split('\n');
    const curLines = String(currentText ?? '').split('\n');

    for (const hunk of hunks ?? []) {
      if (![OP_SWAP, OP_DEL].includes(hunk.op)) continue;
      const baseSlice = baseLines.slice(hunk.start - 1, hunk.end).join('\n');
      const curSlice = curLines.slice(hunk.start - 1, hunk.end).join('\n');

      if (baseSlice !== curSlice) {
        // Check if anchor was deleted in current
        const foundLine = _findLineByContent(curLines, baseLines[hunk.start - 1]);
        const reason =
          foundLine < 0
            ? HashlineErrorCode.CONFLICT_DELETED_ANCHOR
            : HashlineErrorCode.CONFLICT_CONTENT_DIVERGED;
        conflicts.push(
          createDiff3Conflict({
            path,
            baseRange: [hunk.start, hunk.end],
            currentRange: [hunk.start, hunk.end],
            patchRange: [hunk.start, hunk.end],
            baseText: baseSlice,
            currentText: curSlice,
            patchText: (hunk.lines ?? []).join('\n'),
            reason,
          }),
        );
      }
    }

    try {
      return { merged: applyHunksToText(currentText, hunks), conflicts, path };
    } catch (error) {
      return {
        merged: null,
        conflicts,
        path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function normalizeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).replace(
    'File not found',
    'file not found',
  );
}
