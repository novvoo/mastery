import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SecurityPolicy,
  Decision,
  DenyReason,
  createReadOnlyPolicy,
  createRestrictedPolicy,
  createFullPolicy,
} from '../../src/core/security-policy.js';

describe('SecurityPolicy', () => {
  describe('Decision and DenyReason', () => {
    test('Decision has expected values', () => {
      expect(Decision.ALLOW).toBe('allow');
      expect(Decision.DENY).toBe('deny');
      expect(Decision.REQUIRE_APPROVAL).toBe('require_approval');
      expect(Decision.RATE_LIMITED).toBe('rate_limited');
    });

    test('DenyReason has expected values', () => {
      expect(DenyReason.PERMISSION_MISMATCH).toBe('permission_mismatch');
      expect(DenyReason.EXTERNAL_EFFECT_BLOCKED).toBe('external_effect_blocked');
      expect(DenyReason.CONCURRENCY_UNSAFE).toBe('concurrency_unsafe');
      expect(DenyReason.SCOPE_MISMATCH).toBe('scope_mismatch');
    });
  });

  describe('constructor and registerPolicy', () => {
    let policy;
    beforeEach(() => {
      policy = new SecurityPolicy();
    });

    test('creates with default options', () => {
      expect(policy).toBeDefined();
      expect(policy.listRegisteredTools()).toEqual([]);
    });

    test('registers a tool and returns policy', () => {
      policy.registerPolicy('my_tool');
      const p = policy.getPolicy('my_tool');
      expect(p).toBeDefined();
      expect(p.permissionLevel).toBeDefined();
    });

    test('registers a tool with custom options', () => {
      policy.registerPolicy('dangerous_tool', { requiresApproval: true, hasExternalEffect: true });
      const p = policy.getPolicy('dangerous_tool');
      expect(p.requiresApproval).toBe(true);
      expect(p.hasExternalEffect).toBe(true);
    });
  });

  describe('evaluate', () => {
    let policy;
    beforeEach(() => {
      policy = new SecurityPolicy();
    });

    test('allows tool with no restrictions', () => {
      policy.registerPolicy('safe_tool');
      const result = policy.evaluate('safe_tool', {});
      expect(result.decision).toBe(Decision.ALLOW);
    });

    test('requires approval for tool with requiresApproval', () => {
      policy.registerPolicy('approval_tool', { requiresApproval: true });
      const result = policy.evaluate('approval_tool', {});
      expect(result.decision).toBe(Decision.REQUIRE_APPROVAL);
    });

    test('denies when external effects blocked globally', () => {
      const restrictedPolicy = new SecurityPolicy({ allowExternalEffect: false });
      restrictedPolicy.registerPolicy('external_tool', { hasExternalEffect: true });
      const result = restrictedPolicy.evaluate('external_tool', {});
      expect(result.decision).toBe(Decision.DENY);
    });
  });

  describe('getPolicy', () => {
    test('returns default policy for unregistered tool', () => {
      const policy = new SecurityPolicy();
      const p = policy.getPolicy('unknown_tool');
      expect(p).toBeDefined();
    });
  });

  describe('audit and report', () => {
    test('getAuditLog returns log entries', () => {
      const policy = new SecurityPolicy();
      policy.registerPolicy('test_tool');
      policy.evaluate('test_tool', {});
      const log = policy.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
    });

    test('getSecurityReport returns report', () => {
      const policy = new SecurityPolicy();
      policy.registerPolicy('test_tool');
      policy.evaluate('test_tool', {});
      const report = policy.getSecurityReport();
      expect(report).toBeDefined();
      // Report should contain some structure
      expect(typeof report).toBe('object');
    });
  });

  describe('factory functions', () => {
    test('createReadOnlyPolicy returns policy', () => {
      const p = createReadOnlyPolicy();
      expect(p).toBeInstanceOf(SecurityPolicy);
    });

    test('createRestrictedPolicy returns policy', () => {
      const p = createRestrictedPolicy();
      expect(p).toBeInstanceOf(SecurityPolicy);
    });

    test('createFullPolicy returns policy', () => {
      const p = createFullPolicy();
      expect(p).toBeInstanceOf(SecurityPolicy);
    });
  });

  describe('utility methods', () => {
    test('getMaxResultChars returns default', () => {
      const policy = new SecurityPolicy();
      expect(policy.getMaxResultChars('any_tool')).toBe(10000);
    });

    test('isConcurrencySafe returns true by default', () => {
      const policy = new SecurityPolicy();
      expect(policy.isConcurrencySafe('any_tool')).toBe(true);
    });

    test('hasExternalEffect returns false by default', () => {
      const policy = new SecurityPolicy();
      expect(policy.hasExternalEffect('any_tool')).toBe(false);
    });
  });
});
