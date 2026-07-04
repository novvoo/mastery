/**
 * Minimal text-shape normalization: line-ending detection / round-trip and
 * BOM stripping. The patcher uses these to canonicalize text to LF before
 * applying edits and to restore the original shape on write-back.
 *
 */

/**
 * @typedef {("\r\n" | "\n")} LineEnding
 */

/**
 * @typedef {Object} BomResult
 * @property {string} bom Either the empty string or the BOM sequence (currently UTF-8 BOM).
 * @property {string} text Text with any leading BOM removed.
 */

/** Detect the first line ending style in `content`. Defaults to LF when neither is present. */
export function detectLineEnding(content) {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

/** Normalize every line ending to LF. */
export function normalizeToLF(text) {
  return text.replace(/\r\n?/g, '\n');
}

/** Re-encode LF text with the requested line ending. */
export function restoreLineEndings(text, ending) {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/** Strip a UTF-8 BOM if present and return both the BOM and the trailing text. */
export function stripBom(content) {
  return content.startsWith('\uFEFF')
    ? { bom: '\uFEFF', text: content.slice(1) }
    : { bom: '', text: content };
}
