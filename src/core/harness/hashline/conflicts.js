import { MismatchError } from './mismatch.js';

export const HASHLINE_CONTENT_DIVERGED = 'CONFLICT_CONTENT_DIVERGED';

export function createDiff3Conflict(options = {}) {
  return { type: 'conflict', ...options };
}

export function conflictFromError(error, message, options = {}) {
  const reason = options.contentDivergedReason ?? HASHLINE_CONTENT_DIVERGED;
  if (error instanceof MismatchError) {
    return {
      type: 'conflict',
      reason,
      path: error.path,
      expectedFileHash: error.expectedFileHash,
      actualFileHash: error.actualFileHash,
      anchorLines: error.anchorLines,
      message,
    };
  }
  return { type: 'hashline_error', message };
}
