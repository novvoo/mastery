/**
 * Pure data types shared across the hashline parser, applier, and patcher.
 * Nothing in this file references a filesystem, agent runtime, or schema
 * library — keep it that way.
 * Type annotations
 * collapse to JSDoc `@typedef`s so consumers keep IDE hints without a build
 * step.
 */

/**
 * @typedef {Object} Anchor
 * @property {number} line A line-number anchor (1-indexed).
 */

/**
 * Where an `insert` edit should land relative to existing content.
 *
 * @typedef {(
 *   | { kind: "bof" }
 *   | { kind: "eof" }
 *   | { kind: "before_anchor"; anchor: Anchor }
 *   | { kind: "after_anchor"; anchor: Anchor }
 * )} Cursor
 */

/**
 * A single low-level edit produced by the parser and consumed by the applier.
 * Multi-line replacements decompose to one `insert` per replacement line plus
 * one `delete` per consumed line. Replacement payloads are tagged so the
 * applier can distinguish literal insertion from new content for a deleted
 * line.
 *
 * @typedef {(
 *   | { kind: "insert"; cursor: Cursor; text: string; lineNum: number; index: number; mode?: "replacement"; blockStart?: number }
 *   | { kind: "delete"; anchor: Anchor; lineNum: number; index: number; oldAssertion?: string }
 *   | { kind: "block"; anchor: Anchor; payloads: string[]; mode?: "insert_after"; lineNum: number; index: number }
 * )} Edit
 */

/**
 * File-level operation parsed from a section body (`REM` / `MV`).
 *
 * @typedef {({ kind: "rem" } | { kind: "move"; dest: string })} FileOp
 */

/**
 * Resolved 1-indexed inclusive line span of a `replace_block N:` target.
 *
 * @typedef {Object} BlockResolution
 * @property {number} anchorLine The 1-indexed line the block op was anchored on (the `N`).
 * @property {number} start First line of the resolved span (1-indexed, inclusive).
 * @property {number} end Last line of the resolved span (1-indexed, inclusive).
 * @property {("replace"|"delete"|"insert_after")} op Which block op produced this resolution.
 */

/**
 * @typedef {Object} ApplyResult
 * @property {string} text Post-edit text body.
 * @property {number} [firstChangedLine] First line number (1-indexed) that changed, or `undefined` for a no-op apply.
 * @property {string[]} [warnings] Diagnostic warnings collected by the parser, patcher, or recovery.
 * @property {BlockResolution[]} [blockResolutions] Resolved spans for each `replace_block`/`delete_block` op in this apply, in patch order.
 */

/** @typedef {{ start: Anchor; end: Anchor }} ParsedRange */

/**
 * @typedef {Object} SplitOptions
 * @property {string} [cwd] Resolves absolute paths inside hashline headers to cwd-relative form.
 * @property {string} [path] Fallback path used when the input lacks a `[PATH]` header but contains recognizable hashline operations.
 */

/**
 * @typedef {Object} StreamOptions
 * @property {number} [startLine] First line number to use when formatting (1-indexed, default 1).
 * @property {number} [maxChunkLines] Maximum formatted lines per yielded chunk (default 200).
 * @property {number} [maxChunkBytes] Maximum UTF-8 bytes per yielded chunk (default 64 KiB).
 */

/**
 * @typedef {Object} CompactDiffPreview
 * @property {string} preview
 * @property {number} addedLines
 * @property {number} removedLines
 */

/**
 * @typedef {Object} CompactDiffOptions
 * @property {number} [maxAddedRunContext] Added lines kept on each side of a long added-run elision (default 2).
 * @property {number} [maxUnchangedRun] Alias for callers that name this by unchanged-run budget.
 */

/**
 * @typedef {Object} BlockSpan
 * @property {number} start First line of the block (1-indexed, inclusive).
 * @property {number} end Last line of the block (1-indexed, inclusive).
 */

/**
 * Request handed to a `BlockResolver` to resolve one `replace_block N:` anchor.
 *
 * @typedef {Object} BlockResolverRequest
 * @property {string} path Target file path (used to infer language by extension).
 * @property {string} text Full text the block must be resolved against (the snapshot the tag names).
 * @property {number} line 1-indexed line the block must begin on.
 */

/**
 * Resolves a `replace_block N:` anchor to the line span of the syntactic block
 * that begins on line N. Returns `null` when no block can be resolved
 * (unrecognized language, blank/out-of-range line, no node begins there, or the
 * resolved subtree has a syntax error). Pure seam: the hashline core declares
 * the contract; the host injects a tree-sitter-backed implementation.
 *
 * @callback BlockResolver
 * @param {BlockResolverRequest} request
 * @returns {BlockSpan | null}
 */

export {};
