import { describe, expect, test } from 'bun:test';
import { IPCAdapterBase } from '../../src/adapters/desktop/ipc/base-adapter.js';
import { IPCMessageType, IPCMessageStatus, IPCMessage } from '../../src/adapters/desktop/protocol/ipc-protocol.js';

describe('IPCAdapterBase — constructor & config', () => {
  test('constructs with default config', () => {
    const adapter = new IPCAdapterBase();
    expect(adapter.config.requestTimeout).toBe(30000);
    expect(adapter.config.heartbeatInterval).toBe(30000);
    expect(adapter.config.maxReconnectAttempts).toBe(5);
    expect(adapter.config.maxQueueSize).toBe(100);
    expect(adapter.config.enableQueue).toBe(true);
    expect(adapter.config.validateMessages).toBe(true);
    expect(adapter.config.allowedChannels).toBeNull();
    expect(adapter.config.debug).toBe(false);
  });

  test('merges custom config', () => {
    const adapter = new IPCAdapterBase({ requestTimeout: 5000, debug: true, maxQueueSize: 10 });
    expect(adapter.config.requestTimeout).toBe(5000);
    expect(adapter.config.debug).toBe(true);
    expect(adapter.config.maxQueueSize).toBe(10);
  });

  test('starts disconnected with empty queue', () => {
    const adapter = new IPCAdapterBase();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.messageQueue.size()).toBe(0);
  });
});

describe('IPCAdapterBase — validateMessage', () => {
  test('accepts valid message', () => {
    const adapter = new IPCAdapterBase();
    const msg = new IPCMessage(IPCMessageType.REQUEST, {});
    expect(adapter.validateMessage(msg).valid).toBe(true);
  });

  test('rejects null/undefined', () => {
    const adapter = new IPCAdapterBase();
    expect(adapter.validateMessage(null).valid).toBe(false);
    expect(adapter.validateMessage(undefined).valid).toBe(false);
  });

  test('rejects object without type', () => {
    const adapter = new IPCAdapterBase();
    expect(adapter.validateMessage({ payload: {} }).valid).toBe(false);
  });

  test('returns valid when validateMessages disabled', () => {
    const adapter = new IPCAdapterBase({ validateMessages: false });
    expect(adapter.validateMessage(null).valid).toBe(true);
  });

  test('blocks disallowed channels', () => {
    const adapter = new IPCAdapterBase({ allowedChannels: ['channel:allowed'] });
    const allowed = new IPCMessage('channel:allowed', {});
    const blocked = new IPCMessage('channel:blocked', {});
    expect(adapter.validateMessage(allowed).valid).toBe(true);
    expect(adapter.validateMessage(blocked).valid).toBe(false);
    expect(adapter.validateMessage(blocked).error).toContain('不在允许列表中');
  });
});

describe('IPCAdapterBase — createRequest / createResponse / createError / createEvent', () => {
  test('createRequest creates REQUEST message with channel in metadata', () => {
    const adapter = new IPCAdapterBase();
    const req = adapter.createRequest('channel:test', { action: 'ping' });
    expect(req.type).toBe(IPCMessageType.REQUEST);
    expect(req.payload).toEqual({ action: 'ping' });
    expect(req.metadata.channel).toBe('channel:test');
  });

  test('createRequest preserves extra metadata', () => {
    const adapter = new IPCAdapterBase();
    const req = adapter.createRequest('channel:test', { x: 1 }, { source: 'renderer' });
    expect(req.source).toBe('renderer');
    expect(req.metadata.channel).toBe('channel:test');
  });

  test('createResponse creates RESPONSE message with correlationId', () => {
    const adapter = new IPCAdapterBase();
    const request = new IPCMessage(IPCMessageType.REQUEST, {}, { id: 'req-1', metadata: { channel: 'ch' } });
    const resp = adapter.createResponse(request, { ok: true });
    expect(resp.type).toBe(IPCMessageType.RESPONSE);
    expect(resp.payload).toEqual({ ok: true });
    expect(resp.correlationId).toBe('req-1');
    expect(resp.status).toBe(IPCMessageStatus.SUCCESS);
  });

  test('createError creates ERROR message with error details', () => {
    const adapter = new IPCAdapterBase();
    const request = new IPCMessage(IPCMessageType.REQUEST, {}, { id: 'req-1' });
    const err = new Error('Something broke');
    err.code = 'ERR_123';
    const errorMsg = adapter.createError(request, err);
    expect(errorMsg.type).toBe(IPCMessageType.ERROR);
    expect(errorMsg.payload.message).toBe('Something broke');
    expect(errorMsg.payload.code).toBe('ERR_123');
    expect(errorMsg.correlationId).toBe('req-1');
    expect(errorMsg.status).toBe(IPCMessageStatus.ERROR);
  });

  test('createError handles error without code', () => {
    const adapter = new IPCAdapterBase();
    const request = new IPCMessage(IPCMessageType.REQUEST, {}, { id: 'req-1' });
    const errorMsg = adapter.createError(request, new Error('fail'));
    expect(errorMsg.payload.code).toBe('UNKNOWN_ERROR');
  });

  test('createEvent creates EVENT message with eventName', () => {
    const adapter = new IPCAdapterBase();
    const evt = adapter.createEvent('runtime:status', { status: 'ready' });
    expect(evt.type).toBe(IPCMessageType.EVENT);
    expect(evt.payload).toEqual({ status: 'ready' });
    expect(evt.metadata.eventName).toBe('runtime:status');
  });
});

