/**
 * Top-level patch parser. Splits an authored hashline input into a list of
 * PatchSections, each rooted at a `[PATH#HASH]` header, then exposes a
 * Patch class that gives lazy access to the parsed edits per section.
 *
 * The splitter is purely lexical — it doesn't know whether a section's path
 * actually exists. That's the patcher's job.
 */
import * as path from 'node:path';
import { applyEdits } from './apply.js';
import { resolveBlockEdits } from './block.js';
import {
  HL_FILE_HASH_EXAMPLES,
  HL_FILE_HASH_LENGTH,
  HL_FILE_HASH_SEP,
  HL_FILE_PREFIX,
  HL_FILE_SUFFIX,
  OP_SWAP,
  OP_DEL,
  OP_INS_PRE,
  OP_INS_POST,
  OP_INS_HEAD,
  OP_INS_TAIL,
  OP_INS_BLK_POST,
  OP_SWAP_BLK,
  OP_DEL_BLK,
  OP_ABORT,
} from './format.js';
import { parsePatch, parsePatchStreaming } from './parser.js';
import { Tokenizer } from './tokenizer.js';

// Pure classification — single shared tokenizer is safe.
const TOKENIZER = new Tokenizer();

function unquoteHashlinePath(pathText) {
  if (pathText.length < 2) return pathText;
  const first = pathText[0];
  const last = pathText[pathText.length - 1];
  if ((first === '"' || first === "'") && first === last) return pathText.slice(1, -1);
  return pathText;
}

/**
 * Strip apply_patch-style noise that models reflexively prepend to the
 * path. Examples observed in benchmark traces:
 *
 *   `Update File:foo.ts`, `Update:foo.ts`, `UpdateFile:foo.ts`,
 *   `Update/File:foo.ts`, `Update-file:foo.ts`, `Update(File):foo.ts`,
 *   `Update<File:foo.ts`, `Add File:foo.ts`, `Delete File:foo.ts`,
 *   `Move to:foo.ts`, `***foo.ts`, `***Update File:foo.ts`.
 *
 * We strip a leading `***` (the model duplicating the header sigil) and a
 * leading `(Update|Add|Delete|Move)[<separator>]*(File|to)?[<separator>]*:`
 * keyword block, case-insensitive. The remaining text is the real path.
 */
const APPLY_PATCH_PATH_NOISE_RE =
  /^\*{0,3}\s*(?:(?:update|add|delete|move)[^A-Za-z0-9]*(?:file|to)?[^A-Za-z0-9]*:)?\s*\*{0,3}\s*/i;

function stripApplyPatchPathNoise(pathText) {
  return pathText.replace(APPLY_PATCH_PATH_NOISE_RE, '');
}

/**
 * Best-effort recovery for bracketed header lines the strict tokenizer
 * rejects. Strips apply_patch keyword noise (`Update File:`, `Update:`,
 * etc.) and an extra leading `***` (some models emit a hybrid
 * `[***foo.ts#HASH]` shape), then expects `PATH(#HASH)?`.
 * Returns `null` when no clean path can be salvaged.
 */
