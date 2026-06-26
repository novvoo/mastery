import { describe, it, expect } from 'bun:test';
import { TextToolParser } from '../../src/core/text-tool-parser.js';

const makeRegistry = (names) => ({
  has: (n) => names.includes(n),
  getAll: () => names.map((n) => ({ name: n, description: 'x' })),
});

describe('TextToolParser: detectMalformedToolCall', () => {
  it('returns null for plain English responses', () => {
    const p = new TextToolParser(makeRegistry(['write_file']));
    expect(p.detectMalformedToolCall('Sure, I will help you write the file.')).toBeNull();
  });

  it('returns null for well-formed <action>...</action>', () => {
    const p = new TextToolParser(makeRegistry(['write_file']));
    const res =
      '<action>{"name": "write_file", "arguments": {"path": "x", "content": "y"}}</action>';
    expect(p.detectMalformedToolCall(res)).toBeNull();
  });

  it('parses action string objects inside <action> tags', () => {
    const p = new TextToolParser(makeRegistry(['web_search']));
    const res =
      '<action>{"action":"web_search","query":"厦门天气 2026-06-18 气温","max_results":5}</action>';
    const parsed = p.parse(res).filter((c) => c.source !== 'natural_language');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('web_search');
    expect(parsed[0].arguments.query).toBe('厦门天气 2026-06-18 气温');
    expect(parsed[0].arguments.max_results).toBe(5);
  });

  it('returns null for well-formed CALL ...({...})', () => {
    const p = new TextToolParser(makeRegistry(['shell']));
    const res = 'CALL shell({"command": "ls -la"})';
    expect(p.detectMalformedToolCall(res)).toBeNull();
  });

  it('parses fenced plan JSON with metadata and action object', () => {
    const p = new TextToolParser(makeRegistry(['shell']));
    const res = `我将创建项目结构。

\`\`\`json
{
  "evaluation_previous_goal": "start",
  "memory": "init",
  "next_goal": "create folders",
  "action": {
    "shell": {
      "command": "mkdir -p snake-game/src/{core,entities} snake-game/tests && cd snake-game && pwd"
    }
  }
}
\`\`\``;
    const parsed = p.parse(res).filter((c) => c.source !== 'natural_language');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('shell');
    expect(parsed[0].arguments.command).toContain('mkdir -p snake-game');
  });

  it('recovers malformed fenced plan JSON shell action instead of dropping it', () => {
    const p = new TextToolParser(makeRegistry(['shell']));
    const res = `我将创建项目结构。

\`\`\`json
{
  "evaluation_previous_goal": "start",
  "memory": "init",
  "next_goal": "create folders",
  "action": {
    "shell": {
      "command": "mkdir -p snake-game/src/{core,entities} snake-game/tests && cd snake-game && pwd
    }
  }
}
\`\`\``;
    const parsed = p.parse(res).filter((c) => c.source !== 'natural_language');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('shell');
    expect(parsed[0].arguments.command).toBe(
      'mkdir -p snake-game/src/{core,entities} snake-game/tests && cd snake-game && pwd',
    );
  });

  it('detects <action>...</annotation> (mismatched close tag)', () => {
    const p = new TextToolParser(makeRegistry(['write_file']));
    const res = `<action>{"name": "write_file", "arguments": {"path": "x.js", "content": "hi"}}</annotation>`;
    const diag = p.detectMalformedToolCall(res);
    expect(diag).not.toBeNull();
    expect(diag.tag).toBe('xml_close_mismatch_or_missing');
    expect(diag.opening.toLowerCase()).toContain('<action');
    expect(diag.closing).toBe('</annotation>');
    expect(typeof diag.hint).toBe('string');
    expect(diag.hint.length).toBeGreaterThan(5);
  });

  it('detects <action>...</action_tag> (another mismatch)', () => {
    const p = new TextToolParser(makeRegistry(['shell']));
    const res = `<action>{"name": "shell", "arguments": {"command": "ls"}}</action_tag>`;
    const diag = p.detectMalformedToolCall(res);
    expect(diag).not.toBeNull();
    expect(diag.tag).toBe('xml_close_mismatch_or_missing');
    expect(diag.closing).toBe('</action_tag>');
  });

  it('detects <action> with no close tag at all', () => {
    const p = new TextToolParser(makeRegistry(['shell']));
    const res = `<action>{"name": "shell", "arguments": {"command": "ls"}}`;
    const diag = p.detectMalformedToolCall(res);
    expect(diag).not.toBeNull();
    expect(diag.tag).toBe('xml_close_mismatch_or_missing');
    expect(diag.closing.toLowerCase()).toContain('missing');
  });

  it('parse() does NOT force-parse the mismatched-tag case', () => {
    const p = new TextToolParser(makeRegistry(['write_file']));
    const res = `<action>{"name": "write_file", "arguments": {"path": "x.js", "content": "hi"}}</annotation>`;
    // Should not parse as a tool call — let the correction loop ask LLM to retry.
    const parsed = p.parse(res).filter((c) => c.source !== 'natural_language');
    expect(parsed.length).toBe(0);
  });
});
