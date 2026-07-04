/**
 * Apply a parsed list of `Edit`s to a text body and return the post-edit
 * lines plus any diagnostic warnings. Pure function: no FS, no mutation of
 * the input.
 *
 * Replacement groups are first normalized by `repairReplacementBoundaries`,
 * which absorbs common model mistakes where a payload restates unchanged
 * range boundaries or duplicates/drops structural closers.
 *
 */

import {
  afterInsertLandingShiftWarning,
  blockInsertLandingShiftWarning,
  UNRESOLVED_BLOCK_INTERNAL,
} from './messages.js';
import { cloneCursor } from './tokenizer.js';

function isReplacementInsert(edit) {
  return edit.kind === 'insert' && edit.mode === 'replacement';
}

function getCursorAnchors(cursor) {
  return cursor.kind === 'before_anchor' || cursor.kind === 'after_anchor' ? [cursor.anchor] : [];
}

function getEditAnchors(edit) {
  if (edit.kind === 'delete') return [edit.anchor];
  return getCursorAnchors(edit.cursor);
}

function trailingPhantomLine(fileLines) {
  // `split("\n")` on a newline-terminated file yields a trailing "" sentinel.
  // It is addressable for inserts (append-past-end), but it is not real
  // content. Deleting it only strips the file's final newline, so ignore delete
  // edits that land there; inclusive ranges ending at EOF then do the intended
  // thing and delete through the last concrete line.
  return fileLines.length > 1 && fileLines[fileLines.length - 1] === '' ? fileLines.length : 0;
}

function dropTrailingPhantomDeletes(edits, fileLines) {
  const phantomLine = trailingPhantomLine(fileLines);
  if (phantomLine === 0) return edits;
  return edits.filter((edit) => edit.kind !== 'delete' || edit.anchor.line !== phantomLine);
}

/**
 * Verify every anchored edit points at an existing line. File-version binding is
 * checked once per section via the header hash before this function runs.
 */
function validateLineBounds(edits, fileLines) {
  for (const edit of edits) {
    for (const anchor of getEditAnchors(edit)) {
      if (anchor.line < 1 || anchor.line > fileLines.length) {
        throw new Error(`Line ${anchor.line} does not exist (file has ${fileLines.length} lines)`);
      }
    }
  }
}

function cloneAppliedEdit(edit, index) {
  if (edit.kind === 'delete') return { ...edit, anchor: { ...edit.anchor }, index };
  return { ...edit, cursor: cloneCursor(edit.cursor), index };
}

function insertAtStart(fileLines, lineOrigins, lines) {
  if (lines.length === 0) return;
  const origins = lines.map(() => 'insert');
  if (fileLines.length === 1 && fileLines[0] === '') {
    fileLines.splice(0, 1, ...lines);
    lineOrigins.splice(0, 1, ...origins);
    return;
  }
  fileLines.splice(0, 0, ...lines);
  lineOrigins.splice(0, 0, ...origins);
}

function insertAtEnd(fileLines, lineOrigins, lines) {
  if (lines.length === 0) return undefined;
  const origins = lines.map(() => 'insert');
  if (fileLines.length === 1 && fileLines[0] === '') {
    fileLines.splice(0, 1, ...lines);
    lineOrigins.splice(0, 1, ...origins);
    return 1;
  }
  const hasTrailingNewline = fileLines.length > 0 && fileLines[fileLines.length - 1] === '';
  const insertIndex = hasTrailingNewline ? fileLines.length - 1 : fileLines.length;
  fileLines.splice(insertIndex, 0, ...lines);
  lineOrigins.splice(insertIndex, 0, ...origins);
  return insertIndex + 1;
}

function bucketAnchorEditsByLine(edits) {
  const byLine = new Map();
  for (const entry of edits) {
    const line =
      entry.edit.kind === 'delete'
        ? entry.edit.anchor.line
        : entry.edit.cursor.kind === 'before_anchor' || entry.edit.cursor.kind === 'after_anchor'
          ? entry.edit.cursor.anchor.line
          : 0;
    const bucket = byLine.get(line);
    if (bucket) bucket.push(entry);
    else byLine.set(line, [entry]);
  }
  return byLine;
}

// ═══════════════════════════════════════════════════════════════════════════
// Replacement-boundary repair
// ─────────────────────────────────────────────────────────────────────────────

/** A line that is nothing but closing delimiters: `}`, `)`, `];`, `})`, `},`. */
export const STRUCTURAL_CLOSER_RE = /^\s*[)\]}]+[;,]?\s*$/;

