import { describe, expect, test } from 'bun:test';
import {
  parseSSE,
  normalizeStreamEvents,
  StreamEventType,
} from '../../src/models/streaming-parser.js';

describe('parseSSE', () => {
  test('解析单行数据事件', async () => {
    const body = (async function* () {
      yield 'data: {"delta":{"content":"hello"}}\n\n';
    })();

    const events = [];
    for await (const evt of parseSSE(body)) {
      events.push(evt);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('data');
    expect(events[0].data).toContain('hello');
  });

  test('解析 [DONE] 终止标记', async () => {
    const body = (async function* () {
      yield 'data: {"delta":{"content":"a"}}\n\ndata: [DONE]\n\n';
    })();

    const events = [];
    for await (const evt of parseSSE(body)) {
      events.push(evt);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('done');
  });

  test('解析多块 chunked 数据', async () => {
    const body = (async function* () {
      yield 'data: {"delt';
      yield 'a":{"con';
      yield 'tent":"x"';
      yield '}}\n\n';
    })();

    const events = [];
    for await (const evt of parseSSE(body)) {
      events.push(evt);
    }

    const dataEvents = events.filter((e) => e.type === 'data');
    expect(dataEvents.length).toBeGreaterThan(0);
    expect(dataEvents[0].data).toContain('x');
  });

  test('解析事件字段 event: xxx', async () => {
    const body = (async function* () {
      yield 'event: custom_event\ndata: hello\n\n';
    })();

    const events = [];
    for await (const evt of parseSSE(body)) {
      events.push(evt);
    }

    const eventEvt = events.find((e) => e.type === 'event');
    expect(eventEvt).toBeDefined();
    expect(eventEvt?.event).toBe('custom_event');
  });
});

describe('normalizeStreamEvents', () => {
  test('文本增量转换为统一 text_delta 事件', async () => {
    const events = (async function* () {
      yield { type: 'data', data: '{"choices":[{"delta":{"content":"你好"}}]}' };
      yield { type: 'data', data: '{"choices":[{"delta":{"content":"，"}}]}' };
      yield { type: 'done' };
    })();

    const normalized = [];
    for await (const evt of normalizeStreamEvents(events)) {
      normalized.push(evt);
    }

    const textDeltas = normalized.filter((e) => e.type === StreamEventType.TEXT_DELTA);
    expect(textDeltas.length).toBeGreaterThanOrEqual(2);
    expect(textDeltas[0].text).toContain('你好');
    expect(textDeltas[1].text).toContain('，');

    const finishEvent = normalized.find((e) => e.type === StreamEventType.FINISH);
    expect(finishEvent).toBeDefined();
  });

  test('tool_call 增量转换为 tool_call_delta', async () => {
    const events = (async function* () {
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'tool_a', arguments: '' } }] } },
          ],
        }),
      };
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"k":' } }] } }],
        }),
      };
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"v"}' } }] } }],
        }),
      };
      yield { type: 'done' };
    })();

    const normalized = [];
    for await (const evt of normalizeStreamEvents(events)) {
      normalized.push(evt);
    }

    const toolDeltas = normalized.filter((e) => e.type === StreamEventType.TOOL_CALL_DELTA);
    expect(toolDeltas.length).toBeGreaterThanOrEqual(3);
    expect(toolDeltas[0].name).toBe('tool_a');
  });

  test('reasoning_content 转换为 reasoning_delta', async () => {
    const events = (async function* () {
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [{ delta: { reasoning_content: '第一步' } }],
        }),
      };
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [{ delta: { reasoning_content: '分析中' } }],
        }),
      };
      yield { type: 'done' };
    })();

    const normalized = [];
    for await (const evt of normalizeStreamEvents(events)) {
      normalized.push(evt);
    }

    const reasoningDeltas = normalized.filter((e) => e.type === StreamEventType.REASONING_DELTA);
    expect(reasoningDeltas.length).toBeGreaterThanOrEqual(2);
    expect(reasoningDeltas[0].text).toBe('第一步');
    expect(reasoningDeltas[1].text).toBe('分析中');
  });

  test('usage 信息提取', async () => {
    const events = (async function* () {
      yield {
        type: 'data',
        data: JSON.stringify({
          choices: [{ delta: { content: 'hi' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      };
      yield { type: 'done' };
    })();

    const normalized = [];
    for await (const evt of normalizeStreamEvents(events)) {
      normalized.push(evt);
    }

    const usageEvent = normalized.find((e) => e.type === StreamEventType.USAGE);
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.usage?.total_tokens).toBe(12);
  });

  test('空字符串增量被过滤', async () => {
    const events = (async function* () {
      yield { type: 'data', data: JSON.stringify({ choices: [{ delta: { content: '' } }] }) };
      yield { type: 'data', data: JSON.stringify({ choices: [{ delta: { content: 'real' } }] }) };
      yield { type: 'done' };
    })();

    const normalized = [];
    for await (const evt of normalizeStreamEvents(events)) {
      normalized.push(evt);
    }

    const textDeltas = normalized.filter((e) => e.type === StreamEventType.TEXT_DELTA);
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].text).toBe('real');
  });
});

describe('StreamEventType 枚举', () => {
  test('所有事件类型值都唯一且非空', () => {
    const values = Object.values(StreamEventType);
    expect(values.length).toBeGreaterThan(3);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
