/**
 * Pure helpers for runtime event records, history, cache, and summaries.
 */

export function createEventRecord(
  event,
  data = {},
  { source = 'unknown', async = false, idFactory },
) {
  // 排除 data 中可能覆盖顶层字段的属性
  // (特别是 OMP 消息自带的 type, timestamp, source, id)
  const { type: _type, timestamp: _ts, source: _src, id: _id, ...cleanData } = data;
  return {
    type: event,
    timestamp: Date.now(),
    source,
    id: idFactory(),
    ...(async ? { async: true } : {}),
    ...cleanData,
  };
}

export function toHistoryRecord(eventData, historyConfig) {
  return historyConfig.includeData
    ? { ...eventData }
    : {
        type: eventData.type,
        timestamp: eventData.timestamp,
        source: eventData.source,
        id: eventData.id,
      };
}

export function queryHistory(history, options = {}) {
  let result = [...history];

  if (options.type) {
    result = result.filter((event) => event.type === options.type);
  }
  if (options.source) {
    result = result.filter((event) => event.source === options.source);
  }
  if (options.since) {
    result = result.filter((event) => event.timestamp >= options.since);
  }
  if (options.limit && options.limit > 0) {
    result = result.slice(-options.limit);
  }

  return result;
}

export function filterReplayHistory(history, { since, until, type } = {}) {
  let events = [...history];
  if (since) {
    events = events.filter((event) => event.timestamp >= since);
  }
  if (until) {
    events = events.filter((event) => event.timestamp <= until);
  }
  if (type) {
    events = events.filter((event) => event.type === type);
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export function createCacheEntry(eventData, ttl) {
  const now = Date.now();
  return {
    data: eventData,
    timestamp: now,
    expires: now + ttl,
  };
}

export function isCacheExpired(entry, now = Date.now()) {
  return now > entry.expires;
}

export function summarizeSubscribers(subscribers) {
  const result = {};
  for (const [event, entries] of subscribers) {
    result[event] = entries.map((subscriber) => ({
      priority: subscriber.priority,
      id: subscriber.id,
    }));
  }
  return result;
}

export function countSubscribers(subscribers, wildcardSubscribers = []) {
  let total = 0;
  for (const entries of subscribers.values()) {
    total += entries.length;
  }
  return total + wildcardSubscribers.length;
}
