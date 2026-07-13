import { describe, expect, test, afterEach } from 'bun:test';
import { getEventBus, resetEventBus, EventPriority } from '../../src/runtime/event-bus.js';
import { RuntimeEvent } from '../../src/runtime/types.js';

// Reset singleton before each test so tests don't leak state
afterEach(() => {
  resetEventBus();
});

describe('EventBus — priority subscription', () => {
  test('calls high-priority before medium (sync emit)', () => {
    const bus = getEventBus();
    const order = [];

    bus.subscribe('test:evt', () => order.push('low'), { priority: EventPriority.LOW });
    bus.subscribe('test:evt', () => order.push('high'), { priority: EventPriority.HIGH });
    bus.subscribe('test:evt', () => order.push('medium'), { priority: EventPriority.MEDIUM });

    bus.emit('test:evt', {});
    expect(order).toEqual(['high', 'medium', 'low']);
  });

  test('calls high-priority before low in async emit', async () => {
    const bus = getEventBus();
    const order = [];

    bus.subscribe('test:async', () => { order.push('low'); }, { priority: EventPriority.LOW });
    bus.subscribe('test:async', () => { order.push('high'); }, { priority: EventPriority.HIGH });

    await bus.emitAsync('test:async', {});
    expect(order).toEqual(['high', 'low']);
  });

  test('default priority is MEDIUM', () => {
    const bus = getEventBus();
    const order = [];

    bus.subscribe('test:prio', () => order.push('explicit-high'), { priority: EventPriority.HIGH });
    bus.subscribe('test:prio', () => order.push('default'));

    bus.emit('test:prio', {});
    expect(order).toEqual(['explicit-high', 'default']);
  });
});

describe('EventBus — deferred subscription', () => {
  test('deferred callback not called until activated', () => {
    const bus = getEventBus();
    let called = false;

    bus.subscribe('test:def', () => { called = true; }, { deferred: true });
    bus.emit('test:def', {});
    expect(called).toBe(false);
  });

  test('activateDeferred activates pending subscriptions', () => {
    const bus = getEventBus();
    let called = false;

    bus.subscribe('test:def', () => { called = true; }, { deferred: true });
    bus.activateDeferred('test:def');
    bus.emit('test:def', {});
    expect(called).toBe(true);
  });

  test('activateDeferred without event activates all', () => {
    const bus = getEventBus();
    let calledA = false;
    let calledB = false;

    bus.subscribe('evt:a', () => { calledA = true; }, { deferred: true });
    bus.subscribe('evt:b', () => { calledB = true; }, { deferred: true });
    bus.activateDeferred();
    bus.emit('evt:a', {});
    bus.emit('evt:b', {});
    expect(calledA).toBe(true);
    expect(calledB).toBe(true);
  });

  test('removing deferred sub before activation prevents it', () => {
    const bus = getEventBus();
    let called = false;

    const unsub = bus.subscribe('test:def', () => { called = true; }, { deferred: true });
    unsub();
    bus.activateDeferred('test:def');
    bus.emit('test:def', {});
    expect(called).toBe(false);
  });
});

describe('EventBus — wildcard subscription', () => {
  test('wildcard subscriber receives all events', () => {
    const bus = getEventBus();
    const received = [];

    bus.subscribe('*', (data) => received.push(data.type));
    bus.emit('evt:1', {});
    bus.emit('evt:2', {});

    expect(received).toEqual(['evt:1', 'evt:2']);
  });

  test('unsubscribing wildcard stops receiving', () => {
    const bus = getEventBus();
    const received = [];

    const unsub = bus.subscribe('*', (data) => received.push(data.type));
    unsub();
    bus.emit('evt:1', {});
    expect(received).toEqual([]);
  });
});

describe('EventBus — emit data shape', () => {
  test('emit returns true', () => {
    const bus = getEventBus();
    expect(bus.emit('test:evt', {})).toBe(true);
  });

  test('events carry source, id, timestamp', () => {
    const bus = getEventBus();
    let received = null;
    bus.subscribe('test:shape', (d) => { received = d; });
    bus.emit('test:shape', { value: 42 });
    expect(received.type).toBe('test:shape');
    expect(received.value).toBe(42);
    expect(typeof received.id).toBe('string');
    expect(typeof received.timestamp).toBe('number');
    expect(received.source).toBe('unknown');
  });

  test('emit with custom source', () => {
    const bus = getEventBus();
    let received = null;
    bus.subscribe('test:src', (d) => { received = d; });
    bus.emit('test:src', { x: 1 }, { source: 'my-module' });
    expect(received.source).toBe('my-module');
  });
});

