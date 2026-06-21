/**
 * Event bus configuration primitives.
 */

export const EventPriority = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

export const PRIORITY_WEIGHT = {
  [EventPriority.HIGH]: 3,
  [EventPriority.MEDIUM]: 2,
  [EventPriority.LOW]: 1,
};

export const DEFAULT_HISTORY_CONFIG = {
  enabled: true,
  maxSize: 1000,
  includeData: true,
};

export const DEFAULT_CACHE_CONFIG = {
  enabled: true,
  maxSize: 100,
  ttl: 60000,
};

export const DEFAULT_BATCH_CONFIG = {
  enabled: false,
  batchSize: 50,
  flushInterval: 100,
};

export function createDefaultFilter() {
  return {
    types: null,
    sources: null,
    dataFilter: null,
  };
}
