/**
 * hashline — line-anchored, content-hash-bound patch format.
 *
 * Public re-export surface for the modular implementation.
 */
export * from './apply.js';
export * from './block.js';
export * from './conflicts.js';
export * from './diff-preview.js';
export * from './format.js';
export * from './fs.js';
export * from './input.js';
export * from './messages.js';
export * from './mismatch.js';
export * from './normalize.js';
export * from './parser.js';
export * from './patcher.js';
export * from './policy.js';
export * from './prefixes.js';
export * from './recovery.js';
export * from './snapshots.js';
export * from './stream.js';
export * from './tokenizer.js';
export * from './types.js';

export {
  computeFileHash as computeTag,
  normalizeText,
  sha256Hex as hashContent,
} from './format.js';
