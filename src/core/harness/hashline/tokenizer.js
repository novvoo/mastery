/**
 * Stateful, line-oriented classifier for hashline diff text.
 *
 * Format shape:
 * ```
 * [path/to/file.ts#e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855]
 * replace 5.=7:
 * +literal new line
 * ```
 *
 */

import {
  describeAnchorExamples,
  HL_DELETE_BLOCK_KEYWORD,
  HL_DELETE_KEYWORD,
  HL_FILE_HASH_LENGTH,
  HL_FILE_HASH_SEP,
  HL_FILE_PREFIX,
  HL_FILE_SUFFIX,
  HL_HEADER_COLON,
  HL_INSERT_AFTER,
  HL_INSERT_AFTER_BLOCK_KEYWORD,
  HL_INSERT_BEFORE,
  HL_INSERT_HEAD,
  HL_INSERT_KEYWORD,
  HL_INSERT_TAIL,
  HL_MOVE_KEYWORD,
  HL_PAYLOAD_REPLACE,
  HL_REM_KEYWORD,
  HL_REPLACE_BLOCK_KEYWORD,
  HL_REPLACE_KEYWORD,
} from './format.js';
import { ABORT_MARKER, BEGIN_PATCH_MARKER, END_PATCH_MARKER } from './messages.js';

const CHAR_LINE_FEED = 10;
const CHAR_CARRIAGE_RETURN = 13;
const CHAR_ZERO = 48;
const CHAR_NINE = 57;
const CHAR_HASH = 35;
const CHAR_TAB = 9;
const CHAR_SPACE = 32;
const CHAR_DOT = 46;
const CHAR_HYPHEN = 45;
const CHAR_ELLIPSIS = 0x2026;
const CHAR_EQUALS = 61;

const CHAR_UPPER_A = 65;
const CHAR_UPPER_F = 70;
const CHAR_LOWER_A = 97;
const CHAR_LOWER_F = 102;
const CHAR_PAYLOAD_REPLACE = HL_PAYLOAD_REPLACE.charCodeAt(0);
const CHAR_COLON = HL_HEADER_COLON.charCodeAt(0);
const FILE_PREFIX_LENGTH = HL_FILE_PREFIX.length;
const FILE_SUFFIX_LENGTH = HL_FILE_SUFFIX.length;

function isDigitCode(code) {
  return code >= CHAR_ZERO && code <= CHAR_NINE;
}

function isNonZeroDigitCode(code) {
  return code > CHAR_ZERO && code <= CHAR_NINE;
}

function isHexDigitCode(code) {
  return (
    isDigitCode(code) ||
    (code >= CHAR_UPPER_A && code <= CHAR_UPPER_F) ||
    (code >= CHAR_LOWER_A && code <= CHAR_LOWER_F)
  );
}

function isWhitespaceCode(code) {
  return code === CHAR_SPACE || (code >= CHAR_TAB && code <= CHAR_CARRIAGE_RETURN);
}

function skipWhitespace(line, index, end = line.length) {
  while (index < end && isWhitespaceCode(line.charCodeAt(index))) index++;
  return index;
}

function trimEndIndex(line) {
  let end = line.length;
  while (end > 0 && isWhitespaceCode(line.charCodeAt(end - 1))) end--;
  return end;
}

function isEmptyLine(line) {
  return line.length === 0;
}

function markerLineEquals(line, marker) {
  const end = trimEndIndex(line);
  return end === marker.length && line.startsWith(marker);
}

export function splitHashlineLines(text) {
  if (text.length === 0) return [''];
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) !== CHAR_LINE_FEED) continue;
    let end = index;
    if (end > start && text.charCodeAt(end - 1) === CHAR_CARRIAGE_RETURN) end--;
    lines.push(text.slice(start, end));
    start = index + 1;
  }
  if (start < text.length) {
    let end = text.length;
    if (end > start && text.charCodeAt(end - 1) === CHAR_CARRIAGE_RETURN) end--;
    lines.push(text.slice(start, end));
  }
  return lines;
}

export function cloneCursor(cursor) {
  if (cursor.kind === 'before_anchor')
    return { kind: 'before_anchor', anchor: { ...cursor.anchor } };
  if (cursor.kind === 'after_anchor') return { kind: 'after_anchor', anchor: { ...cursor.anchor } };
  return cursor;
}

