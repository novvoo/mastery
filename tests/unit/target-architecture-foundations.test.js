import { describe, expect, test } from 'bun:test';
import {
  CommandContractError,
  ensureCommandContractCoverage,
  getCommandContract,
  listCommandContracts,
  validateCommand,
} from '../../src/adapters/desktop/protocol/command-contracts.js';
import { DIRECT_INVOKE_CHANNELS } from '../../src/adapters/desktop/ipc/main-process/channels.js';
import {
  CapabilityRegistry,
  CapabilityStatus,
  createDesktopCapabilityRegistry,
} from '../../src/adapters/desktop/capability-registry.js';
import {
  RuntimeSupervisor,
  SupervisorState,
} from '../../src/adapters/desktop/runtime-supervisor.js';
import {
  CapabilityPolicyEngine,
  PolicyDeniedError,
  PolicyEffect,
} from '../../src/adapters/desktop/policy-engine.js';

describe('versioned command contracts', () => {
  test('normalizes a valid agent command', () => {
    expect(validateCommand('agent:processInput', {
      input: '  explain this  ',
      options: {},
    })).toEqual({
      input: 'explain this',
      options: {},
    });
  });

  test('rejects invalid high-risk commands with a stable error code', () => {
    expect(() => validateCommand('terminal:execute', { command: '   ' }))
      .toThrow(CommandContractError);
    try {
      validateCommand('app:openExternal', 'file:///etc/passwd');
    } catch (error) {
      expect(error.code).toBe('UNSUPPORTED_URL_SCHEME');
      expect(error.details.channel).toBe('app:openExternal');
    }
  });

  test('publishes version and risk metadata', () => {
    const contracts = listCommandContracts();
    expect(contracts.every((contract) => contract.schemaVersion === 1)).toBe(true);
    expect(contracts.find((contract) => contract.channel === 'terminal:execute')?.risk)
      .toBe('critical');
  });

  test('covers every directly invokable channel and rejects uncontracted commands', () => {
    expect(ensureCommandContractCoverage(DIRECT_INVOKE_CHANNELS)).toEqual({
      total: DIRECT_INVOKE_CHANNELS.length,
      missing: [],
    });
    expect(DIRECT_INVOKE_CHANNELS.every((channel) => getCommandContract(channel))).toBe(true);
    expect(() => validateCommand('unknown:command', {})).toThrow('尚未注册');
  });
});

describe('capability registry', () => {
  test('publishes stable capability manifests without leaking mutable state', () => {
    const registry = createDesktopCapabilityRegistry();
    const listed = registry.list();
    expect(listed.find((entry) => entry.id === 'agent.runtime')).toMatchObject({
      version: 1,
      status: CapabilityStatus.AVAILABLE,
      owner: 'DesktopCore',
    });
    listed[0].status = 'tampered';
    expect(registry.list()[0].status).not.toBe('tampered');
  });

  test('supports explicit degraded and unavailable states', () => {
    const registry = new CapabilityRegistry();
    registry.register({ id: 'preview.process' });
    registry.setStatus('preview.process', CapabilityStatus.DEGRADED, 'worker restarting');
    expect(registry.get('preview.process')).toMatchObject({
      status: 'degraded',
      reason: 'worker restarting',
    });
  });
});

describe('runtime supervisor', () => {
  test('coalesces concurrent starts and exposes health', async () => {
    let starts = 0;
    const runtime = {
      async initialize() { starts += 1; },
      async dispose() {},
    };
    const supervisor = new RuntimeSupervisor({ createRuntime: () => runtime });
    const [first, second] = await Promise.all([supervisor.start(), supervisor.start()]);
    expect(first).toBe(runtime);
    expect(second).toBe(runtime);
    expect(starts).toBe(1);
    expect(supervisor.getHealth().state).toBe(SupervisorState.HEALTHY);
  });

  test('enforces the restart budget and disposes failed runtimes', async () => {
    let disposeCount = 0;
    const supervisor = new RuntimeSupervisor({
      maxRestarts: 1,
      restartDelayMs: 0,
      createRuntime: () => ({
        async initialize() {},
        async dispose() { disposeCount += 1; },
      }),
    });
    await supervisor.start();
    await supervisor.recover();
    expect(disposeCount).toBe(1);
    expect(supervisor.getHealth().restartCount).toBe(1);
    await expect(supervisor.recover()).rejects.toThrow('restart budget exhausted');
  });

  test('automatically recovers an unexpectedly exited runtime and coalesces exit signals', async () => {
    const runtimes = [];
    const supervisor = new RuntimeSupervisor({
      maxRestarts: 2,
      restartDelayMs: 0,
      createRuntime: () => {
        const runtime = {
          hooks: null,
          setSupervisorHooks(hooks) { this.hooks = hooks; },
          async initialize() {},
          async dispose() {},
        };
        runtimes.push(runtime);
        return runtime;
      },
    });
    await supervisor.start();
    const first = runtimes[0];
    first.hooks.onUnexpectedExit({ code: 9 });
    first.hooks.onUnexpectedExit({ code: 9 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtimes).toHaveLength(2);
    expect(supervisor.getHealth()).toMatchObject({
      state: SupervisorState.HEALTHY,
      restartCount: 1,
    });
  });
});

describe('capability policy engine', () => {
  test('allows commands under the local-full profile and records decisions', () => {
    const engine = new CapabilityPolicyEngine({ profile: 'local-full' });
    const decision = engine.authorize({
      channel: 'terminal:execute',
      risk: 'critical',
      capability: 'terminal',
    });
    expect(decision.effect).toBe(PolicyEffect.ALLOW);
    expect(engine.getSnapshot().decisions).toHaveLength(1);
  });

  test('denies critical commands under the standard profile with a stable error', () => {
    const engine = new CapabilityPolicyEngine({ profile: 'standard' });
    expect(() => engine.authorize({
      channel: 'terminal:execute',
      risk: 'critical',
      capability: 'terminal',
    })).toThrow(PolicyDeniedError);
    expect(engine.getSnapshot().decisions[0]).toMatchObject({
      effect: PolicyEffect.DENY,
      reason: 'risk_exceeds_profile',
    });
  });
});