describe('EventBus — filters', () => {
  test('global filter blocks events by types', () => {
    const bus = getEventBus();
    bus.setFilter('*', { types: ['allowed'] });
    const allowed = [];
    bus.subscribe('allowed', (d) => allowed.push(d.type));
    bus.subscribe('blocked', () => { throw new Error('should not fire'); });

    bus.emit('blocked', {});
    expect(bus.emit('blocked', {})).toBe(false);
    bus.emit('allowed', {});
    expect(allowed).toEqual(['allowed']);
  });

  test('event-specific filter blocks by source', () => {
    const bus = getEventBus();
    bus.setFilter('test:filter', { sources: ['trusted'] });

    const received = [];
    bus.subscribe('test:filter', (d) => received.push(d.source));

    bus.emit('test:filter', {}, { source: 'untrusted' });
    expect(bus.emit('test:filter', {}, { source: 'untrusted' })).toBe(false);
    bus.emit('test:filter', {}, { source: 'trusted' });
    expect(received).toEqual(['trusted']);
  });

  test('dataFilter function blocks matching events', () => {
    const bus = getEventBus();
    bus.setFilter('test:df', {
      dataFilter: (data) => data.level !== 'secret',
    });

    let received = null;
    bus.subscribe('test:df', (d) => { received = d; });

    bus.emit('test:df', { level: 'secret' });
    expect(received).toBeNull();

    bus.emit('test:df', { level: 'info' });
    expect(received.level).toBe('info');
  });

  test('removeFilter restores event delivery', () => {
    const bus = getEventBus();
    bus.setFilter('test:rf', { sources: ['only-this'] });
    bus.removeFilter('test:rf');

    let received = null;
    bus.subscribe('test:rf', (d) => { received = d; });
    bus.emit('test:rf', {}, { source: 'any-source' });
    expect(received).not.toBeNull();
  });
});

describe('EventBus — history', () => {
  test('getHistory returns emitted events', () => {
    const bus = getEventBus();
    bus.emit('evt:h1', { n: 1 });
    bus.emit('evt:h2', { n: 2 });
    expect(bus.getHistory()).toHaveLength(2);
  });

  test('getHistory filters by type', () => {
    const bus = getEventBus();
    bus.emit('a', {});
    bus.emit('b', {});
    bus.emit('a', {});
    expect(bus.getHistory({ type: 'a' })).toHaveLength(2);
    expect(bus.getHistory({ type: 'b' })).toHaveLength(1);
  });

  test('getHistory respects limit', () => {
    const bus = getEventBus();
    bus.emit('a', {});
    bus.emit('b', {});
    bus.emit('c', {});
    expect(bus.getHistory({ limit: 2 })).toHaveLength(2);
  });

  test('clearHistory empties history', () => {
    const bus = getEventBus();
    bus.emit('a', {});
    bus.clearHistory();
    expect(bus.getHistory()).toHaveLength(0);
  });

  test('replayHistory replays to subscribers', () => {
    const bus = getEventBus();
    const received = [];
    bus.subscribe('replay:evt', (d) => received.push(d.type));

    bus.emit('replay:evt', {});
    bus.emit('replay:evt', {});

    received.length = 0;
    bus.replayHistory({ type: 'replay:evt' });

    expect(received).toEqual(['replay:evt', 'replay:evt']);
  });

  test('replayed events have replay flag', async () => {
    const bus = getEventBus();
    let hasReplay = false;
    bus.subscribe('replay:flag', (d) => { hasReplay = d.replay; });

    bus.emit('replay:flag', {});
    expect(hasReplay).toBeFalsy();

    hasReplay = false;
    await bus.replayHistory({ type: 'replay:flag' });
    expect(hasReplay).toBe(true);
  });
});