function tryParseRecoveryHeader(line, cwd) {
  if (!line.startsWith(HL_FILE_PREFIX) || !line.endsWith(HL_FILE_SUFFIX)) return null;
  const body = stripApplyPatchPathNoise(
    line.slice(HL_FILE_PREFIX.length, line.length - HL_FILE_SUFFIX.length).trim(),
  );
  if (body.length === 0) return null;

  // Trailing `#XXXX` is the tag; everything before it is the path. The
  // path may contain whitespace (Windows OneDrive folders, Program Files,
  // etc.), so we anchor the tag at end-of-body rather than scanning
  // forward and stopping at the first space.
  const trailing = new RegExp(`#([0-9A-Fa-f]{${HL_FILE_HASH_LENGTH}})\\s*$`).exec(body);
  let pathText;
  let fileHash;
  if (trailing !== null) {
    pathText = body.slice(0, trailing.index);
    fileHash = trailing[1].toUpperCase();
  } else {
    pathText = body.replace(/\s+$/, '');
  }

  // Same rule as the strict tokenizer: the hashline header grammar uses
  // `#` as the path/tag separator and does not allow `#` inside
  // filenames. Anything `#` left in the path body — short tags, non-hex
  // tags, over-long tags, stale-tag copy-paste, line-suffixed tags —
  // means the header is malformed, not a path with an embedded hash.
  if (pathText.includes('#')) return null;

  const normalized = normalizeHashlinePath(pathText, cwd);
  if (normalized.length === 0) return null;
  return fileHash !== undefined
    ? { path: normalized, fileHash, diff: '' }
    : { path: normalized, diff: '' };
}

function normalizeHashlinePath(rawPath, cwd) {
  const unquoted = stripApplyPatchPathNoise(unquoteHashlinePath(rawPath.trim()));
  if (!cwd || !path.isAbsolute(unquoted)) return unquoted;
  const relative = path.relative(path.resolve(cwd), path.resolve(unquoted));
  const normalizedRelative = relative.split(path.sep).join('/');
  const isWithinCwd = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  return isWithinCwd ? normalizedRelative || '.' : unquoted;
}

/**
 * Parse a `[PATH]` or `[PATH#hash]` header line. Returns `null` for lines that do
 * not start with `[`. Throws the strict "Input header must be …" error
 * when a bracketed line fails the strict shape (so malformed paths
 * surface immediately instead of being silently re-classified as payload).
 */
function parseHashlineHeaderLine(line, cwd) {
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith(HL_FILE_PREFIX)) return null;

  const token = TOKENIZER.tokenize(trimmed);
  if (token.kind !== 'header') {
    // Recovery: try to extract a path from the raw line after stripping
    // apply_patch noise. This handles `[*** Update File:foo.ts#CB5A]` and
    // the half-dozen variants models actually emit.
    const recovered = tryParseRecoveryHeader(trimmed, cwd);
    if (recovered !== null) return recovered;
    throw new Error(
      `Input header must be ${HL_FILE_PREFIX}PATH${HL_FILE_SUFFIX} or ${HL_FILE_PREFIX}PATH${HL_FILE_HASH_SEP}TAG${HL_FILE_SUFFIX} with a ${HL_FILE_HASH_LENGTH}-hex content-hash tag; got ${JSON.stringify(trimmed)}.`,
    );
  }

  const parsedPath = normalizeHashlinePath(token.path, cwd);
  if (parsedPath.length === 0) {
    throw new Error(
      `Input header "${HL_FILE_PREFIX}${HL_FILE_SUFFIX}" is empty; provide a file path.`,
    );
  }
  return token.fileHash !== undefined
    ? { path: parsedPath, fileHash: token.fileHash, diff: '' }
    : { path: parsedPath, diff: '' };
}

