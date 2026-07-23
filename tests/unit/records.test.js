import { describe, expect, test } from 'bun:test';
import {
  createEventRecord,
  toHistoryRecord,
  queryHistory,
  filterReplayHistory,
  createCacheEntry,
  isCacheExpired,
  summarizeSubscribers,
  countSubscribers,
} from '../../src/runtime/event-bus/records.js';
import {
  EventPriority,
  PRIORITY_WEIGHT,
  DEFAULT_HISTORY_CONFIG,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_BATCH_CONFIG,
  createDefaultFilter,
} from '../../src/runtime/event-bus/config.js';

describe('Records — createEventRecord', () => {
  test('creates record with required fields', () => {
    const record = createEventRecord('test:event', { foo: 'bar' }, {
      source: 'test-src',
      idFactory: () => 'id-1',
    });
    expect(record.type).toBe('test:event');
    expect(record.foo).toBe('bar');
    expect(record.source).toBe('test-src');
    expect(record.id).toBe('id-1');
    expect(record.schemaVersion).toBe(1);
    expect(typeof record.timestamp).toBe('number');
  });

  test('adds ordering and distributed-causality metadata without polluting payload', () => {
    const record = createEventRecord('test:event', { text: 'hello' }, {
      source: 'runtime',
      idFactory: () => 'event-2',
      sequence: 42,
      correlationId: 'run-7',
      causationId: 'command-4',
    });
    expect(record).toMatchObject({
      schemaVersion: 1,
      sequence: 42,
      correlationId: 'run-7',
      causationId: 'command-4',
      text: 'hello',
    });
  });

  test('adds async flag when async=true', () => {
    const record = createEventRecord('evt', {}, {
      source: 's', async: true, idFactory: () => 'x',
    });
    expect(record.async).toBe(true);
  });

  test('omits async flag when async=false', () => {
    const record = createEventRecord('evt', {}, {
      source: 's', async: false, idFactory: () => 'x',
    });
    expect(record.async).toBeUndefined();
  });

  test('spreads extra data from second arg', () => {
    const record = createEventRecord('evt', { text: 'hi', count: 3 }, {
      source: 's', idFactory: () => 'x',
    });
    expect(record.text).toBe('hi');
    expect(record.count).toBe(3);
  });
});

describe('Records — toHistoryRecord', () => {
  const eventData = {
    type: 'test:event',
    timestamp: 1000,
    source: 'src',
    id: 'id-1',
    secret: 'should-not-appear',
  };

  test('includes data when includeData=true', () => {
    const cfg = { enabled: true, maxSize: 100, includeData: true };
    const rec = toHistoryRecord(eventData, cfg);
    expect(rec.secret).toBe('should-not-appear');
    expect(rec.type).toBe('test:event');
  });

  test('strips data when includeData=false', () => {
    const cfg = { enabled: true, maxSize: 100, includeData: false };
    const rec = toHistoryRecord(eventData, cfg);
    expect(rec.secret).toBeUndefined();
    expect(rec.type).toBe('test:event');
    expect(rec.id).toBe('id-1');
  });
});

describe('Records — queryHistory', () => {
  const history = [
    { type: 'a', source: 's1', timestamp: 10, id: '1' },
    { type: 'b', source: 's2', timestamp: 20, id: '2' },
    { type: 'a', source: 's2', timestamp: 30, id: '3' },
    { type: 'c', source: 's1', timestamp: 40, id: '4' },
  ];

  test('returns all when no options', () => {
    expect(queryHistory(history)).toEqual(history);
  });

  test('filters by type', () => {
    expect(queryHistory(history, { type: 'a' })).toHaveLength(2);
    expect(queryHistory(history, { type: 'b' })).toHaveLength(1);
  });

  test('filters by source', () => {
    expect(queryHistory(history, { source: 's1' })).toHaveLength(2);
  });

  test('filters by type + source', () => {
    expect(queryHistory(history, { type: 'a', source: 's2' })).toHaveLength(1);
  });

  test('filters by since timestamp', () => {
    expect(queryHistory(history, { since: 25 })).toHaveLength(2);
  });

  test('applies limit (last N)', () => {
    const limited = queryHistory(history, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0].id).toBe('3');
    expect(limited[1].id).toBe('4');
  });

  test('originals not mutated', () => {
    const copy = [...history];
    queryHistory(history, { type: 'x' });
    expect(history).toEqual(copy);
  });
});