describe('EventBus — cache', () => {
  test('getCachedEvent returns null when none cached', () => {
    const bus = getEventBus();
    expect(bus.getCachedEvent('nonexistent')).toBeNull();
  });

  test('cached event is retrievable', () => {
    const bus = getEventBus();
    bus.emit('cache:me', { hello: 'world' }, { cache: true });
    const cached = bus.getCachedEvent('cache:me');
    expect(cached).not.toBeNull();
    expect(cached.hello).toBe('world');
  });

  test('clearCache removes all entries', () => {
    const bus = getEventBus();
    bus.emit('c:1', {}, { cache: true });
    bus.emit('c:2', {}, { cache: true });
    bus.clearCache();
    expect(bus.getCachedEvent('c:1')).toBeNull();
    expect(bus.getCachedEvent('c:2')).toBeNull();
  });

  test('clearCache with event name only removes that entry', () => {
    const bus = getEventBus();
    bus.emit('k:1', {}, { cache: true });
    bus.emit('k:2', {}, { cache: true });
    bus.clearCache('k:1');
    expect(bus.getCachedEvent('k:1')).toBeNull();
    expect(bus.getCachedEvent('k:2')).not.toBeNull();
  });
});

describe('EventBus — stats', () => {
  test('getStats returns counters', () => {
    const bus = getEventBus();
    const stats = bus.getStats();
    expect(typeof stats.totalEvents).toBe('number');
    expect(typeof stats.filteredEvents).toBe('number');
    expect(typeof stats.cachedHits).toBe('number');
    expect(typeof stats.subscriberCount).toBe('number');
    expect(typeof stats.historySize).toBe('number');
    expect(typeof stats.cacheSize).toBe('number');
  });

  test('totalEvents increments on emit', () => {
    const bus = getEventBus();
    bus.emit('a', {});
    bus.emit('b', {});
    expect(bus.getStats().totalEvents).toBe(2);
  });

  test('resetStats resets counters', () => {
    const bus = getEventBus();
    bus.emit('a', {});
    bus.resetStats();
    const stats = bus.getStats();
    expect(stats.totalEvents).toBe(0);
    expect(stats.filteredEvents).toBe(0);
    expect(stats.cachedHits).toBe(0);
  });
});

describe('EventBus — emitAsync', () => {
  test('emitAsync resolves after subscribers run', async () => {
    const bus = getEventBus();
    let called = false;
    bus.subscribe('test:async', () => { called = true; });
    await bus.emitAsync('test:async', {});
    expect(called).toBe(true);
  });

  test('emitAsync with async subscriber waits for it', async () => {
    const bus = getEventBus();
    const order = [];
    bus.subscribe('test:await', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('async');
    });
    bus.subscribe('test:await', () => { order.push('sync'); });

    await bus.emitAsync('test:await', {});
    expect(order).toEqual(['async', 'sync']);
  });
});

describe('EventBus — emitBatch', () => {
  test('emitBatch emits multiple events', () => {
    const bus = getEventBus();
    const received = [];
    bus.subscribe('b1', (d) => received.push({ type: d.type, val: d.val }));
    bus.subscribe('b2', (d) => received.push({ type: d.type, val: d.val }));

    bus.emitBatch([
      { event: 'b1', data: { val: 1 } },
      { event: 'b2', data: { val: 2 } },
    ]);

    expect(received).toEqual([
      { type: 'b1', val: 1 },
      { type: 'b2', val: 2 },
    ]);
  });
});

describe('EventBus — getSubscriberCount / getSubscribers', () => {
  test('getSubscriberCount returns 0 when none', () => {
    const bus = getEventBus();
    expect(bus.getSubscriberCount('nonexistent')).toBe(0);
  });

  test('getSubscriberCount returns correct count', () => {
    const bus = getEventBus();
    bus.subscribe('cnt:test', () => {});
    bus.subscribe('cnt:test', () => {});
    expect(bus.getSubscriberCount('cnt:test')).toBe(2);
  });

  test('getSubscribers returns summary object', () => {
    const bus = getEventBus();
    bus.subscribe('sub:sum', () => {}, { priority: EventPriority.HIGH });
    const summary = bus.getSubscribers('sub:sum');
    expect(summary).toHaveLength(1);
    expect(summary[0].priority).toBe(EventPriority.HIGH);
  });
});

