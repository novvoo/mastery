import { describe, expect, test } from 'bun:test';
import {
  IPCMessage,
  IPCMessageType,
  IPCMessageStatus,
  MessageQueue,
  DEFAULT_CONFIG,
  parsePreviewArgs,
} from '../../src/adapters/desktop/protocol/ipc-protocol.js';

describe('IPCMessageType — constants', () => {
  test('has all request types', () => {
    expect(IPCMessageType.REQUEST).toBe('ipc:request');
    expect(IPCMessageType.RESPONSE).toBe('ipc:response');
    expect(IPCMessageType.ERROR).toBe('ipc:error');
  });

  test('has event type', () => {
    expect(IPCMessageType.EVENT).toBe('ipc:event');
  });

  test('has system types', () => {
    expect(IPCMessageType.HEARTBEAT).toBe('ipc:heartbeat');
    expect(IPCMessageType.CONNECT).toBe('ipc:connect');
    expect(IPCMessageType.DISCONNECT).toBe('ipc:disconnect');
    expect(IPCMessageType.RECONNECT).toBe('ipc:reconnect');
  });
});

describe('IPCMessageStatus — constants', () => {
  test('has all status values', () => {
    expect(IPCMessageStatus.PENDING).toBe('pending');
    expect(IPCMessageStatus.SUCCESS).toBe('success');
    expect(IPCMessageStatus.ERROR).toBe('error');
    expect(IPCMessageStatus.TIMEOUT).toBe('timeout');
  });
});

describe('DEFAULT_CONFIG', () => {
  test('has expected shape and defaults', () => {
    expect(DEFAULT_CONFIG.requestTimeout).toBe(30000);
    expect(DEFAULT_CONFIG.heartbeatInterval).toBe(30000);
    expect(DEFAULT_CONFIG.reconnectDelay).toBe(1000);
    expect(DEFAULT_CONFIG.maxReconnectAttempts).toBe(5);
    expect(DEFAULT_CONFIG.maxQueueSize).toBe(100);
    expect(DEFAULT_CONFIG.enableQueue).toBe(true);
    expect(DEFAULT_CONFIG.validateMessages).toBe(true);
    expect(DEFAULT_CONFIG.allowedChannels).toBeNull();
    expect(DEFAULT_CONFIG.debug).toBe(false);
  });
});

