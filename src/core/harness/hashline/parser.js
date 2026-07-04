/**
 * Token-driven state machine that turns a stream of `Token`s into a
 * flat list of `Edit`s. Sits between the `Tokenizer` and the applier.
 *
 */

import { HL_PAYLOAD_REPLACE, HL_RANGE_SEP } from './format.js';
import {
  BARE_BODY_AUTO_PIPED_WARNING,
  DELETE_BLOCK_TAKES_NO_BODY,
  DELETE_TAKES_NO_BODY,
  EMPTY_BLOCK,
  EMPTY_INSERT,
  MINUS_ROW_REJECTED,
  MOVE_TAKES_NO_BODY,
  REM_TAKES_NO_BODY,
} from './messages.js';
import { stripOneLeadingHashlinePrefix } from './prefixes.js';
import { cloneCursor, Tokenizer } from './tokenizer.js';

function validateRangeOrder(range, lineNum) {
  if (range.end.line < range.start.line) {
    throw new Error(
      `line ${lineNum}: range ${range.start.line}${HL_RANGE_SEP}${range.end.line} ends before it starts.`,
    );
  }
}

function expandRange(range) {
  const anchors = [];
  for (let line = range.start.line; line <= range.end.line; line++) anchors.push({ line });
  return anchors;
}

function isSkippableCommentLine(line) {
  return line.trimStart().startsWith('#');
}

/**
 * Stripped remainder of a bare `N: <value>` row that is a lone quoted or
 * numeric literal (optionally comma-terminated) — the shape of a numeric-keyed
 * dict/YAML body rather than read-output paste.
 */
const BARE_LITERAL_VALUE_RE = /^\s*(?:"[^"]*"|'[^']*'|[-+]?\d+(?:\.\d+)?)\s*,?\s*$/;

function detectApplyPatchContamination(text, _hasPending) {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return null;
  if (
    trimmed.startsWith('*** Update File:') ||
    trimmed.startsWith('*** Add File:') ||
    trimmed.startsWith('*** Delete File:') ||
    trimmed.startsWith('*** Move to:')
  ) {
    const preview = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
    return (
      `apply_patch sentinel ${JSON.stringify(preview)} is not valid in hashline. ` +
      'File sections start with `[path#HASH]` (no `Update File:` / `Add File:` keyword). ' +
      `Use \`SWAP N${HL_RANGE_SEP}M:\`, \`DEL N${HL_RANGE_SEP}M\`, or \`INS.PRE|POST|HEAD|TAIL:\` ops.`
    );
  }
  if (/^@@\s+[-+]?\d+,\d+\s+[-+]?\d+,\d+\s+@@/.test(trimmed)) {
    return (
      'unified-diff hunk header (`@@ -N,M +N,M @@`) is not valid in hashline. ' +
      `Use \`SWAP N${HL_RANGE_SEP}M:\`, \`DEL N${HL_RANGE_SEP}M\`, or \`INS.PRE|POST|HEAD|TAIL:\` ops.`
    );
  }
  if (trimmed.startsWith('@@')) {
    const preview = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
    return (
      `\`@@\`-bracketed hunk header ${JSON.stringify(preview)} is not valid in hashline. ` +
      `Drop the \`@@ ... @@\` brackets and write a verb header such as \`SWAP N${HL_RANGE_SEP}M:\`.`
    );
  }
  if (/^DEL\s+[1-9]\d*(?:\s*(?:\.\.|\.=|-|…|\s)\s*[1-9]\d*)?\s*:/.test(trimmed)) {
    return `\`DEL N${HL_RANGE_SEP}M\` has no colon and no body. Remove the colon and body rows.`;
  }
  if (/^[1-9]\d*\s*$/.test(trimmed)) {
    return `hunk headers need a verb. Use \`SWAP ${trimmed}${HL_RANGE_SEP}${trimmed}:\` to replace, or \`DEL ${trimmed}\` to delete.`;
  }
  const bareRange = /^([1-9]\d*)\s*[-. …=]+\s*([1-9]\d*)\s*:?$/.exec(trimmed);
  if (bareRange !== null) {
    return (
      `bare range hunk header ${JSON.stringify(trimmed)} is not valid. ` +
      `Hunk headers need a verb: write \`SWAP ${bareRange[1]}${HL_RANGE_SEP}${bareRange[2]}:\` or \`DEL ${bareRange[1]}${HL_RANGE_SEP}${bareRange[2]}\`.`
    );
  }
  return null;
}