describe('EventBus — clear', () => {
  test('clear removes all subscribers, history, cache', () => {
    const bus = getEventBus();
    bus.subscribe('evt:clear', () => {});
    bus.emit('evt:clear', {}, { cache: true });
    bus.clear();

    expect(bus.getSubscriberCount('evt:clear')).toBe(0);
    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.getCachedEvent('evt:clear')).toBeNull();
    expect(bus.getStats().totalEvents).toBe(0);
  });

  test('clear preserves error handler (can emit after clear)', () => {
    const bus = getEventBus();
    bus.clear();
    expect(bus.emit('post:clear', {})).toBe(true);
  });
});

describe('EventBus — resetEventBus', () => {
  test('resetEventBus creates fresh singleton', () => {
    const bus1 = getEventBus();
    bus1.subscribe('x', () => {});
    resetEventBus();
    const bus2 = getEventBus();
    expect(bus1).not.toBe(bus2);
    expect(bus2.getSubscriberCount('x')).toBe(0);
  });
  test('getEventBus with config applies options to new instance', () => {
    resetEventBus();
    const bus = getEventBus({ history: { enabled: false } });
    bus.emit('test:no-history', {});
    expect(bus.getHistory()).toHaveLength(0);
  });
});

describe('EventBus — error handling', () => {
  test('subscriber error does not propagate to caller', () => {
    const bus = getEventBus();
    bus.subscribe('err:test', () => { throw new Error('oops'); });
    expect(() => bus.emit('err:test', {})).not.toThrow();
  });

  test('other subscribers still fire after one throws', () => {
    const bus = getEventBus();
    const order = [];
    bus.subscribe('err:multi', () => { order.push('first'); });
    bus.subscribe('err:multi', () => { throw new Error('fail'); });
    bus.subscribe('err:multi', () => { order.push('third'); });

    bus.emit('err:multi', {});
    expect(order).toEqual(['first', 'third']);
  });
});

describe('EventBus — RuntimeEvent constants coverage', () => {
  test('all plan events exist', () => {
    expect(RuntimeEvent.EXECUTION_PLAN_CREATED).toBe('plan:created');
    expect(RuntimeEvent.EXECUTION_PLAN_UPDATED).toBe('plan:updated');
    expect(RuntimeEvent.PLAN_DECOMPOSED).toBe('plan:decomposed');
    expect(RuntimeEvent.PLAN_EXECUTED).toBe('plan:executed');
  });

  test('all plugin events exist', () => {
    expect(RuntimeEvent.PLUGIN_REGISTER).toBe('plugin:register');
    expect(RuntimeEvent.PLUGIN_UNREGISTER).toBe('plugin:unregister');
    expect(RuntimeEvent.PLUGIN_ENABLE).toBe('plugin:enable');
    expect(RuntimeEvent.PLUGIN_DISABLE).toBe('plugin:disable');
  });

  test('all session/memory events exist', () => {
    expect(RuntimeEvent.SESSION_CHANGE).toBe('session:change');
    expect(RuntimeEvent.SUBAGENT_UPDATE).toBe('subagent:update');
    expect(RuntimeEvent.MEMORY_UPDATE).toBe('memory:update');
    expect(RuntimeEvent.MEMORY_CLEAR).toBe('memory:clear');
  });

  test('all tool & interaction events exist', () => {
    expect(RuntimeEvent.TOOL_ACTIVITY).toBe('tool:activity');
    expect(RuntimeEvent.TOOL_PROGRESS).toBe('tool:progress');
    expect(RuntimeEvent.TOOL_LOADED).toBe('tool:loaded');
    expect(RuntimeEvent.TOOL_UNLOADED).toBe('tool:unloaded');
    expect(RuntimeEvent.AGENT_INTERACTION_REQUEST).toBe('agent:interaction_request');
    expect(RuntimeEvent.AGENT_INTERACTION_CANCEL).toBe('agent:interaction_cancel');
    expect(RuntimeEvent.AGENT_STREAM).toBe('agent:stream');
    expect(RuntimeEvent.AGENT_THINKING).toBe('agent:thinking');
  });

  test('MAX_ITERATIONS_DEFAULT is 60', async () => {
    const { MAX_ITERATIONS_DEFAULT } = await import('../../src/runtime/types.js');
    expect(MAX_ITERATIONS_DEFAULT).toBe(60);
  });
});