describe('parsePreviewArgs', () => {
  test('returns empty array for empty input', () => {
    expect(parsePreviewArgs('')).toEqual([]);
    expect(parsePreviewArgs('   ')).toEqual([]);
  });

  test('splits simple space-separated args', () => {
    expect(parsePreviewArgs('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  test('handles double-quoted strings', () => {
    expect(parsePreviewArgs('file "path with spaces" end')).toEqual(['file', 'path with spaces', 'end']);
  });

  test('handles single-quoted strings', () => {
    expect(parsePreviewArgs("name 'John Doe' age")).toEqual(['name', 'John Doe', 'age']);
  });

  test('handles mixed quoting', () => {
    expect(parsePreviewArgs('\'single\' "double" plain')).toEqual(['single', 'double', 'plain']);
  });
});

describe('IPCMessage — construction', () => {
  test('creates message with type and payload', () => {
    const msg = new IPCMessage(IPCMessageType.REQUEST, { action: 'test' });
    expect(msg.type).toBe('ipc:request');
    expect(msg.payload).toEqual({ action: 'test' });
    expect(typeof msg.id).toBe('string');
    expect(msg.id.startsWith('msg_')).toBe(true);
    expect(typeof msg.timestamp).toBe('number');
    expect(msg.status).toBe(IPCMessageStatus.PENDING);
  });

  test('defaults source/target/metadata', () => {
    const msg = new IPCMessage(IPCMessageType.EVENT, {});
    expect(msg.source).toBe('unknown');
    expect(msg.target).toBe('unknown');
    expect(msg.metadata).toEqual({});
    expect(msg.correlationId).toBeNull();
  });

  test('accepts options overrides', () => {
    const msg = new IPCMessage(IPCMessageType.REQUEST, { x: 1 }, {
      id: 'custom-id',
      status: IPCMessageStatus.SUCCESS,
      correlationId: 'corr-1',
      metadata: { retry: 3 },
      source: 'renderer',
      target: 'main',
      timestamp: 12345,
    });
    expect(msg.id).toBe('custom-id');
    expect(msg.status).toBe('success');
    expect(msg.correlationId).toBe('corr-1');
    expect(msg.metadata).toEqual({ retry: 3 });
    expect(msg.source).toBe('renderer');
    expect(msg.target).toBe('main');
    expect(msg.timestamp).toBe(12345);
  });
});

describe('IPCMessage — toJSON / fromJSON', () => {
  test('toJSON returns serializable object', () => {
    const msg = new IPCMessage(IPCMessageType.REQUEST, { hello: 'world' }, {
      id: 'msg-1',
      correlationId: 'corr-1',
      source: 'test',
      target: 'test-target',
    });
    const json = msg.toJSON();
    expect(json.id).toBe('msg-1');
    expect(json.type).toBe('ipc:request');
    expect(json.payload).toEqual({ hello: 'world' });
    expect(json.correlationId).toBe('corr-1');
    expect(json.source).toBe('test');
    expect(json.target).toBe('test-target');
    expect(typeof json.timestamp).toBe('number');
    expect(json.status).toBe('pending');
  });

  test('fromJSON restores message from object', () => {
    const msg = IPCMessage.fromJSON({
      id: 'restored-id',
      type: 'ipc:response',
      payload: { ok: true },
      status: 'success',
      correlationId: 'req-1',
      metadata: { m: 1 },
      source: 'main',
      target: 'renderer',
      timestamp: 9999,
    });
    expect(msg).toBeInstanceOf(IPCMessage);
    expect(msg.id).toBe('restored-id');
    expect(msg.type).toBe('ipc:response');
    expect(msg.payload).toEqual({ ok: true });
    expect(msg.status).toBe('success');
    expect(msg.correlationId).toBe('req-1');
  });

  test('fromJSON accepts string input', () => {
    const msg = IPCMessage.fromJSON('{"type":"ipc:event","payload":{"n":1}}');
    expect(msg.type).toBe('ipc:event');
    expect(msg.payload.n).toBe(1);
  });
});

describe('MessageQueue', () => {
  test('starts empty', () => {
    const q = new MessageQueue();
    expect(q.size()).toBe(0);
    expect(q.peek()).toBeUndefined();
    expect(q.dequeue()).toBeUndefined();
    expect(q.getAll()).toEqual([]);
  });

  test('enqueue adds messages', () => {
    const q = new MessageQueue();
    q.enqueue('msg1');
    q.enqueue('msg2');
    expect(q.size()).toBe(2);
    expect(q.getAll()).toEqual(['msg1', 'msg2']);
  });

  test('dequeue removes and returns front', () => {
    const q = new MessageQueue();
    q.enqueue('a');
    q.enqueue('b');
    expect(q.dequeue()).toBe('a');
    expect(q.size()).toBe(1);
  });

  test('peek returns front without removing', () => {
    const q = new MessageQueue();
    q.enqueue('first');
    q.enqueue('second');
    expect(q.peek()).toBe('first');
    expect(q.size()).toBe(2);
  });

  test('clear empties queue', () => {
    const q = new MessageQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.clear();
    expect(q.size()).toBe(0);
    expect(q.getAll()).toEqual([]);
  });

  test('enqueue respects maxSize (drops oldest)', () => {
    const q = new MessageQueue(3);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    q.enqueue(4);
    expect(q.size()).toBe(3);
    expect(q.getAll()).toEqual([2, 3, 4]);
  });

  test('maxSize 0 disables storage', () => {
    const q = new MessageQueue(0);
    q.enqueue('x');
    expect(q.size()).toBe(0);
  });

  test('allows maxSize of Infinity', () => {
    const q = new MessageQueue(Infinity);
    // Infinity is not finite, so maxSize falls back to 100
    expect(q.maxSize).toBe(100);
  });

  test('negative maxSize defaults to 0', () => {
    const q = new MessageQueue(-5);
    expect(q.maxSize).toBe(0);
  });

  test('non-numeric maxSize defaults to 100', () => {
    const q = new MessageQueue('invalid');
    expect(q.maxSize).toBe(100);
  });
});