describe('Records — filterReplayHistory', () => {
  const events = [
    { type: 'a', timestamp: 10 },
    { type: 'b', timestamp: 20 },
    { type: 'c', timestamp: 30 },
  ];

  test('no filters returns sorted copy', () => {
    const result = filterReplayHistory(events);
    expect(result).toEqual(events);
    expect(result).not.toBe(events);
  });

  test('filters by since', () => {
    expect(filterReplayHistory(events, { since: 20 })).toHaveLength(2);
  });

  test('filters by until', () => {
    expect(filterReplayHistory(events, { until: 20 })).toHaveLength(2);
  });

  test('filters by type', () => {
    expect(filterReplayHistory(events, { type: 'b' })).toHaveLength(1);
  });

  test('combines since+until+type', () => {
    const result = filterReplayHistory(events, { since: 15, until: 25, type: 'b' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('b');
  });
});

describe('Records — createCacheEntry / isCacheExpired', () => {
  test('createCacheEntry has data, timestamp, expires', () => {
    const entry = createCacheEntry({ text: 'hi' }, 1000);
    expect(entry.data.text).toBe('hi');
    expect(typeof entry.timestamp).toBe('number');
    expect(typeof entry.expires).toBe('number');
    expect(entry.expires - entry.timestamp).toBeGreaterThanOrEqual(999);
  });

  test('isCacheExpired returns true for past expiry', () => {
    const entry = { data: {}, timestamp: 0, expires: 100 };
    expect(isCacheExpired(entry, 200)).toBe(true);
  });

  test('isCacheExpired returns false before expiry', () => {
    const entry = { data: {}, timestamp: 0, expires: 200 };
    expect(isCacheExpired(entry, 100)).toBe(false);
  });

  test('isCacheExpired returns false at exact expiry boundary', () => {
    const entry = { data: {}, timestamp: 0, expires: 100 };
    expect(isCacheExpired(entry, 100)).toBe(false);
  });
});

describe('Records — summarizeSubscribers', () => {
  test('summarizes subscribers as {priority, id} objects', () => {
    const subscribers = new Map([
      ['evt1', [
        { priority: EventPriority.HIGH, id: 'a', weight: 3, callback: () => {} },
        { priority: EventPriority.LOW, id: 'b', weight: 1, callback: () => {} },
      ]],
      ['evt2', [
        { priority: EventPriority.MEDIUM, id: 'c', weight: 2, callback: () => {} },
      ]],
    ]);

    const summary = summarizeSubscribers(subscribers);
    expect(summary.evt1).toHaveLength(2);
    expect(summary.evt1[0].priority).toBe(EventPriority.HIGH);
    expect(summary.evt1[0].id).toBe('a');
    expect(summary.evt1[1].priority).toBe(EventPriority.LOW);
    expect(summary.evt2).toHaveLength(1);
    expect(summary.evt2[0].priority).toBe(EventPriority.MEDIUM);
  });

  test('returns empty object for empty map', () => {
    expect(summarizeSubscribers(new Map())).toEqual({});
  });
});

describe('Records — countSubscribers', () => {
  test('counts event subscribers plus wildcards', () => {
    const subs = new Map([
      ['evt1', [{}]],
      ['evt2', [{}, {}]],
    ]);
    expect(countSubscribers(subs, [{}])).toBe(4);
  });

  test('zero when empty', () => {
    expect(countSubscribers(new Map(), [])).toBe(0);
  });
});

describe('Config constants', () => {
  test('EventPriority has expected values', () => {
    expect(EventPriority.HIGH).toBe('high');
    expect(EventPriority.MEDIUM).toBe('medium');
    expect(EventPriority.LOW).toBe('low');
  });

  test('PRIORITY_WEIGHT matches priority values', () => {
    expect(PRIORITY_WEIGHT[EventPriority.HIGH]).toBe(3);
    expect(PRIORITY_WEIGHT[EventPriority.MEDIUM]).toBe(2);
    expect(PRIORITY_WEIGHT[EventPriority.LOW]).toBe(1);
  });

  test('DEFAULT_HISTORY_CONFIG shape', () => {
    expect(DEFAULT_HISTORY_CONFIG.enabled).toBe(true);
    expect(DEFAULT_HISTORY_CONFIG.maxSize).toBe(1000);
    expect(typeof DEFAULT_HISTORY_CONFIG.includeData).toBe('boolean');
  });

  test('DEFAULT_CACHE_CONFIG shape', () => {
    expect(DEFAULT_CACHE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CACHE_CONFIG.maxSize).toBe(100);
    expect(DEFAULT_CACHE_CONFIG.ttl).toBe(60000);
  });

  test('DEFAULT_BATCH_CONFIG shape', () => {
    expect(DEFAULT_BATCH_CONFIG.enabled).toBe(false);
    expect(DEFAULT_BATCH_CONFIG.batchSize).toBe(50);
    expect(DEFAULT_BATCH_CONFIG.flushInterval).toBe(100);
  });

  test('createDefaultFilter returns fresh object with null fields', () => {
    const f = createDefaultFilter();
    expect(f.types).toBeNull();
    expect(f.sources).toBeNull();
    expect(f.dataFilter).toBeNull();

    const f2 = createDefaultFilter();
    expect(f2).not.toBe(f);
  });
});

describe('Records — createEventRecord type safety', () => {
  test('does not let data.type overwrite the event type', () => {
    const record = createEventRecord('agent:stop', {
      type: 'agent_end',
      answer: 'done',
    }, { source: 'omp', idFactory: () => 'x' });

    expect(record.type).toBe('agent:stop');
    expect(record.answer).toBe('done');
    expect(record.source).toBe('omp');
  });

  test('preserves non-conflicting data fields', () => {
    const record = createEventRecord('test:evt', {
      text: 'hello',
      count: 42,
    }, { source: 's', idFactory: () => 'x' });
    expect(record.text).toBe('hello');
    expect(record.count).toBe(42);
    expect(record.type).toBe('test:evt');
  });
});
