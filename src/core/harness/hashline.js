/**
 * Project-facing hashline entrypoint.
 *
 * Core parser/apply/recovery code lives under `./hashline/`. This file exposes
 * the small mastery adapter used by runtime call sites.
 */
export * from './hashline/index.js';
export {
  computeTag,
  createDiff3Conflict,
  createPatcher,
  Diff3MergeEngine,
  DiskFilesystem,
  errorSeverity,
  formatHashlineError,
  hashContent,
  HashlineBridge,
  HashlineErrorCode,
  HashlineErrorSeverity,
  InMemorySnapshotStore,
  MemoryFilesystem,
  Patch,
  PatchApplyError,
  Patcher,
  PatchParseError,
  Section,
  StructuredApplyError,
  StructuredParseError,
  applyHunksToText,
  applyHunksToTextExtended,
  normalizeText,
  parsePatch,
  parsePatchExtended,
  serializePatch,
} from './hashline/project-adapter.js';
