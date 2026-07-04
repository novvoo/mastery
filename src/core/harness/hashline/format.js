/**
 * Hashline format primitives: sigils, separators, regex fragments, and
 * display helpers. These are the single source of truth for the parser, the
 * tokenizer, the prompt, and the formal grammar.
 *
 * Mastery uses a full 64-hex SHA-256 tag for cryptographic collision safety;
 * the tag also serves as a content-addressable key in persistent snapshot
 * stores and CAS.
 */

import { createHash } from 'node:crypto';

/** File-section header delimiters: `[path#hash]`. */
export const HL_FILE_PREFIX = '[';
export const HL_FILE_SUFFIX = ']';

/** Payload sigil for literal body rows. */
export const HL_PAYLOAD_REPLACE = '+';

/** Hunk-header keyword for concrete line replacement. */
export const HL_REPLACE_KEYWORD = 'SWAP';
/** Hunk-header keyword for concrete line deletion. */
export const HL_DELETE_KEYWORD = 'DEL';
/** Hunk-header keyword for insertion operations. */
export const HL_INSERT_KEYWORD = 'INS';
/** Insert position keyword for inserting before a concrete line. */
export const HL_INSERT_BEFORE = 'PRE';
/** Insert position keyword for inserting after a concrete line. */
export const HL_INSERT_AFTER = 'POST';
/** Insert position keyword for inserting at the start of the file. */
export const HL_INSERT_HEAD = 'HEAD';
/** Insert position keyword for inserting at the end of the file. */
export const HL_INSERT_TAIL = 'TAIL';
/** Hunk-header keyword: `SWAP.BLK N:` resolves N to a tree-sitter block range and replaces its span. */
export const HL_REPLACE_BLOCK_KEYWORD = 'SWAP.BLK';
/** Hunk-header keyword: `DEL.BLK N` resolves N to a tree-sitter block range and deletes its span. */
export const HL_DELETE_BLOCK_KEYWORD = 'DEL.BLK';
/** Hunk-header keyword: `INS.BLK.POST N:` inserts after the last line of the tree-sitter block at N. */
export const HL_INSERT_AFTER_BLOCK_KEYWORD = 'INS.BLK.POST';
/** File-level keyword: `REM` deletes the whole file named by the section header. */
export const HL_REM_KEYWORD = 'REM';
/** File-level keyword: `MV DEST` renames/moves the section file to `DEST`. */
export const HL_MOVE_KEYWORD = 'MV';
export const HL_HEADER_COLON = ':';

// ── Project-facing operation constants used by the hunk adapter API ──
export const OP_SWAP = 'SWAP';
export const OP_DEL = 'DEL';
export const OP_INS_PRE = 'INS.PRE';
export const OP_INS_POST = 'INS.POST';
export const OP_NOP = 'NOP';
export const OP_INS_HEAD = 'INS.HEAD';
export const OP_INS_TAIL = 'INS.TAIL';
export const OP_INS_BLK_POST = 'INS.BLK.POST';
export const OP_SWAP_BLK = 'SWAP.BLK';
export const OP_DEL_BLK = 'DEL.BLK';
export const OP_ABORT = 'ABORT';

/** Separator between a hashline file path and its opaque snapshot tag. */
export const HL_FILE_HASH_SEP = '#';

/** Separator between two line numbers in a range, e.g. `5.=10`. */
export const HL_RANGE_SEP = '.=';

/** Separator between a line number and displayed line content in hashline mode. */
export const HL_LINE_BODY_SEP = ':';