function scanLineNumber(line, index, end) {
  if (index >= end || !isNonZeroDigitCode(line.charCodeAt(index))) return null;
  let lineNumber = 0;
  let nextIndex = index;
  while (nextIndex < end) {
    const code = line.charCodeAt(nextIndex);
    if (!isDigitCode(code)) break;
    lineNumber = lineNumber * 10 + (code - CHAR_ZERO);
    nextIndex++;
  }
  return { line: lineNumber, nextIndex };
}

/** Parse a bare line-number anchor. Throws on malformed input. */
export function parseLid(raw, lineNum) {
  const end = trimEndIndex(raw);
  const numberStart = skipWhitespace(raw, 0, end);
  const number = scanLineNumber(raw, numberStart, end);
  if (number === null || skipWhitespace(raw, number.nextIndex, end) !== end) {
    throw new Error(
      `line ${lineNum}: expected a line number such as ${describeAnchorExamples('119')}; ` +
        `got ${JSON.stringify(raw)}. Use ${HL_FILE_PREFIX}PATH${HL_FILE_HASH_SEP}hash${HL_FILE_SUFFIX} from your latest read for file-version binding.`,
    );
  }
  return { line: number.line };
}

function scanRangeSeparator(line, index, end) {
  let cursor = index;
  let consumedSeparator = false;
  while (cursor < end) {
    const code = line.charCodeAt(cursor);
    if (isWhitespaceCode(code)) {
      cursor++;
      consumedSeparator = true;
      continue;
    }
    if (code === CHAR_HYPHEN || code === CHAR_ELLIPSIS) {
      cursor++;
      consumedSeparator = true;
      continue;
    }
    if (
      code === CHAR_DOT &&
      cursor + 1 < end &&
      (line.charCodeAt(cursor + 1) === CHAR_DOT || line.charCodeAt(cursor + 1) === CHAR_EQUALS)
    ) {
      cursor += 2;
      consumedSeparator = true;
      continue;
    }
    break;
  }
  if (!consumedSeparator) return null;
  if (cursor >= end || !isNonZeroDigitCode(line.charCodeAt(cursor))) return null;
  return cursor;
}

function scanHeaderRange(line, index = 0, end = trimEndIndex(line), allowSingle = false) {
  const numberStart = skipWhitespace(line, index, end);
  const start = scanLineNumber(line, numberStart, end);
  if (start === null) return null;
  const afterFirst = scanRangeSeparator(line, start.nextIndex, end);
  if (afterFirst === null) {
    if (!allowSingle) return null;
    return {
      range: { start: { line: start.line }, end: { line: start.line } },
      nextIndex: skipWhitespace(line, start.nextIndex, end),
    };
  }
  const endNumber = scanLineNumber(line, afterFirst, end);
  if (endNumber === null) return null;
  return {
    range: { start: { line: start.line }, end: { line: endNumber.line } },
    nextIndex: skipWhitespace(line, endNumber.nextIndex, end),
  };
}

/**
 * @typedef {(
 *   | { kind: "replace"; range: import("./types.js").ParsedRange }
 *   | { kind: "block"; anchor: import("./types.js").Anchor }
 *   | { kind: "delete"; range: import("./types.js").ParsedRange }
 *   | { kind: "delete_block"; anchor: import("./types.js").Anchor }
 *   | { kind: "insert_before"; anchor: import("./types.js").Anchor }
 *   | { kind: "insert_after"; anchor: import("./types.js").Anchor }
 *   | { kind: "insert_after_block"; anchor: import("./types.js").Anchor }
 *   | { kind: "rem" }
 *   | { kind: "move"; dest: string }
 *   | { kind: "bof" }
 *   | { kind: "eof" }
 * )} BlockTarget
 */

function scanKeyword(line, index, end, keyword) {
  if (!line.startsWith(keyword, index)) return null;
  const next = index + keyword.length;
  if (next < end) {
    const code = line.charCodeAt(next);
    if (!isWhitespaceCode(code) && code !== CHAR_COLON && code !== CHAR_DOT) return null;
  }
  return next;
}

/**
 * GLM 5.2 inserts a stray `.` between the line number/range and the trailing
 * `:` (e.g. `SWAP 2.=3.:`, `INS.POST 2.:`). A `.` is never valid syntax at
 * this position, so skip it when it precedes an optional `:` or end-of-line.
 */