/** A JSX/XML closing boundary that carries structure but no bracket tokens. */
const JSX_CLOSER_RE = /^\s*(?:<\/>|<\/[A-Za-z][\w.:-]*>|\/>)\s*[;,]?\s*$/;
const JSX_NAMED_CLOSER_RE = /^\s*<\/([A-Za-z][\w.:-]*)>\s*[;,]?\s*$/;
const JSX_FRAGMENT_CLOSER_RE = /^\s*<\/>\s*[;,]?\s*$/;

function isStructuralCloserLine(text) {
  return STRUCTURAL_CLOSER_RE.test(text) || JSX_CLOSER_RE.test(text);
}

function jsxCloserName(text) {
  if (JSX_FRAGMENT_CLOSER_RE.test(text)) return '';
  const match = JSX_NAMED_CLOSER_RE.exec(text);
  return match?.[1];
}

function isJsxTagStart(text, index) {
  const next = text[index + 1];
  return (
    next === '>' || next === '/' || (next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z')
  );
}

function findJsxTagEnd(text, start) {
  let quote;
  let braces = 0;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && i + 1 < text.length) {
        i++;
      } else if (ch === quote) {
        quote = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      braces++;
    } else if (ch === '}' && braces > 0) {
      braces--;
    } else if (ch === '>' && braces === 0) {
      return i;
    }
  }
  return -1;
}

function parseJsxPayloadTag(raw) {
  if (raw === '<>') return { name: '', closing: false, selfClosing: false };
  if (raw === '</>') return { name: '', closing: true, selfClosing: false };
  const closing = raw.startsWith('</');
  const nameStart = closing ? 2 : 1;
  let nameEnd = nameStart;
  while (nameEnd < raw.length && /[\w.:-]/.test(raw[nameEnd])) nameEnd++;
  if (nameEnd === nameStart) return undefined;
  return {
    name: raw.slice(nameStart, nameEnd),
    closing,
    selfClosing: !closing && /\/>\s*$/.test(raw),
  };
}

function readJsxPayloadTags(text) {
  const tags = [];
  for (let start = text.indexOf('<'); start >= 0; start = text.indexOf('<', start + 1)) {
    if (!isJsxTagStart(text, start)) continue;
    const end = findJsxTagEnd(text, start);
    if (end < 0) break;
    const tag = parseJsxPayloadTag(text.slice(start, end + 1));
    if (tag) tags.push(tag);
    start = end;
  }
  return tags;
}

function payloadHasJsxOpenerForEcho(payloadPrefix, echoLines) {
  const openTags = [];
  for (const tag of readJsxPayloadTags(payloadPrefix.join('\n'))) {
    if (tag.closing) {
      if (openTags[openTags.length - 1] === tag.name) openTags.pop();
    } else if (!tag.selfClosing) {
      openTags.push(tag.name);
    }
  }
  for (const line of echoLines) {
    const name = jsxCloserName(line);
    if (name !== undefined && openTags.includes(name)) return true;
  }
  return false;
}

/**
 * Net `()` / `[]` / `{}` delta across `lines`, skipping delimiters inside line
 * comments (`//`), block comments, and string/template literals. Block-comment
 * and backtick-template state carry across lines; `"` / `'` reset at EOL since
 * they cannot span lines. Deliberately language-light.
 */
function computeDelimiterBalance(lines) {
  const balance = { paren: 0, bracket: 0, brace: 0 };
  let inBlockComment = false;
  let quote = '';
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inBlockComment) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '/' && line[i + 1] === '/') break;
      if (ch === '/' && line[i + 1] === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      switch (ch) {
        case '(':
          balance.paren++;
          break;
        case ')':
          balance.paren--;
          break;
        case '[':
          balance.bracket++;
          break;
        case ']':
          balance.bracket--;
          break;
        case '{':
          balance.brace++;
          break;
        case '}':
          balance.brace--;
          break;
      }
    }
    if (quote === '"' || quote === "'") quote = '';
  }
  return balance;
}

function balanceDelta(a, b) {
  return { paren: a.paren - b.paren, bracket: a.bracket - b.bracket, brace: a.brace - b.brace };
}

function balanceNegate(a) {
  return { paren: -a.paren, bracket: -a.bracket, brace: -a.brace };
}

function balanceEqual(a, b) {
  return a.paren === b.paren && a.bracket === b.bracket && a.brace === b.brace;
}

function balanceIsZero(a) {
  return a.paren === 0 && a.bracket === 0 && a.brace === 0;
}

function balanceSum(a, b) {
  return { paren: a.paren + b.paren, bracket: a.bracket + b.bracket, brace: a.brace + b.brace };
}

function balanceComponentCovers(candidate, target) {
  if (target === 0) return true;
  return candidate > 0 === target > 0 && Math.abs(candidate) >= Math.abs(target);
}