function stripLeadingBlankLines(input) {
  const stripped = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const lines = stripped.split('\n');
  while (lines.length > 0) {
    const head = lines[0].replace(/\r$/, '');
    const trimmed = head.trimStart();
    if (
      head.trim().length === 0 ||
      TOKENIZER.tokenize(head).kind === 'envelope-begin' ||
      trimmed.startsWith('#')
    ) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join('\n');
}

/**
 * Returns true when the input contains at least one line that the tokenizer
 * recognizes as a hashline op. Used by streaming previews to decide whether
 * the partial input is worth treating as a hashline patch yet.
 */
export function containsRecognizableHashlineOperations(input) {
  for (const line of input.split(/\r?\n/)) {
    if (TOKENIZER.isOp(line)) return true;
  }
  return false;
}

function normalizeFallbackInput(input, options) {
  const stripped = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const hasExplicitHeader = stripped
    .split(/\r?\n/)
    .some((rawLine) => parseHashlineHeaderLine(rawLine, options.cwd) !== null);
  if (hasExplicitHeader) return input;

  if (!options.path || !containsRecognizableHashlineOperations(input)) return input;
  const fallbackPath = normalizeHashlinePath(options.path, options.cwd);
  if (fallbackPath.length === 0) return input;
  return `${HL_FILE_PREFIX}${fallbackPath}${HL_FILE_SUFFIX}\n${input}`;
}

function splitRawSections(input, options = {}) {
  const normalized = normalizeFallbackInput(input, options);
  const originalLines = normalized.split(/\r?\n/);

  // Find the first non-blank, non-comment line to know the starting offset
  let startOffset = 0;
  while (startOffset < originalLines.length) {
    const head = originalLines[startOffset].replace(/\r$/, '');
    const trimmed = head.trimStart();
    if (head.trim().length === 0 || trimmed.startsWith('#')) {
      startOffset++;
      continue;
    }
    break;
  }
  const lines = originalLines.slice(startOffset);
  const firstLine = lines[0] ?? '';

  if (parseHashlineHeaderLine(firstLine, options.cwd) === null) {
    // Catch unified-diff hunk-header contamination on the first line so
    // the model sees a focused error.
    const firstTrimmed = firstLine.trimEnd();
    if (/^@@\s+[-+]?\d+,\d+\s+[-+]?\d+,\d+\s+@@/.test(firstTrimmed)) {
      throw new Error(
        'unified-diff hunk header (`@@ -N,M +N,M @@`) is not valid in hashline. ' +
          `File sections start with \`${HL_FILE_PREFIX}path${HL_FILE_HASH_SEP}HASH${HL_FILE_SUFFIX}\`; use \`replace\`, \`delete\`, or \`insert\` ops.`,
      );
    }
    const preview = JSON.stringify(firstLine.slice(0, 120));
    throw new Error(
      `input must begin with "${HL_FILE_PREFIX}PATH${HL_FILE_HASH_SEP}HASH${HL_FILE_SUFFIX}" on the first non-blank line for anchored edits; got: ${preview}. ` +
        `Example: "${HL_FILE_PREFIX}src/foo.ts${HL_FILE_HASH_SEP}${HL_FILE_HASH_EXAMPLES[0]}${HL_FILE_SUFFIX}" then edit ops.`,
    );
  }

  const sections = [];
  let current;
  let currentLines = [];
  let currentHeaderLine = 0; // 1-based line number of the section header in original input

  const flush = (lineIdx) => {
    if (!current) return;
    const hasContent = currentLines.some((line) => line.trim().length > 0);
    if (hasContent) {
      sections.push({
        ...current,
        diff: currentLines.join('\n'),
        // lineOffset: number of lines before the diff body starts in original input
        // diff body starts at header line + 1
        lineOffset: startOffset + currentHeaderLine,
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    const token = TOKENIZER.tokenize(line);
    if (token.kind === 'envelope-begin') continue;
    if (token.kind === 'envelope-end') {
      flush(i);
      break;
    }
    if (token.kind === 'abort') {
      currentLines.push(line);
      // Don't break — let subsequent lines still raise parse errors
      // (ABORT is a sentinel hunk, not a hard stop for parsing)
      continue;
    }

    // Route every bracket-prefixed line through parseHashlineHeaderLine so
    // malformed headers still raise the strict "Input header must be …"
    // diagnostic (the tokenizer alone would silently classify them as
    // payload).
    if (trimmed.startsWith(HL_FILE_PREFIX)) {
      const header = parseHashlineHeaderLine(line, options.cwd);
      if (header !== null) {
        flush(i);
        current = header;
        currentHeaderLine = i; // 0-based index in `lines` array
        currentLines = [];
        continue;
      }
    }
    currentLines.push(line);
  }
  flush(lines.length);
  return sections;
}

/**
 * Snapshot of one section in a parsed Patch: a target file plus the
 * lazily-parsed list of edits that should land on it. Constructed by
 * Patch.parse; consumers usually iterate `patch.sections` rather
 * than build these directly.
 */
export class PatchSection {
  #parsed;

  constructor(raw) {
    this.path = raw.path;
    this.fileHash = raw.fileHash;
    this.diff = raw.diff;
    this._lineOffset = raw.lineOffset ?? 0;
  }

  /**
   * Parse this section's diff body. Cached: subsequent calls return the
   * same `{ edits, fileOp?, warnings }` object so callers can safely call this from
   * multiple paths (preflight, apply, diff-preview).
   */
  parse() {
    this.#parsed ??= parsePatch(this.diff);
    const parsed = this.#parsed;
    const fileOp =
      parsed.fileOp === undefined
        ? undefined
        : parsed.fileOp.kind === 'move'
          ? { kind: 'move', dest: normalizeHashlinePath(parsed.fileOp.dest) }
          : parsed.fileOp;
    return fileOp === parsed.fileOp
      ? parsed
      : {
          edits: parsed.edits,
          ...(fileOp === undefined ? {} : { fileOp }),
          warnings: parsed.warnings,
        };
  }

  /** Parsed edits for this section. */
  get edits() {
    return this.parse().edits;
  }

  /** Optional whole-file operation (`REM` / `MV`). */
  get fileOp() {
    return this.parse().fileOp;
  }

  /** Warnings emitted during parsing of this section. */
  get warnings() {
    return this.parse().warnings;
  }

  /**
   * True when at least one edit anchors to concrete file content. Pure
   * `insert head:` / `insert tail:` literal inserts do not count: those are
   * safe to apply to files that don't yet exist.
   */
  get hasAnchorScopedEdit() {
    return this.edits.some((edit) => {
      if (edit.kind === 'delete') return true;
      // A `replace_block N:` edit is anchored to concrete content on line N.
      if (edit.kind === 'block') return true;
      return edit.cursor.kind === 'before_anchor' || edit.cursor.kind === 'after_anchor';
    });
  }

  /** Anchor lines touched by this section, sorted ascending and deduplicated. */
  collectAnchorLines() {
    const lines = new Set();
    for (const edit of this.edits) {
      if (edit.kind === 'delete') {
        lines.add(edit.anchor.line);
        continue;
      }
      if (edit.kind === 'block') {
        lines.add(edit.anchor.line);
        continue;
      }
      if (edit.cursor.kind === 'before_anchor' || edit.cursor.kind === 'after_anchor') {
        lines.add(edit.cursor.anchor.line);
      }
    }
    return [...lines].sort((a, b) => a - b);
  }

  /**
   * Apply this section's edits to `text` and return the post-edit result.
   * Pure: does no I/O, does not validate the section snapshot tag. The
   * Patcher owns tag validation and recovery; reach for this
   * method directly when you've already validated the file content and
   * just want the result.
   *
   * `blockResolver` resolves any `replace_block N:` edits against `text`; an
   * unresolvable block throws (this is the final, authoritative preview path).
   */
  applyTo(text, blockResolver) {
    const { edits, warnings } = this.parse();
    const resolveWarnings = [];
    const resolved = resolveBlockEdits(edits, text, this.path, blockResolver, {
      onUnresolved: 'throw',
      onWarning: (warning) => resolveWarnings.push(warning),
    });
    const result = applyEdits(text, resolved);
    // Preserve parse warnings so consumers don't need to call `parse()`
    // separately.
    const merged = [...warnings, ...resolveWarnings, ...(result.warnings ?? [])];
    return merged.length > 0
      ? { ...result, warnings: merged }
      : { text: result.text, firstChangedLine: result.firstChangedLine };
  }

  /**
   * Convert this section's edits into the project hunk API. Each hunk is a
   * range-oriented object:
   *   `{ op, start, end, lines, srcLine }`
   *
   * Edits that originated from the same source line (same `lineNum`) are
   * coalesced back into one range hunk — this mirrors the original
   * one-hunk-per-header structure.
   *
   * @returns {Array} project hunk array
   */
  toHunks() {
    const { edits } = this.parse();
    if (edits.length === 0) return [];

    // Group edits by source line number — each group came from one hunk header.
    const groups = new Map();
    for (const edit of edits) {
      const key = edit.lineNum ?? 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(edit);
    }

    const hunks = [];
    for (const [srcLineRel, group] of groups) {
      const first = group[0];
      const srcLine = srcLineRel + this._lineOffset + 1;

      // ABORT
      if (first.kind === 'abort') {
        hunks.push({ op: OP_ABORT, start: 1, end: 1, lines: [], srcLine });
        continue;
      }

      // Block operations map one-to-one.
      if (first.kind === 'block') {
        const op =
          first.mode === 'insert_after'
            ? OP_INS_BLK_POST
            : first.payloads.length === 0
              ? OP_DEL_BLK
              : OP_SWAP_BLK;
        hunks.push({
          op,
          start: first.anchor.line ?? 1,
          end: first.anchor.line ?? 1,
          lines: first.payloads || [],
          srcLine,
        });
        continue;
      }

      const replacements = group.filter((e) => e.kind === 'insert' && e.mode === 'replacement');
      const deletes = group.filter((e) => e.kind === 'delete');
      const inserts = group.filter((e) => e.kind === 'insert' && e.mode !== 'replacement');

      // SWAP: replacement inserts + deletes
      if (replacements.length > 0 && deletes.length > 0) {
        const start = deletes[0].anchor.line;
        const end = deletes[deletes.length - 1].anchor.line;
        hunks.push({
          op: OP_SWAP,
          start,
          end,
          lines: replacements.map((e) => e.text),
          srcLine,
        });
        continue;
      }

      // DEL: pure deletes
      if (deletes.length > 0 && replacements.length === 0) {
        const start = deletes[0].anchor.line;
        const end = deletes[deletes.length - 1].anchor.line;
        hunks.push({ op: OP_DEL, start, end, lines: [], srcLine });
        continue;
      }

      // INS.*: pure inserts
      if (inserts.length > 0) {
        const cursor = inserts[0].cursor;
        let op, start;
        if (cursor.kind === 'bof') {
          op = OP_INS_HEAD;
          start = 1;
        } else if (cursor.kind === 'eof') {
          op = OP_INS_TAIL;
          start = 0;
        } else if (cursor.kind === 'before_anchor') {
          op = OP_INS_PRE;
          start = cursor.anchor.line;
        } else if (cursor.kind === 'after_anchor') {
          op = OP_INS_POST;
          start = cursor.anchor.line;
        } else {
          op = OP_INS_PRE;
          start = 1;
        }
        hunks.push({
          op,
          start,
          end: start,
          lines: inserts.map((e) => e.text),
          srcLine,
        });
      }
    }

    hunks.sort((a, b) => a.srcLine - b.srcLine);
    return hunks;
  }

  /**
   * Streaming-tolerant counterpart to applyTo. Uses
   * parsePatchStreaming so a trailing in-flight op (no payload yet,
   * or a per-token parse error mid-stream) does not throw or emit a phantom
   * empty-payload edit. Intended for incremental diff previews; the writer
   * path should always use applyTo.
   *
   * `blockResolver` resolves any `replace_block N:` edits against `text`; an
   * unresolvable block is silently dropped so a half-written file does not
   * throw mid-stream.
   */
  applyPartialTo(text, blockResolver) {
    const { edits, warnings } = parsePatchStreaming(this.diff);
    const resolveWarnings = [];
    const resolved = resolveBlockEdits(edits, text, this.path, blockResolver, {
      onUnresolved: 'drop',
      onWarning: (warning) => resolveWarnings.push(warning),
    });
    const result = applyEdits(text, resolved);
    const merged = [...warnings, ...resolveWarnings, ...(result.warnings ?? [])];
    return merged.length > 0
      ? { ...result, warnings: merged }
      : { text: result.text, firstChangedLine: result.firstChangedLine };
  }

  /**
   * A copy of this section rebound to a different target `path`, preserving
   * the snapshot tag, diff body, and any cached parse result. Used by the
   * patcher's tag-based path recovery to redirect an edit whose authored
   * path does not exist onto the file its snapshot tag actually names.
   */
  withPath(path) {
    const next = new PatchSection({
      path,
      ...(this.fileHash !== undefined ? { fileHash: this.fileHash } : {}),
      diff: this.diff,
      lineOffset: this._lineOffset,
    });
    next.#parsed = this.#parsed;
    return next;
  }
}

/**
 * A parsed hashline patch — zero or more PatchSections, each rooted
 * at a `[PATH#HASH]` header. Construct via Patch.parse.
 *
 * `Patch` is pure data: parsing is line-anchored and does not look at the
 * filesystem. To apply a patch, hand it to Patcher.apply.
 */
export class Patch {
  constructor(sections) {
    this.sections = sections;
  }

  /**
   * Parse `input` into a Patch. `options.cwd` resolves absolute
   * paths inside headers to cwd-relative form; `options.path` provides a
   * fallback when the input lacks a header but contains hashline ops
   * (useful for streaming previews).
   *
   * Consecutive sections targeting the same path are merged into a single
   * section with concatenated diff bodies. Anchors authored against the
   * same file snapshot must be applied as one batch; otherwise the first
   * sub-edit shifts line numbers out from under the second's anchors and
   * validation fails.
   */
  static parse(input, options = {}) {
    const raw = mergeSamePathSections(splitRawSections(input, options));
    return new Patch(raw.map((section) => new PatchSection(section)));
  }

  /**
   * Parse `input` and return only the first section. Throws if the input
   * has zero sections. Convenience for the single-section case where the
   * caller already knows the patch is one hunk.
   */
  static parseSingle(input, options = {}) {
    const patch = Patch.parse(input, options);
    const first = patch.sections[0];
    if (!first) throw new Error('Patch input did not produce any sections.');
    return first;
  }
}

/**
 * Collapse consecutive or interleaved sections targeting the same path into a
 * single section with concatenated diffs. Anchors authored against the same
 * file snapshot must be applied as one batch; otherwise the first sub-edit
 * shifts line numbers out from under the second's anchors and validation
 * fails. Path order is preserved by first occurrence.
 */
function mergeSamePathSections(sections) {
  const byPath = new Map();
  for (const section of sections) {
    const existing = byPath.get(section.path);
    if (existing) {
      if (
        existing.fileHash !== undefined &&
        section.fileHash !== undefined &&
        existing.fileHash !== section.fileHash
      ) {
        throw new Error(
          `Conflicting hashline snapshot tags for ${section.path}: #${existing.fileHash} and #${section.fileHash}. Re-read the file and retry with one current header.`,
        );
      }
      if (existing.fileHash === undefined && section.fileHash !== undefined)
        existing.fileHash = section.fileHash;
      existing.diffs.push(section.diff);
      continue;
    }
    byPath.set(section.path, {
      ...(section.fileHash !== undefined ? { fileHash: section.fileHash } : {}),
      diffs: [section.diff],
      lineOffset: section.lineOffset ?? 0,
    });
  }
  return Array.from(byPath, ([sectionPath, entry]) => ({
    path: sectionPath,
    ...(entry.fileHash !== undefined ? { fileHash: entry.fileHash } : {}),
    diff: entry.diffs.join('\n'),
    lineOffset: entry.lineOffset,
  }));
}