function skipStrayDot(line, index, end) {
  if (index < end && line.charCodeAt(index) === CHAR_DOT) {
    const after = skipWhitespace(line, index + 1, end);
    if (after === end || line.charCodeAt(after) === CHAR_COLON) return after;
  }
  return index;
}

function consumeOptionalColon(line, index, end) {
  let cursor = skipWhitespace(line, index, end);
  cursor = skipStrayDot(line, cursor, end);
  return cursor < end && line.charCodeAt(cursor) === CHAR_COLON
    ? skipWhitespace(line, cursor + 1, end)
    : cursor;
}

function scanInsertTarget(line, index, end) {
  if (index >= end || line.charCodeAt(index) !== CHAR_DOT) return null;
  const cursor = skipWhitespace(line, index + 1, end);
  const beforeEnd = scanKeyword(line, cursor, end, HL_INSERT_BEFORE);
  if (beforeEnd !== null) {
    const anchor = scanLineNumber(line, skipWhitespace(line, beforeEnd, end), end);
    if (anchor === null) return null;
    const nextIndex = consumeOptionalColon(line, anchor.nextIndex, end);
    return { target: { kind: 'insert_before', anchor: { line: anchor.line } }, nextIndex };
  }
  const afterEnd = scanKeyword(line, cursor, end, HL_INSERT_AFTER);
  if (afterEnd !== null) {
    const anchor = scanLineNumber(line, skipWhitespace(line, afterEnd, end), end);
    if (anchor === null) return null;
    const nextIndex = consumeOptionalColon(line, anchor.nextIndex, end);
    return { target: { kind: 'insert_after', anchor: { line: anchor.line } }, nextIndex };
  }
  const headEnd = scanKeyword(line, cursor, end, HL_INSERT_HEAD);
  if (headEnd !== null)
    return { target: { kind: 'bof' }, nextIndex: consumeOptionalColon(line, headEnd, end) };
  const tailEnd = scanKeyword(line, cursor, end, HL_INSERT_TAIL);
  if (tailEnd !== null)
    return { target: { kind: 'eof' }, nextIndex: consumeOptionalColon(line, tailEnd, end) };
  return null;
}

function unquotePath(pathText) {
  if (pathText.length < 2) return pathText;
  const first = pathText[0];
  const last = pathText[pathText.length - 1];
  if ((first === '"' || first === "'") && first === last) return pathText.slice(1, -1);
  return pathText;
}

function scanMoveDest(line, index, end) {
  const cursor = skipWhitespace(line, index, end);
  if (cursor >= end) return null;
  const first = line.charCodeAt(cursor);
  if (first === 34 /* " */ || first === 39 /* ' */) {
    const quote = line[cursor];
    let next = cursor + 1;
    while (next < end) {
      const ch = line[next];
      if (ch === '\\' && next + 1 < end) {
        next += 2;
        continue;
      }
      if (ch === quote) {
        const after = skipWhitespace(line, next + 1, end);
        return after === end ? unquotePath(line.slice(cursor, next + 1)) : null;
      }
      next++;
    }
    return null;
  }
  return unquotePath(line.slice(cursor, end).trim());
}

function scanLooseSingleAnchor(line, index, end) {
  const numberStart = skipWhitespace(line, index, end);
  const start = scanLineNumber(line, numberStart, end);
  if (start === null) return null;
  let cursor = start.nextIndex;

  cursor = skipWhitespace(line, cursor, end);

  // Optional trailing `=` or `:` or stray `.`
  if (cursor < end) {
    const code = line.charCodeAt(cursor);
    if (code === CHAR_EQUALS || code === CHAR_COLON) {
      cursor++;
    } else if (code === CHAR_DOT) {
      // Stray dot before colon/equals (e.g. `INS.PRE 2.:`)
      const after = skipWhitespace(line, cursor + 1, end);
      if (
        after < end &&
        (line.charCodeAt(after) === CHAR_EQUALS || line.charCodeAt(after) === CHAR_COLON)
      ) {
        cursor = after + 1;
      }
    }
  }

  cursor = skipWhitespace(line, cursor, end);

  if (cursor !== end) return null;

  return { line: start.line, nextIndex: cursor };
}