function balanceCovers(candidate, target) {
  return (
    balanceComponentCovers(candidate.paren, target.paren) &&
    balanceComponentCovers(candidate.bracket, target.bracket) &&
    balanceComponentCovers(candidate.brace, target.brace)
  );
}

/**
 * Detect a replacement group starting at `start`: a run of `before_anchor`
 * replacement inserts sharing one source op line, immediately followed by the
 * contiguous range deletes for that same op. Mirrors how the parser lowers an
 * `replace N.=M:` hunk with a body.
 */
function findReplacementGroup(edits, start) {
  const first = edits[start];
  if (
    first?.kind !== 'insert' ||
    first.mode !== 'replacement' ||
    first.cursor.kind !== 'before_anchor'
  ) {
    return undefined;
  }
  const { lineNum } = first;
  const anchorLine = first.cursor.anchor.line;
  const insertIndices = [];
  const payload = [];
  let i = start;
  for (; i < edits.length; i++) {
    const edit = edits[i];
    if (edit.kind !== 'insert' || edit.mode !== 'replacement' || edit.lineNum !== lineNum) break;
    if (edit.cursor.kind !== 'before_anchor' || edit.cursor.anchor.line !== anchorLine) break;
    insertIndices.push(i);
    payload.push(edit.text);
  }
  const deleteIndices = [];
  let expectedLine = anchorLine;
  for (; i < edits.length; i++) {
    const edit = edits[i];
    if (edit.kind !== 'delete' || edit.lineNum !== lineNum || edit.anchor.line !== expectedLine)
      break;
    deleteIndices.push(i);
    expectedLine++;
  }
  if (deleteIndices.length === 0) return undefined;
  return {
    insertIndices,
    deleteIndices,
    payload,
    startLine: anchorLine,
    endLine: anchorLine + deleteIndices.length - 1,
  };
}

/**
 * Largest `k` such that the payload's last `k` lines exactly equal the `k`
 * surviving file lines just below the range AND dropping them zeroes `delta`.
 */