function regexEscape(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bare positive line-number Lid (no decorations, no captures, no anchors). */
export const HL_LINE_RE_RAW = `[1-9]\\d*`;

/** Capture-group form of `HL_LINE_RE_RAW`. */
export const HL_LINE_CAPTURE_RE_RAW = `(${HL_LINE_RE_RAW})`;

/** Format a concrete replacement hunk header. */
export function formatReplaceHeader(start, end) {
  return `${HL_REPLACE_KEYWORD} ${start}${HL_RANGE_SEP}${end}${HL_HEADER_COLON}`;
}

/** Format a concrete deletion hunk header. */
export function formatDeleteHeader(start, end = start) {
  return start === end
    ? `${HL_DELETE_KEYWORD} ${start}`
    : `${HL_DELETE_KEYWORD} ${start}${HL_RANGE_SEP}${end}`;
}

/**
 * Format an insertion hunk header for a cursor position.
 *
 * @param {import("./types.js").Cursor} cursor
 */
export function formatInsertHeader(cursor) {
  switch (cursor.kind) {
    case 'before_anchor':
      return `${HL_INSERT_KEYWORD}.${HL_INSERT_BEFORE} ${cursor.anchor.line}${HL_HEADER_COLON}`;
    case 'after_anchor':
      return `${HL_INSERT_KEYWORD}.${HL_INSERT_AFTER} ${cursor.anchor.line}${HL_HEADER_COLON}`;
    case 'bof':
      return `${HL_INSERT_KEYWORD}.${HL_INSERT_HEAD}${HL_HEADER_COLON}`;
    case 'eof':
      return `${HL_INSERT_KEYWORD}.${HL_INSERT_TAIL}${HL_HEADER_COLON}`;
    default:
      throw new Error(`Unknown cursor kind: ${cursor.kind}`);
  }
}

/** Number of hex characters in a content-derived file-hash tag (SHA-256). */
export const HL_FILE_HASH_LENGTH = 64;
/** Canonical lowercase hexadecimal content-hash tag carried by a hashline section header. */
export const HL_FILE_HASH_RE_RAW = `[0-9a-f]{${HL_FILE_HASH_LENGTH}}`;
/** Capture-group form of `HL_FILE_HASH_RE_RAW`. */
export const HL_FILE_HASH_CAPTURE_RE_RAW = `(${HL_FILE_HASH_RE_RAW})`;
/** Regex-escaped form of `HL_LINE_BODY_SEP`, safe for embedding inside a regex. */
export const HL_LINE_BODY_SEP_RE_RAW = regexEscape(HL_LINE_BODY_SEP);
/**
 * Representative file-hash tags for use in user-facing error messages and
 * prompt examples.
 */
export const HL_FILE_HASH_EXAMPLES = [
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
];

// ─────────────────────────────────────────────────────────────────────────────
// Content hashing — SHA-256 64-hex
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of arbitrary text as a 64-char lowercase hex string.
 * Used by all content-addressable stores and the hashline section tag.
 */
export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Normalize file text for hashing: unify newlines to `\n`, strip trailing
 * whitespace per line, strip trailing blank lines, and ensure the final line
 * ends with exactly one `\n` (for non-empty files).
 *
 * This is the canonical normalization used for snapshot tags — the same
 * content written on different platforms / editors produces the same tag.
 */
export function normalizeText(text) {
  if (text === null || text === undefined) {
    return '';
  }
  let t = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n');
  t = t.replace(/\n+$/g, '');
  if (t.length > 0) {
    t += '\n';
  }
  return t;
}

/**
 * Compute the content-derived hash tag carried by a hashline section header.
 * The tag is a 64-hex SHA-256 fingerprint of the whole file's normalized text:
 * any read of byte-identical content mints the same tag, and a follow-up edit
 * anchored at any line validates whenever the live file still hashes to it.
 */
export function computeFileHash(text) {
  return sha256Hex(normalizeText(text));
}

/**
 * Format a comma-separated list of example anchors with an optional line-number
 * prefix, quoted for inclusion in error messages: `"160", "42", "7"`.
 */
export function describeAnchorExamples(linePrefix = '') {
  const examples = linePrefix
    ? [linePrefix, `${linePrefix.slice(0, -1) || '4'}2`, '7']
    : ['160', '42', '7'];
  return examples.map((e) => `"${e}"`).join(', ');
}

/** Format a hashline section header for a file path and snapshot tag. */
export function formatHashlineHeader(filePath, fileHash) {
  return `${HL_FILE_PREFIX}${filePath}${HL_FILE_HASH_SEP}${fileHash}${HL_FILE_SUFFIX}`;
}

/** Formats a single numbered line as `LINE:TEXT`. */
export function formatNumberedLine(lineNumber, line) {
  return `${lineNumber}${HL_LINE_BODY_SEP}${line}`;
}

/** Format file text with hashline-mode line-number prefixes for display. */
export function formatNumberedLines(text, startLine = 1) {
  const lines = text.split('\n');
  return lines.map((line, i) => formatNumberedLine(startLine + i, line)).join('\n');
}