function scanLooseRange(line, index, end, requireColon) {
  const numberStart = skipWhitespace(line, index, end);
  const start = scanLineNumber(line, numberStart, end);
  if (start === null) return null;
  let cursor = start.nextIndex;

  // Optional range separator: accept both canonical `.=` and common shorthand `=`.
  let hasSep = false;
  cursor = skipWhitespace(line, cursor, end);
  if (cursor < end && line.charCodeAt(cursor) === CHAR_DOT) {
    if (cursor + 1 < end && line.charCodeAt(cursor + 1) === CHAR_EQUALS) {
      cursor += 2;
      hasSep = true;
    }
  } else if (cursor < end && line.charCodeAt(cursor) === CHAR_EQUALS) {
    cursor++;
    hasSep = true;
  }

  let endLine = start.line;
  if (hasSep) {
    const endNum = scanLineNumber(line, skipWhitespace(line, cursor, end), end);
    if (endNum === null) return null;
    endLine = endNum.line;
    cursor = endNum.nextIndex;
  }

  cursor = skipWhitespace(line, cursor, end);

  // Colon handling
  if (requireColon) {
    if (cursor >= end || line.charCodeAt(cursor) !== CHAR_COLON) return null;
    cursor++;
  } else {
    // DEL does not take a colon; stray colon is invalid
    if (cursor < end && line.charCodeAt(cursor) === CHAR_COLON) return null;
  }

  return {
    range: { start: { line: start.line }, end: { line: endLine } },
    nextIndex: cursor,
  };
}

function scanProjectHunkHeader(line, cursor, end) {
  // ── BLK variants must be checked BEFORE their base variants ──
  // (otherwise "DEL.BLK" matches "DEL" first and returns null)

  // SWAP.BLK N:
  if (line.startsWith('SWAP.BLK', cursor)) {
    const kwEnd = cursor + 8;
    const anchor = scanLineNumber(line, skipWhitespace(line, kwEnd, end), end);
    if (anchor === null) return null;
    let next = skipWhitespace(line, anchor.nextIndex, end);
    // Accept both ':' and '='
    if (
      next < end &&
      (line.charCodeAt(next) === CHAR_COLON || line.charCodeAt(next) === CHAR_EQUALS)
    )
      next++;
    return { target: { kind: 'block', anchor: { line: anchor.line } }, nextIndex: next };
  }

  // DEL.BLK N
  if (line.startsWith('DEL.BLK', cursor)) {
    const kwEnd = cursor + 7;
    const anchor = scanLineNumber(line, skipWhitespace(line, kwEnd, end), end);
    if (anchor === null) return null;
    let next = skipWhitespace(line, anchor.nextIndex, end);
    // Accept trailing '=' (legacy)
    if (next < end && line.charCodeAt(next) === CHAR_EQUALS) next++;
    if (next < end && line.charCodeAt(next) === CHAR_COLON) return null;
    return { target: { kind: 'delete_block', anchor: { line: anchor.line } }, nextIndex: next };
  }

  // INS.BLK.POST N:
  if (line.startsWith('INS.BLK.POST', cursor)) {
    const kwEnd = cursor + 12;
    const anchor = scanLineNumber(line, skipWhitespace(line, kwEnd, end), end);
    if (anchor === null) return null;
    let next = skipWhitespace(line, anchor.nextIndex, end);
    // Accept both ':' and '='
    if (
      next < end &&
      (line.charCodeAt(next) === CHAR_COLON || line.charCodeAt(next) === CHAR_EQUALS)
    )
      next++;
    return {
      target: { kind: 'insert_after_block', anchor: { line: anchor.line } },
      nextIndex: next,
    };
  }

  // SWAP N.=M:  /  SWAP N:  /  SWAP N=M:
  if (line.startsWith('SWAP', cursor)) {
    const kwEnd = cursor + 4;
    if (kwEnd < end) {
      const code = line.charCodeAt(kwEnd);
      if (!isWhitespaceCode(code) && code !== CHAR_COLON) return null;
    }
    const range = scanLooseRange(line, kwEnd, end, true);
    if (range === null) return null;
    return { target: { kind: 'replace', range: range.range }, nextIndex: range.nextIndex };
  }

  // DEL N  /  DEL N.=M
  if (line.startsWith('DEL', cursor)) {
    const kwEnd = cursor + 3;
    if (kwEnd < end) {
      const code = line.charCodeAt(kwEnd);
      if (!isWhitespaceCode(code)) return null;
    }
    const range = scanLooseRange(line, kwEnd, end, false);
    if (range === null) return null;
    return { target: { kind: 'delete', range: range.range }, nextIndex: range.nextIndex };
  }

  // INS.PRE N=  /  INS.PRE N:  /  INS.PRE N
  if (line.startsWith('INS.PRE', cursor)) {
    const kwEnd = cursor + 7;
    const anchor = scanLooseSingleAnchor(line, kwEnd, end);
    if (anchor === null) return null;
    return {
      target: { kind: 'insert_before', anchor: { line: anchor.line } },
      nextIndex: anchor.nextIndex,
    };
  }

  // INS.POST N=  /  INS.POST N:  /  INS.POST N
  if (line.startsWith('INS.POST', cursor)) {
    const kwEnd = cursor + 8;
    const anchor = scanLooseSingleAnchor(line, kwEnd, end);
    if (anchor === null) return null;
    return {
      target: { kind: 'insert_after', anchor: { line: anchor.line } },
      nextIndex: anchor.nextIndex,
    };
  }

  // INS.HEAD
  if (line.startsWith('INS.HEAD', cursor)) {
    const kwEnd = cursor + 8;
    let next = skipWhitespace(line, kwEnd, end);
    // Optional trailing colon
    if (next < end && line.charCodeAt(next) === CHAR_COLON) next++;
    return { target: { kind: 'bof' }, nextIndex: next };
  }

  // INS.TAIL
  if (line.startsWith('INS.TAIL', cursor)) {
    const kwEnd = cursor + 8;
    let next = skipWhitespace(line, kwEnd, end);
    if (next < end && line.charCodeAt(next) === CHAR_COLON) next++;
    return { target: { kind: 'eof' }, nextIndex: next };
  }

  // ABORT
  if (line.startsWith('ABORT', cursor)) {
    const kwEnd = cursor + 5;
    if (kwEnd < end) {
      const rest = line.slice(kwEnd).trim();
      if (rest.length > 0) return null;
    }
    return { target: { kind: 'abort' }, nextIndex: end };
  }

  return null;
}

