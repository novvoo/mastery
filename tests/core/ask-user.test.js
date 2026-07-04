import { describe, test, expect } from 'bun:test';
import createAskUserTool from '../../src/tools/skills/ask_user.js';
import { ToolRegistry } from '../../src/core/runtime/agent/tool-registry.js';

describe('ask_user tool', () => {
  test('has no required parameters', () => {
    const tool = createAskUserTool();
    expect(tool.required).toEqual([]);
  });

  test('handler returns default values when no params provided', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({});
    
    expect(result.type).toBe('user_input_required');
    expect(result.reason).toBe('Need user input before continuing.');
    expect(result.questions).toEqual(['Please provide clarification or additional information.']);
    expect(result.blockingFacts).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.answer).toContain('需要你补充一点信息后我才能继续');
  });

  test('handler uses provided reason', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({ reason: '需要确认用户偏好' });
    
    expect(result.reason).toBe('需要确认用户偏好');
    expect(result.questions).toEqual(['Please provide clarification or additional information.']);
  });

  test('handler uses provided questions', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({ questions: ['你喜欢什么颜色？', '你喜欢什么风格？'] });
    
    expect(result.reason).toBe('Need user input before continuing.');
    expect(result.questions).toEqual(['你喜欢什么颜色？', '你喜欢什么风格？']);
  });

  test('handler handles single question string', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({ questions: '你喜欢什么颜色？' });
    
    expect(result.questions).toEqual(['你喜欢什么颜色？']);
  });

  test('handler handles questions as comma-separated string', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({ questions: '颜色,风格,尺寸' });
    
    expect(result.questions).toEqual(['颜色', '风格', '尺寸']);
  });

  test('handler limits questions to 3', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({
      questions: ['q1', 'q2', 'q3', 'q4', 'q5']
    });
    
    expect(result.questions.length).toBe(3);
    expect(result.questions).toEqual(['q1', 'q2', 'q3']);
  });

  test('handler uses provided blocking_facts', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({
      blocking_facts: ['缺少用户偏好信息', '缺少项目需求']
    });
    
    expect(result.blockingFacts).toEqual(['缺少用户偏好信息', '缺少项目需求']);
  });

  test('handler uses provided suggestions', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({
      suggestions: ['红色', '蓝色', '简约风格']
    });
    
    expect(result.suggestions).toEqual(['红色', '蓝色', '简约风格']);
  });

  test('handler returns complete answer text with all fields', async () => {
    const tool = createAskUserTool();
    const result = await tool.handler({
      reason: '需要确认用户偏好',
      questions: ['你喜欢什么颜色？'],
      blocking_facts: ['缺少用户偏好信息'],
      suggestions: ['红色', '蓝色']
    });
    
    expect(result.answer).toContain('需要确认用户偏好');
    expect(result.answer).toContain('你喜欢什么颜色？');
    expect(result.answer).toContain('缺少用户偏好信息');
    expect(result.answer).toContain('红色');
    expect(result.answer).toContain('蓝色');
  });

  test('ToolRegistry validation passes with no params', () => {
    const registry = new ToolRegistry();
    const tool = createAskUserTool();
    registry.register(tool);
    
    const result = registry.validateAndCoerceArgs('ask_user', {});
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('ToolRegistry validation passes with partial params', () => {
    const registry = new ToolRegistry();
    const tool = createAskUserTool();
    registry.register(tool);
    
    const result = registry.validateAndCoerceArgs('ask_user', { reason: 'test' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('ToolRegistry validation passes with full params', () => {
    const registry = new ToolRegistry();
    const tool = createAskUserTool();
    registry.register(tool);
    
    const result = registry.validateAndCoerceArgs('ask_user', {
      reason: 'test',
      questions: ['q1', 'q2']
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