function findDuplicateSuffix(group, fileLines, delta) {
  if (balanceIsZero(delta)) return 0;
  const { payload, endLine } = group;
  const maxK = Math.min(payload.length, fileLines.length - endLine);
  for (let k = maxK; k >= 1; k--) {
    let matches = true;
    for (let t = 0; t < k; t++) {
      if (payload[payload.length - k + t] !== fileLines[endLine + t]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (balanceEqual(computeDelimiterBalance(payload.slice(payload.length - k)), delta)) return k;
  }
  return 0;
}

/**
 * Largest `j` such that the payload's first `j` lines exactly equal the `j`
 * surviving file lines just above the range AND dropping them zeroes `delta`.
 */
function findDuplicatePrefix(group, fileLines, delta) {
  if (balanceIsZero(delta)) return 0;
  const { payload, startLine } = group;
  const maxJ = Math.min(payload.length, startLine - 1);
  for (let j = maxJ; j >= 1; j--) {
    let matches = true;
    for (let t = 0; t < j; t++) {
      if (payload[t] !== fileLines[startLine - 1 - j + t]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (balanceEqual(computeDelimiterBalance(payload.slice(0, j)), delta)) return j;
  }
  return 0;
}

function countPayloadRestatedSuffixHead(payload, suffixLines) {
  const maxCount = Math.min(payload.length, suffixLines.length);
  for (let count = maxCount; count >= 1; count--) {
    let matches = true;
    for (let offset = 0; offset < count; offset++) {
      if (payload[payload.length - count + offset] !== suffixLines[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return count;
  }
  return 0;
}

function countProjectedBelowSuffixTail(
  group,
  fileLines,
  deletedLines,
  insertedLineMaps,
  suffixLines,
) {
  const below = [];
  const appendCloserLines = (lines) => {
    if (!lines) return true;
    for (const text of lines) {
      if (!STRUCTURAL_CLOSER_RE.test(text)) return false;
      below.push(text);
    }
    return true;
  };
  if (!appendCloserLines(insertedLineMaps.after.get(group.endLine))) return 0;
  for (let line = group.endLine + 1; line <= fileLines.length; line++) {
    if (!appendCloserLines(insertedLineMaps.before.get(line))) break;
    if (!deletedLines.has(line)) {
      const text = fileLines[line - 1] ?? '';
      if (!STRUCTURAL_CLOSER_RE.test(text)) break;
      below.push(text);
    }
    if (!appendCloserLines(insertedLineMaps.after.get(line))) break;
  }
  const maxCount = Math.min(below.length, suffixLines.length);
  for (let count = maxCount; count >= 1; count--) {
    let matches = true;
    for (let offset = 0; offset < count; offset++) {
      if (below[offset] !== suffixLines[suffixLines.length - count + offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return count;
  }
  return 0;
}

function computeProjectedPrefixBalance(
  group,
  fileLines,
  deletedLines,
  insertedByLine,
  insertedLineMaps,
) {
  const prefix = [];
  for (let line = 1; line < group.startLine; line++) {
    const inserted = insertedByLine.get(line);
    if (inserted) prefix.push(...inserted);
    if (!deletedLines.has(line)) prefix.push(fileLines[line - 1] ?? '');
  }
  const insertedAtStart = insertedLineMaps.before.get(group.startLine);
  if (insertedAtStart) prefix.push(...insertedAtStart);
  prefix.push(...group.payload);
  return computeDelimiterBalance(prefix);
}

function prefixCanCoverSuffixClosers(
  group,
  fileLines,
  suffixBalance,
  coveredBelowBalance,
  deletedLines,
  insertedByLine,
  insertedLineMaps,
) {
  const neededOpeners = balanceNegate(suffixBalance);
  const prefixBalance = computeProjectedPrefixBalance(
    group,
    fileLines,
    deletedLines,
    insertedByLine,
    insertedLineMaps,
  );
  const uncoveredPrefixBalance = balanceSum(prefixBalance, coveredBelowBalance);
  return balanceCovers(uncoveredPrefixBalance, neededOpeners);
}

/**
 * Missing segment of the range's deleted structural-closer suffix that should
 * be spared.
 */
function findDroppedSuffixClosers(
  group,
  fileLines,
  delta,
  remainingDelta,
  deletedPrefixBalance,
  deletedLines,
  insertedByLine,
  insertedLineMaps,
) {
  let suffixLength = 0;
  while (
    suffixLength < group.deleteIndices.length &&
    STRUCTURAL_CLOSER_RE.test(fileLines[group.endLine - suffixLength - 1] ?? '')
  ) {
    suffixLength++;
  }
  if (suffixLength === 0) return undefined;

  const suffixStartLine = group.endLine - suffixLength + 1;
  const suffixLines = fileLines.slice(group.endLine - suffixLength, group.endLine);
  const restatedHead = countPayloadRestatedSuffixHead(group.payload, suffixLines);
  const coveredTail = countProjectedBelowSuffixTail(
    group,
    fileLines,
    deletedLines,
    insertedLineMaps,
    suffixLines,
  );
  const keepStart = restatedHead;
  const keepEnd = suffixLength - coveredTail;
  if (keepStart >= keepEnd) return undefined;

  const keptLines = suffixLines.slice(keepStart, keepEnd);
  const keptBalance = computeDelimiterBalance(keptLines);
  const neededOpeners = balanceNegate(keptBalance);
  const coveredBelowBalance = computeDelimiterBalance(suffixLines.slice(keepEnd));
  if (!balanceCovers(delta, neededOpeners)) return undefined;
  if (balanceCovers(deletedPrefixBalance, neededOpeners)) return undefined;
  if (!balanceCovers(remainingDelta, neededOpeners)) return undefined;
  if (
    !prefixCanCoverSuffixClosers(
      group,
      fileLines,
      keptBalance,
      coveredBelowBalance,
      deletedLines,
      insertedByLine,
      insertedLineMaps,
    )
  ) {
    return undefined;
  }
  return {
    startLine: suffixStartLine + keepStart,
    count: keepEnd - keepStart,
    balance: keptBalance,
  };
}

function hasNonWhitespace(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 11 && code !== 12 && code !== 13 && code !== 32)
      return true;
  }
  return false;
}

function countDuplicateLeadingBoundaryLines(group, fileLines) {
  const { payload, startLine } = group;
  const max = Math.min(payload.length, startLine - 1);
  for (let count = max; count >= 1; count--) {
    let matches = true;
    let hasContent = false;
    for (let offset = 0; offset < count; offset++) {
      const line = payload[offset];
      if (line !== fileLines[startLine - 1 - count + offset]) {
        matches = false;
        break;
      }
      if (!hasContent && hasNonWhitespace(line)) hasContent = true;
    }
    if (matches && hasContent) return count;
  }
  return 0;
}

function countDuplicateTrailingBoundaryLines(group, fileLines) {
  const { payload, endLine } = group;
  const max = Math.min(payload.length, fileLines.length - endLine);
  for (let count = max; count >= 1; count--) {
    let matches = true;
    let hasContent = false;
    for (let offset = 0; offset < count; offset++) {
      const line = payload[payload.length - count + offset];
      if (line !== fileLines[endLine + offset]) {
        matches = false;
        break;
      }
      if (!hasContent && hasNonWhitespace(line)) hasContent = true;
    }
    if (matches && hasContent) return count;
  }
  return 0;
}

function findBoundaryEcho(group, fileLines) {
  const leadingMax = countDuplicateLeadingBoundaryLines(group, fileLines);
  if (leadingMax === 0) return undefined;
  const trailingMax = countDuplicateTrailingBoundaryLines(group, fileLines);
  if (trailingMax === 0) return undefined;
  if (leadingMax + trailingMax >= group.payload.length) return undefined;
  const leadingBalance = computeDelimiterBalance(group.payload.slice(0, leadingMax));
  const trailingBalance = computeDelimiterBalance(
    group.payload.slice(group.payload.length - trailingMax),
  );
  const droppedBalance = balanceDelta(leadingBalance, balanceNegate(trailingBalance));
  if (!balanceIsZero(droppedBalance)) {
    const delta = balanceDelta(
      computeDelimiterBalance(group.payload),
      computeDelimiterBalance(fileLines.slice(group.startLine - 1, group.endLine)),
    );
    if (!balanceEqual(droppedBalance, delta)) return undefined;
  }
  return { leading: leadingMax, trailing: trailingMax };
}

function describeBoundaryEchoRepair(group, echo) {
  return (
    `Auto-repaired a replacement boundary echo at line ${group.startLine}: ` +
    `dropped ${echo.leading} leading and ${echo.trailing} trailing payload line(s) already present outside the range. ` +
    `Issue the payload as the final desired content for the selected range only — never restate unchanged lines bordering the range.`
  );
}

function describeBoundaryRepair(group, action) {
  return (
    `Auto-repaired a delimiter-balance mismatch in the replacement at line ${group.startLine}: ${action}. ` +
    `Issue the payload as the final desired content only — never restate or omit a closing bracket bordering the range.`
  );
}

function findOneSidedBoundaryEcho(group, fileLines) {
  const leading = countDuplicateLeadingBoundaryLines(group, fileLines);
  const trailing = countDuplicateTrailingBoundaryLines(group, fileLines);
  if (leading > 0 === trailing > 0) return undefined;
  const side = leading > 0 ? 'leading' : 'trailing';
  const count = leading > 0 ? leading : trailing;
  if (count >= group.payload.length) return undefined;
  const echoLines =
    side === 'leading'
      ? group.payload.slice(0, count)
      : group.payload.slice(group.payload.length - count);
  if (!balanceIsZero(computeDelimiterBalance(echoLines))) return undefined;
  if (group.deleteIndices.length <= 1) {
    if (side !== 'trailing' || !echoLines.every(isStructuralCloserLine)) return undefined;
    const payloadPrefix = group.payload.slice(0, group.payload.length - count);
    if (payloadHasJsxOpenerForEcho(payloadPrefix, echoLines)) return undefined;
  }
  return { side, count };
}

function describeOneSidedEchoRepair(group, side, count) {
  const where = side === 'leading' ? 'above' : 'below';
  return (
    `Auto-repaired a replacement boundary echo at line ${group.startLine}: ` +
    `dropped ${count} ${side} payload line(s) identical to the surviving line(s) just ${where} the range. ` +
    `The range was one line short of the content you retyped — issue the payload as the final content for the ` +
    `selected range only, and widen the range to consume any keeper you restate.`
  );
}

function netDeletedPrefixBalance(group, deletedLines, insertedByLine, fileLines) {
  const deleted = [];
  const inserted = [];
  for (let line = group.startLine - 1; line >= 1 && deletedLines.has(line); line--) {
    deleted.unshift(fileLines[line - 1] ?? '');
    const insertedAtLine = insertedByLine.get(line);
    if (insertedAtLine) inserted.unshift(...insertedAtLine);
  }
  return balanceDelta(computeDelimiterBalance(deleted), computeDelimiterBalance(inserted));
}

function slotPatchDelta(slot, fileLines) {
  if (slot.kind === 'candidate') return slot.delta;
  const inserted = [];
  const deleted = [];
  for (const edit of slot.edits) {
    if (edit.kind === 'insert') inserted.push(edit.text);
    else deleted.push(fileLines[edit.anchor.line - 1] ?? '');
  }
  return balanceDelta(computeDelimiterBalance(inserted), computeDelimiterBalance(deleted));
}

/**
 * Normalize replacement groups so common off-by-one boundaries do not duplicate
 * unchanged surrounding lines or wrongly drop/keep structural closers.
 */
function repairReplacementBoundaries(edits, fileLines) {
  const slots = [];
  let i = 0;
  while (i < edits.length) {
    const group = findReplacementGroup(edits, i);
    if (!group) {
      slots.push({ kind: 'edits', edits: [edits[i]] });
      i++;
      continue;
    }
    const inserts = group.insertIndices.map((idx) => edits[idx]);
    const deletes = group.deleteIndices.map((idx) => edits[idx]);
    i = group.deleteIndices[group.deleteIndices.length - 1] + 1;

    const boundaryEcho = findBoundaryEcho(group, fileLines);
    if (boundaryEcho) {
      slots.push({
        kind: 'edits',
        edits: [
          ...inserts.slice(boundaryEcho.leading, inserts.length - boundaryEcho.trailing),
          ...deletes,
        ],
        warning: describeBoundaryEchoRepair(group, boundaryEcho),
      });
      continue;
    }

    const delta = balanceDelta(
      computeDelimiterBalance(group.payload),
      computeDelimiterBalance(fileLines.slice(group.startLine - 1, group.endLine)),
    );
    if (balanceIsZero(delta)) {
      const oneSided = findOneSidedBoundaryEcho(group, fileLines);
      if (oneSided) {
        const trimmed =
          oneSided.side === 'leading'
            ? inserts.slice(oneSided.count)
            : inserts.slice(0, inserts.length - oneSided.count);
        slots.push({
          kind: 'edits',
          edits: [...trimmed, ...deletes],
          warning: describeOneSidedEchoRepair(group, oneSided.side, oneSided.count),
        });
        continue;
      }
      slots.push({ kind: 'edits', edits: [...inserts, ...deletes] });
      continue;
    }

    const dupSuffix = findDuplicateSuffix(group, fileLines, delta);
    if (dupSuffix > 0) {
      slots.push({
        kind: 'edits',
        edits: [...inserts.slice(0, inserts.length - dupSuffix), ...deletes],
        warning: describeBoundaryRepair(
          group,
          `dropped ${dupSuffix} duplicated trailing payload line(s) already present below the range`,
        ),
      });
      continue;
    }
    const dupPrefix = findDuplicatePrefix(group, fileLines, delta);
    if (dupPrefix > 0) {
      slots.push({
        kind: 'edits',
        edits: [...inserts.slice(dupPrefix), ...deletes],
        warning: describeBoundaryRepair(
          group,
          `dropped ${dupPrefix} duplicated leading payload line(s) already present above the range`,
        ),
      });
      continue;
    }
    slots.push({ kind: 'candidate', group, inserts, deletes, delta });
  }

  const projected = [];
  for (const slot of slots) {
    projected.push(
      ...(slot.kind === 'candidate' ? [...slot.inserts, ...slot.deletes] : slot.edits),
    );
  }
  const deletedLines = new Set();
  for (const edit of projected) {
    if (edit.kind === 'delete') deletedLines.add(edit.anchor.line);
  }
  const insertedByLine = new Map();
  const insertedLineMaps = { before: new Map(), after: new Map() };
  for (const edit of projected) {
    if (edit.kind !== 'insert') continue;
    for (const anchor of getCursorAnchors(edit.cursor)) {
      const lines = insertedByLine.get(anchor.line);
      if (lines) lines.push(edit.text);
      else insertedByLine.set(anchor.line, [edit.text]);
    }
    if (edit.cursor.kind === 'before_anchor' || edit.cursor.kind === 'after_anchor') {
      const bySide =
        edit.cursor.kind === 'before_anchor' ? insertedLineMaps.before : insertedLineMaps.after;
      const lines = bySide.get(edit.cursor.anchor.line);
      if (lines) lines.push(edit.text);
      else bySide.set(edit.cursor.anchor.line, [edit.text]);
    }
  }
  let remainingDelta = { paren: 0, bracket: 0, brace: 0 };
  for (const slot of slots)
    remainingDelta = balanceSum(remainingDelta, slotPatchDelta(slot, fileLines));

  const out = [];
  const warnings = [];
  for (const slot of slots) {
    if (slot.kind !== 'candidate') {
      if (slot.warning !== undefined) warnings.push(slot.warning);
      out.push(...slot.edits);
      continue;
    }
    const deletedPrefixBalance = netDeletedPrefixBalance(
      slot.group,
      deletedLines,
      insertedByLine,
      fileLines,
    );
    const droppedClosers = findDroppedSuffixClosers(
      slot.group,
      fileLines,
      slot.delta,
      remainingDelta,
      deletedPrefixBalance,
      deletedLines,
      insertedByLine,
      insertedLineMaps,
    );
    if (droppedClosers) {
      warnings.push(
        describeBoundaryRepair(
          slot.group,
          `kept ${droppedClosers.count} structural closing line(s) the range deleted without restating`,
        ),
      );
      out.push(
        ...slot.inserts,
        ...slot.deletes.filter(
          (edit) =>
            edit.kind !== 'delete' ||
            edit.anchor.line < droppedClosers.startLine ||
            edit.anchor.line >= droppedClosers.startLine + droppedClosers.count,
        ),
      );
      for (
        let line = droppedClosers.startLine;
        line < droppedClosers.startLine + droppedClosers.count;
        line++
      ) {
        deletedLines.delete(line);
      }
      remainingDelta = balanceSum(remainingDelta, droppedClosers.balance);
      continue;
    }
    out.push(...slot.inserts, ...slot.deletes);
  }
  return { edits: out, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// After-insert landing correction
// ─────────────────────────────────────────────────────────────────────────────

function leadingIndent(line) {
  let end = 0;
  while (end < line.length) {
    const code = line.charCodeAt(end);
    if (code !== 9 && code !== 32) break;
    end++;
  }
  return line.slice(0, end);
}

function isIndentDeeper(deeper, shallower) {
  return deeper.length > shallower.length && deeper.startsWith(shallower);
}

/**
 * Depth of an after-insert hunk's body: the shallowest indentation across its
 * non-blank rows.
 */
function bodyTargetIndent(rows) {
  const nonBlank = rows.filter(hasNonWhitespace);
  if (nonBlank.length === 0) return undefined;
  if (nonBlank.every((row) => STRUCTURAL_CLOSER_RE.test(row))) return undefined;
  let target = leadingIndent(nonBlank[0] ?? '');
  for (const row of nonBlank) {
    const indent = leadingIndent(row);
    if (indent.startsWith(target)) continue;
    if (target.startsWith(indent)) target = indent;
    else return undefined;
  }
  return target;
}

function resolveShiftedLanding(group, target, fileLines, targetedLines) {
  const anchorText = fileLines[group.anchor - 1];
  if (anchorText === undefined || !hasNonWhitespace(anchorText)) return undefined;
  if (!isIndentDeeper(leadingIndent(anchorText), target)) return undefined;

  let landing = group.anchor;
  let crossed = 0;
  for (let line = group.anchor + 1; line <= fileLines.length; line++) {
    const text = fileLines[line - 1] ?? '';
    if (!hasNonWhitespace(text)) continue;
    if (!STRUCTURAL_CLOSER_RE.test(text)) break;
    const indent = leadingIndent(text);
    if (!indent.startsWith(target)) break;
    if (targetedLines.has(line)) return undefined;
    landing = line;
    crossed++;
    if (indent.length === target.length) break;
  }
  return landing === group.anchor ? undefined : { line: landing, crossed };
}

function resolveInwardLanding(group, target, blockStart, fileLines, targetedLines) {
  const anchorText = fileLines[group.anchor - 1];
  if (anchorText === undefined || !hasNonWhitespace(anchorText)) return undefined;
  if (!STRUCTURAL_CLOSER_RE.test(anchorText)) return undefined;
  if (!isIndentDeeper(target, leadingIndent(anchorText))) return undefined;

  let landing = group.anchor;
  for (let line = group.anchor; line > blockStart; line--) {
    const text = fileLines[line - 1] ?? '';
    if (!hasNonWhitespace(text)) {
      landing = line - 1;
      continue;
    }
    if (!STRUCTURAL_CLOSER_RE.test(text)) break;
    const indent = leadingIndent(text);
    if (!isIndentDeeper(target, indent)) break;
    if (line !== group.anchor && targetedLines.has(line)) return undefined;
    landing = line - 1;
  }
  return landing === group.anchor ? undefined : landing;
}

function repairAfterInsertLandings(edits, fileLines) {
  const groups = new Map();
  edits.forEach((edit, idx) => {
    if (edit.kind !== 'insert' || edit.mode === 'replacement') return;
    if (edit.cursor.kind !== 'after_anchor') return;
    const key = `${edit.cursor.anchor.line}:${edit.lineNum}`;
    const group = groups.get(key);
    if (group === undefined)
      groups.set(key, {
        anchor: edit.cursor.anchor.line,
        members: [idx],
        blockStart: edit.blockStart,
      });
    else group.members.push(idx);
  });
  if (groups.size === 0) return { edits, warnings: [] };

  const targetedLines = new Set();
  for (const edit of edits) {
    if (edit.kind === 'delete') targetedLines.add(edit.anchor.line);
    else if (edit.cursor.kind === 'before_anchor' || edit.cursor.kind === 'after_anchor')
      targetedLines.add(edit.cursor.anchor.line);
  }

  let out;
  const warnings = [];
  const retarget = (group, line) => {
    if (out === undefined) out = [...edits];
    for (const idx of group.members) {
      const edit = out[idx];
      out[idx] = { ...edit, cursor: { kind: 'after_anchor', anchor: { line } } };
    }
  };
  for (const group of groups.values()) {
    const target = bodyTargetIndent(group.members.map((idx) => edits[idx].text));
    if (target === undefined) continue;
    const outward = resolveShiftedLanding(group, target, fileLines, targetedLines);
    if (outward !== undefined) {
      retarget(group, outward.line);
      warnings.push(afterInsertLandingShiftWarning(group.anchor, outward.line, outward.crossed));
      continue;
    }
    if (group.blockStart === undefined) continue;
    const inward = resolveInwardLanding(group, target, group.blockStart, fileLines, targetedLines);
    if (inward === undefined) continue;
    retarget(group, inward);
    warnings.push(blockInsertLandingShiftWarning(group.blockStart, group.anchor, inward));
  }
  return { edits: out ?? edits, warnings };
}

/**
 * Apply a parsed list of edits to a text body. Pure function — no I/O.
 *
 * Returns the post-edit text and the first changed line number (1-indexed).
 * Throws if an anchor is out of bounds.
 */
export function applyEdits(text, edits) {
  if (edits.length === 0) return { text, firstChangedLine: undefined };

  for (const edit of edits) {
    if (edit.kind === 'block') throw new Error(UNRESOLVED_BLOCK_INTERNAL);
  }

  const fileLines = text.split('\n');
  const lineOrigins = fileLines.map(() => 'original');

  let firstChangedLine;
  const trackFirstChanged = (line) => {
    if (firstChangedLine === undefined || line < firstChangedLine) firstChangedLine = line;
  };

  const targetEdits = dropTrailingPhantomDeletes(appliedEditsWithIndex(edits), fileLines);
  validateLineBounds(targetEdits, fileLines);
  const { edits: repaired, warnings: boundaryWarnings } = repairReplacementBoundaries(
    targetEdits,
    fileLines,
  );
  const { edits: landed, warnings: landingWarnings } = repairAfterInsertLandings(
    repaired,
    fileLines,
  );
  const warnings = [...boundaryWarnings, ...landingWarnings];

  const bofLines = [];
  const eofLines = [];
  const anchorEdits = [];
  landed.forEach((edit, idx) => {
    if (edit.kind === 'insert' && edit.cursor.kind === 'bof') {
      bofLines.push(edit.text);
    } else if (edit.kind === 'insert' && edit.cursor.kind === 'eof') {
      eofLines.push(edit.text);
    } else {
      anchorEdits.push({ edit, idx });
    }
  });

  const byLine = bucketAnchorEditsByLine(anchorEdits);
  for (const line of [...byLine.keys()].sort((a, b) => b - a)) {
    const bucket = byLine.get(line);
    if (!bucket) continue;
    bucket.sort((a, b) => a.idx - b.idx);

    const idx = line - 1;
    const currentLine = fileLines[idx] ?? '';
    const beforeInsertLines = [];
    const afterInsertLines = [];
    const replacementLines = [];
    let deleteLine = false;

    for (const { edit } of bucket) {
      if (isReplacementInsert(edit)) {
        replacementLines.push(edit.text);
      } else if (edit.kind === 'insert' && edit.cursor.kind === 'after_anchor') {
        afterInsertLines.push(edit.text);
      } else if (edit.kind === 'insert') {
        beforeInsertLines.push(edit.text);
      } else if (edit.kind === 'delete') {
        deleteLine = true;
      }
    }
    if (
      beforeInsertLines.length === 0 &&
      replacementLines.length === 0 &&
      afterInsertLines.length === 0 &&
      !deleteLine
    )
      continue;

    const replacement = deleteLine
      ? [...beforeInsertLines, ...replacementLines, ...afterInsertLines]
      : [...beforeInsertLines, ...replacementLines, currentLine, ...afterInsertLines];
    const origins = [];
    for (let i = 0; i < beforeInsertLines.length; i++) origins.push('insert');
    for (let i = 0; i < replacementLines.length; i++)
      origins.push(deleteLine ? 'replacement' : 'insert');
    if (!deleteLine) origins.push(lineOrigins[idx] ?? 'original');
    for (let i = 0; i < afterInsertLines.length; i++) origins.push('insert');

    fileLines.splice(idx, 1, ...replacement);
    lineOrigins.splice(idx, 1, ...origins);
    trackFirstChanged(line);
  }

  if (bofLines.length > 0) {
    insertAtStart(fileLines, lineOrigins, bofLines);
    trackFirstChanged(1);
  }
  const eofChangedLine = insertAtEnd(fileLines, lineOrigins, eofLines);
  if (eofChangedLine !== undefined) trackFirstChanged(eofChangedLine);

  const result = { text: fileLines.join('\n'), firstChangedLine };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

// Helper: `appliedEdits.map((edit, index) => cloneAppliedEdit(edit, index))`.
function appliedEditsWithIndex(edits) {
  return edits.map((edit, index) => cloneAppliedEdit(edit, index));
}