function scanHunkAnchor(line, start, end) {
  const cursor = skipWhitespace(line, start, end);

  // ── Project hunk API syntax (SWAP / DEL / INS.PRE / INS.POST / ...) ──
  const projectHunk = scanProjectHunkHeader(line, cursor, end);
  if (projectHunk !== null) return projectHunk;

  const remEnd = scanKeyword(line, cursor, end, HL_REM_KEYWORD);
  if (remEnd !== null) {
    const next = skipWhitespace(line, remEnd, end);
    if (next !== end) return null;
    return { target: { kind: 'rem' }, nextIndex: next };
  }
  const moveEnd = scanKeyword(line, cursor, end, HL_MOVE_KEYWORD);
  if (moveEnd !== null) {
    const dest = scanMoveDest(line, moveEnd, end);
    if (dest === null || dest.length === 0) return null;
    return { target: { kind: 'move', dest }, nextIndex: end };
  }

  const replaceBlockEnd = scanKeyword(line, cursor, end, HL_REPLACE_BLOCK_KEYWORD);
  if (replaceBlockEnd !== null) {
    const anchor = scanLineNumber(line, skipWhitespace(line, replaceBlockEnd, end), end);
    if (anchor === null) return null;
    return {
      target: { kind: 'block', anchor: { line: anchor.line } },
      nextIndex: consumeOptionalColon(line, anchor.nextIndex, end),
    };
  }
  const replaceEnd = scanKeyword(line, cursor, end, HL_REPLACE_KEYWORD);
  if (replaceEnd !== null) {
    const range = scanHeaderRange(line, replaceEnd, end, true);
    if (range === null) return null;
    return {
      target: { kind: 'replace', range: range.range },
      nextIndex: consumeOptionalColon(line, range.nextIndex, end),
    };
  }
  const deleteBlockEnd = scanKeyword(line, cursor, end, HL_DELETE_BLOCK_KEYWORD);
  if (deleteBlockEnd !== null) {
    const anchor = scanLineNumber(line, skipWhitespace(line, deleteBlockEnd, end), end);
    if (anchor === null) return null;
    let next = skipWhitespace(line, anchor.nextIndex, end);
    next = skipStrayDot(line, next, end);
    if (next < end && line.charCodeAt(next) === CHAR_COLON) return null;
    return { target: { kind: 'delete_block', anchor: { line: anchor.line } }, nextIndex: next };
  }
  const deleteEnd = scanKeyword(line, cursor, end, HL_DELETE_KEYWORD);
  if (deleteEnd !== null) {
    const range = scanHeaderRange(line, deleteEnd, end, true);
    if (range === null) return null;
    let next = skipWhitespace(line, range.nextIndex, end);
    next = skipStrayDot(line, next, end);
    if (next < end && line.charCodeAt(next) === CHAR_COLON) return null;
    return { target: { kind: 'delete', range: range.range }, nextIndex: next };
  }
  const insertAfterBlockEnd = scanKeyword(line, cursor, end, HL_INSERT_AFTER_BLOCK_KEYWORD);
  if (insertAfterBlockEnd !== null) {
    const anchor = scanLineNumber(line, skipWhitespace(line, insertAfterBlockEnd, end), end);
    if (anchor === null) return null;
    return {
      target: { kind: 'insert_after_block', anchor: { line: anchor.line } },
      nextIndex: consumeOptionalColon(line, anchor.nextIndex, end),
    };
  }
  const insertEnd = scanKeyword(line, cursor, end, HL_INSERT_KEYWORD);
  if (insertEnd !== null) return scanInsertTarget(line, insertEnd, end);
  return null;
}

