/**
 * SSE (Server-Sent Events) + OpenAI/兼容 API 流式解析器
 *
 * 负责把 fetch 的 ReadableStream 分切成 data: 行，
 * 解析出 { delta, usage, finish_reason } 这种事件，
 * 再向上层（AgentEngine）合并成 text/toolCalls/reasoning。
 *
 * 支持两种 API：
 *   1. OpenAI Chat Completions SSE  — `data: {...}`
 *   2. DeepSeek / Anthropic Claude 兼容 API  — 同样 SSE 格式
 */

import { TextDecoder } from 'node:util';

/** 流式解析器的输出事件类型 */
export const StreamEventType = {
  TEXT_DELTA: 'text_delta',
  TOOL_CALL_DELTA: 'tool_call_delta',
  REASONING_DELTA: 'reasoning_delta',
  USAGE: 'usage',
  FINISH: 'finish',
};

/**
 * 从 fetch 响应 body / 或 async generator 中按 SSE 协议读取数据块。
 *
 * 兼容两种输入：
 *   1. ReadableStream (fetch response.body) — 使用 getReader() 读取
 *   2. AsyncGenerator<string> / AsyncIterable<string> — 直接 for await
 *
 * SSE 协议：
 *   每条消息以空行分隔
 *   每行格式 `data: <json>`
 *   `event: <name>` 也是支持的字段
 *   `data: [DONE]` 表示流结束（OpenAI 约定）
 *
 * 输出事件格式：
 *   { type: 'data',  data: '<原始 JSON 字符串>' }
 *   { type: 'event', event: '<事件名>' }
 *   { type: 'done' }                              对应 [DONE]
 *
 * @param {ReadableStream | AsyncIterable<string>} body
 * @returns {AsyncGenerator<Object>}
 */
export async function* parseSSE(body) {
  if (!body) {
    return;
  }

  let chunkSource;
  if (typeof body.getReader === 'function') {
    // —— ReadableStream 路径 ——
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    chunkSource = async function* () {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        yield decoder.decode(value, { stream: true });
      }
      const tail = decoder.decode();
      if (tail) {
        yield tail;
      }
    };
  } else if (typeof body[Symbol.asyncIterator] === 'function' || typeof body.next === 'function') {
    // —— AsyncGenerator / AsyncIterable 路径 ——
    chunkSource = () => body;
  } else {
    return;
  }

  let buffer = '';
  for await (const chunk of chunkSource()) {
    buffer += chunk;

    // 连续切分以 \n\n 或 \r\n\r\n 结尾的 SSE 消息
    while (true) {
      let boundary = buffer.indexOf('\r\n\r\n');
      if (boundary === -1) {
        boundary = buffer.indexOf('\n\n');
      }
      if (boundary === -1) {
        break;
      }

      const raw = buffer.slice(0, boundary);
      // 根据实际出现的分隔符决定 slice 步长
      const stepSize = buffer.charAt(boundary) === '\r' ? 4 : 2;
      buffer = buffer.slice(boundary + stepSize);

      // 一个 SSE 消息里可能有多个 data: 行；支持 event: / id: 等字段
      const lines = raw.split(/\r?\n/);
      let lastEventName = null;
      let lastDataPayload = null;

      for (const line of lines) {
        if (!line) {
          continue;
        }
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield { type: 'done' };
            continue;
          }
          // 拼接多个连续 data: 行（SSE 允许 data 多行合并）
          lastDataPayload = lastDataPayload === null ? payload : lastDataPayload + '\n' + payload;
        } else if (trimmed.startsWith('event:')) {
          lastEventName = trimmed.slice(6).trim();
        }
        // 忽略 id:, retry: 等其他字段
      }

      if (lastEventName !== null) {
        yield { type: 'event', event: lastEventName, data: lastDataPayload };
      }
      if (lastDataPayload !== null) {
        yield { type: 'data', data: lastDataPayload };
      }
    }
  }
}

/**
 * 把 parseSSE 产出的 `{ type: 'data'|'done'|'event', data: 'json字符串' }`
 * 事件归一化为通用增量事件：
 *
 *   { type: 'text_delta',        text }
 *   { type: 'tool_call_delta',   index, name?, arguments? }
 *   { type: 'reasoning_delta',   text }
 *   { type: 'usage',             usage }
 *   { type: 'finish',            reason }
 *
 * 兼容两种输入：
 *   - parseSSE 输出的字符串 data 事件：{ type: 'data', data: '{"choices":...}' }
 *   - 已经解析好的 OpenAI 格式对象（带 choices 字段）
 *
 * @param {AsyncIterable<Object>} eventStream
 * @returns {AsyncGenerator<Object>}
 */
