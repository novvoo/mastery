import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const architecture = read('docs/architecture.md');

describe('architecture contract', () => {
  test('documents the required operational architecture sections', () => {
    for (const heading of [
      '## 1. 目标、约束与非目标',
      '## 2. 架构北极星',
      '## 3. 系统上下文',
      '## 4. 容器视图',
      '## 5. 组件与依赖边界',
      '## 6. 关键运行时流程',
      '## 7. 状态、数据与一致性',
      '## 8. 安全架构',
      '## 9. 可靠性、容量与可观测性',
      '## 10. 部署与发布视图',
      '## 11. 架构决策',
      '## 12. 已知限制与演进路线',
      '## 13. 变更闭环',
      '## 14. 实现索引',
    ]) {
      expect(architecture).toContain(heading);
    }
    expect(architecture).toContain('bun run verify');
    expect(architecture).toContain('architecture-contract.test.js');
  });

  test('keeps every Mermaid block complete and typed', () => {
    const diagrams = [...architecture.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)]
      .map((match) => match[1].trim());
    expect(diagrams.length).toBeGreaterThanOrEqual(8);
    for (const diagram of diagrams) {
      expect(diagram).toMatch(/^(flowchart|stateDiagram-v2|sequenceDiagram)\b/);
    }
  });

  test('keeps named architecture modules backed by real files', () => {
    for (const relativePath of [
      'desktop/renderer/App.jsx',
      'desktop/renderer/hooks/useIPC.js',
      'desktop/renderer/hooks/useCapabilities.js',
      'desktop/renderer/app/capabilities/capability-graph.js',
      'desktop/renderer/app/layout/layout-state.js',
      'desktop/renderer/app/content/content-pipeline.js',
      'src/index.js',
      'src/adapters/desktop/desktop-core.js',
      'src/adapters/desktop/omp-adapter.js',
      'src/adapters/desktop/runtime-supervisor.js',
      'src/adapters/desktop/capability-registry.js',
      'src/adapters/desktop/policy-engine.js',
      'src/adapters/desktop/protocol/command-contracts.js',
      'desktop/main-app/ipc-router.js',
    ]) {
      expect(architecture).toContain(relativePath);
      expect(existsSync(path.join(ROOT, relativePath))).toBe(true);
    }
  });

  test('keeps the documented startup order aligned with main process code', () => {
    const mainApp = read('desktop/main-app.js');
    const orderedCalls = [
      'await electron.app.whenReady()',
      'createMenu(ctx)',
      'startFileServer(ctx)',
      'await initializeDesktopCore(ctx)',
      'await attachConfiguredModelProvider(ctx)',
      'await initializeIPCAdapter(ctx)',
      'createMainWindow(ctx)',
    ];
    let cursor = -1;
    for (const call of orderedCalls) {
      const next = mainApp.indexOf(call);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
  });

  test('distinguishes the thin CLI path from the Desktop adapter path', () => {
    const publicEntry = read('src/index.js');
    expect(architecture).toContain('CLI 是直接启动 OMP CLI 的薄代理');
    expect(architecture).toContain('Desktop 才使用 `OmpAdapter`');
    expect(publicEntry).toContain("spawn(process.env.BUN_PATH || 'bun'");
    expect(publicEntry).not.toContain('createOmpAdapter(');
  });

  test('records architectural decisions with stable identifiers', () => {
    for (const decision of [
      'ADR-001',
      'ADR-002',
      'ADR-003',
      'ADR-004',
      'ADR-005',
      'ADR-006',
      'ADR-007',
    ]) {
      expect(architecture).toContain(decision);
    }
  });

  test('separates current architecture from the target evolution model', () => {
    for (const concept of [
      'Current Architecture',
      'Target Architecture',
      'Control Plane',
      'Data Plane',
      'Execution Plane',
      'CQRS-lite',
      'Runtime Supervisor',
      'Capability Registry',
      'Backpressure over buffering',
    ]) {
      expect(architecture).toContain(concept);
    }
    expect(architecture).toContain('Phase 1');
    expect(architecture).toContain('退出条件');
  });

  test('keeps Event Envelope v1 aligned with runtime records', () => {
    const records = read('src/runtime/event-bus/records.js');
    for (const field of [
      'schemaVersion',
      'sequence',
      'correlationId',
      'causationId',
    ]) {
      expect(architecture).toContain(field);
      expect(records).toContain(field);
    }
    expect(architecture).toContain('同一个 EventBus 实例内单调递增');
    expect(architecture).toContain('不等于持久事件溯源');
  });

  test('keeps completed target phases backed by executable foundations', () => {
    const commandContracts = read('src/adapters/desktop/protocol/command-contracts.js');
    const supervisor = read('src/adapters/desktop/runtime-supervisor.js');
    const policy = read('src/adapters/desktop/policy-engine.js');
    expect(architecture).toContain('Phase 2（完成）');
    expect(architecture).toContain('Phase 3（完成）');
    expect(architecture).toContain('Phase 4（完成）');
    expect(commandContracts).toContain('ensureCommandContractCoverage');
    expect(supervisor).toContain('handleUnexpectedExit');
    expect(policy).toContain('authorize(');
  });

  test('keeps the documented event buffer budget executable', () => {
    const desktopCore = read('src/adapters/desktop/desktop-core.js');
    expect(architecture).toContain('DESKTOP_ARCHITECTURE_LIMITS.eventBufferSize');
    expect(architecture).toContain('1000 条');
    expect(desktopCore).toContain('eventBufferSize: 1000');
    expect(desktopCore).toContain(
      'this.#eventBuffer.length > DESKTOP_ARCHITECTURE_LIMITS.eventBufferSize',
    );
  });

  test('documents the Electron trust-boundary invariants enforced by code', () => {
    const mainApp = read('desktop/main-app.js');
    for (const invariant of [
      'nodeIntegration: false',
      'contextIsolation: true',
      'sandbox: true',
      'webSecurity: true',
    ]) {
      expect(architecture).toContain(invariant);
      expect(mainApp).toContain(invariant);
    }
    expect(architecture).toContain('Preload 只暴露显式 invoke/send/receive 白名单');
  });

  test('enforces the renderer dependency direction described in the document', () => {
    const layoutHook = read('desktop/renderer/hooks/useLayout.js');
    expect(layoutHook).toContain("../app/layout/layout-state.js");
    expect(layoutHook).not.toMatch(/from ['"].*components\//);
    expect(layoutHook).not.toContain('session/session-storage.js');
  });

  test('keeps the quality gate complete and architecture checks discoverable', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.verify).toBe(
      'bun run verify:quality && bun run test:unit && bun run test:desktop',
    );
    expect(pkg.scripts['verify:quality']).toContain('bun run lint');
    expect(pkg.scripts['verify:quality']).toContain('bun run desktop:renderer:build');
    expect(pkg.scripts['test:architecture']).toContain('architecture-contract.test.js');
  });
});