function tryParseHunkHeader(line) {
  const end = trimEndIndex(line);
  const start = skipWhitespace(line, 0, end);
  if (start >= end) return null;
  const scan = scanHunkAnchor(line, start, end);
  if (scan === null) return null;
  if (scan.nextIndex !== end) return null;
  return { target: scan.target };
}

function tryParseHeader(line) {
  if (!line.startsWith(HL_FILE_PREFIX)) return null;
  const end = trimEndIndex(line);
  if (FILE_PREFIX_LENGTH + FILE_SUFFIX_LENGTH >= end) return null;
  if (!line.endsWith(HL_FILE_SUFFIX, end)) return null;
  const bodyEnd = end - FILE_SUFFIX_LENGTH;
  if (FILE_PREFIX_LENGTH >= bodyEnd) return null;

  let pathEnd = bodyEnd;
  let fileHash;
  const trailingHashStart = bodyEnd - HL_FILE_HASH_LENGTH - 1;
  if (trailingHashStart >= FILE_PREFIX_LENGTH && line.charCodeAt(trailingHashStart) === CHAR_HASH) {
    let allHex = true;
    for (let probe = trailingHashStart + 1; probe < bodyEnd; probe++) {
      if (!isHexDigitCode(line.charCodeAt(probe))) {
        allHex = false;
        break;
      }
    }
    if (allHex) {
      pathEnd = trailingHashStart;
      fileHash = line.slice(trailingHashStart + 1, bodyEnd).toLowerCase();
    }
  }

  // If no strict 64-hex tag found, scan for the *last* `#` in the body and
  // treat everything after it as a loose tag. This keeps compatibility with
  // callers that use short / non-hex tags (e.g. tests, the compatibility layer).
  if (fileHash === undefined) {
    let lastHash = -1;
    for (let i = FILE_PREFIX_LENGTH; i < bodyEnd; i++) {
      if (line.charCodeAt(i) === CHAR_HASH) lastHash = i;
    }
    if (lastHash > FILE_PREFIX_LENGTH && lastHash < bodyEnd - 1) {
      pathEnd = lastHash;
      fileHash = line.slice(lastHash + 1, bodyEnd);
    }
  }

  // Path portion must not contain `#` after we've extracted the tag.
  for (let i = FILE_PREFIX_LENGTH; i < pathEnd; i++) {
    if (line.charCodeAt(i) === CHAR_HASH) return null;
  }

  if (pathEnd === FILE_PREFIX_LENGTH) return null;
  const path = line.slice(FILE_PREFIX_LENGTH, pathEnd);
  return fileHash !== undefined ? { path, fileHash } : { path };
}