export async function* normalizeStreamEvents(eventStream) {
  const accumulator = {
    text: '',
    reasoningText: '',
    toolCalls: [], // [{ index, name, arguments }]
    usage: null,
    finishReason: null,
  };

  for await (const rawEvent of eventStream) {
    // —— 事件类型预处理 ——
    let event = rawEvent;

    // 1) { type: 'done' } → 产出一个 finish 事件
    if (event?.type === 'done') {
      yield { type: StreamEventType.FINISH, reason: accumulator.finishReason || 'stop' };
      continue;
    }

    // 2) { type: 'data', data: '<json>' } → 解析 JSON
    if (event?.type === 'data' && typeof event?.data === 'string') {
      try {
        event = JSON.parse(event.data);
      } catch {
        continue;
      }
    }

    // 3) { type: 'event' } 暂不处理，跳过
    if (event?.type === 'event') {
      continue;
    }

    // —— 错误透传 ——
    if (event?.error) {
      throw new Error(
        typeof event.error === 'string' ? event.error : event.error.message || 'Streaming error',
      );
    }

    const choice = event?.choices?.[0];
    if (!choice) {
      continue;
    }

    // OpenAI style: choice.delta.{content, tool_calls, reasoning_content}
    const delta = choice.delta || {};
    const finishReason = choice.finish_reason || event.finish_reason;

    // reasoning: reasoning_content 或 thinking_content 字段
    const reasoning = delta.reasoning_content || delta.thinking_content || delta.reasoning || null;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      accumulator.reasoningText += reasoning;
      yield { type: StreamEventType.REASONING_DELTA, text: reasoning };
    }

    // text content
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      accumulator.text += delta.content;
      yield { type: StreamEventType.TEXT_DELTA, text: delta.content };
    }

    // tool_calls: delta.tool_calls 是数组，每项有 index/name/function.arguments
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        if (!accumulator.toolCalls[idx]) {
          accumulator.toolCalls[idx] = { index: idx, name: '', arguments: '' };
        }
        let namePiece = '';
        let argsPiece = '';
        // 优先走 function: { name, arguments } 路径（OpenAI 兼容格式）
        // 回退到平铺 { name, arguments } 格式
        if (tc.function && typeof tc.function === 'object') {
          if (typeof tc.function.name === 'string') {
            namePiece = tc.function.name;
          }
          if (typeof tc.function.arguments === 'string') {
            argsPiece = tc.function.arguments;
          }
        } else {
          if (typeof tc.name === 'string') {
            namePiece = tc.name;
          }
          if (typeof tc.arguments === 'string') {
            argsPiece = tc.arguments;
          }
        }
        if (namePiece) {
          accumulator.toolCalls[idx].name += namePiece;
        }
        if (argsPiece) {
          accumulator.toolCalls[idx].arguments += argsPiece;
        }
        yield {
          type: StreamEventType.TOOL_CALL_DELTA,
          index: idx,
          name: namePiece || undefined,
          arguments: argsPiece || undefined,
        };
      }
    }

    // usage —— 透传原始字段（prompt_tokens / completion_tokens / total_tokens）
    if (event.usage) {
      accumulator.usage = event.usage;
      yield {
        type: StreamEventType.USAGE,
        usage: { ...event.usage },
      };
    }

    if (finishReason) {
      accumulator.finishReason = finishReason;
      yield { type: StreamEventType.FINISH, reason: finishReason };
    }
  }

  // 返回最终聚合结果，作为 generator 的 return 值
  return {
    text: accumulator.text,
    reasoning: accumulator.reasoningText ? { text: accumulator.reasoningText } : null,
    toolCalls: accumulator.toolCalls
      .filter((tc) => tc && tc.name)
      .map((tc) => {
        let parsedArgs = {};
        try {
          if (tc.arguments) {
            parsedArgs = JSON.parse(tc.arguments);
          }
        } catch {
          parsedArgs = {};
        }
        return {
          name: tc.name,
          arguments: parsedArgs,
          _rawArguments: tc.arguments,
        };
      }),
    finishReason: accumulator.finishReason,
    usage: accumulator.usage
      ? {
          inputTokens: accumulator.usage.prompt_tokens,
          outputTokens: accumulator.usage.completion_tokens,
          totalTokens: accumulator.usage.total_tokens,
        }
      : null,
  };
}
