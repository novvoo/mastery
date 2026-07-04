import { describe, test, expect } from 'bun:test';
import {
  extractExplicitPlanType,
  getPlanTypeSelection,
  inferTaskSignals,
  scorePlanTypes,
  selectPlanType,
} from '../../src/core/runtime/agent/support/plan-types.js';

describe('plan type selection', () => {
  test('supports Chinese explicit plan type hints', () => {
    expect(extractExplicitPlanType('计划类型: 安全 修复登录鉴权')).toBe('security');
    expect(extractExplicitPlanType('使用 文档 计划 更新 README')).toBe('documentation');
    expect(extractExplicitPlanType('plan:review inspect the current diff')).toBe('code_review');
    expect(extractExplicitPlanType('plan type: review inspect the current diff')).toBe(
      'code_review',
    );
  });

  test('selects specialized plan families from task signals', () => {
    expect(selectPlanType({}, '重构 billing service，保持行为不变')).toBe('refactor');
    expect(selectPlanType({}, '给 payment API 添加单元测试和覆盖率')).toBe('testing');
    expect(selectPlanType({}, '审查这次 PR 的代码风险')).toBe('code_review');
    expect(selectPlanType({}, '迁移数据库 schema 到新版字段')).toBe('migration');
    expect(selectPlanType({}, '配置本地开发环境和 env')).toBe('setup');
    expect(selectPlanType({}, '准备发布版本和 changelog')).toBe('release');
    expect(selectPlanType({}, '修复 auth token 权限绕过')).toBe('security');
    expect(selectPlanType({}, '调整 React 组件布局和 CSS')).toBe('ui');
  });

  test('returns signals and ranked candidates for explainability', () => {
    const selection = getPlanTypeSelection({}, '优化数据库查询性能并验证结果');
    expect(selection.signals.data).toBe(true);
    expect(selection.signals.performance).toBe(true);
    expect(selection.ranked[0].score).toBeGreaterThan(0);
  });

  test('scores multiple candidates instead of using a single hard-coded branch', () => {
    const scores = scorePlanTypes({}, '修复前端按钮点击失败并补测试');
    const candidates = scores.filter((item) => item.score > 0).map((item) => item.type);
    expect(candidates).toContain('bug_fix');
    expect(candidates).toContain('testing');
    expect(candidates).toContain('ui');
  });

  test('inferTaskSignals returns boolean signal map', () => {
    const signals = inferTaskSignals('安全审计 auth webhook');
    expect(signals.security).toBe(true);
    expect(signals.api).toBe(true);
    expect(signals.review).toBe(true);
  });
});