describe('IPCAdapterBase — generateRequestId', () => {
  test('generates unique IDs', () => {
    const adapter = new IPCAdapterBase();
    const id1 = adapter.generateRequestId();
    const id2 = adapter.generateRequestId();
    expect(id1.startsWith('req_')).toBe(true);
    expect(id1).not.toBe(id2);
  });
});

describe('IPCAdapterBase — handleTimeout', () => {
  test('rejects pending request and emits timeout', () => {
    const adapter = new IPCAdapterBase();
    const events = [];
    adapter.on('timeout', (d) => events.push(d.requestId));

    let rejected = null;
    adapter.pendingRequests.set('req-1', { reject: (err) => { rejected = err; } });
    adapter.handleTimeout('req-1');

    expect(rejected).not.toBeNull();
    expect(rejected.message).toContain('req-1');
    expect(adapter.pendingRequests.has('req-1')).toBe(false);
    expect(events).toEqual(['req-1']);
  });
});

describe('IPCAdapterBase — heartbeat', () => {
  test('startHeartbeat sets interval', () => {
    const adapter = new IPCAdapterBase({ heartbeatInterval: 50 });
    adapter.startHeartbeat();
    expect(adapter.heartbeatTimer).not.toBeNull();
    adapter.stopHeartbeat();
  });

  test('stopHeartbeat clears interval', () => {
    const adapter = new IPCAdapterBase();
    adapter.startHeartbeat();
    adapter.stopHeartbeat();
    expect(adapter.heartbeatTimer).toBeNull();
  });

  test('sendHeartbeat creates and sends heartbeat message', () => {
    const adapter = new IPCAdapterBase();
    adapter.isConnected = true;
    let sent = null;
    adapter._sendImpl = async (msg) => { sent = msg; };

    adapter.sendHeartbeat();
    expect(sent).not.toBeNull();
    expect(sent.type).toBe(IPCMessageType.HEARTBEAT);
    expect(sent.payload.timestamp).toBeDefined();
  });
});

describe('IPCAdapterBase — send wrapper (connection state + queue)', () => {
  test('queues message when not connected and enableQueue=true', async () => {
    const adapter = new IPCAdapterBase();
    const msg = new IPCMessage(IPCMessageType.REQUEST, {});
    const result = await adapter.send(msg);
    expect(result).toBeNull();
    expect(adapter.messageQueue.size()).toBe(1);
  });

  test('throws when not connected and enableQueue=false', async () => {
    const adapter = new IPCAdapterBase({ enableQueue: false });
    const msg = new IPCMessage(IPCMessageType.REQUEST, {});
    let err;
    try {
      await adapter.send(msg);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('未连接');
  });

  test('delegates to _sendImpl when connected', async () => {
    const adapter = new IPCAdapterBase();
    adapter.isConnected = true;
    let sent = null;
    adapter._sendImpl = async (msg) => { sent = msg; return msg; };

    const msg = new IPCMessage(IPCMessageType.REQUEST, { data: 42 });
    const result = await adapter.send(msg);
    expect(sent.payload.data).toBe(42);
    expect(result).toBe(msg);
  });
});

describe('IPCAdapterBase — disconnect', () => {
  test('disconnect sets isConnected false and stops heartbeat', () => {
    const adapter = new IPCAdapterBase();
    adapter.isConnected = true;
    adapter.startHeartbeat();

    const events = [];
    adapter.on('disconnected', () => events.push('disconnected'));

    adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.heartbeatTimer).toBeNull();
    expect(events).toEqual(['disconnected']);
  });
});

describe('IPCAdapterBase — getStats', () => {
  test('getStats returns status object', () => {
    const adapter = new IPCAdapterBase();
    const stats = adapter.getStats();
    expect(stats.isConnected).toBe(false);
    expect(typeof stats.pendingRequests).toBe('number');
    expect(typeof stats.queueSize).toBe('number');
    expect(typeof stats.subscriptions).toBe('number');
    expect(typeof stats.reconnectAttempts).toBe('number');
    expect(typeof stats.lastHeartbeat).toBe('number');
  });
});

describe('IPCAdapterBase — handleReconnect', () => {
  test('returns false when max attempts reached', async () => {
    const adapter = new IPCAdapterBase({ reconnectDelay: 1, maxReconnectAttempts: 2 });
    adapter.reconnectAttempts = 2;
    // Add error listener to prevent EventEmitter throwing
    adapter.on('error', () => {});
    const result = await adapter.handleReconnect();
    expect(result).toBe(false);
  });

  test('increments attempts and emits reconnecting', async () => {
    const adapter = new IPCAdapterBase({ reconnectDelay: 1, maxReconnectAttempts: 3 });
    adapter.connect = async () => { throw new Error('fail'); };
    const events = [];
    adapter.on('reconnecting', (d) => events.push(d.attempt));
    adapter.on('error', () => {});

    // Will fail twice then max out — returns false on max
    const result = await adapter.handleReconnect();
    expect(result).toBe(false);
    expect(adapter.reconnectAttempts).toBeGreaterThanOrEqual(1);
  });
});

describe('IPCAdapterBase — _sendImpl and connect throw by default', () => {
  test('_sendImpl throws not-implemented', async () => {
    const adapter = new IPCAdapterBase();
    adapter.isConnected = true;
    let err;
    try {
      await adapter._sendImpl({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('必须由子类实现');
  });

  test('connect throws not-implemented', async () => {
    const adapter = new IPCAdapterBase();
    let err;
    try {
      await adapter.connect();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toContain('必须由子类实现');
  });
});