export class Executor {
  #edits = [];
  #warnings = [];
  #editIndex = 0;
  #pending;
  #fileOp;
  #terminated = false;
  #skippableComments = [];

  #discardPendingSkippableComments() {
    this.#skippableComments = [];
  }

  #consumePendingSkippableComments() {
    if (this.#skippableComments.length === 0) return;
    for (const comment of this.#skippableComments) this.#handleRaw(comment.text, comment.lineNum);
    this.#skippableComments = [];
  }

  feed(token) {
    if (this.#terminated) return;
    switch (token.kind) {
      case 'envelope-begin':
        this.#consumePendingSkippableComments();
        return;
      case 'envelope-end':
        this.#consumePendingSkippableComments();
        this.#terminated = true;
        return;
      case 'abort':
        this.#consumePendingSkippableComments();
        this.#flushPending();
        this.#edits.push({ kind: 'abort', lineNum: token.lineNum });
        // Don't terminate — ABORT is a regular hunk type in project mode,
        // not a hard stop for parsing
        return;
      case 'header':
        this.#consumePendingSkippableComments();
        this.#flushPending();
        return;
      case 'blank':
        this.#consumePendingSkippableComments();
        this.#handleBlank('', token.lineNum);
        return;
      case 'payload-literal':
        this.#consumePendingSkippableComments();
        this.#handleLiteralPayload(token.text, token.lineNum);
        return;
      case 'raw':
        if (isSkippableCommentLine(token.text)) {
          if (this.#pending === undefined) {
            this.#skippableComments.push({ text: token.text, lineNum: token.lineNum });
          }
          return;
        }
        this.#consumePendingSkippableComments();
        this.#handleRaw(token.text, token.lineNum);
        return;
      case 'op-block':
        this.#discardPendingSkippableComments();
        if (token.target.kind === 'replace' || token.target.kind === 'delete') {
          validateRangeOrder(token.target.range, token.lineNum);
        }
        if (token.target.kind === 'rem') {
          this.#flushPending();
          this.#setFileOp({ kind: 'rem' }, token.lineNum);
          return;
        }
        if (token.target.kind === 'move') {
          this.#flushPending();
          this.#setFileOp({ kind: 'move', dest: token.target.dest }, token.lineNum);
          return;
        }
        this.#flushPending();
        this.#pending = {
          target: token.target,
          lineNum: token.lineNum,
          payloads: [],
          deferredBlanks: [],
        };
        return;
      default:
        return;
    }
  }

  end() {
    this.#consumePendingSkippableComments();
    this.#flushPending();
    this.#validateFileOp();
    this.#validateNoOverlappingDeletes();
    return {
      edits: this.#edits,
      ...(this.#fileOp === undefined ? {} : { fileOp: this.#fileOp }),
      warnings: this.#warnings,
    };
  }

  endStreaming() {
    this.#consumePendingSkippableComments();
    if (this.#pending && this.#pending.payloads.length > 0) this.#flushPending();
    else if (
      this.#pending?.target.kind === 'delete' ||
      this.#pending?.target.kind === 'delete_block'
    )
      this.#flushPending();
    else this.#pending = undefined;
    this.#validateFileOp();
    this.#validateNoOverlappingDeletes();
    return {
      edits: this.#edits,
      ...(this.#fileOp === undefined ? {} : { fileOp: this.#fileOp }),
      warnings: this.#warnings,
    };
  }

  reset() {
    this.#edits = [];
    this.#warnings = [];
    this.#editIndex = 0;
    this.#pending = undefined;
    this.#fileOp = undefined;
    this.#skippableComments = [];
    this.#terminated = false;
  }

  #setFileOp(fileOp, lineNum) {
    if (this.#fileOp !== undefined) {
      throw new Error(
        `line ${lineNum}: only one file-level op (\`REM\` or \`MV\`) per section. Merge them under one header.`,
      );
    }
    if (fileOp.kind === 'rem' && this.#edits.length > 0) {
      throw new Error(`line ${lineNum}: ${REM_TAKES_NO_BODY}`);
    }
    this.#fileOp = fileOp;
  }

  #validateFileOp() {
    if (this.#fileOp?.kind !== 'rem') return;
    if (this.#edits.length > 0) {
      throw new Error('`REM` deletes the whole file and cannot be combined with line ops.');
    }
  }

  #validateNoOverlappingDeletes() {
    const sourceLinesByAnchor = new Map();
    for (const edit of this.#edits) {
      if (edit.kind !== 'delete') continue;
      let sourceLines = sourceLinesByAnchor.get(edit.anchor.line);
      if (sourceLines === undefined) {
        sourceLines = [];
        sourceLinesByAnchor.set(edit.anchor.line, sourceLines);
      }
      if (!sourceLines.includes(edit.lineNum)) sourceLines.push(edit.lineNum);
    }
    for (const [anchorLine, sourceLines] of sourceLinesByAnchor) {
      if (sourceLines.length < 2) continue;
      const [firstBlock, secondBlock] = [...sourceLines].sort((a, b) => a - b);
      throw new Error(
        `line ${secondBlock}: anchor line ${anchorLine} is already targeted by another hunk on line ${firstBlock}. ` +
          'Issue ONE hunk per range; payload is only the final desired content, never a before/after pair.',
      );
    }
  }

  #handleLiteralPayload(text, lineNum) {
    const pending = this.#pending;
    if (!pending) {
      if (this.#fileOp !== undefined) throw new Error(`line ${lineNum}: ${MOVE_TAKES_NO_BODY}`);
      throw new Error(
        `line ${lineNum}: payload line has no preceding hunk header. ` +
          `Got ${JSON.stringify(`${HL_PAYLOAD_REPLACE}${text}`)}.`,
      );
    }
    if (pending.target.kind === 'delete')
      throw new Error(`line ${lineNum}: ${DELETE_TAKES_NO_BODY}`);
    if (pending.target.kind === 'delete_block')
      throw new Error(`line ${lineNum}: ${DELETE_BLOCK_TAKES_NO_BODY}`);
    this.#commitDeferredBlanks(pending);
    pending.payloads.push({ kind: 'literal', text, lineNum });
  }

  #handleRaw(text, lineNum) {
    const contamination = detectApplyPatchContamination(text, this.#pending !== undefined);
    if (contamination !== null) throw new Error(`line ${lineNum}: ${contamination}`);
    if (this.#fileOp !== undefined) throw new Error(`line ${lineNum}: ${MOVE_TAKES_NO_BODY}`);
    if (this.#pending) {
      if (text.trim().length === 0) {
        this.#handleBlank(text, lineNum);
        return;
      }
      if (this.#pending.target.kind === 'delete')
        throw new Error(`line ${lineNum}: ${DELETE_TAKES_NO_BODY}`);
      if (this.#pending.target.kind === 'delete_block')
        throw new Error(`line ${lineNum}: ${DELETE_BLOCK_TAKES_NO_BODY}`);
      if (text.trimStart().charCodeAt(0) === 45 /* - */)
        throw new Error(`line ${lineNum}: ${MINUS_ROW_REJECTED}`);
      if (!this.#warnings.includes(BARE_BODY_AUTO_PIPED_WARNING))
        this.#warnings.push(BARE_BODY_AUTO_PIPED_WARNING);
      this.#commitDeferredBlanks(this.#pending);
      this.#pending.payloads.push({ kind: 'literal', text, lineNum, bare: true });
      return;
    }
    if (text.trim().length === 0) return;
    throw new Error(
      `line ${lineNum}: payload line has no preceding hunk header. ` +
        `Use \`SWAP N${HL_RANGE_SEP}M:\`, \`DEL N${HL_RANGE_SEP}M\`, or \`INS.PRE|POST|HEAD|TAIL:\` above the body. Got ${JSON.stringify(text)}.`,
    );
  }

  #handleBlank(text, lineNum) {
    const pending = this.#pending;
    if (!pending) return;
    if (pending.target.kind === 'delete' || pending.target.kind === 'delete_block') return;
    if (pending.payloads.length === 0) return;
    pending.deferredBlanks.push({ kind: 'literal', text, lineNum, bare: true });
  }

  #commitDeferredBlanks(pending) {
    if (pending.deferredBlanks.length === 0) return;
    if (!this.#warnings.includes(BARE_BODY_AUTO_PIPED_WARNING))
      this.#warnings.push(BARE_BODY_AUTO_PIPED_WARNING);
    pending.payloads.push(...pending.deferredBlanks);
    pending.deferredBlanks = [];
  }

  #stripBarePrefixesIfUniform(payloads) {
    let sawBare = false;
    let allLiteralValues = true;
    for (const row of payloads) {
      if (!row.bare || row.text.trim().length === 0) continue;
      sawBare = true;
      const stripped = stripOneLeadingHashlinePrefix(row.text);
      if (stripped === row.text) return;
      if (allLiteralValues && !BARE_LITERAL_VALUE_RE.test(stripped)) allLiteralValues = false;
    }
    if (!sawBare) return;
    if (allLiteralValues) return;
    for (const row of payloads) {
      if (row.bare && row.text.trim().length > 0)
        row.text = stripOneLeadingHashlinePrefix(row.text);
    }
  }

  #pushInsert(cursor, text, lineNum, mode) {
    this.#edits.push({
      kind: 'insert',
      cursor: cloneCursor(cursor),
      text,
      lineNum,
      index: this.#editIndex++,
      ...(mode === undefined ? {} : { mode }),
    });
  }

  #pushDelete(anchor, lineNum) {
    this.#edits.push({ kind: 'delete', anchor: { ...anchor }, lineNum, index: this.#editIndex++ });
  }

  #pushBlock(anchor, payloads, lineNum, mode) {
    this.#edits.push({
      kind: 'block',
      anchor: { ...anchor },
      payloads: payloads.map((payload) => payload.text),
      ...(mode === undefined ? {} : { mode }),
      lineNum,
      index: this.#editIndex++,
    });
  }

  #emitPayloadRows(cursor, payloads, lineNum, mode) {
    for (const payload of payloads) this.#pushInsert(cursor, payload.text, lineNum, mode);
  }

  #flushPending() {
    const pending = this.#pending;
    if (!pending) return;
    const { target, lineNum, payloads } = pending;
    this.#stripBarePrefixesIfUniform(payloads);
    this.#pending = undefined;
    if (target.kind === 'delete') {
      for (const anchor of expandRange(target.range)) this.#pushDelete(anchor, lineNum);
      return;
    }
    if (target.kind === 'delete_block') {
      this.#pushBlock(target.anchor, [], lineNum);
      return;
    }
    if (target.kind === 'block') {
      if (payloads.length === 0) throw new Error(`line ${lineNum}: ${EMPTY_BLOCK}`);
      this.#pushBlock(target.anchor, payloads, lineNum);
      return;
    }
    if (target.kind === 'insert_after_block') {
      if (payloads.length === 0) throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
      this.#pushBlock(target.anchor, payloads, lineNum, 'insert_after');
      return;
    }
    if (payloads.length === 0) {
      if (target.kind === 'replace') {
        for (const anchor of expandRange(target.range)) this.#pushDelete(anchor, lineNum);
        return;
      }
      throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
    }
    if (target.kind === 'replace') {
      const cursor = { kind: 'before_anchor', anchor: { ...target.range.start } };
      this.#emitPayloadRows(cursor, payloads, lineNum, 'replacement');
      for (const anchor of expandRange(target.range)) this.#pushDelete(anchor, lineNum);
      return;
    }
    if (target.kind === 'insert_before') {
      this.#emitPayloadRows(
        { kind: 'before_anchor', anchor: { ...target.anchor } },
        payloads,
        lineNum,
      );
      return;
    }
    if (target.kind === 'insert_after') {
      this.#emitPayloadRows(
        { kind: 'after_anchor', anchor: { ...target.anchor } },
        payloads,
        lineNum,
      );
      return;
    }
    const cursor = target.kind === 'bof' ? { kind: 'bof' } : { kind: 'eof' };
    this.#emitPayloadRows(cursor, payloads, lineNum);
  }
}

function drain(executor, tokenizer) {
  for (const token of tokenizer.end()) executor.feed(token);
  return executor.end();
}

export function parsePatch(diff) {
  const tokenizer = new Tokenizer();
  const executor = new Executor();
  for (const token of tokenizer.feed(diff)) executor.feed(token);
  return drain(executor, tokenizer);
}

export function parsePatchStreaming(diff) {
  const tokenizer = new Tokenizer();
  const executor = new Executor();
  for (const token of tokenizer.feed(diff)) executor.feed(token);
  for (const token of tokenizer.end()) executor.feed(token);
  return executor.endStreaming();
}
