/**
 * Expand deferred block edits (`replace_block N:` / `delete_block N` /
 * `insert_after_block N:`) into concrete inserts + deletes.
 *
 * The hashline parser cannot expand a block edit on its own — the line span is
 * unknown until file text + path (→ language) are available. This transform
 * runs at every apply/preview boundary that has text: it calls the injected
 * `BlockResolver` to resolve each block's `[start, end]` span, then emits
 * the exact same edits the concrete form produces in the parser: `replace
 * start.=end:` inserts + deletes for a replace, a pure range delete for a
 * delete, and plain `after_anchor` inserts at `end` for an insert-after. After
 * it runs, no `block` edits remain, so `applyEdits` (and recovery) only
 * ever see resolved edits.
 *
 */

import { STRUCTURAL_CLOSER_RE } from './apply.js';
import {
  BLOCK_RESOLVER_UNAVAILABLE,
  blockSingleLineMessage,
  blockUnresolvedMessage,
  insertAfterBlockCloserLoweredWarning,
  insertAfterBlockUnresolvedLoweredWarning,
} from './messages.js';

/** True when at least one edit is an unresolved deferred block edit. */
export function hasBlockEdit(edits) {
  return edits.some((edit) => edit.kind === 'block');
}

/**
 * Resolve every deferred block edit in `edits` against `text` (parsed as the
 * language inferred from `path`). Non-block edits pass through untouched.
 * Returns a fresh edit list with no `block` variants. The fast path returns the
 * input unchanged when there is nothing to resolve.
 */
export function resolveBlockEdits(edits, text, path, resolver, options = {}) {
  if (!hasBlockEdit(edits)) return edits;
  const onUnresolved = options.onUnresolved ?? 'throw';
  const resolved = [];
  let synthIndex = 0;
  for (const edit of edits) {
    if (edit.kind !== 'block') {
      resolved.push(edit);
      continue;
    }
    const op =
      edit.mode === 'insert_after'
        ? 'insert_after'
        : edit.payloads.length === 0
          ? 'delete'
          : 'replace';
    const span = resolver ? resolver({ path, text, line: edit.anchor.line }) : null;
    if (span === null) {
      if (op === 'insert_after') {
        const anchorText = text.split('\n')[edit.anchor.line - 1];
        const isCloser = anchorText !== undefined && STRUCTURAL_CLOSER_RE.test(anchorText);
        options.onWarning?.(
          isCloser
            ? insertAfterBlockCloserLoweredWarning(edit.anchor.line)
            : insertAfterBlockUnresolvedLoweredWarning(edit.anchor.line),
        );
        for (const payload of edit.payloads) {
          const cursor = { kind: 'after_anchor', anchor: { line: edit.anchor.line } };
          resolved.push({
            kind: 'insert',
            cursor,
            text: payload,
            lineNum: edit.lineNum,
            index: synthIndex++,
          });
        }
        continue;
      }
      if (onUnresolved === 'drop') continue;
      throw new Error(
        `line ${edit.lineNum}: ${
          resolver
            ? blockUnresolvedMessage(edit.anchor.line, op, text.split('\n'))
            : BLOCK_RESOLVER_UNAVAILABLE
        }`,
      );
    }
    if (span.start === span.end) {
      if (onUnresolved === 'drop') continue;
      throw new Error(`line ${edit.lineNum}: ${blockSingleLineMessage(edit.anchor.line, op)}`);
    }
    options.onResolved?.({
      anchorLine: edit.anchor.line,
      start: span.start,
      end: span.end,
      op,
    });
    if (op === 'insert_after') {
      for (const payload of edit.payloads) {
        const cursor = { kind: 'after_anchor', anchor: { line: span.end } };
        resolved.push({
          kind: 'insert',
          cursor,
          text: payload,
          lineNum: edit.lineNum,
          index: synthIndex++,
          blockStart: span.start,
        });
      }
      continue;
    }
    for (const payload of edit.payloads) {
      const cursor = { kind: 'before_anchor', anchor: { line: span.start } };
      resolved.push({
        kind: 'insert',
        cursor,
        text: payload,
        lineNum: edit.lineNum,
        index: synthIndex++,
        mode: 'replacement',
      });
    }
    for (let line = span.start; line <= span.end; line++) {
      resolved.push({
        kind: 'delete',
        anchor: { line },
        lineNum: edit.lineNum,
        index: synthIndex++,
      });
    }
  }
  return resolved;
}