function classifyLine(line, lineNum) {
  if (isEmptyLine(line)) return { kind: 'blank', lineNum };
  if (markerLineEquals(line, BEGIN_PATCH_MARKER)) return { kind: 'envelope-begin', lineNum };
  if (markerLineEquals(line, END_PATCH_MARKER)) return { kind: 'envelope-end', lineNum };
  if (markerLineEquals(line, ABORT_MARKER)) return { kind: 'abort', lineNum };
  // Legacy ABORT: standalone "ABORT" line
  const trimmed = line.trim();
  if (trimmed === 'ABORT') return { kind: 'abort', lineNum };
  const firstCode = line.charCodeAt(0);
  if (line.startsWith(HL_FILE_PREFIX)) {
    const header = tryParseHeader(line);
    if (header !== null) {
      return header.fileHash !== undefined
        ? { kind: 'header', lineNum, path: header.path, fileHash: header.fileHash }
        : { kind: 'header', lineNum, path: header.path };
    }
  }
  const lead = skipWhitespace(line, 0);
  const firstUp = String.fromCharCode(line.charCodeAt(lead)).toUpperCase();
  const isHunkLead =
    line.startsWith(HL_REPLACE_KEYWORD, lead) ||
    line.startsWith(HL_DELETE_KEYWORD, lead) ||
    line.startsWith(HL_INSERT_KEYWORD, lead) ||
    line.startsWith(HL_REM_KEYWORD, lead) ||
    line.startsWith(HL_MOVE_KEYWORD, lead) ||
    firstUp === 'S' ||
    firstUp === 'D' ||
    firstUp === 'I';
  if (isHunkLead) {
    const hunk = tryParseHunkHeader(line);
    if (hunk !== null) return { kind: 'op-block', lineNum, target: hunk.target };
  }
  if (firstCode === CHAR_PAYLOAD_REPLACE)
    return { kind: 'payload-literal', lineNum, text: line.slice(1) };
  return { kind: 'raw', lineNum, text: line };
}

export class Tokenizer {
  #buffer = '';
  #nextLineNum = 1;
  #closed = false;

  feed(chunk) {
    if (this.#closed) throw new Error('Tokenizer is closed; call reset() before reusing.');
    if (chunk.length === 0) return [];
    this.#buffer = this.#buffer ? this.#buffer + chunk : chunk;
    return this.#drainCompleteLines();
  }

  end() {
    if (this.#closed) return [];
    this.#closed = true;
    const buf = this.#buffer;
    this.#buffer = '';
    if (buf.length === 0) return [];
    let stop = buf.length;
    if (buf.charCodeAt(stop - 1) === CHAR_CARRIAGE_RETURN) stop--;
    return [classifyLine(buf.slice(0, stop), this.#nextLineNum++)];
  }

  reset() {
    this.#buffer = '';
    this.#nextLineNum = 1;
    this.#closed = false;
  }

  tokenizeAll(text) {
    this.reset();
    const first = this.feed(text);
    const last = this.end();
    return last.length === 0 ? first : first.concat(last);
  }

  tokenize(line, lineNum = 0) {
    return classifyLine(line, lineNum);
  }

  isOp(line) {
    return tryParseHunkHeader(line) !== null;
  }

  isHeader(line) {
    return tryParseHeader(line) !== null;
  }

  isEnvelopeMarker(line) {
    return (
      markerLineEquals(line, BEGIN_PATCH_MARKER) ||
      markerLineEquals(line, END_PATCH_MARKER) ||
      markerLineEquals(line, ABORT_MARKER)
    );
  }

  #drainCompleteLines() {
    const tokens = [];
    const buf = this.#buffer;
    let start = 0;
    for (let index = 0; index < buf.length; index++) {
      if (buf.charCodeAt(index) !== CHAR_LINE_FEED) continue;
      let stop = index;
      if (stop > start && buf.charCodeAt(stop - 1) === CHAR_CARRIAGE_RETURN) stop--;
      tokens.push(classifyLine(buf.slice(start, stop), this.#nextLineNum++));
      start = index + 1;
    }
    this.#buffer = start < buf.length ? buf.slice(start) : '';
    return tokens;
  }
}

export { scanHeaderRange, scanLineNumber, trimEndIndex, skipWhitespace };
