import { describe, test, expect } from 'bun:test';

function stripActionBlocks(text = '') {
  return text
    .replace(/<action>[\s\S]*?<\/action>/gi, '')
    .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')
    .trim();
}

describe('stripActionBlocks', () => {
  test('pure <action> tag returns empty', () => {
    const result = stripActionBlocks('<action>{"name":"read_file","arguments":{"path":"README.md"}}</action>');
    expect(result).toBe('');
  });

  test('text + <action> tag strips action block', () => {
    const result = stripActionBlocks('我先读取 README\n<action>{"name":"read_file","arguments":{"path":"README.md"}}</action>');
    expect(result).toBe('我先读取 README');
  });

  test('code-fenced JSON tool call strips action block', () => {
    const result = stripActionBlocks('执行搜索\n```json\n{"name":"search_file","arguments":{"pattern":"test"}}\n```');
    expect(result).toBe('执行搜索');
  });

  test('no tool call preserves full text', () => {
    const result = stripActionBlocks('这是一个普通的回答，没有工具调用。');
    expect(result).toBe('这是一个普通的回答，没有工具调用。');
  });

  test('multiple <action> tags all stripped', () => {
    const result = stripActionBlocks('<action>{"name":"read_file","path":"a"}</action>中间文本<action>{"name":"read_file","path":"b"}</action>');
    expect(result).toBe('中间文本');
  });

  test('mixed code fence and action tag', () => {
    const result = stripActionBlocks('开始\n```json\n{"name":"search"}```\n继续\n<action>{"name":"read"}</action>');
    expect(result).toBe('开始\n\n继续');
  });
});
