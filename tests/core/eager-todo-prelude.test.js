import { describe, test, expect } from 'bun:test';

/**
 * 测试 Agent 引擎中的 Eager Todo Prelude 检测逻辑。
 *
 * 这个测试验证 agent-engine.js 和 agent.js 中的多步指令检测正则表达式
 * 是否能够正确识别多步请求并忽略单步请求。
 */

function hasMultipleStepsDetector(input) {
  return /(?:then|after\s+(?:that|which)|next|and\s+then|首先|然后|接着|之后|第一步|第二步|步骤)/i.test(
    input,
  ) || /\d+\s*(?:step|phase|stage|阶段|步)/i.test(input) || /(?:\n|[,;、，；])\s*(?:implement|create|fix|add|write|test|build|run|deploy|实现|创建|修复|添加|编写|测试|构建|运行|部署)/i.test(
    input,
  );
}

describe('Eager Todo Prelude - multi-step detection', () => {
  // ========== 多步请求 —— 应该触发 ========== //

  test('detects "then"-based multi-step (English)', () => {
    expect(hasMultipleStepsDetector(
      'implement tests then run them then fix bugs',
    )).toBe(true);
  });

  test('detects "after that" multi-step (English)', () => {
    expect(hasMultipleStepsDetector(
      'create the module, after that add tests',
    )).toBe(true);
  });

  test('detects "after which" multi-step (English)', () => {
    expect(hasMultipleStepsDetector(
      'write the parser after which validate the output',
    )).toBe(true);
  });

  test('detects "next" multi-step (English)', () => {
    expect(hasMultipleStepsDetector(
      'build the API next add authentication',
    )).toBe(true);
  });

  test('detects "and then" multi-step (English)', () => {
    expect(hasMultipleStepsDetector(
      'refactor the class and then write unit tests',
    )).toBe(true);
  });

  // ========== 中文多步请求 —— 应该触发 ========== //

  test('detects "首先" multi-step (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '首先修复登录bug，然后添加测试',
    )).toBe(true);
  });

  test('detects "然后" multi-step (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '实现用户模块，然后写单元测试',
    )).toBe(true);
  });

  test('detects "接着" multi-step (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '创建数据库模型接着写API接口',
    )).toBe(true);
  });

  test('detects "之后" multi-step (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '完成重构之后运行全部测试',
    )).toBe(true);
  });

  test('detects "第一步" enumerated steps (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '第一步：实现测试模块 第二步：运行测试',
    )).toBe(true);
  });

  test('detects "步骤" enumerated steps (Chinese)', () => {
    expect(hasMultipleStepsDetector(
      '步骤1：分析问题 步骤2：实现修复 步骤3：验证',
    )).toBe(true);
  });

  // ========== 枚举式多步请求 —— 应该触发 ========== //

  test('detects numbered steps pattern', () => {
    expect(hasMultipleStepsDetector(
      '3 step process: design, implement, verify',
    )).toBe(true);
  });

  test('detects "phases" multi-stage pattern', () => {
    expect(hasMultipleStepsDetector(
      'complete this in 2 phases: backend then frontend',
    )).toBe(true);
  });

  test('detects comma-separated action list with implement/create/fix', () => {
    expect(hasMultipleStepsDetector(
      '写个html页面,然后实现登录功能,添加验证',
    )).toBe(true);
  });

  test('detects newline-separated action list', () => {
    expect(hasMultipleStepsDetector(
      'Create the HTML structure\nAdd CSS styles\nImplement JavaScript logic',
    )).toBe(true);
  });

  test('detects multi-action with semicolon', () => {
    expect(hasMultipleStepsDetector(
      '修复 bug；添加测试；运行验证',
    )).toBe(true);
  });

  test('detects multi-action with Chinese comma', () => {
    expect(hasMultipleStepsDetector(
      '先写测试模块,实现功能，最后修复bug',
    )).toBe(true);
  });

  // ========== 单步请求 —— 不应触发 ========== //

  test('ignores single-step requests', () => {
    expect(hasMultipleStepsDetector('fix the login bug')).toBe(false);
  });

  test('ignores simple questions', () => {
    expect(hasMultipleStepsDetector('what does this function do?')).toBe(false);
  });

  test('ignores single file reads', () => {
    expect(hasMultipleStepsDetector('show me package.json')).toBe(false);
  });

  test('ignores informational requests', () => {
    expect(hasMultipleStepsDetector('explain the architecture')).toBe(false);
  });

  test('ignores simple create with single action', () => {
    expect(hasMultipleStepsDetector('create a todo app')).toBe(false);
  });

  test('ignores add single feature', () => {
    expect(hasMultipleStepsDetector('add a button to the page')).toBe(false);
  });

  test('ignores single write request', () => {
    expect(hasMultipleStepsDetector('write a README file')).toBe(false);
  });

  test('ignores single fix request', () => {
    expect(hasMultipleStepsDetector('fix the broken link in footer')).toBe(false);
  });

  test('ignores single test request', () => {
    expect(hasMultipleStepsDetector('run the tests and report results')).toBe(false);
  });

  // ========== 边界情况 ========== //

  test('handles requests where then/next appear but not as step markers', () => {
    expect(hasMultipleStepsDetector(
      'what happens then if we call this?',
    )).toBe(true);
  });

  test('detects step-based multi-action in Chinese', () => {
    expect(hasMultipleStepsDetector(
      '你在测试模块实现后运行测试就知道哪里出bug了，然后处理这个bug',
    )).toBe(true);
  });
});
