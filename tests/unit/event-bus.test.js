import { describe, expect, test } from 'bun:test';
import { getEventBus } from '../../src/runtime/event-bus.js';
import { RuntimeEvent } from '../../src/runtime/types.js';

describe('EventBus', () => {
  test('getEventBus() 返回单例', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();
    expect(bus1).toBe(bus2);
  });

  test('subscribe 返回取消订阅函数', () => {
    const bus = getEventBus();
    const unsub = bus.subscribe(RuntimeEvent.AGENT_START, () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  test('emit 触发订阅回调', () => {
    const bus = getEventBus();
    let received = null;
    const unsub = bus.subscribe(RuntimeEvent.MESSAGE_RECEIVED, (data) => {
      received = data;
    });
    bus.emit(RuntimeEvent.MESSAGE_RECEIVED, { text: 'hello' });
    expect(received.text).toBe('hello');
    expect(received.type).toBe(RuntimeEvent.MESSAGE_RECEIVED);
    expect(typeof received.timestamp).toBe('number');
    expect(typeof received.id).toBe('string');
    expect(received.schemaVersion).toBe(1);
    expect(Number.isSafeInteger(received.sequence)).toBe(true);
    unsub();
  });

  test('propagates correlation and causation metadata in the event envelope', () => {
    const bus = getEventBus();
    let received = null;
    const unsub = bus.subscribe(RuntimeEvent.STATUS_UPDATE, (data) => {
      received = data;
    });
    bus.emit(
      RuntimeEvent.STATUS_UPDATE,
      { status: 'running' },
      { correlationId: 'run-1', causationId: 'request-1' },
    );
    expect(received.correlationId).toBe('run-1');
    expect(received.causationId).toBe('request-1');
    unsub();
  });

  test('unsubscribe 后不再触发回调', () => {
    const bus = getEventBus();
    let count = 0;
    const unsub = bus.subscribe(RuntimeEvent.AGENT_START, () => {
      count++;
    });
    bus.emit(RuntimeEvent.AGENT_START, {});
    expect(count).toBe(1);
    unsub();
    bus.emit(RuntimeEvent.AGENT_START, {});
    expect(count).toBe(1);
  });
});

describe('RuntimeEvent', () => {
  test('包含核心生命周期事件', () => {
    expect(RuntimeEvent.AGENT_START).toBeDefined();
    expect(RuntimeEvent.AGENT_STOP).toBeDefined();
    expect(RuntimeEvent.AGENT_ERROR).toBeDefined();
    expect(RuntimeEvent.AGENT_COMPLETE).toBeDefined();
  });

  test('包含流式事件', () => {
    expect(RuntimeEvent.AGENT_TEXT_DELTA).toBeDefined();
    expect(RuntimeEvent.AGENT_REASONING_DELTA).toBeDefined();
    expect(RuntimeEvent.AGENT_TOOL_CALL_DELTA).toBeDefined();
  });

  test('包含工具事件', () => {
    expect(RuntimeEvent.TOOL_CALL).toBeDefined();
    expect(RuntimeEvent.TOOL_RESULT).toBeDefined();
    expect(RuntimeEvent.TOOL_ERROR).toBeDefined();
  });

  test('包含消息事件', () => {
    expect(RuntimeEvent.MESSAGE_RECEIVED).toBeDefined();
    expect(RuntimeEvent.MESSAGE_SENT).toBeDefined();
  });

  test('包含状态和配置事件', () => {
    expect(RuntimeEvent.STATUS_UPDATE).toBeDefined();
    expect(RuntimeEvent.CONFIG_CHANGE).toBeDefined();
  });
});
