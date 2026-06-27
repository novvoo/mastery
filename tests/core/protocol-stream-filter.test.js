import { describe, expect, test } from 'bun:test';
import { createProtocolStreamFilter } from '../../src/core/runtime/agent/agent-engine.js';

function collectVisible(filter, chunks) {
  const events = [];
  let text = '';
  for (const chunk of chunks) {
    const out = filter.push(chunk);
    if (out.visibleText) text += out.visibleText;
    if (out.protocolDetected) events.push(out);
  }
  const flushed = filter.flush();
  if (flushed.visibleText) text += flushed.visibleText;
  if (flushed.protocolDetected) events.push(flushed);
  return { text, events };
}

describe('createProtocolStreamFilter', () => {
  test('suppresses tool JSON after natural-language prefix', () => {
    const result = collectVisible(createProtocolStreamFilter(), [
      '我先检查目录：\n',
      '{"action":{"list_dir":{"path":"."}}}',
      '\n继续处理。',
    ]);

    expect(result.text).toBe('我先检查目录：\n\n继续处理。');
    expect(result.events.length).toBe(1);
  });

  test('suppresses split XML tool protocol', () => {
    const result = collectVisible(createProtocolStreamFilter(), [
      '开始',
      '<tool_call>',
      '{"name":"read_file"}',
      '</tool_call>',
      '结束',
    ]);

    expect(result.text).toBe('开始结束');
    expect(result.events.length).toBe(1);
  });

  test('suppresses repeated empty output protocol shells', () => {
    const result = collectVisible(createProtocolStreamFilter(), [
      '<output>\n',
      '\n</output>',
      '<output>\n\n</output>',
    ]);

    expect(result.text).toBe('');
    expect(result.events.length).toBe(2);
  });

  test('does not suppress ordinary JSON content', () => {
    const result = collectVisible(createProtocolStreamFilter(), [
      '配置示例：',
      '{"theme":"dark","enabled":true}',
    ]);

    expect(result.text).toBe('配置示例：{"theme":"dark","enabled":true}');
    expect(result.events.length).toBe(0);
  });

  test('does not hold ordinary less-than text as XML protocol', () => {
    const result = collectVisible(createProtocolStreamFilter(), ['判断：a < b，并继续输出']);

    expect(result.text).toBe('判断：a < b，并继续输出');
    expect(result.events.length).toBe(0);
  });

  test('suppresses fenced JSON protocol without leaking fence markers', () => {
    const result = collectVisible(createProtocolStreamFilter(), [
      '准备调用\n',
      '```json\n{"action":{"read_file":{"path":"a.js"}}}\n```',
      '\n完成',
    ]);

    expect(result.text).toBe('准备调用\n\n完成');
    expect(result.events.length).toBe(1);
  });
});
